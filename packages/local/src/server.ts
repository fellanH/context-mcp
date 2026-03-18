#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

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
} from '@context-vault/core/db';
import { registerTools } from './register-tools.js';
import { pruneExpired } from '@context-vault/core/index';

const DAEMON_PORT = 3377;
const PID_PATH = join(homedir(), '.context-mcp', 'daemon.pid');

async function tryAutoDaemon(): Promise<void> {
  // Check if daemon is already running
  if (existsSync(PID_PATH)) {
    try {
      const { pid, port } = JSON.parse(readFileSync(PID_PATH, 'utf-8'));
      process.kill(pid, 0); // throws if dead
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return; // daemon is healthy, nothing to do
    } catch {
      // stale PID file or unhealthy, continue to start daemon
    }
  }

  const { spawn, execFileSync } = await import('node:child_process');

  // Spawn daemon process
  const serverPath = join(__dirname, 'server.js');
  const child = spawn(process.execPath, [serverPath, '--http', '--port', String(DAEMON_PORT)], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_OPTIONS: '--no-warnings=ExperimentalWarning' },
  });
  child.unref();

  // Wait for daemon to be healthy
  const deadline = Date.now() + 5000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${DAEMON_PORT}/health`);
      if (res.ok) { healthy = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  if (!healthy) {
    console.error('[context-vault] Auto-daemon failed to start, continuing in stdio mode');
    return;
  }

  // Reconfigure Claude Code to use HTTP transport
  const env = { ...process.env };
  delete (env as Record<string, string | undefined>).CLAUDECODE;
  try {
    execFileSync('claude', ['mcp', 'remove', 'context-vault', '-s', 'user'], { stdio: 'pipe', env });
  } catch {}
  try {
    execFileSync('claude', [
      'mcp', 'add', '-s', 'user', '--transport', 'http',
      'context-vault', `http://localhost:${DAEMON_PORT}/mcp`,
    ], { stdio: 'pipe', env });
    console.error(`[context-vault] Daemon started on port ${DAEMON_PORT}. New sessions will use shared HTTP mode.`);
  } catch {
    console.error('[context-vault] Daemon started but could not reconfigure Claude Code');
  }
}

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
      activeOps: { count: 0 },
      toolStats: { ok: 0, errors: 0, lastError: null },
    };

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

    const server = createServer();

    function closeDb(): void {
      try {
        if ((db as any).inTransaction) {
          console.error('[context-vault] Rolling back active transaction...');
          db!.exec('ROLLBACK');
        }
        (db as any).pragma('wal_checkpoint(TRUNCATE)');
        db!.close();
        console.error('[context-vault] Database closed cleanly.');
      } catch (shutdownErr) {
        console.error(`[context-vault] Shutdown error: ${(shutdownErr as Error).message}`);
      }
      process.exit(0);
    }

    function shutdown(signal: string): void {
      console.error(`[context-vault] Received ${signal}, shutting down...`);
      try { unlinkSync(join(homedir(), '.context-mcp', 'daemon.pid')); } catch {}

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

    phase = 'CONNECTED';

    const useHttp = process.argv.includes('--http');

    if (useHttp) {
      const portIdx = process.argv.indexOf('--port');
      const port = portIdx !== -1 && process.argv[portIdx + 1]
        ? parseInt(process.argv[portIdx + 1], 10)
        : 3377;

      const app = createMcpExpressApp();
      const transports: Record<string, StreamableHTTPServerTransport> = {};

      app.get('/health', (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          version: pkg.version,
          pid: process.pid,
          uptime: process.uptime(),
          sessions: Object.keys(transports).length,
        }));
      });

      app.post('/mcp', async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        try {
          let transport: StreamableHTTPServerTransport;
          if (sessionId && transports[sessionId]) {
            transport = transports[sessionId];
          } else if (!sessionId && isInitializeRequest((req as any).body)) {
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid: string) => {
                transports[sid] = transport;
              },
            });
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid && transports[sid]) {
                delete transports[sid];
              }
            };
            const sessionServer = createServer();
            await sessionServer.connect(transport);
            await transport.handleRequest(req, res, (req as any).body);
            return;
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: No valid session ID' },
              id: null,
            }));
            return;
          }
          await transport.handleRequest(req, res, (req as any).body);
        } catch (error) {
          console.error('[context-vault] HTTP error:', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            }));
          }
        }
      });

      app.get('/mcp', async (req: IncomingMessage, res: ServerResponse) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          res.writeHead(400);
          res.end('Invalid or missing session ID');
          return;
        }
        await transports[sessionId].handleRequest(req, res);
      });

      app.delete('/mcp', async (req: IncomingMessage, res: ServerResponse) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          res.writeHead(400);
          res.end('Invalid or missing session ID');
          return;
        }
        await transports[sessionId].handleRequest(req, res);
      });

      app.listen(port, () => {
        console.error(`[context-vault] Serving on http://localhost:${port}/mcp`);
        const pidDir = join(homedir(), '.context-mcp');
        mkdirSync(pidDir, { recursive: true });
        writeFileSync(join(pidDir, 'daemon.pid'), JSON.stringify({ pid: process.pid, port }));
      });
    } else {
      const transport = new StdioServerTransport();
      await server.connect(transport);

      // Auto-daemonize: if no daemon is running, spawn one in the background
      // and reconfigure Claude Code to use HTTP. Next session onwards, all
      // sessions share the single daemon process. This session stays on stdio.
      if (!process.env.CONTEXT_VAULT_NO_DAEMON) {
        setTimeout(() => tryAutoDaemon().catch(() => {}), 2000);
      }
    }

    setTimeout(() => {
      import('node:child_process')
        .then(({ execSync }) => {
          try {
            const latest = execSync('npm view context-vault version', {
              encoding: 'utf-8',
              timeout: 5000,
              stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            if (latest && latest !== pkg.version) {
              console.error(
                `[context-vault] Update available: v${pkg.version} → v${latest}. Run: context-vault update`
              );
            }
          } catch {}
        })
        .catch(() => {});
    }, 3000);
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
