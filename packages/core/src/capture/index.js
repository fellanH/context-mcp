/**
 * Capture Layer — Public API
 *
 * Writes knowledge entries to vault as .md files and indexes them.
 * captureAndIndex() is the write-through entry point (capture + index + rollback on failure).
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ulid, slugify, kindToPath } from "../core/files.js";
import { categoryFor } from "../core/categories.js";
import { parseFrontmatter, formatFrontmatter } from "../core/frontmatter.js";
import { formatBody } from "./formatters.js";
import { writeEntryFile } from "./file-ops.js";
import { indexEntry } from "../index/index.js";

export function writeEntry(
  ctx,
  {
    kind,
    title,
    body,
    meta,
    tags,
    source,
    folder,
    identity_key,
    expires_at,
    supersedes,
    source_files,
    userId,
  },
) {
  if (!kind || typeof kind !== "string") {
    throw new Error("writeEntry: kind is required (non-empty string)");
  }
  if (!body || typeof body !== "string" || !body.trim()) {
    throw new Error("writeEntry: body is required (non-empty string)");
  }
  if (tags != null && !Array.isArray(tags)) {
    throw new Error("writeEntry: tags must be an array if provided");
  }
  if (meta != null && typeof meta !== "object") {
    throw new Error("writeEntry: meta must be an object if provided");
  }

  const category = categoryFor(kind);

  // Entity upsert: check for existing file at deterministic path
  let id;
  let createdAt;
  let updatedAt;
  if (category === "entity" && identity_key) {
    const identitySlug = slugify(identity_key);
    const dir = resolve(ctx.config.vaultDir, kindToPath(kind));
    const existingPath = resolve(dir, `${identitySlug}.md`);

    if (existsSync(existingPath)) {
      // Preserve original ID and created timestamp from existing file
      const raw = readFileSync(existingPath, "utf-8");
      const { meta: fmMeta } = parseFrontmatter(raw);
      id = fmMeta.id || ulid();
      createdAt = fmMeta.created || new Date().toISOString();
      updatedAt = new Date().toISOString();
    } else {
      id = ulid();
      createdAt = new Date().toISOString();
      updatedAt = createdAt;
    }
  } else {
    id = ulid();
    createdAt = new Date().toISOString();
    updatedAt = createdAt;
  }

  const filePath = writeEntryFile(ctx.config.vaultDir, kind, {
    id,
    title,
    body,
    meta,
    tags,
    source,
    createdAt,
    updatedAt,
    folder,
    category,
    identity_key,
    expires_at,
    supersedes,
  });

  return {
    id,
    filePath,
    kind,
    category,
    title,
    body,
    meta,
    tags,
    source,
    createdAt,
    updatedAt,
    identity_key,
    expires_at,
    supersedes,
    source_files: source_files || null,
    userId: userId || null,
  };
}

/**
 * Update an existing entry's file on disk (merge provided fields with existing).
 * Does NOT re-index — caller must call indexEntry after.
 *
 * @param {{ config, stmts }} ctx
 * @param {object} existing — Row from vault table (from getEntryById)
 * @param {{ title?, body?, tags?, meta?, source?, expires_at? }} updates
 * @returns {object} Entry object suitable for indexEntry
 */
export function updateEntryFile(ctx, existing, updates) {
  const raw = readFileSync(existing.file_path, "utf-8");
  const { meta: fmMeta } = parseFrontmatter(raw);

  const existingMeta = existing.meta ? JSON.parse(existing.meta) : {};
  const existingTags = existing.tags ? JSON.parse(existing.tags) : [];

  const title = updates.title !== undefined ? updates.title : existing.title;
  const body = updates.body !== undefined ? updates.body : existing.body;
  const tags = updates.tags !== undefined ? updates.tags : existingTags;
  const source =
    updates.source !== undefined ? updates.source : existing.source;
  const expires_at =
    updates.expires_at !== undefined ? updates.expires_at : existing.expires_at;
  const supersedes =
    updates.supersedes !== undefined
      ? updates.supersedes
      : fmMeta.supersedes || null;
  const source_files =
    updates.source_files !== undefined
      ? updates.source_files
      : existing.source_files
        ? JSON.parse(existing.source_files)
        : null;

  let mergedMeta;
  if (updates.meta !== undefined) {
    mergedMeta = { ...existingMeta, ...(updates.meta || {}) };
  } else {
    mergedMeta = { ...existingMeta };
  }

  // Build frontmatter
  const now = new Date().toISOString();
  const fmFields = { id: existing.id };
  for (const [k, v] of Object.entries(mergedMeta)) {
    if (k === "folder") continue;
    if (v !== null && v !== undefined) fmFields[k] = v;
  }
  if (existing.identity_key) fmFields.identity_key = existing.identity_key;
  if (expires_at) fmFields.expires_at = expires_at;
  if (supersedes?.length) fmFields.supersedes = supersedes;
  fmFields.tags = tags;
  fmFields.source = source || "claude-code";
  fmFields.created = fmMeta.created || existing.created_at;
  if (now !== fmFields.created) fmFields.updated = now;

  const mdBody = formatBody(existing.kind, { title, body, meta: mergedMeta });
  const md = formatFrontmatter(fmFields) + mdBody;

  writeFileSync(existing.file_path, md);

  const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

  return {
    id: existing.id,
    filePath: existing.file_path,
    kind: existing.kind,
    category: existing.category,
    title,
    body,
    meta: finalMeta,
    tags,
    source,
    createdAt: fmMeta.created || existing.created_at,
    updatedAt: now,
    identity_key: existing.identity_key,
    expires_at,
    supersedes,
    source_files: source_files || null,
    userId: existing.user_id || null,
  };
}

export async function captureAndIndex(ctx, data) {
  // For entity upserts, preserve previous file content for safe rollback
  let previousContent = null;
  if (categoryFor(data.kind) === "entity" && data.identity_key) {
    const identitySlug = slugify(data.identity_key);
    const dir = resolve(ctx.config.vaultDir, kindToPath(data.kind));
    const existingPath = resolve(dir, `${identitySlug}.md`);
    if (existsSync(existingPath)) {
      previousContent = readFileSync(existingPath, "utf-8");
    }
  }

  const entry = writeEntry(ctx, data);
  try {
    await indexEntry(ctx, entry);
    // Apply supersedes: mark referenced entries as superseded by this entry
    if (entry.supersedes?.length && ctx.stmts.updateSupersededBy) {
      for (const supersededId of entry.supersedes) {
        if (typeof supersededId === "string" && supersededId.trim()) {
          ctx.stmts.updateSupersededBy.run(entry.id, supersededId.trim());
        }
      }
    }
    return entry;
  } catch (err) {
    // Rollback: restore previous content for entity upserts, delete for new entries
    if (previousContent) {
      try {
        writeFileSync(entry.filePath, previousContent);
      } catch {}
    } else {
      try {
        unlinkSync(entry.filePath);
      } catch {}
    }
    throw new Error(
      `Capture succeeded but indexing failed — file rolled back. ${err.message}`,
    );
  }
}
