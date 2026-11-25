import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import yauzl from 'yauzl'
import type { ImportResult } from '@shared/api'
import { getDb } from './db'
import { fontsPath } from './paths'
import { parseFontBuffer, type ParsedStyle } from './parse'

const FONT_EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'])
const MAX_FONT_BYTES = 100 * 1024 * 1024

export interface Input {
  /** Where it came from, for error messages. */
  origin: string
  filename: string
  buffer: Buffer
}

function isHidden(name: string): boolean {
  return name.startsWith('.') || name === '__MACOSX'
}

function readZip(path: string): Promise<Input[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open zip'))
      const out: Input[] = []
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = basename(entry.fileName)
        const parts = entry.fileName.split('/')
        const wanted =
          !entry.fileName.endsWith('/') &&
          !parts.some(isHidden) &&
          FONT_EXTS.has(extname(name).toLowerCase()) &&
          entry.uncompressedSize <= MAX_FONT_BYTES
        if (!wanted) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            out.push({ origin: `${basename(path)}/${entry.fileName}`, filename: name, buffer: Buffer.concat(chunks) })
            zip.readEntry()
          })
          stream.on('error', reject)
        })
      })
      zip.on('end', () => resolve(out))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

async function collect(path: string, out: Input[], errors: ImportResult['errors']): Promise<void> {
  let st
  try {
    st = statSync(path)
  } catch (e) {
    errors.push({ file: path, message: 'File not found' })
    return
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!isHidden(name)) await collect(join(path, name), out, errors)
    }
    return
  }
  const ext = extname(path).toLowerCase()
  if (ext === '.zip') {
    try {
      out.push(...(await readZip(path)))
    } catch (e) {
      errors.push({ file: path, message: `Could not read zip: ${(e as Error).message}` })
    }
    return
  }
  if (FONT_EXTS.has(ext) && st.size <= MAX_FONT_BYTES) {
    out.push({ origin: path, filename: basename(path), buffer: readFileSync(path) })
  }
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'font'
  )
}

