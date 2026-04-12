export interface SaveOptions {
  kind: string;
  title: string;
  body: string;
  tags?: string[];
  tier?: 'ephemeral' | 'working' | 'durable';
  identityKey?: string;
  source?: string;
  meta?: Record<string, unknown>;
}

export interface SaveResult {
  id: string;
  freshness: { score: number; label: string };
}

export interface SearchOptions {
  kind?: string;
  tags?: string[];
  limit?: number;
  scope?: string;
}

export interface SearchResultEntry {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  score: number;
  freshness: { score: number; label: string };
}

export interface HealthResult {
  total: number;
  distribution: { fresh: number; aging: number; stale: number; dormant: number };
  averageScore: number;
  needsAttention: number;
  byKind: Record<string, { total: number; avgScore: number }>;
}

export interface VaultBackend {
  save(options: SaveOptions): Promise<SaveResult>;
  search(query: string, options?: SearchOptions): Promise<SearchResultEntry[]>;
  health(): Promise<HealthResult>;
  delete(id: string): Promise<void>;
}
