/**
 * Capture Layer — Public API
 *
 * Writes knowledge entries to vault as .md files.
 * That is its entire job. It does not index, embed, or query.
 *
 * Agent Constraint: Only imports from ../core. Never imports ../index or ../retrieve.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ulid, slugify, kindToPath } from "../core/files.js";
import { categoryFor } from "../core/categories.js";
import { parseFrontmatter } from "../core/frontmatter.js";
import { writeEntryFile } from "./file-ops.js";

export function writeEntry(ctx, { kind, title, body, meta, tags, source, folder, identity_key, expires_at }) {
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
    } else {
      id = ulid();
      createdAt = new Date().toISOString();
    }
  } else {
    id = ulid();
    createdAt = new Date().toISOString();
  }

  const filePath = writeEntryFile(ctx.config.vaultDir, kind, {
    id, title, body, meta, tags, source, createdAt, folder,
    category, identity_key, expires_at,
  });

  return { id, filePath, kind, category, title, body, meta, tags, source, createdAt, identity_key, expires_at };
}

export async function captureAndIndex(ctx, data, indexFn) {
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
    await indexFn(ctx, entry);
    return entry;
  } catch (err) {
    // Rollback: restore previous content for entity upserts, delete for new entries
    if (previousContent) {
      try { writeFileSync(entry.filePath, previousContent); } catch {}
    } else {
      try { unlinkSync(entry.filePath); } catch {}
    }
    throw new Error(
      `Capture succeeded but indexing failed — file rolled back. ${err.message}`
    );
  }
}
