import { z } from "zod";
import { unlinkSync } from "node:fs";
import { ok, err } from "../helpers.js";

export const name = "delete_context";

export const description =
  "Delete an entry from your vault by its ULID id. Removes the file from disk and cleans up the search index.";

export const inputSchema = {
  id: z.string().describe("The entry ULID to delete"),
};

/**
 * @param {object} args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} ctx
 * @param {import('../types.js').ToolShared} shared
 */
export async function handler({ id }, ctx, { ensureIndexed }) {
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  if (!id?.trim())
    return err("Required: id (non-empty string)", "INVALID_INPUT");
  await ensureIndexed();

  const entry = ctx.stmts.getEntryById.get(id);
  if (!entry) return err(`Entry not found: ${id}`, "NOT_FOUND");

  // Ownership check: don't leak existence across users
  if (userId !== undefined && entry.user_id !== userId) {
    return err(`Entry not found: ${id}`, "NOT_FOUND");
  }

  // Delete file from disk first (source of truth)
  if (entry.file_path) {
    try {
      unlinkSync(entry.file_path);
    } catch {}
  }

  // Delete vector embedding
  const rowidResult = ctx.stmts.getRowid.get(id);
  if (rowidResult?.rowid) {
    try {
      ctx.deleteVec(Number(rowidResult.rowid));
    } catch {}
  }

  // Delete DB row (FTS trigger handles FTS cleanup)
  ctx.stmts.deleteEntry.run(id);

  return ok(`Deleted ${entry.kind}: ${entry.title || "(untitled)"} [${id}]`);
}
