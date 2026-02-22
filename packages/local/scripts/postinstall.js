#!/usr/bin/env node

/**
 * postinstall.js — Post-install setup for context-vault
 *
 * 1. Installs @huggingface/transformers with --ignore-scripts to avoid sharp's
 *    broken install lifecycle in global contexts.  Semantic search degrades
 *    gracefully if this step fails.
 * 2. Writes local server launcher (global installs only).
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const NODE_MODULES = join(PKG_ROOT, "node_modules");

async function main() {
  // ── 1. Install @huggingface/transformers (optional) ───────────────────
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

  // ── 2. Write local server launcher (global installs only) ────────────
  // Under npx the path would be stale after cache eviction — configs use
  // `npx context-vault serve` instead, so skip writing the launcher.
  const isNpx = PKG_ROOT.includes("/_npx/") || PKG_ROOT.includes("\\_npx\\");
  if (!isNpx) {
    const SERVER_ABS = join(PKG_ROOT, "src", "server", "index.js");
    const DATA_DIR = join(homedir(), ".context-mcp");
    const LAUNCHER = join(DATA_DIR, "server.mjs");
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LAUNCHER, `import "${SERVER_ABS}";\n`);
    console.log("[context-vault] Local server launcher written to " + LAUNCHER);
  }
}

main().catch(() => {});
