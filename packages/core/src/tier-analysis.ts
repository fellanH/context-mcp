import type { BaseCtx, CaptureResult } from './types.js';
import { captureAndIndex } from './capture.js';

export interface TierAnalysisOptions {
  hotThreshold?: number;
  hotDays?: number;
  coldDays?: number;
  coAccessThreshold?: number;
  dryRun?: boolean;
}

export interface HotEntry {
  id: string;
  title: string | null;
  accessCount: number;
}

export interface ColdEntry {
  id: string;
  title: string | null;
  lastAccessed: string | null;
  coldSummary: string;
}

export interface CoAccessBundle {
  entries: Array<{ id: string; title: string | null }>;
  totalWeight: number;
  briefId?: string;
}

export interface TierAnalysisReport {
  hotEntries: HotEntry[];
  coldEntries: ColdEntry[];
  warmReset: number;
  bundles: CoAccessBundle[];
  accessLogPruned: number;
}

function computeColdSummary(body: string): string {
  const firstSentence = body.split(/[.!?]\s/)[0];
  return (firstSentence || body).slice(0, 200).trim();
}

function findClusters(pairs: Array<{ a: string; b: string; count: number }>): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const { a, b } of pairs) {
    union(a, b);
  }

  const clusters = new Map<string, Set<string>>();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!clusters.has(root)) clusters.set(root, new Set());
    clusters.get(root)!.add(node);
  }
  return clusters;
}

