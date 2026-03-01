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
};

/**
 * @param {object} args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} _ctx
 */
export function handler({ scope } = {}) {
  const lines = [
    "## Context Reset",
    "",
    "Active session context has been cleared. All previous context from this session should be disregarded.",
    "",
    "Vault entries are unchanged — no data was deleted.",
  ];

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

  return ok(lines.join("\n"));
}
