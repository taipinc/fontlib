import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import type { CollectionKind, CollectionSummary, TagSummary } from '@shared/api'
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
