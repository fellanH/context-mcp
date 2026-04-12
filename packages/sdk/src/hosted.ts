import type { VaultBackend, SaveOptions, SaveResult, SearchOptions, SearchResultEntry, HealthResult } from './types.js';

export interface HostedOptions {
  apiKey: string;
  baseUrl?: string;
}

export class HostedBackend implements VaultBackend {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: HostedOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || 'https://api.context-vault.com').replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async save(options: SaveOptions): Promise<SaveResult> {
    const payload: Record<string, unknown> = {
      kind: options.kind,
      title: options.title,
      body: options.body,
    };
    if (options.tags) payload.tags = options.tags;
    if (options.tier) payload.tier = options.tier;
    if (options.identityKey) payload.identity_key = options.identityKey;
    if (options.source) payload.source = options.source;
    if (options.meta) payload.meta = options.meta;

    return this.request<SaveResult>('POST', '/api/vault/entries', payload);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResultEntry[]> {
    const payload: Record<string, unknown> = { query };
    if (options?.kind) payload.kind = options.kind;
    if (options?.limit) payload.limit = options.limit;

    const tags = options?.tags ? [...options.tags] : [];
    if (options?.scope) tags.push(`bucket:${options.scope}`);
    if (tags.length) payload.tags = tags;

    return this.request<SearchResultEntry[]>('POST', '/api/vault/search', payload);
  }

  async health(): Promise<HealthResult> {
    return this.request<HealthResult>('GET', '/api/vault/health');
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/api/vault/entries/${encodeURIComponent(id)}`);
  }
}
