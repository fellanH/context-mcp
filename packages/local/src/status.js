import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { walkDir } from "@context-vault/core/files";
import { isEmbedAvailable } from "@context-vault/core/embed";
import { KIND_STALENESS_DAYS } from "@context-vault/core/categories";

function countArchivedEntries(vaultDir) {
  const archRoot = join(vaultDir, "_archive");
  if (!existsSync(archRoot)) return 0;
  try {
    return walkDir(archRoot).length;
  } catch {
    return 0;
  }
}

export function gatherVaultStatus(ctx, opts = {}) {
  const { db, config } = ctx;
  const errors = [];

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

  let kindCounts = [];
  try {
    kindCounts = db
      .prepare(`SELECT kind, COUNT(*) as c FROM vault GROUP BY kind`)
      .all();
  } catch (e) {
    errors.push(`Kind count query failed: ${e.message}`);
  }

  let categoryCounts = [];
  try {
    categoryCounts = db
      .prepare(`SELECT category, COUNT(*) as c FROM vault GROUP BY category`)
      .all();
  } catch (e) {
    errors.push(`Category count query failed: ${e.message}`);
  }

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

  let stalePaths = false;
  let staleCount = 0;
  try {
    const result = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE file_path NOT LIKE ? || '%'`)
      .get(config.vaultDir);
    staleCount = result.c;
    stalePaths = staleCount > 0;
  } catch (e) {
    errors.push(`Stale path check failed: ${e.message}`);
  }

  let expiredCount = 0;
  try {
    expiredCount = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')`)
      .get().c;
  } catch (e) {
    errors.push(`Expired count failed: ${e.message}`);
  }

  let eventCount = 0;
  try {
    eventCount = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE category = 'event'`)
      .get().c;
  } catch (e) {
    errors.push(`Event count failed: ${e.message}`);
  }

  let eventsWithoutTtlCount = 0;
  try {
    eventsWithoutTtlCount = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE category = 'event' AND expires_at IS NULL`)
      .get().c;
  } catch (e) {
    errors.push(`Events without TTL count failed: ${e.message}`);
  }

  let embeddingStatus = null;
  try {
    const total = db.prepare(`SELECT COUNT(*) as c FROM vault`).get().c;
    const indexed = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE rowid IN (SELECT rowid FROM vault_vec)`)
      .get().c;
    embeddingStatus = { indexed, total, missing: total - indexed };
  } catch (e) {
    errors.push(`Embedding status check failed: ${e.message}`);
  }

  const embedModelAvailable = isEmbedAvailable();

  let autoCapturedFeedbackCount = 0;
  try {
    autoCapturedFeedbackCount = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE kind = 'feedback' AND tags LIKE '%"auto-captured"%'`)
      .get().c;
  } catch (e) {
    errors.push(`Auto-captured feedback count failed: ${e.message}`);
  }

  let archivedCount = 0;
  try {
    archivedCount = countArchivedEntries(config.vaultDir);
  } catch (e) {
    errors.push(`Archived count failed: ${e.message}`);
  }

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
          `SELECT kind, title, COALESCE(updated_at, created_at) as last_updated FROM vault WHERE category = 'knowledge' AND (${kindClauses}) AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY last_updated ASC LIMIT 10`,
        )
        .all();
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
    archivedCount,
    staleKnowledge,
    resolvedFrom: config.resolvedFrom,
    errors,
  };
}

export function computeGrowthWarnings(status, thresholds) {
  if (!thresholds)
    return { warnings: [], hasCritical: false, hasWarnings: false, actions: [], kindBreakdown: [] };

  const t = thresholds;
  const warnings = [];
  const actions = [];

  const total = status.embeddingStatus?.total ?? 0;
  const { eventCount = 0, eventsWithoutTtlCount = 0, expiredCount = 0, dbSizeBytes = 0 } = status;

  let totalExceeded = false;

  if (t.totalEntries?.critical != null && total >= t.totalEntries.critical) {
    totalExceeded = true;
    warnings.push({ level: "critical", message: `Total entries: ${total.toLocaleString()} (exceeds critical limit of ${t.totalEntries.critical.toLocaleString()})` });
  } else if (t.totalEntries?.warn != null && total >= t.totalEntries.warn) {
    totalExceeded = true;
    warnings.push({ level: "warn", message: `Total entries: ${total.toLocaleString()} (exceeds recommended ${t.totalEntries.warn.toLocaleString()})` });
  }

  if (t.eventEntries?.critical != null && eventCount >= t.eventEntries.critical) {
    warnings.push({ level: "critical", message: `Event entries: ${eventCount.toLocaleString()} (exceeds critical limit of ${t.eventEntries.critical.toLocaleString()})` });
  } else if (t.eventEntries?.warn != null && eventCount >= t.eventEntries.warn) {
    const ttlNote = eventsWithoutTtlCount > 0 ? ` (${eventsWithoutTtlCount.toLocaleString()} without TTL)` : "";
    warnings.push({ level: "warn", message: `Event entries: ${eventCount.toLocaleString()}${ttlNote} (exceeds recommended ${t.eventEntries.warn.toLocaleString()})` });
  }

  if (t.vaultSizeBytes?.critical != null && dbSizeBytes >= t.vaultSizeBytes.critical) {
    warnings.push({ level: "critical", message: `Database size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB (exceeds critical limit of ${(t.vaultSizeBytes.critical / 1024 / 1024).toFixed(0)}MB)` });
  } else if (t.vaultSizeBytes?.warn != null && dbSizeBytes >= t.vaultSizeBytes.warn) {
    warnings.push({ level: "warn", message: `Database size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB (exceeds recommended ${(t.vaultSizeBytes.warn / 1024 / 1024).toFixed(0)}MB)` });
  }

  if (t.eventsWithoutTtl?.warn != null && eventsWithoutTtlCount >= t.eventsWithoutTtl.warn) {
    warnings.push({ level: "warn", message: `Event entries without expires_at: ${eventsWithoutTtlCount.toLocaleString()} (exceeds recommended ${t.eventsWithoutTtl.warn.toLocaleString()})` });
  }

  const hasCritical = warnings.some((w) => w.level === "critical");

  if (expiredCount > 0) {
    actions.push(`Run \`context-vault prune\` to remove ${expiredCount} expired event entr${expiredCount === 1 ? "y" : "ies"}`);
  }
  if (eventsWithoutTtlCount > 0 && (eventCount >= (t.eventEntries?.warn ?? Infinity) || eventsWithoutTtlCount >= (t.eventsWithoutTtl?.warn ?? Infinity))) {
    actions.push("Add `expires_at` to event/session entries to enable automatic cleanup");
  }
  if (total >= (t.totalEntries?.warn ?? Infinity)) {
    actions.push("Run `context-vault archive` to move old ephemeral/event entries to _archive/");
  }

  const kindBreakdown = totalExceeded && status.kindCounts?.length
    ? [...status.kindCounts].sort((a, b) => b.c - a.c).map(({ kind, c }) => ({ kind, count: c, pct: Math.round((c / total) * 100) }))
    : [];

  return { warnings, hasCritical, hasWarnings: warnings.length > 0, actions, kindBreakdown };
}
