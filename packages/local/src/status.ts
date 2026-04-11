import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { walkDir } from '@context-vault/core/files';
import { isEmbedAvailable } from '@context-vault/core/embed';
import { KIND_STALENESS_DAYS } from '@context-vault/core/categories';
import type { LocalCtx } from './types.js';
import type { GrowthThresholds } from '@context-vault/core/types';

function countArchivedEntries(vaultDir: string): number {
  const archRoot = join(vaultDir, '_archive');
  if (!existsSync(archRoot)) return 0;
  try {
    return walkDir(archRoot).length;
  } catch {
    return 0;
  }
}

export function gatherVaultStatus(ctx: LocalCtx, opts: Record<string, unknown> = {}): any {
  void opts;
  const { db, config } = ctx;
  const errors: string[] = [];

  let fileCount = 0;
  const subdirs: Array<{ name: string; count: number }> = [];
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
    errors.push(`File scan failed: ${(e as Error).message}`);
  }

  let kindCounts: unknown[] = [];
  try {
    kindCounts = db.prepare(`SELECT kind, COUNT(*) as c FROM vault GROUP BY kind`).all();
  } catch (e) {
    errors.push(`Kind count query failed: ${(e as Error).message}`);
  }

  let categoryCounts: unknown[] = [];
  try {
    categoryCounts = db
      .prepare(`SELECT category, COUNT(*) as c FROM vault GROUP BY category`)
      .all();
  } catch (e) {
    errors.push(`Category count query failed: ${(e as Error).message}`);
  }

  let dbSize = 'n/a';
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
    errors.push(`DB size check failed: ${(e as Error).message}`);
  }

  let stalePaths = false;
  let staleCount = 0;
  try {
    const result = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE file_path NOT LIKE ? || '%'`)
      .get(config.vaultDir) as { c: number } | undefined;
    staleCount = result?.c ?? 0;
    stalePaths = staleCount > 0;
  } catch (e) {
    errors.push(`Stale path check failed: ${(e as Error).message}`);
  }

  let expiredCount = 0;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')`
      )
      .get() as { c: number } | undefined;
    expiredCount = row?.c ?? 0;
  } catch (e) {
    errors.push(`Expired count failed: ${(e as Error).message}`);
  }

  let eventCount = 0;
  try {
    const row = db.prepare(`SELECT COUNT(*) as c FROM vault WHERE category = 'event'`).get() as
      | { c: number }
      | undefined;
    eventCount = row?.c ?? 0;
  } catch (e) {
    errors.push(`Event count failed: ${(e as Error).message}`);
  }

  let eventsWithoutTtlCount = 0;
  try {
    const row = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE category = 'event' AND expires_at IS NULL`)
      .get() as { c: number } | undefined;
    eventsWithoutTtlCount = row?.c ?? 0;
  } catch (e) {
    errors.push(`Events without TTL count failed: ${(e as Error).message}`);
  }

  let embeddingStatus: { indexed: number; total: number; missing: number } | null = null;
  try {
    const totalRow = db.prepare(`SELECT COUNT(*) as c FROM vault`).get() as
      | { c: number }
      | undefined;
    const indexedRow = db
      .prepare(`SELECT COUNT(*) as c FROM vault WHERE rowid IN (SELECT rowid FROM vault_vec)`)
      .get() as { c: number } | undefined;
    const total = totalRow?.c ?? 0;
    const indexed = indexedRow?.c ?? 0;
    embeddingStatus = { indexed, total, missing: total - indexed };
  } catch (e) {
    errors.push(`Embedding status check failed: ${(e as Error).message}`);
  }

  const embedModelAvailable = isEmbedAvailable();

  let autoCapturedFeedbackCount = 0;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault WHERE kind = 'feedback' AND tags LIKE '%"auto-captured"%'`
      )
      .get() as { c: number } | undefined;
    autoCapturedFeedbackCount = row?.c ?? 0;
  } catch (e) {
    errors.push(`Auto-captured feedback count failed: ${(e as Error).message}`);
  }

  let archivedCount = 0;
  try {
    archivedCount = countArchivedEntries(config.vaultDir);
  } catch (e) {
    errors.push(`Archived count failed: ${(e as Error).message}`);
  }

  let indexingStats: { indexed: number; unindexed: number; total: number; byKind: Array<{ kind: string; indexed: number; total: number }> } | null = null;
  try {
    const totalRow = db.prepare('SELECT COUNT(*) as c FROM vault').get() as { c: number } | undefined;
    const indexedRow = db.prepare('SELECT COUNT(*) as c FROM vault WHERE indexed = 1').get() as { c: number } | undefined;
    const total = totalRow?.c ?? 0;
    const indexed = indexedRow?.c ?? 0;
    const byKind = db.prepare(
      'SELECT kind, COUNT(*) as total, SUM(CASE WHEN indexed = 1 THEN 1 ELSE 0 END) as indexed FROM vault GROUP BY kind'
    ).all() as Array<{ kind: string; total: number; indexed: number }>;
    indexingStats = { indexed, unindexed: total - indexed, total, byKind };
  } catch (e) {
    errors.push(`Indexing stats failed: ${(e as Error).message}`);
  }

  let ftsRowCount: number | null = null;
  try {
    ftsRowCount = (db.prepare('SELECT COUNT(*) as c FROM vault_fts').get() as { c: number } | undefined)?.c ?? 0;
  } catch (e) {
    errors.push(`FTS row count failed: ${(e as Error).message}`);
  }

  let coRetrievalPairCount = 0;
  try {
    coRetrievalPairCount =
      (db.prepare('SELECT COUNT(*) as c FROM co_retrievals').get() as { c: number } | undefined)?.c ?? 0;
  } catch (e) {
    errors.push(`Co-retrieval count failed: ${(e as Error).message}`);
  }

  let staleKnowledge: unknown[] = [];
  try {
    const stalenessKinds = Object.entries(KIND_STALENESS_DAYS);
    if (stalenessKinds.length > 0) {
      const kindClauses = stalenessKinds
        .map(
          ([kind, days]) =>
            `(kind = '${kind}' AND COALESCE(updated_at, created_at) <= datetime('now', '-${days} days'))`
        )
        .join(' OR ');
      staleKnowledge = db
        .prepare(
          `SELECT kind, title, COALESCE(updated_at, created_at) as last_updated FROM vault WHERE category = 'knowledge' AND (${kindClauses}) AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY last_updated ASC LIMIT 10`
        )
        .all();
    }
  } catch (e) {
    errors.push(`Stale knowledge check failed: ${(e as Error).message}`);
  }

  let recallStats: { totalRecalls: number; entriesRecalled: number; avgRecallCount: number; maxRecallCount: number; topRecalled: Array<{ title: string; kind: string; recall_count: number; recall_sessions: number }> } | null = null;
  try {
    const totals = db.prepare(
      `SELECT SUM(recall_count) as total_recalls, COUNT(CASE WHEN recall_count > 0 THEN 1 END) as entries_recalled, AVG(CASE WHEN recall_count > 0 THEN recall_count END) as avg_recall, MAX(recall_count) as max_recall FROM vault`
    ).get() as any;
    const topRecalled = db.prepare(
      `SELECT title, kind, recall_count, recall_sessions FROM vault WHERE recall_count > 0 ORDER BY recall_count DESC LIMIT 5`
    ).all() as any[];
    recallStats = {
      totalRecalls: totals?.total_recalls ?? 0,
      entriesRecalled: totals?.entries_recalled ?? 0,
      avgRecallCount: Math.round((totals?.avg_recall ?? 0) * 10) / 10,
      maxRecallCount: totals?.max_recall ?? 0,
      topRecalled,
    };
  } catch (e) {
    errors.push(`Recall stats failed: ${(e as Error).message}`);
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
    indexingStats,
    ftsRowCount,
    coRetrievalPairCount,
    recallStats,
    resolvedFrom: config.resolvedFrom,
    errors,
  };
}

