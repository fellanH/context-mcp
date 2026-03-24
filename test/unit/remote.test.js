import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

process.env.CONTEXT_VAULT_TEST = '1';

describe('mergeRemoteResults', () => {
  let mergeRemoteResults;

  beforeEach(async () => {
    const mod = await import('../../packages/local/dist/remote.js');
    mergeRemoteResults = mod.mergeRemoteResults;
  });

  it('deduplicates by id, local wins', () => {
    const local = [
      { id: 'a', title: 'Local A', score: 0.9 },
      { id: 'b', title: 'Local B', score: 0.8 },
    ];
    const remote = [
      { id: 'b', title: 'Remote B', score: 0.95 },
      { id: 'c', title: 'Remote C', score: 0.7 },
    ];
    const merged = mergeRemoteResults(local, remote, 10);

    // Should have 3 entries: a, b (local version), c
    expect(merged).toHaveLength(3);
    const ids = merged.map(r => r.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');

    // b should be the local version
    const entryB = merged.find(r => r.id === 'b');
    expect(entryB.title).toBe('Local B');
  });

  it('respects limit', () => {
    const local = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
    ];
    const remote = [
      { id: 'c', score: 0.7 },
      { id: 'd', score: 0.6 },
    ];
    const merged = mergeRemoteResults(local, remote, 3);
    expect(merged).toHaveLength(3);
  });

  it('sorts by score descending', () => {
    const local = [
      { id: 'a', score: 0.5 },
    ];
    const remote = [
      { id: 'b', score: 0.9 },
    ];
    const merged = mergeRemoteResults(local, remote, 10);
    expect(merged[0].id).toBe('b');
    expect(merged[1].id).toBe('a');
  });

  it('handles empty remote results', () => {
    const local = [{ id: 'a', score: 0.9 }];
    const merged = mergeRemoteResults(local, [], 10);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a');
  });

  it('handles empty local results', () => {
    const remote = [{ id: 'a', score: 0.9 }];
    const merged = mergeRemoteResults([], remote, 10);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a');
  });
});

describe('getRemoteClient', () => {
  let getRemoteClient;

  beforeEach(async () => {
    const mod = await import('../../packages/local/dist/remote.js');
    getRemoteClient = mod.getRemoteClient;
  });

  it('returns null when remote is not configured', () => {
    expect(getRemoteClient({})).toBeNull();
    expect(getRemoteClient({ remote: undefined })).toBeNull();
  });

  it('returns null when remote is disabled', () => {
    const client = getRemoteClient({
      remote: { enabled: false, url: 'https://api.example.com', apiKey: 'cv_test' },
    });
    expect(client).toBeNull();
  });

  it('returns null when apiKey is empty', () => {
    const client = getRemoteClient({
      remote: { enabled: true, url: 'https://api.example.com', apiKey: '' },
    });
    expect(client).toBeNull();
  });

  it('returns a client when properly configured', () => {
    const client = getRemoteClient({
      remote: { enabled: true, url: 'https://api.example.com', apiKey: 'cv_test123' },
    });
    expect(client).not.toBeNull();
    expect(client.constructor.name).toBe('RemoteClient');
  });
});

describe('config remote section', () => {
  let tmp;
  let cleanup;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cv-remote-config-'));
    cleanup = () => rmSync(tmp, { recursive: true, force: true });
  });

  afterEach(() => cleanup());

  it('getRemoteConfig returns null when no config file', async () => {
    const { getRemoteConfig } = await import('@context-vault/core/config');
    expect(getRemoteConfig(tmp)).toBeNull();
  });

  it('saveRemoteConfig creates config with remote section', async () => {
    const { saveRemoteConfig, getRemoteConfig } = await import('@context-vault/core/config');
    saveRemoteConfig({ enabled: true, url: 'https://api.example.com', apiKey: 'cv_abc' }, tmp);
    const remote = getRemoteConfig(tmp);
    expect(remote).not.toBeNull();
    expect(remote.enabled).toBe(true);
    expect(remote.url).toBe('https://api.example.com');
    expect(remote.apiKey).toBe('cv_abc');
  });

  it('saveRemoteConfig preserves existing config fields', async () => {
    const { saveRemoteConfig, getRemoteConfig } = await import('@context-vault/core/config');
    const configPath = join(tmp, 'config.json');
    writeFileSync(configPath, JSON.stringify({ vaultDir: '/custom/vault', telemetry: false }));
    saveRemoteConfig({ enabled: true, url: 'https://api.example.com', apiKey: 'cv_xyz' }, tmp);

    const raw = JSON.parse(require('node:fs').readFileSync(configPath, 'utf-8'));
    expect(raw.vaultDir).toBe('/custom/vault');
    expect(raw.telemetry).toBe(false);
    expect(raw.remote.enabled).toBe(true);
  });

  it('saveRemoteConfig merges partial updates', async () => {
    const { saveRemoteConfig, getRemoteConfig } = await import('@context-vault/core/config');
    saveRemoteConfig({ enabled: true, url: 'https://api.example.com', apiKey: 'cv_first' }, tmp);
    saveRemoteConfig({ enabled: false }, tmp);

    const remote = getRemoteConfig(tmp);
    expect(remote.enabled).toBe(false);
    expect(remote.apiKey).toBe('cv_first'); // preserved
    expect(remote.url).toBe('https://api.example.com'); // preserved
  });

  it('resolveConfig parses remote section', async () => {
    const configPath = join(tmp, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      remote: { enabled: true, url: 'https://test.api.com', apiKey: 'cv_test' }
    }));
    // resolveConfig reads from dataDir/config.json
    process.env.CONTEXT_VAULT_DATA_DIR = tmp;
    try {
      const { resolveConfig } = await import('@context-vault/core/config');
      const config = resolveConfig();
      expect(config.remote).toBeDefined();
      expect(config.remote.enabled).toBe(true);
      expect(config.remote.url).toBe('https://test.api.com');
      expect(config.remote.apiKey).toBe('cv_test');
    } finally {
      delete process.env.CONTEXT_VAULT_DATA_DIR;
    }
  });
});

describe('RemoteClient', () => {
  let RemoteClient;

  beforeEach(async () => {
    const mod = await import('../../packages/local/dist/remote.js');
    RemoteClient = mod.RemoteClient;
  });

  it('testConnection returns ok:false on network error', async () => {
    const client = new RemoteClient({
      enabled: true,
      url: 'http://localhost:19999',
      apiKey: 'cv_test',
    });
    const result = await client.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('search returns empty array on error', async () => {
    const client = new RemoteClient({
      enabled: true,
      url: 'http://localhost:19999',
      apiKey: 'cv_test',
    });
    const results = await client.search({ query: 'test' });
    expect(results).toEqual([]);
  });

  it('recall returns empty array on error', async () => {
    const client = new RemoteClient({
      enabled: true,
      url: 'http://localhost:19999',
      apiKey: 'cv_test',
    });
    const hints = await client.recall({ signal: 'test', signal_type: 'prompt' });
    expect(hints).toEqual([]);
  });

  it('saveEntry returns ok:false on error', async () => {
    const client = new RemoteClient({
      enabled: true,
      url: 'http://localhost:19999',
      apiKey: 'cv_test',
    });
    const result = await client.saveEntry({ kind: 'insight', body: 'test' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
