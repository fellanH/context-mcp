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
function buildFtsQuery(query) {
  const words = query
    .split(/\s+/)
    .map((w) => w.replace(/[*"()\-:^~{}]/g, ""))
    .filter((w) => w.length > 0);
  if (!words.length) return null;
  return words.map((w) => `"${w}"`).join(" AND ");
}

/**
 * Gentle recency decay: 1.0 for today, ~0.87 at 30 days, ~0.69 at 90 days.
 */
function recencyBoost(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return 1 / (1 + ageDays / 200);
}

/**
 * Hybrid search combining FTS5 text matching and vector similarity.
 *
 * @param {{ db, embed }} ctx
 * @param {string} query
 * @param {{ kindFilter?: string|null, limit?: number, offset?: number }} opts
 * @returns {Promise<Array<{id, kind, title, body, meta, tags, source, file_path, created_at, score}>>}
 */
export async function hybridSearch(
  ctx,
  query,
  { kindFilter = null, limit = 20, offset = 0 } = {}
) {
  const results = new Map();

  // FTS5 search
  const ftsQuery = buildFtsQuery(query);
  if (ftsQuery) {
    try {
      const ftsSQL = kindFilter
        ? `SELECT e.*, rank FROM vault_fts f JOIN vault e ON f.rowid = e.rowid WHERE vault_fts MATCH ? AND e.kind = ? ORDER BY rank LIMIT 15`
        : `SELECT e.*, rank FROM vault_fts f JOIN vault e ON f.rowid = e.rowid WHERE vault_fts MATCH ? ORDER BY rank LIMIT 15`;

      const rows = kindFilter
        ? ctx.db.prepare(ftsSQL).all(ftsQuery, kindFilter)
        : ctx.db.prepare(ftsSQL).all(ftsQuery);

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

  // Vector similarity search
  try {
    const vecCount = ctx.db
      .prepare("SELECT COUNT(*) as c FROM vault_vec")
      .get().c;
    if (vecCount > 0) {
      const queryVec = await ctx.embed(query);
      const vecLimit = kindFilter ? 30 : 15;
      const vecRows = ctx.db
        .prepare(
          `SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT ${vecLimit}`
        )
        .all(queryVec);

      if (vecRows.length) {
        // Batch hydration: single query instead of N+1
        const rowids = vecRows.map((vr) => vr.rowid);
        const placeholders = rowids.map(() => "?").join(",");
        const hydrated = ctx.db
          .prepare(`SELECT rowid, * FROM vault WHERE rowid IN (${placeholders})`)
          .all(...rowids);

        const byRowid = new Map();
        for (const row of hydrated) byRowid.set(row.rowid, row);

        for (const vr of vecRows) {
          const row = byRowid.get(vr.rowid);
          if (row && (!kindFilter || row.kind === kindFilter)) {
            const { rowid: _rowid, ...cleanRow } = row;
            const vecScore = (1 - vr.distance) * VEC_WEIGHT;
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

  // Apply recency boost
  for (const [, entry] of results) {
    entry.score *= recencyBoost(entry.created_at);
  }

  const sorted = [...results.values()].sort((a, b) => b.score - a.score);
  return sorted.slice(offset, offset + limit);
}
