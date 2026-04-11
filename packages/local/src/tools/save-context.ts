import { z } from 'zod';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { homedir } from 'node:os';
import { captureAndIndex, updateEntryFile, writeEntry } from '@context-vault/core/capture';
import { indexEntry } from '@context-vault/core/index';
import { categoryFor, defaultTierFor } from '@context-vault/core/categories';
import { normalizeKind, kindToPath } from '@context-vault/core/files';
import { parseContextParam } from '@context-vault/core/context';
import { shouldIndex } from '@context-vault/core/indexing';
import { ok, err, errWithHint, ensureVaultExists, ensureValidKind, kindIcon } from '../helpers.js';
import { maybeShowFeedbackPrompt } from '../telemetry.js';
import { validateRelatedTo } from '../linking.js';
import { getAutoMemory, findAutoMemoryOverlaps } from '../auto-memory.js';
import { getRemoteClient, getTeamId } from '../remote.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_KIND_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_COUNT,
  MAX_META_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_IDENTITY_KEY_LENGTH,
} from '@context-vault/core/constants';

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const SKIP_THRESHOLD = 0.95;
const UPDATE_THRESHOLD = 0.85;

function isDualWriteEnabled(config: { dataDir: string }): boolean {
  try {
    const configPath = join(config.dataDir, 'config.json');
    if (!existsSync(configPath)) return true;
    const fc = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (fc.dualWrite && fc.dualWrite.enabled === false) return false;
    return true;
  } catch {
    return true;
  }
}

function isDeferredSyncEnabled(config: { dataDir: string }): boolean {
  try {
    const configPath = join(config.dataDir, 'config.json');
    if (!existsSync(configPath)) return false;
    const fc = JSON.parse(readFileSync(configPath, 'utf-8'));
    return fc.dualWrite?.deferredSync === true;
  } catch {
    return false;
  }
}

function dualWriteLocal(entryFilePath: string, kind: string): void {
  const cwd = process.cwd();
  const home = homedir();
  if (!cwd || cwd === '/' || cwd === home) return;

  try {
    const content = readFileSync(entryFilePath, 'utf-8');
    const localDir = resolve(cwd, '.context', kindToPath(kind));
    mkdirSync(localDir, { recursive: true });
    const filename = basename(entryFilePath);
    writeFileSync(join(localDir, filename), content);
  } catch (e) {
    console.warn(`[context-vault] Dual-write to .context/ failed: ${(e as Error).message}`);
  }
}

async function findSimilar(
  ctx: LocalCtx,
  embedding: any,
  threshold: number,
  { hydrate = false } = {}
): Promise<any[]> {
  try {
    const vecCount = (ctx.db.prepare('SELECT COUNT(*) as c FROM vault_vec').get() as any)?.c ?? 0;
    if (vecCount === 0) return [];

    const vecRows: any[] = ctx.db
      .prepare(
        `SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
      )
      .all(embedding, 10) as any[];

    if (!vecRows.length) return [];

    const rowids = vecRows.map((vr: any) => vr.rowid);
    const placeholders = rowids.map(() => '?').join(',');
    // Local mode has no user_id column — omit it from the SELECT list.
    const isLocal = (ctx.stmts as any)._mode === 'local';
    const columns = isLocal
      ? hydrate
        ? 'rowid, id, title, body, kind, tags, category, updated_at'
        : 'rowid, id, title, category'
      : hydrate
        ? 'rowid, id, title, body, kind, tags, category, updated_at'
        : 'rowid, id, title, category';
    const hydratedRows = ctx.db
      .prepare(`SELECT ${columns} FROM vault WHERE rowid IN (${placeholders})`)
      .all(...rowids);

    const byRowid = new Map();
    for (const row of hydratedRows) byRowid.set(row.rowid, row);

    const results = [];
    for (const vr of vecRows) {
      const similarity = Math.max(0, 1 - (vr.distance as number) / 2);
      if (similarity < threshold) continue;
      const row = byRowid.get(vr.rowid);
      if (!row) continue;
      if (row.category === 'entity') continue;
      const entry: Record<string, any> = { id: row.id, title: row.title, score: similarity };
      if (hydrate) {
        entry.body = row.body;
        entry.kind = row.kind;
        entry.tags = row.tags;
        entry.updated_at = row.updated_at;
      }
      results.push(entry);
    }
    return results;
  } catch {
    return [];
  }
}

function formatSimilarWarning(similar: any[]): string {
  const lines = ['', '### ⚠ Similar entries'];
  for (const e of similar) {
    const score = (e.score * 100).toFixed(0);
    const title = e.title ? `**${e.title}**` : '(no title)';
    lines.push(`- ${title} \`${score}%\` · \`${e.id}\``);
  }
  lines.push('_Use `id` param to update instead of creating a duplicate._');
  return lines.join('\n');
}

