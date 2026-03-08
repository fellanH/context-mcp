import type { DatabaseSync } from 'node:sqlite';

export function findHotTags(
  db: DatabaseSync,
  opts: { tagThreshold?: number; maxSnapshotAgeDays?: number } = {}
): Array<{ tag: string; entryCount: number; lastSnapshotAge: number | null }> {
  const tagThreshold = opts.tagThreshold ?? 10;
  const maxSnapshotAgeDays = opts.maxSnapshotAgeDays ?? 7;
  const cutoff = new Date(Date.now() - maxSnapshotAgeDays * 86400000).toISOString();

  const rows = db
    .prepare(
      `SELECT tags FROM vault
       WHERE kind != 'brief'
         AND superseded_by IS NULL
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    )
    .all();

  const tagCounts = new Map<string, number>();
  for (const row of rows as Array<{ tags: string | null }>) {
    if (!row.tags) continue;
    try {
      const tags = JSON.parse(row.tags);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    } catch {
      continue;
    }
  }

  const results = [];
  for (const [tag, count] of tagCounts) {
    if (count < tagThreshold) continue;

    const recentBrief = db
      .prepare(
        `SELECT created_at FROM vault
         WHERE kind = 'brief'
           AND tags LIKE ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(`%"${tag}"%`);

    let lastSnapshotAge: number | null = null;
    if (recentBrief) {
      const brief = recentBrief as { created_at: string };
      lastSnapshotAge = Math.round((Date.now() - new Date(brief.created_at).getTime()) / 86400000);
      if (brief.created_at >= cutoff) continue;
    }

    results.push({ tag, entryCount: count, lastSnapshotAge });
  }

  return results.sort((a, b) => b.entryCount - a.entryCount);
}

export function findColdEntries(
  db: DatabaseSync,
  opts: { maxAgeDays?: number; maxHitCount?: number } = {}
): string[] {
  const maxAgeDays = opts.maxAgeDays ?? 90;
  const maxHitCount = opts.maxHitCount ?? 0;
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();

  const rows = db
    .prepare(
      `SELECT id FROM vault
       WHERE created_at < ?
         AND superseded_by IS NULL
         AND COALESCE(hit_count, 0) <= ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    )
    .all(cutoff, maxHitCount);

  return (rows as Array<{ id: string }>).map((r) => r.id);
}
