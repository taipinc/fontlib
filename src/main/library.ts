import type {
  AssetDetail,
  Axis,
  FamilyDetail,
  FamilySummary,
  Settings,
  SourceDetail,
  SourceType,
  StyleDetail,
  StyleSummary,
  Variation
} from '@shared/api'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb } from './db'
import { parseFontBuffer } from './parse'
import { fontsPath } from './paths'

interface StyleRow {
  id: number
  family_id: number
  postscript_name: string
  style_name: string | null
  weight: number
  italic: number
  width: number
  is_variable: number
  axes: string
  asset_id: number | null
  origin_family: string | null
  missing_count: number
}

/** Picks the style closest to Regular: upright, weight nearest 400, normal width. */
function defaultStyle(styles: StyleSummary[]): StyleSummary | undefined {
  const score = (s: StyleSummary): number =>
    (s.italic ? 10000 : 0) +
    Math.abs(s.weight - 400) +
    Math.abs(s.width - 5) * 50 +
    (s.assetId === null && !s.remote ? 100000 : 0)
  return [...styles].sort((a, b) => score(a) - score(b))[0]
}

export function listFamilies(): FamilySummary[] {
  const db = getDb()
  const families = db
    .prepare(
      `SELECT id, name, designer, foundry, category, created_at, default_style_id, default_variation
       FROM families ORDER BY name COLLATE NOCASE`
    )
    .all() as {
    id: number
    name: string
    designer: string | null
    foundry: string | null
    category: string | null
    created_at: string
    default_style_id: number | null
    default_variation: string | null
  }[]

  const styleRows = db
    .prepare(
      `SELECT s.id, s.family_id, s.postscript_name, s.style_name, s.weight, s.italic, s.width, s.is_variable, s.axes,
              s.origin_family,
              (SELECT COUNT(*) FROM assets a WHERE a.style_id = s.id AND a.missing = 1) AS missing_count,
              (SELECT a.id FROM assets a WHERE a.style_id = s.id AND a.missing = 0 AND a.storage != 'remote'
               ORDER BY CASE a.storage WHEN 'stored' THEN 0 ELSE 1 END LIMIT 1) AS asset_id
       FROM styles s
       ORDER BY s.italic, s.width, s.weight`
    )
    .all() as StyleRow[]

  // Web-hosted faces (Google): the stylesheet URL is the asset path; the CSS family name is on the source.
  const remoteRows = db
    .prepare(
      `SELECT a.style_id, a.path, src.meta FROM assets a JOIN sources src ON src.id = a.source_id
       WHERE a.storage = 'remote'`
    )
    .all() as { style_id: number; path: string; meta: string }[]
  const remoteByStyle = new Map<number, { cssUrl: string; family: string }>()
  for (const r of remoteRows) {
    const family = (JSON.parse(r.meta) as { family?: string }).family
    if (family && !remoteByStyle.has(r.style_id)) remoteByStyle.set(r.style_id, { cssUrl: r.path, family })
  }

  const sourceRows = db.prepare('SELECT DISTINCT family_id, type FROM sources').all() as {
    family_id: number
    type: SourceType
  }[]

  const tagRows = db
    .prepare(
      'SELECT ft.family_id, t.name FROM family_tags ft JOIN tags t ON t.id = ft.tag_id ORDER BY t.name COLLATE NOCASE'
    )
    .all() as { family_id: number; name: string }[]
  const tagsByFamily = new Map<number, string[]>()
  for (const r of tagRows) tagsByFamily.set(r.family_id, [...(tagsByFamily.get(r.family_id) ?? []), r.name])

  const stylesByFamily = new Map<number, StyleSummary[]>()
  for (const r of styleRows) {
    const list = stylesByFamily.get(r.family_id) ?? []
    list.push({
      id: r.id,
      postscriptName: r.postscript_name,
      styleName: r.style_name ?? 'Regular',
      weight: r.weight,
      italic: r.italic === 1,
      width: r.width,
      isVariable: r.is_variable === 1,
      axes: JSON.parse(r.axes) as Axis[],
      assetId: r.asset_id,
      originFamily: r.origin_family ?? undefined,
      missing: r.asset_id === null && !remoteByStyle.has(r.id) && r.missing_count > 0 ? true : undefined,
      remote: remoteByStyle.has(r.id)
        ? { ...remoteByStyle.get(r.id)!, weight: r.weight, italic: r.italic === 1 }
        : undefined
    })
    stylesByFamily.set(r.family_id, list)
  }

  const sourcesByFamily = new Map<number, SourceType[]>()
  for (const r of sourceRows) {
    const list = sourcesByFamily.get(r.family_id) ?? []
    list.push(r.type)
    sourcesByFamily.set(r.family_id, list)
  }

  return families.map((f) => {
    const styles = stylesByFamily.get(f.id) ?? []
    const saved = f.default_style_id !== null && styles.some((s) => s.id === f.default_style_id)
    return {
      id: f.id,
      name: f.name,
      designer: f.designer,
      foundry: f.foundry,
      category: f.category,
      tags: tagsByFamily.get(f.id) ?? [],
      sources: sourcesByFamily.get(f.id) ?? [],
      isVariable: styles.some((s) => s.isVariable),
      styles,
      defaultStyleId: saved ? f.default_style_id : (defaultStyle(styles)?.id ?? null),
      defaultVariation: saved && f.default_variation ? (JSON.parse(f.default_variation) as Variation) : null,
      createdAt: f.created_at
    }
  })
}

