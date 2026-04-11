// Types
export type {
  VaultConfig,
  RemoteConfig,
  RecallConfig,
  ConsolidationConfig,
  GrowthThresholds,
  IndexingConfig,
  PreparedStatements,
  VaultEntry,
  SearchResult,
  CaptureInput,
  CaptureResult,
  IndexEntryInput,
  ReindexStats,
  BaseCtx,
  SearchOptions,
} from './types.js';

// Constants
export {
  APP_URL,
  API_URL,
  MARKETING_URL,
  GITHUB_ISSUES_URL,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_KIND_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_COUNT,
  MAX_META_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_IDENTITY_KEY_LENGTH,
  DEFAULT_GROWTH_THRESHOLDS,
  DEFAULT_LIFECYCLE,
  DEFAULT_INDEXING,
} from './constants.js';

// Categories
export {
  categoryFor,
  categoryDirFor,
  defaultTierFor,
  CATEGORY_DIRS,
  KIND_STALENESS_DAYS,
} from './categories.js';

// Config
export { parseArgs, resolveConfig } from './config.js';

// Files
export {
  ulid,
  slugify,
  kindToDir,
  dirToKind,
  normalizeKind,
  kindToPath,
  safeJoin,
  walkDir,
} from './files.js';

// Frontmatter
export {
  formatFrontmatter,
  parseFrontmatter,
  extractCustomMeta,
  parseEntryFromMarkdown,
} from './frontmatter.js';

// Formatters
export { formatBody } from './formatters.js';

// Database
export {
  SCHEMA_DDL,
  NativeModuleError,
  initDatabase,
  prepareStatements,
  insertVec,
  deleteVec,
  testConnection,
} from './db.js';

// Embeddings
export { embed, embedBatch, resetEmbedPipeline, isEmbedAvailable } from './embed.js';

// Index (reindex + indexEntry)
export { indexEntry, reindex, pruneExpired } from './index.js';

// Search (retrieve)
export {
  hybridSearch,
  buildFtsQuery,
  buildFilterClauses,
  recencyBoost,
  recencyDecayScore,
  dotProduct,
  reciprocalRankFusion,
  computeHeatForEntry,
} from './search.js';

// Capture
export { writeEntry, updateEntryFile, captureAndIndex } from './capture.js';

// Indexing
export { shouldIndex } from './indexing.js';

// Compact
export { compact, restoreCompactedBody } from './compact.js';
export type { CompactCtx, CompactOptions, CompactResult } from './compact.js';

// Ingest URL
export { htmlToMarkdown, extractHtmlContent, ingestUrl } from './ingest-url.js';
