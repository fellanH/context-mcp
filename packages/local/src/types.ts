import type { BaseCtx, VaultConfig } from '@context-vault/core/types';

export interface LocalCtx extends BaseCtx {
  activeOps: { count: number };
  toolStats: {
    ok: number;
    errors: number;
    lastError: { tool: string; code: string; timestamp: number } | null;
  };
}

export interface SharedCtx {
  ensureIndexed: (opts?: { blocking?: boolean }) => Promise<void>;
  reindexFailed?: boolean;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  code?: string;
  _meta?: Record<string, unknown>;
}

export interface ToolModule {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: LocalCtx, shared: SharedCtx) => Promise<ToolResult>;
}
