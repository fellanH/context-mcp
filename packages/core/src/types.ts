import type { DatabaseSync, StatementSync } from 'node:sqlite';

export interface AutoInsightsConfig {
  enabled: boolean;
  patterns: string[];
  minChars: number;
  maxPerSession: number;
  tier: string;
}

export interface IndexingConfig {
  excludeKinds: string[];
  excludeCategories: string[];
  maxBodySize: number;
  autoIndexEvents: boolean;
}

export interface RemoteConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
}

export interface VaultConfig {
  vaultDir: string;
  dataDir: string;
  dbPath: string;
  devDir: string;
  eventDecayDays: number;
  thresholds: GrowthThresholds;
  telemetry: boolean;
  resolvedFrom: string;
  configPath?: string;
  vaultDirExists?: boolean;
  recall: RecallConfig;
  consolidation: ConsolidationConfig;
  lifecycle: Record<string, { archiveAfterDays?: number }>;
  autoInsights: AutoInsightsConfig;
  indexing: IndexingConfig;
  remote?: RemoteConfig;
}

export interface RecallConfig {
  maxResults: number;
  maxOutputBytes: number;
  minRelevanceScore: number;
  excludeKinds: string[];
  excludeCategories: string[];
  bodyTruncateChars: number;
}

export interface ConsolidationConfig {
  tagThreshold: number;
  maxAgeDays: number;
  autoConsolidate: boolean;
}

export interface GrowthThresholds {
  totalEntries: { warn: number; critical: number };
  eventEntries: { warn: number; critical: number };
  vaultSizeBytes: { warn: number; critical: number };
  eventsWithoutTtl: { warn: number };
}

export interface PreparedStatements {
  insertEntry: StatementSync;
  updateEntry: StatementSync;
  deleteEntry: StatementSync;
  getRowid: StatementSync;
  getRowidByPath: StatementSync;
  getEntryById: StatementSync;
  getByIdentityKey: StatementSync;
  upsertByIdentityKey: StatementSync;
  updateSourceFiles: StatementSync;
  updateRelatedTo: StatementSync;
  insertVecStmt: StatementSync;
  deleteVecStmt: StatementSync;
  updateSupersededBy: StatementSync;
  clearSupersededByRef: StatementSync;
  insertCtxVecStmt: StatementSync;
  deleteCtxVecStmt: StatementSync;
}

export interface VaultEntry {
  id: string;
  kind: string;
  category: string;
  title: string | null;
  body: string;
  meta: string | null;
  tags: string | null;
  source: string | null;
  file_path: string | null;
  identity_key: string | null;
  expires_at: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string | null;
  hit_count: number;
  last_accessed_at: string | null;
  source_files: string | null;
  tier: string;
  related_to: string | null;
  indexed: number;
  recall_count: number;
  recall_sessions: number;
  last_recalled_at: string | null;
  rowid?: number;
}

export interface SearchResult extends VaultEntry {
  score: number;
  stale?: boolean;
  stale_reason?: string;
}

export interface CaptureInput {
  kind: string;
  title?: string | null;
  body: string;
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
  source?: string | null;
  folder?: string | null;
  identity_key?: string | null;
  expires_at?: string | null;
  supersedes?: string[] | null;
  related_to?: string[] | null;
  source_files?: Array<{ path: string; hash: string }> | null;
  tier?: string | null;
  indexed?: boolean;
}

export interface CaptureResult {
  id: string;
  filePath: string;
  kind: string;
  category: string;
  title: string | null;
  body: string;
  meta: Record<string, unknown> | undefined;
  tags: string[] | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  identity_key: string | null;
  expires_at: string | null;
  supersedes: string[] | null;
  related_to: string[] | null;
  source_files: Array<{ path: string; hash: string }> | null;
  tier: string | null;
  indexed: boolean;
}

export interface IndexEntryInput {
  id: string;
  kind: string;
  category: string;
  title: string | null;
  body: string;
  meta: Record<string, unknown> | undefined;
  tags: string[] | null;
  source: string | null;
  filePath: string;
  createdAt: string;
  identity_key: string | null;
  expires_at: string | null;
  source_files: Array<{ path: string; hash: string }> | null;
  tier: string | null;
  indexed?: boolean;
}

export interface ReindexStats {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  skippedIndexing?: number;
  embeddingsCleared?: number;
}

export interface BaseCtx {
  db: DatabaseSync;
  config: VaultConfig;
  stmts: PreparedStatements;
  embed: (text: string) => Promise<Float32Array | null>;
  insertVec: (rowid: number, embedding: Float32Array) => void;
  deleteVec: (rowid: number) => void;
  insertCtxVec: (rowid: number, embedding: Float32Array) => void;
  deleteCtxVec: (rowid: number) => void;
}

export interface SearchOptions {
  kindFilter?: string | null;
  categoryFilter?: string | null;
  excludeEvents?: boolean;
  since?: string | null;
  until?: string | null;
  limit?: number;
  offset?: number;
  decayDays?: number;
  includeSuperseeded?: boolean;
  includeEphemeral?: boolean;
  /** Pre-computed context embedding for contextual reinstatement boosting. */
  contextEmbedding?: Float32Array | null;
}
