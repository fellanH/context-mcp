/**
 * db.js — Database schema, initialization, and prepared statements
 */

import { unlinkSync, copyFileSync, existsSync } from "node:fs";

// ─── Native Module Error ────────────────────────────────────────────────────

export class NativeModuleError extends Error {
  constructor(originalError) {
    const diagnostic = formatNativeModuleError(originalError);
    super(diagnostic);
    this.name = "NativeModuleError";
    this.originalError = originalError;
  }
}

function formatNativeModuleError(err) {
  const msg = err.message || "";
  const versionMatch = msg.match(
    /was compiled against a different Node\.js version using\s+NODE_MODULE_VERSION (\d+)\. This version of Node\.js requires\s+NODE_MODULE_VERSION (\d+)/
  );

  const lines = [
    `Native module failed to load: ${msg}`,
    "",
    `  Running Node.js: ${process.version} (${process.execPath})`,
  ];

  if (versionMatch) {
    lines.push(`  Module compiled for: NODE_MODULE_VERSION ${versionMatch[1]}`);
    lines.push(`  Current runtime:     NODE_MODULE_VERSION ${versionMatch[2]}`);
  }

  lines.push(
    "",
    "  Fix: Rebuild native modules for your current Node.js:",
    "    npm rebuild better-sqlite3 sqlite-vec",
    "",
    "  Or reinstall:",
    "    npm install -g context-vault",
  );

  return lines.join("\n");
}

// ─── Lazy Native Module Loading ─────────────────────────────────────────────

let _Database = null;
let _sqliteVec = null;

async function loadNativeModules() {
  if (_Database && _sqliteVec) return { Database: _Database, sqliteVec: _sqliteVec };

  try {
    const dbMod = await import("better-sqlite3");
    _Database = dbMod.default;
  } catch (e) {
    throw new NativeModuleError(e);
  }

  try {
    const vecMod = await import("sqlite-vec");
    _sqliteVec = vecMod;
  } catch (e) {
    throw new NativeModuleError(e);
  }

  return { Database: _Database, sqliteVec: _sqliteVec };
}

// ─── Schema DDL (v7 — teams) ────────────────────────────────────────────────

export const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS vault (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'knowledge',
    title           TEXT,
    body            TEXT NOT NULL,
    meta            TEXT,
    tags            TEXT,
    source          TEXT,
    file_path       TEXT UNIQUE,
    identity_key    TEXT,
    expires_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    user_id         TEXT,
    team_id         TEXT,
    body_encrypted  BLOB,
    title_encrypted BLOB,
    meta_encrypted  BLOB,
    iv              BLOB
  );

  CREATE INDEX IF NOT EXISTS idx_vault_kind ON vault(kind);
  CREATE INDEX IF NOT EXISTS idx_vault_category ON vault(category);
  CREATE INDEX IF NOT EXISTS idx_vault_category_created ON vault(category, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_vault_user ON vault(user_id);
  CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_identity ON vault(user_id, kind, identity_key) WHERE identity_key IS NOT NULL;

  -- Single FTS5 table
  CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    title, body, tags, kind,
    content='vault', content_rowid='rowid'
  );

  -- FTS sync triggers
  CREATE TRIGGER IF NOT EXISTS vault_ai AFTER INSERT ON vault BEGIN
    INSERT INTO vault_fts(rowid, title, body, tags, kind)
      VALUES (new.rowid, new.title, new.body, new.tags, new.kind);
  END;
  CREATE TRIGGER IF NOT EXISTS vault_ad AFTER DELETE ON vault BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
  END;
  CREATE TRIGGER IF NOT EXISTS vault_au AFTER UPDATE ON vault BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
    INSERT INTO vault_fts(rowid, title, body, tags, kind)
      VALUES (new.rowid, new.title, new.body, new.tags, new.kind);
  END;

  -- Single vec table (384-dim float32 for all-MiniLM-L6-v2)
  CREATE VIRTUAL TABLE IF NOT EXISTS vault_vec USING vec0(embedding float[384]);
