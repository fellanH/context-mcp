#!/usr/bin/env node
/**
 * Context Vault — UserPromptSubmit hook for proactive recall.
 *
 * Reads the Claude Code hook payload from stdin, extracts the user prompt,
 * calls `context-vault recall` to surface relevant vault entries, and
 * outputs hints for injection into the conversation context.
 *
 * Designed for <200ms total execution. Fails silently on any error.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// ── Parse stdin (hook payload) ──────────────────────────────────────────────

let input;
try {
  input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
} catch {
  process.exit(0);
}

const prompt = (input.prompt ?? '').trim();
if (!prompt || prompt.startsWith('/') || prompt.length < 10) {
  process.exit(0);
}

// ── Detect project bucket from cwd ──────────────────────────────────────────

const cwd = input.cwd || process.cwd();

function detectBucket(dir) {
  // Check for workspace.yaml with vault_bucket
  try {
    const yamlPath = join(dir, 'workspace.yaml');
    if (existsSync(yamlPath)) {
      const yaml = readFileSync(yamlPath, 'utf-8');
      const match = yaml.match(/vault_bucket:\s*(\S+)/);
      if (match) return match[1];
    }
  } catch {}
  // Fall back to directory name
  return basename(dir);
}

const bucket = detectBucket(cwd);

// ── Call context-vault recall ────────────────────────────────────────────────

try {
  const payload = JSON.stringify({ prompt, bucket });
  const result = execSync('context-vault recall', {
    input: payload,
    encoding: 'utf-8',
    timeout: 3000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '--no-warnings=ExperimentalWarning' },
  });

  if (result && result.trim()) {
    process.stdout.write(result);
  }
} catch {
  // Silent failure: never block Claude Code
}
