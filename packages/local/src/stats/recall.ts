import type { LocalCtx } from '../types.js';

const RECALL_TARGET = 0.30;
const DEAD_DAYS = 30;
const TOP_COUNT = 10;

export interface RecallSummary {
  ratio: number;
  target: number;
  total_entries: number;
  recalled_entries: number;
  never_recalled: number;
  avg_recall_count: number;
  top_recalled: Array<{ title: string; recall_count: number; recall_sessions: number }>;
  dead_entry_count: number;
  dead_bucket_count: number;
  top_dead_buckets: Array<{ bucket: string; count: number }>;
  co_retrieval_pairs: number;
}

export interface CoRetrievalSummary {
  total_pairs: number;
  graph_density: number;
  top_pairs: Array<{
    title_a: string;
    title_b: string;
    weight: number;
  }>;
}

export function gatherRecallSummary(ctx: LocalCtx): RecallSummary {
  const { db } = ctx;

  const totalRow = db.prepare('SELECT COUNT(*) as c FROM vault').get() as { c: number };
  const total_entries = totalRow.c;

  const recalledRow = db
    .prepare('SELECT COUNT(*) as c FROM vault WHERE recall_count > 0')
    .get() as { c: number };
  const recalled_entries = recalledRow.c;
  const never_recalled = total_entries - recalled_entries;
  const ratio = total_entries > 0 ? Math.round((recalled_entries / total_entries) * 100) / 100 : 0;

  const avgRow = db
    .prepare(
      'SELECT AVG(recall_count) as avg FROM vault WHERE recall_count > 0'
    )
    .get() as { avg: number | null };
  const avg_recall_count = Math.round((avgRow.avg ?? 0) * 10) / 10;

  const top_recalled = db
    .prepare(
      'SELECT title, recall_count, recall_sessions FROM vault WHERE recall_count > 0 ORDER BY recall_count DESC LIMIT ?'
    )
    .all(TOP_COUNT) as Array<{ title: string; recall_count: number; recall_sessions: number }>;

  const deadRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM vault WHERE recall_count = 0 AND created_at <= datetime('now', '-${DEAD_DAYS} days')`
    )
    .get() as { c: number };
  const dead_entry_count = deadRow.c;

  const deadBuckets = db
    .prepare(
      `SELECT tags, COUNT(*) as c FROM vault WHERE recall_count = 0 AND created_at <= datetime('now', '-${DEAD_DAYS} days') GROUP BY tags`
    )
    .all() as Array<{ tags: string; c: number }>;

  const bucketMap = new Map<string, number>();
  for (const row of deadBuckets) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags ?? '[]');
    } catch {
      tags = [];
    }
    const bucket = tags.find((t) => t.startsWith('bucket:'));
    if (bucket) {
      bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + row.c);
    }
  }

  const top_dead_buckets = [...bucketMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([bucket, count]) => ({ bucket: bucket.replace('bucket:', ''), count }));

  const dead_bucket_count = bucketMap.size;

  const coRow = db.prepare('SELECT COUNT(*) as c FROM co_retrievals').get() as { c: number };
  const co_retrieval_pairs = coRow.c;

  return {
    ratio,
    target: RECALL_TARGET,
    total_entries,
    recalled_entries,
    never_recalled,
    avg_recall_count,
    top_recalled,
    dead_entry_count,
    dead_bucket_count,
    top_dead_buckets,
    co_retrieval_pairs,
  };
}

export function gatherCoRetrievalSummary(ctx: LocalCtx): CoRetrievalSummary {
  const { db } = ctx;

  const pairsRow = db.prepare('SELECT COUNT(*) as c FROM co_retrievals').get() as { c: number };
  const total_pairs = pairsRow.c;

  const entryRow = db.prepare('SELECT COUNT(*) as c FROM vault').get() as { c: number };
  const total_entries = entryRow.c;

  const max_possible = total_entries > 1 ? (total_entries * (total_entries - 1)) / 2 : 1;
  const graph_density = Math.round((total_pairs / max_possible) * 10000) / 10000;

  const rawPairs = db
    .prepare(
      `SELECT c.entry_a, c.entry_b, c.count as weight, a.title as title_a, b.title as title_b
       FROM co_retrievals c
       JOIN vault a ON a.id = c.entry_a
       JOIN vault b ON b.id = c.entry_b
       ORDER BY c.count DESC
       LIMIT 10`
    )
    .all() as Array<{ title_a: string; title_b: string; weight: number }>;

  const top_pairs = rawPairs.map((row) => ({
    title_a: row.title_a ?? '(untitled)',
    title_b: row.title_b ?? '(untitled)',
    weight: row.weight,
  }));

  return { total_pairs, graph_density, top_pairs };
}
