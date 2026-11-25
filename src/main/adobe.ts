import { net } from 'electron'
import type { AdobeKit, AdobeKitFamily, GitHubImportResult } from '@shared/api'
import { parseSourceLink } from '@shared/links'
import { getDb } from './db'

// Adobe Fonts entries are link-only: a web project's CSS (use.typekit.net/<kit>.css) is the
// source. The kit stylesheet lists each family's CSS name, weights and styles; previews load
// through it. Kits are saved so they can be re-synced after changing the project on Adobe.

const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

const WEIGHT_NAMES: Record<number, string> = {
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

function styleName(weight: number, italic: boolean): string {
  const base = WEIGHT_NAMES[weight] ?? String(weight)
  if (!italic) return base
  return base === 'Regular' ? 'Italic' : `${base} Italic`
}

/** "trade-gothic-next-condensed" → "Trade Gothic Next Condensed". Rename in the app if Adobe's is nicer. */
export function displayName(cssName: string): string {
  return cssName
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/** Reads the @font-face rules of a kit stylesheet. */
export function parseKitCss(css: string): { cssName: string; styles: { weight: number; italic: boolean }[] }[] {
  const families = new Map<string, Map<string, { weight: number; italic: boolean }>>()
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const family = /font-family:\s*["']?([^"';]+)["']?/.exec(block)?.[1]?.trim()
    if (!family) continue
    const weightRaw = /font-weight:\s*([^;]+)/.exec(block)?.[1]?.trim() ?? '400'
    const weight = weightRaw === 'bold' ? 700 : weightRaw === 'normal' ? 400 : Number.parseInt(weightRaw, 10) || 400
    const italic = /font-style:\s*(italic|oblique)/.test(block)
    if (!families.has(family)) families.set(family, new Map())
    families.get(family)!.set(`${weight}${italic ? 'i' : ''}`, { weight, italic })
  }
  return [...families].map(([cssName, styles]) => ({
    cssName,
    styles: [...styles.values()].sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight)
  }))
}

async function fetchKit(url: string): Promise<ReturnType<typeof parseKitCss>> {
  let res: Response
  try {
    res = await net.fetch(url, { headers: { 'User-Agent': 'FontLib' } })
  } catch (e) {
    throw new Error(`Couldn’t reach Adobe Fonts (${(e as Error).message}). Are you online?`)
  }
  if (res.status === 404) throw new Error('Adobe doesn’t know this kit. Check the web project link.')
  if (!res.ok) throw new Error(`Adobe Fonts responded ${res.status}`)
  const families = parseKitCss(await res.text())
  if (families.length === 0) throw new Error('This web project has no fonts yet. Add some on fonts.adobe.com, then sync.')
  return families
}

interface KitRow {
  id: number
  kit_id: string
  url: string
  name: string
  families: string
  synced_at: string | null
}

/** Adobe-sourced families in the library, by kit id and CSS name. */
function linkedFamilies(): Map<string, number> {
  const rows = getDb()
    .prepare("SELECT family_id, meta FROM sources WHERE type = 'adobe'")
    .all() as { family_id: number; meta: string }[]
  const out = new Map<string, number>()
  for (const r of rows) {
    const m = JSON.parse(r.meta) as { kitId?: string; family?: string }
    if (m.kitId && m.family) out.set(`${m.kitId}|${m.family}`, r.family_id)
  }
  return out
}

function toKit(row: KitRow, linked = linkedFamilies()): AdobeKit {
  const parsed = JSON.parse(row.families) as ReturnType<typeof parseKitCss>
  const families: AdobeKitFamily[] = parsed.map((f) => ({
    cssName: f.cssName,
    displayName: displayName(f.cssName),
    styleCount: f.styles.length,
    familyId: linked.get(`${row.kit_id}|${f.cssName}`) ?? null
  }))
  return { id: row.id, kitId: row.kit_id, url: row.url, name: row.name, syncedAt: row.synced_at, families }
}

