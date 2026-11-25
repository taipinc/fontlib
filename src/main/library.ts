import type { Axis, FamilySummary, Settings, SourceType, StyleSummary } from '@shared/api'
import { getDb } from './db'

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
}

/** Picks the style closest to Regular: upright, weight nearest 400, normal width. */
function defaultStyle(styles: StyleSummary[]): StyleSummary | undefined {
  const score = (s: StyleSummary): number =>
    (s.italic ? 10000 : 0) + Math.abs(s.weight - 400) + Math.abs(s.width - 5) * 50 + (s.assetId === null ? 100000 : 0)
  return [...styles].sort((a, b) => score(a) - score(b))[0]
}

export function listFamilies(): FamilySummary[] {
  const db = getDb()
  const families = db
    .prepare('SELECT id, name, designer, foundry, category, created_at FROM families ORDER BY name COLLATE NOCASE')
    .all() as {
    id: number
    name: string
    designer: string | null
    foundry: string | null
    category: string | null
    created_at: string
  }[]

  const styleRows = db
    .prepare(
      `SELECT s.id, s.family_id, s.postscript_name, s.style_name, s.weight, s.italic, s.width, s.is_variable, s.axes,
              (SELECT a.id FROM assets a WHERE a.style_id = s.id AND a.missing = 0
               ORDER BY CASE a.storage WHEN 'stored' THEN 0 WHEN 'system-path' THEN 1 ELSE 2 END LIMIT 1) AS asset_id
       FROM styles s
       ORDER BY s.italic, s.width, s.weight`
    )
    .all() as StyleRow[]

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
      assetId: r.asset_id
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
      defaultStyleId: defaultStyle(styles)?.id ?? null,
      createdAt: f.created_at
    }
  })
}

const SETTING_KEYS = new Set(['theme', 'previewText', 'previewSize', 'layout'])

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
