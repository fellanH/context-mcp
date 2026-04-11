import { unlinkSync, copyFileSync, existsSync, openSync, closeSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PreparedStatements } from './types.js';

/**
 * Acquire an exclusive file lock to serialize database initialization.
 * Multiple MCP clients (Claude, Cursor, Windsurf) may each spawn a server
 * instance simultaneously — without serialization, migrations and schema
 * init race against each other.
 *
 * Uses O_EXCL (via 'wx' flag) as a cross-platform advisory lock.
 * Returns a release function that removes the lock file.
 */
function acquireInitLock(dbPath: string, timeoutMs = 10_000): () => void {
  const lockPath = dbPath + '.init-lock';
  mkdirSync(dirname(lockPath), { recursive: true });

  const start = Date.now();
  while (true) {
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return () => {
        try { unlinkSync(lockPath); } catch {}
      };
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;

      // Stale lock detection — if lock file is older than 30s, it's from a crashed process
      try {
        const { mtimeMs } = statSync(lockPath);
        if (Date.now() - mtimeMs > 30_000) {
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch {}

      if (Date.now() - start > timeoutMs) {
        // Timeout — break the lock and proceed (better than hanging forever)
        console.error('[context-vault] Init lock timed out, breaking stale lock');
        try { unlinkSync(lockPath); } catch {}
        continue;
      }

      // Busy-wait with small sleep (synchronous — we're in sync init code)
      const waitMs = 50 + Math.random() * 100;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}

export class NativeModuleError extends Error {
  originalError: Error;
  constructor(originalError: Error) {
    const diagnostic = formatNativeModuleError(originalError);
    super(diagnostic);
    this.name = 'NativeModuleError';
    this.originalError = originalError;
  }
}

function platformFixCommands(): string[] {
  const p = process.platform;
  if (p === 'darwin') {
    return [
      '  Fix options:',
      '    brew reinstall node && npm rebuild sqlite-vec',
      '    nvm install 22 && npm rebuild sqlite-vec',
      '    npx -y context-vault@latest setup',
    ];
  }
  if (p === 'win32') {
    return [
      '  Fix options:',
      '    Verify architecture matches: node -p process.arch  (expect x64)',
      '    winget install OpenJS.NodeJS.LTS && npm rebuild sqlite-vec',
      '    npx -y context-vault@latest setup',
    ];
  }
  // linux and others
  return [
    '  Fix options:',
    '    nvm install 22 && npm rebuild sqlite-vec',
    '    npx -y context-vault@latest setup',
  ];
}

function formatNativeModuleError(err: Error): string {
  const msg = err.message || '';
  return [
    `sqlite-vec extension failed to load: ${msg}`,
    '',
    `  Platform:    ${process.platform}/${process.arch}`,
    `  Node.js:     ${process.version} (${process.execPath})`,
    '',
    '  This means the native binary was compiled for a different',
    '  Node.js version or CPU architecture than the one running.',
    '',
    ...platformFixCommands(),
    '',
    '  Known issues: https://github.com/fellanH/context-vault/issues?q=sqlite-vec',
  ].join('\n');
}

let _sqliteVec: { load: (db: DatabaseSync) => void } | null = null;

async function loadSqliteVec() {
  if (_sqliteVec) return _sqliteVec;
  const vecMod = await import('sqlite-vec');
  _sqliteVec = vecMod;
  return _sqliteVec;
}

function runTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
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
    hit_count       INTEGER DEFAULT 0,
    last_accessed_at TEXT,
    source_files    TEXT,
    tier            TEXT DEFAULT 'working' CHECK(tier IN ('ephemeral', 'working', 'durable')),
    related_to      TEXT,
    indexed         INTEGER DEFAULT 1,
    recall_count    INTEGER DEFAULT 0,
    recall_sessions INTEGER DEFAULT 0,
    last_recalled_at TEXT,
    heat_tier       TEXT CHECK(heat_tier IN ('hot', 'warm', 'cold'))
  );

  CREATE INDEX IF NOT EXISTS idx_vault_kind ON vault(kind);
  CREATE INDEX IF NOT EXISTS idx_vault_category ON vault(category);
  CREATE INDEX IF NOT EXISTS idx_vault_category_created ON vault(category, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_vault_updated ON vault(updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_identity ON vault(kind, identity_key) WHERE identity_key IS NOT NULL AND category = 'entity';
  CREATE INDEX IF NOT EXISTS idx_vault_superseded ON vault(superseded_by) WHERE superseded_by IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_vault_tier ON vault(tier);
  CREATE INDEX IF NOT EXISTS idx_vault_indexed ON vault(indexed);
  CREATE INDEX IF NOT EXISTS idx_vault_heat_tier ON vault(heat_tier) WHERE heat_tier IS NOT NULL;

  CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    title, body, tags, kind,
    content='vault', content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS vault_ai AFTER INSERT ON vault WHEN new.indexed = 1 BEGIN
    INSERT INTO vault_fts(rowid, title, body, tags, kind)
      VALUES (new.rowid, new.title, new.body, new.tags, new.kind);
  END;
  CREATE TRIGGER IF NOT EXISTS vault_ad AFTER DELETE ON vault WHEN old.indexed = 1 BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
  END;
  CREATE TRIGGER IF NOT EXISTS vault_au AFTER UPDATE ON vault WHEN old.indexed = 1 OR new.indexed = 1 BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
    INSERT INTO vault_fts(rowid, title, body, tags, kind)
      SELECT new.rowid, new.title, new.body, new.tags, new.kind WHERE new.indexed = 1;
  END;

  CREATE VIRTUAL TABLE IF NOT EXISTS vault_vec USING vec0(embedding float[384]);

  CREATE VIRTUAL TABLE IF NOT EXISTS vault_ctx_vec USING vec0(embedding float[384]);

  CREATE TABLE IF NOT EXISTS co_retrievals (
    entry_a TEXT NOT NULL,
    entry_b TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    last_at TEXT NOT NULL,
    PRIMARY KEY (entry_a, entry_b)
  );

  CREATE TABLE IF NOT EXISTS access_log (
    id          INTEGER PRIMARY KEY,
    entry_id    TEXT NOT NULL,
    query       TEXT,
    session_id  TEXT,
    session_goal TEXT,
    accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_access_log_entry_at ON access_log(entry_id, accessed_at);
  CREATE INDEX IF NOT EXISTS idx_access_log_goal ON access_log(session_goal) WHERE session_goal IS NOT NULL;
`;

const CURRENT_VERSION = 19;

export async function initDatabase(dbPath: string): Promise<DatabaseSync> {
  const sqliteVec = await loadSqliteVec();

  function createDb(path: string): DatabaseSync {
    const db = new DatabaseSync(path, { allowExtension: true });
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    try {
      sqliteVec.load(db);
    } catch (e) {
      throw new NativeModuleError(e as Error);
    }
    return db;
  }

  // Serialize init across concurrent server instances (Claude + Cursor + Windsurf)
  const releaseLock = acquireInitLock(dbPath);
  try {
    const db = createDb(dbPath);
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;

    // v15 -> v16: add vault_ctx_vec table for contextual reinstatement
    if (version === 15) {
      try {
        db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS vault_ctx_vec USING vec0(embedding float[384])');
        db.exec('PRAGMA user_version = 16');
      } catch (e) {
        console.error(`[context-vault] v15->v16 migration failed: ${(e as Error).message}`);
        return db;
      }
      // Fall through to v16->v17 migration
    }

    // v16 -> v17: add indexed column for selective indexing
    if (version === 16 || version === 15) {
      try {
        db.exec('ALTER TABLE vault ADD COLUMN indexed INTEGER DEFAULT 1');
        db.exec('CREATE INDEX IF NOT EXISTS idx_vault_indexed ON vault(indexed)');
        db.exec('DROP TRIGGER IF EXISTS vault_ai');
        db.exec('DROP TRIGGER IF EXISTS vault_ad');
        db.exec('DROP TRIGGER IF EXISTS vault_au');
        db.exec(`CREATE TRIGGER vault_ai AFTER INSERT ON vault WHEN new.indexed = 1 BEGIN
          INSERT INTO vault_fts(rowid, title, body, tags, kind)
            VALUES (new.rowid, new.title, new.body, new.tags, new.kind);
        END`);
        db.exec(`CREATE TRIGGER vault_ad AFTER DELETE ON vault WHEN old.indexed = 1 BEGIN
          INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
            VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
        END`);
        db.exec(`CREATE TRIGGER vault_au AFTER UPDATE ON vault WHEN old.indexed = 1 OR new.indexed = 1 BEGIN
          INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
            VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
          INSERT INTO vault_fts(rowid, title, body, tags, kind)
            SELECT new.rowid, new.title, new.body, new.tags, new.kind WHERE new.indexed = 1;
        END`);
        db.exec('PRAGMA user_version = 17');
      } catch (e) {
        console.error(`[context-vault] v16->v17 migration failed: ${(e as Error).message}`);
        return db;
      }
      // Fall through to v17->v18 migration
    }

    // v17 -> v18: add recall frequency tracking columns and co_retrievals table
    if (version === 17 || version === 16 || version === 15) {
      try {
        db.exec('ALTER TABLE vault ADD COLUMN recall_count INTEGER DEFAULT 0');
        db.exec('ALTER TABLE vault ADD COLUMN recall_sessions INTEGER DEFAULT 0');
        db.exec('ALTER TABLE vault ADD COLUMN last_recalled_at TEXT');
        db.exec(`CREATE TABLE IF NOT EXISTS co_retrievals (
          entry_a TEXT NOT NULL,
          entry_b TEXT NOT NULL,
          count INTEGER DEFAULT 1,
          last_at TEXT NOT NULL,
          PRIMARY KEY (entry_a, entry_b)
        )`);
        db.exec(`PRAGMA user_version = 18`);
      } catch (e) {
        console.error(`[context-vault] v17->v18 migration failed: ${(e as Error).message}`);
        return db;
      }
      // Fall through to v18->v19 migration
    }

    // v18 -> v19: add access_log table and heat_tier column
    if (version === 18 || version === 17 || version === 16 || version === 15) {
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS access_log (
          id          INTEGER PRIMARY KEY,
          entry_id    TEXT NOT NULL,
          query       TEXT,
          session_id  TEXT,
          session_goal TEXT,
          accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_access_log_entry_at ON access_log(entry_id, accessed_at)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_access_log_goal ON access_log(session_goal) WHERE session_goal IS NOT NULL`);
        db.exec(`ALTER TABLE vault ADD COLUMN heat_tier TEXT CHECK(heat_tier IN ('hot', 'warm', 'cold'))`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_heat_tier ON vault(heat_tier) WHERE heat_tier IS NOT NULL`);
        db.exec(`PRAGMA user_version = ${CURRENT_VERSION}`);
      } catch (e) {
        console.error(`[context-vault] v18->v19 migration failed: ${(e as Error).message}`);
      }
      return db;
    }

    if (version > 0 && version < 15) {
      console.error(`[context-vault] Schema v${version} is outdated. Rebuilding database...`);

      const backupPath = `${dbPath}.v${version}.backup`;
      let backupSucceeded = false;
      try {
        db.close();
        if (existsSync(dbPath)) {
          copyFileSync(dbPath, backupPath);
          console.error(`[context-vault] Backed up old database to: ${backupPath}`);
          backupSucceeded = true;
        } else {
          backupSucceeded = true;
        }
      } catch (backupErr) {
        console.error(
          `[context-vault] Warning: could not backup old database: ${(backupErr as Error).message}`
        );
      }

      if (!backupSucceeded) {
        throw new Error(
          `[context-vault] Aborting schema migration: backup failed for ${dbPath}. ` +
            `Fix the backup issue or manually back up the file before upgrading.`
        );
      }

      unlinkSync(dbPath);
      try {
        unlinkSync(dbPath + '-wal');
      } catch {}
      try {
        unlinkSync(dbPath + '-shm');
      } catch {}

      const freshDb = createDb(dbPath);
      freshDb.exec(SCHEMA_DDL);
      freshDb.exec(`PRAGMA user_version = ${CURRENT_VERSION}`);
      return freshDb;
    }

    if (version < 19) {
      db.exec(SCHEMA_DDL);
      db.exec(`PRAGMA user_version = ${CURRENT_VERSION}`);
    }

    return db;
  } finally {
    releaseLock();
  }
}

export function prepareStatements(db: DatabaseSync): PreparedStatements {
  try {
    return {
      insertEntry: db.prepare(
        `INSERT INTO vault (id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at, updated_at, source_files, tier, indexed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      updateEntry: db.prepare(
        `UPDATE vault SET title = ?, body = ?, meta = ?, tags = ?, source = ?, category = ?, identity_key = ?, expires_at = ?, updated_at = datetime('now') WHERE file_path = ?`
      ),
      deleteEntry: db.prepare(`DELETE FROM vault WHERE id = ?`),
      getRowid: db.prepare(`SELECT rowid FROM vault WHERE id = ?`),
      getRowidByPath: db.prepare(`SELECT rowid FROM vault WHERE file_path = ?`),
      getEntryById: db.prepare(`SELECT * FROM vault WHERE id = ?`),
      getByIdentityKey: db.prepare(`SELECT * FROM vault WHERE kind = ? AND identity_key = ?`),
      upsertByIdentityKey: db.prepare(
        `UPDATE vault SET title = ?, body = ?, meta = ?, tags = ?, source = ?, category = ?, file_path = ?, expires_at = ?, source_files = ?, updated_at = datetime('now') WHERE kind = ? AND identity_key = ?`
      ),
      updateSourceFiles: db.prepare(`UPDATE vault SET source_files = ? WHERE id = ?`),
      updateRelatedTo: db.prepare(`UPDATE vault SET related_to = ? WHERE id = ?`),
      insertVecStmt: db.prepare(`INSERT INTO vault_vec (rowid, embedding) VALUES (?, ?)`),
      deleteVecStmt: db.prepare(`DELETE FROM vault_vec WHERE rowid = ?`),
      updateSupersededBy: db.prepare(`UPDATE vault SET superseded_by = ? WHERE id = ?`),
      clearSupersededByRef: db.prepare(
        `UPDATE vault SET superseded_by = NULL WHERE superseded_by = ?`
      ),
      insertCtxVecStmt: db.prepare(`INSERT INTO vault_ctx_vec (rowid, embedding) VALUES (?, ?)`),
      deleteCtxVecStmt: db.prepare(`DELETE FROM vault_ctx_vec WHERE rowid = ?`),
    };
  } catch (e) {
    throw new Error(
      `Failed to prepare database statements. The database may be corrupted.\n` +
        `Try deleting and rebuilding: context-vault reindex\n` +
        `Original error: ${(e as Error).message}`
    );
  }
}

export function insertVec(stmts: PreparedStatements, rowid: number, embedding: Float32Array): void {
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.insertVecStmt.run(safeRowid, embedding);
}

export function deleteVec(stmts: PreparedStatements, rowid: number): void {
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.deleteVecStmt.run(safeRowid);
}

export function insertCtxVec(stmts: PreparedStatements, rowid: number, embedding: Float32Array): void {
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.insertCtxVecStmt.run(safeRowid, embedding);
}

export function deleteCtxVec(stmts: PreparedStatements, rowid: number): void {
  const safeRowid = BigInt(rowid);
  if (safeRowid < 1n) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.deleteCtxVecStmt.run(safeRowid);
}

export function testConnection(db: DatabaseSync): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
