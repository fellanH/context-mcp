#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

// Module-level shutdown coordination so pipe/uncaught handlers (below main())
// can route through the graceful shutdown wired up inside main().
let shutdownHandler: ((signal: string) => void) | null = null;
let shutdownInProgress = false;

function isPipeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED' || e.code === 'ERR_STREAM_WRITE_AFTER_END') return true;
  return typeof e.message === 'string' && /\bEPIPE\b/.test(e.message);
}

function handlePipeDisconnect(source: string): void {
  if (shutdownInProgress) return;
  if (shutdownHandler) {
    try {
      shutdownHandler(`EPIPE:${source}`);
    } catch {
      process.exit(0);
    }
  } else {
    // Shutdown not wired yet (startup phase). Exit clean so WAL isn't dirtied.
    process.exit(0);
  }
}

// Catch broken-pipe writes to stdout/stderr so they route through graceful
// shutdown instead of bubbling up as an `uncaughtException` that skips the
// WAL checkpoint. Node raises EPIPE (not SIGPIPE) on pipe writes with no reader.
process.stdout.on('error', (err) => {
  if (isPipeError(err)) {
    handlePipeDisconnect('stdout');
  } else {
    throw err;
  }
});
process.stderr.on('error', (err) => {
  if (isPipeError(err)) {
    handlePipeDisconnect('stderr');
  } else {
    throw err;
  }
});

import { resolveConfig } from '@context-vault/core/config';
import type { LocalCtx } from './types.js';
import { appendErrorLog } from './error-log.js';
import { sendTelemetryEvent, maybeShowTelemetryNotice } from './telemetry.js';
import { embed } from '@context-vault/core/embed';
import {
  initDatabase,
  NativeModuleError,
  prepareStatements,
  insertVec,
  deleteVec,
  insertCtxVec,
  deleteCtxVec,
} from '@context-vault/core/db';
import { registerTools } from './register-tools.js';
import { pruneExpired } from '@context-vault/core/index';
import { startWatcher } from '@context-vault/core/watch';
import { setSessionId } from '@context-vault/core/search';

