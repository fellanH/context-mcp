#!/usr/bin/env node

import {
  cpSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_ROOT = join(__dirname, "..");
const NODE_MODULES = join(LOCAL_ROOT, "node_modules");
const CORE_SRC = join(LOCAL_ROOT, "..", "core");
const CORE_DEST = join(NODE_MODULES, "@context-vault", "core");
const APP_SRC = join(LOCAL_ROOT, "..", "app", "dist");
const APP_DEST = join(LOCAL_ROOT, "app-dist");

// Clean node_modules to prevent workspace deps from leaking into the tarball.
// Only @context-vault/core should be bundled.
rmSync(NODE_MODULES, { recursive: true, force: true });

// Ensure target directory exists
mkdirSync(join(NODE_MODULES, "@context-vault"), { recursive: true });

// Copy core package (dereference symlinks)
cpSync(CORE_SRC, CORE_DEST, { recursive: true, dereference: true });

// Remove nested node_modules from the copy
rmSync(join(CORE_DEST, "node_modules"), { recursive: true, force: true });

// Strip all dependencies from the bundled core's package.json.
// Core's deps (better-sqlite3, sqlite-vec, MCP SDK) are hoisted to
// context-vault's own dependencies.  @huggingface/transformers is
// dynamically imported and installed via postinstall.  Leaving them
// in the bundled core causes duplicate resolution that breaks native
// module install scripts in global npm contexts.
const corePkgPath = join(CORE_DEST, "package.json");
const corePkg = JSON.parse(readFileSync(corePkgPath, "utf8"));
delete corePkg.dependencies;
writeFileSync(corePkgPath, JSON.stringify(corePkg, null, 2) + "\n");

console.log("[prepack] Bundled @context-vault/core into node_modules");

// Copy pre-built web dashboard into app-dist/ (optional — UI falls back to cloud)
if (!existsSync(join(APP_SRC, "index.html"))) {
  console.warn(
    "[prepack] WARNING: Web dashboard not built — app-dist/ will not be bundled.\n" +
      "[prepack] `context-vault ui` will open app.context-vault.com instead.\n" +
      "[prepack] To bundle locally: build packages/app first.",
  );
} else {
  rmSync(APP_DEST, { recursive: true, force: true });
  cpSync(APP_SRC, APP_DEST, { recursive: true });
  console.log("[prepack] Bundled web dashboard into app-dist/");
}
