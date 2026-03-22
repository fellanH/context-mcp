import { z } from 'zod';
import { captureAndIndex } from '@context-vault/core/capture';
import { execSync } from 'node:child_process';
import { ok, err, ensureVaultExists } from '../helpers.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const MAX_ENTRIES_PER_SESSION = 5;

const PROMPT_TEMPLATE = `## Session End: Knowledge Capture

Before this session ends, take a moment to capture what was learned.

**Answer these questions (skip any that don't apply):**

1. **What was accomplished?**
   List the key outcomes of this session.

2. **What was learned?** (most important)
   Non-obvious findings, gotchas, or discoveries that would save time in a future session.
   Skip anything derivable from reading the code or git history.

3. **What decisions were made and why?**
   Architectural choices, trade-offs, or scope decisions with their rationale.

4. **What would save time for the next session?**
   Blockers, context that took a while to build, or shortcuts discovered.

**Then call \`session_end\` again with your summary and any discrete discoveries:**

\`\`\`
session_end({
  summary: "your summary text",
  discoveries: [
    { title: "Short descriptive title", body: "What was learned and why it matters", kind: "insight" },
    { title: "Decision: chose X over Y", body: "Rationale and trade-offs", kind: "decision" }
  ]
})
\`\`\``;

function detectProject(): string | null {
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

function classifyDiscovery(body: string): string {
  const lower = body.toLowerCase();
  if (/chose|decided|picked|went with|trade.?off|alternative/i.test(lower)) return 'architectural';
  if (/bug|fix|error|crash|broke|regression/i.test(lower)) return 'bugfix';
  if (/pattern|convention|approach|technique/i.test(lower)) return 'pattern';
  if (/api|endpoint|library|framework|dependency/i.test(lower)) return 'integration';
  return 'general';
}

function extractInsightsFromSummary(summary: string): Array<{ title: string; body: string; kind: string }> {
  const insights: Array<{ title: string; body: string; kind: string }> = [];

  const sections = summary.split(/\n(?=#+\s|(?:\d+\.|\*|-)\s+\*\*)/);
  for (const section of sections) {
    const lower = section.toLowerCase();

    if (/\blearned\b|\bdiscover|\bgotcha|\bnon.?obvious|\bsurpris|\bunexpect|\bworkaround/.test(lower)) {
      const lines = section.split('\n').filter(l => l.trim());
      const bullets = lines.filter(l => /^\s*[-*]\s/.test(l));

      if (bullets.length > 0) {
        for (const bullet of bullets) {
          const text = bullet.replace(/^\s*[-*]\s+/, '').trim();
          if (text.length > 20) {
            insights.push({
              title: text.length > 120 ? text.slice(0, 117) + '...' : text,
              body: text,
              kind: 'insight',
            });
          }
        }
      } else if (section.trim().length > 30) {
        const firstLine = lines[0]?.replace(/^#+\s*/, '').trim() || 'Session insight';
        insights.push({
          title: firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine,
          body: section.trim(),
          kind: 'insight',
        });
      }
    }

    if (/\bdecision|\bdecided|\bchose|\btrade.?off/.test(lower)) {
      const lines = section.split('\n').filter(l => l.trim());
      const bullets = lines.filter(l => /^\s*[-*]\s/.test(l));

      if (bullets.length > 0) {
        for (const bullet of bullets) {
          const text = bullet.replace(/^\s*[-*]\s+/, '').trim();
          if (text.length > 20) {
            insights.push({
              title: text.length > 120 ? text.slice(0, 117) + '...' : text,
              body: text,
              kind: 'decision',
            });
          }
        }
      }
    }
  }

  return insights.slice(0, MAX_ENTRIES_PER_SESSION);
}

async function deduplicateAndSave(
  entries: Array<{ title: string; body: string; kind: string; tags: string[]; tier: string; meta?: Record<string, unknown> }>,
  ctx: LocalCtx
): Promise<{ saved: Array<{ id: string; title: string; kind: string }>; skipped: Array<{ title: string; reason: string }> }> {
  const saved: Array<{ id: string; title: string; kind: string }> = [];
  const skipped: Array<{ title: string; reason: string }> = [];

  for (const entry of entries) {
    const embeddingText = [entry.title, entry.body].filter(Boolean).join(' ');
    let isDuplicate = false;

    try {
      const embedding = await ctx.embed(embeddingText);
      if (embedding) {
        const vecCount = (ctx.db.prepare('SELECT COUNT(*) as c FROM vault_vec').get() as any)?.c ?? 0;
        if (vecCount > 0) {
          const vecRows: any[] = ctx.db
            .prepare(
              'SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT 3'
            )
            .all(embedding, 3) as any[];

          for (const vr of vecRows) {
            const similarity = Math.max(0, 1 - (vr.distance as number) / 2);
            if (similarity >= DEFAULT_SIMILARITY_THRESHOLD) {
              const row = ctx.db
                .prepare('SELECT id, title FROM vault WHERE rowid = ?')
                .get(vr.rowid) as any;
              if (row) {
                isDuplicate = true;
                skipped.push({
                  title: entry.title,
                  reason: `similar to "${row.title || row.id}" (${(similarity * 100).toFixed(0)}%)`,
                });
                break;
              }
            }
          }
        }
      }
    } catch {}

    if (isDuplicate) continue;

    try {
      const result = await captureAndIndex(ctx, {
        kind: entry.kind,
        title: entry.title,
        body: entry.body,
        tags: entry.tags,
        tier: entry.tier,
        meta: entry.meta,
        source: 'session-end',
      });
      saved.push({ id: result.id, title: entry.title, kind: entry.kind });
    } catch (e) {
      skipped.push({
        title: entry.title,
        reason: `save failed: ${(e as Error).message}`,
      });
    }
  }

  return { saved, skipped };
}

export const name = 'session_end';

export const description =
  'End-of-session knowledge capture. Call when a session ends to extract and save insights, decisions, and learnings. If called without a summary, returns a prompt template to guide the agent through knowledge capture.';

export const inputSchema = {
  summary: z
    .string()
    .optional()
    .describe(
      'Session summary text covering what was accomplished, learned, decided, and what would help next time.'
    ),
  discoveries: z
    .array(
      z.object({
        title: z.string().describe('Short descriptive title for this discovery'),
        body: z.string().describe('What was learned and why it matters'),
        kind: z
          .enum(['insight', 'decision', 'pattern', 'reference'])
          .optional()
          .describe('Entry kind (default: insight)'),
      })
    )
    .optional()
    .describe(
      'Explicit discoveries to save. Each becomes a vault entry with deduplication.'
    ),
  project: z
    .string()
    .optional()
    .describe('Project name for bucket tagging. Auto-detected from git remote if not provided.'),
};

export async function handler(
  { summary, discoveries, project }: Record<string, any>,
  ctx: LocalCtx,
  { ensureIndexed }: SharedCtx
): Promise<ToolResult> {
  const { config } = ctx;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  if (!summary && (!discoveries || discoveries.length === 0)) {
    return ok(PROMPT_TEMPLATE);
  }

  await ensureIndexed({ blocking: false });

  const effectiveProject = project?.trim() || detectProject();
  const bucketTag = effectiveProject ? `bucket:${effectiveProject}` : null;
  const baseTags = ['auto-session', ...(bucketTag ? [bucketTag] : [])];

  const entriesToSave: Array<{
    title: string;
    body: string;
    kind: string;
    tags: string[];
    tier: string;
    meta?: Record<string, unknown>;
  }> = [];

  if (discoveries?.length) {
    for (const d of discoveries.slice(0, MAX_ENTRIES_PER_SESSION)) {
      const kind = d.kind || 'insight';
      entriesToSave.push({
        title: d.title,
        body: d.body,
        kind,
        tags: [...baseTags],
        tier: kind === 'decision' ? 'durable' : 'working',
        meta: {
          discovery_type: classifyDiscovery(d.body),
          source: 'session-end-explicit',
        },
      });
    }
  }

  if (summary) {
    const extracted = extractInsightsFromSummary(summary);
    const remainingSlots = MAX_ENTRIES_PER_SESSION - entriesToSave.length;
    for (const e of extracted.slice(0, remainingSlots)) {
      entriesToSave.push({
        title: e.title,
        body: e.body,
        kind: e.kind,
        tags: [...baseTags],
        tier: e.kind === 'decision' ? 'durable' : 'working',
        meta: {
          discovery_type: classifyDiscovery(e.body),
          source: 'session-end-extracted',
        },
      });
    }

    entriesToSave.push({
      title: `Session: ${effectiveProject || 'unknown'} ${new Date().toISOString().slice(0, 10)}`,
      body: summary,
      kind: 'session',
      tags: [...baseTags],
      tier: 'ephemeral',
      meta: {
        source: 'session-end',
        discoveries_explicit: discoveries?.length ?? 0,
        discoveries_extracted: extractInsightsFromSummary(summary).length,
      },
    });
  }

  if (entriesToSave.length === 0) {
    return ok('No save-worthy content found in the provided summary. Session recorded without vault entries.');
  }

  const { saved, skipped } = await deduplicateAndSave(entriesToSave, ctx);

  const lines = ['## Session End Summary\n'];

  if (saved.length > 0) {
    lines.push(`### Saved (${saved.length})\n`);
    for (const s of saved) {
      lines.push(`- **${s.title}** (\`${s.kind}\`) \`${s.id}\``);
    }
    lines.push('');
  }

  if (skipped.length > 0) {
    lines.push(`### Skipped (${skipped.length})\n`);
    for (const s of skipped) {
      lines.push(`- **${s.title}**: ${s.reason}`);
    }
    lines.push('');
  }

  if (saved.length === 0 && skipped.length > 0) {
    lines.push('_All discoveries matched existing entries. No new entries created._');
  }

  const result: ToolResult = ok(lines.join('\n'));
  result._meta = {
    project: effectiveProject,
    saved_count: saved.length,
    skipped_count: skipped.length,
    saved_ids: saved.map(s => s.id),
  };
  return result;
}
