import { z } from 'zod';
import { ok } from '../helpers.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

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

  const sql = `SELECT id, title, substr(body, 1, 100) as summary, kind, tags
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
    const relevance: 'high' | 'medium' = matchCount >= 2 ? 'high' : 'medium';

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

  const method = hints.length > 0 ? 'tag_match' : 'none';
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

  // Format output
  const lines = [`[Vault: ${hints.length} ${hints.length === 1 ? 'entry' : 'entries'} may be relevant]`];
  for (const h of hints) {
    lines.push(`- "${h.title}" (${h.kind}, ${h.relevance})`);
  }
  lines.push('Use get_context to retrieve full details.');

  const result = ok(lines.join('\n'));
  result._meta = {
    latency_ms: latency,
    method,
    signal_keywords: keywords,
    suppressed,
    hints,
  };
  return result;
}

/** Reset session dedup state (for testing) */
export function _resetSessionState(): void {
  sessionSurfaced.clear();
}
