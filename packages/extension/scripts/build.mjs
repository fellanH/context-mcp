/**
 * Multi-step Vite build for Chrome extension.
 *
 * Runs 4 separate builds to avoid Rollup code-splitting issues:
 * 1. Popup — React HTML app (outputs to dist/popup/)
 * 2. Onboarding — React HTML app (outputs to dist/onboarding/)
 * 3. Background — ESM service worker (single file, dist/background.js)
 * 4. Content — IIFE content script (single file, dist/content.js)
 *
 * Then copies static assets (manifest.json, icons/, public/).
 *
 * Pass --watch to enable file watching for all builds.
 */

import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

const alias = { "@": resolve(root, "src") };
const watching = process.argv.includes("--watch");

// Clean dist
if (existsSync(dist)) rmSync(dist, { recursive: true });
mkdirSync(dist, { recursive: true });

const watchOpts = watching ? { watch: {} } : {};

// ─── Build configs ───────────────────────────────────────────────────────────

const popupConfig = {
  root: resolve(root, "src/popup"),
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(dist, "popup"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "src/popup/index.html"),
    },
    target: "esnext",
    minify: !watching,
    ...watchOpts,
  },
  resolve: { alias },
  logLevel: watching ? "info" : "warn",
};

const onboardingConfig = {
  root: resolve(root, "src/onboarding"),
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(dist, "onboarding"),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(root, "src/onboarding/index.html"),
    },
    target: "esnext",
    minify: !watching,
    ...watchOpts,
  },
  resolve: { alias },
  logLevel: watching ? "info" : "warn",
};

const backgroundConfig = {
  root,
  build: {
    outDir: dist,
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/background/index.ts"),
      formats: ["es"],
      fileName: () => "background.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    target: "esnext",
    minify: !watching,
    ...watchOpts,
  },
  resolve: { alias },
  logLevel: watching ? "info" : "warn",
};

const contentConfig = {
  root,
  build: {
    outDir: dist,
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/content/index.ts"),
      formats: ["iife"],
      fileName: () => "content.js",
      name: "ContextVaultContent",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    target: "esnext",
    minify: !watching,
    ...watchOpts,
  },
  resolve: { alias },
  logLevel: watching ? "info" : "warn",
};

// ─── Copy static assets ─────────────────────────────────────────────────────

function copyStatic() {
  console.log("[build] Copying static assets...");
  cpSync(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
  if (existsSync(resolve(root, "icons"))) {
    cpSync(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
  }
  if (existsSync(resolve(root, "public"))) {
    cpSync(resolve(root, "public"), dist, { recursive: true });
  }
}

// ─── Execute ─────────────────────────────────────────────────────────────────

if (watching) {
  console.log("\n[build] Starting watch mode...");
  copyStatic();
  await Promise.all([
    build(popupConfig),
    build(onboardingConfig),
    build(backgroundConfig),
    build(contentConfig),
  ]);
  console.log("[build] Watching for changes...\n");
} else {
  console.log("\n[build] Step 1/4 — Popup (React HTML app)");
  await build(popupConfig);

  console.log("[build] Step 2/4 — Onboarding (React HTML app)");
  await build(onboardingConfig);

  console.log("[build] Step 3/4 — Background (ESM service worker)");
  await build(backgroundConfig);

  console.log("[build] Step 4/4 — Content script (IIFE)");
  await build(contentConfig);

  copyStatic();
  console.log("[build] Done! Output in dist/\n");
}