export function buildConflictCandidates(similarEntries: any[]): any[] {
  return similarEntries.map((entry: any) => {
    let suggested_action;
    let reasoning_context;

    if (entry.score >= SKIP_THRESHOLD) {
      suggested_action = 'SKIP';
      reasoning_context =
        `Near-duplicate detected (${(entry.score * 100).toFixed(0)}% similarity)` +
        `${entry.title ? ` with "${entry.title}"` : ''}. ` +
        `Content is nearly identical — saving would create a redundant entry. ` +
        `Use save_context with id: "${entry.id}" to update instead, or skip saving entirely.`;
    } else if (entry.score >= UPDATE_THRESHOLD) {
      suggested_action = 'UPDATE';
      reasoning_context =
        `High content similarity (${(entry.score * 100).toFixed(0)}%)` +
        `${entry.title ? ` with "${entry.title}"` : ''}. ` +
        `Likely the same knowledge — consider updating this entry via save_context with id: "${entry.id}".`;
    } else {
      suggested_action = 'ADD';
      reasoning_context =
        `Moderate similarity (${(entry.score * 100).toFixed(0)}%)` +
        `${entry.title ? ` with "${entry.title}"` : ''}. ` +
        `Content is related but distinct enough to coexist.`;
    }

    let parsedTags = [];
    if (entry.tags) {
      try {
        parsedTags = typeof entry.tags === 'string' ? JSON.parse(entry.tags) : entry.tags;
      } catch {
        parsedTags = [];
      }
    }

    return {
      id: entry.id,
      title: entry.title || null,
      body: entry.body || null,
      kind: entry.kind || null,
      tags: parsedTags,
      score: entry.score,
      updated_at: entry.updated_at || null,
      suggested_action,
      reasoning_context,
    };
  });
}

function formatConflictSuggestions(candidates: any[]): string {
  const lines = ['', '### Conflict Resolution'];
  for (const c of candidates) {
    const titleDisplay = c.title ? `**${c.title}**` : '(no title)';
    const actionIcon = c.suggested_action === 'SKIP' ? '⊘' : c.suggested_action === 'UPDATE' ? '↻' : '＋';
    lines.push(`${actionIcon} **${c.suggested_action}** ${titleDisplay} \`${(c.score * 100).toFixed(0)}%\` · \`${c.id}\``);
    lines.push(`  ${c.reasoning_context}`);
  }
  return lines.join('\n');
}

/**
 * Validate input fields for save_context. Returns an error response or null.
 */
