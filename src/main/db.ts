import Database from 'better-sqlite3'
import { join } from 'node:path'
import { libraryPath } from './paths'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(join(libraryPath(), 'library.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

// Each entry upgrades the schema by one version. Never edit a shipped entry; append a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE families (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    designer    TEXT,
    foundry     TEXT,
    category    TEXT,
    notes       TEXT,
    license     TEXT,
    license_url TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE UNIQUE INDEX families_name ON families (name COLLATE NOCASE);

  CREATE TABLE styles (
    id              INTEGER PRIMARY KEY,
    family_id       INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    postscript_name TEXT NOT NULL,
    full_name       TEXT,
    style_name      TEXT,
    weight          INTEGER NOT NULL DEFAULT 400,
    italic          INTEGER NOT NULL DEFAULT 0,
    width           INTEGER NOT NULL DEFAULT 5,
    is_variable     INTEGER NOT NULL DEFAULT 0,
    axes            TEXT NOT NULL DEFAULT '[]',
    features        TEXT NOT NULL DEFAULT '[]',
    scripts         TEXT NOT NULL DEFAULT '[]',
    glyph_count     INTEGER,
    version         TEXT
  );
  CREATE UNIQUE INDEX styles_family_ps ON styles (family_id, postscript_name);

  CREATE TABLE sources (
    id           INTEGER PRIMARY KEY,
    family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    type         TEXT NOT NULL CHECK (type IN ('google','adobe','github','file','system')),
    url          TEXT,
    repo_url     TEXT,
    ref          TEXT,
    version      TEXT,
    meta         TEXT NOT NULL DEFAULT '{}',
    last_checked TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX sources_family ON sources (family_id);

  CREATE TABLE assets (
    id               INTEGER PRIMARY KEY,
    style_id         INTEGER NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
    source_id        INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('ttf','otf','woff','woff2','ttc','variable')),
    storage          TEXT NOT NULL CHECK (storage IN ('stored','system-path','remote')),
    path             TEXT NOT NULL,
    collection_index INTEGER,
    size             INTEGER,
    sha1             TEXT,
    missing          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX assets_style ON assets (style_id);
  CREATE INDEX assets_sha1 ON assets (sha1);

  CREATE TABLE tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE family_tags (
    family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (family_id, tag_id)
  );

  CREATE TABLE pairings (
    id               INTEGER PRIMARY KEY,
    name             TEXT NOT NULL,
    heading_family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    heading_style_id  INTEGER REFERENCES styles(id) ON DELETE SET NULL,
    body_family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    body_style_id     INTEGER REFERENCES styles(id) ON DELETE SET NULL,
    settings         TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'plain' CHECK (kind IN ('plain','project')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE collection_items (
    id            INTEGER PRIMARY KEY,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    family_id     INTEGER REFERENCES families(id) ON DELETE CASCADE,
    pairing_id    INTEGER REFERENCES pairings(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    CHECK ((family_id IS NULL) != (pairing_id IS NULL))
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]

function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
