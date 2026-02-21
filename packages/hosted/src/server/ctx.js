/**
 * ctx.js — Constructs the shared context object for the hosted server.
 *
 * With per-user database isolation, the shared ctx is lightweight:
 *   - config: resolved configuration (dataDir, vaultDir defaults)
 *   - embed: shared embedding function (stateless, read-only)
 *
 * Per-user database connections are managed by the UserDbPool (user-db.js)
 * and injected via buildUserCtx() (user-ctx.js).
 *
 * When PER_USER_DB is disabled (legacy mode), falls back to a shared vault.db.
 */

import {
  initDatabase,
  prepareStatements,
  insertVec,
  deleteVec,
} from "@context-vault/core/index/db";
import { embed } from "@context-vault/core/index/embed";
import { resolveConfig } from "@context-vault/core/core/config";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const PER_USER_DB = process.env.PER_USER_DB === "true";

/**
 * Build the shared ctx object used by all tool handlers.
 *
 * In per-user mode: { config, embed } only — no shared db/stmts.
 * In legacy mode: { db, config, stmts, embed, insertVec, deleteVec } (unchanged).
 *
 * @returns {Promise<object>}
 */
export async function createCtx() {
  const config = resolveConfig();

  // Ensure directories exist
  mkdirSync(config.dataDir, { recursive: true });

  if (PER_USER_DB) {
    // Per-user mode: ensure users directory exists, no shared vault.db
    const usersDir = join(config.dataDir, "users");
    mkdirSync(usersDir, { recursive: true });

    // Pre-load native modules so subsequent initDatabase() calls are fast.
    // Uses a throwaway warmup DB that gets deleted immediately.
    const warmupPath = join(config.dataDir, ".warmup.db");
    try {
      await initDatabase(warmupPath);
    } catch {}
    try {
      unlinkSync(warmupPath);
    } catch {}
    try {
      unlinkSync(warmupPath + "-wal");
    } catch {}
    try {
      unlinkSync(warmupPath + "-shm");
    } catch {}

    return { config, embed };
  }

  // Legacy shared-database mode
  mkdirSync(config.vaultDir, { recursive: true });
  config.vaultDirExists = existsSync(config.vaultDir);

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);

  return {
    db,
    config,
    stmts,
    embed,
    insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
    deleteVec: (rowid) => deleteVec(stmts, rowid),
  };
}
