import { z } from "zod";
import { ok } from "../helpers.js";

export const name = "list_buckets";

export const description =
  "List all registered bucket entities in the vault. Buckets are named scopes used to group entries via 'bucket:' prefixed tags. Returns each bucket's name, description, parent, and optional entry count.";

export const inputSchema = {
  include_counts: z
    .boolean()
    .optional()
    .describe(
      "Include count of entries tagged with each bucket (default true). Set false to skip the count queries for faster response.",
    ),
};

/**
 * @param {object} args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} ctx
 * @param {import('../types.js').ToolShared} shared
 */
export async function handler(
  { include_counts = true },
  ctx,
  { ensureIndexed, reindexFailed },
) {
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  await ensureIndexed();

  const userClause = userId !== undefined ? "AND user_id = ?" : "";
  const userParams = userId !== undefined ? [userId] : [];

  const buckets = ctx.db
    .prepare(
      `SELECT id, title, identity_key, body, tags, meta, created_at, updated_at
       FROM vault
       WHERE kind = 'bucket'
         AND (expires_at IS NULL OR expires_at > datetime('now'))
         AND superseded_by IS NULL
         ${userClause}
       ORDER BY title ASC`,
    )
    .all(...userParams);

  if (!buckets.length) {
    return ok(
      "No buckets registered.\n\nCreate one with `save_context(kind: \"bucket\", identity_key: \"bucket:myproject\", title: \"My Project\", body: \"...\")` to register a bucket.",
    );
  }

  const lines = [];
  if (reindexFailed) {
    lines.push(
      `> **Warning:** Auto-reindex failed. Results may be stale. Run \`context-vault reindex\` to fix.\n`,
    );
  }
  lines.push(`## Registered Buckets (${buckets.length})\n`);

  for (const b of buckets) {
    let meta = {};
    if (b.meta) {
      try {
        meta = typeof b.meta === "string" ? JSON.parse(b.meta) : b.meta;
      } catch {
        meta = {};
      }
    }

    const bucketTags = b.tags ? JSON.parse(b.tags) : [];
    const name = b.identity_key
      ? b.identity_key.replace(/^bucket:/, "")
      : b.title || b.id;
    const parent = meta.parent || null;

    let entryCount = null;
    if (include_counts && b.identity_key) {
      const countUserClause =
        userId !== undefined ? "AND user_id = ?" : "";
      const countParams = userId !== undefined ? [userId] : [];
      const row = ctx.db
        .prepare(
          `SELECT COUNT(*) as c FROM vault
           WHERE tags LIKE ?
             AND kind != 'bucket'
             AND (expires_at IS NULL OR expires_at > datetime('now'))
             AND superseded_by IS NULL
             ${countUserClause}`,
        )
        .get(`%"${b.identity_key}"%`, ...countParams);
      entryCount = row ? row.c : 0;
    }

    const titleDisplay = b.title || name;
    const headerParts = [`**${titleDisplay}**`];
    if (b.identity_key) headerParts.push(`\`${b.identity_key}\``);
    if (parent) headerParts.push(`parent: ${parent}`);
    if (entryCount !== null) headerParts.push(`${entryCount} entries`);
    lines.push(`- ${headerParts.join(" — ")}`);

    if (b.body) {
      const preview = b.body.replace(/\n+/g, " ").trim().slice(0, 120);
      lines.push(`  ${preview}${b.body.length > 120 ? "…" : ""}`);
    }
    if (bucketTags.length) {
      lines.push(`  tags: ${bucketTags.join(", ")}`);
    }
  }

  lines.push(
    "\n_Register a new bucket with `save_context(kind: \"bucket\", identity_key: \"bucket:<name>\", title: \"...\", body: \"...\")`_",
  );

  return ok(lines.join("\n"));
}
