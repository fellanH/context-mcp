/**
 * Retrieve Layer — Public API
 *
 * All read-path query logic: hybrid semantic search and any future
 * query patterns (scoped, recency-weighted, etc.).
 *
 * Agent Constraint: Read-only access to DB. Never writes.
 */

const NEAR_DUP_THRESHOLD = 0.92;

const RRF_K = 60;

const MMR_LAMBDA = 0.7;

/**
 * Exponential recency decay score based on updated_at timestamp.
 * Returns e^(-decayRate * ageDays) for valid dates, or 0.5 as a neutral
 * score when updatedAt is null/undefined.
 *
 * @param {string|null|undefined} updatedAt - ISO timestamp
 * @param {number} decayRate - Decay rate per day (default 0.05)
 * @returns {number} Score in [0, 1]
 */
export function recencyDecayScore(updatedAt, decayRate = 0.05) {
  if (updatedAt == null) return 0.5;
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86400000;
  return Math.exp(-decayRate * ageDays);
}

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
  includeSuperseeded = false,
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
  if (!includeSuperseeded) {
    clauses.push("e.superseded_by IS NULL");
  }
  return { clauses, params };
}

/**
 * Reciprocal Rank Fusion: merge multiple ranked lists into a single score.
 * Each document receives 1/(k + rank) from each list it appears in.
 *
 * @param {Array<string[]>} rankedLists - Arrays of document IDs in rank order (best first).
 * @param {number} k - Smoothing constant (default RRF_K = 60).
 * @returns {Map<string, number>} Map of id -> RRF score.
 */
export function reciprocalRankFusion(rankedLists, k = RRF_K) {
  const scores = new Map();
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return scores;
}

/**
 * Jaccard similarity between two strings based on word sets.
 * Used as a fallback for MMR when embedding vectors are unavailable.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Similarity in [0, 1].
 */
