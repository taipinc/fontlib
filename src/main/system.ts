import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import * as fontkit from 'fontkit'
import type { ImportResult, SystemFamily } from '@shared/api'
import { getDb } from './db'
import { importInputs } from './importer'

// System fonts are referenced, never copied: the library stores the file path, the index
// inside a collection, and the PostScript name. The installed-font listing is built on
// demand and kept in memory only (never persisted).

const FONT_EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc'])

function roots(): string[] {
  const out = ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library/Fonts')]
  // Fonts macOS downloads on demand live under versioned asset folders that change on updates.
  const assets = '/System/Library/AssetsV2'
  try {
    for (const d of readdirSync(assets)) if (d.startsWith('com_apple_MobileAsset_Font')) out.push(join(assets, d))
  } catch {
    /* not present */
  }
  return out
}

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (FONT_EXTS.has(extname(name).toLowerCase())) out.push(p)
  }
}

export interface ScannedFace {
  /** Id used by the picker and the fontlib://system/<id> preview route. */
  id: number
  path: string
  index: number | null
  family: string
  styleName: string
  postscriptName: string
  weight: number
  italic: boolean
}

let scan: { faces: ScannedFace[]; at: number } | null = null
let scanning: Promise<ScannedFace[]> | null = null

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.replace(/\0/g, '').trim() ? v.replace(/\0/g, '').trim() : null
}

/** Reads names only (no glyph data) from every installed font. Cached for this session. */
export function scanSystemFonts(force = false): Promise<ScannedFace[]> {
  if (scan && !force) return Promise.resolve(scan.faces)
  if (scanning) return scanning
  scanning = (async () => {
    const files: string[] = []
    for (const r of roots()) walk(r, files)
    const faces: ScannedFace[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const path = files[next++]
        try {
          const buf = await readFile(path)
          const parsed = fontkit.create(buf) as any
          const fonts: any[] = parsed.type === 'TTC' ? parsed.fonts : [parsed]
          fonts.forEach((f, i) => {
            const family = clean(f.getName('preferredFamily')) ?? clean(f.familyName)
            const ps = clean(f.postscriptName)
            if (!family || !ps || family.startsWith('.')) return // hidden system UI faces
            faces.push({
              id: 0,
              path,
              index: parsed.type === 'TTC' ? i : null,
              family,
              styleName: clean(f.getName('preferredSubfamily')) ?? clean(f.subfamilyName) ?? 'Regular',
              postscriptName: ps,
              weight: f['OS/2']?.usWeightClass || 400,
              italic: Boolean(f['OS/2']?.fsSelection?.italic) || (typeof f.italicAngle === 'number' && f.italicAngle !== 0)
            })
          })
        } catch {
          /* unreadable font: skip */
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    faces.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || Number(a.italic) - Number(b.italic))
    faces.forEach((f, i) => (f.id = i + 1))
    scan = { faces, at: Date.now() }
    return faces
  })().finally(() => (scanning = null))
  return scanning
}

/** For the picker's previews: a scanned face by id (only faces from the current scan). */
export function scannedFace(id: number): ScannedFace | undefined {
  return scan?.faces[id - 1]
}

export async function listSystemFamilies(): Promise<SystemFamily[]> {
  const faces = await scanSystemFonts()
  const inLibrary = new Set(
    (
      getDb()
        .prepare(
          "SELECT DISTINCT s.postscript_name FROM styles s JOIN assets a ON a.style_id = s.id WHERE a.storage = 'system-path'"
        )
        .all() as { postscript_name: string }[]
    ).map((r) => r.postscript_name)
  )
  const byFamily = new Map<string, ScannedFace[]>()
  for (const f of faces) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f])
  return [...byFamily].map(([name, list]) => {
    const regular =
      [...list].sort((a, b) => Number(a.italic) - Number(b.italic) || Math.abs(a.weight - 400) - Math.abs(b.weight - 400))[0]
    return {
      name,
      styleCount: new Set(list.map((f) => f.postscriptName)).size,
      previewFaceId: regular.id,
      inLibrary: list.every((f) => inLibrary.has(f.postscriptName)),
      userInstalled: list.every((f) => f.path.startsWith(homedir()) || f.path.startsWith('/Library/Fonts'))
    }
  })
}

/** Adds the chosen installed families to the library by reference. */
export async function addSystemFamilies(names: unknown): Promise<ImportResult & { familyIds: number[] }> {
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) throw new Error('Invalid selection')
  const wanted = new Set(names as string[])
  const faces = (await scanSystemFonts()).filter((f) => wanted.has(f.family))
  const files = [...new Set(faces.map((f) => f.path))]
  const inputs = []
  const errors: ImportResult['errors'] = []
  for (const path of files) {
    try {
      inputs.push({ origin: path, filename: path.split('/').pop()!, buffer: await readFile(path), systemPath: path })
    } catch (e) {
      errors.push({ file: path, message: (e as Error).message })
    }
  }
  const outcome = importInputs(inputs, { type: 'system', families: wanted })
  outcome.errors.unshift(...errors)
  return outcome
}

/**
 * Checks every system reference. Paths that vanished (e.g. after an OS update moved a
 * downloadable font) are re-resolved by PostScript name; otherwise the entry is marked
 * missing, never deleted. Returns true if anything changed.
 */
export async function verifySystemAssets(): Promise<boolean> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT a.id, a.path, a.missing, s.postscript_name FROM assets a JOIN styles s ON s.id = a.style_id
       WHERE a.storage = 'system-path'`
    )
    .all() as { id: number; path: string; missing: number; postscript_name: string }[]
  if (rows.length === 0) return false

  const gone = rows.filter((r) => !existsSync(r.path))
  const back = rows.filter((r) => r.missing === 1 && existsSync(r.path))
  let changed = false
  const setMissing = db.prepare('UPDATE assets SET missing = ? WHERE id = ?')
  for (const r of back) {
    setMissing.run(0, r.id)
    changed = true
  }
  if (gone.length === 0) return changed

  const faces = await scanSystemFonts(true)
  const byPs = new Map(faces.map((f) => [f.postscriptName, f]))
  const relocate = db.prepare('UPDATE assets SET path = ?, collection_index = ?, missing = 0 WHERE id = ?')
  db.transaction(() => {
    for (const r of gone) {
      const hit = byPs.get(r.postscript_name)
      if (hit) relocate.run(hit.path, hit.index, r.id)
      else if (r.missing === 0) setMissing.run(1, r.id)
      else continue
      changed = true
    }
  })()
  return changed
}

