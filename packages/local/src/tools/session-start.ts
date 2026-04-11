import { z } from 'zod';
import { ok } from '../helpers.js';
import { isEmbedAvailable } from '@context-vault/core/embed';
import { getAutoMemory, findAutoMemoryOverlaps } from '../auto-memory.js';
import { getRemoteClient, getTeamId, getPublicVaults } from '../remote.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

const SEMANTIC_SIMILARITY_THRESHOLD = 0.6;
const CO_RETRIEVAL_WEIGHT_CAP = 50;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'for', 'with',
  'from', 'into', 'during', 'before', 'after', 'above', 'below',
  'to', 'of', 'in', 'on', 'at', 'by', 'about', 'between', 'through',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
  'their', 'we', 'our', 'you', 'your', 'he', 'she', 'him', 'her',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
  'just', 'also', 'now', 'then', 'here', 'there', 'when', 'where',
  'how', 'what', 'which', 'who', 'whom', 'why', 'if', 'because',
  'as', 'until', 'while', 'use', 'using', 'used',
]);

const DEFAULT_MAX_HINTS = 3;

/** Module-level session dedup map: session_id -> Set of surfaced entry IDs */
const sessionSurfaced = new Map<string, Set<string>>();

/**
 * Extract keywords from a signal string.
 * Split on whitespace, filter stopwords and words under 4 chars, keep top 10.
 */
export function extractKeywords(signal: string): string[] {
  const words = signal
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    unique.push(w);
    if (unique.length >= 10) break;
  }
  return unique;
}

export const name = 'recall';

export const description =
  'Search the vault using a raw signal (prompt text, error message, file path, or task context). Returns lightweight hints for proactive surfacing. Designed for runtime hooks, not direct user interaction.';

export const inputSchema = {
  signal: z
    .string()
    .describe('Raw text: prompt, error message, file path, or combined signal.'),
  signal_type: z
    .enum(['prompt', 'error', 'file', 'task'])
    .describe('Type of signal, used to weight results.'),
  bucket: z
    .string()
    .optional()
    .describe('Scope results to a project bucket.'),
  session_id: z
    .string()
    .optional()
    .describe('Session identifier for dedup. Entries already surfaced this session are suppressed.'),
  max_hints: z
    .number()
    .optional()
    .describe('Maximum hints to return. Default: 3.'),
};