/** Writes the buffer under fonts/<slug>/, avoiding name clashes. Returns the path relative to fonts/. */
function store(slug: string, filename: string, buffer: Buffer): string {
  const dir = join(fontsPath(), slug)
  mkdirSync(dir, { recursive: true })
  const ext = extname(filename)
  const stem = basename(filename, ext)
  let candidate = filename
  for (let n = 1; existsSync(join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`
  writeFileSync(join(dir, candidate), buffer)
  return `${slug}/${candidate}`
}

function assetKind(filename: string): string {
  const ext = extname(filename).toLowerCase().slice(1)
  return ext === 'otc' ? 'ttc' : ext
}

/** Where imported files came from. Files from GitHub record the repo and the tag or commit. */
export type SourceSpec =
  | { type: 'file' }
  | {
      type: 'github'
      /** Canonical repo URL, also the identity of the source within a family. */
      url: string
      ref: string
      meta: Record<string, unknown>
      /** Fills the family's license when the font doesn't declare one. */
      license?: string | null
      licenseUrl?: string | null
    }

export interface ImportOutcome extends ImportResult {
  /** Families that received styles or sources in this import. */
  familyIds: number[]
}

export async function importPaths(paths: string[]): Promise<ImportResult> {
  const errors: ImportResult['errors'] = []
  const inputs: Input[] = []
  for (const p of paths) await collect(p, inputs, errors)
  const outcome = importInputs(inputs, { type: 'file' })
  outcome.errors.unshift(...errors)
  return outcome
}

/** Parses, dedupes and stores font buffers, attributing them to one source. */
export function importInputs(inputs: Input[], spec: SourceSpec): ImportOutcome {
  const result: ImportOutcome = {
    familiesAdded: 0,
    familiesUpdated: 0,
    stylesAdded: 0,
    skippedDuplicates: 0,
    errors: [],
    familyIds: []
  }

  const db = getDb()
  const added = new Set<number>()
  const updated = new Set<number>()
  const touched = new Set<number>()

  const q = {
    assetBySha: db.prepare('SELECT 1 FROM assets WHERE sha1 = ? LIMIT 1'),
    familyByName: db.prepare('SELECT id FROM families WHERE name = ? COLLATE NOCASE'),
    insertFamily: db.prepare(
      'INSERT INTO families (name, designer, foundry, license, license_url) VALUES (?, ?, ?, ?, ?)'
    ),
    fillFamily: db.prepare(`
      UPDATE families SET
        designer = COALESCE(designer, ?), foundry = COALESCE(foundry, ?),
        license = COALESCE(license, ?), license_url = COALESCE(license_url, ?),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`),
    fileSource: db.prepare("SELECT id FROM sources WHERE family_id = ? AND type = 'file' LIMIT 1"),
    insertSource: db.prepare("INSERT INTO sources (family_id, type, version) VALUES (?, 'file', ?)"),
    githubSource: db.prepare("SELECT id FROM sources WHERE family_id = ? AND type = 'github' AND url = ?"),
    updateGithub: db.prepare(
      "UPDATE sources SET ref = ?, version = ?, meta = ?, last_checked = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ),
    insertGithub: db.prepare(
      `INSERT INTO sources (family_id, type, url, repo_url, ref, version, meta, last_checked)
       VALUES (?, 'github', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ),
    styleByPs: db.prepare('SELECT id FROM styles WHERE family_id = ? AND postscript_name = ?'),
    styleByOrigin: db.prepare(
      'SELECT family_id FROM styles WHERE postscript_name = ? AND origin_family = ? COLLATE NOCASE LIMIT 1'
    ),
    // A style keeps one stored file per format (e.g. TTF, OTF and WOFF2 of the same face).
    styleHasFormat: db.prepare("SELECT 1 FROM assets WHERE style_id = ? AND storage = 'stored' AND kind = ? LIMIT 1"),
    insertStyle: db.prepare(`
      INSERT INTO styles (family_id, postscript_name, full_name, style_name, weight, italic, width,
                          is_variable, axes, features, scripts, glyph_count, version, origin_family)
      VALUES (@familyId, @postscriptName, @fullName, @styleName, @weight, @italic, @width,
              @isVariable, @axes, @features, @scripts, @glyphCount, @version, @originFamily)`),
    insertAsset: db.prepare(`
      INSERT INTO assets (style_id, source_id, kind, storage, path, collection_index, size, sha1)
      VALUES (?, ?, ?, 'stored', ?, ?, ?, ?)`)
  }

  for (const input of inputs) {
    const sha1 = createHash('sha1').update(input.buffer).digest('hex')
    if (q.assetBySha.get(sha1)) {
      result.skippedDuplicates++
      continue
    }

    let styles: ParsedStyle[]
    try {
      styles = parseFontBuffer(input.buffer)
    } catch (e) {
      result.errors.push({ file: input.origin, message: `Not a readable font (${(e as Error).message})` })
      continue
    }
    if (styles.length === 0) {
      result.errors.push({ file: input.origin, message: 'Font has no family or PostScript name' })
      continue
    }

    try {
      db.transaction(() => {
        // A file (even a collection) is stored once, under the first style's family.
        let storedPath: string | null = null

        for (const s of styles) {
          const license = s.license ?? (spec.type === 'github' ? (spec.license ?? null) : null)
          const licenseUrl = s.licenseUrl ?? (spec.type === 'github' ? (spec.licenseUrl ?? null) : null)
          // The same face may already live in another family after a merge: follow it there.
          const merged = q.styleByOrigin.get(s.postscriptName, s.familyName) as { family_id: number } | undefined
          let familyId =
            merged?.family_id ?? (q.familyByName.get(s.familyName) as { id: number } | undefined)?.id
          if (familyId === undefined) {
            familyId = Number(
              q.insertFamily.run(s.familyName, s.designer, s.foundry, license, licenseUrl).lastInsertRowid
            )
            added.add(familyId)
          } else {
            q.fillFamily.run(s.designer, s.foundry, license, licenseUrl, familyId)
            if (!added.has(familyId)) updated.add(familyId)
          }

          const existingStyle = q.styleByPs.get(familyId, s.postscriptName) as { id: number } | undefined
          if (existingStyle && q.styleHasFormat.get(existingStyle.id, assetKind(input.filename))) {
            result.skippedDuplicates++
            continue
          }

          let sourceId: number
          if (spec.type === 'file') {
            sourceId =
              (q.fileSource.get(familyId) as { id: number } | undefined)?.id ??
              Number(q.insertSource.run(familyId, s.version).lastInsertRowid)
          } else {
            // One GitHub source per repo per family; a hand-added reference link becomes the real source.
            const meta = JSON.stringify(spec.meta)
            const existing = q.githubSource.get(familyId, spec.url) as { id: number } | undefined
            if (existing) {
              q.updateGithub.run(spec.ref, s.version, meta, existing.id)
              sourceId = existing.id
            } else {
              sourceId = Number(
                q.insertGithub.run(familyId, spec.url, spec.url, spec.ref, s.version, meta).lastInsertRowid
              )
            }
          }
          touched.add(familyId)

          const styleId =
            existingStyle?.id ??
            Number(
              q.insertStyle.run({
                familyId,
                postscriptName: s.postscriptName,
                fullName: s.fullName,
                styleName: s.styleName,
                weight: s.weight,
                italic: s.italic ? 1 : 0,
                width: s.width,
                isVariable: s.isVariable ? 1 : 0,
                axes: JSON.stringify(s.axes),
                features: JSON.stringify(s.features),
                scripts: JSON.stringify(s.scripts),
                glyphCount: s.glyphCount,
                version: s.version,
                originFamily: s.familyName
              }).lastInsertRowid
            )
          if (!existingStyle) result.stylesAdded++

          storedPath ??= store(slugify(s.familyName), input.filename, input.buffer)
          q.insertAsset.run(
            styleId,
            sourceId,
            assetKind(input.filename),
            storedPath,
            s.collectionIndex,
            input.buffer.length,
            sha1
          )
        }
      })()
    } catch (e) {
      result.errors.push({ file: input.origin, message: (e as Error).message })
    }
  }

  result.familiesAdded = added.size
  result.familiesUpdated = [...updated].filter((id) => !added.has(id)).length
  result.familyIds = [...touched]
  return result
}
