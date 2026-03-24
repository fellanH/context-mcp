import { z } from 'zod';
import { ok, err } from '../helpers.js';
import { getRemoteClient, getTeamId } from '../remote.js';
import type { LocalCtx, SharedCtx, ToolResult } from '../types.js';

export const name = 'publish_to_team';

export const description =
  'Publish a local vault entry to a team vault. Wraps the POST /api/vault/publish endpoint. Returns the published entry and any conflict advisory from the server.';

export const inputSchema = {
  entry_id: z
    .string()
    .describe('The ULID of the local entry to publish to the team vault.'),
  team_id: z
    .string()
    .optional()
    .describe('Team ID to publish to. Defaults to the teamId in remote config.'),
};

export async function handler(
  { entry_id, team_id }: Record<string, any>,
  ctx: LocalCtx,
  _shared: SharedCtx
): Promise<ToolResult> {
  const remoteClient = getRemoteClient(ctx.config);
  if (!remoteClient) {
    return err('Remote is not configured. Run `context-vault remote setup` first.', 'NOT_CONFIGURED');
  }

  const effectiveTeamId = team_id || getTeamId(ctx.config);
  if (!effectiveTeamId) {
    return err(
      'No team ID specified and none configured. Use `context-vault team join <team-id>` or pass team_id parameter.',
      'NO_TEAM'
    );
  }

  const existing = ctx.stmts.getEntryById.get(entry_id) as Record<string, any> | undefined;
  if (!existing) {
    return err(`Entry not found locally: ${entry_id}`, 'NOT_FOUND');
  }

  if (existing.category === 'event') {
    return err('Event entries cannot be published to team vaults (private by design).', 'FORBIDDEN');
  }

  const tags = existing.tags ? JSON.parse(existing.tags) : [];
  const meta = existing.meta ? JSON.parse(existing.meta) : {};

  const result = await remoteClient.publishToTeam({
    entryId: entry_id,
    teamId: effectiveTeamId,
    visibility: 'team',
    entry: {
      kind: existing.kind,
      title: existing.title,
      body: existing.body,
      tags,
      meta,
      source: existing.source,
      identity_key: existing.identity_key,
      tier: existing.tier,
      category: existing.category,
    },
  });

  if (!result.ok) {
    const parts = [`Failed to publish: ${result.error}`];
    if (result.conflict) {
      parts.push('');
      parts.push(`Conflict detected: similar entry by ${result.conflict.existing_author} (${(result.conflict.similarity * 100).toFixed(0)}% match)`);
      parts.push(`  Entry ID: ${result.conflict.existing_entry_id}`);
      parts.push(`  ${result.conflict.suggestion}`);
    }
    return err(parts.join('\n'), 'PUBLISH_FAILED');
  }

  const parts = [
    `## Published to team`,
    `Entry \`${entry_id}\` published to team \`${effectiveTeamId}\``,
  ];
  if (result.id) {
    parts.push(`Team entry ID: \`${result.id}\``);
  }
  if (result.conflict) {
    parts.push('');
    parts.push(`**Conflict advisory:** Similar entry by ${result.conflict.existing_author} (${(result.conflict.similarity * 100).toFixed(0)}% match)`);
    parts.push(`  Entry: \`${result.conflict.existing_entry_id}\``);
    parts.push(`  ${result.conflict.suggestion}`);
  }
  return ok(parts.join('\n'));
}
