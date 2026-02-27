/**
 * status.js — Vault status/diagnostics data gathering
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { walkDir } from "./files.js";
import { isEmbedAvailable } from "../index/embed.js";
import { KIND_STALENESS_DAYS } from "./categories.js";

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

  // Count event-category entries
  let eventCount = 0;
  try {
    eventCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE category = 'event' ${userAnd}`,
      )
      .get(...userParams).c;
  } catch (e) {
    errors.push(`Event count failed: ${e.message}`);
  }

  // Count event entries without expires_at
  let eventsWithoutTtlCount = 0;
  try {
    eventsWithoutTtlCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE category = 'event' AND expires_at IS NULL ${userAnd}`,
      )
      .get(...userParams).c;
  } catch (e) {
    errors.push(`Events without TTL count failed: ${e.message}`);
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

  // Stale knowledge entries — kinds with a threshold, not updated within N days
  let staleKnowledge = [];
  try {
    const stalenessKinds = Object.entries(KIND_STALENESS_DAYS);
    if (stalenessKinds.length > 0) {
      const kindClauses = stalenessKinds
        .map(
          ([kind, days]) =>
            `(kind = '${kind}' AND COALESCE(updated_at, created_at) <= datetime('now', '-${days} days'))`,
        )
        .join(" OR ");
      staleKnowledge = db
        .prepare(
          `SELECT kind, title, COALESCE(updated_at, created_at) as last_updated FROM vault WHERE category = 'knowledge' AND (${kindClauses}) AND (expires_at IS NULL OR expires_at > datetime('now')) ${userAnd} ORDER BY last_updated ASC LIMIT 10`,
        )
        .all(...userParams);
    }
  } catch (e) {
    errors.push(`Stale knowledge check failed: ${e.message}`);
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
    eventCount,
    eventsWithoutTtlCount,
    embeddingStatus,
    embedModelAvailable,
    autoCapturedFeedbackCount,
    staleKnowledge,
    resolvedFrom: config.resolvedFrom,
    errors,
  };
}

/**
 * Compute growth warnings based on vault status and configured thresholds.
 *
 * @param {object} status — result of gatherVaultStatus()
 * @param {object} thresholds — from config.thresholds
 * @returns {{ warnings: Array, hasCritical: boolean, hasWarnings: boolean, actions: string[], kindBreakdown: Array }}
 */
export function computeGrowthWarnings(status, thresholds) {
  if (!thresholds)
    return {
      warnings: [],
      hasCritical: false,
      hasWarnings: false,
      actions: [],
      kindBreakdown: [],
    };

  const t = thresholds;
  const warnings = [];
  const actions = [];

  const total = status.embeddingStatus?.total ?? 0;
  const {
    eventCount = 0,
    eventsWithoutTtlCount = 0,
    expiredCount = 0,
    dbSizeBytes = 0,
  } = status;

  let totalExceeded = false;

  if (t.totalEntries?.critical != null && total >= t.totalEntries.critical) {
    totalExceeded = true;
    warnings.push({
      level: "critical",
      message: `Total entries: ${total.toLocaleString()} (exceeds critical limit of ${t.totalEntries.critical.toLocaleString()})`,
    });
  } else if (t.totalEntries?.warn != null && total >= t.totalEntries.warn) {
    totalExceeded = true;
    warnings.push({
      level: "warn",
      message: `Total entries: ${total.toLocaleString()} (exceeds recommended ${t.totalEntries.warn.toLocaleString()})`,
    });
  }

  if (
    t.eventEntries?.critical != null &&
    eventCount >= t.eventEntries.critical
  ) {
    warnings.push({
      level: "critical",
      message: `Event entries: ${eventCount.toLocaleString()} (exceeds critical limit of ${t.eventEntries.critical.toLocaleString()})`,
    });
  } else if (
    t.eventEntries?.warn != null &&
    eventCount >= t.eventEntries.warn
  ) {
    const ttlNote =
      eventsWithoutTtlCount > 0
        ? ` (${eventsWithoutTtlCount.toLocaleString()} without TTL)`
        : "";
    warnings.push({
      level: "warn",
      message: `Event entries: ${eventCount.toLocaleString()}${ttlNote} (exceeds recommended ${t.eventEntries.warn.toLocaleString()})`,
    });
  }

  if (
    t.vaultSizeBytes?.critical != null &&
    dbSizeBytes >= t.vaultSizeBytes.critical
  ) {
    warnings.push({
      level: "critical",
      message: `Database size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB (exceeds critical limit of ${(t.vaultSizeBytes.critical / 1024 / 1024).toFixed(0)}MB)`,
    });
  } else if (
    t.vaultSizeBytes?.warn != null &&
    dbSizeBytes >= t.vaultSizeBytes.warn
  ) {
    warnings.push({
      level: "warn",
      message: `Database size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB (exceeds recommended ${(t.vaultSizeBytes.warn / 1024 / 1024).toFixed(0)}MB)`,
    });
  }

  if (
    t.eventsWithoutTtl?.warn != null &&
    eventsWithoutTtlCount >= t.eventsWithoutTtl.warn
  ) {
    warnings.push({
      level: "warn",
      message: `Event entries without expires_at: ${eventsWithoutTtlCount.toLocaleString()} (exceeds recommended ${t.eventsWithoutTtl.warn.toLocaleString()})`,
    });
  }

  const hasCritical = warnings.some((w) => w.level === "critical");

  if (expiredCount > 0) {
    actions.push(
      `Run \`context-vault prune\` to remove ${expiredCount} expired event entr${expiredCount === 1 ? "y" : "ies"}`,
    );
  }
  const eventThresholdExceeded =
    eventCount >= (t.eventEntries?.warn ?? Infinity);
  const ttlThresholdExceeded =
    eventsWithoutTtlCount >= (t.eventsWithoutTtl?.warn ?? Infinity);
  if (
    eventsWithoutTtlCount > 0 &&
    (eventThresholdExceeded || ttlThresholdExceeded)
  ) {
    actions.push(
      "Add `expires_at` to event/session entries to enable automatic cleanup",
    );
  }
  if (total >= (t.totalEntries?.warn ?? Infinity)) {
    actions.push("Consider archiving events older than 90 days");
  }

  const kindBreakdown = totalExceeded
    ? buildKindBreakdown(status.kindCounts, total)
    : [];

  return {
    warnings,
    hasCritical,
    hasWarnings: warnings.length > 0,
    actions,
    kindBreakdown,
  };
}

function buildKindBreakdown(kindCounts, total) {
  if (!kindCounts?.length || total === 0) return [];
  return [...kindCounts]
    .sort((a, b) => b.c - a.c)
    .map(({ kind, c }) => ({
      kind,
      count: c,
      pct: Math.round((c / total) * 100),
    }));
}
