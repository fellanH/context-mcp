import { z } from 'zod';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { ok, err, ensureVaultExists, kindIcon, fmtDate } from '../helpers.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

const DEFAULT_MAX_TOKENS = 4000;
const RECENT_DAYS = 7;
const MAX_BODY_PER_ENTRY = 400;
const PRIORITY_KINDS = ['decision', 'insight', 'pattern'];
const SESSION_SUMMARY_KIND = 'session';

export const name = 'session_start';

export const description =
  'Auto-assemble a context brief for the current project on session start. Pulls recent entries, last session summary, and active decisions/blockers into a token-budgeted capsule formatted for agent consumption.';

export const inputSchema = {
  project: z
    .string()
    .optional()
    .describe(
      'Project name or tag to scope the brief. Auto-detected from cwd/git remote if not provided.'
    ),
  max_tokens: z
    .number()
    .optional()
    .describe('Token budget for the capsule (rough estimate: 1 token ~ 4 chars). Default: 4000.'),
  buckets: z
    .array(z.string())
    .optional()
    .describe(
      "Bucket names to scope the session brief. Each name expands to a 'bucket:<name>' tag filter. When provided, the brief only includes entries from these buckets."
    ),
};

function detectProject() {
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (remote) {
      const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) return match[1];
    }
  } catch {}

  try {
    const cwd = process.cwd();
    const parts = cwd.split(/[/\\]/);
    return parts[parts.length - 1];
  } catch {}

  return null;
}

function truncateBody(body: string | null | undefined, maxLen = MAX_BODY_PER_ENTRY): string {
  if (!body) return '(no body)';
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + '...';
}

function estimateTokens(text: string | null | undefined): number {
  return Math.ceil((text || '').length / 4);
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

export async function handler(
  { project, max_tokens, buckets }: Record<string, any>,
  ctx: LocalCtx,
  { ensureIndexed }: SharedCtx
): Promise<ToolResult> {
  const { config } = ctx;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  await ensureIndexed();

  // Sanity check: compare DB entries vs disk files
  let indexWarning = '';
  try {
    const dbCount = (ctx.db.prepare('SELECT COUNT(*) as cnt FROM vault').get() as any)?.cnt ?? 0;
    let diskCount = 0;
    const walk = (dir: string, depth = 0) => {
      if (depth > 3 || diskCount >= 100) return;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (diskCount >= 100) return;
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '_archive') {
            walk(`${dir}/${entry.name}`, depth + 1);
          } else if (entry.name.endsWith('.md')) {
            diskCount++;
          }
        }
      } catch {}
    };
    walk(config.vaultDir);
    if (diskCount >= 100 && dbCount < diskCount / 10) {
      indexWarning = `\n> **WARNING:** Vault has significantly more files on disk (~${diskCount}+) than indexed entries (${dbCount}). The search index may be out of sync. Run \`context-vault reconnect\` to fix.\n`;
    }
  } catch {}

  const effectiveProject = project?.trim() || detectProject();
  const tokenBudget = max_tokens || DEFAULT_MAX_TOKENS;

  const bucketTags = buckets?.length ? buckets.map((b: string) => `bucket:${b}`) : [];
  const effectiveTags = bucketTags.length ? bucketTags : effectiveProject ? [effectiveProject] : [];

  const sinceDate = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();

  const sections = [];
  let tokensUsed = 0;

  sections.push(`# Session Brief${effectiveProject ? ` — ${effectiveProject}` : ''}`);
  const bucketsLabel = buckets?.length ? ` | buckets: ${buckets.join(', ')}` : '';
  sections.push(
    `_Generated ${new Date().toISOString().slice(0, 10)} | budget: ${tokenBudget} tokens${bucketsLabel}_\n`
  );
  tokensUsed += estimateTokens(sections.join('\n'));

  const lastSession = queryLastSession(ctx, effectiveTags);
  if (lastSession) {
    const sessionBlock = ['## Last Session Summary', truncateBody(lastSession.body, 600), ''].join(
      '\n'
    );
    const sessionTokens = estimateTokens(sessionBlock);
    if (tokensUsed + sessionTokens <= tokenBudget) {
      sections.push(sessionBlock);
      tokensUsed += sessionTokens;
    }
  }

  const decisions = queryByKinds(
    ctx,
    PRIORITY_KINDS,
    sinceDate,

    effectiveTags
  );
  if (decisions.length > 0) {
    const header = '## Active Decisions, Insights & Patterns\n';
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines = [];
      tokensUsed += headerTokens;
      for (const entry of decisions) {
        const line = formatEntry(entry);
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        entryLines.push(line);
        tokensUsed += lineTokens;
      }
      if (entryLines.length > 0) {
        sections.push(header + entryLines.join('\n') + '\n');
      }
    }
  }

  const recent = queryRecent(ctx, sinceDate, effectiveTags);
  const seenIds = new Set(decisions.map((d: any) => d.id));
  if (lastSession) seenIds.add(lastSession.id);
  const deduped = recent.filter((r: any) => !seenIds.has(r.id));

  if (deduped.length > 0) {
    const header = `## Recent Entries (last ${RECENT_DAYS} days)\n`;
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines = [];
      tokensUsed += headerTokens;
      for (const entry of deduped) {
        const line = formatEntry(entry);
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        entryLines.push(line);
        tokensUsed += lineTokens;
      }
      if (entryLines.length > 0) {
        sections.push(header + entryLines.join('\n') + '\n');
      }
    }
  }

  const totalEntries =
    (lastSession ? 1 : 0) +
    decisions.length +
    deduped.filter((_d: any) => {
      return true;
    }).length;

  if (indexWarning) {
    sections.push(indexWarning);
  }

  sections.push('---');
  sections.push(
    `_${tokensUsed} / ${tokenBudget} tokens used | project: ${effectiveProject || 'unscoped'}_`
  );

  const result: ToolResult = ok(sections.join('\n'));
  result._meta = {
    project: effectiveProject || null,
    buckets: buckets || null,
    tokens_used: tokensUsed,
    tokens_budget: tokenBudget,
    sections: {
      last_session: lastSession ? 1 : 0,
      decisions: decisions.length,
      recent: deduped.length,
    },
  };
  return result;
}

