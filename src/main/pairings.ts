import type { Pairing, PairingInput } from '@shared/api'
import { getDb } from './db'

// A pairing is a first-class object: two library fonts (heading and body), each with its
// own style and typesetting settings. It can be reopened and added to collections.

interface Row {
  id: number
  name: string
  heading_family_id: number
  heading_style_id: number | null
  body_family_id: number
  body_style_id: number | null
  settings: string
  created_at: string
}

export function listPairings(): Pairing[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM pairings ORDER BY name COLLATE NOCASE').all() as Row[]
  const items = db
    .prepare('SELECT collection_id, pairing_id FROM collection_items WHERE pairing_id IS NOT NULL')
    .all() as { collection_id: number; pairing_id: number }[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    heading: { familyId: r.heading_family_id, styleId: r.heading_style_id },
    body: { familyId: r.body_family_id, styleId: r.body_style_id },
    settings: JSON.parse(r.settings),
    createdAt: r.created_at,
    collectionIds: items.filter((i) => i.pairing_id === r.id).map((i) => i.collection_id)
  }))
}

function validSlot(v: unknown): v is { familyId: number; styleId: number | null } {
  const s = v as { familyId?: unknown; styleId?: unknown }
  return Number.isInteger(s?.familyId) && (s.styleId === null || Number.isInteger(s.styleId))
}

/** Creates a pairing, or updates it when an id is given. Returns its id. */
export function savePairing(input: unknown): number {
  const p = input as PairingInput
  if (!p || typeof p.name !== 'string' || !p.name.trim()) throw new Error('Name the pairing')
  if (!validSlot(p.heading) || !validSlot(p.body)) throw new Error('Invalid pairing')
  const db = getDb()
  const values = [
    p.name.trim().slice(0, 80),
    p.heading.familyId,
    p.heading.styleId,
    p.body.familyId,
    p.body.styleId,
    JSON.stringify(p.settings ?? {})
  ]
  if (Number.isInteger(p.id)) {
    db.prepare(
      `UPDATE pairings SET name = ?, heading_family_id = ?, heading_style_id = ?, body_family_id = ?,
         body_style_id = ?, settings = ? WHERE id = ?`
    ).run(...values, p.id)
    return p.id!
  }
  return Number(
    db
      .prepare(
        `INSERT INTO pairings (name, heading_family_id, heading_style_id, body_family_id, body_style_id, settings)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(...values).lastInsertRowid
  )
}

export function deletePairing(id: number): void {
  getDb().prepare('DELETE FROM pairings WHERE id = ?').run(id)
}

export function addPairingToCollection(collectionId: number, pairingId: number): void {
  const db = getDb()
  if (db.prepare('SELECT 1 FROM collection_items WHERE collection_id = ? AND pairing_id = ?').get(collectionId, pairingId)) return
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM collection_items WHERE collection_id = ?').get(collectionId) as {
    p: number
  }
  db.prepare('INSERT INTO collection_items (collection_id, pairing_id, position) VALUES (?, ?, ?)').run(collectionId, pairingId, max.p + 1)
}

export function removePairingFromCollection(collectionId: number, pairingId: number): void {
  getDb().prepare('DELETE FROM collection_items WHERE collection_id = ? AND pairing_id = ?').run(collectionId, pairingId)
}
