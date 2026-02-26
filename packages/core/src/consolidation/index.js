/**
 * Consolidation utilities — identifies tags and entries that warrant maintenance.
 *
 * These are pure DB queries with no LLM calls. The caller decides what to do
 * with the results (e.g. run create_snapshot, archive entries, report to user).
 */

/**
 * Identifies tags that have accumulated enough entries to warrant consolidation.
 *
 * A tag is "hot" when it has >= tagThreshold non-superseded entries AND no
 * brief/snapshot was saved for it within the last maxSnapshotAgeDays days.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ tagThreshold?: number, maxSnapshotAgeDays?: number }} [opts]
 * @returns {{ tag: string, entryCount: number, lastSnapshotAge: number | null }[]}
 */
export function findHotTags(
  db,
  { tagThreshold = 10, maxSnapshotAgeDays = 7 } = {},
) {
  const rows = db
    .prepare(
      `SELECT id, tags, kind FROM vault
       WHERE superseded_by IS NULL
         AND tags IS NOT NULL
         AND tags != '[]'`,
    )
    .all();

  const tagCounts = new Map();

  for (const row of rows) {
    let tags;
    try {
      tags = JSON.parse(row.tags);
    } catch {
      continue;
    }
    if (!Array.isArray(tags)) continue;

    for (const tag of tags) {
      if (typeof tag !== "string" || !tag) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const hotTags = [];

  for (const [tag, count] of tagCounts) {
    if (count < tagThreshold) continue;

    const snapshotRow = db
      .prepare(
        `SELECT created_at FROM vault
         WHERE kind = 'brief'
           AND tags LIKE ?
           AND created_at > datetime('now', '-' || ? || ' days')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(`%"${tag}"%`, String(maxSnapshotAgeDays));

    if (snapshotRow) continue;

    const lastSnapshotAny = db
      .prepare(
        `SELECT created_at FROM vault
         WHERE kind = 'brief'
           AND tags LIKE ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(`%"${tag}"%`);

    let lastSnapshotAge = null;
    if (lastSnapshotAny) {
      const ms = Date.now() - new Date(lastSnapshotAny.created_at).getTime();
      lastSnapshotAge = Math.floor(ms / (1000 * 60 * 60 * 24));
    }

    hotTags.push({ tag, entryCount: count, lastSnapshotAge });
  }

  hotTags.sort((a, b) => b.entryCount - a.entryCount);

  return hotTags;
}

/**
 * Identifies cold entries (old, never or rarely accessed) that can be archived.
 *
 * Returns IDs of entries that are old enough, have low hit counts, are not
 * superseded, and are not in permanent kinds (decision, architecture, brief).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ maxAgeDays?: number, maxHitCount?: number }} [opts]
 * @returns {string[]} Entry IDs eligible for archiving
 */
export function findColdEntries(db, { maxAgeDays = 90, maxHitCount = 0 } = {}) {
  const rows = db
    .prepare(
      `SELECT id FROM vault
       WHERE hit_count <= ?
         AND created_at < datetime('now', '-' || ? || ' days')
         AND superseded_by IS NULL
         AND kind NOT IN ('decision', 'architecture', 'brief')`,
    )
    .all(maxHitCount, String(maxAgeDays));

  return rows.map((r) => r.id);
}
