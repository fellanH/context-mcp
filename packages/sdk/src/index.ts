import type { VaultBackend, SaveOptions, SaveResult, SearchOptions, SearchResultEntry, HealthResult } from './types.js';
import { HostedBackend } from './hosted.js';
import type { HostedOptions } from './hosted.js';
import type { LocalOptions } from './local.js';

export type { SaveOptions, SaveResult, SearchOptions, SearchResultEntry, HealthResult } from './types.js';
export type { HostedOptions } from './hosted.js';
export type { LocalOptions } from './local.js';

export class ContextVault {
  private readonly backend: VaultBackend;

  private constructor(backend: VaultBackend) {
    this.backend = backend;
  }

  static hosted(opts: HostedOptions): ContextVault {
    return new ContextVault(new HostedBackend(opts));
  }

  static local(opts?: LocalOptions): ContextVault {
    // Lazy-load local backend to avoid pulling in @context-vault/core at import time.
    // The LocalBackend itself uses dynamic import() for core modules,
    // but we also defer loading the local.ts module itself here.
    let backendPromise: Promise<VaultBackend> | null = null;
    const lazyBackend: VaultBackend = {
      async save(options: SaveOptions): Promise<SaveResult> {
        if (!backendPromise) backendPromise = createLocalBackend(opts);
        return (await backendPromise).save(options);
      },
      async search(query: string, options?: SearchOptions): Promise<SearchResultEntry[]> {
        if (!backendPromise) backendPromise = createLocalBackend(opts);
        return (await backendPromise).search(query, options);
      },
      async health(): Promise<HealthResult> {
        if (!backendPromise) backendPromise = createLocalBackend(opts);
        return (await backendPromise).health();
      },
      async delete(id: string): Promise<void> {
        if (!backendPromise) backendPromise = createLocalBackend(opts);
        return (await backendPromise).delete(id);
      },
    };

    return new ContextVault(lazyBackend);
  }

  async save(options: SaveOptions): Promise<SaveResult> {
    return this.backend.save(options);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResultEntry[]> {
    return this.backend.search(query, options);
  }

  async health(): Promise<HealthResult> {
    return this.backend.health();
  }

  async delete(id: string): Promise<void> {
    return this.backend.delete(id);
  }
}

async function createLocalBackend(opts?: LocalOptions): Promise<VaultBackend> {
  const { LocalBackend } = await import('./local.js');
  return new LocalBackend(opts);
}
