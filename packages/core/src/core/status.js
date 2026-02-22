/**
 * status.js — Vault status/diagnostics data gathering
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { walkDir } from "./files.js";
import { isEmbedAvailable } from "../index/embed.js";

/**
 * Gather raw vault status data for formatting by consumers.
 *
 * @param {import('../server/types.js').BaseCtx} ctx
 * @param {{ userId?: string }} opts — optional userId for per-user stats
 * @returns {{ fileCount, subdirs, kindCounts, dbSize, stalePaths, resolvedFrom, embeddingStatus, errors }}
 */
export function gatherVaultStatus(ctx, opts = {}) {
  const { db, config } = ctx;
  const { userId } = opts;
  const errors = [];

  // Build user filter clause for DB queries
  const hasUser = userId !== undefined;
  const userWhere = hasUser ? "WHERE user_id = ?" : "";
  const userAnd = hasUser ? "AND user_id = ?" : "";
  const userParams = hasUser ? [userId] : [];

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
    kindCounts = db
      .prepare(
        `SELECT kind, COUNT(*) as c FROM vault ${userWhere} GROUP BY kind`,
      )
      .all(...userParams);
  } catch (e) {
    errors.push(`Kind count query failed: ${e.message}`);
  }

  // Count DB rows by category
  let categoryCounts = [];
  try {
    categoryCounts = db
      .prepare(
        `SELECT category, COUNT(*) as c FROM vault ${userWhere} GROUP BY category`,
      )
      .all(...userParams);
  } catch (e) {
    errors.push(`Category count query failed: ${e.message}`);
  }

  // DB file size
  let dbSize = "n/a";
  let dbSizeBytes = 0;
  try {
    if (existsSync(config.dbPath)) {
      dbSizeBytes = statSync(config.dbPath).size;
      dbSize =
        dbSizeBytes > 1024 * 1024
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
    const result = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE file_path NOT LIKE ? || '%' ${userAnd}`,
      )
      .get(config.vaultDir, ...userParams);
    staleCount = result.c;
    stalePaths = staleCount > 0;
  } catch (e) {
    errors.push(`Stale path check failed: ${e.message}`);
  }

  // Count expired entries pending pruning
  let expiredCount = 0;
  try {
    expiredCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now') ${userAnd}`,
      )
      .get(...userParams).c;
  } catch (e) {
    errors.push(`Expired count failed: ${e.message}`);
  }

  // Embedding/vector status
  let embeddingStatus = null;
  try {
    const total = db
      .prepare(`SELECT COUNT(*) as c FROM vault ${userWhere}`)
      .get(...userParams).c;
    const indexed = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE rowid IN (SELECT rowid FROM vault_vec) ${userAnd}`,
      )
      .get(...userParams).c;
    embeddingStatus = { indexed, total, missing: total - indexed };
  } catch (e) {
    errors.push(`Embedding status check failed: ${e.message}`);
  }

  // Embedding model availability
  const embedModelAvailable = isEmbedAvailable();

  // Count auto-captured feedback entries (written by tracked() on unhandled errors)
  let autoCapturedFeedbackCount = 0;
  try {
    autoCapturedFeedbackCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE kind = 'feedback' AND tags LIKE '%"auto-captured"%' ${userAnd}`,
      )
      .get(...userParams).c;
  } catch (e) {
    errors.push(`Auto-captured feedback count failed: ${e.message}`);
  }

  return {
    fileCount,
    subdirs,
    kindCounts,
    categoryCounts,
    dbSize,
    dbSizeBytes,
    stalePaths,
    staleCount,
    expiredCount,
    embeddingStatus,
    embedModelAvailable,
    autoCapturedFeedbackCount,
    resolvedFrom: config.resolvedFrom,
    errors,
  };
}