function queryLastSession(ctx: LocalCtx, effectiveTags: string[]): any {
  const clauses = [`kind = '${SESSION_SUMMARY_KIND}'`];
  const params: any[] = [];

  if (false) {
  }
  clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
  clauses.push('superseded_by IS NULL');

  const where = `WHERE ${clauses.join(' AND ')}`;
  const rows = ctx.db
    .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT 5`)
    .all(...params);

  if (effectiveTags.length) {
    const match = rows.find((r: any) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return effectiveTags.some((t: string) => tags.includes(t));
    });
    if (match) return match;
  }
  return rows[0] || null;
}

function queryByKinds(
  ctx: LocalCtx,
  kinds: string[],
  since: string,
  effectiveTags: string[]
): any[] {
  const kindPlaceholders = kinds.map(() => '?').join(',');
  const clauses = [`kind IN (${kindPlaceholders})`];
  const params = [...kinds];

  clauses.push('created_at >= ?');
  params.push(since);

  if (false) {
  }
  clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
  clauses.push('superseded_by IS NULL');

  const where = `WHERE ${clauses.join(' AND ')}`;
  const rows = ctx.db
    .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT 50`)
    .all(...params);

  if (effectiveTags.length) {
    const tagged = rows.filter((r: any) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return effectiveTags.some((t: string) => tags.includes(t));
    });
    if (tagged.length > 0) return tagged;
  }
  return rows;
}

function queryRecent(ctx: LocalCtx, since: string, effectiveTags: string[]): any[] {
  const clauses = ['created_at >= ?'];
  const params = [since];

  if (false) {
  }
  clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
  clauses.push('superseded_by IS NULL');

  const where = `WHERE ${clauses.join(' AND ')}`;
  const rows = ctx.db
    .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT 50`)
    .all(...params);

  if (effectiveTags.length) {
    const tagged = rows.filter((r: any) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return effectiveTags.some((t: string) => tags.includes(t));
    });
    if (tagged.length > 0) return tagged;
  }
  return rows;
}
