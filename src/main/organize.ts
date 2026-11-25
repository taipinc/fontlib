import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import type { CollectionKind, CollectionSummary, TagSummary } from '@shared/api'
import { parseSourceLink } from '@shared/links'
import { getDb } from './db'
import { fontsPath } from './paths'

const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('Name must be text')
  const s = name.trim().replace(/\s+/g, ' ')
  if (!s) throw new Error('Name cannot be empty')
  if (s.length > 80) throw new Error('Name is too long')
  return s
}

function ids(v: unknown): number[] {
  if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n))) throw new Error('Invalid ids')
  return v as number[]
}

// Tags

export function listTags(): TagSummary[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, COUNT(ft.family_id) AS count
       FROM tags t LEFT JOIN family_tags ft ON ft.tag_id = t.id
       GROUP BY t.id ORDER BY t.name COLLATE NOCASE`
    )
    .all() as TagSummary[]
}

/** Replaces a family's tags. Creates new tags as needed and drops tags no family uses. */
export function setFamilyTags(familyId: number, names: unknown): void {
  if (!Array.isArray(names)) throw new Error('Invalid tags')
  const clean = [...new Map(names.map((n) => cleanName(n)).map((n) => [n.toLowerCase(), n])).values()]
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM family_tags WHERE family_id = ?').run(familyId)
    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
    const tagId = db.prepare('SELECT id FROM tags WHERE name = ?')
    const link = db.prepare('INSERT OR IGNORE INTO family_tags (family_id, tag_id) VALUES (?, ?)')
    for (const name of clean) {
      insertTag.run(name)
      link.run(familyId, (tagId.get(name) as { id: number }).id)
    }
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM family_tags)').run()
    db.prepare(`UPDATE families SET updated_at = ${now} WHERE id = ?`).run(familyId)
  })()
}

// Categories (a free-text field on the family, organised by hand)

export function setCategory(familyIds: unknown, category: unknown): void {
  const value = category === null ? null : cleanName(category)
  const stmt = getDb().prepare(`UPDATE families SET category = ?, updated_at = ${now} WHERE id = ?`)
  getDb().transaction(() => ids(familyIds).forEach((id) => stmt.run(value, id)))()
}

export function renameCategory(from: unknown, to: unknown): void {
  const value = to === null ? null : cleanName(to)
  getDb()
    .prepare(`UPDATE families SET category = ?, updated_at = ${now} WHERE category = ?`)
    .run(value, cleanName(from))
}

// Collections

export function listCollections(): CollectionSummary[] {
  const db = getDb()
  const cols = db.prepare('SELECT id, name, kind FROM collections ORDER BY name COLLATE NOCASE').all() as {
    id: number
    name: string
    kind: CollectionKind
  }[]
  const items = db
    .prepare(
      'SELECT collection_id, family_id FROM collection_items WHERE family_id IS NOT NULL ORDER BY collection_id, position'
    )
    .all() as { collection_id: number; family_id: number }[]
  return cols.map((c) => ({
    ...c,
    familyIds: items.filter((i) => i.collection_id === c.id).map((i) => i.family_id)
  }))
}

export function createCollection(name: unknown, kind: unknown): number {
  const k: CollectionKind = kind === 'project' ? 'project' : 'plain'
  return Number(getDb().prepare('INSERT INTO collections (name, kind) VALUES (?, ?)').run(cleanName(name), k).lastInsertRowid)
}

export function renameCollection(id: number, name: unknown): void {
  getDb().prepare('UPDATE collections SET name = ? WHERE id = ?').run(cleanName(name), id)
}

export function setCollectionKind(id: number, kind: unknown): void {
  getDb().prepare('UPDATE collections SET kind = ? WHERE id = ?').run(kind === 'project' ? 'project' : 'plain', id)
}

export function deleteCollection(id: number): void {
  getDb().prepare('DELETE FROM collections WHERE id = ?').run(id)
}

export function addToCollection(id: number, familyIds: unknown): void {
  const db = getDb()
  db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM collection_items WHERE collection_id = ? AND family_id = ?')
    const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM collection_items WHERE collection_id = ?')
    const insert = db.prepare('INSERT INTO collection_items (collection_id, family_id, position) VALUES (?, ?, ?)')
    for (const fid of ids(familyIds)) {
      if (exists.get(id, fid)) continue
      insert.run(id, fid, (max.get(id) as { p: number }).p + 1)
    }
  })()
}

export function removeFromCollection(id: number, familyIds: unknown): void {
  const stmt = getDb().prepare('DELETE FROM collection_items WHERE collection_id = ? AND family_id = ?')
  getDb().transaction(() => ids(familyIds).forEach((fid) => stmt.run(id, fid)))()
}

// Families

/** First stored or system file of a family, for "Show in Finder". */
export function familyFilePath(familyId: number): string | null {
  const row = getDb()
    .prepare(
      `SELECT a.storage, a.path FROM assets a JOIN styles s ON s.id = a.style_id
       WHERE s.family_id = ? AND a.storage IN ('stored','system-path') AND a.missing = 0
       ORDER BY a.storage = 'stored' DESC LIMIT 1`
    )
    .get(familyId) as { storage: string; path: string } | undefined
  if (!row) return null
  return row.storage === 'stored' ? resolve(fontsPath(), row.path) : row.path
}

/** Deletes a family and any stored files no other entry still uses. System files are never touched. */
export function removeFamily(familyId: number): void {
  const db = getDb()
  const root = fontsPath()
  const stored = db
    .prepare(
      `SELECT DISTINCT a.path FROM assets a JOIN styles s ON s.id = a.style_id
       WHERE s.family_id = ? AND a.storage = 'stored'`
    )
    .all(familyId) as { path: string }[]

  db.transaction(() => {
    db.prepare('DELETE FROM families WHERE id = ?').run(familyId)
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM family_tags)').run()
  })()

  const stillUsed = db.prepare("SELECT 1 FROM assets WHERE storage = 'stored' AND path = ? LIMIT 1")
  for (const { path } of stored) {
    if (stillUsed.get(path)) continue
    const file = resolve(root, path)
    if (!file.startsWith(root + sep)) continue
    try {
      if (existsSync(file)) unlinkSync(file)
      const dir = dirname(file)
      if (dir !== root && readdirSync(dir).length === 0) rmdirSync(dir)
    } catch {
      /* leave stray files rather than fail the delete */
    }
  }
}

// Batch operations

/** Adds tags to each family, keeping the tags they already have. */
export function addTagsToFamilies(familyIds: unknown, names: unknown): void {
  if (!Array.isArray(names)) throw new Error('Invalid tags')
  const db = getDb()
  const current = db.prepare(
    'SELECT t.name FROM family_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.family_id = ?'
  )
  db.transaction(() => {
    for (const id of ids(familyIds)) {
      const existing = (current.all(id) as { name: string }[]).map((r) => r.name)
      setFamilyTags(id, [...existing, ...names])
    }
  })()
}

export function removeFamilies(familyIds: unknown): void {
  for (const id of ids(familyIds)) removeFamily(id)
}

/**
 * Merges families into one. Styles, sources, tags, collection memberships and pairings
 * move to the target. Styles with the same PostScript name collapse into one style that
 * keeps every file. Stored files are not moved on disk.
 */
export function mergeFamilies(familyIds: unknown, targetId: number, newName: unknown): void {
  const all = ids(familyIds)
  if (!all.includes(targetId)) throw new Error('Target must be one of the merged families')
  const others = all.filter((id) => id !== targetId)
  if (others.length === 0) throw new Error('Select at least two families to merge')
  const db = getDb()

  db.transaction(() => {
    const targetStyle = db.prepare('SELECT id FROM styles WHERE family_id = ? AND postscript_name = ?')
    const targetSource = db.prepare(
      'SELECT id FROM sources WHERE family_id = ? AND type = ? AND COALESCE(url, \'\') = COALESCE(?, \'\')'
    )

    for (const other of others) {
      // Styles
      const styles = db.prepare('SELECT id, postscript_name FROM styles WHERE family_id = ?').all(other) as {
        id: number
        postscript_name: string
      }[]
      for (const s of styles) {
        const match = targetStyle.get(targetId, s.postscript_name) as { id: number } | undefined
        if (match) {
          db.prepare('UPDATE assets SET style_id = ? WHERE style_id = ?').run(match.id, s.id)
          db.prepare('UPDATE pairings SET heading_style_id = ? WHERE heading_style_id = ?').run(match.id, s.id)
          db.prepare('UPDATE pairings SET body_style_id = ? WHERE body_style_id = ?').run(match.id, s.id)
          db.prepare('DELETE FROM styles WHERE id = ?').run(s.id)
        } else {
          db.prepare('UPDATE styles SET family_id = ? WHERE id = ?').run(targetId, s.id)
        }
      }

      // Sources: identical ones (same type and URL) collapse; assets follow.
      const sources = db.prepare('SELECT id, type, url FROM sources WHERE family_id = ?').all(other) as {
        id: number
        type: string
        url: string | null
      }[]
      for (const src of sources) {
        const match = targetSource.get(targetId, src.type, src.url) as { id: number } | undefined
        if (match) {
          db.prepare('UPDATE assets SET source_id = ? WHERE source_id = ?').run(match.id, src.id)
          db.prepare('DELETE FROM sources WHERE id = ?').run(src.id)
        } else {
          db.prepare('UPDATE sources SET family_id = ? WHERE id = ?').run(targetId, src.id)
        }
      }

      // Tags
      db.prepare(
        'INSERT OR IGNORE INTO family_tags (family_id, tag_id) SELECT ?, tag_id FROM family_tags WHERE family_id = ?'
      ).run(targetId, other)

      // Collections: keep the target's position if it is already there.
      db.prepare(
        `DELETE FROM collection_items WHERE family_id = ? AND collection_id IN
           (SELECT collection_id FROM collection_items WHERE family_id = ?)`
      ).run(other, targetId)
      db.prepare('UPDATE collection_items SET family_id = ? WHERE family_id = ?').run(targetId, other)

      // Pairings
      db.prepare('UPDATE pairings SET heading_family_id = ? WHERE heading_family_id = ?').run(targetId, other)
      db.prepare('UPDATE pairings SET body_family_id = ? WHERE body_family_id = ?').run(targetId, other)

      // Fill gaps in the target's metadata.
      db.prepare(
        `UPDATE families SET
           designer = COALESCE(designer, (SELECT designer FROM families WHERE id = @other)),
           foundry = COALESCE(foundry, (SELECT foundry FROM families WHERE id = @other)),
           category = COALESCE(category, (SELECT category FROM families WHERE id = @other)),
           license = COALESCE(license, (SELECT license FROM families WHERE id = @other)),
           license_url = COALESCE(license_url, (SELECT license_url FROM families WHERE id = @other)),
           notes = CASE
             WHEN (SELECT notes FROM families WHERE id = @other) IS NULL THEN notes
             WHEN notes IS NULL THEN (SELECT notes FROM families WHERE id = @other)
             ELSE notes || char(10) || char(10) || (SELECT notes FROM families WHERE id = @other) END
         WHERE id = @target`
      ).run({ other, target: targetId })

      db.prepare('DELETE FROM families WHERE id = ?').run(other)
    }

    if (newName !== null && newName !== undefined) {
      const name = cleanName(newName)
      const clash = db.prepare('SELECT id FROM families WHERE name = ? COLLATE NOCASE AND id != ?').get(name, targetId)
      if (clash) throw new Error(`A family named “${name}” already exists`)
      db.prepare('UPDATE families SET name = ? WHERE id = ?').run(name, targetId)
    }
    db.prepare(`UPDATE families SET updated_at = ${now} WHERE id = ?`).run(targetId)
  })()
}

// Family page edits

const TEXT_FIELDS: Record<string, string> = {
  designer: 'designer',
  foundry: 'foundry',
  notes: 'notes',
  license: 'license',
  licenseUrl: 'license_url'
}

export function updateFamily(familyId: number, patch: unknown): void {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid changes')
  const db = getDb()
  db.transaction(() => {
    for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
      if (key === 'name') {
        const name = cleanName(raw)
        const clash = db.prepare('SELECT 1 FROM families WHERE name = ? COLLATE NOCASE AND id != ?').get(name, familyId)
        if (clash) throw new Error(`A family named “${name}” already exists`)
        db.prepare('UPDATE families SET name = ? WHERE id = ?').run(name, familyId)
      } else if (key in TEXT_FIELDS) {
        if (raw !== null && typeof raw !== 'string') throw new Error(`Invalid ${key}`)
        const value = typeof raw === 'string' && raw.trim() ? (key === 'notes' ? raw : raw.trim()) : null
        db.prepare(`UPDATE families SET ${TEXT_FIELDS[key]} = ? WHERE id = ?`).run(value, familyId)
      }
    }
    db.prepare(`UPDATE families SET updated_at = ${now} WHERE id = ?`).run(familyId)
  })()
}

export function addSourceLink(familyId: number, input: unknown): void {
  if (typeof input !== 'string') throw new Error('Invalid link')
  const link = parseSourceLink(input)
  if ('error' in link) throw new Error(link.error)
  const db = getDb()
  const dupe = db.prepare('SELECT 1 FROM sources WHERE family_id = ? AND type = ? AND url = ?').get(familyId, link.type, link.url)
  if (dupe) throw new Error('This family already has that link')
  const meta =
    link.type === 'google'
      ? { reference: true, family: link.family, slug: link.slug }
      : { reference: true, owner: link.owner, repo: link.repo }
  db.prepare('INSERT INTO sources (family_id, type, url, repo_url, meta) VALUES (?, ?, ?, ?, ?)').run(
    familyId,
    link.type,
    link.url,
    link.type === 'github' ? link.url : null,
    JSON.stringify(meta)
  )
}

export function removeSourceLink(sourceId: number): void {
  const db = getDb()
  const used = db.prepare('SELECT 1 FROM assets WHERE source_id = ? LIMIT 1').get(sourceId)
  if (used) throw new Error('This source supplied font files and can’t be removed on its own')
  db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId)
}

/** Moves one style (and its files) to another family, creating it if a new name is given. */
export function moveStyle(styleId: number, target: unknown): number {
  const db = getDb()
  const style = db.prepare('SELECT id, family_id, postscript_name FROM styles WHERE id = ?').get(styleId) as
    | { id: number; family_id: number; postscript_name: string }
    | undefined
  if (!style) throw new Error('Style not found')
  const t = target as { familyId?: unknown; newName?: unknown }

  return db.transaction(() => {
    let targetId: number
    if (typeof t?.familyId === 'number') {
      targetId = t.familyId
      if (targetId === style.family_id) return targetId
      if (db.prepare('SELECT 1 FROM styles WHERE family_id = ? AND postscript_name = ?').get(targetId, style.postscript_name)) {
        throw new Error('That family already has a style with the same PostScript name')
      }
    } else {
      const name = cleanName(t?.newName)
      if (db.prepare('SELECT 1 FROM families WHERE name = ? COLLATE NOCASE').get(name)) {
        throw new Error(`A family named “${name}” already exists`)
      }
      const from = db.prepare('SELECT designer, foundry, license, license_url FROM families WHERE id = ?').get(style.family_id) as Record<string, string | null>
      targetId = Number(
        db
          .prepare('INSERT INTO families (name, designer, foundry, license, license_url) VALUES (?, ?, ?, ?, ?)')
          .run(name, from.designer, from.foundry, from.license, from.license_url).lastInsertRowid
      )
    }

    // Each asset's source must belong to the target family: reuse a matching one or copy it.
    const assets = db.prepare('SELECT id, source_id FROM assets WHERE style_id = ?').all(styleId) as { id: number; source_id: number }[]
    for (const a of assets) {
      const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(a.source_id) as Record<string, unknown>
      const match = db
        .prepare("SELECT id FROM sources WHERE family_id = ? AND type = ? AND COALESCE(url, '') = COALESCE(?, '')")
        .get(targetId, src.type, src.url) as { id: number } | undefined
      const newSource =
        match?.id ??
        Number(
          db
            .prepare('INSERT INTO sources (family_id, type, url, repo_url, ref, version, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(targetId, src.type, src.url, src.repo_url, src.ref, src.version, src.meta).lastInsertRowid
        )
      db.prepare('UPDATE assets SET source_id = ? WHERE id = ?').run(newSource, a.id)
    }
    db.prepare('UPDATE styles SET family_id = ? WHERE id = ?').run(targetId, styleId)

    // Tidy the old family: drop sources left without files (except hand-added links), and the family if empty.
    db.prepare(
      `DELETE FROM sources WHERE family_id = ? AND json_extract(meta, '$.reference') IS NOT 1
         AND id NOT IN (SELECT source_id FROM assets)`
    ).run(style.family_id)
    const left = db.prepare('SELECT COUNT(*) AS n FROM styles WHERE family_id = ?').get(style.family_id) as { n: number }
    if (left.n === 0) db.prepare('DELETE FROM families WHERE id = ?').run(style.family_id)
    db.prepare(`UPDATE families SET updated_at = ${now} WHERE id IN (?, ?)`).run(style.family_id, targetId)
    return targetId
  })()
}

export function assetFilePath(assetId: number): string | null {
  const row = getDb().prepare('SELECT storage, path FROM assets WHERE id = ?').get(assetId) as
    | { storage: string; path: string }
    | undefined
  if (!row || row.storage === 'remote') return null
  return row.storage === 'stored' ? resolve(fontsPath(), row.path) : row.path
}

/** Saves the family's default style (and axis values for variable fonts) used in previews. */
export function setDefaultStyle(familyId: number, styleId: number, variation: unknown): void {
  const db = getDb()
  const style = db.prepare('SELECT axes FROM styles WHERE id = ? AND family_id = ?').get(styleId, familyId) as
    | { axes: string }
    | undefined
  if (!style) throw new Error('That style is not in this family')
  let value: string | null = null
  if (variation && typeof variation === 'object') {
    const axes = JSON.parse(style.axes) as { tag: string; min: number; max: number }[]
    const clean: Record<string, number> = {}
    for (const a of axes) {
      const v = (variation as Record<string, unknown>)[a.tag]
      if (typeof v === 'number' && Number.isFinite(v)) clean[a.tag] = Math.min(a.max, Math.max(a.min, v))
    }
    if (Object.keys(clean).length) value = JSON.stringify(clean)
  }
  db.prepare(`UPDATE families SET default_style_id = ?, default_variation = ?, updated_at = ${now} WHERE id = ?`).run(
    styleId,
    value,
    familyId
  )
}

/** Renames a tag everywhere. Renaming onto an existing tag merges the two. */
export function renameTag(from: unknown, to: unknown): void {
  const oldName = cleanName(from)
  const newName = cleanName(to)
  const db = getDb()
  db.transaction(() => {
    const old = db.prepare('SELECT id FROM tags WHERE name = ?').get(oldName) as { id: number } | undefined
    if (!old) throw new Error(`No tag named “${oldName}”`)
    const target = db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(newName, old.id) as
      | { id: number }
      | undefined
    if (target) {
      db.prepare('INSERT OR IGNORE INTO family_tags (family_id, tag_id) SELECT family_id, ? FROM family_tags WHERE tag_id = ?').run(
        target.id,
        old.id
      )
      db.prepare('DELETE FROM tags WHERE id = ?').run(old.id)
    } else {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(newName, old.id)
    }
  })()
}

export function deleteTag(name: unknown): void {
  getDb().prepare('DELETE FROM tags WHERE name = ?').run(cleanName(name))
}
