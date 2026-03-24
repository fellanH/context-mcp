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
  recall_members?: number;
}

export interface RemoteHint {
  id: string;
  title: string;
  summary: string;
  relevance: 'high' | 'medium';
  kind: string;
  tags: string[];
}

export interface TeamSearchResult extends RemoteSearchResult {
  source: 'team';
  recall_count: number;
  recall_members?: number;
}

export interface PrivacyScanMatch {
  type: string;
  value: string;
  field: string;
  line: number;
}

export interface PublishResult {
  ok: boolean;
  id?: string;
  error?: string;
  status?: number;
  privacyMatches?: PrivacyScanMatch[];
  conflict?: {
    existing_entry_id: string;
    existing_author: string;
    similarity: number;
    suggestion: string;
  };
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

  async teamSearch(teamId: string, params: Record<string, unknown>): Promise<TeamSearchResult[]> {
    try {
      const query = new URLSearchParams();
      if (params.query) query.set('q', String(params.query));
      if (Array.isArray(params.tags) && params.tags.length) query.set('tags', params.tags.join(','));
      if (params.kind) query.set('kind', String(params.kind));
      if (params.category) query.set('category', String(params.category));
      if (params.limit) query.set('limit', String(params.limit));
      if (params.since) query.set('since', String(params.since));
      if (params.until) query.set('until', String(params.until));

      const res = await this.fetch(`/api/team/${teamId}/search?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const entries = Array.isArray(data.entries) ? data.entries : Array.isArray(data) ? data : [];
      return (entries as TeamSearchResult[]).map(e => ({ ...e, source: 'team' as const }));
    } catch {
      return [];
    }
  }

  async teamRecall(teamId: string, params: {
    signal: string;
    signal_type: string;
    bucket?: string;
    max_hints?: number;
  }): Promise<RemoteHint[]> {
    try {
      const res = await this.fetch(`/api/team/${teamId}/search`, {
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

  async teamStatus(teamId: string): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
    try {
      const res = await this.fetch(`/api/team/${teamId}/status`);
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        return { ok: true, data };
      }
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async publishToTeam(params: {
    entryId: string;
    teamId: string;
    visibility: string;
    force?: boolean;
    entry?: Record<string, unknown>;
  }): Promise<PublishResult> {
    try {
      const res = await this.fetch('/api/vault/publish', {
        method: 'POST',
        body: JSON.stringify({
          entryId: params.entryId,
          teamId: params.teamId,
          visibility: params.visibility,
          ...(params.force ? { force: true } : {}),
          ...(params.entry || {}),
        }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (res.ok) {
        return {
          ok: true,
          id: data.id as string | undefined,
          conflict: data.conflict as PublishResult['conflict'],
        };
      }
      if (res.status === 422 && data.code === 'PRIVACY_SCAN_FAILED') {
        const matches = Array.isArray(data.matches) ? data.matches as PrivacyScanMatch[] : [];
        return {
          ok: false,
          error: typeof data.error === 'string' ? data.error : 'Privacy scan failed',
          status: 422,
          privacyMatches: matches,
        };
      }
      const errorText = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      return { ok: false, error: errorText, status: res.status, conflict: data.conflict as PublishResult['conflict'] };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
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

export function getTeamId(config: { remote?: RemoteConfig }): string | null {
  return config.remote?.teamId || null;
}

/**
 * Apply recall-driven ranking boost to team results.
 * Entries with higher recall_count and recall_members rank higher.
 * Formula: score * log(1 + recall_count) * (1 + 0.1 * recall_members)
 */
export function applyTeamRecallBoost<T extends { score?: number; recall_count?: number; recall_members?: number }>(
  entries: T[]
): T[] {
  return entries.map(e => {
    const baseScore = (e as any).score ?? 0;
    const recallCount = e.recall_count ?? 0;
    const recallMembers = e.recall_members ?? 0;
    if (recallCount === 0 && recallMembers === 0) return e;
    const boostedScore = baseScore * Math.log(1 + recallCount) * (1 + 0.1 * recallMembers);
    return { ...e, score: boostedScore };
  });
}

/**
 * Merge local, personal remote, and team results.
 * Priority: local > personal remote > team.
 * Team results get recall-driven ranking boost before merge.
 */
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

export function mergeWithTeamResults<T extends { id: string; score?: number; recall_count?: number; recall_members?: number }>(
  localAndPersonal: T[],
  teamResults: T[],
  limit: number
): T[] {
  const existingIds = new Set(localAndPersonal.map(r => r.id));
  const uniqueTeam = teamResults.filter(r => !existingIds.has(r.id));
  const boostedTeam = applyTeamRecallBoost(uniqueTeam);
  const merged = [...localAndPersonal, ...boostedTeam];
  merged.sort((a, b) => ((b as any).score ?? 0) - ((a as any).score ?? 0));
  return merged.slice(0, limit);
}
