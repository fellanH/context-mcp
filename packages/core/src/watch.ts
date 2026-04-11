import { watch, readFileSync, existsSync, statSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
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
  /** Max concurrent file processing operations. Default 3. */
  maxConcurrency?: number;
  /** Max events queued before dropping oldest. Default 200. */
  maxQueueSize?: number;
  /** Data directory for the lock file (e.g. ~/.context-mcp). */
  dataDir?: string;
}

export interface VaultWatcher {
  close: () => void;
  /** Mark a path as self-written so the watcher skips it. TTL: 2 seconds. */
  markSelfWrite: (filePath: string) => void;
}

const EXCLUDED_DIRS = new Set(['_archive', 'projects']);
const SELF_WRITE_TTL_MS = 2_000;
const LOCK_STALE_MS = 60_000;

function isExcluded(relPath: string): boolean {
  if (relPath.startsWith('.')) return true;
  const parts = relPath.split('/');
  for (const part of parts) {
    if (part.startsWith('.')) return true;
    if (EXCLUDED_DIRS.has(part)) return true;
  }
  return false;
}

/**
 * Acquire a watcher lock file so only one instance watches per vault.
 * Returns a release function, or null if another instance holds the lock.
 */
function acquireWatcherLock(dataDir: string): (() => void) | null {
  const lockPath = join(dataDir, 'watcher.lock');
  mkdirSync(dataDir, { recursive: true });

  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, 'utf-8').trim();
      const [pidStr, tsStr] = content.split(':');
      const pid = parseInt(pidStr, 10);
      const ts = parseInt(tsStr, 10);

      // Check if the lock holder is still alive
      if (pid && !isNaN(pid)) {
        try {
          process.kill(pid, 0); // signal 0 = check if alive
          // Process is alive. Check if lock is stale (>60s without refresh).
          if (Date.now() - ts < LOCK_STALE_MS) {
            return null; // another live instance holds the lock
          }
          // Stale lock from a live process that stopped refreshing. Take over.
        } catch {
          // Process is dead. Safe to take over the lock.
        }
      }
    } catch {
      // Unreadable lock file. Overwrite it.
    }
  }

  const writeLock = () => {
    try { writeFileSync(lockPath, `${process.pid}:${Date.now()}`); } catch {}
  };
  writeLock();

  // Refresh lock periodically so other instances know we're alive
  const refreshInterval = setInterval(writeLock, 15_000);
  refreshInterval.unref();

  return () => {
    clearInterval(refreshInterval);
    try { unlinkSync(lockPath); } catch {}
  };
}

async function processFile(ctx: BaseCtx, filePath: string, opts: WatcherOptions): Promise<void> {
  try {
    if (!existsSync(filePath)) return;
    const stat = statSync(filePath);
    if (!stat.isFile()) return;

    const content = readFileSync(filePath, 'utf-8');
    const { meta: fmMeta, body: rawBody } = parseFrontmatter(content);

    const id = fmMeta.id as string | undefined;
    if (!id) return; // no frontmatter id = not a vault entry

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
  const maxConcurrency = opts.maxConcurrency ?? 3;
  const maxQueueSize = opts.maxQueueSize ?? 200;

  // Singleton lock: only one watcher per vault directory
  const dataDir = opts.dataDir || dirname(opts.vaultDir);
  const releaseLock = acquireWatcherLock(dataDir);
  if (!releaseLock) {
    throw new Error('Another instance is already watching this vault. Skipping watcher.');
  }

  const pending = new Map<string, NodeJS.Timeout>();
  const selfWrites = new Map<string, number>(); // path -> expiry timestamp
  let activeOps = 0;
  const queue: Array<{ fullPath: string; isDelete: boolean }> = [];
  let watcher: FSWatcher;

  function drainQueue(): void {
    while (activeOps < maxConcurrency && queue.length > 0) {
      const item = queue.shift()!;
      activeOps++;
      if (item.isDelete) {
        processDelete(ctx, item.fullPath, opts);
        activeOps--;
        drainQueue();
      } else {
        processFile(ctx, item.fullPath, opts)
          .finally(() => {
            activeOps--;
            drainQueue();
          });
      }
    }
  }

  function enqueue(fullPath: string, isDelete: boolean): void {
    // Drop oldest if queue is full (back-pressure under bulk operations)
    if (queue.length >= maxQueueSize) {
      const dropped = queue.length - maxQueueSize + 1;
      queue.splice(0, dropped);
    }
    queue.push({ fullPath, isDelete });
    drainQueue();
  }

  try {
    watcher = watch(opts.vaultDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const relPath = filename.replace(/\\/g, '/');
      if (extname(relPath) !== '.md') return;
      if (isExcluded(relPath)) return;

      const fullPath = join(opts.vaultDir, relPath);

      // Skip self-written files (written by this MCP server via save_context)
      const selfExpiry = selfWrites.get(fullPath);
      if (selfExpiry && Date.now() < selfExpiry) {
        selfWrites.delete(fullPath);
        return;
      }

      if (pending.has(fullPath)) clearTimeout(pending.get(fullPath)!);
      pending.set(
        fullPath,
        setTimeout(() => {
          pending.delete(fullPath);
          const isDelete = !existsSync(fullPath);
          enqueue(fullPath, isDelete);
        }, debounceMs)
      );
    });

    watcher.on('error', (err) => {
      opts.onError?.(err);
    });
  } catch (err) {
    releaseLock();
    throw new Error(`Failed to start vault watcher: ${(err as Error).message}`);
  }

  return {
    close() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      queue.length = 0;
      watcher.close();
      releaseLock();
    },
    markSelfWrite(filePath: string) {
      selfWrites.set(filePath, Date.now() + SELF_WRITE_TTL_MS);
    },
  };
}
