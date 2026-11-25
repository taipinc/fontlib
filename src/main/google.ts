import { net } from 'electron'
import type { GooglePreview, ImportResult } from '@shared/api'
import { buildCss2Url, GOOGLE_CATEGORY, GOOGLE_LICENSE, type GoogleAxis, type GoogleMeta } from '@shared/google'
import { parseSourceLink } from '@shared/links'
import { getDb } from './db'

// Google Fonts entries store no files. Metadata comes from the family's METADATA.pb in the
// google/fonts GitHub repo (no API key, no catalog); previews load from the CSS2 endpoint.

const RAW = 'https://raw.githubusercontent.com/google/fonts/main'

const AXIS_NAMES: Record<string, string> = {
  wght: 'Weight',
  wdth: 'Width',
  opsz: 'Optical size',
  slnt: 'Slant',
  ital: 'Italic',
  GRAD: 'Grade',
  XTRA: 'Counter width',
  XOPQ: 'Thick stroke',
  YOPQ: 'Thin stroke',
  YTLC: 'Lowercase height',
  YTUC: 'Uppercase height',
  YTAS: 'Ascender height',
  YTDE: 'Descender depth',
  YTFI: 'Figure height',
  CASL: 'Casual',
  CRSV: 'Cursive',
  MONO: 'Monospace',
  SOFT: 'Softness',
  WONK: 'Wonky',
  FILL: 'Fill'
}
const LICENSE_DIRS = ['ofl', 'apache', 'ufl']

// ---- Protocol-buffer text format (just enough for METADATA.pb) ----

type PbValue = string | number | PbMessage
interface PbMessage {
  [field: string]: PbValue[]
}

function parsePbText(src: string): PbMessage {
  let i = 0
  const ws = (): void => {
    while (i < src.length) {
      if (/\s/.test(src[i])) i++
      else if (src[i] === '#') while (i < src.length && src[i] !== '\n') i++
      else break
    }
  }
  const ident = (): string => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (!m) throw new Error(`Unexpected “${src.slice(i, i + 10)}” in METADATA.pb`)
    i += m[0].length
    return m[0]
  }
  const str = (): string => {
    const q = src[i++]
    let out = ''
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        const c = src[++i]
        out += c === 'n' ? '\n' : c === 't' ? '\t' : c
        i++
      } else out += src[i++]
    }
    i++
    ws()
    // Adjacent string literals concatenate.
    if (src[i] === '"' || src[i] === "'") out += str()
    return out
  }
  const message = (end: string | null): PbMessage => {
    const msg: PbMessage = {}
    for (;;) {
      ws()
      if (i >= src.length || (end && src[i] === end)) {
        i++
        return msg
      }
      const key = ident()
      ws()
      if (src[i] === ':') {
        i++
        ws()
      }
      let value: PbValue
      if (src[i] === '{') {
        i++
        value = message('}')
      } else if (src[i] === '"' || src[i] === "'") {
        value = str()
      } else {
        const m = /^[^\s{}#]+/.exec(src.slice(i))!
        i += m[0].length
        const n = Number(m[0])
        value = Number.isNaN(n) ? m[0] : n
      }
      ;(msg[key] ??= []).push(value)
    }
  }
  return message(null)
}

const one = (m: PbMessage, k: string): PbValue | undefined => m[k]?.[0]
const text = (m: PbMessage, k: string): string | null => {
  const v = one(m, k)
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
}
const num = (m: PbMessage, k: string): number | null => {
  const v = one(m, k)
  return typeof v === 'number' ? v : null
}

// ---- Fetching ----

interface GoogleFamilyData {
  meta: GoogleMeta
  preview: GooglePreview
  fonts: { postscriptName: string; fullName: string | null; styleName: string; weight: number; italic: boolean; variable: boolean }[]
  designer: string | null
  category: string | null
  license: string | null
  licenseUrl: string | null
  specimenUrl: string
  repoUrl: string | null
}

