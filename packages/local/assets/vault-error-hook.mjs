#!/usr/bin/env node
/**
 * Context Vault — PostToolUse hook for Bash error recall.
 *
 * Fires after every Bash tool use. If the result indicates an error
 * (non-zero exit code or stderr content), extracts the error text and
 * calls `context-vault recall` to surface entries about similar errors.
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

// ── Check for error signals ─────────────────────────────────────────────────

const toolResponse = input.tool_response ?? input.tool_output ?? '';
const output = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);

// Detect error: exit code, stderr markers, common error patterns
const hasExitCode = /exit code[:\s]+[1-9]\d*/i.test(output) ||
                    /exited with\s+[1-9]/i.test(output) ||
                    /returned?\s+(?:non-zero|[1-9]\d*)/i.test(output);
const hasErrorPattern = /(?:^|\n)\s*(?:error|Error|ERROR|FATAL|fatal|panic|Traceback|SyntaxError|TypeError|ReferenceError|ENOENT|EACCES|ECONNREFUSED|MODULE_NOT_FOUND|Cannot find module)/m.test(output);

if (!hasExitCode && !hasErrorPattern) {
  process.exit(0);
}

// ── Extract error text (first meaningful error lines, max 500 chars) ────────

function extractErrorSignal(text) {
  const lines = text.split('\n');
  const errorLines = [];
  let capturing = false;

  for (const line of lines) {
    if (/(?:error|Error|ERROR|FATAL|fatal|panic|Traceback|ENOENT|EACCES|ECONNREFUSED)/i.test(line)) {
      capturing = true;
    }
    if (capturing) {
      errorLines.push(line.trim());
      if (errorLines.length >= 5) break;
    }
  }

  if (errorLines.length === 0) {
    // Fall back to last 5 non-empty lines
    const nonEmpty = lines.filter((l) => l.trim()).slice(-5);
    return nonEmpty.join('\n').slice(0, 500);
  }

  return errorLines.join('\n').slice(0, 500);
}

const errorSignal = extractErrorSignal(output);
if (!errorSignal || errorSignal.length < 10) {
  process.exit(0);
}

// ── Detect project bucket from cwd ──────────────────────────────────────────

const cwd = input.cwd || process.cwd();

function detectBucket(dir) {
  try {
    const yamlPath = join(dir, 'workspace.yaml');
    if (existsSync(yamlPath)) {
      const yaml = readFileSync(yamlPath, 'utf-8');
      const match = yaml.match(/vault_bucket:\s*(\S+)/);
      if (match) return match[1];
    }
  } catch {}
  return basename(dir);
}

const bucket = detectBucket(cwd);

// ── Call context-vault recall ────────────────────────────────────────────────

try {
  const payload = JSON.stringify({ prompt: errorSignal, bucket });
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