function validateSaveInput({
  kind,
  title,
  body,
  tags,
  meta,
  source,
  identity_key,
  expires_at,
}: Record<string, any>): ToolResult | null {
  if (kind !== undefined && kind !== null) {
    if (typeof kind !== 'string' || kind.length > MAX_KIND_LENGTH) {
      return err(`kind must be a string, max ${MAX_KIND_LENGTH} chars`, 'INVALID_INPUT');
    }
  }
  if (body !== undefined && body !== null) {
    if (typeof body !== 'string' || body.length > MAX_BODY_LENGTH) {
      return err(`body must be a string, max ${MAX_BODY_LENGTH / 1024}KB`, 'INVALID_INPUT');
    }
  }
  if (title !== undefined && title !== null) {
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
      return err(`title must be a string, max ${MAX_TITLE_LENGTH} chars`, 'INVALID_INPUT');
    }
  }
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) return err('tags must be an array of strings', 'INVALID_INPUT');
    if (tags.length > MAX_TAGS_COUNT)
      return err(`tags: max ${MAX_TAGS_COUNT} tags allowed`, 'INVALID_INPUT');
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH) {
        return err(`each tag must be a string, max ${MAX_TAG_LENGTH} chars`, 'INVALID_INPUT');
      }
    }
  }
  if (meta !== undefined && meta !== null) {
    const metaStr = JSON.stringify(meta);
    if (metaStr.length > MAX_META_LENGTH) {
      return err(`meta must be under ${MAX_META_LENGTH / 1024}KB when serialized`, 'INVALID_INPUT');
    }
  }
  if (source !== undefined && source !== null) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE_LENGTH) {
      return err(`source must be a string, max ${MAX_SOURCE_LENGTH} chars`, 'INVALID_INPUT');
    }
  }
  if (identity_key !== undefined && identity_key !== null) {
    if (typeof identity_key !== 'string' || identity_key.length > MAX_IDENTITY_KEY_LENGTH) {
      return err(
        `identity_key must be a string, max ${MAX_IDENTITY_KEY_LENGTH} chars`,
        'INVALID_INPUT'
      );
    }
  }
  if (expires_at !== undefined && expires_at !== null) {
    if (typeof expires_at !== 'string' || isNaN(new Date(expires_at).getTime())) {
      return err('expires_at must be a valid ISO date string', 'INVALID_INPUT');
    }
  }
  return null;
}

function enrichDecisionMeta(
  mergedMeta: Record<string, any>,
  title: string | undefined,
  body: string | undefined
): void {
  const combined = [title, body].filter(Boolean).join(' ').toLowerCase();

  if (/\b(architect|infra|schema|database|api|stack|deploy|migration)\b/.test(combined)) {
    mergedMeta.decision_type = 'architectural';
  } else if (/\b(scope|feature|requirement|priority|roadmap|milestone)\b/.test(combined)) {
    mergedMeta.decision_type = 'product';
  } else if (/\b(convention|style|naming|lint|format|pattern)\b/.test(combined)) {
    mergedMeta.decision_type = 'convention';
  } else {
    mergedMeta.decision_type = 'general';
  }

  mergedMeta.alternatives_noted = /\b(alternative|instead of|over|rather than|compared to|vs\.?|versus|option|considered)\b/i.test(combined);
  mergedMeta.has_rationale = /\b(because|reason|rationale|why|trade.?off|benefit|downside|pro|con)\b/i.test(combined);
}

export const name = 'save_context';

export const description =
  'Save knowledge to your vault. Creates a .md file and indexes it for search. Use for any kind of context: insights, decisions, patterns, references, or any custom kind. To update an existing entry, pass its `id` — omitted fields are preserved.';

