import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../remote.js', () => ({
  getRemoteClient: vi.fn(),
  getTeamId: vi.fn(),
}));

vi.mock('../helpers.js', async () => {
  const actual = await vi.importActual('../helpers.js');
  return actual;
});

import { handler } from './publish-to-team.js';
import { getRemoteClient, getTeamId } from '../remote.js';

function makeCtx(entry?: Record<string, any>) {
  return {
    config: { remote: { enabled: true, url: 'http://test', apiKey: 'k', teamId: 'team-1' } },
    stmts: {
      getEntryById: {
        get: vi.fn().mockReturnValue(entry ?? {
          id: 'entry-1',
          kind: 'insight',
          category: 'knowledge',
          title: 'Test Entry',
          body: 'Some body',
          tags: '["tag1"]',
          meta: '{}',
          source: null,
          identity_key: null,
          tier: 'working',
        }),
      },
    },
  } as any;
}

describe('publish_to_team handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTeamId as any).mockReturnValue('team-1');
  });

  it('returns formatted advisory on 422 privacy scan failure', async () => {
    const mockClient = {
      publishToTeam: vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        error: 'Entry contains potentially sensitive content',
        privacyMatches: [
          { type: 'email', value: 'fe***@klarhimmel.se', field: 'body', line: 3 },
          { type: 'api_key', value: 'sk-proj-...abc', field: 'body', line: 7 },
        ],
      }),
    };
    (getRemoteClient as any).mockReturnValue(mockClient);

    const result = await handler({ entry_id: 'entry-1' }, makeCtx(), {} as any);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('sensitive content');
    expect(text).toContain('email in body (line 3)');
    expect(text).toContain('api_key in body (line 7)');
    expect(text).toContain('force: true');
  });

  it('passes force: true through to the remote client', async () => {
    const mockClient = {
      publishToTeam: vi.fn().mockResolvedValue({
        ok: true,
        id: 'team-entry-1',
      }),
    };
    (getRemoteClient as any).mockReturnValue(mockClient);

    await handler({ entry_id: 'entry-1', force: true }, makeCtx(), {} as any);

    expect(mockClient.publishToTeam).toHaveBeenCalledWith(
      expect.objectContaining({ force: true })
    );
  });

  it('passes force: false when not set', async () => {
    const mockClient = {
      publishToTeam: vi.fn().mockResolvedValue({
        ok: true,
        id: 'team-entry-1',
      }),
    };
    (getRemoteClient as any).mockReturnValue(mockClient);

    await handler({ entry_id: 'entry-1' }, makeCtx(), {} as any);

    expect(mockClient.publishToTeam).toHaveBeenCalledWith(
      expect.objectContaining({ force: false })
    );
  });

  it('returns error for non-privacy 422 failures', async () => {
    const mockClient = {
      publishToTeam: vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        error: 'Some other validation error',
      }),
    };
    (getRemoteClient as any).mockReturnValue(mockClient);

    const result = await handler({ entry_id: 'entry-1' }, makeCtx(), {} as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to publish');
  });
});
