/**
 * status.js — Vault status/diagnostics data gathering
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { walkDir } from "./files.js";

/**
 * Gather raw vault status data for formatting by consumers.
 *
 * @param {{ db, config }} ctx
 * @returns {{ fileCount, subdirs, kindCounts, dbSize, stalePaths, resolvedFrom, embeddingStatus, errors }}
 */
export function gatherVaultStatus(ctx) {
  const { db, config } = ctx;
  const errors = [];

  // Count files in vault subdirs (auto-discover)
  let fileCount = 0;
  const subdirs = [];
  try {
    if (existsSync(config.vaultDir)) {
      for (const d of readdirSync(config.vaultDir, { withFileTypes: true })) {
        if (d.isDirectory()) {
          const dir = join(config.vaultDir, d.name);
          const count = walkDir(dir).length;
          fileCount += count;
          if (count > 0) subdirs.push({ name: d.name, count });
        }
      }
    }
  } catch (e) {
    errors.push(`File scan failed: ${e.message}`);
  }

  // Count DB rows by kind
  let kindCounts = [];
  try {
    kindCounts = db.prepare("SELECT kind, COUNT(*) as c FROM vault GROUP BY kind").all();
  } catch (e) {
    errors.push(`Kind count query failed: ${e.message}`);
  }

  // DB file size
  let dbSize = "n/a";
  let dbSizeBytes = 0;
  try {
    if (existsSync(config.dbPath)) {
      dbSizeBytes = statSync(config.dbPath).size;
      dbSize = dbSizeBytes > 1024 * 1024
        ? `${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB`
        : `${(dbSizeBytes / 1024).toFixed(1)}KB`;
    }
  } catch (e) {
    errors.push(`DB size check failed: ${e.message}`);
  }

  // Check for stale paths (count all mismatches, not just a sample)
  let stalePaths = false;
  let staleCount = 0;
  try {
    const result = db.prepare(
      "SELECT COUNT(*) as c FROM vault WHERE file_path NOT LIKE ? || '%'"
    ).get(config.vaultDir);
    staleCount = result.c;
    stalePaths = staleCount > 0;
  } catch (e) {
    errors.push(`Stale path check failed: ${e.message}`);
  }

  // Embedding/vector status
  let embeddingStatus = null;
  try {
    const total = db.prepare("SELECT COUNT(*) as c FROM vault").get().c;
    const indexed = db.prepare(
      "SELECT COUNT(*) as c FROM vault WHERE rowid IN (SELECT rowid FROM vault_vec)"
    ).get().c;
    embeddingStatus = { indexed, total, missing: total - indexed };
  } catch (e) {
    errors.push(`Embedding status check failed: ${e.message}`);
  }

  return {
    fileCount,
    subdirs,
    kindCounts,
    dbSize,
    dbSizeBytes,
    stalePaths,
    staleCount,
    embeddingStatus,
    resolvedFrom: config.resolvedFrom,
    errors,
  };
}
