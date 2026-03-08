import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestCtx } from '../helpers/ctx.js';
import { captureAndIndex } from '@context-vault/core/capture';

describe('list_context queries', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    // Seed with entries of different kinds and categories
    await captureAndIndex(ctx, {
      kind: 'insight',
      title: 'React hooks tip',
      body: 'Use useCallback for stable references',
      tags: ['react'],
      source: 'test',
    });
    await captureAndIndex(ctx, {
      kind: 'decision',
      title: 'Use Vite',
      body: 'Chose Vite over webpack for faster builds',
      tags: ['tooling'],
      source: 'test',
    });
    await captureAndIndex(ctx, {
      kind: 'pattern',
      title: 'Error boundary',
      body: 'Wrap components in error boundaries',
      tags: ['react', 'patterns'],
      source: 'test',
    });
    await captureAndIndex(ctx, {
      kind: 'contact',
      title: 'Alice',
      body: 'Alice is a frontend developer',
      tags: ['team'],
      source: 'test',
      identity_key: 'alice',
    });
    await captureAndIndex(ctx, {
      kind: 'session',
      title: 'Debug session',
      body: 'Debugged memory leak in production',
      tags: ['debugging'],
      source: 'test',
    });
  }, 60000);

  afterAll(() => cleanup());

  it('lists all entries with no filters', () => {
    const rows = ctx.db
      .prepare(
        "SELECT id, title, kind, category, tags, created_at FROM vault WHERE (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC"
      )
      .all();
    expect(rows.length).toBe(5);
  });

  it('filters by kind', () => {
    const rows = ctx.db.prepare('SELECT id, title, kind FROM vault WHERE kind = ?').all('insight');
    expect(rows.length).toBe(1);
    expect(rows[0].title).toContain('React');
  });

  it('filters by category', () => {
    const knowledge = ctx.db
      .prepare('SELECT id, title, kind FROM vault WHERE category = ?')
      .all('knowledge');
    expect(knowledge.length).toBe(3); // insight, decision, pattern

    const entities = ctx.db
      .prepare('SELECT id, title, kind FROM vault WHERE category = ?')
      .all('entity');
    expect(entities.length).toBe(1); // contact

    const events = ctx.db
      .prepare('SELECT id, title, kind FROM vault WHERE category = ?')
      .all('event');
    expect(events.length).toBe(1); // session
  });

  it('filters by since/until dates', () => {
    const all = ctx.db
      .prepare('SELECT id, title FROM vault WHERE created_at >= ? ORDER BY created_at DESC')
      .all('2020-01-01');
    expect(all.length).toBe(5);

    const none = ctx.db
      .prepare('SELECT id, title FROM vault WHERE created_at >= ?')
      .all('2099-01-01');
    expect(none.length).toBe(0);
  });

  it('applies limit and offset for pagination', () => {
    const page1 = ctx.db
      .prepare('SELECT id, title FROM vault ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(2, 0);
    expect(page1.length).toBe(2);

    const page2 = ctx.db
      .prepare('SELECT id, title FROM vault ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(2, 2);
    expect(page2.length).toBe(2);

    // Entries should be different
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('filters by tags (post-filter)', () => {
    const rows = ctx.db.prepare('SELECT id, title, tags FROM vault ORDER BY created_at DESC').all();
    const reactEntries = rows.filter((r) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return tags.includes('react');
    });
    expect(reactEntries.length).toBe(2); // insight + pattern
  });

  it('combines kind and category filters', () => {
    const rows = ctx.db
      .prepare('SELECT id, title FROM vault WHERE kind = ? AND category = ?')
      .all('insight', 'knowledge');
    expect(rows.length).toBe(1);
  });
});
