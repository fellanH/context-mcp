/**
 * file-ops.js — Capture-specific file operations
 *
 * Writes markdown entry files with frontmatter to the vault directory.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { formatFrontmatter } from "../core/frontmatter.js";
import { slugify, kindToPath } from "../core/files.js";
import { formatBody } from "./formatters.js";

export function safeFolderPath(vaultDir, kind, folder) {
  const base = resolve(vaultDir, kindToPath(kind));
  if (!folder) return base;
  const resolved = resolve(base, folder);
  const rel = relative(base, resolved);
  if (rel.startsWith("..") || resolve(base, rel) !== resolved) {
    throw new Error(`Folder path escapes vault: "${folder}"`);
  }
  return resolved;
}

export function writeEntryFile(vaultDir, kind, { id, title, body, meta, tags, source, createdAt, folder, category, identity_key, expires_at }) {
  // P5: folder is now a top-level param; also accept from meta for backward compat
  const resolvedFolder = folder || meta?.folder || "";
  const dir = safeFolderPath(vaultDir, kind, resolvedFolder);

  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new Error(`Failed to create directory "${dir}": ${e.message}`);
  }

  const created = createdAt || new Date().toISOString();
  const fmFields = { id };

  // Add kind-specific meta fields to frontmatter (flattened, not nested)
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (k === "folder") continue;
      if (v !== null && v !== undefined) fmFields[k] = v;
    }
  }

  if (identity_key) fmFields.identity_key = identity_key;
  if (expires_at) fmFields.expires_at = expires_at;
  fmFields.tags = tags || [];
  fmFields.source = source || "claude-code";
  fmFields.created = created;

  const mdBody = formatBody(kind, { title, body, meta });

  // Entity kinds: deterministic filename from identity_key (no ULID suffix)
  let filename;
  if (category === "entity" && identity_key) {
    const identitySlug = slugify(identity_key);
    filename = identitySlug ? `${identitySlug}.md` : `${id.slice(-8).toLowerCase()}.md`;
  } else {
    const slug = slugify((title || body).slice(0, 40));
    const shortId = id.slice(-8).toLowerCase();
    filename = slug ? `${slug}-${shortId}.md` : `${shortId}.md`;
  }

  const filePath = resolve(dir, filename);
  const md = formatFrontmatter(fmFields) + mdBody;

  try {
    writeFileSync(filePath, md);
  } catch (e) {
    throw new Error(`Failed to write entry file "${filePath}": ${e.message}`);
  }

  return filePath;
}
