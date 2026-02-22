import { reindex } from "../index/index.js";
import { captureAndIndex } from "../capture/index.js";
import { err } from "./helpers.js";
import pkg from "../../package.json" with { type: "json" };

import * as getContext from "./tools/get-context.js";
import * as saveContext from "./tools/save-context.js";
import * as listContext from "./tools/list-context.js";
import * as deleteContext from "./tools/delete-context.js";
import * as submitFeedback from "./tools/submit-feedback.js";
import * as ingestUrl from "./tools/ingest-url.js";
import * as contextStatus from "./tools/context-status.js";

const toolModules = [
  getContext,
  saveContext,
  listContext,
  deleteContext,
  submitFeedback,
  ingestUrl,
  contextStatus,
];

const TOOL_TIMEOUT_MS = 60_000;

export function registerTools(server, ctx) {
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  function tracked(handler, toolName) {
    return async (...args) => {
      if (ctx.activeOps) ctx.activeOps.count++;
      let timer;
      let handlerPromise;
      try {
        handlerPromise = Promise.resolve(handler(...args));
        const result = await Promise.race([
          handlerPromise,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("TOOL_TIMEOUT")),
              TOOL_TIMEOUT_MS,
            );
          }),
        ]);
        if (ctx.toolStats) ctx.toolStats.ok++;
        return result;
      } catch (e) {
        if (e.message === "TOOL_TIMEOUT") {
          // Suppress any late rejection from the still-running handler to
          // prevent unhandled promise rejection warnings in the host process.
          handlerPromise?.catch(() => {});
          if (ctx.toolStats) {
            ctx.toolStats.errors++;
            ctx.toolStats.lastError = {
              tool: toolName,
              code: "TIMEOUT",
              timestamp: Date.now(),
            };
          }
          return err(
            "Tool timed out after 60s. Try a simpler query or run `context-vault reindex` first.",
            "TIMEOUT",
          );
        }
        if (ctx.toolStats) {
          ctx.toolStats.errors++;
          ctx.toolStats.lastError = {
            tool: toolName,
            code: "UNKNOWN",
            timestamp: Date.now(),
          };
        }
        try {
          await captureAndIndex(ctx, {
            kind: "feedback",
            title: `Unhandled error in ${toolName ?? "tool"} call`,
            body: `${e.message}\n\n${e.stack ?? ""}`,
            tags: ["bug", "auto-captured"],
            source: "auto-capture",
            meta: {
              tool: toolName,
              error_type: e.constructor?.name,
              cv_version: pkg.version,
              auto: true,
            },
          });
        } catch {} // never block on feedback capture
        throw e;
      } finally {
        clearTimeout(timer);
        if (ctx.activeOps) ctx.activeOps.count--;
      }
    };
  }

  // In hosted mode, skip reindex — DB is always in sync via writeEntry→indexEntry
  let reindexDone = userId !== undefined ? true : false;
  let reindexPromise = null;
  let reindexAttempts = 0;
  let reindexFailed = false;
  const MAX_REINDEX_ATTEMPTS = 2;

  async function ensureIndexed() {
    if (reindexDone) return;
    if (reindexPromise) return reindexPromise;
    // Assign promise synchronously to prevent concurrent calls from both entering reindex()
    const promise = reindex(ctx, { fullSync: true })
      .then((stats) => {
        reindexDone = true;
        const total = stats.added + stats.updated + stats.removed;
        if (total > 0) {
          console.error(
            `[context-vault] Auto-reindex: +${stats.added} ~${stats.updated} -${stats.removed} (${stats.unchanged} unchanged)`,
          );
        }
      })
      .catch((e) => {
        reindexAttempts++;
        console.error(
          `[context-vault] Auto-reindex failed (attempt ${reindexAttempts}/${MAX_REINDEX_ATTEMPTS}): ${e.message}`,
        );
        if (reindexAttempts >= MAX_REINDEX_ATTEMPTS) {
          console.error(
            `[context-vault] Giving up on auto-reindex. Run \`context-vault reindex\` manually to diagnose.`,
          );
          reindexDone = true;
          reindexFailed = true;
        } else {
          reindexPromise = null; // Allow retry on next tool call
        }
      });
    reindexPromise = promise;
    return reindexPromise;
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
      tracked((args) => mod.handler(args, ctx, shared), mod.name),
    );
  }
}
