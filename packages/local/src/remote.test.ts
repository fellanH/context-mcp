import { describe, it, expect } from 'vitest';
import {
  mergeRemoteResults,
  mergeWithTeamResults,
  applyTeamRecallBoost,
  getTeamId,
} from './remote.js';

describe('mergeRemoteResults', () => {
  it('deduplicates by id, keeping local over remote', () => {
    const local = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
    ];
    const remote = [
      { id: 'b', score: 0.95 },
      { id: 'c', score: 0.7 },
    ];
    const result = mergeRemoteResults(local, remote, 10);
    expect(result.map(r => r.id)).toEqual(['a', 'b', 'c']);
    // local 'b' wins (score 0.8), not remote's 0.95
    expect(result.find(r => r.id === 'b')!.score).toBe(0.8);
  });

  it('respects limit', () => {
    const local = [{ id: 'a', score: 0.9 }];
    const remote = [
      { id: 'b', score: 0.8 },
      { id: 'c', score: 0.7 },
    ];
    const result = mergeRemoteResults(local, remote, 2);
    expect(result).toHaveLength(2);
  });

  it('sorts by score descending', () => {
    const local = [{ id: 'a', score: 0.5 }];
    const remote = [{ id: 'b', score: 0.9 }];
    const result = mergeRemoteResults(local, remote, 10);
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
  });
});

describe('applyTeamRecallBoost', () => {
  it('boosts entries with recall_count > 0', () => {
    const entries = [
      { id: 'a', score: 1.0, recall_count: 5, recall_members: 2 },
      { id: 'b', score: 1.0, recall_count: 0, recall_members: 0 },
    ];
    const boosted = applyTeamRecallBoost(entries);
    expect(boosted.find(e => e.id === 'a')!.score).toBeGreaterThan(1.0);
    expect(boosted.find(e => e.id === 'b')!.score).toBe(1.0);
  });

  it('applies formula: score * log(1 + recall_count) * (1 + 0.1 * recall_members)', () => {
    const entries = [{ id: 'x', score: 2.0, recall_count: 10, recall_members: 3 }];
    const boosted = applyTeamRecallBoost(entries);
    const expected = 2.0 * Math.log(1 + 10) * (1 + 0.1 * 3);
    expect(boosted[0].score).toBeCloseTo(expected, 5);
  });

  it('handles missing recall fields gracefully', () => {
    const entries = [{ id: 'a', score: 0.5 }];
    const boosted = applyTeamRecallBoost(entries);
    expect(boosted[0].score).toBe(0.5);
  });
});

describe('mergeWithTeamResults', () => {
  it('deduplicates team results against local+personal', () => {
    const localAndPersonal = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
    ];
    const team = [
      { id: 'b', score: 0.7, recall_count: 5, recall_members: 2 },
      { id: 'c', score: 0.6, recall_count: 3, recall_members: 1 },
    ];
    const result = mergeWithTeamResults(localAndPersonal, team, 10);
    const ids = result.map(r => r.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    // 'b' should appear only once (from local+personal)
    expect(ids.filter(id => id === 'b')).toHaveLength(1);
  });

  it('boosts team results by recall before merging', () => {
    const localAndPersonal = [{ id: 'a', score: 0.5 }];
    const team = [{ id: 'b', score: 0.3, recall_count: 100, recall_members: 5 }];
    const result = mergeWithTeamResults(localAndPersonal, team, 10);
    // team entry 'b' should be boosted significantly by high recall
    const bResult = result.find(r => r.id === 'b');
    expect(bResult).toBeDefined();
    expect(bResult!.score!).toBeGreaterThan(0.3);
  });

  it('respects limit', () => {
    const local = [{ id: 'a', score: 0.9 }];
    const team = [
      { id: 'b', score: 0.8, recall_count: 1, recall_members: 1 },
      { id: 'c', score: 0.7, recall_count: 1, recall_members: 1 },
    ];
    const result = mergeWithTeamResults(local, team, 2);
    expect(result).toHaveLength(2);
  });
});

describe('getTeamId', () => {
  it('returns teamId when present', () => {
    const config = { remote: { enabled: true, url: 'http://x', apiKey: 'k', teamId: 'team-1' } };
    expect(getTeamId(config)).toBe('team-1');
  });

  it('returns null when no remote config', () => {
    expect(getTeamId({})).toBeNull();
  });

  it('returns null when teamId not set', () => {
    const config = { remote: { enabled: true, url: 'http://x', apiKey: 'k' } };
    expect(getTeamId(config)).toBeNull();
  });
});
