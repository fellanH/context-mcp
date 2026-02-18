/**
 * db.js — Database schema, initialization, and prepared statements
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { unlinkSync } from "node:fs";

// ─── Schema DDL (v4 — vault table) ──────────────────────────────────────────

export const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS vault (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    title      TEXT,
    body       TEXT NOT NULL,
    meta       TEXT,
    tags       TEXT,
    source     TEXT,
    file_path  TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vault_kind ON vault(kind);
  CREATE INDEX IF NOT EXISTS idx_vault_kind_created ON vault(kind, created_at DESC);

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

export function initDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  try {
    sqliteVec.load(db);
  } catch (e) {
    console.error(`[context-mcp] Failed to load sqlite-vec native module.`);
    console.error(`[context-mcp] This usually means prebuilt binaries aren't available for your platform.`);
    console.error(`[context-mcp] Try: npm rebuild sqlite-vec`);
    console.error(`[context-mcp] Error: ${e.message}`);
    throw e;
  }

  const version = db.pragma("user_version", { simple: true });

  // P6: Enforce fresh-DB-only — old schemas get a full rebuild
  if (version > 0 && version < 4) {
    console.error(`[context-mcp] Schema v${version} is outdated. Rebuilding database...`);
    db.close();
    unlinkSync(dbPath);
    const freshDb = new Database(dbPath);
    freshDb.pragma("journal_mode = WAL");
    freshDb.pragma("foreign_keys = ON");
    try {
      sqliteVec.load(freshDb);
    } catch (e) {
      console.error(`[context-mcp] Failed to load sqlite-vec native module.`);
      console.error(`[context-mcp] This usually means prebuilt binaries aren't available for your platform.`);
      console.error(`[context-mcp] Try: npm rebuild sqlite-vec`);
      console.error(`[context-mcp] Error: ${e.message}`);
      throw e;
    }
    freshDb.exec(SCHEMA_DDL);
    freshDb.pragma("user_version = 4");
    return freshDb;
  }

  if (version < 4) {
    db.exec(SCHEMA_DDL);
    db.pragma("user_version = 4");
  }

  return db;
}

// ─── Prepared Statements Factory ─────────────────────────────────────────────

export function prepareStatements(db) {
  return {
    insertEntry: db.prepare(`INSERT INTO vault (id, kind, title, body, meta, tags, source, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateEntry: db.prepare(`UPDATE vault SET title = ?, body = ?, meta = ?, tags = ?, source = ? WHERE file_path = ?`),
    deleteEntry: db.prepare(`DELETE FROM vault WHERE id = ?`),
    getRowid: db.prepare(`SELECT rowid FROM vault WHERE id = ?`),
    insertVecStmt: db.prepare(`INSERT INTO vault_vec (rowid, embedding) VALUES (?, ?)`),
    deleteVecStmt: db.prepare(`DELETE FROM vault_vec WHERE rowid = ?`),
  };
}

// ─── Vector Helpers (parameterized rowid via cached statements) ──────────────

export function insertVec(stmts, rowid, embedding) {
  const safeRowid = Number(rowid);
  if (!Number.isFinite(safeRowid) || safeRowid < 0) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.insertVecStmt.run(safeRowid, embedding);
}

export function deleteVec(stmts, rowid) {
  const safeRowid = Number(rowid);
  if (!Number.isFinite(safeRowid) || safeRowid < 0) throw new Error(`Invalid rowid: ${rowid}`);
  stmts.deleteVecStmt.run(safeRowid);
}