export function jaccardSimilarity(a, b) {
  const wordsA = new Set((a ?? "").toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set((b ?? "").toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  return intersection / (wordsA.size + wordsB.size - intersection);
}

/**
 * Maximal Marginal Relevance reranking.
 *
 * Selects up to n candidates that balance relevance to the query and
 * diversity from already-selected results.
 *
 * MMR_score = lambda * querySim(doc) - (1 - lambda) * max(sim(doc, selected))
 *
 * @param {Array<object>} candidates - Entries with at least {id, title, body}.
 * @param {Map<string, number>} querySimMap - Map of id -> relevance score.
 * @param {Map<string, Float32Array|null>} embeddingMap - Map of id -> embedding (null if unavailable).
 * @param {number} n - Number of results to select.
 * @param {number} lambda - Trade-off weight (default MMR_LAMBDA = 0.7).
 * @returns {Array<object>} Reranked subset of candidates (length <= n).
 */
export function maximalMarginalRelevance(
  candidates,
  querySimMap,
  embeddingMap,
  n,
  lambda = MMR_LAMBDA,
) {
  if (candidates.length === 0) return [];

  const remaining = [...candidates];
  const selected = [];
  const selectedVecs = [];
  const selectedEntries = [];

  while (selected.length < n && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = querySimMap.get(candidate.id) ?? 0;

      let maxRedundancy = 0;
      if (selectedVecs.length > 0) {
        const vec = embeddingMap.get(candidate.id);
        for (let j = 0; j < selectedVecs.length; j++) {
          let sim;
          if (vec && selectedVecs[j]) {
            sim = dotProduct(vec, selectedVecs[j]);
          } else {
            const selEntry = selectedEntries[j];
            sim = jaccardSimilarity(
              `${candidate.title} ${candidate.body}`,
              `${selEntry.title} ${selEntry.body}`,
            );
          }
          if (sim > maxRedundancy) maxRedundancy = sim;
        }
      }

      const score = lambda * relevance - (1 - lambda) * maxRedundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);
    selectedVecs.push(embeddingMap.get(chosen.id) ?? null);
    selectedEntries.push(chosen);
  }

  return selected;
}

/**
 * Hybrid search combining FTS5 text matching and vector similarity,
 * with RRF merging and MMR reranking for diversity.
 *
 * Pipeline:
 *   1. FTS5 ranked list
 *   2. Vector (semantic) ranked list
 *   3. RRF: merge the two ranked lists into a single score
 *   4. Apply recency decay to RRF scores
 *   5. MMR: rerank top candidates for diversity (uses embeddings or Jaccard fallback)
 *   6. Near-duplicate suppression on the final selection
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
    includeSuperseeded = false,
  } = {},
) {
  const rowMap = new Map();
  const idToRowid = new Map();
  let queryVec = null;

  const extraFilters = buildFilterClauses({
    categoryFilter,
    since,
    until,
    userIdFilter,
    teamIdFilter,
    includeSuperseeded,
  });

  const ftsRankedIds = [];

  // Stage 1a: FTS5 — collect ranked list of IDs
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

      for (const { rank: _rank, ...row } of rows) {
        ftsRankedIds.push(row.id);
        if (!rowMap.has(row.id)) rowMap.set(row.id, row);
      }
    } catch (err) {
      if (!err.message?.includes("fts5: syntax error")) {
        console.error(`[retrieve] FTS search error: ${err.message}`);
      }
    }
  }

  const vecRankedIds = [];
  const vecSimMap = new Map();

  // Stage 1b: Vector similarity — collect ranked list of IDs and raw similarity scores
  try {
    const vecCount = ctx.db
      .prepare("SELECT COUNT(*) as c FROM vault_vec")
      .get().c;
    if (vecCount > 0) {
      queryVec = await ctx.embed(query);
      if (queryVec) {
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
            // Convert to similarity [0, 1]: 1 - distance/2
            const vecSim = Math.max(0, 1 - vr.distance / 2);
            vecSimMap.set(cleanRow.id, vecSim);
            vecRankedIds.push(cleanRow.id);

            if (!rowMap.has(cleanRow.id)) rowMap.set(cleanRow.id, cleanRow);
          }
        }
      }
    }
  } catch (err) {
    if (!err.message?.includes("no such table")) {
      console.error(`[retrieve] Vector search error: ${err.message}`);
    }
  }

  if (rowMap.size === 0) return [];

  // Stage 2: RRF — merge FTS and vector ranked lists into a single score
  const rrfScores = reciprocalRankFusion([ftsRankedIds, vecRankedIds]);

  // Stage 3: Apply category-aware recency boost to RRF scores
  for (const [id, entry] of rowMap) {
    const boost = recencyBoost(entry.created_at, entry.category, decayDays);
    rrfScores.set(id, (rrfScores.get(id) ?? 0) * boost);
  }

  // Stage 3b: Frequency signal — log(1 + hit_count) / log(1 + max_hit_count)
  const allRows = [...rowMap.values()];
  const maxHitCount = Math.max(...allRows.map((e) => e.hit_count || 0), 0);
  if (maxHitCount > 0) {
    const logMax = Math.log(1 + maxHitCount);
    for (const entry of allRows) {
      const freqScore = Math.log(1 + (entry.hit_count || 0)) / logMax;
      rrfScores.set(
        entry.id,
        (rrfScores.get(entry.id) ?? 0) + freqScore * 0.13,
      );
    }
  }

  // Attach final score to each entry and sort by RRF score descending
  const candidates = [...rowMap.values()].map((entry) => ({
    ...entry,
    score: rrfScores.get(entry.id) ?? 0,
  }));
  candidates.sort((a, b) => b.score - a.score);

  // Stage 4: Fetch embeddings for all candidates that have a rowid
  const embeddingMap = new Map();
  if (queryVec && idToRowid.size > 0) {
    const rowidToId = new Map();
    for (const [id, rowid] of idToRowid) rowidToId.set(rowid, id);

    const rowidsToFetch = [...idToRowid.values()];
    try {
      const placeholders = rowidsToFetch.map(() => "?").join(",");
      const vecData = ctx.db
        .prepare(
          `SELECT rowid, embedding FROM vault_vec WHERE rowid IN (${placeholders})`,
        )
        .all(...rowidsToFetch);
      for (const row of vecData) {
        const id = rowidToId.get(Number(row.rowid));
        const buf = row.embedding;
        if (id && buf) {
          embeddingMap.set(
            id,
            new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
          );
        }
      }
    } catch (_) {
      // Embeddings unavailable — MMR will fall back to Jaccard similarity
    }
  }

  // Use vecSim as the query-relevance signal for MMR; fall back to RRF score
  const querySimMap = new Map();
  for (const candidate of candidates) {
    querySimMap.set(
      candidate.id,
      vecSimMap.has(candidate.id)
        ? vecSimMap.get(candidate.id)
        : candidate.score,
    );
  }

  // Stage 5: MMR — rerank for diversity using embeddings or Jaccard fallback
  const mmrSelected = maximalMarginalRelevance(
    candidates,
    querySimMap,
    embeddingMap,
    offset + limit,
  );

  // Stage 6: Near-duplicate suppression (hard filter, not reorder)
  if (queryVec && embeddingMap.size > 0 && mmrSelected.length > limit) {
    const selected = [];
    const selectedVecs = [];
    for (const candidate of mmrSelected) {
      if (selected.length >= offset + limit) break;
      const vec = embeddingMap.get(candidate.id);
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
    const dedupedPage = selected.slice(offset, offset + limit);
    trackAccess(ctx.db, dedupedPage);
    return dedupedPage;
  }

  const finalPage = mmrSelected.slice(offset, offset + limit);
  trackAccess(ctx.db, finalPage);
  return finalPage;
}

/**
 * Increment hit_count and set last_accessed_at for a batch of retrieved entries.
 * Single batched UPDATE for efficiency.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Array<{id: string}>} entries
 */
function trackAccess(db, entries) {
  if (!entries.length) return;
  try {
    const placeholders = entries.map(() => "?").join(",");
    db.prepare(
      `UPDATE vault SET hit_count = hit_count + 1, last_accessed_at = datetime('now') WHERE id IN (${placeholders})`,
    ).run(...entries.map((e) => e.id));
  } catch (_) {
    // Non-fatal: frequency tracking is best-effort
  }
}
