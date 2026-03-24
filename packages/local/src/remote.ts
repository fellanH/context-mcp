import type { RemoteConfig } from '@context-vault/core/types';

const REQUEST_TIMEOUT_MS = 10_000;

export interface RemoteSearchResult {
  id: string;
  kind: string;
  category: string;
  title: string | null;
  body: string;
  tags: string | null;
  tier: string;
  score: number;
  created_at: string;
  updated_at: string | null;
  source: string | null;
  identity_key: string | null;
  meta: string | null;
  file_path: string | null;
  superseded_by: string | null;
  expires_at: string | null;
  source_files: string | null;
  related_to: string | null;
  indexed: number;
  hit_count: number;
  last_accessed_at: string | null;
  recall_count: number;
  recall_sessions: number;
  last_recalled_at: string | null;
}

export interface RemoteHint {
  id: string;
  title: string;
  summary: string;
  relevance: 'high' | 'medium';
  kind: string;
  tags: string[];
}

export class RemoteClient {
  private url: string;
  private apiKey: string;

  constructor(config: RemoteConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; status?: unknown }> {
    try {
      const res = await this.fetch('/api/vault/status');
      if (res.ok) {
        const data = await res.json();
        return { ok: true, status: data };
      }
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async saveEntry(entry: Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
      const res = await this.fetch('/api/vault/entries', {
        method: 'POST',
        body: JSON.stringify(entry),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        return { ok: true, id: data.id as string | undefined };
      }
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async search(params: Record<string, unknown>): Promise<RemoteSearchResult[]> {
    try {
      const query = new URLSearchParams();
      if (params.query) query.set('q', String(params.query));
      if (Array.isArray(params.tags) && params.tags.length) query.set('tags', params.tags.join(','));
      if (params.kind) query.set('kind', String(params.kind));
      if (params.category) query.set('category', String(params.category));
      if (params.scope) query.set('scope', String(params.scope));
      if (params.limit) query.set('limit', String(params.limit));
      if (params.since) query.set('since', String(params.since));
      if (params.until) query.set('until', String(params.until));

      const res = await this.fetch(`/api/vault/search?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      return Array.isArray(data.entries) ? data.entries : Array.isArray(data) ? data as RemoteSearchResult[] : [];
    } catch {
      return [];
    }
  }

  async recall(params: {
    signal: string;
    signal_type: string;
    bucket?: string;
    max_hints?: number;
  }): Promise<RemoteHint[]> {
    try {
      const res = await this.fetch('/api/vault/recall', {
        method: 'POST',
        body: JSON.stringify(params),
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      return Array.isArray(data.hints) ? data.hints : Array.isArray(data) ? data as RemoteHint[] : [];
    } catch {
      return [];
    }
  }

  private fetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    return globalThis.fetch(`${this.url}${path}`, {
      ...opts,
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    }).finally(() => clearTimeout(timeout));
  }
}

let cachedClient: RemoteClient | null = null;
let cachedConfigKey = '';

export function getRemoteClient(config: { remote?: RemoteConfig }): RemoteClient | null {
  if (!config.remote?.enabled || !config.remote?.apiKey) return null;

  const key = `${config.remote.url}:${config.remote.apiKey}`;
  if (cachedClient && cachedConfigKey === key) return cachedClient;

  cachedClient = new RemoteClient(config.remote);
  cachedConfigKey = key;
  return cachedClient;
}

export function mergeRemoteResults<T extends { id: string; score?: number }>(
  localResults: T[],
  remoteResults: T[],
  limit: number
): T[] {
  const localIds = new Set(localResults.map(r => r.id));
  const uniqueRemote = remoteResults.filter(r => !localIds.has(r.id));
  const merged = [...localResults, ...uniqueRemote];
  merged.sort((a, b) => ((b as any).score ?? 0) - ((a as any).score ?? 0));
  return merged.slice(0, limit);
}
