/**
 * files.js — Shared file system utilities used across layers
 *
 * ULID generation, slugify, kind/dir mapping, directory walking.
 */

import { readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { categoryDirFor } from "./categories.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid() {
  const now = Date.now();
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[t & 31] + ts;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand += CROCKFORD[Math.floor(Math.random() * 32)];
  }
  return ts + rand;
}

export function slugify(text, maxLen = 60) {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > maxLen) {
    slug =
      slug.slice(0, maxLen).replace(/-[^-]*$/, "") || slug.slice(0, maxLen);
  }
  return slug;
}

/** Map kind name to its directory name. Kind names are used as-is (no pluralization). */
export function kindToDir(kind) {
  return kind;
}

/** Map directory name back to kind name. Directory names equal kind names (identity). */
export function dirToKind(dirName) {
  return dirName;
}

/** Normalize a kind input to its canonical form. Kind names are returned as-is. */
export function normalizeKind(input) {
  return input;
}

/** Returns relative path from vault root → kind dir: "knowledge/insights", "events/sessions", etc. */
export function kindToPath(kind) {
  return `${categoryDirFor(kind)}/${kindToDir(kind)}`;
}

export function safeJoin(base, ...parts) {
  const resolvedBase = resolve(base);
  const result = resolve(join(base, ...parts));
  if (!result.startsWith(resolvedBase + sep) && result !== resolvedBase) {
    throw new Error(
      `Path traversal blocked: resolved path escapes base directory`,
    );
  }
  return result;
}

export function walkDir(dir) {
  const results = [];
  function walk(currentDir, relDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith("_")) {
        walk(fullPath, relDir ? join(relDir, entry.name) : entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push({ filePath: fullPath, relDir });
      }
    }
  }
  walk(dir, "");
  return results;
}
