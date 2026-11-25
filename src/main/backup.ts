import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from './db'
import { fontsPath, libraryPath } from './paths'

// Library backup: all metadata as JSON plus the stored font files, so a library survives a
// corrupted database or moves to a new machine. Link-only entries (Google, Adobe) and system
// references are metadata, so they come along; system fonts must exist on the target Mac.

const FORMAT = 'fontlib-backup'
const VERSION = 1

/** Tables in dependency order (parents before children). */
const TABLES = [
  'families',
  'styles',
  'sources',
  'assets',
  'tags',
  'family_tags',
  'pairings',
  'collections',
  'collection_items',
  'settings',
  'adobe_kits'
] as const

interface BackupFile {
  format: string
  version: number
  schema: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`
}

/** Writes "FontLib Backup <date>" inside the chosen folder. Returns its path and a summary. */
export function exportLibrary(parent: string): { path: string; families: number; files: number } {
  const db = getDb()
  const dir = join(parent, `FontLib Backup ${stamp()}`)
  mkdirSync(dir, { recursive: true })
  const tables: BackupFile['tables'] = {}
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]
  const data: BackupFile = {
    format: FORMAT,
    version: VERSION,
    schema: db.pragma('user_version', { simple: true }) as number,
    exportedAt: new Date().toISOString(),
    tables
  }
  writeFileSync(join(dir, 'library.json'), JSON.stringify(data, null, 1))
  if (existsSync(fontsPath())) cpSync(fontsPath(), join(dir, 'fonts'), { recursive: true })
  const files = tables.assets.filter((a) => a.storage === 'stored').length
  return { path: dir, families: tables.families.length, files }
}

/** Reads and checks a backup folder without changing anything. */
export function readBackup(dir: string): BackupFile {
  const file = join(dir, 'library.json')
  if (!existsSync(file)) throw new Error('That folder isn’t a FontLib backup (no library.json inside).')
  const data = JSON.parse(readFileSync(file, 'utf8')) as BackupFile
  if (data.format !== FORMAT || !data.tables) throw new Error('library.json isn’t a FontLib backup.')
  const current = getDb().pragma('user_version', { simple: true }) as number
  if (data.schema > current) throw new Error('This backup was made by a newer version of FontLib. Update the app first.')
  return data
}

/**
 * Replaces the current library with a backup. The current database is saved next to it
 * first (library.db.before-import-<date>.bak). Stored font files are copied in.
 */
export async function importLibrary(dir: string): Promise<{ families: number; safetyCopy: string }> {
  const data = readBackup(dir)
  const db = getDb()
  const safetyCopy = join(libraryPath(), `library.db.before-import-${stamp().replace(' ', '_')}.bak`)
  await db.backup(safetyCopy)

  if (existsSync(join(dir, 'fonts'))) cpSync(join(dir, 'fonts'), fontsPath(), { recursive: true, force: true })

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      for (const t of [...TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run()
      for (const t of TABLES) {
        const rows = data.tables[t] ?? []
        if (rows.length === 0) continue
        // Only columns this version knows; older backups simply leave newer columns at their defaults.
        const known = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name))
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => known.has(c))
          db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
            ...cols.map((c) => row[c] as never)
          )
        }
      }
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
  return { families: (data.tables.families ?? []).length, safetyCopy }
}
