import { gatherVaultStatus } from "../../core/status.js";
import { ok } from "../helpers.js";

function relativeTime(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
}

export const name = "context_status";

export const description =
  "Show vault health: resolved config, file counts per kind, database size, and any issues. Use to verify setup or troubleshoot. Call this when a user asks about their vault or to debug search issues.";

export const inputSchema = {};

/**
 * @param {object} _args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} ctx
 */
export function handler(_args, ctx) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const status = gatherVaultStatus(ctx, { userId });

  const hasIssues = status.stalePaths || status.embeddingStatus?.missing > 0;
  const healthIcon = hasIssues ? "⚠" : "✓";

  const lines = [
    `## ${healthIcon} Vault Status (connected)`,
    ``,
    `Vault:     ${config.vaultDir} (${config.vaultDirExists ? status.fileCount + " files" : "missing"})`,
    `Database:  ${config.dbPath} (${status.dbSize})`,
    `Dev dir:   ${config.devDir}`,
    `Data dir:  ${config.dataDir}`,
    `Config:    ${config.configPath}`,
    `Resolved via: ${status.resolvedFrom}`,
    `Schema:    v7 (teams)`,
  ];

  if (status.embeddingStatus) {
    const { indexed, total, missing } = status.embeddingStatus;
    const pct = total > 0 ? Math.round((indexed / total) * 100) : 100;
    lines.push(`Embeddings: ${indexed}/${total} (${pct}%)`);
  }
  if (status.embedModelAvailable === false) {
    lines.push(
      `Embed model: unavailable (semantic search disabled, FTS still works)`,
    );
  } else if (status.embedModelAvailable === true) {
    lines.push(`Embed model: loaded`);
  }
  lines.push(`Decay:     ${config.eventDecayDays} days (event recency window)`);
  if (status.expiredCount > 0) {
    lines.push(
      `Expired:   ${status.expiredCount} entries (pruned on next reindex)`,
    );
  }

  lines.push(``, `### Indexed`);

  if (status.kindCounts.length) {
    for (const { kind, c } of status.kindCounts) lines.push(`- ${c} ${kind}s`);
  } else {
    lines.push(`- (empty)`);
  }

  if (status.categoryCounts.length) {
    lines.push(``);
    lines.push(`### Categories`);
    for (const { category, c } of status.categoryCounts)
      lines.push(`- ${category}: ${c}`);
  }

  if (status.subdirs.length) {
    lines.push(``);
    lines.push(`### Disk Directories`);
    for (const { name, count } of status.subdirs)
      lines.push(`- ${name}/: ${count} files`);
  }

  if (status.stalePaths) {
    lines.push(``);
    lines.push(`### ⚠ Stale Paths`);
    lines.push(
      `DB contains ${status.staleCount} paths not matching current vault dir.`,
    );
    lines.push(`Auto-reindex will fix this on next search or save.`);
  }

  // Health: session-level tool call stats
  const ts = ctx.toolStats;
  if (ts) {
    lines.push(``, `### Health`);
    lines.push(`- Tool calls (session): ${ts.ok} ok, ${ts.errors} errors`);
    if (ts.lastError) {
      const { tool, code, timestamp } = ts.lastError;
      lines.push(
        `- Last error: ${tool ?? "unknown"} — ${code} (${relativeTime(timestamp)})`,
      );
    }
    if (status.autoCapturedFeedbackCount > 0) {
      lines.push(
        `- Auto-captured feedback entries: ${status.autoCapturedFeedbackCount} (run get_context with kind:feedback tags:auto-captured)`,
      );
    }
  }

  // Suggested actions
  const actions = [];
  if (status.stalePaths)
    actions.push("- Run `context-vault reindex` to fix stale paths");
  if (status.embeddingStatus?.missing > 0)
    actions.push(
      "- Run `context-vault reindex` to generate missing embeddings",
    );
  if (!config.vaultDirExists)
    actions.push("- Run `context-vault setup` to create the vault directory");
  if (status.kindCounts.length === 0 && config.vaultDirExists)
    actions.push("- Use `save_context` to add your first entry");

  if (actions.length) {
    lines.push("", "### Suggested Actions", ...actions);
  }

  return ok(lines.join("\n"));
}
