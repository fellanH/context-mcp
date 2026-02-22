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
const NEAR_DUP_THRESHOLD = 0.92;

/**
 * Dot product of two Float32Array vectors (cosine similarity for unit vectors).
 */
export function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Build a tiered FTS5 query that prioritises phrase match, then proximity,
 * then AND.  Multi-word queries become:
 *   "word1 word2" OR NEAR("word1" "word2", 10) OR "word1" AND "word2"
 * Single-word queries remain a simple quoted term.
 * Returns null if no valid words remain after stripping FTS5 metacharacters.
 */
export function buildFtsQuery(query) {
  const words = query
    .split(/[\s-]+/)
    .map((w) => w.replace(/[*"():^~{}]/g, ""))
    .filter((w) => w.length > 0);
  if (!words.length) return null;
  if (words.length === 1) return `"${words[0]}"`;
  const phrase = `"${words.join(" ")}"`;
  const near = `NEAR(${words.map((w) => `"${w}"`).join(" ")}, 10)`;
  const and = words.map((w) => `"${w}"`).join(" AND ");
  return `${phrase} OR ${near} OR ${and}`;
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
  const idToRowid = new Map();
  let queryVec = null;
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
      queryVec = await ctx.embed(query);
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
            idToRowid.set(cleanRow.id, Number(row.rowid));
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

  // Near-duplicate suppression: when embeddings are available and we have more
  // candidates than needed, skip results that are too similar to already-selected ones.
  if (queryVec && idToRowid.size > 0 && sorted.length > limit) {
    const rowidsToFetch = sorted
      .filter((c) => idToRowid.has(c.id))
      .map((c) => idToRowid.get(c.id));

    const embeddingMap = new Map();
    if (rowidsToFetch.length > 0) {
      try {
        const placeholders = rowidsToFetch.map(() => "?").join(",");
        const vecData = ctx.db
          .prepare(
            `SELECT rowid, embedding FROM vault_vec WHERE rowid IN (${placeholders})`,
          )
          .all(...rowidsToFetch);
        for (const row of vecData) {
          const buf = row.embedding;
          if (buf) {
            embeddingMap.set(
              Number(row.rowid),
              new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
            );
          }
        }
      } catch (_) {
        return sorted.slice(offset, offset + limit);
      }
    }

    const selected = [];
    const selectedVecs = [];
    for (const candidate of sorted) {
      if (selected.length >= offset + limit) break;
      const rowid = idToRowid.get(candidate.id);
      const vec = rowid !== undefined ? embeddingMap.get(rowid) : null;
      if (vec && selectedVecs.length > 0) {
        let maxSim = 0;
        for (const sv of selectedVecs) {
          const sim = dotProduct(sv, vec);
          if (sim > maxSim) maxSim = sim;
        }
        if (maxSim > NEAR_DUP_THRESHOLD) continue;
      }
      selected.push(candidate);
      if (vec) selectedVecs.push(vec);
    }
    return selected.slice(offset, offset + limit);
  }

  return sorted.slice(offset, offset + limit);
}
