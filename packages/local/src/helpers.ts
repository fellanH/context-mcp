import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VaultConfig } from '@context-vault/core/types';
import type { ToolResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

export function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function err(
  text: string,
  code = 'UNKNOWN',
  meta: Record<string, unknown> = {}
): ToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
    code,
    _meta: {
      cv_version: pkg.version,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      ...meta,
    },
  };
}

export function errWithHint(text: string, code: string, hint?: string): ToolResult {
  const prompt = hint
    ? `\n\n**Debug with AI:** Paste this into Claude Code or your AI assistant:\n> "${hint}"`
    : '';
  return err(text + prompt, code);
}

export function ensureVaultExists(config: VaultConfig): ToolResult | null {
  if (!config.vaultDirExists) {
    return errWithHint(
      `Vault directory not found: ${config.vaultDir}. Run context-status for diagnostics.`,
      'VAULT_NOT_FOUND',
      "My context-vault can't find the vault directory. Run `context-vault doctor` and help me fix it."
    );
  }
  return null;
}

export function ensureValidKind(kind: string): ToolResult | null {
  if (!/^[a-z][a-z0-9_-]*$/.test(kind)) {
    return err(
      "Required: kind (lowercase alphanumeric, e.g. 'insight', 'reference')",
      'INVALID_KIND'
    );
  }
  return null;
}

const KIND_ICONS: Record<string, string> = {
  insight: '◆',
  decision: '◇',
  pattern: '◈',
  reference: '▸',
  event: '○',
  session: '◎',
  brief: '▪',
  bucket: '▫',
  contact: '●',
  project: '■',
  tool: '▹',
  source: '►',
  feedback: '◉',
};

export function kindIcon(kind: string): string {
  return KIND_ICONS[kind] || '·';
}

export function fmtDate(date: string | null | undefined): string {
  if (!date) return '';
  return date.split('T')[0];
}

export { pkg };
