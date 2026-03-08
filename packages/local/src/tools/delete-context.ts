import { z } from 'zod';
import { unlinkSync } from 'node:fs';
import { ok, err } from '../helpers.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

export const name = 'delete_context';

export const description =
  'Delete an entry from your vault by its ULID id. Removes the file from disk and cleans up the search index.';

export const inputSchema = {
  id: z.string().describe('The entry ULID to delete'),
};

export async function handler(
  { id }: Record<string, any>,
  ctx: LocalCtx,
  { ensureIndexed }: SharedCtx
): Promise<ToolResult> {
  if (!id?.trim()) return err('Required: id (non-empty string)', 'INVALID_INPUT');
  await ensureIndexed();

  const entry = ctx.stmts.getEntryById.get(id);
  if (!entry) return err(`Entry not found: ${id}`, 'NOT_FOUND');

  try {
    // Delete DB record first — if this fails, the file stays and no orphan is created
    const rowidResult = ctx.stmts.getRowid.get(id);
    if (rowidResult?.rowid) {
      try {
        ctx.deleteVec(Number(rowidResult.rowid));
      } catch {}
    }
    ctx.stmts.deleteEntry.run(id);

    // Delete file from disk after successful DB delete
    let fileWarning = null;
    if (entry.file_path) {
      try {
        unlinkSync(entry.file_path as string);
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          fileWarning = `file could not be removed from disk (${e.code}): ${entry.file_path}`;
        }
      }
    }

    const msg = `Deleted ${entry.kind}: ${entry.title || '(untitled)'} [${id}]`;
    return ok(fileWarning ? `${msg}\nWarning: ${fileWarning}` : msg);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 'DELETE_FAILED');
  }
}