export function listKits(): AdobeKit[] {
  const linked = linkedFamilies()
  return (getDb().prepare('SELECT * FROM adobe_kits ORDER BY name COLLATE NOCASE').all() as KitRow[]).map((r) =>
    toKit(r, linked)
  )
}

/** Reads a kit without saving it (for the Add dialog), or the saved kit refreshed. */
export async function previewKit(input: string): Promise<AdobeKit> {
  const link = parseSourceLink(input)
  if ('error' in link) throw new Error(link.error)
  if (link.type !== 'adobe') throw new Error('Not an Adobe Fonts kit link')
  const families = await fetchKit(link.url)
  const saved = getDb().prepare('SELECT * FROM adobe_kits WHERE kit_id = ?').get(link.kitId) as KitRow | undefined
  const row: KitRow = saved
    ? { ...saved, families: JSON.stringify(families) }
    : { id: 0, kit_id: link.kitId, url: link.url, name: `Kit ${link.kitId}`, families: JSON.stringify(families), synced_at: null }
  return toKit(row)
}

/** Saves the kit (if new) and adds the chosen families. Returns the ids of families touched. */
export async function addFromKit(input: string, cssNames: unknown): Promise<GitHubImportResult> {
  const link = parseSourceLink(input)
  if ('error' in link || link.type !== 'adobe') throw new Error('Not an Adobe Fonts kit link')
  if (!Array.isArray(cssNames) || !cssNames.every((n) => typeof n === 'string')) throw new Error('Invalid selection')
  const families = await fetchKit(link.url)
  const db = getDb()
  db.prepare(
    `INSERT INTO adobe_kits (kit_id, url, name, families, synced_at) VALUES (?, ?, ?, ?, ${now})
     ON CONFLICT(kit_id) DO UPDATE SET families = excluded.families, synced_at = excluded.synced_at`
  ).run(link.kitId, link.url, `Kit ${link.kitId}`, JSON.stringify(families))
  return applyKit(link.kitId, link.url, families, new Set(cssNames as string[]))
}

/** Re-reads a saved kit and updates every family already added from it. */
export async function syncKit(id: number): Promise<GitHubImportResult> {
  const row = getDb().prepare('SELECT * FROM adobe_kits WHERE id = ?').get(id) as KitRow | undefined
  if (!row) throw new Error('Kit not found')
  const families = await fetchKit(row.url)
  getDb().prepare(`UPDATE adobe_kits SET families = ?, synced_at = ${now} WHERE id = ?`).run(JSON.stringify(families), id)
  // Families no longer in the kit: mark their Adobe previews missing (never delete).
  const present = new Set(families.map((f) => f.cssName))
  const sources = getDb()
    .prepare("SELECT id, meta FROM sources WHERE type = 'adobe'")
    .all() as { id: number; meta: string }[]
  for (const s of sources) {
    const m = JSON.parse(s.meta) as { kitId?: string; family?: string }
    if (m.kitId === row.kit_id && m.family && !present.has(m.family)) {
      getDb().prepare('UPDATE assets SET missing = 1 WHERE source_id = ?').run(s.id)
    }
  }
  const linked = linkedFamilies()
  const already = new Set(families.filter((f) => linked.has(`${row.kit_id}|${f.cssName}`)).map((f) => f.cssName))
  return applyKit(row.kit_id, row.url, families, already)
}

