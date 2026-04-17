#!/usr/bin/env node
// Regression test for mcp-epipe-graceful-shutdown.
//
// Spawns the built server, completes the MCP handshake, then simulates a
// client disconnect by destroying the parent's read of child.stdout and
// closing child.stdin. Asserts:
//   (a) the child exits cleanly (code 0) within 3s
//   (b) vault.db-wal is 0 bytes (WAL was checkpointed)
//   (c) error.log has NO `write EPIPE` uncaughtException entry for this run

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = resolve(__dirname, '..', 'dist', 'server.js');
const EXIT_DEADLINE_MS = 3000;
const READY_TIMEOUT_MS = 10_000;
const RESPONSE_TIMEOUT_MS = 5000;

const tmpRoot = mkdtempSync(join(tmpdir(), 'cv-epipe-'));
const dataDir = join(tmpRoot, 'data');
const vaultDir = join(tmpRoot, 'vault');

let child = null;
let pass = false;
let failMsg = '';
let stdoutBuf = '';
let stderrBuf = '';

function cleanup() {
  if (child && child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch {}
  }
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout: ${label}`);
}

function extractJsonResponses(buffer) {
  const results = [];
  for (const line of buffer.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { results.push(JSON.parse(trimmed)); } catch {}
  }
  return results;
}

try {
  if (!existsSync(SERVER_JS)) {
    throw new Error(`server bundle missing: ${SERVER_JS} (run npm run build first)`);
  }

  child = spawn(process.execPath, [SERVER_JS], {
    env: {
      ...process.env,
      CONTEXT_VAULT_DATA_DIR: dataDir,
      CONTEXT_VAULT_VAULT_DIR: vaultDir,
      CONTEXT_VAULT_DIR: vaultDir,
      CONTEXT_VAULT_TELEMETRY: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString('utf-8'); });
  child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });

  const exitPromise = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });

  // Wait for the server to finish startup logs before sending JSON-RPC.
  await waitFor(() => /Database:/.test(stderrBuf), READY_TIMEOUT_MS, 'server startup');

  function send(msg) {
    child.stdin.write(JSON.stringify(msg) + '\n');
  }

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'epipe-validator', version: '1.0.0' },
    },
  });

  await waitFor(
    () => extractJsonResponses(stdoutBuf).some((r) => r.id === 1),
    RESPONSE_TIMEOUT_MS,
    'initialize response',
  );

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await waitFor(
    () => extractJsonResponses(stdoutBuf).some((r) => r.id === 2),
    RESPONSE_TIMEOUT_MS,
    'tools/list response',
  );

  // Simulate client disconnect: destroy the parent's read of child.stdout so
  // the next write from the server raises EPIPE, then send another request
  // to force the server to attempt a write.
  child.stdout.destroy();
  send({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  // Close stdin last so the server detects the full disconnect.
  try { child.stdin.end(); } catch {}

  const result = await Promise.race([
    exitPromise,
    new Promise((resolveTimeout) =>
      setTimeout(() => resolveTimeout({ code: null, signal: 'deadline' }), EXIT_DEADLINE_MS),
    ),
  ]);

  if (result.signal === 'deadline') {
    throw new Error(`server did not exit within ${EXIT_DEADLINE_MS}ms after disconnect`);
  }
  if (result.code !== 0) {
    throw new Error(`unclean exit: code=${result.code} signal=${result.signal}`);
  }

  const walPath = join(dataDir, 'vault.db-wal');
  if (existsSync(walPath)) {
    const size = statSync(walPath).size;
    if (size !== 0) {
      throw new Error(`WAL not checkpointed: ${walPath} is ${size} bytes`);
    }
  }

  const errorLogPath = join(dataDir, 'error.log');
  if (existsSync(errorLogPath)) {
    const content = readFileSync(errorLogPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try { entry = JSON.parse(trimmed); } catch { continue; }
      const isUncaught = entry.error_type === 'uncaughtException';
      const mentionsEpipe =
        typeof entry.message === 'string' && /\bEPIPE\b/i.test(entry.message);
      if (isUncaught && mentionsEpipe) {
        throw new Error(`error.log contains write EPIPE uncaughtException: ${trimmed}`);
      }
    }
  }

  pass = true;
  console.log('PASS: EPIPE graceful shutdown (exit 0, WAL checkpointed, no uncaught EPIPE)');
} catch (err) {
  failMsg = err && err.message ? err.message : String(err);
  console.error(`FAIL: ${failMsg}`);
  if (stderrBuf) {
    const tail = stderrBuf.split('\n').slice(-15).join('\n');
    if (tail.trim()) {
      console.error('--- server stderr tail ---');
      console.error(tail);
    }
  }
} finally {
  cleanup();
  process.exit(pass ? 0 : 1);
}
