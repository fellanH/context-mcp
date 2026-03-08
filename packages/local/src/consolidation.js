export function findHotTags(db, opts = {}) {
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

  const tagCounts = new Map();
  for (const row of rows) {
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

    let lastSnapshotAge = null;
    if (recentBrief) {
      lastSnapshotAge = Math.round(
        (Date.now() - new Date(recentBrief.created_at).getTime()) / 86400000
      );
      if (recentBrief.created_at >= cutoff) continue;
    }

    results.push({ tag, entryCount: count, lastSnapshotAge });
  }

  return results.sort((a, b) => b.entryCount - a.entryCount);
}

export function findColdEntries(db, opts = {}) {
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

  return rows.map((r) => r.id);
}