export function computeGrowthWarnings(
  status: Record<string, any>,
  thresholds: GrowthThresholds | null | undefined
): {
  warnings: Array<{ level: string; message: string }>;
  hasCritical: boolean;
  hasWarnings: boolean;
  actions: string[];
  kindBreakdown: Array<{ kind: string; count: number; pct: number }>;
} {
  if (!thresholds)
    return {
      warnings: [],
      hasCritical: false,
      hasWarnings: false,
      actions: [],
      kindBreakdown: [],
    };

  const t = thresholds;
  const warnings: Array<{ level: string; message: string }> = [];
  const actions: string[] = [];

  const total: number = status.embeddingStatus?.total ?? 0;
  const { eventCount = 0, eventsWithoutTtlCount = 0, expiredCount = 0, dbSizeBytes = 0 } = status;

  let totalExceeded = false;

  if (t.totalEntries?.critical != null && total >= t.totalEntries.critical) {
    totalExceeded = true;
    warnings.push({
      level: 'critical',
      message: `Total entries: ${total.toLocaleString()} (exceeds critical limit of ${t.totalEntries.critical.toLocaleString()})`,
    });
  } else if (t.totalEntries?.warn != null && total >= t.totalEntries.warn) {
    totalExceeded = true;
    warnings.push({
      level: 'warn',
      message: `Total entries: ${total.toLocaleString()} (exceeds recommended ${t.totalEntries.warn.toLocaleString()})`,
    });
  }

  if (t.eventEntries?.critical != null && eventCount >= t.eventEntries.critical) {
    warnings.push({
      level: 'critical',
      message: `Event entries: ${eventCount.toLocaleString()} (exceeds critical limit of ${t.eventEntries.critical.toLocaleString()})`,
    });
  } else if (t.eventEntries?.warn != null && eventCount >= t.eventEntries.warn) {
    const ttlNote =
      eventsWithoutTtlCount > 0 ? ` (${eventsWithoutTtlCount.toLocaleString()} without TTL)` : '';
    warnings.push({
      level: 'warn',
      message: `Event entries: ${eventCount.toLocaleString()}${ttlNote} (exceeds recommended ${t.eventEntries.warn.toLocaleString()})`,
    });
  }

  if (t.vaultSizeBytes?.critical != null && dbSizeBytes >= t.vaultSizeBytes.critical) {
    warnings.push({
      level: 'critical',
      message: `Database size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB (exceeds critical limit of ${(t.vaultSizeBytes.critical / 1024 / 1024).toFixed(0)}MB)`,
    });
  } else if (t.vaultSizeBytes?.warn != null && dbSizeBytes >= t.vaultSizeBytes.warn) {
    warnings.push({
      level: 'warn',
      message: `Database size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB (exceeds recommended ${(t.vaultSizeBytes.warn / 1024 / 1024).toFixed(0)}MB)`,
    });
  }

  if (t.eventsWithoutTtl?.warn != null && eventsWithoutTtlCount >= t.eventsWithoutTtl.warn) {
    warnings.push({
      level: 'warn',
      message: `Event entries without expires_at: ${eventsWithoutTtlCount.toLocaleString()} (exceeds recommended ${t.eventsWithoutTtl.warn.toLocaleString()})`,
    });
  }

  const hasCritical = warnings.some((w) => w.level === 'critical');

  if (expiredCount > 0) {
    actions.push(
      `Run \`context-vault prune\` to remove ${expiredCount} expired event entr${expiredCount === 1 ? 'y' : 'ies'}`
    );
  }
  if (
    eventsWithoutTtlCount > 0 &&
    (eventCount >= (t.eventEntries?.warn ?? Infinity) ||
      eventsWithoutTtlCount >= (t.eventsWithoutTtl?.warn ?? Infinity))
  ) {
    actions.push('Add `expires_at` to event/session entries to enable automatic cleanup');
  }
  if (total >= (t.totalEntries?.warn ?? Infinity)) {
    actions.push('Run `context-vault archive` to move old ephemeral/event entries to _archive/');
  }

  const kindBreakdown: Array<{ kind: string; count: number; pct: number }> =
    totalExceeded && status.kindCounts?.length
      ? [...(status.kindCounts as Array<{ kind: string; c: number }>)]
          .sort((a, b) => b.c - a.c)
          .map(({ kind, c }) => ({
            kind,
            count: c,
            pct: Math.round((c / total) * 100),
          }))
      : [];

  return {
    warnings,
    hasCritical,
    hasWarnings: warnings.length > 0,
    actions,
    kindBreakdown,
  };
}