async function main(): Promise<void> {
  let phase = 'CONFIG';
  let db: import('node:sqlite').DatabaseSync | undefined;
  let config: import('@context-vault/core/types').VaultConfig | undefined;

  try {
    config = resolveConfig();

    phase = 'DIRS';
    mkdirSync(config.dataDir, { recursive: true });
    mkdirSync(config.vaultDir, { recursive: true });
    maybeShowTelemetryNotice(config.dataDir);

    try {
      const probe = join(config.vaultDir, '.write-probe');
      writeFileSync(probe, '');
      unlinkSync(probe);
    } catch (writeErr) {
      console.error(`[context-vault] FATAL: Vault directory is not writable: ${config.vaultDir}`);
      console.error(`[context-vault] ${(writeErr as Error).message}`);
      console.error(`[context-vault] Fix permissions: chmod u+w "${config.vaultDir}"`);
      process.exit(1);
    }

    try {
      const markerPath = join(config.vaultDir, '.context-mcp');
      const markerData = existsSync(markerPath)
        ? JSON.parse(readFileSync(markerPath, 'utf-8'))
        : {};
      writeFileSync(
        markerPath,
        JSON.stringify(
          {
            created: markerData.created || new Date().toISOString(),
            version: pkg.version,
          },
          null,
          2
        ) + '\n'
      );
    } catch (markerErr) {
      console.error(
        `[context-vault] Warning: could not write marker file: ${(markerErr as Error).message}`
      );
    }

    config.vaultDirExists = existsSync(config.vaultDir);

    // Validate vaultDir sanity
    const osTmp = tmpdir();
    const isTempPath = config.vaultDir.startsWith(osTmp) ||
      config.vaultDir.startsWith('/tmp/') ||
      config.vaultDir.startsWith('/var/folders/');
    if (isTempPath) {
      console.error(`[context-vault] WARNING: vaultDir points to a temp directory: ${config.vaultDir}`);
      console.error(`[context-vault] This is likely from a test run that overwrote ~/.context-mcp/config.json`);
      console.error(`[context-vault] Fix: run 'context-vault reconnect' or 'context-vault setup'`);
    }

    if (config.vaultDirExists) {
      try {
        const entries = readdirSync(config.vaultDir);
        const hasMdFiles = entries.some(f => f.endsWith('.md'));
        const hasMarker = entries.includes('.context-mcp');
        if (!hasMdFiles && hasMarker) {
          console.error(`[context-vault] WARNING: vaultDir has no markdown files but has a marker file`);
          console.error(`[context-vault] The vault may be misconfigured. Run 'context-vault reconnect'`);
        }
      } catch {}
    }

    console.error(`[context-vault] Vault: ${config.vaultDir}`);
    console.error(`[context-vault] Database: ${config.dbPath}`);
    console.error(`[context-vault] Dev dir: ${config.devDir}`);
    if (!config.vaultDirExists) {
      console.error(`[context-vault] WARNING: Vault directory not found!`);
    }

    phase = 'DB';
    db = await initDatabase(config.dbPath);
    const stmts = prepareStatements(db);

    const ctx: LocalCtx = {
      db,
      config,
      stmts,
      embed,
      insertVec: (rowid: number, embedding: Float32Array) => insertVec(stmts, rowid, embedding),
      deleteVec: (rowid: number) => deleteVec(stmts, rowid),
      insertCtxVec: (rowid: number, embedding: Float32Array) => insertCtxVec(stmts, rowid, embedding),
      deleteCtxVec: (rowid: number) => deleteCtxVec(stmts, rowid),
      activeOps: { count: 0 },
      toolStats: { ok: 0, errors: 0, lastError: null },
    };

    setSessionId(randomUUID());

    try {
      const pruned = await pruneExpired(ctx);
      if (pruned > 0) {
        console.error(
          `[context-vault] Pruned ${pruned} expired ${pruned === 1 ? 'entry' : 'entries'}`
        );
      }
    } catch (pruneErr) {
      console.error(
        `[context-vault] Warning: startup prune failed: ${(pruneErr as Error).message}`
      );
    }

    if (config.watch?.enabled === true && config.vaultDirExists) {
      try {
        const vaultWatcher = startWatcher(ctx, {
          vaultDir: config.watch?.path || config.vaultDir,
          debounceMs: config.watch?.debounceMs ?? 500,
          indexingConfig: config.indexing,
          dataDir: config.dataDir,
          onError: (err) => console.error(`[context-vault] Watcher: ${err.message}`),
        });
        // Expose markSelfWrite on ctx so save_context can suppress re-indexing
        (ctx as any).markSelfWrite = vaultWatcher.markSelfWrite;
        process.on('exit', () => vaultWatcher.close());
        console.error('[context-vault] Filesystem watcher active (opt-in via config)');
      } catch (err) {
        console.error(`[context-vault] Watcher skipped: ${(err as Error).message}`);
      }
    }

    phase = 'SERVER';

    const CONFIG_CACHE_TTL_MS = 30_000;
    let cachedConfig = config;
    let configCachedAt = Date.now();
    let lastVaultDir = config.vaultDir;
    Object.defineProperty(ctx as object, 'config', {
      get() {
        const now = Date.now();
        if (now - configCachedAt < CONFIG_CACHE_TTL_MS) return cachedConfig!;
        const fresh = resolveConfig();
        if (fresh.vaultDir !== lastVaultDir) {
          console.error(`[context-vault] Config reloaded: vaultDir changed to ${fresh.vaultDir}`);
          lastVaultDir = fresh.vaultDir;
          fresh.vaultDirExists = existsSync(fresh.vaultDir);
        }
        cachedConfig = fresh;
        configCachedAt = now;
        return fresh;
      },
      configurable: true,
    });

    function createServer(): McpServer {
      const s = new McpServer(
        { name: 'context-vault', version: pkg.version },
        { capabilities: { tools: {} } }
      );
      registerTools(s, ctx);
      return s;
    }

    function closeDb(): void {
      try {
        if ((db as any).inTransaction) {
          console.error('[context-vault] Rolling back active transaction...');
          db!.exec('ROLLBACK');
        }
        db!.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db!.close();
        console.error('[context-vault] Database closed cleanly.');
      } catch (shutdownErr) {
        console.error(`[context-vault] Shutdown error: ${(shutdownErr as Error).message}`);
      }
      process.exit(0);
    }

    function shutdown(signal: string): void {
      // Idempotent: EPIPE from stdout error + uncaughtException can both fire
      // during a single client disconnect. Second call becomes a no-op.
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      const isEpipe = signal.startsWith('EPIPE');
      if (isEpipe) {
        // Log a clean shutdown entry in place of the EPIPE uncaughtException
        // that would otherwise have fired. Keeps the audit log readable.
        appendErrorLog(config!.dataDir, {
          timestamp: new Date().toISOString(),
          error_type: 'EPIPE_shutdown',
          message: `client pipe closed (${signal}); graceful shutdown`,
          node_version: process.version,
          platform: process.platform,
          arch: process.arch,
          cv_version: pkg.version,
        });
        console.error(`[context-vault] EPIPE shutdown: client disconnected (${signal})`);
      } else {
        console.error(`[context-vault] Received ${signal}, shutting down...`);
      }

      if (ctx.activeOps.count > 0) {
        console.error(
          `[context-vault] Waiting for ${ctx.activeOps.count} in-flight operation(s)...`
        );
        const check = setInterval(() => {
          if (ctx.activeOps.count === 0) {
            clearInterval(check);
            closeDb();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          console.error(
            `[context-vault] Force shutdown — ${ctx.activeOps.count} operation(s) still running`
          );
          closeDb();
        }, 5000);
      } else {
        closeDb();
      }
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Expose shutdown to module-level handlers (stdout error, uncaughtException).
    shutdownHandler = shutdown;

    // RSS watchdog: kill the process if memory usage exceeds the cap.
    // Prevents runaway embedding/reindex operations from frying user systems.
    const MAX_RSS_BYTES = parseInt(process.env.CONTEXT_VAULT_MAX_RSS_MB || '1024', 10) * 1024 * 1024;
    const rssWatchdog = setInterval(() => {
      const { rss } = process.memoryUsage();
      if (rss > MAX_RSS_BYTES) {
        const rssMb = Math.round(rss / 1024 / 1024);
        const capMb = Math.round(MAX_RSS_BYTES / 1024 / 1024);
        console.error(`[context-vault] WATCHDOG: RSS ${rssMb}MB exceeds ${capMb}MB limit. Shutting down to protect system resources.`);
        console.error(`[context-vault] Adjust limit with CONTEXT_VAULT_MAX_RSS_MB env var, or run 'context-vault reindex' manually.`);
        process.exit(137);
      }
    }, 5_000);
    rssWatchdog.unref();

    phase = 'CONNECTED';

    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (rawErr) {
    const err = rawErr as Error;
    const dataDir = config?.dataDir || join(homedir(), '.context-mcp');

    const logEntry = {
      timestamp: new Date().toISOString(),
      error_type: (err as any).constructor?.name || 'Error',
      message: err.message,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      cv_version: pkg.version,
      phase,
    };
    appendErrorLog(dataDir, logEntry);
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(
        join(dataDir, '.last-error'),
        `${logEntry.timestamp} [${phase}] ${err.message}`
      );
    } catch {}

    sendTelemetryEvent(config, {
      event: 'startup_error',
      code: phase,
      tool: null,
      cv_version: pkg.version,
    });

    if (rawErr instanceof NativeModuleError) {
      console.error('');
      console.error('╔══════════════════════════════════════════════════════════════╗');
      console.error('║  context-vault: Native Module Error                         ║');
      console.error('╚══════════════════════════════════════════════════════════════╝');
      console.error('');
      console.error(err.message);
      console.error('');
      console.error(`  Platform:        ${process.platform}/${process.arch}`);
      console.error(`  Node.js path:    ${process.execPath}`);
      console.error(`  Node.js version: ${process.version}`);
      console.error(`  Error log:       ${join(dataDir, 'error.log')}`);
      console.error('');
      process.exit(78);
    }

    console.error(`[context-vault] Fatal error during ${phase} phase: ${err.message}`);
    console.error(`[context-vault] Error log: ${join(dataDir, 'error.log')}`);
    if (phase === 'DB') {
      console.error(
        `[context-vault] Try deleting the DB file and restarting: rm "${config?.dbPath || 'vault.db'}"`
      );
    }
    process.exit(1);
  }
}

process.on('uncaughtException', (err) => {
  // EPIPE from a dead client pipe is not a crash; it's a disconnect.
  // Route through graceful shutdown so the WAL is checkpointed.
  if (isPipeError(err)) {
    handlePipeDisconnect('uncaught');
    return;
  }

  const dataDir = join(homedir(), '.context-mcp');
  const logEntry = {
    timestamp: new Date().toISOString(),
    error_type: 'uncaughtException',
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 5).join(' | '),
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cv_version: pkg.version,
  };
  appendErrorLog(dataDir, logEntry);
  console.error(`[context-vault] Uncaught exception: ${err.message}`);
  console.error(`[context-vault] Error log: ${join(dataDir, 'error.log')}`);
  console.error(`[context-vault] Run: context-vault doctor`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const dataDir = join(homedir(), '.context-mcp');
  const message = reason instanceof Error ? reason.message : String(reason);
  const logEntry = {
    timestamp: new Date().toISOString(),
    error_type: 'unhandledRejection',
    message,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cv_version: pkg.version,
  };
  appendErrorLog(dataDir, logEntry);
  console.error(`[context-vault] Unhandled rejection: ${message}`);
  console.error(`[context-vault] Error log: ${join(dataDir, 'error.log')}`);
  console.error(`[context-vault] Run: context-vault doctor`);
  process.exit(1);
});

main().catch((err) => {
  console.error(`[context-vault] Unexpected fatal error: ${err.message}`);
  process.exit(1);
});
