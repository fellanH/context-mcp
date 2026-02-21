/**
 * Retrieve Layer — Public API
 *
 * All read-path query logic: hybrid semantic search and any future
 * query patterns (scoped, recency-weighted, etc.).
 *
 * Agent Constraint: Read-only access to DB. Never writes.
 */

const FTS_WEIGHT = 0.4;
const VEC_WEIGHT = 0.6;

/**
 * Strip FTS5 metacharacters from query words and build an AND query.
 * Returns null if no valid words remain.
 */
export function buildFtsQuery(query) {
  const words = query
    .split(/[\s-]+/)
    .map((w) => w.replace(/[*"():^~{}]/g, ""))
    .filter((w) => w.length > 0);
  if (!words.length) return null;
  return words.map((w) => `"${w}"`).join(" AND ");
}

/**
 * Category-aware recency decay:
 *   knowledge + entity: no decay (enduring)
 *   event: steeper decay (~0.5 at 30 days)
 */
export function recencyBoost(createdAt, category, decayDays = 30) {
  if (category !== "event") return 1.0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return 1 / (1 + ageDays / decayDays);
}

/**
 * Build additional WHERE clauses for category/time filtering.
 * Returns { clauses: string[], params: any[] }
 */
export function buildFilterClauses({
  categoryFilter,
  since,
  until,
  userIdFilter,
  teamIdFilter,
}) {
  const clauses = [];
  const params = [];
  if (userIdFilter !== undefined) {
    clauses.push("e.user_id = ?");
    params.push(userIdFilter);
  }
  if (teamIdFilter) {
    clauses.push("e.team_id = ?");
    params.push(teamIdFilter);
  }
  if (categoryFilter) {
    clauses.push("e.category = ?");
    params.push(categoryFilter);
  }
  if (since) {
    clauses.push("e.created_at >= ?");
    params.push(since);
  }
  if (until) {
    clauses.push("e.created_at <= ?");
    params.push(until);
  }
  clauses.push("(e.expires_at IS NULL OR e.expires_at > datetime('now'))");
  return { clauses, params };
}

/**
 * Hybrid search combining FTS5 text matching and vector similarity.
 *
 * @param {import('../server/types.js').BaseCtx} ctx
 * @param {string} query
 * @param {{ kindFilter?: string|null, categoryFilter?: string|null, since?: string|null, until?: string|null, limit?: number, offset?: number }} opts
 * @returns {Promise<Array<{id, kind, category, title, body, meta, tags, source, file_path, created_at, score}>>}
 */
export async function hybridSearch(
  ctx,
  query,
  {
    kindFilter = null,
    categoryFilter = null,
    since = null,
    until = null,
    limit = 20,
    offset = 0,
    decayDays = 30,
    userIdFilter,
    teamIdFilter = null,
  } = {},
) {
  const results = new Map();
  const extraFilters = buildFilterClauses({
    categoryFilter,
    since,
    until,
    userIdFilter,
    teamIdFilter,
  });

  // FTS5 search
  const ftsQuery = buildFtsQuery(query);
  if (ftsQuery) {
    try {
      const whereParts = ["vault_fts MATCH ?"];
      const ftsParams = [ftsQuery];

      if (kindFilter) {
        whereParts.push("e.kind = ?");
        ftsParams.push(kindFilter);
      }
      whereParts.push(...extraFilters.clauses);
      ftsParams.push(...extraFilters.params);

      const ftsSQL = `SELECT e.*, rank FROM vault_fts f JOIN vault e ON f.rowid = e.rowid WHERE ${whereParts.join(" AND ")} ORDER BY rank LIMIT 15`;
      const rows = ctx.db.prepare(ftsSQL).all(...ftsParams);

      // Normalize FTS scores to [0, 1]
      const ftsScores = rows.map((r) => Math.abs(r.rank || 0));
      const maxFts = Math.max(...ftsScores, 1);

      for (let i = 0; i < rows.length; i++) {
        const { rank: _rank, ...row } = rows[i];
        const normalized = ftsScores[i] / maxFts;
        results.set(row.id, { ...row, score: normalized * FTS_WEIGHT });
      }
    } catch (err) {
      if (err.message?.includes("fts5: syntax error")) {
        // Expected: malformed query, fall through to vector search
      } else {
        console.error(`[retrieve] FTS search error: ${err.message}`);
      }
    }
  }

  // Vector similarity search (skipped if embedding unavailable)
  try {
    const vecCount = ctx.db
      .prepare("SELECT COUNT(*) as c FROM vault_vec")
      .get().c;
    if (vecCount > 0) {
      const queryVec = await ctx.embed(query);
      if (queryVec) {
        // Increase limits in hosted mode to compensate for post-filtering
        const hasPostFilter = userIdFilter !== undefined || teamIdFilter;
        const vecLimit = hasPostFilter
          ? kindFilter
            ? 60
            : 30
          : kindFilter
            ? 30
            : 15;
        const vecRows = ctx.db
          .prepare(
            `SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
          )
          .all(queryVec, vecLimit);

        if (vecRows.length) {
          // Batch hydration: single query instead of N+1
          const rowids = vecRows.map((vr) => vr.rowid);
          const placeholders = rowids.map(() => "?").join(",");
          const hydrated = ctx.db
            .prepare(
              `SELECT rowid, * FROM vault WHERE rowid IN (${placeholders})`,
            )
            .all(...rowids);

          const byRowid = new Map();
          for (const row of hydrated) byRowid.set(row.rowid, row);

          for (const vr of vecRows) {
            const row = byRowid.get(vr.rowid);
            if (!row) continue;
            if (userIdFilter !== undefined && row.user_id !== userIdFilter)
              continue;
            if (teamIdFilter && row.team_id !== teamIdFilter) continue;
            if (kindFilter && row.kind !== kindFilter) continue;
            if (categoryFilter && row.category !== categoryFilter) continue;
            if (since && row.created_at < since) continue;
            if (until && row.created_at > until) continue;
            if (row.expires_at && new Date(row.expires_at) <= new Date())
              continue;

            const { rowid: _rowid, ...cleanRow } = row;
            // sqlite-vec returns L2 distance [0, 2] for normalized vectors.
            // Convert to similarity [1, 0] with: 1 - distance/2
            const vecScore = Math.max(0, 1 - vr.distance / 2) * VEC_WEIGHT;
            const existing = results.get(cleanRow.id);
            if (existing) {
              existing.score += vecScore;
            } else {
              results.set(cleanRow.id, { ...cleanRow, score: vecScore });
            }
          }
        }
      }
    }
  } catch (err) {
    if (err.message?.includes("no such table")) {
      // Expected on fresh vaults with no vec table yet
    } else {
      console.error(`[retrieve] Vector search error: ${err.message}`);
    }
  }

  // Apply category-aware recency boost
  for (const [, entry] of results) {
    entry.score *= recencyBoost(entry.created_at, entry.category, decayDays);
  }

  const sorted = [...results.values()].sort((a, b) => b.score - a.score);
  return sorted.slice(offset, offset + limit);
}