export const inputSchema = {
  id: z
    .string()
    .optional()
    .describe(
      'Entry ID to update. When provided, updates the existing entry instead of creating new. Omitted fields are preserved.'
    ),
  kind: z
    .string()
    .optional()
    .describe(
      "Entry kind — determines folder (e.g. 'insight', 'decision', 'pattern', 'reference', or any custom kind). Required for new entries."
    ),
  title: z.string().optional().describe('Entry title (optional for insights)'),
  body: z.string().optional().describe('Main content. Required for new entries.'),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Tags for categorization and search. Use 'bucket:' prefix for project/domain scoping (e.g., 'bucket:autohub') to enable project-scoped retrieval."
    ),
  meta: z
    .any()
    .optional()
    .describe(
      "Additional structured metadata (JSON object, e.g. { language: 'js', status: 'accepted' })"
    ),
  folder: z
    .string()
    .optional()
    .describe("Subfolder within the kind directory (e.g. 'react/hooks')"),
  source: z.string().optional().describe('Where this knowledge came from'),
  identity_key: z
    .string()
    .optional()
    .describe(
      'Required for entity kinds (contact, project, tool, source). The unique identifier for this entity.'
    ),
  expires_at: z.string().optional().describe('ISO date for TTL expiry'),
  supersedes: z
    .array(z.string())
    .optional()
    .describe(
      'Array of entry IDs that this entry supersedes/replaces. Those entries will be marked with superseded_by pointing to this new entry and excluded from future search results by default.'
    ),
  related_to: z
    .array(z.string())
    .optional()
    .describe(
      'Array of entry IDs this entry is related to. Enables bidirectional graph traversal — use get_context with follow_links:true to retrieve linked entries.'
    ),
  source_files: z
    .array(
      z.object({
        path: z.string().describe('File path (absolute or relative to cwd)'),
        hash: z.string().describe('SHA-256 hash of the file contents at observation time'),
      })
    )
    .optional()
    .describe(
      'Source code files this entry is derived from. When these files change (hash mismatch), the entry will be flagged as stale in get_context results.'
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      'If true, check for similar entries without saving. Returns similarity results without creating a new entry. Only applies to knowledge and event categories.'
    ),
  similarity_threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Cosine similarity threshold for duplicate detection (0–1, default 0.85). Entries above this score are flagged as similar. Only applies to knowledge and event categories.'
    ),
  tier: z
    .enum(['ephemeral', 'working', 'durable'])
    .optional()
    .describe(
      "Memory tier for lifecycle management. 'ephemeral': short-lived session data. 'working': active context (default). 'durable': long-term reference material. Defaults based on kind when not specified."
    ),
  conflict_resolution: z
    .enum(['suggest', 'off'])
    .optional()
    .describe(
      'Conflict resolution mode. "suggest" (default): when similar entries are found, return structured conflict_candidates with suggested_action (ADD/UPDATE/SKIP) and reasoning_context for the calling agent to decide. Thresholds: score > 0.95 → SKIP (near-duplicate), score > 0.85 → UPDATE (very similar), score < 0.85 → ADD (distinct enough). "off": flag similar entries only (legacy behavior).'
    ),
  encoding_context: z
    .any()
    .optional()
    .describe(
      'Encoding context for contextual reinstatement. Captures the situation when this entry was created, enabling context-aware retrieval boosting. Pass a structured object (e.g. { project: "myapp", arc: "auth-rewrite", task: "implementing JWT" }) or a free-text string describing the current context.'
    ),
  indexed: z
    .boolean()
    .optional()
    .describe(
      'Whether to index this entry for search (generate embeddings + FTS). Default: auto-determined by indexing config. Set to false to store file + metadata only, skipping embedding generation. Set to true to force indexing regardless of config rules.'
    ),
  visibility: z
    .enum(['personal', 'team'])
    .optional()
    .describe(
      'Where to save: "personal" (default) saves to local + personal remote. "team" publishes to the team vault instead via POST /api/vault/publish. Requires teamId in remote config or a prior `context-vault team join`.'
    ),
};

