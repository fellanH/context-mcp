/**
 * Unit tests for vault entry linking (related_to / graph traversal).
 *
 * Covers:
 *  - Pure functions in linking.js (parseRelatedTo, validateRelatedTo,
 *    resolveLinks, resolveBacklinks, collectLinkedEntries)
 *  - save_context: related_to stored in DB + frontmatter
 *  - get_context follow_links: forward + backward link resolution
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestCtx } from '../helpers/ctx.js';
import { captureAndIndex } from '@context-vault/core/capture';

import {
  parseRelatedTo,
  validateRelatedTo,
  resolveLinks,
  resolveBacklinks,
  collectLinkedEntries,
} from '../../packages/local/src/linking.js';

import * as getContextTool from '../../packages/local/src/tools/get-context.js';
import * as saveContextTool from '../../packages/local/src/tools/save-context.js';

const shared = { ensureIndexed: async () => {}, reindexFailed: false };

function isOk(result) {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return result.content[0].text;
}

function isErr(result, code) {
  expect(result.isError).toBe(true);
  if (code) expect(result.code).toBe(code);
  return result.content[0].text;
}

// ─── Pure unit tests (no DB) ─────────────────────────────────────────────────

describe('parseRelatedTo', () => {
  it('returns empty array for null', () => {
    expect(parseRelatedTo(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parseRelatedTo(undefined)).toEqual([]);
  });

  it('parses a JSON array of IDs', () => {
    expect(parseRelatedTo('["01ABC", "01DEF"]')).toEqual(['01ABC', '01DEF']);
  });

  it('returns empty array for malformed JSON', () => {
    expect(parseRelatedTo('{not valid}')).toEqual([]);
  });

  it('filters non-string entries', () => {
    expect(parseRelatedTo('[1, "abc", null, "def"]')).toEqual(['abc', 'def']);
  });

  it('returns empty array for JSON non-array', () => {
    expect(parseRelatedTo('"just a string"')).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(parseRelatedTo('[]')).toEqual([]);
  });
});

describe('validateRelatedTo', () => {
  it('returns null for undefined (not provided)', () => {
    expect(validateRelatedTo(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(validateRelatedTo(null)).toBeNull();
  });

  it('returns null for valid array of IDs', () => {
    expect(validateRelatedTo(['01ABCDEF', '01GHIJKL'])).toBeNull();
  });

  it('returns error message for non-array', () => {
    expect(validateRelatedTo('string')).toContain('array');
  });

  it('returns error for array containing non-string', () => {
    expect(validateRelatedTo([123])).toContain('non-empty string');
  });

  it('returns error for array containing empty string', () => {
    expect(validateRelatedTo([''])).toContain('non-empty string');
  });

  it('returns error for ID over 32 chars', () => {
    const longId = 'A'.repeat(33);
    expect(validateRelatedTo([longId])).toContain('too long');
  });

  it('returns null for exactly 32-char ID', () => {
    const id = 'A'.repeat(32);
    expect(validateRelatedTo([id])).toBeNull();
  });
});

// ─── DB-backed tests ──────────────────────────────────────────────────────────

describe('resolveLinks', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it('returns empty array for empty ID list', () => {
    expect(resolveLinks(ctx.db, [], undefined)).toEqual([]);
  });

  it('returns matched entries for valid IDs', async () => {
    const entry = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Insight alpha',
      title: 'Alpha',
      tags: [],
    });
    const results = resolveLinks(ctx.db, [entry.id], undefined);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(entry.id);
  }, 30000);

  it('returns empty array for non-existent IDs', () => {
    expect(resolveLinks(ctx.db, ['NONEXISTENT'], undefined)).toEqual([]);
  });

  it('resolves multiple IDs at once', async () => {
    const a = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Entry A',
      title: 'A',
      tags: [],
    });
    const b = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Entry B',
      title: 'B',
      tags: [],
    });
    const results = resolveLinks(ctx.db, [a.id, b.id], undefined);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  }, 30000);
});

describe('resolveBacklinks', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it('returns empty array when no backlinks exist', async () => {
    const target = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Target entry',
      title: 'Target',
      tags: [],
    });
    expect(resolveBacklinks(ctx.db, target.id, undefined)).toEqual([]);
  }, 30000);

  it('finds entries that link to the target via related_to', async () => {
    const target = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'The target insight',
      title: 'Target',
      tags: [],
    });

    // Manually write related_to to simulate a linked entry
    const linker = await captureAndIndex(ctx, {
      kind: 'decision',
      body: 'Decision body',
      title: 'Decision',
      tags: [],
    });
    // Set related_to in DB directly
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([target.id]), linker.id);

    const backlinks = resolveBacklinks(ctx.db, target.id, undefined);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].id).toBe(linker.id);
  }, 30000);

  it('returns empty array for empty entryId', () => {
    expect(resolveBacklinks(ctx.db, '', undefined)).toEqual([]);
  });
});

describe('collectLinkedEntries', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it('returns empty arrays when no links exist', async () => {
    const entry = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Solo entry',
      title: 'Solo',
      tags: [],
    });
    const row = ctx.db.prepare('SELECT * FROM vault WHERE id = ?').get(entry.id);
    const { forward, backward } = collectLinkedEntries(ctx.db, [row], undefined);
    expect(forward).toEqual([]);
    expect(backward).toEqual([]);
  }, 30000);

  it('resolves forward links from related_to', async () => {
    const targetA = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Insight about caching',
      title: 'Caching insight',
      tags: [],
    });
    const targetB = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Insight about indexing',
      title: 'Indexing insight',
      tags: [],
    });
    const source = await captureAndIndex(ctx, {
      kind: 'decision',
      body: 'Decision body',
      title: 'My decision',
      tags: [],
    });
    // Set related_to on source → both targets
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([targetA.id, targetB.id]), source.id);

    const sourceRow = ctx.db.prepare('SELECT * FROM vault WHERE id = ?').get(source.id);
    const { forward, backward } = collectLinkedEntries(ctx.db, [sourceRow], undefined);
    expect(forward).toHaveLength(2);
    const forwardIds = forward.map((e) => e.id);
    expect(forwardIds).toContain(targetA.id);
    expect(forwardIds).toContain(targetB.id);
    expect(backward).toEqual([]);
  }, 30000);

  it('resolves backward links (backlinks)', async () => {
    const primary = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Primary insight',
      title: 'Primary',
      tags: [],
    });
    const referrer = await captureAndIndex(ctx, {
      kind: 'decision',
      body: 'Referrer body',
      title: 'Referrer',
      tags: [],
    });
    // Referrer links to primary
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([primary.id]), referrer.id);

    const primaryRow = ctx.db.prepare('SELECT * FROM vault WHERE id = ?').get(primary.id);
    const { forward, backward } = collectLinkedEntries(ctx.db, [primaryRow], undefined);
    expect(forward).toEqual([]);
    expect(backward).toHaveLength(1);
    expect(backward[0].id).toBe(referrer.id);
  }, 30000);

  it('excludes primary entries from linked results', async () => {
    const a = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Entry A content',
      title: 'A',
      tags: [],
    });
    const b = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Entry B content',
      title: 'B',
      tags: [],
    });
    // A links to B and B links to A
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([b.id]), a.id);
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([a.id]), b.id);

    const rowA = ctx.db.prepare('SELECT * FROM vault WHERE id = ?').get(a.id);
    const rowB = ctx.db.prepare('SELECT * FROM vault WHERE id = ?').get(b.id);
    const { forward, backward } = collectLinkedEntries(ctx.db, [rowA, rowB], undefined);
    // Both are primaries — neither should appear in forward/backward
    expect(forward).toEqual([]);
    expect(backward).toEqual([]);
  }, 30000);
});

// ─── save_context handler — related_to field ─────────────────────────────────

describe('save_context with related_to', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it('saves related_to and stores it in DB', async () => {
    const target = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'The target entry',
      title: 'Target',
      tags: [],
    });

    const result = await saveContextTool.handler(
      {
        kind: 'decision',
        title: 'My decision',
        body: 'Decision body',
        related_to: [target.id],
      },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('✓ Saved decision');

    // Extract saved ID from output
    const idMatch = text.match(/id: (\S+)/);
    expect(idMatch).toBeTruthy();
    const savedId = idMatch[1];

    // Verify related_to in DB
    const row = ctx.db.prepare('SELECT related_to FROM vault WHERE id = ?').get(savedId);
    expect(row).toBeTruthy();
    const stored = JSON.parse(row.related_to);
    expect(stored).toContain(target.id);
  }, 30000);

  it('rejects non-array related_to', async () => {
    const result = await saveContextTool.handler(
      {
        kind: 'insight',
        body: 'Some body',
        related_to: 'not-an-array',
      },
      ctx,
      shared
    );
    isErr(result, 'INVALID_INPUT');
  }, 30000);

  it('rejects empty-string ID in related_to', async () => {
    const result = await saveContextTool.handler(
      {
        kind: 'insight',
        body: 'Some body',
        related_to: [''],
      },
      ctx,
      shared
    );
    isErr(result, 'INVALID_INPUT');
  }, 30000);

  it('updates related_to on existing entry', async () => {
    const target = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'New target',
      title: 'New Target',
      tags: [],
    });
    const entry = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Entry to update',
      title: 'To update',
      tags: [],
    });

    const result = await saveContextTool.handler(
      { id: entry.id, related_to: [target.id] },
      ctx,
      shared
    );
    isOk(result);

    const row = ctx.db.prepare('SELECT related_to FROM vault WHERE id = ?').get(entry.id);
    const stored = JSON.parse(row.related_to);
    expect(stored).toContain(target.id);
  }, 30000);

  it('writes related_to to frontmatter file', async () => {
    const target = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'File target',
      title: 'File Target',
      tags: [],
    });
    const result = await saveContextTool.handler(
      {
        kind: 'insight',
        body: 'Entry with file links',
        title: 'Linked entry',
        related_to: [target.id],
      },
      ctx,
      shared
    );
    isOk(result);

    // Find the written file
    const idMatch = result.content[0].text.match(/id: (\S+)/);
    const savedId = idMatch[1];
    const row = ctx.db.prepare('SELECT file_path FROM vault WHERE id = ?').get(savedId);
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(row.file_path, 'utf-8');
    expect(content).toContain('related_to:');
    expect(content).toContain(target.id);
  }, 30000);
});

// ─── get_context follow_links ────────────────────────────────────────────────

describe('get_context follow_links', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it('returns no linked entries section when follow_links is false', async () => {
    await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Standalone insight for search',
      title: 'Standalone',
      tags: ['test-fl-false'],
    });
    const result = await getContextTool.handler({ tags: ['test-fl-false'] }, ctx, shared);
    const text = isOk(result);
    expect(text).not.toContain('Linked Entries');
  }, 30000);

  it("shows 'No related entries found' when follow_links true but no links", async () => {
    await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Lonely insight with no links',
      title: 'Lonely',
      tags: ['test-fl-none'],
    });
    const result = await getContextTool.handler(
      { tags: ['test-fl-none'], follow_links: true },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('Linked Entries');
    expect(text).toContain('No related entries found');
  }, 30000);

  it('follows forward links from related_to field', async () => {
    const linked = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'This is the linked target insight',
      title: 'Linked Target',
      tags: ['test-fl-target'],
    });
    const source = await captureAndIndex(ctx, {
      kind: 'decision',
      body: 'Decision that links to the insight',
      title: 'Decision',
      tags: ['test-fl-source'],
    });
    // Set up link: source → linked
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([linked.id]), source.id);

    const result = await getContextTool.handler(
      { tags: ['test-fl-source'], follow_links: true },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('Linked Entries');
    expect(text).toContain('Linked Target');
    expect(text).toContain('→ forward');
  }, 30000);

  it('resolves backlinks (entries that point to the result)', async () => {
    const primary = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Primary insight content',
      title: 'Primary insight',
      tags: ['test-fl-primary'],
    });
    const referrer = await captureAndIndex(ctx, {
      kind: 'decision',
      body: 'Decision that references the primary',
      title: 'Referring decision',
      tags: ['test-fl-referrer'],
    });
    // referrer → primary (backlink from primary's perspective)
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([primary.id]), referrer.id);

    const result = await getContextTool.handler(
      { tags: ['test-fl-primary'], follow_links: true },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('Linked Entries');
    expect(text).toContain('Referring decision');
    expect(text).toContain('← backlink');
  }, 30000);

  it('shows both forward and backward links in the same response', async () => {
    const fwdTarget = await captureAndIndex(ctx, {
      kind: 'insight',
      body: 'Forward target',
      title: 'Forward target',
      tags: ['test-fl-bidir-fwd'],
    });
    const bkEntry = await captureAndIndex(ctx, {
      kind: 'pattern',
      body: 'Pattern with a backlink',
      title: 'Backlink pattern',
      tags: ['test-fl-bidir-bk'],
    });
    const pivot = await captureAndIndex(ctx, {
      kind: 'decision',
      body: 'Pivot decision',
      title: 'Pivot',
      tags: ['test-fl-bidir-pivot'],
    });
    // pivot → fwdTarget (forward)
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([fwdTarget.id]), pivot.id);
    // bkEntry → pivot (backlink for pivot)
    ctx.db
      .prepare('UPDATE vault SET related_to = ? WHERE id = ?')
      .run(JSON.stringify([pivot.id]), bkEntry.id);

    const result = await getContextTool.handler(
      { tags: ['test-fl-bidir-pivot'], follow_links: true },
      ctx,
      shared
    );
    const text = isOk(result);
    expect(text).toContain('→ forward');
    expect(text).toContain('← backlink');
    expect(text).toContain('Forward target');
    expect(text).toContain('Backlink pattern');
  }, 30000);
});
