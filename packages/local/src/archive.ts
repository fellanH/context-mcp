import { existsSync, mkdirSync, renameSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { categoryDirFor, categoryFor, defaultTierFor } from '@context-vault/core/categories';
import { parseFrontmatter, parseEntryFromMarkdown } from '@context-vault/core/frontmatter';
import { DEFAULT_LIFECYCLE } from '@context-vault/core/constants';
import { walkDir } from '@context-vault/core/files';
import { indexEntry } from '@context-vault/core/index';
import type { LocalCtx } from './types.js';
import type { VaultConfig } from '@context-vault/core/types';

const VALID_TIERS = new Set(['ephemeral', 'working', 'durable']);
const VALID_CATEGORIES = new Set(['knowledge', 'entity', 'event']);

function resolveLifecycle(config: VaultConfig): Record<string, { archiveAfterDays?: number }> {
  return config?.lifecycle ?? structuredClone(DEFAULT_LIFECYCLE);
}

function archiveDir(vaultDir: string): string {
  return join(vaultDir, '_archive');
}

export function findArchiveCandidates(ctx: LocalCtx): unknown[] {
  const lifecycle = resolveLifecycle(ctx.config);
  const now = new Date();
  const candidates: unknown[] = [];
  const seen = new Set<string>();

  for (const [key, rules] of Object.entries(lifecycle)) {
    if (!rules?.archiveAfterDays) continue;
    const cutoff = new Date(now.getTime() - rules.archiveAfterDays * 86400000).toISOString();

    const isTier = VALID_TIERS.has(key);
    const isCategory = VALID_CATEGORIES.has(key);
    if (!isTier && !isCategory) continue;

    const column = isTier ? 'tier' : 'category';
    const rows = ctx.db
      .prepare(
        `SELECT id, kind, category, title, tier, file_path, created_at, updated_at
         FROM vault
         WHERE ${column} = ? AND COALESCE(updated_at, created_at) <= ?
         ORDER BY COALESCE(updated_at, created_at) ASC`
      )
      .all(key, cutoff) as Array<{ id: string; file_path: string | null; [key: string]: unknown }>;

    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      candidates.push({
        ...row,
        reason: `${column}=${key}, archiveAfterDays=${rules.archiveAfterDays}`,
      });
    }
  }

  return candidates;
}

function removeFromIndex(ctx: LocalCtx, id: string): void {
  const rowidRow = ctx.stmts.getRowid.get(id) as { rowid?: number } | undefined;
  if (rowidRow?.rowid) {
    try {
      ctx.deleteVec(Number(rowidRow.rowid));
    } catch {}
  }
  ctx.stmts.deleteEntry.run(id);
}

export async function archiveEntries(
  ctx: LocalCtx
): Promise<{ archived: unknown[]; count: number }> {
  const candidates = findArchiveCandidates(ctx) as Array<{
    id: string;
    file_path: string | null;
    [key: string]: unknown;
  }>;
  if (candidates.length === 0) return { archived: candidates, count: 0 };

  const vaultDir = ctx.config.vaultDir;
  const archRoot = archiveDir(vaultDir);
  let count = 0;

  for (const entry of candidates) {
    const filePath = entry.file_path;
    if (!filePath) {
      removeFromIndex(ctx, entry.id);
      count++;
      continue;
    }

    const rel = relative(vaultDir, filePath);
    if (rel.startsWith('..') || rel.startsWith('_archive')) continue;

    const destPath = join(archRoot, rel);
    const destDir = dirname(destPath);

    try {
      mkdirSync(destDir, { recursive: true });
      renameSync(filePath, destPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !existsSync(filePath)) {
        // File already gone — just remove from index
      } else {
        throw e;
      }
    }

    removeFromIndex(ctx, entry.id);
    count++;
  }

  return { archived: candidates, count };
}

export async function restoreEntry(
  ctx: LocalCtx,
  entryId: string
): Promise<{ restored: boolean; reason?: string; filePath?: string; kind?: string; id?: string }> {
  const vaultDir = ctx.config.vaultDir;
  const archRoot = archiveDir(vaultDir);

  if (!existsSync(archRoot)) {
    return { restored: false, reason: 'no _archive directory' };
  }

  const mdFiles = walkDir(archRoot);
  let targetFile: string | null = null;

  for (const { filePath } of mdFiles) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const { meta } = parseFrontmatter(raw);
      if (meta.id === entryId) {
        targetFile = filePath;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!targetFile) {
    return { restored: false, reason: `entry ${entryId} not found in _archive` };
  }

  const rel = relative(archRoot, targetFile);
  const destPath = join(vaultDir, rel);
  const destDir = dirname(destPath);

  if (existsSync(destPath)) {
    return { restored: false, reason: `destination already exists: ${destPath}` };
  }

  mkdirSync(destDir, { recursive: true });
  renameSync(targetFile, destPath);

  const raw = readFileSync(destPath, 'utf-8');
  const { meta, body: rawBody } = parseFrontmatter(raw);

  const relFromVault = relative(vaultDir, destPath);
  const kindDir = relFromVault.split('/').filter(Boolean);
  let kind =
    (meta.kind as string | undefined) ||
    (kindDir.length >= 2 ? kindDir[kindDir.length - 2] : kindDir[0]) ||
    'note';

  const parsed = parseEntryFromMarkdown(kind, rawBody, meta);
  const category = categoryFor(kind);

  await indexEntry(ctx, {
    id: (meta.id as string | undefined) || entryId,
    kind,
    category,
    title: parsed.title,
    body: parsed.body,
    meta: parsed.meta ?? undefined,
    tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : null,
    source: (meta.source as string | undefined) || 'archive-restore',
    filePath: destPath,
    createdAt: (meta.created as string | undefined) || new Date().toISOString(),
    identity_key: (meta.identity_key as string | undefined) || null,
    expires_at: (meta.expires_at as string | undefined) || null,
    tier: (meta.tier as string | undefined) || defaultTierFor(kind),
    source_files: null,
  });

  return {
    restored: true,
    filePath: destPath,
    kind,
    id: (meta.id as string | undefined) || entryId,
  };
}

export function countArchivedEntries(vaultDir: string): number {
  const archRoot = archiveDir(vaultDir);
  if (!existsSync(archRoot)) return 0;
  try {
    return walkDir(archRoot).length;
  } catch {
    return 0;
  }
}

export function listArchivedEntries(vaultDir: string): Array<{
  id: string | null;
  kind: string;
  title: string;
  tags: unknown[];
  created: string | null;
  filePath: string;
}> {
  const archRoot = archiveDir(vaultDir);
  if (!existsSync(archRoot)) return [];

  const entries: Array<{
    id: string | null;
    kind: string;
    title: string;
    tags: unknown[];
    created: string | null;
    filePath: string;
  }> = [];
  try {
    const mdFiles = walkDir(archRoot);
    for (const { filePath, relDir } of mdFiles) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        entries.push({
          id: (meta.id as string | null) || null,
          kind: relDir?.split('/').pop() || 'unknown',
          title: (meta.title as string | undefined) || body.slice(0, 80),
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          created: (meta.created as string | null) || null,
          filePath,
        });
      } catch {
        continue;
      }
    }
  } catch {}
  return entries;
}
