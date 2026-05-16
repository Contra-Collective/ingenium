// SQLite persistence layer.
//
// We use better-sqlite3 because it's synchronous (zero await overhead),
// embedded (no daemon to run), and ships native bindings via npm. Schema
// migrations run unconditionally on boot — `CREATE ... IF NOT EXISTS` is
// idempotent, so this is safe and avoids a separate migration step.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type DB = Database.Database

/** Opens (or creates) the database file, applies migrations, and returns the handle. */
export function openDatabase(file: string): DB {
  // SQLite needs the parent directory to exist. better-sqlite3 will not mkdir for us.
  if (file !== ':memory:') {
    const dir = dirname(file)
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
  }

  const db = new Database(file)
  // WAL gives us concurrent reads with a single writer — appropriate for an
  // HTTP service where multiple requests may run in flight simultaneously.
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  migrate(db)
  return db
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      token       TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);

    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS tags (
      id      TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name    TEXT NOT NULL,
      UNIQUE (user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

    CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id ON note_tags(tag_id);
  `)

  // FTS5 is compiled into the standard sqlite distribution shipped with
  // better-sqlite3. We probe and fall back to LIKE if the build lacks it.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
        USING fts5(title, body, content='notes', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
    `)
  } catch {
    // FTS5 isn't compiled in this build — search will fall back to LIKE.
    // (Standard better-sqlite3 wheels include it; this is a defensive guard.)
  }
}

/** Lightweight feature probe used by the search route. */
export function hasFts5(db: DB): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'`)
    .get()
  return row !== undefined
}

// ───── Prepared statements ────────────────────────────────────────────────
//
// We hold prepared statements per-DB on a WeakMap so callers can `prepared(db)`
// without worrying about lifetime. Statements are reused across requests for
// the lifetime of the process — this is the hot-path optimization that makes
// better-sqlite3 fly.

export interface Prepared {
  // users
  insertUser: Database.Statement<[string, string, string, number]>
  findUserById: Database.Statement<[string]>
  findUserByEmail: Database.Statement<[string]>

  // tokens
  insertToken: Database.Statement<[string, string, number]>
  findUserByToken: Database.Statement<[string]>

  // notes
  insertNote: Database.Statement<[string, string, string, string, number, number]>
  findNoteById: Database.Statement<[string]>
  updateNote: Database.Statement<{ id: string; title: string; body: string; updated_at: number }>
  deleteNote: Database.Statement<[string]>
  listNotesByUser: Database.Statement<[string, number, number]>
  listNotesByUserAndTag: Database.Statement<[string, string, number, number]>

  // tags
  upsertTag: Database.Statement<[string, string, string]>
  findTagByName: Database.Statement<[string, string]>
  attachTag: Database.Statement<[string, string]>
  detachTagsForNote: Database.Statement<[string]>
  listTagsForNote: Database.Statement<[string]>
}

const cache = new WeakMap<DB, Prepared>()

export function prepared(db: DB): Prepared {
  const hit = cache.get(db)
  if (hit) return hit
  const p: Prepared = {
    insertUser: db.prepare(
      `INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)`,
    ),
    findUserById: db.prepare(`SELECT id, email, display_name, created_at FROM users WHERE id = ?`),
    findUserByEmail: db.prepare(
      `SELECT id, email, display_name, created_at FROM users WHERE email = ?`,
    ),

    insertToken: db.prepare(`INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)`),
    findUserByToken: db.prepare(
      `SELECT u.id, u.email, u.display_name, u.created_at
         FROM users u JOIN tokens t ON t.user_id = u.id
        WHERE t.token = ?`,
    ),

    insertNote: db.prepare(
      `INSERT INTO notes (id, user_id, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    findNoteById: db.prepare(
      `SELECT id, user_id, title, body, created_at, updated_at FROM notes WHERE id = ?`,
    ),
    updateNote: db.prepare(
      `UPDATE notes SET title = @title, body = @body, updated_at = @updated_at WHERE id = @id`,
    ),
    deleteNote: db.prepare(`DELETE FROM notes WHERE id = ?`),
    listNotesByUser: db.prepare(
      `SELECT id, user_id, title, body, created_at, updated_at
         FROM notes
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?`,
    ),
    listNotesByUserAndTag: db.prepare(
      `SELECT n.id, n.user_id, n.title, n.body, n.created_at, n.updated_at
         FROM notes n
         JOIN note_tags nt ON nt.note_id = n.id
         JOIN tags t ON t.id = nt.tag_id
        WHERE n.user_id = ? AND t.name = ?
        ORDER BY n.updated_at DESC
        LIMIT ? OFFSET ?`,
    ),

    upsertTag: db.prepare(
      `INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)
       ON CONFLICT(user_id, name) DO NOTHING`,
    ),
    findTagByName: db.prepare(`SELECT id FROM tags WHERE user_id = ? AND name = ?`),
    attachTag: db.prepare(
      `INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
    ),
    detachTagsForNote: db.prepare(`DELETE FROM note_tags WHERE note_id = ?`),
    listTagsForNote: db.prepare(
      `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ? ORDER BY t.name`,
    ),
  }
  cache.set(db, p)
  return p
}
