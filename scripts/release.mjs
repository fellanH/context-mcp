#!/usr/bin/env node

/**
 * Full release script: bump → verify changelog → commit → tag → push
 *
 * Usage:
 *   npm run release -- patch     # 2.4.2 → 2.4.3
 *   npm run release -- minor     # 2.4.2 → 2.5.0
 *   npm run release -- major     # 2.4.2 → 3.0.0
 *   npm run release -- 2.5.0     # explicit version
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PACKAGE_FILES = [
  "package.json",
  "packages/core/package.json",
  "packages/local/package.json",
];

// --- Helpers ---

function run(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}

function parseVersion(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Invalid version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bump(current, type) {
  const [major, minor, patch] = parseVersion(current);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      parseVersion(type); // validate
      return type;
  }
}

// --- Preflight checks ---

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npm run release -- <patch|minor|major|x.y.z>");
  process.exit(1);
}

const dirty = run("git status --porcelain");
if (dirty) {
  console.error("Working tree is dirty. Commit or stash changes first.\n");
  console.error(dirty);
  process.exit(1);
}

const branch = run("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.error(`On branch "${branch}" — releases should be from main.`);
}

try {
  run("npm whoami");
} catch {
  console.error("Not logged in to npm. Run: npm login");
  process.exit(1);
}

// --- Bump versions ---

const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const oldVersion = rootPkg.version;
const newVersion = bump(oldVersion, arg);

console.log(`\n  ${oldVersion} → ${newVersion}\n`);

for (const file of PACKAGE_FILES) {
  const fullPath = resolve(root, file);
  const pkg = JSON.parse(readFileSync(fullPath, "utf8"));
  pkg.version = newVersion;

  if (pkg.dependencies?.["@context-vault/core"]) {
    pkg.dependencies["@context-vault/core"] = `^${newVersion}`;
  }

  writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  bumped ${file}`);
}

// --- Verify CHANGELOG ---

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## [${newVersion}]`)) {
  console.error(`\n  CHANGELOG.md has no entry for [${newVersion}].`);
  console.error(`  Add a "## [${newVersion}]" section before releasing.\n`);
  // Revert bumped files
  run("git checkout -- " + PACKAGE_FILES.join(" "));
  console.error("  Reverted version bumps.");
  process.exit(1);
}

// --- Run tests ---

console.log("\n  running tests...");
run("npm test");
console.log("  tests passed\n");

// --- Publish to npm ---

console.log("  publishing to npm...");
run("npm publish --workspace packages/core --access public");
console.log(`  published @context-vault/core@${newVersion}`);
run("npm publish --workspace packages/local --access public");
console.log(`  published context-vault@${newVersion}\n`);

// --- Commit, tag, push ---

run(`git add ${PACKAGE_FILES.join(" ")} CHANGELOG.md`);
run(`git commit -m "v${newVersion}"`);
run(`git tag v${newVersion}`);

console.log(`  committed and tagged v${newVersion}`);
console.log(`  pushing to origin...\n`);

run("git push origin main --tags");

console.log(`  done.\n`);