const cache = new Map<string, GoogleFamilyData>()

async function fetchText(url: string): Promise<string | null> {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'FontLib' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
  return res.text()
}

function styleNameFor(weight: number, italic: boolean): string {
  const names: Record<number, string> = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black'
  }
  const base = names[weight] ?? String(weight)
  if (!italic) return base
  return base === 'Regular' ? 'Italic' : `${base} Italic`
}

export async function lookupGoogle(input: string): Promise<GoogleFamilyData> {
  const link = parseSourceLink(input)
  if ('error' in link) throw new Error(link.error)
  if (link.type !== 'google') throw new Error('Not a Google Fonts link')
  const hit = cache.get(link.slug)
  if (hit) return hit

  let pb: string | null = null
  let dir = ''
  try {
    for (const d of LICENSE_DIRS) {
      pb = await fetchText(`${RAW}/${d}/${link.slug}/METADATA.pb`)
      if (pb) {
        dir = d
        break
      }
    }
  } catch (e) {
    throw new Error(`Couldn’t reach GitHub to read the family’s metadata (${(e as Error).message}). Are you online?`)
  }
  if (!pb) throw new Error(`“${link.family}” wasn’t found in the Google Fonts repository. Check the family name in the link.`)

  const m = parsePbText(pb)
  const family = text(m, 'name') ?? link.family
  const axes: GoogleAxis[] = (m.axes ?? [])
    .filter((a): a is PbMessage => typeof a === 'object')
    .map((a) => ({ tag: text(a, 'tag') ?? '', min: num(a, 'min_value') ?? 0, max: num(a, 'max_value') ?? 0 }))
    .filter((a) => a.tag)

  const fonts = (m.fonts ?? [])
    .filter((f): f is PbMessage => typeof f === 'object')
    .map((f) => {
      const weight = num(f, 'weight') ?? 400
      const italic = text(f, 'style') === 'italic'
      const filename = text(f, 'filename') ?? ''
      const variable = filename.includes('[')
      return {
        postscriptName: text(f, 'post_script_name') ?? `${family.replace(/\s/g, '')}-${styleNameFor(weight, italic)}`,
        fullName: text(f, 'full_name'),
        styleName: variable ? (italic ? 'Italic' : 'Regular') : styleNameFor(weight, italic),
        weight,
        italic,
        variable
      }
    })
  if (fonts.length === 0) throw new Error(`The metadata for “${family}” lists no fonts.`)

  const styles = fonts.map((f) => ({ weight: f.weight, italic: f.italic }))
  const cssUrl = buildCss2Url(family, axes, styles)
  const licenseKey = text(m, 'license') ?? ''
  const source = (m.source?.[0] ?? {}) as PbMessage
  const designer = text(m, 'designer')

  const data: GoogleFamilyData = {
    meta: { family, slug: link.slug, repoPath: `${dir}/${link.slug}`, axes, styles, cssUrl },
    fonts,
    designer,
    category: GOOGLE_CATEGORY[text(m, 'category') ?? ''] ?? null,
    license: GOOGLE_LICENSE[licenseKey]?.name ?? (licenseKey || null),
    licenseUrl: GOOGLE_LICENSE[licenseKey]?.url ?? null,
    specimenUrl: link.url,
    repoUrl: text(source, 'repository_url'),
    preview: {
      family,
      designer,
      category: GOOGLE_CATEGORY[text(m, 'category') ?? ''] ?? null,
      license: GOOGLE_LICENSE[licenseKey]?.name ?? (licenseKey || null),
      styleCount: fonts.length,
      axes: axes.map((a) => a.tag),
      cssUrl,
      existingFamilyId:
        (getDb().prepare('SELECT id FROM families WHERE name = ? COLLATE NOCASE').get(family) as { id: number } | undefined)
          ?.id ?? null
    }
  }
  cache.set(link.slug, data)
  return data
}

