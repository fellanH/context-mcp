/**
 * @context-vault/core — Shared core for context-vault
 *
 * Re-exports all public APIs from capture, index, retrieve, server, and core layers.
 */

// Core utilities
export {
  categoryFor,
  categoryDirFor,
  defaultTierFor,
  CATEGORY_DIRS,
} from "./core/categories.js";
export { parseArgs, resolveConfig } from "./core/config.js";
export {
  ulid,
  slugify,
  kindToDir,
  dirToKind,
  normalizeKind,
  kindToPath,
  safeJoin,
  walkDir,
} from "./core/files.js";
export {
  formatFrontmatter,
  parseFrontmatter,
  extractCustomMeta,
  parseEntryFromMarkdown,
} from "./core/frontmatter.js";
export { gatherVaultStatus } from "./core/status.js";

// Capture layer
export {
  writeEntry,
  updateEntryFile,
  captureAndIndex,
} from "./capture/index.js";
export { writeEntryFile } from "./capture/file-ops.js";
export { formatBody } from "./capture/formatters.js";

// Index layer
export {
  SCHEMA_DDL,
  initDatabase,
  prepareStatements,
  insertVec,
  deleteVec,
} from "./index/db.js";
export { embed, embedBatch, resetEmbedPipeline } from "./index/embed.js";
export { indexEntry, reindex, pruneExpired } from "./index/index.js";

// Retrieve layer
export { hybridSearch } from "./retrieve/index.js";

// Server tools & helpers
export { registerTools } from "./server/tools.js";
export {
  ok,
  err,
  ensureVaultExists,
  ensureValidKind,
} from "./server/helpers.js";