export async function runTierAnalysis(
  ctx: BaseCtx,
  opts: TierAnalysisOptions = {}
): Promise<TierAnalysisReport> {
  const hotThreshold = opts.hotThreshold ?? 5;
  const hotDays = opts.hotDays ?? 7;
  const coldDays = opts.coldDays ?? 30;
  const coAccessThreshold = opts.coAccessThreshold ?? 3;
  const dryRun = opts.dryRun ?? false;

  const report: TierAnalysisReport = {
    hotEntries: [],
    coldEntries: [],
    warmReset: 0,
    bundles: [],
    accessLogPruned: 0,
  };

  // --- Hot detection ---
  const hotRows = ctx.db
    .prepare(
      `SELECT v.id, v.title, COUNT(a.id) as access_count
       FROM vault v
       JOIN access_log a ON a.entry_id = v.id
       WHERE a.accessed_at >= datetime('now', ? || ' days')
         AND v.tier != 'ephemeral'
         AND v.superseded_by IS NULL
       GROUP BY v.id
       HAVING COUNT(a.id) >= ?`
    )
    .all(`-${hotDays}`, hotThreshold) as Array<{ id: string; title: string | null; access_count: number }>;

  for (const row of hotRows) {
    report.hotEntries.push({
      id: row.id,
      title: row.title,
      accessCount: row.access_count,
    });
    if (!dryRun) {
      ctx.db.prepare(`UPDATE vault SET heat_tier = 'hot' WHERE id = ?`).run(row.id);
    }
  }

  // --- Cold detection ---
  const coldDayStr = `-${coldDays}`;
  const coldRows = ctx.db
    .prepare(
      `SELECT v.id, v.title, v.body, v.last_accessed_at
       FROM vault v
       WHERE v.tier != 'durable'
         AND v.superseded_by IS NULL
         AND v.category != 'event'
         AND (v.last_accessed_at IS NULL OR v.last_accessed_at < datetime('now', ? || ' days'))
         AND NOT EXISTS (
           SELECT 1 FROM access_log a
           WHERE a.entry_id = v.id
             AND a.accessed_at >= datetime('now', ? || ' days')
         )`
    )
    .all(coldDayStr, coldDayStr) as Array<{ id: string; title: string | null; body: string; last_accessed_at: string | null }>;

  for (const row of coldRows) {
    const summary = computeColdSummary(row.body);
    report.coldEntries.push({
      id: row.id,
      title: row.title,
      lastAccessed: row.last_accessed_at,
      coldSummary: summary,
    });
    if (!dryRun) {
      ctx.db
        .prepare(
          `UPDATE vault SET heat_tier = 'cold', meta = json_set(COALESCE(meta, '{}'), '$.cold_summary', ?) WHERE id = ?`
        )
        .run(summary, row.id);
    }
  }

  // --- Warm reset: clear stale heat_tier from entries that no longer qualify ---
  const hotIds = new Set(report.hotEntries.map((e) => e.id));
  const coldIds = new Set(report.coldEntries.map((e) => e.id));
  if (!dryRun) {
    // Clear heat_tier from entries that are no longer hot or cold
    const staleHeat = ctx.db
      .prepare(
        `SELECT id, heat_tier FROM vault WHERE heat_tier IS NOT NULL AND superseded_by IS NULL`
      )
      .all() as Array<{ id: string; heat_tier: string }>;

    const clearStmt = ctx.db.prepare(`UPDATE vault SET heat_tier = NULL WHERE id = ?`);
    for (const row of staleHeat) {
      if ((row.heat_tier === 'hot' && !hotIds.has(row.id)) ||
          (row.heat_tier === 'cold' && !coldIds.has(row.id))) {
        clearStmt.run(row.id);
        report.warmReset++;
      }
    }
  }

  // --- Co-access bundle detection ---
  const coAccessPairs = ctx.db
    .prepare(
      `SELECT c.entry_a, c.entry_b, c.count,
              a.title as title_a, b.title as title_b
       FROM co_retrievals c
       JOIN vault a ON a.id = c.entry_a
       JOIN vault b ON b.id = c.entry_b
       WHERE c.count >= ?
         AND a.superseded_by IS NULL
         AND b.superseded_by IS NULL
       ORDER BY c.count DESC
       LIMIT 50`
    )
    .all(coAccessThreshold) as Array<{
    entry_a: string;
    entry_b: string;
    count: number;
    title_a: string | null;
    title_b: string | null;
  }>;

  if (coAccessPairs.length > 0) {
    const titleMap = new Map<string, string | null>();
    const pairsForClustering: Array<{ a: string; b: string; count: number }> = [];
    for (const p of coAccessPairs) {
      titleMap.set(p.entry_a, p.title_a);
      titleMap.set(p.entry_b, p.title_b);
      pairsForClustering.push({ a: p.entry_a, b: p.entry_b, count: p.count });
    }

    const clusters = findClusters(pairsForClustering);

    for (const [, members] of clusters) {
      if (members.size < 3) continue;

      const entries = [...members].map((id) => ({
        id,
        title: titleMap.get(id) ?? null,
      }));
      const totalWeight = pairsForClustering
        .filter((p) => members.has(p.a) && members.has(p.b))
        .reduce((sum, p) => sum + p.count, 0);

      const bundle: CoAccessBundle = { entries, totalWeight };

      if (!dryRun) {
        // Check if a bundle brief already exists for this cluster
        const entryIds = entries.map((e) => e.id).sort();
        const bundleTag = `co-access-bundle:${entryIds.slice(0, 3).join('-')}`;
        const existing = ctx.db
          .prepare(`SELECT id FROM vault WHERE kind = 'brief' AND tags LIKE ?`)
          .get(`%${bundleTag}%`);

        if (!existing) {
          const body = [
            `Co-access bundle (auto-generated by adaptive tiering).`,
            `These entries are frequently retrieved together (total weight: ${totalWeight}).`,
            '',
            ...entries.map((e) => `- **${e.title || '(untitled)'}** (\`${e.id}\`)`),
          ].join('\n');

          try {
            const result: CaptureResult = await captureAndIndex(ctx, {
              kind: 'brief',
              title: `Co-access bundle: ${entries
                .slice(0, 3)
                .map((e) => e.title || e.id.slice(-8))
                .join(', ')}`,
              body,
              tags: ['co-access-bundle', bundleTag, 'auto-tiering'],
              tier: 'working',
              related_to: entryIds,
            });
            bundle.briefId = result.id;
          } catch {
            // Non-fatal
          }
        }
      }

      report.bundles.push(bundle);
    }
  }

  // --- Housekeeping: prune old access_log rows ---
  if (!dryRun) {
    try {
      const pruneResult = ctx.db
        .prepare(`DELETE FROM access_log WHERE accessed_at < datetime('now', '-90 days')`)
        .run();
      report.accessLogPruned = (pruneResult as any)?.changes ?? 0;
    } catch {
      // Non-fatal
    }
  }

  // --- Persist tiering config as vault entry ---
  if (!dryRun) {
    try {
      const configBody = [
        `Adaptive tiering parameters last applied: ${new Date().toISOString()}`,
        '',
        `- Hot threshold: ${hotThreshold} accesses / ${hotDays} days`,
        `- Cold threshold: ${coldDays} days no access`,
        `- Co-access bundle threshold: ${coAccessThreshold}`,
        `- Access log retention: 90 days`,
        '',
        `## Last Run Results`,
        `- Hot entries: ${report.hotEntries.length}`,
        `- Cold entries: ${report.coldEntries.length}`,
        `- Warm resets: ${report.warmReset}`,
        `- Bundles created: ${report.bundles.filter((b) => b.briefId).length}`,
        `- Access log pruned: ${report.accessLogPruned} rows`,
      ].join('\n');

      await captureAndIndex(ctx, {
        kind: 'reference',
        title: 'Tiering Config',
        body: configBody,
        identity_key: 'tiering-config',
        tier: 'durable',
        tags: ['tiering', 'config'],
      });
    } catch {
      // Non-fatal
    }
  }

  return report;
}
