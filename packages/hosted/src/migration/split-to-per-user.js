#!/usr/bin/env node

/**
 * split-to-per-user.js — One-time migration from shared vault.db to per-user databases.
 *
 * Usage:
 *   node packages/hosted/src/migration/split-to-per-user.js [--data-dir /data] [--dry-run]
 *
 * What it does:
 *   1. Opens the shared vault.db, queries distinct user_id values
 *   2. For each user:
 *      - Creates /data/users/{userId}/ + /data/users/{userId}/vault/
 *      - Initializes a fresh per-user vault.db
 *      - Copies vault rows (INSERT INTO per-user DB from shared DB)
 *      - Copies .md files from shared vault dir to per-user vault dir
 *      - Updates file_path column to new locations
 *      - Rebuilds FTS + embeddings via reindex
 *   3. Renames shared vault.db → vault.db.pre-migration
 *   4. Renames shared vault/ → vault.pre-migration/
 *
 * The migration is idempotent — running it again skips users whose directories already exist.
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve, relative, basename, dirname } from "node:path";
import {
  initDatabase,
  prepareStatements,
  insertVec,
  deleteVec,
} from "@context-vault/core/index/db";
import { reindex } from "@context-vault/core/index/reindex";
import { embed } from "@context-vault/core/index/embed";

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const dataDir = resolve(
  args.find((_, i) => args[i - 1] === "--data-dir") ||
    process.env.CONTEXT_VAULT_DATA_DIR ||
    process.env.CONTEXT_MCP_DATA_DIR ||
    "/data",
);

const sharedDbPath = join(dataDir, "vault.db");
const sharedVaultDir = join(dataDir, "vault");
const usersDir = join(dataDir, "users");

function log(msg) {
  console.log(`[migration] ${msg}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log(`Data dir: ${dataDir}`);
  log(`Shared DB: ${sharedDbPath}`);
  log(`Shared vault: ${sharedVaultDir}`);
  log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  log("");

  // Verify shared DB exists
  if (!existsSync(sharedDbPath)) {
    log("ERROR: Shared vault.db not found. Nothing to migrate.");
    process.exit(1);
  }

  // Open shared database (read-only for safety)
  const Database = (await import("better-sqlite3")).default;
  const sharedDb = new Database(sharedDbPath, { readonly: true });

  // Get distinct users
  const users = sharedDb
    .prepare("SELECT DISTINCT user_id FROM vault WHERE user_id IS NOT NULL")
    .all();
  log(`Found ${users.length} users to migrate`);

  // Also count entries without user_id (orphans)
  const orphanCount = sharedDb
    .prepare("SELECT COUNT(*) as c FROM vault WHERE user_id IS NULL")
    .get().c;
  if (orphanCount > 0) {
    log(
      `WARNING: ${orphanCount} entries have no user_id — these will NOT be migrated`,
    );
  }

  if (!DRY_RUN) {
    mkdirSync(usersDir, { recursive: true });
  }

  let totalMigrated = 0;
  let totalFailed = 0;

  for (const { user_id: userId } of users) {
    log(`\n── Migrating user: ${userId}`);

    const userDir = join(usersDir, userId);
    const userVaultDir = join(userDir, "vault");
    const userDbPath = join(userDir, "vault.db");

    // Skip if already migrated
    if (existsSync(userDbPath)) {
      log(`  SKIP: ${userDbPath} already exists`);
      continue;
    }

    // Count entries for this user
    const entryCount = sharedDb
      .prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ?")
      .get(userId).c;
    log(`  Entries: ${entryCount}`);

    if (DRY_RUN) {
      log(
        `  DRY RUN: would create ${userDir} and migrate ${entryCount} entries`,
      );
      totalMigrated += entryCount;
      continue;
    }

    // Create directories
    mkdirSync(userDir, { recursive: true });
    mkdirSync(userVaultDir, { recursive: true });

    // Initialize per-user database
    const userDb = await initDatabase(userDbPath);
    const userStmts = prepareStatements(userDb);

    // Copy entries from shared DB to per-user DB
    const entries = sharedDb
      .prepare("SELECT * FROM vault WHERE user_id = ?")
      .all(userId);

    const insertTxn = userDb.transaction((rows) => {
      for (const row of rows) {
        let newFilePath = row.file_path;

        // Copy .md file to per-user vault dir if it exists
        if (row.file_path && existsSync(row.file_path)) {
          const relPath = relative(sharedVaultDir, row.file_path);
          newFilePath = join(userVaultDir, relPath);

          // Create subdirectories
          mkdirSync(dirname(newFilePath), { recursive: true });
          copyFileSync(row.file_path, newFilePath);
        }

        // Insert into per-user DB
        if (row.body_encrypted) {
          userStmts.insertEntryEncrypted.run(
            row.id,
            row.user_id,
            row.kind,
            row.category,
            row.title,
            row.body,
            row.meta,
            row.tags,
            row.source,
            newFilePath,
            row.identity_key,
            row.expires_at,
            row.created_at,
            row.body_encrypted,
            row.title_encrypted,
            row.meta_encrypted,
            row.iv,
          );
        } else {
          userStmts.insertEntry.run(
            row.id,
            row.user_id,
            row.kind,
            row.category,
            row.title,
            row.body,
            row.meta,
            row.tags,
            row.source,
            newFilePath,
            row.identity_key,
            row.expires_at,
            row.created_at,
          );
        }
      }
    });

    try {
      insertTxn(entries);
      log(`  Copied ${entries.length} entries to per-user DB`);
      totalMigrated += entries.length;
    } catch (err) {
      log(`  ERROR copying entries: ${err.message}`);
      totalFailed += entries.length;
      userDb.close();
      continue;
    }

    // Rebuild FTS + embeddings
    try {
      const userCtx = {
        db: userDb,
        stmts: userStmts,
        embed,
        config: { vaultDir: userVaultDir, dbPath: userDbPath },
        insertVec: (rowid, embedding) => insertVec(userStmts, rowid, embedding),
        deleteVec: (rowid) => deleteVec(userStmts, rowid),
      };
      await reindex(userCtx);
      log(`  Reindexed FTS + embeddings`);
    } catch (err) {
      log(`  WARNING: Reindex failed (entries still intact): ${err.message}`);
    }

    // WAL checkpoint and close
    try {
      userDb.pragma("wal_checkpoint(TRUNCATE)");
    } catch {}
    userDb.close();

    log(`  Done: ${userDir}`);
  }

  sharedDb.close();

  // Rename shared DB and vault dir (only if we migrated everything)
  if (!DRY_RUN && totalFailed === 0 && users.length > 0) {
    const preDbPath = sharedDbPath + ".pre-migration";
    const preVaultDir = sharedVaultDir + ".pre-migration";

    if (!existsSync(preDbPath)) {
      renameSync(sharedDbPath, preDbPath);
      log(`\nRenamed vault.db → vault.db.pre-migration`);
      // Also rename WAL/SHM files
      try {
        renameSync(sharedDbPath + "-wal", preDbPath + "-wal");
      } catch {}
      try {
        renameSync(sharedDbPath + "-shm", preDbPath + "-shm");
      } catch {}
    }

    if (existsSync(sharedVaultDir) && !existsSync(preVaultDir)) {
      renameSync(sharedVaultDir, preVaultDir);
      log(`Renamed vault/ → vault.pre-migration/`);
    }
  }

  log(`\n── Migration Summary ──`);
  log(`  Users: ${users.length}`);
  log(`  Entries migrated: ${totalMigrated}`);
  log(`  Entries failed: ${totalFailed}`);
  log(`  Orphan entries skipped: ${orphanCount}`);
  if (DRY_RUN) log(`  (DRY RUN — no changes made)`);
}

main().catch((err) => {
  console.error(`[migration] FATAL: ${err.message}`);
  process.exit(1);
});
