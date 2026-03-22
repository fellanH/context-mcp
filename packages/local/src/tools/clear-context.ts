import { z } from 'zod';
import { ok, ensureVaultExists, kindIcon, fmtDate } from '../helpers.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

const DEFAULT_PRELOAD_TOKENS = 2000;
const MAX_BODY_PER_ENTRY = 300;
const RECENT_DAYS = 7;
const PRIORITY_KINDS = ['decision', 'insight', 'pattern'];

export const name = 'clear_context';

export const description =
  'Reset active in-memory session context without deleting vault entries. Call this when switching projects or topics mid-session. With `scope`, all subsequent get_context calls should filter to that tag/project. Vault data is never modified.';

export const inputSchema = {
  scope: z
    .string()
    .optional()
    .describe(
      'Optional tag or project name to focus on going forward. When provided, treat subsequent get_context calls as if filtered to this tag.'
    ),
  preload_bucket: z
    .string()
    .optional()
    .describe(
      'Bucket name to preload context from after clearing. Loads recent decisions, insights, and patterns scoped to this bucket into the response so the agent has immediate context for the new project.'
    ),
  max_tokens: z
    .number()
    .optional()
    .describe(
      'Token budget for preloaded context (rough estimate: 1 token ~ 4 chars). Default: 2000. Only applies when preload_bucket is set.'
    ),
};

function estimateTokens(text: string | null | undefined): number {
  return Math.ceil((text || '').length / 4);
}

function truncateBody(body: string | null | undefined, maxLen = MAX_BODY_PER_ENTRY): string {
  if (!body) return '(no body)';
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + '...';
}

function formatEntry(entry: any): string {
  const tags = entry.tags ? JSON.parse(entry.tags) : [];
  const tagStr = tags.length ? tags.join(', ') : '';
  const date = fmtDate(entry.updated_at || entry.created_at);
  const icon = kindIcon(entry.kind);
  const meta = [`\`${entry.kind}\``, tagStr, date].filter(Boolean).join(' · ');
  return [
    `- ${icon} **${entry.title || '(untitled)'}**`,
    `  ${meta} · \`${entry.id}\``,
    `  ${truncateBody(entry.body).replace(/\n+/g, ' ').trim()}`,
  ].join('\n');
}

function preloadBucketContext(
  ctx: LocalCtx,
  bucket: string,
  tokenBudget: number
): { sections: string[]; tokensUsed: number; entryCount: number } {
  const sections: string[] = [];
  let tokensUsed = 0;
  let entryCount = 0;

  const bucketTag = `bucket:${bucket}`;
  const sinceDate = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();

  // Query priority kinds (decisions, insights, patterns)
  const kindPlaceholders = PRIORITY_KINDS.map(() => '?').join(',');
  const priorityRows = ctx.db
    .prepare(
      `SELECT * FROM vault
       WHERE kind IN (${kindPlaceholders})
         AND created_at >= ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))
         AND superseded_by IS NULL
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all(...PRIORITY_KINDS, sinceDate) as any[];

  // Filter to bucket-tagged entries
  const taggedPriority = priorityRows.filter((r: any) => {
    const tags = r.tags ? JSON.parse(r.tags) : [];
    return tags.includes(bucketTag);
  });

  if (taggedPriority.length > 0) {
    const header = '### Active Decisions, Insights & Patterns\n';
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines: string[] = [];
      tokensUsed += headerTokens;
      for (const entry of taggedPriority) {
        const line = formatEntry(entry);
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        entryLines.push(line);
        tokensUsed += lineTokens;
        entryCount++;
      }
      if (entryLines.length > 0) {
        sections.push(header + entryLines.join('\n'));
      }
    }
  }

  // Query recent entries (any kind)
  const recentRows = ctx.db
    .prepare(
      `SELECT * FROM vault
       WHERE created_at >= ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))
         AND superseded_by IS NULL
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all(sinceDate) as any[];

  const seenIds = new Set(taggedPriority.map((r: any) => r.id));
  const taggedRecent = recentRows.filter((r: any) => {
    if (seenIds.has(r.id)) return false;
    const tags = r.tags ? JSON.parse(r.tags) : [];
    return tags.includes(bucketTag);
  });

  if (taggedRecent.length > 0) {
    const header = `\n### Recent Entries (last ${RECENT_DAYS} days)\n`;
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines: string[] = [];
      tokensUsed += headerTokens;
      for (const entry of taggedRecent) {
        const line = formatEntry(entry);
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        entryLines.push(line);
        tokensUsed += lineTokens;
        entryCount++;
      }
      if (entryLines.length > 0) {
        sections.push(header + entryLines.join('\n'));
      }
    }
  }

  return { sections, tokensUsed, entryCount };
}

export async function handler(
  { scope, preload_bucket, max_tokens }: { scope?: string; preload_bucket?: string; max_tokens?: number } = {},
  ctx?: LocalCtx,
  shared?: SharedCtx
): Promise<ToolResult> {
  const lines = [
    '## Context Reset',
    '',
    'Active session context has been cleared. All previous context from this session should be disregarded.',
    '',
    'Vault entries are unchanged -- no data was deleted.',
  ];

  const trimmedScope = scope?.trim() || '';
  // If preload_bucket is set but scope is not, infer scope from the bucket
  const effectiveScope = trimmedScope || preload_bucket?.trim() || '';

  if (effectiveScope) {
    lines.push(
      '',
      `### Active Scope: \`${effectiveScope}\``,
      '',
      `Going forward, treat \`get_context\` calls as scoped to the tag or project **"${effectiveScope}"** unless the user explicitly requests a different scope or passes their own tag filters.`
    );
  } else {
    lines.push('', 'No scope set. Use `get_context` normally -- all vault entries are accessible.');
  }

  // Preload bucket context if requested and ctx is available
  const bucket = preload_bucket?.trim();
  let preloadMeta: Record<string, unknown> = {};
  if (bucket && ctx) {
    const vaultErr = ensureVaultExists(ctx.config);
    if (vaultErr) {
      lines.push('', `> **Warning:** Could not preload bucket context: vault not found.`);
    } else {
      if (shared?.ensureIndexed) {
        await shared.ensureIndexed({ blocking: false });
      }

      const tokenBudget = max_tokens || DEFAULT_PRELOAD_TOKENS;
      const { sections, tokensUsed, entryCount } = preloadBucketContext(ctx, bucket, tokenBudget);

      if (sections.length > 0) {
        lines.push(
          '',
          `## Preloaded Context: \`${bucket}\``,
          `_${entryCount} entries | ${tokensUsed} / ${tokenBudget} tokens used_`,
          '',
          ...sections
        );
      } else {
        lines.push(
          '',
          `_No recent entries found in bucket \`${bucket}\`. Use \`get_context\` to search across all entries._`
        );
      }

      preloadMeta = {
        preload_bucket: bucket,
        preload_entries: entryCount,
        preload_tokens_used: tokensUsed,
        preload_tokens_budget: tokenBudget,
      };
    }
  }

  const result: ToolResult = ok(lines.join('\n'));
  result._meta = {
    scope: effectiveScope || null,
    ...preloadMeta,
  };
  return result;
}