function applyKit(
  kitId: string,
  url: string,
  families: ReturnType<typeof parseKitCss>,
  wanted: Set<string>
): GitHubImportResult {
  const db = getDb()
  const result: GitHubImportResult = { familiesAdded: 0, familiesUpdated: 0, stylesAdded: 0, skippedDuplicates: 0, errors: [], familyIds: [] }
  const linked = linkedFamilies()

  db.transaction(() => {
    for (const fam of families.filter((f) => wanted.has(f.cssName))) {
      const meta = JSON.stringify({ kitId, family: fam.cssName })
      let familyId = linked.get(`${kitId}|${fam.cssName}`)
      let sourceId: number
      if (familyId !== undefined) {
        sourceId = (
          db.prepare("SELECT id FROM sources WHERE family_id = ? AND type = 'adobe' AND url = ?").get(familyId, url) as { id: number }
        ).id
        db.prepare(`UPDATE sources SET meta = ?, last_checked = ${now} WHERE id = ?`).run(meta, sourceId)
        result.familiesUpdated++
      } else {
        const name = displayName(fam.cssName)
        familyId =
          (db.prepare('SELECT id FROM families WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined)?.id ??
          Number(db.prepare('INSERT INTO families (name, license) VALUES (?, ?)').run(name, 'Adobe Fonts license').lastInsertRowid)
        sourceId = Number(
          db
            .prepare(`INSERT INTO sources (family_id, type, url, meta, last_checked) VALUES (?, 'adobe', ?, ?, ${now})`)
            .run(familyId, url, meta).lastInsertRowid
        )
        result.familiesAdded++
      }
      result.familyIds.push(familyId)

      // One style per weight/style in the kit; styles dropped from the kit are marked missing.
      const present = new Set<number>()
      for (const st of fam.styles) {
        const ps = `${fam.cssName}-${st.weight}${st.italic ? 'i' : ''}`
        let styleId = (db.prepare('SELECT id FROM styles WHERE family_id = ? AND postscript_name = ?').get(familyId, ps) as
          | { id: number }
          | undefined)?.id
        if (styleId === undefined) {
          styleId = Number(
            db
              .prepare(
                'INSERT INTO styles (family_id, postscript_name, style_name, weight, italic, origin_family) VALUES (?, ?, ?, ?, ?, ?)'
              )
              .run(familyId, ps, styleName(st.weight, st.italic), st.weight, st.italic ? 1 : 0, displayName(fam.cssName)).lastInsertRowid
          )
          result.stylesAdded++
        }
        const asset = db.prepare('SELECT id FROM assets WHERE style_id = ? AND source_id = ?').get(styleId, sourceId) as
          | { id: number }
          | undefined
        if (asset) db.prepare('UPDATE assets SET missing = 0, path = ? WHERE id = ?').run(url, asset.id)
        else
          db.prepare("INSERT INTO assets (style_id, source_id, kind, storage, path) VALUES (?, ?, 'woff2', 'remote', ?)").run(
            styleId,
            sourceId,
            url
          )
        present.add(styleId)
      }
      const all = db.prepare('SELECT id, style_id FROM assets WHERE source_id = ?').all(sourceId) as { id: number; style_id: number }[]
      for (const a of all) if (!present.has(a.style_id)) db.prepare('UPDATE assets SET missing = 1 WHERE id = ?').run(a.id)
    }
  })()
  return result
}

export function renameKit(id: number, name: unknown): void {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Name cannot be empty')
  getDb().prepare('UPDATE adobe_kits SET name = ? WHERE id = ?').run(name.trim().slice(0, 80), id)
}

/** Forgets a kit. Its Adobe sources go too; families left with nothing else are removed. */
export function removeKit(id: number): void {
  const db = getDb()
  const row = db.prepare('SELECT kit_id, url FROM adobe_kits WHERE id = ?').get(id) as { kit_id: string; url: string } | undefined
  if (!row) return
  db.transaction(() => {
    const families = (
      db.prepare("SELECT DISTINCT family_id FROM sources WHERE type = 'adobe' AND url = ?").all(row.url) as { family_id: number }[]
    ).map((r) => r.family_id)
    db.prepare("DELETE FROM assets WHERE source_id IN (SELECT id FROM sources WHERE type = 'adobe' AND url = ?)").run(row.url)
    db.prepare("DELETE FROM sources WHERE type = 'adobe' AND url = ?").run(row.url)
    for (const fid of families) {
      db.prepare('DELETE FROM styles WHERE family_id = ? AND id NOT IN (SELECT style_id FROM assets)').run(fid)
      const left = db.prepare('SELECT COUNT(*) AS n FROM sources WHERE family_id = ?').get(fid) as { n: number }
      if (left.n === 0) db.prepare('DELETE FROM families WHERE id = ?').run(fid)
    }
    db.prepare('DELETE FROM adobe_kits WHERE id = ?').run(id)
  })()
}
