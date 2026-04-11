import { watch, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';
import type { FSWatcher } from 'node:fs';
import type { BaseCtx, IndexingConfig } from './types.js';
import { parseFrontmatter, parseEntryFromMarkdown } from './frontmatter.js';
import { indexEntry } from './index.js';
import { categoryFor, defaultTierFor, CATEGORY_DIRS } from './categories.js';
import { dirToKind } from './files.js';
import { shouldIndex } from './indexing.js';

export interface WatcherOptions {
  vaultDir: string;
  debounceMs?: number;
  indexingConfig?: IndexingConfig;
  onIndex?: (filePath: string, action: 'upsert' | 'delete') => void;
  onError?: (err: Error) => void;
}

export interface VaultWatcher {
  close: () => void;
}

const EXCLUDED_DIRS = new Set(['_archive', 'projects']);

function isExcluded(relPath: string): boolean {
  if (relPath.startsWith('.')) return true;
  const parts = relPath.split('/');
  for (const part of parts) {
    if (part.startsWith('.')) return true;
    if (EXCLUDED_DIRS.has(part)) return true;
  }
  return false;
}

function extractIdFromPath(filePath: string): string | null {
  const name = basename(filePath, '.md');
  if (/^[0-9A-Z]{26}$/.test(name)) return name;
  const match = name.match(/^([0-9A-Z]{26})/);
  return match ? match[1] : null;
}

async function processFile(ctx: BaseCtx, filePath: string, opts: WatcherOptions): Promise<void> {
  try {
    if (!existsSync(filePath)) return;
    const stat = statSync(filePath);
    if (!stat.isFile()) return;

    const content = readFileSync(filePath, 'utf-8');
    const { meta: fmMeta, body: rawBody } = parseFrontmatter(content);

    const id = (fmMeta.id as string) || extractIdFromPath(filePath);
    if (!id) return;

    const relPath = relative(opts.vaultDir, filePath);
    const topDir = relPath.split('/')[0];
    const kind = (fmMeta.kind as string) || dirToKind(topDir) || 'reference';
    const category = categoryFor(kind);
    const tier = (fmMeta.tier as string) || defaultTierFor(kind);

    const { title, body, meta } = parseEntryFromMarkdown(kind, rawBody, fmMeta);

    const tags = Array.isArray(fmMeta.tags) ? (fmMeta.tags as string[]) : null;
    const source = typeof fmMeta.source === 'string' ? fmMeta.source : null;
    const identity_key = typeof fmMeta.identity_key === 'string' ? fmMeta.identity_key : null;
    const expires_at = typeof fmMeta.expires_at === 'string' ? fmMeta.expires_at : null;
    const createdAt = typeof fmMeta.created === 'string' ? fmMeta.created : new Date().toISOString();

    const source_files = fmMeta.source_files
      ? (fmMeta.source_files as Array<{ path: string; hash: string }>)
      : null;

    const explicitIndexed = fmMeta.indexed != null ? fmMeta.indexed === true || fmMeta.indexed === 'true' : undefined;
    const indexed = shouldIndex(
      { kind, category, bodyLength: body.length, explicitIndexed },
      opts.indexingConfig
    );

    const supersedes = Array.isArray(fmMeta.supersedes) ? (fmMeta.supersedes as string[]) : null;
    const related_to = Array.isArray(fmMeta.related_to) ? (fmMeta.related_to as string[]) : null;

    await indexEntry(ctx, {
      id,
      kind,
      category,
      title,
      body,
      meta: meta || undefined,
      tags,
      source,
      filePath,
      createdAt,
      identity_key,
      expires_at,
      source_files,
      tier,
      indexed,
      supersedes,
      related_to,
    });

    opts.onIndex?.(filePath, 'upsert');
  } catch (err) {
    opts.onError?.(err as Error);
  }
}

function processDelete(ctx: BaseCtx, filePath: string, opts: WatcherOptions): void {
  try {
    const row = ctx.db.prepare('SELECT rowid, id FROM vault WHERE file_path = ?').get(filePath) as
      | { rowid: number; id: string }
      | undefined;
    if (!row) return;

    ctx.deleteVec(row.rowid);
    ctx.deleteCtxVec(row.rowid);
    ctx.stmts.deleteEntry.run(row.id);

    opts.onIndex?.(filePath, 'delete');
  } catch (err) {
    opts.onError?.(err as Error);
  }
}

export function startWatcher(ctx: BaseCtx, opts: WatcherOptions): VaultWatcher {
  const debounceMs = opts.debounceMs ?? 500;
  const pending = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher;

  try {
    watcher = watch(opts.vaultDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const relPath = filename.replace(/\\/g, '/');
      if (extname(relPath) !== '.md') return;
      if (isExcluded(relPath)) return;

      const fullPath = join(opts.vaultDir, relPath);

      if (pending.has(fullPath)) clearTimeout(pending.get(fullPath)!);
      pending.set(
        fullPath,
        setTimeout(() => {
          pending.delete(fullPath);
          if (existsSync(fullPath)) {
            processFile(ctx, fullPath, opts).catch((err) => {
              opts.onError?.(err as Error);
            });
          } else {
            processDelete(ctx, fullPath, opts);
          }
        }, debounceMs)
      );
    });

    watcher.on('error', (err) => {
      opts.onError?.(err);
    });
  } catch (err) {
    throw new Error(`Failed to start vault watcher: ${(err as Error).message}`);
  }

  return {
    close() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      watcher.close();
    },
  };
}
