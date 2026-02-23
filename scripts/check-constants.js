#!/usr/bin/env node
/**
 * check-constants.js — Duplicate constant detector for context-vault monorepo.
 *
 * Each entry in SENTINELS declares a constant and its canonical file. Any
 * definition of that constant found outside the canonical file is a violation.
 *
 * Exit 0: clean. Exit 1: violations found.
 *
 * Usage:
 *   node scripts/check-constants.js
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ─── Sentinel registry ──────────────────────────────────────────────────────
//
// Each entry defines a constant that must only be assigned in its canonical file.
//   name      — human-readable label for error messages
//   pattern   — RegExp that matches a *definition* (const/let/var declaration)
//   canonical — canonical file path, relative to repo root
//
const SENTINELS = [
  // ── Entry validation limits ─────────────────────────────────────────────
  // Canonical: packages/core/src/constants.js
  // Previously violated in: packages/core/src/server/tools/{save-context,ingest-url}.js
  //                         packages/hosted/src/validation/entry-validation.js
  {
    name: "MAX_BODY_LENGTH",
    pattern: /\bconst\s+MAX_BODY_LENGTH\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MAX_TITLE_LENGTH",
    pattern: /\bconst\s+MAX_TITLE_LENGTH\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MAX_KIND_LENGTH",
    pattern: /\bconst\s+MAX_KIND_LENGTH\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MAX_TAG_LENGTH",
    pattern: /\bconst\s+MAX_TAG_LENGTH\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MAX_TAGS_COUNT",
    pattern: /\bconst\s+MAX_TAGS_COUNT\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MAX_META_LENGTH",
    pattern: /\bconst\s+MAX_META_LENGTH\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MAX_SOURCE_LENGTH",
    pattern: /\bconst\s+MAX_SOURCE_LENGTH\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MAX_IDENTITY_KEY_LENGTH",
    pattern: /\bconst\s+MAX_IDENTITY_KEY_LENGTH\b/,
    canonical: "packages/core/src/constants.js",
  },
  // ── Embedding model identifier ──────────────────────────────────────────
  // Canonical: packages/core/src/index/embed.js
  {
    name: 'Embedding model name ("Xenova/all-MiniLM-L6-v2")',
    pattern: /["']Xenova\/all-MiniLM-L6-v2["']/,
    canonical: "packages/core/src/index/embed.js",
  },
  // ── Canonical URLs ───────────────────────────────────────────────────────
  // Canonical: packages/core/src/constants.js
  {
    name: "APP_URL",
    pattern: /\bconst\s+APP_URL\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "API_URL",
    pattern: /\bconst\s+API_URL\b/,
    canonical: "packages/core/src/constants.js",
  },
  {
    name: "MARKETING_URL",
    pattern: /\bconst\s+MARKETING_URL\b/,
    canonical: "packages/core/src/constants.js",
  },
];

// ─── File discovery ─────────────────────────────────────────────────────────

const SCAN_DIRS = [
  "packages/core/src",
  "packages/local/src",
  "packages/local/bin",
  "packages/hosted/src",
];

const SKIP_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "__snapshots__",
]);

const SCAN_EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);

function collectFiles(absDir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry)) continue;
    const full = join(absDir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (SCAN_EXTS.has(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = SCAN_DIRS.flatMap((d) => collectFiles(join(ROOT, d)));

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract monorepo package name from a relative path, e.g. "packages/core/..." → "core" */
function packageOf(rel) {
  const parts = rel.split("/");
  return parts[0] === "packages" ? parts[1] : parts[0];
}

// ─── Scan ────────────────────────────────────────────────────────────────────

let violations = 0;

for (const sentinel of SENTINELS) {
  const hits = [];

  for (const file of allFiles) {
    const rel = relative(ROOT, file);
    if (rel === sentinel.canonical) continue; // canonical file is always allowed

    let content;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (sentinel.pattern.test(content)) {
      hits.push(rel);
    }
  }

  if (hits.length === 0) continue;

  violations++;
  const canonicalPkg = packageOf(sentinel.canonical);
  console.error(`\n✗  ${sentinel.name}`);
  console.error(`   Canonical: ${sentinel.canonical}`);
  console.error(`   Duplicate definition(s):`);
  for (const hit of hits) {
    const hitPkg = packageOf(hit);
    const tag =
      hitPkg !== canonicalPkg
        ? ` [cross-package: ${canonicalPkg} ↔ ${hitPkg}]`
        : "";
    console.error(`     - ${hit}${tag}`);
  }
  console.error(
    `   Fix: import from the canonical file instead of redefining.`,
  );
}

// ─── Result ──────────────────────────────────────────────────────────────────

if (violations === 0) {
  console.log(
    `✓ No duplicate constants detected (${allFiles.length} files scanned).`,
  );
  process.exit(0);
} else {
  const s = violations === 1 ? "" : "s";
  console.error(
    `\n${violations} violation${s} found. Constants must be defined in exactly one canonical file.`,
  );
  console.error(
    "Cross-package duplicates cannot share imports — extract to packages/core/src/constants.js.",
  );
  process.exit(1);
}
