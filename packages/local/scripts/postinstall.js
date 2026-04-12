#!/usr/bin/env node

/**
 * postinstall.js — Post-install setup for context-vault
 *
 * 1. Installs @huggingface/transformers with --ignore-scripts to avoid sharp's
 *    broken install lifecycle in global contexts.  Semantic search degrades
 *    gracefully if this step fails.
 * 2. Ensures data directory exists.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const NODE_MODULES = join(PKG_ROOT, 'node_modules');

async function main() {
  // ── 1. Install @huggingface/transformers (optional) ───────────────────
  // The transformers package depends on `sharp`, whose install script fails
  // in global npm contexts.  We install with --ignore-scripts to skip it —
  // context-vault only uses text embeddings, not image processing.
  // Check the package's own node_modules (not general import resolution,
  // which may find it in the workspace during `npm install -g ./tarball`).
  const transformersDir = join(NODE_MODULES, '@huggingface', 'transformers');
  if (!existsSync(transformersDir)) {
    console.log('[context-vault] Installing embedding support (@huggingface/transformers)...');
    try {
      execSync('npm install --no-save --ignore-scripts @huggingface/transformers@^3.0.0', {
        stdio: 'inherit',
        timeout: 120000,
        cwd: PKG_ROOT,
      });
      console.log('[context-vault] Embedding support installed.');
    } catch {
      console.error('[context-vault] Warning: could not install @huggingface/transformers.');
      console.error(
        '[context-vault] Semantic search will be unavailable; full-text search still works.'
      );
    }
  }

  // ── 2. Ensure data dir exists ────────────────────────────────────────
  const DATA_DIR = join(homedir(), '.context-mcp');
  mkdirSync(DATA_DIR, { recursive: true });

  // ── 3. Clean up legacy daemon if present ────────────────────────────
  // v3.16.1 removed the HTTP daemon. Clean up LaunchAgent and PID file
  // left by previous versions.
  if (process.platform === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.context-vault.daemon.plist');
    if (existsSync(plistPath)) {
      try { execSync('launchctl unload "' + plistPath + '" 2>/dev/null', { stdio: 'pipe' }); } catch {}
      try { unlinkSync(plistPath); } catch {}
      console.log('[context-vault] Removed legacy daemon LaunchAgent.');
    }
  }
  const pidPath = join(homedir(), '.context-mcp', 'daemon.pid');
  if (existsSync(pidPath)) {
    try {
      const { pid } = JSON.parse(readFileSync(pidPath, 'utf-8'));
      process.kill(pid, 'SIGTERM');
    } catch {}
    try { unlinkSync(pidPath); } catch {}
    console.log('[context-vault] Removed legacy daemon PID file.');
  }
  const daemonLog = join(homedir(), '.context-mcp', 'daemon.log');
  if (existsSync(daemonLog)) {
    try { unlinkSync(daemonLog); } catch {}
  }
}

main().catch(() => {});
