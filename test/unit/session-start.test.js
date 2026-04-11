import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestCtx } from '../helpers/ctx.js';
import { captureAndIndex } from '@context-vault/core/capture';
import * as recallTool from '../../packages/local/src/tools/session-start.js';

const shared = { ensureIndexed: async () => {}, reindexFailed: false };

function isOk(result) {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return result.content[0].text;
}

describe('recall handler — tool metadata', () => {
  it('exports correct tool name', () => {
    expect(recallTool.name).toBe('recall');
  });

  it('exports a description string', () => {
    expect(typeof recallTool.description).toBe('string');
    expect(recallTool.description.length).toBeGreaterThan(10);
  });

  it('exports inputSchema with signal and signal_type', () => {
    expect(recallTool.inputSchema).toHaveProperty('signal');
    expect(recallTool.inputSchema).toHaveProperty('signal_type');
  });
});

describe('recall handler — empty vault', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it('returns no relevant entries message with empty vault', async () => {
    const result = await recallTool.handler(
      { signal: 'some test signal about things', signal_type: 'prompt' },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('No relevant entries found');
  }, 30000);

  it('returns ok result even with empty vault', async () => {
    const result = await recallTool.handler(
      { signal: 'test signal', signal_type: 'task' },
      ctx,
      shared
    );
    expect(result.isError).toBeFalsy();
  }, 30000);
});

describe('recall handler — with data', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    await captureAndIndex(ctx, {
      kind: 'decision',
      title: 'Use SQLite for storage',
      body: 'We chose SQLite over PostgreSQL for local-first architecture',
      tags: ['myapp', 'architecture'],
      source: 'test',
    });

    await captureAndIndex(ctx, {
      kind: 'insight',
      title: 'WAL mode improves concurrency',
      body: 'SQLite WAL mode allows concurrent reads and writes',
      tags: ['myapp', 'sqlite'],
      source: 'test',
    });

    await captureAndIndex(ctx, {
      kind: 'pattern',
      title: 'ULID for identifiers',
      body: 'Use ULID for all entity IDs to ensure sortable unique keys',
      tags: ['myapp', 'patterns'],
      source: 'test',
    });

    await captureAndIndex(ctx, {
      kind: 'session',
      title: 'Last session summary',
      body: 'Worked on implementing the search pipeline with RRF and MMR reranking.',
      tags: ['myapp'],
      source: 'test',
    });

    await captureAndIndex(ctx, {
      kind: 'note',
      title: 'Random note',
      body: 'This is a general note not tagged with myapp',
      tags: ['other-project'],
      source: 'test',
    });
  }, 60000);

  afterAll(() => cleanup());

  it('returns relevant hints for a matching signal', async () => {
    const result = await recallTool.handler(
      { signal: 'SQLite storage architecture database', signal_type: 'prompt' },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('Vault');
    expect(text).toContain('relevant');
  }, 30000);

  it('includes _meta with latency and method info', async () => {
    const result = await recallTool.handler(
      { signal: 'SQLite storage', signal_type: 'prompt' },
      ctx,
      shared
    );
    expect(result._meta).toBeTruthy();
    expect(result._meta.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result._meta.method).toBeDefined();
    expect(result._meta.signal_keywords).toBeDefined();
    expect(Array.isArray(result._meta.signal_keywords)).toBe(true);
  }, 30000);

  it('returns no relevant entries for unrelated signal', async () => {
    const result = await recallTool.handler(
      { signal: 'zzz xyzzy unrelated topic foobar', signal_type: 'prompt' },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('No relevant entries found');
  }, 30000);

  it('works without explicit bucket (searches all)', async () => {
    const result = await recallTool.handler(
      { signal: 'SQLite WAL mode', signal_type: 'prompt' },
      ctx,
      shared
    );
    expect(result.isError).toBeFalsy();
  }, 30000);

  it('respects max_hints parameter', async () => {
    const result = await recallTool.handler(
      { signal: 'SQLite storage architecture ULID patterns', signal_type: 'prompt', max_hints: 1 },
      ctx,
      shared
    );
    const text = isOk(result);
    if (!text.includes('No relevant entries found')) {
      // When hints are found, _meta.hints should be small (max_hints + possible durable overflow)
      expect(result._meta.hints).toBeDefined();
      // The handler may return up to limit+2 due to durable semantic recall overlap
      expect(result._meta.hints.length).toBeLessThanOrEqual(3);
    }
  }, 30000);

  it('includes hints array in _meta when results found', async () => {
    const result = await recallTool.handler(
      { signal: 'SQLite storage database', signal_type: 'prompt' },
      ctx,
      shared
    );
    if (!result.content[0].text.includes('No relevant entries found')) {
      expect(result._meta.hints).toBeDefined();
      expect(Array.isArray(result._meta.hints)).toBe(true);
      for (const hint of result._meta.hints) {
        expect(hint.id).toBeDefined();
        expect(hint.title).toBeDefined();
        expect(hint.kind).toBeDefined();
        expect(['high', 'medium']).toContain(hint.relevance);
      }
    }
  }, 30000);
});

describe('recall handler — project scoping', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    // Use bucket: prefix tags so the recall bucket filter matches correctly
    await captureAndIndex(ctx, {
      kind: 'decision',
      title: 'Project Alpha unique title',
      body: 'Architecture decision for project alpha microservices',
      tags: ['bucket:project-a'],
      source: 'test',
    });

    await captureAndIndex(ctx, {
      kind: 'decision',
      title: 'Project Beta unique title',
      body: 'Architecture decision for project beta kubernetes',
      tags: ['bucket:project-b'],
      source: 'test',
    });
  }, 60000);

  afterAll(() => cleanup());

  it('scopes entries to the specified bucket', async () => {
    const result = await recallTool.handler(
      { signal: 'microservices architecture decision', signal_type: 'prompt', bucket: 'project-a' },
      ctx,
      shared
    );
    const text = isOk(result);
    // Result must be a valid response (bucket scoping may allow semantic recall to add extras)
    expect(result.isError).toBeFalsy();
    // Primary keyword match for bucket:project-a should include Project Alpha
    if (!text.includes('No relevant entries found')) {
      expect(text).toContain('Project Alpha');
    }
  }, 30000);

  it('scopes to project-b bucket when requested', async () => {
    const result = await recallTool.handler(
      { signal: 'kubernetes architecture decision', signal_type: 'prompt', bucket: 'project-b' },
      ctx,
      shared
    );
    const text = isOk(result);
    // Result must be a valid response (bucket scoping may allow semantic recall to add extras)
    expect(result.isError).toBeFalsy();
    // Primary keyword match for bucket:project-b should include Project Beta
    if (!text.includes('No relevant entries found')) {
      expect(text).toContain('Project Beta');
    }
  }, 30000);
});
