import { z } from "zod";
import { captureAndIndex, updateEntryFile } from "../../capture/index.js";
import { indexEntry } from "../../index/index.js";
import { categoryFor } from "../../core/categories.js";
import { normalizeKind } from "../../core/files.js";
import { ok, err, ensureVaultExists, ensureValidKind } from "../helpers.js";
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_KIND_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_COUNT,
  MAX_META_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_IDENTITY_KEY_LENGTH,
} from "../../constants.js";

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

async function findSimilar(ctx, embedding, threshold, userId) {
  try {
    const vecCount = ctx.db
      .prepare("SELECT COUNT(*) as c FROM vault_vec")
      .get().c;
    if (vecCount === 0) return [];

    const vecRows = ctx.db
      .prepare(
        `SELECT v.rowid, v.distance FROM vault_vec v WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(embedding, 10);

    if (!vecRows.length) return [];

    const rowids = vecRows.map((vr) => vr.rowid);
    const placeholders = rowids.map(() => "?").join(",");
    const hydrated = ctx.db
      .prepare(
        `SELECT rowid, id, title, category, user_id FROM vault WHERE rowid IN (${placeholders})`,
      )
      .all(...rowids);

    const byRowid = new Map();
    for (const row of hydrated) byRowid.set(row.rowid, row);

    const results = [];
    for (const vr of vecRows) {
      const similarity = Math.max(0, 1 - vr.distance / 2);
      if (similarity < threshold) continue;
      const row = byRowid.get(vr.rowid);
      if (!row) continue;
      if (userId !== undefined && row.user_id !== userId) continue;
      if (row.category === "entity") continue;
      results.push({ id: row.id, title: row.title, score: similarity });
    }
    return results;
  } catch {
    return [];
  }
}

function formatSimilarWarning(similar) {
  const lines = ["", "⚠ Similar entries already exist:"];
  for (const e of similar) {
    const score = e.score.toFixed(2);
    const title = e.title ? `"${e.title}"` : "(no title)";
    lines.push(`  - ${title} (${score}) — id: ${e.id}`);
  }
  lines.push(
    "  Consider using `id: <existing>` in save_context to update instead.",
  );
  return lines.join("\n");
}

/**
 * Validate input fields for save_context. Returns an error response or null.
 */
function validateSaveInput({
  kind,
  title,
  body,
  tags,
  meta,
  source,
  identity_key,
  expires_at,
}) {
  if (kind !== undefined && kind !== null) {
    if (typeof kind !== "string" || kind.length > MAX_KIND_LENGTH) {
      return err(
        `kind must be a string, max ${MAX_KIND_LENGTH} chars`,
        "INVALID_INPUT",
      );
    }
  }
  if (body !== undefined && body !== null) {
    if (typeof body !== "string" || body.length > MAX_BODY_LENGTH) {
      return err(
        `body must be a string, max ${MAX_BODY_LENGTH / 1024}KB`,
        "INVALID_INPUT",
      );
    }
  }
  if (title !== undefined && title !== null) {
    if (typeof title !== "string" || title.length > MAX_TITLE_LENGTH) {
      return err(
        `title must be a string, max ${MAX_TITLE_LENGTH} chars`,
        "INVALID_INPUT",
      );
    }
  }
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags))
      return err("tags must be an array of strings", "INVALID_INPUT");
    if (tags.length > MAX_TAGS_COUNT)
      return err(`tags: max ${MAX_TAGS_COUNT} tags allowed`, "INVALID_INPUT");
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length > MAX_TAG_LENGTH) {
        return err(
          `each tag must be a string, max ${MAX_TAG_LENGTH} chars`,
          "INVALID_INPUT",
        );
      }
    }
  }
  if (meta !== undefined && meta !== null) {
    const metaStr = JSON.stringify(meta);
    if (metaStr.length > MAX_META_LENGTH) {
      return err(
        `meta must be under ${MAX_META_LENGTH / 1024}KB when serialized`,
        "INVALID_INPUT",
      );
    }
  }
  if (source !== undefined && source !== null) {
    if (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH) {
      return err(
        `source must be a string, max ${MAX_SOURCE_LENGTH} chars`,
        "INVALID_INPUT",
      );
    }
  }
  if (identity_key !== undefined && identity_key !== null) {
    if (
      typeof identity_key !== "string" ||
      identity_key.length > MAX_IDENTITY_KEY_LENGTH
    ) {
      return err(
        `identity_key must be a string, max ${MAX_IDENTITY_KEY_LENGTH} chars`,
        "INVALID_INPUT",
      );
    }
  }
  if (expires_at !== undefined && expires_at !== null) {
    if (
      typeof expires_at !== "string" ||
      isNaN(new Date(expires_at).getTime())
    ) {
      return err("expires_at must be a valid ISO date string", "INVALID_INPUT");
    }
  }
  return null;
}

export const name = "save_context";

export const description =
  "Save knowledge to your vault. Creates a .md file and indexes it for search. Use for any kind of context: insights, decisions, patterns, references, or any custom kind. To update an existing entry, pass its `id` — omitted fields are preserved.";

export const inputSchema = {
  id: z
    .string()
    .optional()
    .describe(
      "Entry ULID to update. When provided, updates the existing entry instead of creating new. Omitted fields are preserved.",
    ),
  kind: z
    .string()
    .optional()
    .describe(
      "Entry kind — determines folder (e.g. 'insight', 'decision', 'pattern', 'reference', or any custom kind). Required for new entries.",
    ),
  title: z.string().optional().describe("Entry title (optional for insights)"),
  body: z
    .string()
    .optional()
    .describe("Main content. Required for new entries."),
  tags: z
    .array(z.string())
    .optional()
    .describe("Tags for categorization and search"),
  meta: z
    .any()
    .optional()
    .describe(
      "Additional structured metadata (JSON object, e.g. { language: 'js', status: 'accepted' })",
    ),
  folder: z
    .string()
    .optional()
    .describe("Subfolder within the kind directory (e.g. 'react/hooks')"),
  source: z.string().optional().describe("Where this knowledge came from"),
  identity_key: z
    .string()
    .optional()
    .describe(
      "Required for entity kinds (contact, project, tool, source). The unique identifier for this entity.",
    ),
  expires_at: z.string().optional().describe("ISO date for TTL expiry"),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "If true, check for similar entries without saving. Returns similarity results without creating a new entry. Only applies to knowledge and event categories.",
    ),
  similarity_threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Cosine similarity threshold for duplicate detection (0–1, default 0.85). Entries above this score are flagged as similar. Only applies to knowledge and event categories.",
    ),
};

/**
 * @param {object} args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} ctx
 * @param {import('../types.js').ToolShared} shared
 */
export async function handler(
  {
    id,
    kind,
    title,
    body,
    tags,
    meta,
    folder,
    source,
    identity_key,
    expires_at,
    dry_run,
    similarity_threshold,
  },
  ctx,
  { ensureIndexed },
) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  const inputErr = validateSaveInput({
    kind,
    title,
    body,
    tags,
    meta,
    source,
    identity_key,
    expires_at,
  });
  if (inputErr) return inputErr;

  // ── Update mode ──
  if (id) {
    await ensureIndexed();

    const existing = ctx.stmts.getEntryById.get(id);
    if (!existing) return err(`Entry not found: ${id}`, "NOT_FOUND");

    // Ownership check: don't leak existence across users
    if (userId !== undefined && existing.user_id !== userId) {
      return err(`Entry not found: ${id}`, "NOT_FOUND");
    }

    if (kind && normalizeKind(kind) !== existing.kind) {
      return err(
        `Cannot change kind (current: "${existing.kind}"). Delete and re-create instead.`,
        "INVALID_UPDATE",
      );
    }
    if (identity_key && identity_key !== existing.identity_key) {
      return err(
        `Cannot change identity_key (current: "${existing.identity_key}"). Delete and re-create instead.`,
        "INVALID_UPDATE",
      );
    }

    // Decrypt existing entry before merge if encrypted
    if (ctx.decrypt && existing.body_encrypted) {
      const decrypted = await ctx.decrypt(existing);
      existing.body = decrypted.body;
      if (decrypted.title) existing.title = decrypted.title;
      if (decrypted.meta) existing.meta = JSON.stringify(decrypted.meta);
    }

    const entry = updateEntryFile(ctx, existing, {
      title,
      body,
      tags,
      meta,
      source,
      expires_at,
    });
    await indexEntry(ctx, entry);
    const relPath = entry.filePath
      ? entry.filePath.replace(config.vaultDir + "/", "")
      : entry.filePath;
    const parts = [`✓ Updated ${entry.kind} → ${relPath}`, `  id: ${entry.id}`];
    if (entry.title) parts.push(`  title: ${entry.title}`);
    const entryTags = entry.tags || [];
    if (entryTags.length) parts.push(`  tags: ${entryTags.join(", ")}`);
    parts.push("", "_Search with get_context to verify changes._");
    return ok(parts.join("\n"));
  }

  // ── Create mode ──
  if (!kind) return err("Required: kind (for new entries)", "INVALID_INPUT");
  const kindErr = ensureValidKind(kind);
  if (kindErr) return kindErr;
  if (!body?.trim())
    return err("Required: body (for new entries)", "INVALID_INPUT");

  // Normalize kind to canonical singular form (e.g. "insights" → "insight")
  const normalizedKind = normalizeKind(kind);

  if (categoryFor(normalizedKind) === "entity" && !identity_key) {
    return err(
      `Entity kind "${normalizedKind}" requires identity_key`,
      "MISSING_IDENTITY_KEY",
    );
  }

  await ensureIndexed();

  // ── Similarity check (knowledge + event only) ────────────────────────────
  const category = categoryFor(normalizedKind);
  let similarEntries = [];

  if (category === "knowledge" || category === "event") {
    const threshold = similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const embeddingText = [title, body].filter(Boolean).join(" ");
    const queryEmbedding = await ctx.embed(embeddingText);
    if (queryEmbedding) {
      similarEntries = await findSimilar(
        ctx,
        queryEmbedding,
        threshold,
        userId,
      );
    }
  }

  if (dry_run) {
    const parts = ["(dry run — nothing saved)"];
    if (similarEntries.length) {
      parts.push("", "⚠ Similar entries already exist:");
      for (const e of similarEntries) {
        const score = e.score.toFixed(2);
        const titleDisplay = e.title ? `"${e.title}"` : "(no title)";
        parts.push(`  - ${titleDisplay} (${score}) — id: ${e.id}`);
      }
      parts.push(
        "",
        "Use save_context with `id: <existing>` to update one, or omit `dry_run` to save as new.",
      );
    } else {
      parts.push("", "No similar entries found. Safe to save.");
    }
    return ok(parts.join("\n"));
  }

  const mergedMeta = { ...(meta || {}) };
  if (folder) mergedMeta.folder = folder;
  const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

  const entry = await captureAndIndex(ctx, {
    kind: normalizedKind,
    title,
    body,
    meta: finalMeta,
    tags,
    source,
    folder,
    identity_key,
    expires_at,
    userId,
  });
  const relPath = entry.filePath
    ? entry.filePath.replace(config.vaultDir + "/", "")
    : entry.filePath;
  const parts = [`✓ Saved ${normalizedKind} → ${relPath}`, `  id: ${entry.id}`];
  if (title) parts.push(`  title: ${title}`);
  if (tags?.length) parts.push(`  tags: ${tags.join(", ")}`);
  parts.push("", "_Use this id to update or delete later._");
  if (similarEntries.length) {
    parts.push(formatSimilarWarning(similarEntries));
  }
  return ok(parts.join("\n"));
}
