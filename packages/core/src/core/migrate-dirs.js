/**
 * migrate-dirs.js — Rename plural vault directories to singular
 *
 * After context-vault >= 2.18.0, kindToDir() returns singular names.
 * Existing vaults still have plural dirs (e.g. knowledge/decisions/).
 * This module plans and executes the rename/merge migration.
 *
 * Architecture: pure planning function + I/O execution function.
 */

import {
  existsSync,
  readdirSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, basename } from "node:path";

/**
 * Complete plural→singular mapping for vault directory names.
 * Covers the old PLURAL_MAP from files.js plus extended kinds seen in the wild.
 *
 * @type {Record<string, string>}
 */
export const PLURAL_TO_SINGULAR = {
  // From old PLURAL_MAP in files.js
  insights: "insight",
  decisions: "decision",
  patterns: "pattern",
  statuses: "status",
  analyses: "analysis",
  contacts: "contact",
  projects: "project",
  tools: "tool",
  sources: "source",
  conversations: "conversation",
  messages: "message",
  sessions: "session",
  logs: "log",
  feedbacks: "feedback",
  // Extended kinds from categories.js + observed in vaults
  notes: "note",
  prompts: "prompt",
  documents: "document",
  references: "reference",
  tasks: "task",
  buckets: "bucket",
  architectures: "architecture",
  briefs: "brief",
  companies: "company",
  discoveries: "discovery",
  events: "event",
  ideas: "idea",
  issues: "issue",
  agents: "agent",
  "session-summaries": "session-summary",
  "session-reviews": "session-review",
  "user-prompts": "user-prompt",
};

/**
 * Category directory names that are scanned for plural kind subdirectories.
 */
const CATEGORY_DIRS = ["knowledge", "entities", "events"];

/**
 * Count .md files recursively in a directory.
 *
 * @param {string} dir
 * @returns {number}
 */
function countMdFiles(dir) {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count += countMdFiles(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        count++;
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return count;
}

/**
 * Plan migration operations: walk the vault and detect plural dirs that need renaming.
 * Pure I/O read-only — does not modify any files.
 *
 * @param {string} vaultDir - Absolute path to vault root
 * @returns {MigrationOp[]} Array of planned operations
 *
 * @typedef {{ action: 'rename'|'merge', pluralDir: string, singularDir: string, pluralName: string, singularName: string, fileCount: number }} MigrationOp
 */
export function planMigration(vaultDir) {
  const ops = [];

  for (const catName of CATEGORY_DIRS) {
    const catDir = join(vaultDir, catName);
    if (!existsSync(catDir) || !statSync(catDir).isDirectory()) continue;

    let entries;
    try {
      entries = readdirSync(catDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      const singular = PLURAL_TO_SINGULAR[dirName];

      // Not a known plural — skip (might already be singular or unknown kind)
      if (!singular) continue;

      const pluralDir = join(catDir, dirName);
      const singularDir = join(catDir, singular);

      // Guard: plural and singular are the same (shouldn't happen but be safe)
      if (pluralDir === singularDir) continue;

      const fileCount = countMdFiles(pluralDir);
      const singularExists = existsSync(singularDir);

      ops.push({
        action: singularExists ? "merge" : "rename",
        pluralDir,
        singularDir,
        pluralName: dirName,
        singularName: singular,
        fileCount,
      });
    }
  }

  return ops;
}

/**
 * Copy all files and subdirectories from src into dst (non-overwriting).
 * Mirrors `cp -rn src/* dst/`.
 *
 * @param {string} src
 * @param {string} dst
 */
function mergeDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      mergeDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      if (!existsSync(dstPath)) {
        copyFileSync(srcPath, dstPath);
      }
    }
  }
}

/**
 * Execute migration operations. Renames or merges plural dirs into singular dirs.
 * Safe to call multiple times — already-renamed dirs produce no-op ops from planMigration.
 *
 * @param {MigrationOp[]} ops - Operations from planMigration()
 * @returns {{ renamed: number, merged: number, errors: string[] }}
 */
export function executeMigration(ops) {
  let renamed = 0;
  let merged = 0;
  const errors = [];

  for (const op of ops) {
    try {
      if (op.action === "rename") {
        renameSync(op.pluralDir, op.singularDir);
        renamed++;
      } else {
        // merge: copy files from plural into singular, then remove plural
        mergeDir(op.pluralDir, op.singularDir);
        rmSync(op.pluralDir, { recursive: true, force: true });
        merged++;
      }
    } catch (e) {
      errors.push(`${op.pluralName} → ${op.singularName}: ${e.message}`);
    }
  }

  return { renamed, merged, errors };
}
