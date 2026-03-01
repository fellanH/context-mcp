import type { BaseCtx, SearchResult, SearchOptions, VaultEntry } from "./types.js";

const NEAR_DUP_THRESHOLD = 0.92;
const RRF_K = 60;

export function recencyDecayScore(updatedAt: string | null | undefined, decayRate = 0.05): number {
  if (updatedAt == null) return 0.5;
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86400000;
  return Math.exp(-decayRate * ageDays);
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function buildFtsQuery(query: string): string | null {
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

export function recencyBoost(createdAt: string, category: string, decayDays = 30): number {
  if (category !== "event") return 1.0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return 1 / (1 + ageDays / decayDays);
}

export function buildFilterClauses({
  categoryFilter,
  excludeEvents = false,
  since,
  until,
  includeSuperseeded = false,
}: {
  categoryFilter?: string | null;
  excludeEvents?: boolean;
  since?: string | null;
  until?: string | null;
  includeSuperseeded?: boolean;
}): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (categoryFilter) {
    clauses.push("e.category = ?");
    params.push(categoryFilter);
  }
  if (excludeEvents && !categoryFilter) {
    clauses.push("e.category != 'event'");
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

export function reciprocalRankFusion(
  rankedLists: string[][],
  k: number = RRF_K,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return scores;
}

export async function hybridSearch(
  ctx: BaseCtx,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const {
    kindFilter = null,
    categoryFilter = null,
    excludeEvents = false,
    since = null,
    until = null,
    limit = 20,
    offset = 0,
    decayDays = 30,
    includeSuperseeded = false,
  } = opts;

  const rowMap = new Map<string, VaultEntry>();
  const idToRowid = new Map<string, number>();
  let queryVec: Float32Array | null = null;

  const extraFilters = buildFilterClauses({
    categoryFilter,
    excludeEvents,
    since,
    until,
    includeSuperseeded,
  });

  const ftsRankedIds: string[] = [];

  const ftsQuery = buildFtsQuery(query);
  if (ftsQuery) {
    try {
      const whereParts = ["vault_fts MATCH ?"];
      const ftsParams: unknown[] = [ftsQuery];

      if (kindFilter) {
        whereParts.push("e.kind = ?");
        ftsParams.push(kindFilter);
      }
      whereParts.push(...extraFilters.clauses);
      ftsParams.push(...extraFilters.params);

      const ftsSQL = `SELECT e.*, rank FROM vault_fts f JOIN vault e ON f.rowid = e.rowid WHERE ${whereParts.join(" AND ")} ORDER BY rank LIMIT 15`;
      // @ts-expect-error -- node:sqlite types are overly strict for dynamic SQL params
      const rows = ctx.db.prepare(ftsSQL).all(...ftsParams) as unknown as (VaultEntry & { rank: number })[];

      for (const { rank: _rank, ...row } of rows) {
        ftsRankedIds.push(row.id);
        if (!rowMap.has(row.id)) rowMap.set(row.id, row);
      }
    } catch (err) {
      if (!(err as Error).message?.includes("fts5: syntax error")) {
        console.error(`[retrieve] FTS search error: ${(err as Error).message}`);
      }
    }
  }

  const vecRankedIds: string[] = [];
  const vecSimMap = new Map<string, number>();

  try {
    const vecCount = (ctx.db.prepare("SELECT COUNT(*) as c FROM vault_vec").get() as { c: number }).c;
    if (vecCount > 0) {
      queryVec = await ctx.embed(query);
      if (queryVec) {
        const vecLimit = kindFilter ? 30 : 15;
        const vecRows = ctx.db
          .prepare(
            `SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
          )
          .all(queryVec, vecLimit) as { rowid: number; distance: number }[];

        if (vecRows.length) {
          const rowids = vecRows.map((vr) => vr.rowid);
          const placeholders = rowids.map(() => "?").join(",");
          const hydrated = ctx.db
            .prepare(
              `SELECT rowid, * FROM vault WHERE rowid IN (${placeholders})`,
            )
            .all(...rowids) as unknown as (VaultEntry & { rowid: number })[];

          const byRowid = new Map<number, VaultEntry & { rowid: number }>();
          for (const row of hydrated) byRowid.set(row.rowid, row);

          for (const vr of vecRows) {
            const row = byRowid.get(vr.rowid);
            if (!row) continue;
            if (kindFilter && row.kind !== kindFilter) continue;
            if (categoryFilter && row.category !== categoryFilter) continue;
            if (excludeEvents && row.category === "event") continue;
            if (since && row.created_at < since) continue;
            if (until && row.created_at > until) continue;
            if (row.expires_at && new Date(row.expires_at) <= new Date())
              continue;

            const { rowid: _rowid, ...cleanRow } = row;
            idToRowid.set(cleanRow.id, Number(row.rowid));

            const vecSim = Math.max(0, 1 - vr.distance / 2);
            vecSimMap.set(cleanRow.id, vecSim);
            vecRankedIds.push(cleanRow.id);

            if (!rowMap.has(cleanRow.id)) rowMap.set(cleanRow.id, cleanRow);
          }
        }
      }
    }
  } catch (err) {
    if (!(err as Error).message?.includes("no such table")) {
      console.error(`[retrieve] Vector search error: ${(err as Error).message}`);
    }
  }

  if (rowMap.size === 0) return [];

  const rrfScores = reciprocalRankFusion([ftsRankedIds, vecRankedIds]);

  for (const [id, entry] of rowMap) {
    const boost = recencyBoost(entry.created_at, entry.category, decayDays);
    rrfScores.set(id, (rrfScores.get(id) ?? 0) * boost);
  }

  const candidates: SearchResult[] = [...rowMap.values()].map((entry) => ({
    ...entry,
    score: rrfScores.get(entry.id) ?? 0,
  }));
  candidates.sort((a, b) => b.score - a.score);

  const embeddingMap = new Map<string, Float32Array>();
  if (queryVec && idToRowid.size > 0) {
    const rowidToId = new Map<number, string>();
    for (const [id, rowid] of idToRowid) rowidToId.set(rowid, id);

    const rowidsToFetch = [...idToRowid.values()];
    try {
      const placeholders = rowidsToFetch.map(() => "?").join(",");
      const vecData = ctx.db
        .prepare(
          `SELECT rowid, embedding FROM vault_vec WHERE rowid IN (${placeholders})`,
        )
        .all(...rowidsToFetch) as { rowid: number; embedding: Buffer }[];
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
    } catch {
      // Embeddings unavailable
    }
  }

  if (queryVec && embeddingMap.size > 0) {
    const selected: SearchResult[] = [];
    const selectedVecs: Float32Array[] = [];
    for (const candidate of candidates) {
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
    trackAccess(ctx, dedupedPage);
    return dedupedPage;
  }

  const finalPage = candidates.slice(offset, offset + limit);
  trackAccess(ctx, finalPage);
  return finalPage;
}

function trackAccess(ctx: BaseCtx, entries: SearchResult[]): void {
  if (!entries.length) return;
  try {
    const placeholders = entries.map(() => "?").join(",");
    ctx.db
      .prepare(
        `UPDATE vault SET hit_count = hit_count + 1, last_accessed_at = datetime('now') WHERE id IN (${placeholders})`,
      )
      .run(...entries.map((e) => e.id));
  } catch {
    // Non-fatal
  }
}