const SETTING_KEYS = new Set(['theme', 'previewText', 'previewSize', 'layout', 'familyPanel'])

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const out: Record<string, unknown> = {}
  for (const r of rows) if (SETTING_KEYS.has(r.key)) out[r.key] = JSON.parse(r.value)
  return out as Settings
}

export function setSettings(patch: Settings): void {
  const db = getDb()
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (SETTING_KEYS.has(k) && v !== undefined) upsert.run(k, JSON.stringify(v))
    }
  })()
}

export function getFamily(familyId: number): FamilyDetail | null {
  const db = getDb()
  const f = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as
    | {
        id: number
        name: string
        designer: string | null
        foundry: string | null
        category: string | null
        notes: string | null
        license: string | null
        license_url: string | null
        created_at: string
        updated_at: string
        default_style_id: number | null
      }
    | undefined
  if (!f) return null

  const summary = listFamilies().find((x) => x.id === familyId)!

  const sources = (
    db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM assets a WHERE a.source_id = s.id) AS asset_count
         FROM sources s WHERE s.family_id = ? ORDER BY s.created_at`
      )
      .all(familyId) as {
      id: number
      type: SourceType
      url: string | null
      repo_url: string | null
      ref: string | null
      version: string | null
      meta: string
      asset_count: number
    }[]
  ).map(
    (s): SourceDetail => ({
      id: s.id,
      type: s.type,
      url: s.url,
      repoUrl: s.repo_url,
      ref: s.ref,
      version: s.version,
      isReference: Boolean(JSON.parse(s.meta).reference) && s.asset_count === 0
    })
  )

  const extra = new Map(
    (
      db
        .prepare('SELECT id, full_name, features, scripts, glyph_count, version FROM styles WHERE family_id = ?')
        .all(familyId) as {
        id: number
        full_name: string | null
        features: string
        scripts: string
        glyph_count: number | null
        version: string | null
      }[]
    ).map((r) => [r.id, r])
  )

  const assets = db
    .prepare(
      `SELECT a.id, a.style_id, a.kind, a.storage, a.path, a.size, a.missing, src.type AS source_type
       FROM assets a JOIN sources src ON src.id = a.source_id JOIN styles s ON s.id = a.style_id
       WHERE s.family_id = ?`
    )
    .all(familyId) as {
    id: number
    style_id: number
    kind: string
    storage: AssetDetail['storage']
    path: string
    size: number | null
    missing: number
    source_type: SourceType
  }[]

  const styles: StyleDetail[] = summary.styles.map((s) => {
    const e = extra.get(s.id)!
    return {
      ...s,
      fullName: e.full_name,
      features: JSON.parse(e.features),
      scripts: JSON.parse(e.scripts),
      glyphCount: e.glyph_count,
      version: e.version,
      assets: assets
        .filter((a) => a.style_id === s.id)
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          storage: a.storage,
          path: a.path,
          size: a.size,
          sourceType: a.source_type,
          missing: a.missing === 1
        }))
    }
  })

  return {
    id: f.id,
    name: f.name,
    designer: f.designer,
    foundry: f.foundry,
    category: f.category,
    notes: f.notes,
    license: f.license,
    licenseUrl: f.license_url,
    tags: summary.tags,
    sources,
    styles,
    defaultStyleId: summary.defaultStyleId,
    defaultVariation: summary.defaultVariation,
    hasSavedDefault: f.default_style_id !== null && f.default_style_id === summary.defaultStyleId,
    createdAt: f.created_at,
    updatedAt: f.updated_at
  }
}

/**
 * Fills styles.origin_family for styles added before that column existed, by re-reading
 * their font files (read-only). Runs at startup; does nothing once every style has a value.
 */
export function backfillOriginFamilies(): void {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT s.id, s.postscript_name, a.storage, a.path FROM styles s
       JOIN assets a ON a.style_id = s.id
       WHERE s.origin_family IS NULL AND a.storage IN ('stored','system-path')`
    )
    .all() as { id: number; postscript_name: string; storage: string; path: string }[]
  if (rows.length === 0) return

  const byFile = new Map<string, Map<string, string>>()
  const update = db.prepare('UPDATE styles SET origin_family = ? WHERE id = ? AND origin_family IS NULL')
  db.transaction(() => {
    for (const r of rows) {
      const file = r.storage === 'stored' ? resolve(fontsPath(), r.path) : r.path
      if (!byFile.has(file)) {
        const names = new Map<string, string>()
        try {
          for (const s of parseFontBuffer(readFileSync(file))) names.set(s.postscriptName, s.familyName)
        } catch {
          /* unreadable or missing file: leave this style without an origin */
        }
        byFile.set(file, names)
      }
      const origin = byFile.get(file)!.get(r.postscript_name)
      if (origin) update.run(origin, r.id)
    }
  })()
}
