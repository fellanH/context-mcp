import type { BaseCtx, SearchResult, SearchOptions, VaultEntry } from './types.js';
import { embedBatch } from './embed.js';

const NEAR_DUP_THRESHOLD = 0.92;
const RRF_K = 60;
const RECALL_BOOST_CAP = 2.0;
const RECALL_HALF_LIFE_DAYS = 30;
const DISCOVERY_SLOTS = 2;

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
    .map((w) => w.replace(/[*"():^~{}]/g, ''))
    .filter((w) => w.length > 0);
  if (!words.length) return null;
  if (words.length === 1) return `"${words[0]}"`;
  const phrase = `"${words.join(' ')}"`;
  const near = `NEAR(${words.map((w) => `"${w}"`).join(' ')}, 10)`;
  const and = words.map((w) => `"${w}"`).join(' AND ');
  return `${phrase} OR ${near} OR ${and}`;
}

export function recencyBoost(createdAt: string, category: string, decayDays = 30): number {
  if (category !== 'event') return 1.0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return 1 / (1 + ageDays / decayDays);
}

export function recallBoost(recallCount: number, lastRecalledAt: string | null): number {
  if (recallCount <= 0) return 1.0;
  const logBoost = Math.log(recallCount + 1);
  let recencyWeight = 1.0;
  if (lastRecalledAt) {
    const ageDays = (Date.now() - new Date(lastRecalledAt).getTime()) / 86400000;
    recencyWeight = Math.pow(0.5, ageDays / RECALL_HALF_LIFE_DAYS);
  }
  const boost = 1 + logBoost * recencyWeight;
  return Math.min(boost, RECALL_BOOST_CAP);
}

export function buildFilterClauses({
  categoryFilter,
  excludeEvents = false,
  since,
  until,
  includeSuperseeded = false,
  includeEphemeral = false,
}: {
  categoryFilter?: string | null;
  excludeEvents?: boolean;
  since?: string | null;
  until?: string | null;
  includeSuperseeded?: boolean;
  includeEphemeral?: boolean;
}): { clauses: string[]; params: (string | number | null)[] } {
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (categoryFilter) {
    clauses.push('e.category = ?');
    params.push(categoryFilter);
  }
  if (excludeEvents && !categoryFilter) {
    clauses.push("e.category != 'event'");
  }
  if (since) {
    clauses.push('e.created_at >= ?');
    params.push(since);
  }
  if (until) {
    clauses.push('e.created_at <= ?');
    params.push(until);
  }
  clauses.push("(e.expires_at IS NULL OR e.expires_at > datetime('now'))");
  if (!includeSuperseeded) {
    clauses.push('e.superseded_by IS NULL');
  }
  if (!includeEphemeral) {
    clauses.push("e.tier != 'ephemeral'");
  }
  clauses.push('e.indexed = 1');
  return { clauses, params };
}

export function reciprocalRankFusion(
  rankedLists: string[][],
  k: number = RRF_K
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
  opts: SearchOptions = {}
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
    includeEphemeral = false,
    contextEmbedding = null,
    trackMeta,
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
    includeEphemeral,
  });

  const ftsRankedIds: string[] = [];

  const ftsQuery = buildFtsQuery(query);
  if (ftsQuery) {
    try {
      const whereParts = ['vault_fts MATCH ?'];
      const ftsParams: (string | number | null)[] = [ftsQuery];

      if (kindFilter) {
        whereParts.push('e.kind = ?');
        ftsParams.push(kindFilter);
      }
      whereParts.push(...extraFilters.clauses);
      ftsParams.push(...extraFilters.params);

      const ftsSQL = `SELECT e.*, rank FROM vault_fts f JOIN vault e ON f.rowid = e.rowid WHERE ${whereParts.join(' AND ')} ORDER BY rank LIMIT 15`;
      const rows = ctx.db.prepare(ftsSQL).all(...ftsParams) as unknown as (VaultEntry & {
        rank: number;
      })[];

      for (const { rank: _rank, ...row } of rows) {
        ftsRankedIds.push(row.id);
        if (!rowMap.has(row.id)) rowMap.set(row.id, row);
      }
    } catch (err) {
      if (!(err as Error).message?.includes('fts5: syntax error')) {
        console.error(`[retrieve] FTS search error: ${(err as Error).message}`);
      }
    }
  }

  // Lazy embedding: generate missing embeddings for entries found by FTS.
  // This handles the case where reindex ran with skipEmbeddings (deferred mode).
  // Only embeds what FTS found (small batch), not the entire vault.
  // Guards: only embed entries where indexed=1 AND category!='event' (same rules as reindex).
  if (ftsRankedIds.length > 0) {
    try {
      const eligibleIds = ftsRankedIds.filter((id) => {
        const entry = rowMap.get(id);
        return entry && entry.indexed !== 0 && entry.category !== 'event';
      });

      if (eligibleIds.length > 0) {
        const ftsRowids = eligibleIds
          .map((id) => {
            const row = ctx.db.prepare('SELECT rowid FROM vault WHERE id = ?').get(id) as { rowid: number } | undefined;
            return row ? { id, rowid: row.rowid } : null;
          })
          .filter((r): r is { id: string; rowid: number } => r !== null);

        if (ftsRowids.length > 0) {
          const placeholders = ftsRowids.map(() => '?').join(',');
          const existingVec = new Set(
            (ctx.db.prepare(`SELECT rowid FROM vault_vec WHERE rowid IN (${placeholders})`).all(
              ...ftsRowids.map((r) => r.rowid)
            ) as { rowid: number }[]).map((r) => r.rowid)
          );

          const missing = ftsRowids.filter((r) => !existingVec.has(r.rowid));
          if (missing.length > 0) {
            const entries = missing.map((r) => {
              const entry = rowMap.get(r.id);
              return { rowid: r.rowid, text: [entry?.title, entry?.body].filter(Boolean).join(' ') };
            });
            const embeddings = await embedBatch(entries.map((e) => e.text));
            for (let i = 0; i < entries.length; i++) {
              if (embeddings[i]) {
                try { ctx.deleteVec(entries[i].rowid); } catch {}
                ctx.insertVec(entries[i].rowid, embeddings[i]!);
              }
            }
          }
        }
      }
    } catch (err) {
      // Non-fatal: vector search will just have fewer candidates
      console.error(`[search] Lazy embedding failed: ${(err as Error).message}`);
    }
  }

  const vecRankedIds: string[] = [];
  const vecSimMap = new Map<string, number>();

  try {
    const vecCount = (
      ctx.db.prepare('SELECT COUNT(*) as c FROM vault_vec').get() as {
        c: number;
      }
    ).c;
    if (vecCount > 0) {
      queryVec = await ctx.embed(query);
      if (queryVec) {
        const vecLimit = kindFilter ? 30 : 15;
        const vecRows = ctx.db
          .prepare(
            `SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
          )
          .all(queryVec, vecLimit) as { rowid: number; distance: number }[];

        if (vecRows.length) {
          const rowids = vecRows.map((vr) => vr.rowid);
          const placeholders = rowids.map(() => '?').join(',');
          const hydrated = ctx.db
            .prepare(`SELECT rowid, * FROM vault WHERE rowid IN (${placeholders})`)
            .all(...rowids) as unknown as (VaultEntry & { rowid: number })[];

          const byRowid = new Map<number, VaultEntry & { rowid: number }>();
          for (const row of hydrated) byRowid.set(row.rowid, row);

          for (const vr of vecRows) {
            const row = byRowid.get(vr.rowid);
            if (!row) continue;
            if (kindFilter && row.kind !== kindFilter) continue;
            if (categoryFilter && row.category !== categoryFilter) continue;
            if (excludeEvents && row.category === 'event') continue;
            if (since && row.created_at < since) continue;
            if (until && row.created_at > until) continue;
            if (row.expires_at && new Date(row.expires_at) <= new Date()) continue;
            if (!row.indexed) continue;

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
    if (!(err as Error).message?.includes('no such table')) {
      console.error(`[retrieve] Vector search error: ${(err as Error).message}`);
    }
  }

  // Context vector pass: KNN against vault_ctx_vec for contextual reinstatement
  const ctxRankedIds: string[] = [];
  if (contextEmbedding) {
    try {
      const ctxVecCount = (
        ctx.db.prepare('SELECT COUNT(*) as c FROM vault_ctx_vec').get() as { c: number }
      ).c;
      if (ctxVecCount > 0) {
        const ctxRows = ctx.db
          .prepare(
            `SELECT v.rowid, v.distance FROM vault_ctx_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT 15`
          )
          .all(contextEmbedding, 15) as { rowid: number; distance: number }[];

        if (ctxRows.length) {
          const ctxRowids = ctxRows.map((cr) => cr.rowid);
          const placeholders = ctxRowids.map(() => '?').join(',');
          const ctxHydrated = ctx.db
            .prepare(`SELECT rowid, * FROM vault WHERE rowid IN (${placeholders})`)
            .all(...ctxRowids) as unknown as (VaultEntry & { rowid: number })[];

          const ctxByRowid = new Map<number, VaultEntry & { rowid: number }>();
          for (const row of ctxHydrated) ctxByRowid.set(row.rowid, row);

          for (const cr of ctxRows) {
            const row = ctxByRowid.get(cr.rowid);
            if (!row) continue;
            if (kindFilter && row.kind !== kindFilter) continue;
            if (categoryFilter && row.category !== categoryFilter) continue;
            if (excludeEvents && row.category === 'event') continue;
            if (since && row.created_at < since) continue;
            if (until && row.created_at > until) continue;
            if (row.expires_at && new Date(row.expires_at) <= new Date()) continue;
            if (!row.indexed) continue;

            const { rowid: _rowid, ...cleanRow } = row;
            ctxRankedIds.push(cleanRow.id);
            if (!rowMap.has(cleanRow.id)) rowMap.set(cleanRow.id, cleanRow);
            if (!idToRowid.has(cleanRow.id)) idToRowid.set(cleanRow.id, Number(row.rowid));
          }
        }
      }
    } catch (err) {
      if (!(err as Error).message?.includes('no such table')) {
        console.error(`[retrieve] Context vector search error: ${(err as Error).message}`);
      }
    }
  }

  if (rowMap.size === 0) return [];

  // Build ranked lists for RRF: content FTS + content vec + optional context vec
  const rankedLists = [ftsRankedIds, vecRankedIds];
  if (ctxRankedIds.length > 0) rankedLists.push(ctxRankedIds);
  const rrfScores = reciprocalRankFusion(rankedLists);

  for (const [id, entry] of rowMap) {
    const boost = recencyBoost(entry.created_at, entry.category, decayDays);
    const recall = recallBoost(
      entry.recall_count ?? 0,
      entry.last_recalled_at ?? null
    );
    const durable = entry.tier === 'durable' ? 1.3 : 1.0;
    rrfScores.set(id, (rrfScores.get(id) ?? 0) * boost * recall * durable);
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
      const placeholders = rowidsToFetch.map(() => '?').join(',');
      const vecData = ctx.db
        .prepare(`SELECT rowid, embedding FROM vault_vec WHERE rowid IN (${placeholders})`)
        .all(...rowidsToFetch) as { rowid: number; embedding: Buffer }[];
      for (const row of vecData) {
        const id = rowidToId.get(Number(row.rowid));
        const buf = row.embedding;
        if (id && buf) {
          embeddingMap.set(id, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
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
    const dedupedPage = injectDiscoverySlots(selected.slice(offset, offset + limit), candidates);
    attachFreshnessScores(dedupedPage);
    trackAccess(ctx, dedupedPage, trackMeta);
    return dedupedPage;
  }

  const page = candidates.slice(offset, offset + limit);
  const finalPage = injectDiscoverySlots(page, candidates);
  attachFreshnessScores(finalPage);
  trackAccess(ctx, finalPage, trackMeta);
  return finalPage;
}

function attachFreshnessScores(results: SearchResult[]): void {
  for (const entry of results) {
    const { score, label } = computeFreshnessScore(entry);
    entry.freshness_score = score;
    entry.freshness_label = label;
  }
}

function injectDiscoverySlots(
  page: SearchResult[],
  allCandidates: SearchResult[]
): SearchResult[] {
  if (page.length < 4) return page;
  const pageIds = new Set(page.map((e) => e.id));
  const discoveries = allCandidates
    .filter(
      (c) =>
        !pageIds.has(c.id) &&
        (c.recall_count ?? 0) <= 2 &&
        c.score > 0
    )
    .slice(0, DISCOVERY_SLOTS);
  if (!discoveries.length) return page;
  const result = [...page];
  for (let i = 0; i < discoveries.length && result.length > 2; i++) {
    result.splice(result.length - 1 - i, 1, discoveries[i]);
  }
  return result;
}

let _sessionId: string | null = null;
const _seenSessionIds = new Set<string>();

export function setSessionId(id: string): void {
  _sessionId = id;
}

export function trackAccess(ctx: BaseCtx, entries: SearchResult[], meta?: { query?: string; sessionGoal?: string }): void {
  if (!entries.length) return;

  const ids = entries.map((e) => e.id);
  const now = new Date().toISOString();

  try {
    const placeholders = ids.map(() => '?').join(',');
    ctx.db
      .prepare(
        `UPDATE vault SET hit_count = hit_count + 1, last_accessed_at = datetime('now'), recall_count = recall_count + 1, last_recalled_at = ? WHERE id IN (${placeholders})`
      )
      .run(now, ...ids);
  } catch {
    // Non-fatal
  }

  const sessionId = _sessionId || 'default';
  const sessionKey = `${sessionId}:${ids.sort().join(',')}`;
  const isNewSession = !_seenSessionIds.has(sessionKey);
  if (isNewSession) {
    _seenSessionIds.add(sessionKey);
    try {
      const placeholders = ids.map(() => '?').join(',');
      ctx.db
        .prepare(
          `UPDATE vault SET recall_sessions = recall_sessions + 1 WHERE id IN (${placeholders})`
        )
        .run(...ids);
    } catch {
      // Non-fatal
    }
  }

  if (ids.length >= 2) {
    try {
      const upsert = ctx.db.prepare(
        `INSERT INTO co_retrievals (entry_a, entry_b, count, last_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(entry_a, entry_b) DO UPDATE SET count = count + 1, last_at = ?`
      );
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
          upsert.run(a, b, now, now);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Write per-access rows to access_log for adaptive tiering
  try {
    const insertLog = ctx.db.prepare(
      `INSERT INTO access_log (entry_id, query, session_id, session_goal, accessed_at) VALUES (?, ?, ?, ?, ?)`
    );
    const sid = _sessionId || 'default';
    for (const entry of entries) {
      insertLog.run(entry.id, meta?.query ?? null, sid, meta?.sessionGoal ?? null, now);
    }
  } catch {
    // Non-fatal
  }

  // Compute and write heat_tier for each accessed entry
  try {
    const updateHeat = ctx.db.prepare(`UPDATE vault SET heat_tier = ? WHERE id = ?`);
    for (const entry of entries) {
      const recallCount = (entry.recall_count ?? 0) + 1;
      const recallSessions = entry.recall_sessions ?? 0;
      // Just recalled, so recency bonus is 10 (0 days since last recall)
      const heat = (recallCount * 3) + (recallSessions * 2) + 10;
      const tier = heat > 10 ? 'hot' : heat >= 1 ? 'warm' : null;
      updateHeat.run(tier, entry.id);
    }
  } catch {
    // Non-fatal
  }
}

export function computeFreshnessScore(entry: {
  created_at: string;
  updated_at: string | null;
  last_accessed_at: string | null;
  last_recalled_at: string | null;
  recall_count: number;
  recall_sessions: number;
  hit_count: number;
  kind: string;
}): { score: number; label: 'fresh' | 'aging' | 'stale' | 'dormant' } {
  const now = Date.now();

  // Recency (0-25): most recent of updated_at, last_accessed_at, last_recalled_at
  // Full score if < 7 days, linear decay to 0 at 90 days
  const candidates = [entry.updated_at, entry.last_accessed_at, entry.last_recalled_at]
    .filter((d): d is string => d != null)
    .map((d) => new Date(d).getTime());
  const mostRecent = candidates.length > 0 ? Math.max(...candidates) : new Date(entry.created_at).getTime();
  const recencyDays = (now - mostRecent) / 86400000;
  const recency = recencyDays <= 7 ? 25 : recencyDays >= 90 ? 0 : Math.round(25 * (1 - (recencyDays - 7) / 83));

  // Recall frequency (0-25): based on recall_count
  const rc = entry.recall_count ?? 0;
  const recallFreq = rc === 0 ? 0 : rc <= 3 ? 10 : rc <= 10 ? 18 : 25;

  // Session spread (0-25): based on recall_sessions
  const rs = entry.recall_sessions ?? 0;
  const sessionSpread = rs === 0 ? 0 : rs === 1 ? 5 : rs <= 3 ? 12 : rs <= 7 ? 18 : 25;

  // Update freshness (0-25): entries that are updated stay fresh
  const createdAt = new Date(entry.created_at).getTime();
  const updatedAt = entry.updated_at ? new Date(entry.updated_at).getTime() : createdAt;
  const wasUpdated = updatedAt > createdAt + 60000; // more than 1 min difference counts as updated
  let updateFreshness: number;
  if (wasUpdated) {
    const updateAgeDays = (now - updatedAt) / 86400000;
    updateFreshness = updateAgeDays <= 7 ? 25 : updateAgeDays >= 90 ? 5 : Math.round(5 + 20 * (1 - (updateAgeDays - 7) / 83));
  } else {
    const ageDays = (now - createdAt) / 86400000;
    updateFreshness = ageDays <= 7 ? 15 : ageDays >= 90 ? 0 : Math.round(15 * (1 - (ageDays - 7) / 83));
  }

  const score = Math.max(0, Math.min(100, recency + recallFreq + sessionSpread + updateFreshness));
  const label: 'fresh' | 'aging' | 'stale' | 'dormant' =
    score >= 75 ? 'fresh' : score >= 50 ? 'aging' : score >= 25 ? 'stale' : 'dormant';

  return { score, label };
}

export function computeHeatForEntry(entry: { recall_count: number; recall_sessions: number; last_recalled_at: string | null; created_at: string }): { heat: number; tier: 'hot' | 'warm' | 'cold' | null } {
  const recallCount = entry.recall_count ?? 0;
  const recallSessions = entry.recall_sessions ?? 0;

  let recencyBonus = 0;
  if (entry.last_recalled_at) {
    const daysSinceRecall = (Date.now() - new Date(entry.last_recalled_at).getTime()) / 86400000;
    recencyBonus = Math.max(0, 10 - daysSinceRecall);
  }

  const heat = (recallCount * 3) + (recallSessions * 2) + recencyBonus;

  if (heat > 10) return { heat, tier: 'hot' };
  if (heat >= 1) return { heat, tier: 'warm' };

  const ageDays = (Date.now() - new Date(entry.created_at).getTime()) / 86400000;
  if (ageDays > 30) return { heat, tier: 'cold' };

  return { heat, tier: null };
}