export async function handler(
  { signal, signal_type, bucket, session_id, max_hints }: Record<string, any>,
  ctx: LocalCtx,
  { ensureIndexed }: SharedCtx
): Promise<ToolResult> {
  const start = Date.now();

  await ensureIndexed();

  const keywords = extractKeywords(signal || '');
  const limit = max_hints ?? DEFAULT_MAX_HINTS;

  if (keywords.length === 0) {
    const result = ok('No relevant entries found.');
    result._meta = {
      latency_ms: Date.now() - start,
      method: 'none' as const,
      signal_keywords: [],
      suppressed: 0,
    };
    return result;
  }

  // Build fast-path query: tag/title LIKE match for each keyword
  const conditions: string[] = [];
  const params: string[] = [];
  for (const kw of keywords) {
    conditions.push('(title LIKE ? OR tags LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`);
  }

  const bucketClause = bucket ? ' AND tags LIKE ?' : '';
  if (bucket) params.push(`%"bucket:${bucket}"%`);

  const sql = `SELECT id, title, substr(body, 1, 100) as summary, kind, tags, tier
    FROM vault
    WHERE indexed = 1
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND superseded_by IS NULL
      AND (${conditions.join(' OR ')})${bucketClause}
    LIMIT 20`;

  let rows: any[];
  try {
    rows = ctx.db.prepare(sql).all(...params);
  } catch {
    rows = [];
  }

  // Session dedup
  let suppressed = 0;
  const bypassDedup = signal_type === 'error';
  const sessionSet = session_id
    ? (sessionSurfaced.get(session_id) ?? (() => { const s = new Set<string>(); sessionSurfaced.set(session_id, s); return s; })())
    : null;

  const hints: Array<{
    id: string;
    title: string;
    summary: string;
    relevance: 'high' | 'medium';
    kind: string;
    tags: string[];
  }> = [];

  for (const row of rows) {
    if (hints.length >= limit) break;

    // Dedup check
    if (sessionSet && !bypassDedup && sessionSet.has(row.id)) {
      suppressed++;
      continue;
    }

    const entryTags: string[] = row.tags ? JSON.parse(row.tags) : [];

    // Score relevance: count how many keywords match title or tags
    let matchCount = 0;
    const titleLower = (row.title || '').toLowerCase();
    const tagsLower = (row.tags || '').toLowerCase();
    for (const kw of keywords) {
      if (titleLower.includes(kw) || tagsLower.includes(kw)) matchCount++;
    }
    const isDurable = row.tier === 'durable';
    const relevance: 'high' | 'medium' = (matchCount >= 2 || (isDurable && matchCount >= 1)) ? 'high' : 'medium';

    hints.push({
      id: row.id,
      title: row.title || '(untitled)',
      summary: row.summary || '',
      relevance,
      kind: row.kind || 'knowledge',
      tags: entryTags,
    });

    // Track surfaced
    if (sessionSet) sessionSet.add(row.id);
  }

  // Remote recall: merge hints from hosted API
  const remoteClient = getRemoteClient(ctx.config);
  if (remoteClient && hints.length < limit) {
    try {
      const remoteHints = await remoteClient.recall({
        signal,
        signal_type,
        bucket,
        max_hints: limit - hints.length,
      });
      const localIds = new Set(hints.map(h => h.id));
      for (const rh of remoteHints) {
        if (hints.length >= limit) break;
        if (localIds.has(rh.id)) continue;
        if (sessionSet && !bypassDedup && sessionSet.has(rh.id)) {
          suppressed++;
          continue;
        }
        hints.push(rh);
        if (sessionSet) sessionSet.add(rh.id);
      }
    } catch (e) {
      console.warn(`[context-vault] Remote recall failed: ${(e as Error).message}`);
    }
  }

  // Team vault recall: include team results if teamId is configured
  const teamId = getTeamId(ctx.config);
  if (remoteClient && teamId && hints.length < limit) {
    try {
      const teamHints = await remoteClient.teamRecall(teamId, {
        signal,
        signal_type,
        bucket,
        max_hints: limit - hints.length,
      });
      const existingIds = new Set(hints.map(h => h.id));
      for (const th of teamHints) {
        if (hints.length >= limit) break;
        if (existingIds.has(th.id)) continue;
        if (sessionSet && !bypassDedup && sessionSet.has(th.id)) {
          suppressed++;
          continue;
        }
        hints.push({ ...th, tags: [...(th.tags || []), '[team]'] });
        if (sessionSet) sessionSet.add(th.id);
      }
    } catch (e) {
      console.warn(`[context-vault] Team recall failed: ${(e as Error).message}`);
    }
  }

  // Public vault recall: query each configured public vault
  const publicVaultSlugs = getPublicVaults(ctx.config);
  if (remoteClient && publicVaultSlugs.length > 0 && hints.length < limit) {
    const publicRecalls = publicVaultSlugs.map(slug =>
      remoteClient.publicRecall(slug, {
        signal,
        signal_type,
        bucket,
        max_hints: limit - hints.length,
      }).catch(e => {
        console.warn(`[context-vault] Public vault "${slug}" recall failed: ${(e as Error).message}`);
        return [];
      })
    );
    try {
      const allPublicHints = await Promise.all(publicRecalls);
      const existingIds = new Set(hints.map(h => h.id));
      for (const publicHints of allPublicHints) {
        for (const ph of publicHints) {
          if (hints.length >= limit) break;
          if (existingIds.has(ph.id)) continue;
          if (sessionSet && !bypassDedup && sessionSet.has(ph.id)) {
            suppressed++;
            continue;
          }
          hints.push({ ...ph, tags: [...(ph.tags || []), '[public]'] });
          if (sessionSet) sessionSet.add(ph.id);
        }
      }
    } catch (e) {
      console.warn(`[context-vault] Public vault recall failed: ${(e as Error).message}`);
    }
  }

  let method: 'tag_match' | 'semantic' | 'durable_semantic' | 'none' = hints.length > 0 ? 'tag_match' : 'none';

  // Associative recall: always search durables semantically (regardless of keyword hits)
  if (signal_type !== 'file' && isEmbedAvailable()) {
    try {
      const durableCount = (
        ctx.db.prepare("SELECT COUNT(*) as c FROM vault_vec v JOIN vault e ON e.rowid = v.rowid WHERE e.tier = 'durable'").get() as { c: number }
      ).c;

      if (durableCount > 0) {
        const queryVec = await ctx.embed(signal);
        if (queryVec) {
          // KNN against all vectors, then filter to durables in hydration
          const vecRows = ctx.db
            .prepare(
              'SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT 15'
            )
            .all(queryVec) as { rowid: number; distance: number }[];

          // Merge content vectors (vault_vec) and context vectors (vault_ctx_vec)
          // Content vectors match on what the entry says; context vectors match on
          // when/where the decision applies (encoding_context), bridging vocabulary gaps.
          let ctxVecRows: { rowid: number; distance: number }[] = [];
          try {
            const ctxVecCount = (
              ctx.db.prepare('SELECT COUNT(*) as c FROM vault_ctx_vec').get() as { c: number }
            ).c;
            if (ctxVecCount > 0) {
              ctxVecRows = ctx.db
                .prepare(
                  'SELECT v.rowid, v.distance FROM vault_ctx_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT 15'
                )
                .all(queryVec) as { rowid: number; distance: number }[];
            }
          } catch {
            // vault_ctx_vec may not exist or be empty
          }

          // Combine both vector result sets, keeping best distance per rowid
          const mergedDistMap = new Map<number, number>();
          for (const vr of vecRows) {
            mergedDistMap.set(vr.rowid, vr.distance);
          }
          for (const cr of ctxVecRows) {
            const existing = mergedDistMap.get(cr.rowid);
            if (existing === undefined || cr.distance < existing) {
              mergedDistMap.set(cr.rowid, cr.distance);
            }
          }

          const allRowids = [...mergedDistMap.keys()];
          if (allRowids.length) {
            const placeholders = allRowids.map(() => '?').join(',');

            const hydrated = ctx.db
              .prepare(
                `SELECT rowid, id, title, substr(body, 1, 150) as summary, kind, tags, tier FROM vault
                 WHERE rowid IN (${placeholders})
                 AND tier = 'durable'
                 AND indexed = 1
                 AND (expires_at IS NULL OR expires_at > datetime('now'))
                 AND superseded_by IS NULL`
              )
              .all(...allRowids) as any[];

            const byRowid = new Map<number, any>();
            for (const row of hydrated) byRowid.set(row.rowid, row);
            const existingIds = new Set(hints.map(h => h.id));

            // Sort by distance (best first)
            const sorted = allRowids
              .map(rowid => ({ rowid, distance: mergedDistMap.get(rowid)! }))
              .sort((a, b) => a.distance - b.distance);

            for (const { rowid, distance } of sorted) {
              if (hints.length >= limit + 2) break;
              const row = byRowid.get(rowid);
              if (!row) continue;
              if (existingIds.has(row.id)) continue;

              const similarity = Math.max(0, 1 - distance / 2);
              if (similarity < 0.45) continue;

              if (sessionSet && !bypassDedup && sessionSet.has(row.id)) {
                suppressed++;
                continue;
              }

              hints.push({
                id: row.id,
                title: row.title || '(untitled)',
                summary: row.summary || '',
                relevance: similarity >= 0.6 ? 'high' : 'medium',
                kind: row.kind || 'knowledge',
                tags: row.tags ? JSON.parse(row.tags) : [],
              });

              if (sessionSet) sessionSet.add(row.id);
            }

            if (method === 'none' && hints.length > 0) method = 'durable_semantic';
          }
        }
      }
    } catch {
      // Associative recall is best-effort
    }
  }

  // Semantic fallback: when fast-path returns 0 results and signal is not file-based
  if (hints.length === 0 && signal_type !== 'file' && isEmbedAvailable()) {
    try {
      const vecCount = (
        ctx.db.prepare('SELECT COUNT(*) as c FROM vault_vec').get() as { c: number }
      ).c;

      if (vecCount > 0) {
        const queryVec = await ctx.embed(signal);
        if (queryVec) {
          const vecRows = ctx.db
            .prepare(
              'SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT 5'
            )
            .all(queryVec) as { rowid: number; distance: number }[];

          if (vecRows.length) {
            const rowids = vecRows.map((vr) => vr.rowid);
            const placeholders = rowids.map(() => '?').join(',');

            let bucketFilter = '';
            const hydrateParams: any[] = [...rowids];
            if (bucket) {
              bucketFilter = ' AND tags LIKE ?';
              hydrateParams.push(`%"bucket:${bucket}"%`);
            }

            const hydrated = ctx.db
              .prepare(
                `SELECT rowid, id, title, substr(body, 1, 100) as summary, kind, tags FROM vault WHERE rowid IN (${placeholders}) AND indexed = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) AND superseded_by IS NULL${bucketFilter}`
              )
              .all(...hydrateParams) as any[];

            const byRowid = new Map<number, any>();
            for (const row of hydrated) byRowid.set(row.rowid, row);

            for (const vr of vecRows) {
              if (hints.length >= limit) break;
              const row = byRowid.get(vr.rowid);
              if (!row) continue;

              const similarity = Math.max(0, 1 - vr.distance / 2);
              if (similarity < SEMANTIC_SIMILARITY_THRESHOLD) continue;

              // Session dedup
              if (sessionSet && !bypassDedup && sessionSet.has(row.id)) {
                suppressed++;
                continue;
              }

              const entryTags: string[] = row.tags ? JSON.parse(row.tags) : [];
              hints.push({
                id: row.id,
                title: row.title || '(untitled)',
                summary: row.summary || '',
                relevance: similarity >= 0.8 ? 'high' : 'medium',
                kind: row.kind || 'knowledge',
                tags: entryTags,
              });

              if (sessionSet) sessionSet.add(row.id);
            }

            if (hints.length > 0) method = 'semantic';
          }
        }
      }
    } catch {
      // Semantic fallback is best-effort; fast path already ran
    }
  }

  const latency = Date.now() - start;

  if (hints.length === 0) {
    const result = ok('No relevant entries found.');
    result._meta = {
      latency_ms: latency,
      method,
      signal_keywords: keywords,
      suppressed,
    };
    return result;
  }

  // Record co-retrieval pairs (fire and forget, non-blocking)
  if (hints.length >= 2) {
    recordCoRetrieval(ctx, hints.map((h) => h.id));
  }

  // Check for auto-memory overlap to avoid redundant surfacing
  let autoMemoryOverlaps: Array<{ hint_id: string; memory_file: string; memory_name: string }> = [];
  try {
    const autoMemory = getAutoMemory();
    if (autoMemory.detected && autoMemory.entries.length > 0) {
      for (const h of hints) {
        const searchText = [h.title, h.summary].filter(Boolean).join(' ');
        const overlaps = findAutoMemoryOverlaps(autoMemory, searchText, 0.3);
        if (overlaps.length > 0) {
          autoMemoryOverlaps.push({
            hint_id: h.id,
            memory_file: overlaps[0].file,
            memory_name: overlaps[0].name,
          });
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // Format output
  const lines = [`[Vault: ${hints.length} ${hints.length === 1 ? 'entry' : 'entries'} may be relevant]`];
  for (const h of hints) {
    const overlap = autoMemoryOverlaps.find(o => o.hint_id === h.id);
    const overlapNote = overlap ? ` [also in auto-memory: ${overlap.memory_name}]` : '';
    lines.push(`- "${h.title}" (${h.kind}, ${h.relevance})${overlapNote}`);
  }
  lines.push('Use get_context to retrieve full details.');

  const result = ok(lines.join('\n'));
  result._meta = {
    latency_ms: latency,
    method,
    signal_keywords: keywords,
    suppressed,
    hints,
    auto_memory_overlaps: autoMemoryOverlaps.length > 0 ? autoMemoryOverlaps : undefined,
  };
  return result;
}

function recordCoRetrieval(ctx: LocalCtx, ids: string[]): void {
  try {
    const now = new Date().toISOString();
    const upsert = ctx.db.prepare(
      `INSERT INTO co_retrievals (entry_a, entry_b, count, last_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(entry_a, entry_b) DO UPDATE SET count = MIN(count + 1, ?), last_at = ?`
    );
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        upsert.run(a, b, now, CO_RETRIEVAL_WEIGHT_CAP, now);
      }
    }
  } catch {
    // Non-fatal: co-retrieval recording is best-effort
  }
}

/** Reset session dedup state (for testing) */
export function _resetSessionState(): void {
  sessionSurfaced.clear();
}
