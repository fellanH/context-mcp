#!/usr/bin/env node

/**
 * postinstall.js — Post-install setup for context-vault
 *
 * 1. Detects NODE_MODULE_VERSION mismatches for native modules and rebuilds.
 * 2. Installs @huggingface/transformers with --ignore-scripts to avoid sharp's
 *    broken install lifecycle in global contexts.  Semantic search degrades
 *    gracefully if this step fails.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const NODE_MODULES = join(PKG_ROOT, "node_modules");

async function main() {
  // ── 1. Native-module rebuild ──────────────────────────────────────────
  let needsRebuild = false;

  try {
    await import("better-sqlite3");
  } catch (e) {
    if (e.message?.includes("NODE_MODULE_VERSION")) {
      needsRebuild = true;
    }
  }

  try {
    await import("sqlite-vec");
  } catch (e) {
    if (e.message?.includes("NODE_MODULE_VERSION")) {
      needsRebuild = true;
    }
  }

  if (needsRebuild) {
    console.log(
      "[context-vault] Rebuilding native modules for Node.js " +
        process.version +
        "...",
    );
    try {
      execSync("npm rebuild better-sqlite3 sqlite-vec", {
        stdio: "inherit",
        timeout: 60000,
      });
      console.log("[context-vault] Native modules rebuilt successfully.");
    } catch {
      console.error("[context-vault] Warning: native module rebuild failed.");
      console.error(
        "[context-vault] Try manually: npm rebuild better-sqlite3 sqlite-vec",
      );
    }
  }

  // ── 2. Install @huggingface/transformers (optional) ───────────────────
  // The transformers package depends on `sharp`, whose install script fails
  // in global npm contexts.  We install with --ignore-scripts to skip it —
  // context-vault only uses text embeddings, not image processing.
  // Check the package's own node_modules (not general import resolution,
  // which may find it in the workspace during `npm install -g ./tarball`).
  const transformersDir = join(NODE_MODULES, "@huggingface", "transformers");
  if (!existsSync(transformersDir)) {
    console.log(
      "[context-vault] Installing embedding support (@huggingface/transformers)...",
    );
    try {
      execSync(
        "npm install --no-save --ignore-scripts @huggingface/transformers@^3.0.0",
        {
          stdio: "inherit",
          timeout: 120000,
          cwd: PKG_ROOT,
        },
      );
      console.log("[context-vault] Embedding support installed.");
    } catch {
      console.error(
        "[context-vault] Warning: could not install @huggingface/transformers.",
      );
      console.error(
        "[context-vault] Semantic search will be unavailable; full-text search still works.",
      );
    }
  }
}

main().catch(() => {});
