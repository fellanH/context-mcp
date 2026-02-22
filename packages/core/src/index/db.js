import { unlinkSync, copyFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

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
  return [
    `sqlite-vec extension failed to load: ${msg}`,
    "",
    `  Running Node.js: ${process.version} (${process.execPath})`,
    "",
    "  Fix: Reinstall context-vault:",
    "    npx -y context-vault@latest setup",
  ].join("\n");
}

let _sqliteVec = null;

async function loadSqliteVec() {
  if (_sqliteVec) return _sqliteVec;
  const vecMod = await import("sqlite-vec");
  _sqliteVec = vecMod;
  return _sqliteVec;
}

function runTransaction(db, fn) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

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
    superseded_by   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT,
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
  CREATE INDEX IF NOT EXISTS idx_vault_updated ON vault(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_vault_user ON vault(user_id);
  CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_identity ON vault(user_id, kind, identity_key) WHERE identity_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_vault_superseded ON vault(superseded_by) WHERE superseded_by IS NOT NULL;

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

export async function initDatabase(dbPath) {
  const sqliteVec = await loadSqliteVec();

  function createDb(path) {
    const db = new DatabaseSync(path, { allowExtension: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      sqliteVec.load(db);
    } catch (e) {
      throw new NativeModuleError(e);
    }
    return db;
  }

  const db = createDb(dbPath);
  const version = db.prepare("PRAGMA user_version").get().user_version;

  // Enforce fresh-DB-only — old schemas get a full rebuild (with backup)
  if (version > 0 && version < 5) {
    console.error(
      `[context-vault] Schema v${version} is outdated. Rebuilding database...`,
    );

    // Backup old DB before destroying it
    const backupPath = `${dbPath}.v${version}.backup`;
    try {
      db.close();
      if (existsSync(dbPath)) {
        copyFileSync(dbPath, backupPath);
        console.error(
          `[context-vault] Backed up old database to: ${backupPath}`,
        );
      }
    } catch (backupErr) {
      console.error(
        `[context-vault] Warning: could not backup old database: ${backupErr.message}`,
      );
    }

    unlinkSync(dbPath);
    try {
      unlinkSync(dbPath + "-wal");
    } catch {}
    try {
      unlinkSync(dbPath + "-shm");
    } catch {}

    const freshDb = createDb(dbPath);
    freshDb.exec(SCHEMA_DDL);
    freshDb.exec("PRAGMA user_version = 9");
    return freshDb;
  }

  if (version < 5) {
    db.exec(SCHEMA_DDL);
    db.exec("PRAGMA user_version = 9");
  } else if (version === 5) {
    // v5 -> v6 migration: add multi-tenancy + encryption columns
    // Wrapped in transaction with duplicate-column guards for idempotent retry
    runTransaction(db, () => {
      const addColumnSafe = (sql) => {
        try {
          db.exec(sql);
        } catch (e) {
          if (!e.message.includes("duplicate column")) throw e;
        }
      };
      addColumnSafe(`ALTER TABLE vault ADD COLUMN user_id TEXT`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN body_encrypted BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN title_encrypted BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN meta_encrypted BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN iv BLOB`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN team_id TEXT`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN updated_at TEXT`);
      addColumnSafe(`ALTER TABLE vault ADD COLUMN superseded_by TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_user ON vault(user_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id)`);
      db.exec(`DROP INDEX IF EXISTS idx_vault_identity`);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_identity ON vault(user_id, kind, identity_key) WHERE identity_key IS NOT NULL`,
      );
      db.exec(
        `UPDATE vault SET updated_at = created_at WHERE updated_at IS NULL`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vault_updated ON vault(updated_at DESC)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vault_superseded ON vault(superseded_by) WHERE superseded_by IS NOT NULL`,
      );
      db.exec("PRAGMA user_version = 9");
    });
  } else if (version === 6) {
    // v6 -> v7+v8+v9 migration: add team_id, updated_at, superseded_by columns
    runTransaction(db, () => {
      try {
        db.exec(`ALTER TABLE vault ADD COLUMN team_id TEXT`);
      } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
      try {
        db.exec(`ALTER TABLE vault ADD COLUMN updated_at TEXT`);
      } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
      try {
        db.exec(`ALTER TABLE vault ADD COLUMN superseded_by TEXT`);
      } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id)`);
      db.exec(
        `UPDATE vault SET updated_at = created_at WHERE updated_at IS NULL`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vault_updated ON vault(updated_at DESC)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vault_superseded ON vault(superseded_by) WHERE superseded_by IS NOT NULL`,
      );
      db.exec("PRAGMA user_version = 9");
    });
  } else if (version === 7) {
    // v7 -> v8+v9 migration: add updated_at, superseded_by columns
    runTransaction(db, () => {
      try {
        db.exec(`ALTER TABLE vault ADD COLUMN updated_at TEXT`);
      } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
      try {
        db.exec(`ALTER TABLE vault ADD COLUMN superseded_by TEXT`);
      } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
      db.exec(
        `UPDATE vault SET updated_at = created_at WHERE updated_at IS NULL`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vault_updated ON vault(updated_at DESC)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vault_superseded ON vault(superseded_by) WHERE superseded_by IS NOT NULL`,
      );
      db.exec("PRAGMA user_version = 9");
    });
  } else if (version === 8) {
    // v8 -> v9 migration: add superseded_by column
    runTransaction(db, () => {
      try {
        db.exec(`ALTER TABLE vault ADD COLUMN superseded_by TEXT`);
      } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vault_superseded ON vault(superseded_by) WHERE superseded_by IS NOT NULL`,
      );
      db.exec("PRAGMA user_version = 9");
    });
  }

  return db;
}

export function prepareStatements(db) {
  try {
    return {
      insertEntry: db.prepare(
        `INSERT INTO vault (id, user_id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertEntryEncrypted: db.prepare(
        `INSERT INTO vault (id, user_id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at, updated_at, body_encrypted, title_encrypted, meta_encrypted, iv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      updateEntry: db.prepare(
        `UPDATE vault SET title = ?, body = ?, meta = ?, tags = ?, source = ?, category = ?, identity_key = ?, expires_at = ?, updated_at = datetime('now') WHERE file_path = ?`,
      ),
      deleteEntry: db.prepare(`DELETE FROM vault WHERE id = ?`),
      getRowid: db.prepare(`SELECT rowid FROM vault WHERE id = ?`),
      getRowidByPath: db.prepare(`SELECT rowid FROM vault WHERE file_path = ?`),
      getEntryById: db.prepare(`SELECT * FROM vault WHERE id = ?`),
      getByIdentityKey: db.prepare(
        `SELECT * FROM vault WHERE kind = ? AND identity_key = ? AND user_id IS ?`,
      ),
      upsertByIdentityKey: db.prepare(
        `UPDATE vault SET title = ?, body = ?, meta = ?, tags = ?, source = ?, category = ?, file_path = ?, expires_at = ?, updated_at = datetime('now') WHERE kind = ? AND identity_key = ? AND user_id IS ?`,
      ),
      insertVecStmt: db.prepare(
        `INSERT INTO vault_vec (rowid, embedding) VALUES (?, ?)`,
      ),
      deleteVecStmt: db.prepare(`DELETE FROM vault_vec WHERE rowid = ?`),
      updateSupersededBy: db.prepare(
        `UPDATE vault SET superseded_by = ? WHERE id = ?`,
      ),
      clearSupersededByRef: db.prepare(
        `UPDATE vault SET superseded_by = NULL WHERE superseded_by = ?`,
      ),
    };
  } catch (e) {
    throw new Error(
      `Failed to prepare database statements. The database may be corrupted.\n` +
        `Try deleting and rebuilding: context-vault reindex\n` +
        `Original error: ${e.message}`,
    );
  }
}

export function insertVec(stmts, rowid, embedding) {
  // sqlite-vec requires BigInt for primary key — node:sqlite may bind Number as REAL
  // for vec0 virtual tables which only accept INTEGER rowids
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.insertVecStmt.run(safeRowid, embedding);
}

export function deleteVec(stmts, rowid) {
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.deleteVecStmt.run(safeRowid);
}
