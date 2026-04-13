import { z } from 'zod';
import { ok } from '../helpers.js';
import { hybridSearch } from '@context-vault/core/search';
import { getAutoMemory, findAutoMemoryOverlaps } from '../auto-memory.js';
import { getRemoteClient, getTeamId, getPublicVaults } from '../remote.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';
import type { SearchOptions } from '@context-vault/core/types';

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
 * Split on whitespace, filter stopwords and words under 2 chars, keep top 10.
 */
export function extractKeywords(signal: string): string[] {
  const words = signal
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

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

  // Build search query from signal, enriched by signal_type
  let searchQuery = signal || '';
  const searchOpts: SearchOptions = {
    excludeEvents: true,
    limit: limit * 3, // over-fetch to allow for session dedup + bucket filtering
  };

  // Signal-type aware search options
  switch (signal_type) {
    case 'error':
      // Errors should boost recent entries
      searchOpts.decayDays = 7;
      break;
    case 'file':
      // Extract path components and extension as additional search terms
      searchQuery = signal
        .replace(/[/\\]/g, ' ')
        .replace(/\./g, ' ')
        .trim();
      break;
    case 'task':
      // Tasks benefit from wider search
      searchOpts.limit = Math.max(searchOpts.limit!, limit * 5);
      break;
    // 'prompt': standard hybrid search, no modifications
  }

  // Run hybrid search (FTS + vector + tag lanes with RRF fusion)
  let searchResults = await hybridSearch(ctx, searchQuery, searchOpts);

  // Bucket-aware post-filtering
  if (bucket) {
    const bucketTag = `bucket:${bucket}`;
    searchResults = searchResults.filter((r) => {
      if (!r.tags) return false;
      try {
        const tags: string[] = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
        return tags.some((t) => t === bucketTag);
      } catch {
        return String(r.tags).includes(bucketTag);
      }
    });
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

  for (const row of searchResults) {
    if (hints.length >= limit) break;

    // Dedup check
    if (sessionSet && !bypassDedup && sessionSet.has(row.id)) {
      suppressed++;
      continue;
    }

    const entryTags: string[] = row.tags
      ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags)
      : [];

    const relevance: 'high' | 'medium' = row.score >= 0.02 ? 'high' : 'medium';

    hints.push({
      id: row.id,
      title: row.title || '(untitled)',
      summary: row.body ? row.body.slice(0, 100) : '',
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

  const method: 'hybrid' | 'none' = hints.length > 0 ? 'hybrid' : 'none';

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
