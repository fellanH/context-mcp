/**
 * Test context helper — creates isolated temp vaults with real DB + embeddings.
 */

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initDatabase,
  prepareStatements,
  insertVec,
  deleteVec,
} from "@context-vault/core/index/db";
import { embed } from "@context-vault/core/index/embed";

export async function createTestCtx() {
  const tmp = mkdtempSync(join(tmpdir(), "context-vault-test-"));
  const vaultDir = join(tmp, "vault");
  const dbPath = join(tmp, "vault.db");
  mkdirSync(vaultDir, { recursive: true });

  const db = await initDatabase(dbPath);
  const stmts = prepareStatements(db);

  const config = {
    vaultDir,
    dataDir: tmp,
    dbPath,
    devDir: tmp,
    vaultDirExists: true,
    configPath: join(tmp, "config.json"),
    resolvedFrom: "test",
  };

  const ctx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
    deleteVec: (rowid) => deleteVec(stmts, rowid),
  };

  return {
    ctx,
    cleanup() {
      try {
        db.close();
      } catch {}
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}