/** Adds (or attaches) a Google family. Returns the family id. */
export async function addGoogleFamily(input: string): Promise<{ familyId: number; result: ImportResult }> {
  const g = await lookupGoogle(input)
  const db = getDb()
  const result: ImportResult = { familiesAdded: 0, familiesUpdated: 0, stylesAdded: 0, skippedDuplicates: 0, errors: [] }

  const familyId = db.transaction(() => {
    let id = (db.prepare('SELECT id FROM families WHERE name = ? COLLATE NOCASE').get(g.meta.family) as { id: number } | undefined)?.id
    if (id === undefined) {
      id = Number(
        db
          .prepare('INSERT INTO families (name, designer, category, license, license_url) VALUES (?, ?, ?, ?, ?)')
          .run(g.meta.family, g.designer, g.category, g.license, g.licenseUrl).lastInsertRowid
      )
      result.familiesAdded = 1
    } else {
      db.prepare(
        `UPDATE families SET designer = COALESCE(designer, ?), category = COALESCE(category, ?),
           license = COALESCE(license, ?), license_url = COALESCE(license_url, ?) WHERE id = ?`
      ).run(g.designer, g.category, g.license, g.licenseUrl, id)
      result.familiesUpdated = 1
    }

    // One Google source per family. A hand-added reference link for the same family becomes the real source.
    const metaJson = JSON.stringify(g.meta)
    const existing = db.prepare("SELECT id FROM sources WHERE family_id = ? AND type = 'google'").get(id) as { id: number } | undefined
    let sourceId: number
    if (existing) {
      sourceId = existing.id
      db.prepare(
        "UPDATE sources SET url = ?, repo_url = ?, meta = ?, last_checked = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
      ).run(g.specimenUrl, g.repoUrl, metaJson, sourceId)
    } else {
      sourceId = Number(
        db
          .prepare(
            "INSERT INTO sources (family_id, type, url, repo_url, meta, last_checked) VALUES (?, 'google', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
          )
          .run(id, g.specimenUrl, g.repoUrl, metaJson).lastInsertRowid
      )
    }

    const styleByPs = db.prepare('SELECT id FROM styles WHERE family_id = ? AND postscript_name = ?')
    const hasRemote = db.prepare("SELECT 1 FROM assets WHERE style_id = ? AND source_id = ? AND storage = 'remote'")
    const insertStyle = db.prepare(
      `INSERT INTO styles (family_id, postscript_name, full_name, style_name, weight, italic, width, is_variable, axes, origin_family)
       VALUES (?, ?, ?, ?, ?, ?, 5, ?, ?, ?)`
    )
    const insertAsset = db.prepare(
      "INSERT INTO assets (style_id, source_id, kind, storage, path) VALUES (?, ?, 'woff2', 'remote', ?)"
    )
    const axes = g.meta.axes
      .filter((a) => a.tag !== 'ital')
      .map((a) => {
        const preferred = a.tag === 'wght' ? 400 : a.tag === 'wdth' ? 100 : a.tag === 'opsz' ? 14 : 0
        const def = Math.min(a.max, Math.max(a.min, preferred))
        return { tag: a.tag, name: AXIS_NAMES[a.tag] ?? a.tag, min: a.min, default: def, max: a.max }
      })

    for (const f of g.fonts) {
      let styleId = (styleByPs.get(id, f.postscriptName) as { id: number } | undefined)?.id
      if (styleId === undefined) {
        styleId = Number(
          insertStyle.run(
            id,
            f.postscriptName,
            f.fullName,
            f.styleName,
            f.weight,
            f.italic ? 1 : 0,
            f.variable ? 1 : 0,
            JSON.stringify(f.variable ? axes : []),
            g.meta.family
          ).lastInsertRowid
        )
        result.stylesAdded++
      } else if (hasRemote.get(styleId, sourceId)) {
        result.skippedDuplicates++
        continue
      }
      insertAsset.run(styleId, sourceId, g.meta.cssUrl)
    }
    return id
  })()

  return { familyId, result }
}
