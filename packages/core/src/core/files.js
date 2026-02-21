/**
 * files.js — Shared file system utilities used across layers
 *
 * ULID generation, slugify, kind/dir mapping, directory walking.
 */

import { readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { categoryDirFor } from "./categories.js";

// ─── ULID Generator (Crockford Base32) ────────────────────────────────────────

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

// ─── Slugify ──────────────────────────────────────────────────────────────────

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

// ─── Kind ↔ Directory Mapping ────────────────────────────────────────────────

const PLURAL_MAP = {
  insight: "insights",
  decision: "decisions",
  pattern: "patterns",
  status: "statuses",
  analysis: "analyses",
  contact: "contacts",
  project: "projects",
  tool: "tools",
  source: "sources",
  conversation: "conversations",
  message: "messages",
  session: "sessions",
  log: "logs",
  feedback: "feedbacks",
};

const SINGULAR_MAP = Object.fromEntries(
  Object.entries(PLURAL_MAP).map(([k, v]) => [v, k]),
);

export function kindToDir(kind) {
  if (PLURAL_MAP[kind]) return PLURAL_MAP[kind];
  return kind.endsWith("s") ? kind : kind + "s";
}

export function dirToKind(dirName) {
  if (SINGULAR_MAP[dirName]) return SINGULAR_MAP[dirName];
  return dirName.replace(/s$/, "");
}

/** Normalize a kind input (singular or plural) to its canonical singular form. */
export function normalizeKind(input) {
  if (PLURAL_MAP[input]) return input; // Already a known singular kind
  if (SINGULAR_MAP[input]) return SINGULAR_MAP[input]; // Known plural → singular
  return input; // Unknown — use as-is (don't strip 's')
}

/** Returns relative path from vault root → kind dir: "knowledge/insights", "events/sessions", etc. */
export function kindToPath(kind) {
  return `${categoryDirFor(kind)}/${kindToDir(kind)}`;
}

// ─── Safe Path Join ─────────────────────────────────────────────────────────

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

// ─── Recursive Directory Walk ────────────────────────────────────────────────

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
