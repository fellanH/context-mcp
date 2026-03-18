import { reindex } from '@context-vault/core/index';
import { captureAndIndex } from '@context-vault/core/capture';
import { err } from './helpers.js';
import { sendTelemetryEvent } from './telemetry.js';
import type { LocalCtx, SharedCtx, ToolResult } from './types.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

import * as getContext from './tools/get-context.js';
import * as saveContext from './tools/save-context.js';
import * as listContext from './tools/list-context.js';
import * as deleteContext from './tools/delete-context.js';
import * as ingestUrl from './tools/ingest-url.js';
import * as contextStatus from './tools/context-status.js';
import * as clearContext from './tools/clear-context.js';
import * as createSnapshot from './tools/create-snapshot.js';
import * as sessionStart from './tools/session-start.js';
import * as listBuckets from './tools/list-buckets.js';
import * as ingestProject from './tools/ingest-project.js';

const toolModules = [
  getContext,
  saveContext,
  listContext,
  deleteContext,
  ingestUrl,
  ingestProject,
  contextStatus,
  clearContext,
  createSnapshot,
  sessionStart,
  listBuckets,
];

const TOOL_TIMEOUT_MS = 120_000;

// Reindex state hoisted to module scope so that in HTTP daemon mode
// (where registerTools is called once per session), the reindex only
// runs once for the entire process rather than once per connecting session.
let reindexDone = false;
let reindexPromise: Promise<void> | null = null;
let reindexAttempts = 0;
let reindexFailed = false;
const MAX_REINDEX_ATTEMPTS = 2;

export function registerTools(server: any, ctx: LocalCtx): void {
  function tracked(
    handler: (...args: any[]) => Promise<ToolResult>,
    toolName: string
  ): (...args: any[]) => Promise<ToolResult> {
    return async (...args: any[]): Promise<ToolResult> => {
      if (ctx.activeOps) ctx.activeOps.count++;
      let timer;
      let handlerPromise;
      try {
        handlerPromise = Promise.resolve(handler(...args));
        const result = await Promise.race([
          handlerPromise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('TOOL_TIMEOUT')), TOOL_TIMEOUT_MS);
          }),
        ]);
        if (ctx.toolStats) ctx.toolStats.ok++;
        return result as ToolResult;
      } catch (rawErr) {
        const e = rawErr as Error;
        if (e.message === 'TOOL_TIMEOUT') {
          handlerPromise?.catch(() => {});
          if (ctx.toolStats) {
            ctx.toolStats.errors++;
            ctx.toolStats.lastError = {
              tool: toolName,
              code: 'TIMEOUT',
              timestamp: Date.now(),
            };
          }
          sendTelemetryEvent(ctx.config, {
            event: 'tool_error',
            code: 'TIMEOUT',
            tool: toolName,
            cv_version: pkg.version,
          });
          return err(
            'Tool timed out after 120s. Try a simpler query or run `context-vault reindex` first.',
            'TIMEOUT'
          );
        }
        if (ctx.toolStats) {
          ctx.toolStats.errors++;
          ctx.toolStats.lastError = {
            tool: toolName,
            code: 'UNKNOWN',
            timestamp: Date.now(),
          };
        }
        sendTelemetryEvent(ctx.config, {
          event: 'tool_error',
          code: 'UNKNOWN',
          tool: toolName,
          cv_version: pkg.version,
        });
        try {
          await captureAndIndex(ctx, {
            kind: 'feedback',
            title: `Unhandled error in ${toolName ?? 'tool'} call`,
            body: `${e.message}\n\n${(e as any).stack ?? ''}`,
            tags: ['bug', 'auto-captured'],
            source: 'auto-capture',
            meta: {
              tool: toolName,
              error_type: (e as any).constructor?.name,
              cv_version: pkg.version,
              auto: true,
            },
          }, null /* skip embedding to avoid CPU cascade on repeated errors */);
        } catch {}
        return err(e.message, 'INTERNAL_ERROR');
      } finally {
        clearTimeout(timer);
        if (ctx.activeOps) ctx.activeOps.count--;
      }
    };
  }

  async function ensureIndexed({ blocking = true }: { blocking?: boolean } = {}): Promise<void> {
    if (reindexDone) return;
    if (reindexPromise) {
      if (blocking) return reindexPromise;
      return; // non-blocking: just ensure it's started
    }
    const promise = reindex(ctx, { fullSync: true })
      .then((stats) => {
        reindexDone = true;
        const total = stats.added + stats.updated + stats.removed;
        if (total > 0) {
          console.error(
            `[context-vault] Auto-reindex: +${stats.added} ~${stats.updated} -${stats.removed} (${stats.unchanged} unchanged)`
          );
        }
      })
      .catch((e: Error) => {
        reindexAttempts++;
        console.error(
          `[context-vault] Auto-reindex failed (attempt ${reindexAttempts}/${MAX_REINDEX_ATTEMPTS}): ${e.message}`
        );
        if (reindexAttempts >= MAX_REINDEX_ATTEMPTS) {
          console.error(
            `[context-vault] Giving up on auto-reindex. Run \`context-vault reindex\` manually to diagnose.`
          );
          reindexDone = true;
          reindexFailed = true;
        } else {
          reindexPromise = null;
        }
      });
    reindexPromise = promise;
    if (blocking) return reindexPromise;
  }

  const shared = {
    ensureIndexed,
    get reindexFailed() {
      return reindexFailed;
    },
  };

  for (const mod of toolModules) {
    server.tool(
      mod.name,
      mod.description,
      mod.inputSchema,
      tracked(
        ((args: Record<string, unknown>) => mod.handler(args, ctx, shared)) as (
          ...args: any[]
        ) => Promise<ToolResult>,
        mod.name
      )
    );
  }

  ensureIndexed().catch(() => {});
}