`;

// ─── Database Init ───────────────────────────────────────────────────────────

export async function initDatabase(dbPath) {
  const { Database, sqliteVec } = await loadNativeModules();

  function createDb(path) {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    try {
      sqliteVec.load(db);
    } catch (e) {
      throw new NativeModuleError(e);
    }
    return db;
  }

  const db = createDb(dbPath);
  const version = db.pragma("user_version", { simple: true });

  // Enforce fresh-DB-only — old schemas get a full rebuild (with backup)
  if (version > 0 && version < 5) {
    console.error(`[context-vault] Schema v${version} is outdated. Rebuilding database...`);

    // Backup old DB before destroying it
    const backupPath = `${dbPath}.v${version}.backup`;
    try {
      db.close();
      if (existsSync(dbPath)) {
        copyFileSync(dbPath, backupPath);
        console.error(`[context-vault] Backed up old database to: ${backupPath}`);
      }
    } catch (backupErr) {
      console.error(`[context-vault] Warning: could not backup old database: ${backupErr.message}`);
    }

    unlinkSync(dbPath);
    try { unlinkSync(dbPath + "-wal"); } catch {}
    try { unlinkSync(dbPath + "-shm"); } catch {}

    const freshDb = createDb(dbPath);
    freshDb.exec(SCHEMA_DDL);
    freshDb.pragma("user_version = 7");
    return freshDb;
  }

  if (version < 5) {
    db.exec(SCHEMA_DDL);
    db.pragma("user_version = 7");
  } else if (version === 5) {
    // v5 -> v6 migration: add multi-tenancy + encryption columns
    // Wrapped in transaction with duplicate-column guards for idempotent retry
    const migrate = db.transaction(() => {
      const addColumnSafe = (sql) => {
        try { db.exec(sql); } catch (e) {
          if (!e.message.includes("duplicate column")) throw e;
        }
      };
      addColumnSafe(`ALTER TABLE vault ADD COLUMN user_id TEXT`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN body_encrypted BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN title_encrypted BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN meta_encrypted BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN iv BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN team_id TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_user ON vault(user_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id)`);
      db.exec(`DROP INDEX IF EXISTS idx_vault_identity`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_identity ON vault(user_id, kind, identity_key) WHERE identity_key IS NOT NULL`);
      db.pragma("user_version = 7");
    });
    migrate();
  } else if (version === 6) {
    // v6 -> v7 migration: add team_id column
    const migrate = db.transaction(() => {
      try { db.exec(`ALTER TABLE vault ADD COLUMN team_id TEXT`); } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id)`);
      db.pragma("user_version = 7");
    });
    migrate();
  }

  return db;
}

// ─── Prepared Statements Factory ─────────────────────────────────────────────

export function prepareStatements(db) {
  try {
    return {
      insertEntry: db.prepare(`INSERT INTO vault (id, user_id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      insertEntryEncrypted: db.prepare(`INSERT INTO vault (id, user_id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at, body_encrypted, title_encrypted, meta_encrypted, iv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateEntry: db.prepare(`UPDATE vault SET title = ?, body = ?, meta = ?, tags = ?, source = ?, category = ?, identity_key = ?, expires_at = ? WHERE file_path = ?`),
      deleteEntry: db.prepare(`DELETE FROM vault WHERE id = ?`),
      getRowid: db.prepare(`SELECT rowid FROM vault WHERE id = ?`),
      getRowidByPath: db.prepare(`SELECT rowid FROM vault WHERE file_path = ?`),
      getEntryById: db.prepare(`SELECT * FROM vault WHERE id = ?`),
      getByIdentityKey: db.prepare(`SELECT * FROM vault WHERE kind = ? AND identity_key = ? AND user_id IS ?`),
      upsertByIdentityKey: db.prepare(`UPDATE vault SET title = ?, body = ?, meta = ?, tags = ?, source = ?, category = ?, file_path = ?, expires_at = ? WHERE kind = ? AND identity_key = ? AND user_id IS ?`),
      insertVecStmt: db.prepare(`INSERT INTO vault_vec (rowid, embedding) VALUES (?, ?)`),
      deleteVecStmt: db.prepare(`DELETE FROM vault_vec WHERE rowid = ?`),
    };
  } catch (e) {
    throw new Error(
      `Failed to prepare database statements. The database may be corrupted.\n` +
      `Try deleting and rebuilding: rm "${db.name}" && context-vault reindex\n` +
      `Original error: ${e.message}`
    );
  }
}

// ─── Vector Helpers (parameterized rowid via cached statements) ──────────────

export function insertVec(stmts, rowid, embedding) {
  // sqlite-vec requires BigInt for primary key — better-sqlite3 binds Number as REAL,
  // but vec0 virtual tables only accept INTEGER rowids
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.insertVecStmt.run(safeRowid, embedding);
}

export function deleteVec(stmts, rowid) {
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.deleteVecStmt.run(safeRowid);
}
