const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Talks to Turso when TURSO_DATABASE_URL is set (production). Falls back to a plain local file
// using the exact same client library when it isn't — so local development needs no Turso
// account at all, and the code path is byte-for-byte identical either way.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(dataDir, 'nihongo.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Thin wrapper matching the db.prepare(sql).get/all/run(...args) shape the rest of this app
// already used with node:sqlite — so route files only needed 'async'/'await' added, not a
// rewrite of every individual query. Call sites (db.prepare('...').get(x, y)) are unchanged.
function prepare(sql) {
  return {
    async get(...args) {
      const result = await client.execute({ sql, args });
      return result.rows[0]; // undefined if no match, same as the old node:sqlite behavior
    },
    async all(...args) {
      const result = await client.execute({ sql, args });
      return result.rows;
    },
    async run(...args) {
      const result = await client.execute({ sql, args });
      return {
        lastInsertRowid: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
        changes: result.rowsAffected,
      };
    },
  };
}

// For multi-statement scripts (schema setup) with no parameters and no return value.
async function exec(sql) {
  await client.executeMultiple(sql);
}

// Runs multiple statements atomically — replaces the old BEGIN/COMMIT/ROLLBACK pattern.
// statements: [{ sql, args: [...] }, ...]. Returns results in the same order, same
// { lastInsertRowid, changes } shape as .run().
async function batch(statements) {
  const results = await client.batch(statements.map((s) => ({ sql: s.sql, args: s.args || [] })), 'write');
  return results.map((r) => ({
    lastInsertRowid: r.lastInsertRowid !== undefined ? Number(r.lastInsertRowid) : undefined,
    changes: r.rowsAffected,
  }));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  grammar_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(number, user_id)
);

CREATE TABLE IF NOT EXISTS vocabulary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kanji_form TEXT,
  reading TEXT NOT NULL,
  english TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kanji (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  character TEXT NOT NULL,
  reading TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS culture_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grammar_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  meaning_en TEXT NOT NULL,
  explanation TEXT,
  example_jp TEXT,
  example_reading TEXT,
  example_en TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_type TEXT NOT NULL,
  card_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  lesson_id INTEGER NOT NULL,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed_at TEXT,
  UNIQUE(card_type, card_id, mode)
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  lesson_ids TEXT NOT NULL,
  score REAL NOT NULL,
  total INTEGER NOT NULL,
  taken_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_card_id INTEGER NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL,
  quality INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  reviewed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verb_conjugations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vocab_id INTEGER NOT NULL UNIQUE REFERENCES vocabulary(id) ON DELETE CASCADE,
  is_verb INTEGER NOT NULL DEFAULT 0,
  part_of_speech TEXT,
  dictionary_form TEXT,
  dictionary_reading TEXT,
  verb_group TEXT,
  classified_at TEXT DEFAULT (datetime('now'))
);
`;

// Resolves once schema setup finishes. index.js awaits this before accepting any requests,
// so there's no race between "server is listening" and "tables exist yet".
const ready = (async () => {
  await client.executeMultiple('PRAGMA foreign_keys = ON;');
  await client.executeMultiple(SCHEMA);

  // Lightweight migrations for installs created before these columns existed — no-ops if already there.
  try { await client.execute('ALTER TABLE verb_conjugations ADD COLUMN part_of_speech TEXT'); } catch { /* already exists */ }
  try { await client.execute('ALTER TABLE review_cards ADD COLUMN user_id INTEGER'); } catch { /* already exists */ }
  try { await client.execute('ALTER TABLE verb_conjugations ADD COLUMN user_id INTEGER'); } catch { /* already exists */ }
  try { await client.execute('ALTER TABLE quiz_results ADD COLUMN user_id INTEGER'); } catch { /* already exists */ }
  try { await client.execute('ALTER TABLE review_log ADD COLUMN user_id INTEGER'); } catch { /* already exists */ }

  // Pre-multi-user installs have `lessons.number` as GLOBALLY unique, which breaks as soon as a
  // second person needs their own "Lesson 1". SQLite can't alter a UNIQUE constraint in place,
  // so detect the old shape (no user_id column) and rebuild the table, preserving every row's id
  // so foreign keys from vocabulary/kanji/etc. (which reference lesson_id) stay valid.
  const lessonsInfo = await client.execute('PRAGMA table_info(lessons)');
  const hasUserId = lessonsInfo.rows.some((r) => r.name === 'user_id');
  if (!hasUserId) {
    await client.executeMultiple(`
      CREATE TABLE lessons_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number INTEGER NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT,
        grammar_notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(number, user_id)
      );
      INSERT INTO lessons_new (id, number, title, grammar_notes, created_at, user_id)
        SELECT id, number, title, grammar_notes, created_at, NULL FROM lessons;
      DROP TABLE lessons;
      ALTER TABLE lessons_new RENAME TO lessons;
    `);
  }
})();

// For sequential multi-step writes where a later statement needs an earlier statement's
// result (e.g. insert a vocab word, then use its new id to insert review cards) — a plain
// batch() can't do this since all its statements are queued before any of them run. This
// wraps libsql's Transaction object in the same prepare/get/run shape as the main export.
async function beginTransaction() {
  const tx = await client.transaction('write');
  return {
    prepare(sql) {
      return {
        async get(...args) {
          const result = await tx.execute({ sql, args });
          return result.rows[0];
        },
        async all(...args) {
          const result = await tx.execute({ sql, args });
          return result.rows;
        },
        async run(...args) {
          const result = await tx.execute({ sql, args });
          return {
            lastInsertRowid: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
            changes: result.rowsAffected,
          };
        },
      };
    },
    commit: () => tx.commit(),
    rollback: () => tx.rollback(),
  };
}

module.exports = { prepare, exec, batch, beginTransaction, ready };
