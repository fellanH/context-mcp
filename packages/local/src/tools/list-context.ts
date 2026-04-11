import { z } from 'zod';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ok, err, ensureVaultExists, kindIcon, fmtDate } from '../helpers.js';
import { getAutoMemory } from '../auto-memory.js';
import { getRemoteClient, getTeamId, getPublicVaults } from '../remote.js';
import type { AutoMemoryEntry, AutoMemoryResult } from '../auto-memory.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

const DEFAULT_MAX_TOKENS = 4000;
const RECENT_DAYS = 7;
const MAX_BODY_PER_ENTRY = 400;
const PRIORITY_KINDS = ['decision', 'insight', 'pattern'];
const SESSION_SUMMARY_KIND = 'session';

/**
 * Build a search context string from auto-memory entries.
 * Used to boost vault retrieval relevance.
 */
function buildAutoMemoryContext(entries: AutoMemoryEntry[]): string {
  if (entries.length === 0) return '';
  const parts = entries
    .map((e) => {
      const desc = e.description ? `: ${e.description}` : '';
      // Include a snippet of the body for richer context
      const bodySnippet = e.body ? ` -- ${e.body.slice(0, 200)}` : '';
      return `${e.name}${desc}${bodySnippet}`;
    });
  return parts.join('. ');
}

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
  auto_memory_path: z
    .string()
    .optional()
    .describe(
      "Explicit path to the Claude Code auto-memory directory. Overrides auto-detection. If not provided, session_start attempts to detect ~/.claude/projects/-<project-key>/memory/ from cwd."
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
  { project, max_tokens, buckets, auto_memory_path }: Record<string, any>,
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

  // Auto-detect Claude Code auto-memory (explicit path overrides auto-detection)
  const autoMemory: AutoMemoryResult = getAutoMemory(auto_memory_path);
  const autoMemoryContext = buildAutoMemoryContext(autoMemory.entries);
  const topicsExtracted = autoMemory.entries.length > 0
    ? extractKeywords(autoMemoryContext).slice(0, 20)
    : [];

  const sections = [];
  let tokensUsed = 0;

  sections.push(`# Session Brief${effectiveProject ? ` -- ${effectiveProject}` : ''}`);
  const bucketsLabel = buckets?.length ? ` | buckets: ${buckets.join(', ')}` : '';
  const autoMemoryLabel = autoMemory.detected
    ? ` | auto-memory: ${autoMemory.entries.length} entries detected, used as search context`
    : '';
  sections.push(
    `_Generated ${new Date().toISOString().slice(0, 10)} | budget: ${tokenBudget} tokens${bucketsLabel}${autoMemoryLabel}_\n`
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

  // Hot entries: always loaded regardless of project/bucket scope
  const hotEntries = queryHotEntries(ctx);
  if (hotEntries.length > 0) {
    const header = '## Hot Entries (frequently accessed)\n';
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines: string[] = [];
      tokensUsed += headerTokens;
      for (const entry of hotEntries) {
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

  // When auto-memory context is available, boost decisions query with FTS
  const decisions = queryByKinds(
    ctx,
    PRIORITY_KINDS,
    sinceDate,
    effectiveTags,
    autoMemoryContext
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

  const seenIdsForDurable = new Set([
    ...decisions.map((d: any) => d.id),
    ...(lastSession ? [lastSession.id] : []),
  ]);
  const durables = queryDurable(ctx, effectiveTags, seenIdsForDurable);
  if (durables.length > 0) {
    const header = '## Foundational Decisions\n';
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines = [];
      tokensUsed += headerTokens;
      for (const entry of durables) {
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
  durables.forEach((d: any) => seenIds.add(d.id));
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

  // Remote entries: pull recent from hosted API if configured
  const remoteClient = getRemoteClient(ctx.config);
  let remoteCount = 0;
  if (remoteClient && tokensUsed < tokenBudget) {
    try {
      const seenIds = new Set([
        ...decisions.map((d: any) => d.id),
        ...deduped.map((d: any) => d.id),
        ...(lastSession ? [lastSession.id] : []),
      ]);
      const remoteTags = effectiveTags.length ? effectiveTags : undefined;
      const remoteResults = await remoteClient.search({
        tags: remoteTags,
        limit: 10,
        since: sinceDate,
      });
      const uniqueRemote = remoteResults.filter((r: any) => !seenIds.has(r.id));
      if (uniqueRemote.length > 0) {
        const header = '## Remote Entries\n';
        const headerTokens = estimateTokens(header);
        if (tokensUsed + headerTokens <= tokenBudget) {
          const entryLines: string[] = [];
          tokensUsed += headerTokens;
          for (const entry of uniqueRemote) {
            const line = formatEntry(entry);
            const lineTokens = estimateTokens(line);
            if (tokensUsed + lineTokens > tokenBudget) break;
            entryLines.push(line);
            tokensUsed += lineTokens;
            remoteCount++;
          }
          if (entryLines.length > 0) {
            sections.push(header + entryLines.join('\n') + '\n');
          }
        }
      }
    } catch (e) {
      console.warn(`[context-vault] Remote session_start failed: ${(e as Error).message}`);
    }
  }

  // Team vault entries: include team knowledge in brief if teamId is configured
  let teamCount = 0;
  const teamId = getTeamId(ctx.config);
  if (remoteClient && teamId && tokensUsed < tokenBudget) {
    try {
      const allSeenIds = new Set([
        ...decisions.map((d: any) => d.id),
        ...deduped.map((d: any) => d.id),
        ...(lastSession ? [lastSession.id] : []),
      ]);
      const teamResults = await remoteClient.teamSearch(teamId, {
        tags: effectiveTags.length ? effectiveTags : undefined,
        limit: 10,
        since: sinceDate,
      });
      const uniqueTeam = teamResults.filter((r: any) => !allSeenIds.has(r.id));
      if (uniqueTeam.length > 0) {
        const header = '## Team Knowledge\n';
        const headerTokens = estimateTokens(header);
        if (tokensUsed + headerTokens <= tokenBudget) {
          const entryLines: string[] = [];
          tokensUsed += headerTokens;
          for (const entry of uniqueTeam) {
            const line = formatEntry(entry) + ' `[team]`';
            const lineTokens = estimateTokens(line);
            if (tokensUsed + lineTokens > tokenBudget) break;
            entryLines.push(line);
            tokensUsed += lineTokens;
            teamCount++;
          }
          if (entryLines.length > 0) {
            sections.push(header + entryLines.join('\n') + '\n');
          }
        }
      }
    } catch (e) {
      console.warn(`[context-vault] Team session_start failed: ${(e as Error).message}`);
    }
  }

  // Public vault entries: include public knowledge if publicVaults are configured
  let publicCount = 0;
  const publicVaultSlugs = getPublicVaults(ctx.config);
  if (remoteClient && publicVaultSlugs.length > 0 && tokensUsed < tokenBudget) {
    try {
      const allPublicSeenIds = new Set([
        ...decisions.map((d: any) => d.id),
        ...deduped.map((d: any) => d.id),
        ...(lastSession ? [lastSession.id] : []),
      ]);
      const publicSearches = publicVaultSlugs.map(slug =>
        remoteClient.publicSearch(slug, {
          tags: effectiveTags.length ? effectiveTags : undefined,
          limit: 5,
          since: sinceDate,
        }).catch(() => [])
      );
      const allPublicResults = await Promise.all(publicSearches);
      const flatPublic = allPublicResults.flat().filter((r: any) => !allPublicSeenIds.has(r.id));
      if (flatPublic.length > 0) {
        const header = '## Public Knowledge\n';
        const headerTokens = estimateTokens(header);
        if (tokensUsed + headerTokens <= tokenBudget) {
          const entryLines: string[] = [];
          tokensUsed += headerTokens;
          for (const entry of flatPublic) {
            const slug = (entry as any).vault_slug || 'public';
            const line = formatEntry(entry) + ` \`[public:${slug}]\``;
            const lineTokens = estimateTokens(line);
            if (tokensUsed + lineTokens > tokenBudget) break;
            entryLines.push(line);
            tokensUsed += lineTokens;
            publicCount++;
          }
          if (entryLines.length > 0) {
            sections.push(header + entryLines.join('\n') + '\n');
          }
        }
      }
    } catch (e) {
      console.warn(`[context-vault] Public vault session_start failed: ${(e as Error).message}`);
    }
  }

  const totalEntries =
    (lastSession ? 1 : 0) +
    decisions.length +
    durables.length +
    deduped.filter((_d: any) => {
      return true;
    }).length +
    remoteCount +
    teamCount +
    publicCount;

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
      hot_entries: hotEntries.length,
      decisions: decisions.length,
      foundational: durables.length,
      recent: deduped.length,
    },
    auto_memory: {
      detected: autoMemory.detected,
      path: autoMemory.path,
      entries: autoMemory.entries.length,
      lines_used: autoMemory.linesUsed,
      topics_extracted: topicsExtracted,
    },
  };
  return result;
}

function queryHotEntries(ctx: LocalCtx): any[] {
  try {
    return ctx.db
      .prepare(
        `SELECT * FROM vault
         WHERE heat_tier = 'hot'
           AND superseded_by IS NULL
           AND (expires_at IS NULL OR expires_at > datetime('now'))
           AND indexed = 1
         ORDER BY last_accessed_at DESC
         LIMIT 10`
      )
      .all();
  } catch {
    return [];
  }
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
  effectiveTags: string[],
  autoMemoryContext = ''
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
  let rows = ctx.db
    .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT 50`)
    .all(...params) as any[];

  if (effectiveTags.length) {
    const tagged = rows.filter((r: any) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return effectiveTags.some((t: string) => tags.includes(t));
    });
    if (tagged.length > 0) rows = tagged;
  }

  // When auto-memory context is available, boost results by FTS relevance
  // to surface vault entries that match what the user's auto-memory says they care about
  if (autoMemoryContext && rows.length > 1) {
    rows = boostByAutoMemory(ctx, rows, autoMemoryContext);
  }

  return rows;
}

/**
 * Re-rank vault entries by FTS relevance to auto-memory context.
 * Entries matching auto-memory topics float to the top while preserving
 * all original entries (non-matching ones keep their original order at the end).
 */
function boostByAutoMemory(ctx: LocalCtx, rows: any[], context: string): any[] {
  // Extract meaningful keywords from auto-memory context for FTS
  const keywords = extractKeywords(context);
  if (keywords.length === 0) return rows;

  // Build FTS query from auto-memory keywords
  const ftsTerms = keywords.slice(0, 10).map((k) => `"${k}"`).join(' OR ');
  const rowIds = new Set(rows.map((r: any) => r.id));

  try {
    const ftsRows = ctx.db
      .prepare(
        `SELECT e.id, rank FROM vault_fts f JOIN vault e ON f.rowid = e.rowid WHERE vault_fts MATCH ? ORDER BY rank LIMIT 50`
      )
      .all(ftsTerms) as { id: string; rank: number }[];

    // Build a boost map: entries matching auto-memory context get priority
    const boostMap = new Map<string, number>();
    for (const fr of ftsRows) {
      if (rowIds.has(fr.id)) {
        boostMap.set(fr.id, fr.rank);
      }
    }

    if (boostMap.size === 0) return rows;

    // Sort: boosted entries first (by FTS rank), then unboosted in original order
    const boosted = rows.filter((r: any) => boostMap.has(r.id));
    const unboosted = rows.filter((r: any) => !boostMap.has(r.id));
    boosted.sort((a: any, b: any) => (boostMap.get(a.id) ?? 0) - (boostMap.get(b.id) ?? 0));
    return [...boosted, ...unboosted];
  } catch {
    // FTS errors are non-fatal; return original order
    return rows;
  }
}

/**
 * Extract meaningful keywords from auto-memory context text.
 * Filters out common stop words and short tokens.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
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

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return words.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
}

function queryDurable(
  ctx: LocalCtx,
  effectiveTags: string[],
  excludeIds: Set<string>
): any[] {
  const clauses = [
    "tier = 'durable'",
    "kind IN ('decision', 'pattern', 'architecture', 'reference')",
    "(expires_at IS NULL OR expires_at > datetime('now'))",
    "superseded_by IS NULL",
  ];
  const rows = ctx.db
    .prepare(`SELECT * FROM vault WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 20`)
    .all() as any[];

  let filtered = rows.filter((r: any) => !excludeIds.has(r.id));

  if (effectiveTags.length) {
    filtered = filtered.filter((r: any) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return effectiveTags.some((t: string) => tags.includes(t));
    });
  }

  return filtered;
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
