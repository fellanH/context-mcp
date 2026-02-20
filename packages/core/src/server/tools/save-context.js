import { z } from "zod";
import { captureAndIndex, updateEntryFile } from "../../capture/index.js";
import { indexEntry } from "../../index/index.js";
import { categoryFor } from "../../core/categories.js";
import { normalizeKind } from "../../core/files.js";
import { ok, err, ensureVaultExists, ensureValidKind } from "../helpers.js";

// ─── Input size limits (mirrors hosted validation) ────────────────────────────
const MAX_BODY_LENGTH = 100 * 1024; // 100KB
const MAX_TITLE_LENGTH = 500;
const MAX_KIND_LENGTH = 64;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const MAX_META_LENGTH = 10 * 1024; // 10KB
const MAX_SOURCE_LENGTH = 200;
const MAX_IDENTITY_KEY_LENGTH = 200;

/**
 * Validate input fields for save_context. Returns an error response or null.
 */
function validateSaveInput({ kind, title, body, tags, meta, source, identity_key }) {
  if (kind !== undefined && kind !== null) {
    if (typeof kind !== "string" || kind.length > MAX_KIND_LENGTH) {
      return err(`kind must be a string, max ${MAX_KIND_LENGTH} chars`, "INVALID_INPUT");
    }
  }
  if (body !== undefined && body !== null) {
    if (typeof body !== "string" || body.length > MAX_BODY_LENGTH) {
      return err(`body must be a string, max ${MAX_BODY_LENGTH / 1024}KB`, "INVALID_INPUT");
    }
  }
  if (title !== undefined && title !== null) {
    if (typeof title !== "string" || title.length > MAX_TITLE_LENGTH) {
      return err(`title must be a string, max ${MAX_TITLE_LENGTH} chars`, "INVALID_INPUT");
    }
  }
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) return err("tags must be an array of strings", "INVALID_INPUT");
    if (tags.length > MAX_TAGS_COUNT) return err(`tags: max ${MAX_TAGS_COUNT} tags allowed`, "INVALID_INPUT");
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length > MAX_TAG_LENGTH) {
        return err(`each tag must be a string, max ${MAX_TAG_LENGTH} chars`, "INVALID_INPUT");
      }
    }
  }
  if (meta !== undefined && meta !== null) {
    const metaStr = JSON.stringify(meta);
    if (metaStr.length > MAX_META_LENGTH) {
      return err(`meta must be under ${MAX_META_LENGTH / 1024}KB when serialized`, "INVALID_INPUT");
    }
  }
  if (source !== undefined && source !== null) {
    if (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH) {
      return err(`source must be a string, max ${MAX_SOURCE_LENGTH} chars`, "INVALID_INPUT");
    }
  }
  if (identity_key !== undefined && identity_key !== null) {
    if (typeof identity_key !== "string" || identity_key.length > MAX_IDENTITY_KEY_LENGTH) {
      return err(`identity_key must be a string, max ${MAX_IDENTITY_KEY_LENGTH} chars`, "INVALID_INPUT");
    }
  }
  return null;
}

export const name = "save_context";

export const description =
  "Save knowledge to your vault. Creates a .md file and indexes it for search. Use for any kind of context: insights, decisions, patterns, references, or any custom kind. To update an existing entry, pass its `id` — omitted fields are preserved.";

export const inputSchema = {
  id: z.string().optional().describe("Entry ULID to update. When provided, updates the existing entry instead of creating new. Omitted fields are preserved."),
  kind: z.string().optional().describe("Entry kind — determines folder (e.g. 'insight', 'decision', 'pattern', 'reference', or any custom kind). Required for new entries."),
  title: z.string().optional().describe("Entry title (optional for insights)"),
  body: z.string().optional().describe("Main content. Required for new entries."),
  tags: z.array(z.string()).optional().describe("Tags for categorization and search"),
  meta: z.any().optional().describe("Additional structured metadata (JSON object, e.g. { language: 'js', status: 'accepted' })"),
  folder: z.string().optional().describe("Subfolder within the kind directory (e.g. 'react/hooks')"),
  source: z.string().optional().describe("Where this knowledge came from"),
  identity_key: z.string().optional().describe("Required for entity kinds (contact, project, tool, source). The unique identifier for this entity."),
  expires_at: z.string().optional().describe("ISO date for TTL expiry"),
};

export async function handler({ id, kind, title, body, tags, meta, folder, source, identity_key, expires_at }, ctx, { ensureIndexed }) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  const inputErr = validateSaveInput({ kind, title, body, tags, meta, source, identity_key });
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
      return err(`Cannot change kind (current: "${existing.kind}"). Delete and re-create instead.`, "INVALID_UPDATE");
    }
    if (identity_key && identity_key !== existing.identity_key) {
      return err(`Cannot change identity_key (current: "${existing.identity_key}"). Delete and re-create instead.`, "INVALID_UPDATE");
    }

    // Decrypt existing entry before merge if encrypted
    if (ctx.decrypt && existing.body_encrypted) {
      const decrypted = await ctx.decrypt(existing);
      existing.body = decrypted.body;
      if (decrypted.title) existing.title = decrypted.title;
      if (decrypted.meta) existing.meta = JSON.stringify(decrypted.meta);
    }

    const entry = updateEntryFile(ctx, existing, { title, body, tags, meta, source, expires_at });
    await indexEntry(ctx, entry);
    const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
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
  if (!body?.trim()) return err("Required: body (for new entries)", "INVALID_INPUT");

  // Normalize kind to canonical singular form (e.g. "insights" → "insight")
  const normalizedKind = normalizeKind(kind);

  if (categoryFor(normalizedKind) === "entity" && !identity_key) {
    return err(`Entity kind "${normalizedKind}" requires identity_key`, "MISSING_IDENTITY_KEY");
  }

  // Hosted tier limit enforcement (skipped in local mode — no checkLimits on ctx)
  if (ctx.checkLimits) {
    const usage = ctx.checkLimits();
    if (usage.entryCount >= usage.maxEntries) {
      return err(`Entry limit reached (${usage.maxEntries}). Upgrade to Pro for unlimited entries.`, "LIMIT_EXCEEDED");
    }
    if (usage.storageMb >= usage.maxStorageMb) {
      return err(`Storage limit reached (${usage.maxStorageMb} MB). Upgrade to Pro for more storage.`, "LIMIT_EXCEEDED");
    }
  }

  await ensureIndexed();

  const mergedMeta = { ...(meta || {}) };
  if (folder) mergedMeta.folder = folder;
  const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

  const entry = await captureAndIndex(ctx, { kind: normalizedKind, title, body, meta: finalMeta, tags, source, folder, identity_key, expires_at, userId }, indexEntry);
  const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
  const parts = [`✓ Saved ${normalizedKind} → ${relPath}`, `  id: ${entry.id}`];
  if (title) parts.push(`  title: ${title}`);
  if (tags?.length) parts.push(`  tags: ${tags.join(", ")}`);
  parts.push("", "_Use this id to update or delete later._");
  return ok(parts.join("\n"));
}
