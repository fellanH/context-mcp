import { z } from "zod";
import { ok } from "../helpers.js";

export const name = "clear_context";

export const description =
  "Reset active in-memory session context without deleting vault entries. Call this when switching projects or topics mid-session. With `scope`, all subsequent get_context calls should filter to that tag/project. Vault data is never modified.";

export const inputSchema = {
  scope: z
    .string()
    .optional()
    .describe(
      "Optional tag or project name to focus on going forward. When provided, treat subsequent get_context calls as if filtered to this tag.",
    ),
  save_session: z
    .boolean()
    .optional()
    .describe(
      "If true, save a session summary entry before clearing context. Useful for preserving continuity when switching projects.",
    ),
  preload_bucket: z
    .string()
    .optional()
    .describe(
      "Bucket name to preload context from after clearing. Entries from this bucket will be included in the response for immediate context.",
    ),
  max_tokens: z
    .number()
    .optional()
    .describe(
      "Token budget for preloaded context (default 2000). Only used when preload_bucket is set.",
    ),
};

/**
 * @param {object} args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} ctx
 * @param {import('../types.js').ToolShared} shared
 */
export async function handler(
  { scope, save_session, preload_bucket, max_tokens } = {},
  ctx,
  shared,
) {
  const lines = [
    "## Context Reset",
    "",
    "Active session context has been cleared. All previous context from this session should be disregarded.",
    "",
    "Vault entries are unchanged — no data was deleted.",
  ];

  // save_session: auto-save a session summary before switching context
  if (save_session && ctx?.db) {
    try {
      const { captureAndIndex } = await import("@context-vault/core/capture");
      await captureAndIndex(ctx, {
        kind: "session",
        title: `Context switch${scope ? ` to ${scope}` : ""}`,
        body: "Session insight auto-saved before context switch.",
        tags: ["context-switch", "auto-saved", scope].filter(Boolean),
        source: "clear_context",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      lines.push("", "_Session insight saved before scope switch._");
    } catch {
      // Don't block the reset if saving fails
      lines.push("", "_Warning: failed to save session before switch._");
    }
  }

  if (scope?.trim()) {
    const trimmed = scope.trim();
    lines.push(
      "",
      `### Active Scope: \`${trimmed}\``,
      "",
      `Going forward, treat \`get_context\` calls as scoped to the tag or project **"${trimmed}"** unless the user explicitly requests a different scope or passes their own tag filters.`,
    );
  } else {
    lines.push(
      "",
      "No scope set. Use `get_context` normally — all vault entries are accessible.",
    );
  }

  // preload_bucket: load context from a specific bucket into the response
  if (preload_bucket && ctx?.db) {
    try {
      if (shared?.ensureIndexed) await shared.ensureIndexed();
      const bucketTag = `bucket:${preload_bucket}`;
      const budget = max_tokens || 2000;

      const sinceDate = new Date(Date.now() - 7 * 86400000).toISOString();
      const rows = ctx.db
        .prepare(
          `SELECT * FROM vault
           WHERE created_at >= ?
             AND (expires_at IS NULL OR expires_at > datetime('now'))
             AND superseded_by IS NULL
           ORDER BY created_at DESC
           LIMIT 50`,
        )
        .all(sinceDate);

      const tagged = rows.filter((r) => {
        const tags = r.tags ? JSON.parse(r.tags) : [];
        return tags.includes(bucketTag);
      });

      if (tagged.length > 0) {
        lines.push("", `## Preloaded Context (bucket: ${preload_bucket})`, "");
        let tokensUsed = 0;
        for (const entry of tagged) {
          const body = (entry.body || "").slice(0, 400);
          const block = `- **${entry.title || "(untitled)"}** [${entry.kind}]: ${body.replace(/\n+/g, " ").trim()}`;
          const tokens = Math.ceil(block.length / 4);
          if (tokensUsed + tokens > budget) break;
          lines.push(block);
          tokensUsed += tokens;
        }
      } else {
        lines.push(
          "",
          `_No recent entries found in bucket "${preload_bucket}"._`,
        );
      }
    } catch {
      lines.push("", `_Warning: failed to preload bucket "${preload_bucket}"._`);
    }
  }

  const result = ok(lines.join("\n"));
  if (preload_bucket) {
    result._meta = {
      preloaded_bucket: preload_bucket,
      scope: scope?.trim() || null,
    };
  }
  return result;
}
