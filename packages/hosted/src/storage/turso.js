// libSQL adapter for per-user databases. Async API (vs better-sqlite3 sync).
// No sqlite-vec — embeddings are handled separately. Schema mirrors local vault v5.

import { createClient } from "@libsql/client";

// Schema for Turso user vaults — same as local v5 but without sqlite-vec
// and with encrypted columns added
const TURSO_SCHEMA = `
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
    body_encrypted  BLOB,
    title_encrypted BLOB,
    meta_encrypted  BLOB,
    iv              BLOB,
    version         INTEGER DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_vault_kind ON vault(kind);
  CREATE INDEX IF NOT EXISTS idx_vault_category ON vault(category);
  CREATE INDEX IF NOT EXISTS idx_vault_category_created ON vault(category, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_identity ON vault(kind, identity_key) WHERE identity_key IS NOT NULL;

  CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    title, body, tags, kind,
    content='vault', content_rowid='rowid'
  );

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
`;

/**
 * Create a libSQL client for a user's vault.
 *
 * @param {string} url - Turso database URL or local file path (file:///path/to/db)
 * @param {string} [authToken] - Turso auth token (for remote DBs)
 * @returns {import("@libsql/client").Client}
 */
export function createTursoClient(url, authToken) {
  const client = createClient({
    url,
    authToken,
  });
  return client;
}

/**
 * Initialize the Turso vault schema.
 *
 * @param {import("@libsql/client").Client} client
 */
export async function initTursoSchema(client) {
  // libSQL executeMultiple handles multi-statement SQL
  await client.executeMultiple(TURSO_SCHEMA);
}

/**
 * Create a ctx-compatible adapter that wraps a libSQL client
 * to match the interface expected by registerTools.
 *
 * This adapter converts the synchronous better-sqlite3 interface
 * used by core into async libSQL calls.
 *
 * NOTE: This is a compatibility shim. The core tools use ctx.db.prepare().all()
 * etc. (synchronous), but libSQL is async. For the hosted mode, we use the
 * local better-sqlite3 ctx (from createCtx) for now and will migrate
 * to full async Turso when we refactor core for async DB operations.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {object} A partial ctx.db-like interface
 */
export function createTursoAdapter(client) {
  return {
    client,

    /**
     * Execute a single SQL statement and return all rows.
     */
    async query(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows;
    },

    /**
     * Execute a single SQL statement and return the first row.
     */
    async queryOne(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows[0] || null;
    },

    /**
     * Execute a write statement (INSERT/UPDATE/DELETE).
     */
    async execute(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return {
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      };
    },

    /**
     * Execute multiple statements in a batch (transaction-like).
     */
    async batch(statements) {
      return client.batch(
        statements.map((s) => ({ sql: s.sql, args: s.params || [] })),
        "write",
      );
    },

    /** Close the client connection. */
    close() {
      client.close();
    },
  };
}

export { TURSO_SCHEMA };