export async function handler(
  {
    id,
    kind,
    title,
    body,
    tags,
    meta,
    folder,
    source,
    identity_key,
    expires_at,
    supersedes,
    related_to,
    source_files,
    dry_run,
    similarity_threshold,
    tier,
    conflict_resolution,
    encoding_context,
    indexed,
    visibility,
  }: Record<string, any>,
  ctx: LocalCtx,
  { ensureIndexed }: SharedCtx
): Promise<ToolResult> {
  const { config } = ctx;
  const suggestMode = conflict_resolution !== 'off';

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  const relatedToErr = validateRelatedTo(related_to);
  if (relatedToErr) return err(relatedToErr, 'INVALID_INPUT');

  const inputErr = validateSaveInput({
    kind,
    title,
    body,
    tags,
    meta,
    source,
    identity_key,
    expires_at,
  });
  if (inputErr) return inputErr;

  // ── Auto-resolve identity_key to id for upsert ──
  if (!id && identity_key && kind) {
    const normalizedKindForLookup = normalizeKind(kind);
    const existingByKey = ctx.stmts.getByIdentityKey.get(
      normalizedKindForLookup,
      identity_key
    ) as any;
    if (existingByKey) {
      id = existingByKey.id;
    }
  }

  // ── Update mode ──
  if (id) {
    await ensureIndexed({ blocking: false });

    const existing = ctx.stmts.getEntryById.get(id);
    if (!existing) return err(`Entry not found: ${id}`, 'NOT_FOUND');

    if (kind && normalizeKind(kind) !== existing.kind) {
      return err(
        `Cannot change kind (current: "${existing.kind}"). Delete and re-create instead.`,
        'INVALID_UPDATE'
      );
    }
    if (identity_key && identity_key !== existing.identity_key) {
      return err(
        `Cannot change identity_key (current: "${existing.identity_key}"). Delete and re-create instead.`,
        'INVALID_UPDATE'
      );
    }

    // Merge encoding context into meta for update path
    const updateParsedCtx = parseContextParam(encoding_context);
    let updateMeta = meta;
    if (updateParsedCtx) {
      updateMeta = { ...(meta || {}) };
      updateMeta.encoding_context = updateParsedCtx.structured || updateParsedCtx.text;
    }

    let entry;
    try {
      entry = updateEntryFile(ctx, existing, {
        title,
        body,
        tags,
        meta: updateMeta,
        source,
        expires_at,
        supersedes,
        related_to,
        source_files,
      });
      await indexEntry(ctx, entry);
    } catch (e) {
      return errWithHint(
        e instanceof Error ? e.message : String(e),
        'UPDATE_FAILED',
        'context-vault save_context update is failing. Check `cat ~/.context-mcp/error.log | tail -5` and help me debug.'
      );
    }

    // Store context embedding for updated entry
    if (updateParsedCtx?.text) {
      try {
        const ctxEmbed = await ctx.embed(updateParsedCtx.text);
        if (ctxEmbed) {
          const rowidResult = ctx.stmts.getRowid.get(entry.id) as { rowid: number } | undefined;
          if (rowidResult?.rowid) {
            const rowid = Number(rowidResult.rowid);
            try { ctx.deleteCtxVec(rowid); } catch {}
            ctx.insertCtxVec(rowid, ctxEmbed);
          }
        }
      } catch (e) {
        console.warn(`[context-vault] Context embedding update failed: ${(e as Error).message}`);
      }
    }

    if (entry.related_to?.length && ctx.stmts.updateRelatedTo) {
      ctx.stmts.updateRelatedTo.run(JSON.stringify(entry.related_to), entry.id);
    } else if (entry.related_to === null && ctx.stmts.updateRelatedTo) {
      ctx.stmts.updateRelatedTo.run(null, entry.id);
    }
    if (isDualWriteEnabled(config) && entry.filePath) {
      dualWriteLocal(entry.filePath, entry.kind);
    }

    // Remote sync for updates: fire-and-forget PUT to hosted API
    const updateRemoteClient = getRemoteClient(config);
    if (updateRemoteClient) {
      updateRemoteClient.saveEntry({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        body: entry.body,
        tags: entry.tags,
        meta: entry.meta,
        source: entry.source,
      }).catch((e: Error) => {
        console.warn(`[context-vault] Remote sync (update) failed: ${e.message}`);
      });
    }

    const relPath = entry.filePath
      ? entry.filePath.replace(config.vaultDir + '/', '')
      : entry.filePath;
    const parts = [`✓ Updated ${entry.kind} → ${relPath}`, `  id: ${entry.id}`];
    if (entry.title) parts.push(`  title: ${entry.title}`);
    const entryTags = entry.tags || [];
    if (entryTags.length) parts.push(`  tags: ${entryTags.join(', ')}`);
    parts.push('', '_Search with get_context to verify changes._');
    return ok(parts.join('\n'));
  }

  // ── Create mode ──
  if (!kind) return err('Required: kind (for new entries)', 'INVALID_INPUT');
  const kindErr = ensureValidKind(kind);
  if (kindErr) return kindErr;
  if (!body?.trim()) return err('Required: body (for new entries)', 'INVALID_INPUT');

  // Normalize kind to canonical singular form (e.g. "insights" → "insight")
  const normalizedKind = normalizeKind(kind);

  if (categoryFor(normalizedKind) === 'entity' && !identity_key) {
    return err(`Entity kind "${normalizedKind}" requires identity_key`, 'MISSING_IDENTITY_KEY');
  }

  // ── Deferred sync: file-only write, skip DB entirely ──────────────────
  if (isDeferredSyncEnabled(config)) {
    const category = categoryFor(normalizedKind);
    const effectiveTier = tier ?? defaultTierFor(normalizedKind);
    const mergedMeta = { ...(meta || {}) };
    if (folder) mergedMeta.folder = folder;
    const parsedCtx = parseContextParam(encoding_context);
    if (parsedCtx?.structured) {
      mergedMeta.encoding_context = parsedCtx.structured;
    } else if (parsedCtx?.text) {
      mergedMeta.encoding_context = parsedCtx.text;
    }
    if (normalizedKind === 'decision') {
      enrichDecisionMeta(mergedMeta, title, body);
    }
    const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

    let entry;
    try {
      entry = writeEntry(ctx, {
        kind: normalizedKind,
        title,
        body,
        meta: finalMeta,
        tags,
        source,
        folder,
        identity_key,
        expires_at,
        supersedes,
        related_to,
        source_files,
        tier: effectiveTier,
        indexed: false,
      });
    } catch (e) {
      return errWithHint(
        e instanceof Error ? e.message : String(e),
        'SAVE_FAILED',
        'context-vault save_context is failing. Check `cat ~/.context-mcp/error.log | tail -5` and help me debug.'
      );
    }

    if (isDualWriteEnabled(config) && entry.filePath) {
      dualWriteLocal(entry.filePath, normalizedKind);
    }

    const relPath = entry.filePath
      ? entry.filePath.replace(config.vaultDir + '/', '')
      : entry.filePath;
    const icon = kindIcon(normalizedKind);
    const parts = [
      `## ✓ Saved (deferred)`,
      `${icon} **${title || '(untitled)'}**`,
      `\`${normalizedKind}\` · **${effectiveTier}**${tags?.length ? ` · ${tags.join(', ')}` : ''}`,
      `\`${entry.id}\` → ${relPath}`,
      '',
      '_Deferred sync: file written, not yet indexed. Run `vault sync` to index._',
    ];
    return ok(parts.join('\n'));
  }

  // Start reindex in background but don't wait — similarity check
  // may miss unindexed entries, but the save won't time out
  await ensureIndexed({ blocking: false });

  // ── Similarity check (knowledge + event only) ────────────────────────────
  const category = categoryFor(normalizedKind);
  let similarEntries: any[] = [];
  let queryEmbedding: any = null;

  if (category === 'knowledge' || category === 'event') {
    const threshold = similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const embeddingText = [title, body].filter(Boolean).join(' ');
    try {
      queryEmbedding = await ctx.embed(embeddingText);
    } catch {
      queryEmbedding = null;
    }
    if (queryEmbedding) {
      similarEntries = await findSimilar(
        ctx,
        queryEmbedding,
        threshold,

        { hydrate: suggestMode }
      );
    }
  }

  if (dry_run) {
    const parts = ['(dry run — nothing saved)'];
    if (similarEntries.length) {
      if (suggestMode) {
        const candidates = buildConflictCandidates(similarEntries);
        parts.push('', '⚠ Similar entries already exist:');
        for (const e of similarEntries) {
          const score = e.score.toFixed(2);
          const titleDisplay = e.title ? `"${e.title}"` : '(no title)';
          parts.push(`  - ${titleDisplay} (${score}) — id: ${e.id}`);
        }
        parts.push(formatConflictSuggestions(candidates));
        parts.push(
          '',
          'Use save_context with `id: <existing>` to update one, or omit `dry_run` to save as new.'
        );
      } else {
        parts.push('', '⚠ Similar entries already exist:');
        for (const e of similarEntries) {
          const score = e.score.toFixed(2);
          const titleDisplay = e.title ? `"${e.title}"` : '(no title)';
          parts.push(`  - ${titleDisplay} (${score}) — id: ${e.id}`);
        }
        parts.push(
          '',
          'Use save_context with `id: <existing>` to update one, or omit `dry_run` to save as new.'
        );
      }
    } else {
      parts.push('', 'No similar entries found. Safe to save.');
    }
    return ok(parts.join('\n'));
  }

  const mergedMeta = { ...(meta || {}) };
  if (folder) mergedMeta.folder = folder;

  // Merge encoding context into meta for persistence
  const parsedCtx = parseContextParam(encoding_context);
  if (parsedCtx?.structured) {
    mergedMeta.encoding_context = parsedCtx.structured;
  } else if (parsedCtx?.text) {
    mergedMeta.encoding_context = parsedCtx.text;
  }

  if (normalizedKind === 'decision') {
    enrichDecisionMeta(mergedMeta, title, body);
  }

  const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

  const effectiveTier = tier ?? defaultTierFor(normalizedKind);

  const effectiveIndexed = shouldIndex(
    {
      kind: normalizedKind,
      category,
      bodyLength: body?.length ?? 0,
      explicitIndexed: indexed,
    },
    config.indexing
  );

  const embeddingToReuse = category === 'knowledge' && effectiveIndexed ? queryEmbedding : null;

  let entry;
  try {
    entry = await captureAndIndex(
      ctx,
      {
        kind: normalizedKind,
        title,
        body,
        meta: finalMeta,
        tags,
        source,
        folder,
        identity_key,
        expires_at,
        supersedes,
        related_to,
        source_files,
        tier: effectiveTier,
        indexed: effectiveIndexed,
      },
      embeddingToReuse
    );
  } catch (e) {
    return errWithHint(
      e instanceof Error ? e.message : String(e),
      'SAVE_FAILED',
      'context-vault save_context is failing. Check `cat ~/.context-mcp/error.log | tail -5` and help me debug.'
    );
  }

  // Store context embedding in vault_ctx_vec for contextual reinstatement
  if (parsedCtx?.text && entry && effectiveIndexed) {
    try {
      const ctxEmbedding = await ctx.embed(parsedCtx.text);
      if (ctxEmbedding) {
        const rowidResult = ctx.stmts.getRowid.get(entry.id) as { rowid: number } | undefined;
        if (rowidResult?.rowid) {
          const rowid = Number(rowidResult.rowid);
          try { ctx.deleteCtxVec(rowid); } catch {}
          ctx.insertCtxVec(rowid, ctxEmbedding);
        }
      }
    } catch (e) {
      // Non-fatal: context embedding failure should not block the save
      console.warn(`[context-vault] Context embedding failed: ${(e as Error).message}`);
    }
  }

  if (isDualWriteEnabled(config) && entry.filePath) {
    dualWriteLocal(entry.filePath, normalizedKind);
  }

  // Remote sync: fire-and-forget POST to hosted API
  const remoteClient = getRemoteClient(config);
  if (visibility === 'team') {
    const effectiveTeamId = getTeamId(config);
    if (!remoteClient) {
      console.warn('[context-vault] Team publish skipped: remote not configured');
    } else if (!effectiveTeamId) {
      console.warn('[context-vault] Team publish skipped: no teamId configured');
    } else if (category === 'event') {
      console.warn('[context-vault] Team publish skipped: events are private');
    } else {
      remoteClient.publishToTeam({
        entryId: entry.id,
        teamId: effectiveTeamId,
        visibility: 'team',
        entry: {
          kind: normalizedKind,
          title,
          body,
          tags,
          meta: finalMeta,
          source,
          identity_key,
          tier: effectiveTier,
          category,
        },
      }).catch((e: Error) => {
        console.warn(`[context-vault] Team publish failed: ${e.message}`);
      });
    }
  } else if (remoteClient) {
    remoteClient.saveEntry({
      id: entry.id,
      kind: normalizedKind,
      title,
      body,
      tags,
      meta: finalMeta,
      source,
      identity_key,
      expires_at,
      supersedes,
      related_to,
      source_files,
      tier: effectiveTier,
    }).catch((e: Error) => {
      console.warn(`[context-vault] Remote sync failed: ${e.message}`);
    });
  }

  if (ctx.config?.dataDir) {
    maybeShowFeedbackPrompt(ctx.config.dataDir);
  }

  const relPath = entry.filePath
    ? entry.filePath.replace(config.vaultDir + '/', '')
    : entry.filePath;
  const icon = kindIcon(normalizedKind);
  const parts = [
    `## ✓ Saved`,
    `${icon} **${title || '(untitled)'}**`,
    `\`${normalizedKind}\` · **${effectiveTier}**${tags?.length ? ` · ${tags.join(', ')}` : ''}`,
    `\`${entry.id}\` → ${relPath}`,
  ];
  if (!effectiveIndexed) {
    parts.push(
      '',
      '_Note: this entry is stored as a file but not indexed for search. It will not appear in search results. Use `include_unindexed: true` in list_context to browse stored-only entries._'
    );
  }
  if (effectiveTier === 'ephemeral') {
    parts.push(
      '',
      '_Note: ephemeral entries are excluded from default search. Use `include_ephemeral: true` in get_context to find them._'
    );
  }
  const hasBucketTag = (tags || []).some(
    (t: any) => typeof t === 'string' && t.startsWith('bucket:')
  );
  if (tags && tags.length > 0 && !hasBucketTag) {
    parts.push(
      '',
      '_Tip: Consider adding a `bucket:` tag (e.g., `bucket:myproject`) for project-scoped retrieval._'
    );
  }
  const bucketTags = (tags || []).filter(
    (t: any) => typeof t === 'string' && t.startsWith('bucket:')
  );
  for (const bt of bucketTags) {
    const exists = ctx.db
      .prepare(
        `SELECT 1 FROM vault WHERE kind = 'bucket' AND identity_key = ? LIMIT 1`
      )
      .get(bt);
    if (!exists) {
      // Auto-register the bucket silently
      const bucketName = bt.replace(/^bucket:/, '');
      try {
        await captureAndIndex(ctx, {
          kind: 'bucket',
          title: bucketName,
          body: `Bucket for project: ${bucketName}`,
          tags: [bt],
          identity_key: bt,
        });
      } catch {
        // Non-fatal: bucket registration failure should not block the save
      }
    }
  }
  if (similarEntries.length) {
    if (suggestMode) {
      const candidates = buildConflictCandidates(similarEntries);
      parts.push(formatSimilarWarning(similarEntries));
      parts.push(formatConflictSuggestions(candidates));
    } else {
      parts.push(formatSimilarWarning(similarEntries));
    }
  }

  // Auto-memory overlap detection (advisory)
  try {
    const autoMemory = getAutoMemory();
    if (autoMemory.detected && autoMemory.entries.length > 0) {
      const searchText = [title, body].filter(Boolean).join(' ');
      const overlaps = findAutoMemoryOverlaps(autoMemory, searchText, 0.3);
      if (overlaps.length > 0) {
        const top = overlaps[0];
        parts.push('');
        parts.push(`### Auto-Memory Overlap`);
        parts.push(`Similar content found in auto-memory: **${top.name}** (\`${top.file}\`, ${top.type} type, ${(top.similarity * 100).toFixed(0)}% overlap)`);
        parts.push(`_This knowledge already exists in your auto-memory. Consider whether vault storage adds cross-project value._`);
      }
    }
  } catch {
    // Non-fatal: auto-memory overlap check should not block save
  }

  const criticalLimit = config.thresholds?.totalEntries?.critical;
  if (criticalLimit != null) {
    try {
      const countRow = ctx.db.prepare('SELECT COUNT(*) as c FROM vault').get() as any;
      if (countRow?.c != null && countRow.c >= criticalLimit) {
        parts.push(
          ``,
          `ℹ Vault has ${countRow.c.toLocaleString()} entries. Consider running \`context-vault reindex\` or reviewing old entries.`
        );
      }
    } catch {}
  }

  return ok(parts.join('\n'));
}
