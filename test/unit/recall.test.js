import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestCtx } from '../helpers/ctx.js';
import { captureAndIndex } from '@context-vault/core/capture';

import * as recallTool from '../../packages/local/src/tools/recall.js';

const shared = { ensureIndexed: async () => {}, reindexFailed: false };

function isOk(result) {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return result.content[0].text;
}

describe('recall tool', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    // Seed test entries
    await captureAndIndex(ctx, {
      kind: 'insight',
      title: 'Stripe webhook verification requires raw body',
      body: 'Express 5 raw body parser breaks Stripe webhook signature verification. Use express.raw() middleware before the route.',
      tags: ['stripe', 'express', 'bucket:payments'],
    }, null);

    await captureAndIndex(ctx, {
      kind: 'pattern',
      title: 'SQLite WAL mode for concurrent reads',
      body: 'Enable WAL mode with PRAGMA journal_mode=WAL for better concurrent read performance in SQLite.',
      tags: ['sqlite', 'performance', 'bucket:infra'],
    }, null);

    await captureAndIndex(ctx, {
      kind: 'decision',
      title: 'Authentication uses JWT tokens',
      body: 'Decided to use JWT for auth instead of sessions. Stateless, works across services.',
      tags: ['auth', 'jwt', 'bucket:platform'],
    }, null);
  }, 30000);

  afterAll(() => cleanup());

  beforeEach(() => {
    recallTool._resetSessionState();
  });

  it('returns hints for matching tag', async () => {
    const result = await recallTool.handler(
      { signal: 'stripe webhook integration', signal_type: 'prompt' },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('may be relevant');
    expect(text).toContain('Stripe webhook');
    expect(result._meta.method).toBe('tag_match');
    expect(result._meta.signal_keywords).toContain('stripe');
    expect(result._meta.hints.length).toBeGreaterThan(0);
  }, 30000);

  it('returns hints for matching title keyword', async () => {
    const result = await recallTool.handler(
      { signal: 'sqlite performance tuning', signal_type: 'task' },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('may be relevant');
    expect(text).toContain('SQLite WAL');
    expect(result._meta.method).toBe('tag_match');
  }, 30000);

  it('returns empty hints for no matches (no error)', async () => {
    const result = await recallTool.handler(
      { signal: 'kubernetes deployment yaml', signal_type: 'prompt' },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('No relevant entries');
    expect(result._meta.method).toBe('none');
    expect(result._meta.suppressed).toBe(0);
  }, 30000);

  it('returns empty for signal with only stopwords/short words', async () => {
    const result = await recallTool.handler(
      { signal: 'the is a to on', signal_type: 'prompt' },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('No relevant entries');
    expect(result._meta.method).toBe('none');
    expect(result._meta.signal_keywords).toEqual([]);
  }, 30000);

  it('session dedup: same entry not returned twice with same session_id', async () => {
    const args = { signal: 'stripe webhook', signal_type: 'prompt', session_id: 'test-session-1' };

    const first = await recallTool.handler(args, ctx, shared);
    isOk(first);
    const firstHintCount = first._meta.hints?.length ?? 0;
    expect(firstHintCount).toBeGreaterThan(0);

    const second = await recallTool.handler(args, ctx, shared);
    isOk(second);
    expect(second._meta.suppressed).toBeGreaterThan(0);
    const secondHintCount = second._meta.hints?.length ?? 0;
    expect(secondHintCount).toBeLessThan(firstHintCount);
  }, 30000);

  it('signal_type "error" bypasses session dedup', async () => {
    const sessionId = 'test-session-error';

    // First call as prompt
    const first = await recallTool.handler(
      { signal: 'stripe webhook error', signal_type: 'prompt', session_id: sessionId },
      ctx,
      shared
    );
    isOk(first);
    const firstCount = first._meta.hints?.length ?? 0;
    expect(firstCount).toBeGreaterThan(0);

    // Second call as error should bypass dedup
    const second = await recallTool.handler(
      { signal: 'stripe webhook error', signal_type: 'error', session_id: sessionId },
      ctx,
      shared
    );
    isOk(second);
    expect(second._meta.suppressed).toBe(0);
    expect(second._meta.hints?.length).toBeGreaterThan(0);
  }, 30000);

  it('respects bucket scoping', async () => {
    const result = await recallTool.handler(
      { signal: 'stripe webhook', signal_type: 'prompt', bucket: 'payments' },
      ctx,
      shared
    );
    isOk(result);
    expect(result._meta.hints?.length).toBeGreaterThan(0);

    // Different bucket should not match
    const other = await recallTool.handler(
      { signal: 'stripe webhook', signal_type: 'prompt', bucket: 'nonexistent' },
      ctx,
      shared
    );
    isOk(other);
    expect(other._meta.hints?.length ?? 0).toBe(0);
  }, 30000);

  it('respects max_hints limit', async () => {
    const result = await recallTool.handler(
      { signal: 'stripe sqlite auth tokens', signal_type: 'prompt', max_hints: 1 },
      ctx,
      shared
    );
    isOk(result);
    expect(result._meta.hints?.length).toBeLessThanOrEqual(1);
  }, 30000);

  it('reports latency in _meta', async () => {
    const result = await recallTool.handler(
      { signal: 'stripe webhook', signal_type: 'prompt' },
      ctx,
      shared
    );
    isOk(result);
    expect(typeof result._meta.latency_ms).toBe('number');
    expect(result._meta.latency_ms).toBeGreaterThanOrEqual(0);
  }, 30000);
});

describe('extractKeywords', () => {
  it('filters stopwords and short words', () => {
    const keywords = recallTool.extractKeywords('the stripe webhook is not working');
    expect(keywords).toContain('stripe');
    expect(keywords).toContain('webhook');
    expect(keywords).toContain('working');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('is');
    expect(keywords).not.toContain('not');
  });

  it('limits to 10 keywords', () => {
    const long = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike';
    const keywords = recallTool.extractKeywords(long);
    expect(keywords.length).toBeLessThanOrEqual(10);
  });

  it('deduplicates keywords', () => {
    const keywords = recallTool.extractKeywords('stripe stripe stripe webhook webhook');
    expect(keywords.filter(k => k === 'stripe').length).toBe(1);
    expect(keywords.filter(k => k === 'webhook').length).toBe(1);
  });
});
