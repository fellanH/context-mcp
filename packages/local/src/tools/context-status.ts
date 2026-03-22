import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gatherVaultStatus, computeGrowthWarnings } from '../status.js';
import { errorLogPath, errorLogCount } from '../error-log.js';
import { ok, err, kindIcon } from '../helpers.js';
import type { LocalCtx, ToolResult } from '../types.js';

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
}

export const name = 'context_status';

export const description =
  'Show vault health: resolved config, file counts per kind, database size, and any issues. Use to verify setup or troubleshoot. Call this when a user asks about their vault or to debug search issues.';

export const inputSchema = {};

export function handler(_args: Record<string, any>, ctx: LocalCtx): ToolResult {
  try {
    const { config } = ctx;

    const status = gatherVaultStatus(ctx);

    const hasIssues = status.stalePaths || (status.embeddingStatus?.missing ?? 0) > 0;
    const healthIcon = hasIssues ? '⚠' : '✓';

    const schemaVersion = (ctx.db.prepare('PRAGMA user_version').get() as any)?.user_version ?? 'unknown';
    const embedPct = status.embeddingStatus
      ? (status.embeddingStatus.total > 0 ? Math.round((status.embeddingStatus.indexed / status.embeddingStatus.total) * 100) : 100)
      : null;
    const embedStr = status.embeddingStatus
      ? `${status.embeddingStatus.indexed}/${status.embeddingStatus.total} (${embedPct}%)`
      : 'n/a';
    const modelStr = status.embedModelAvailable === false ? '⚠ unavailable' : status.embedModelAvailable === true ? '✓ loaded' : 'unknown';

    const lines = [
      `## ${healthIcon} Vault Dashboard`,
      ``,
      `| | |`,
      `|---|---|`,
      `| **Vault** | ${config.vaultDir} (${config.vaultDirExists ? status.fileCount + ' files' : '⚠ missing'}) |`,
      `| **Database** | ${config.dbPath} (${status.dbSize}) |`,
      `| **Schema** | v${schemaVersion} |`,
      `| **Embeddings** | ${embedStr} |`,
      `| **Model** | ${modelStr} |`,
      `| **Event decay** | ${config.eventDecayDays} days |`,
    ];
    if (status.expiredCount > 0) {
      lines.push(`| **Expired** | ${status.expiredCount} pending prune |`);
    }

    // Indexed kinds as compact table
    lines.push(``, `### Indexed`);
    if (status.kindCounts.length) {
      lines.push('| Kind | Count |');
      lines.push('|---|---|');
      for (const { kind, c } of status.kindCounts) {
        lines.push(`| ${kindIcon(kind)} \`${kind}\` | ${c} |`);
      }
    } else {
      lines.push(`_(empty vault)_`);
    }

    if (status.categoryCounts.length) {
      lines.push(``);
      lines.push(`### Categories`);
      for (const { category, c } of status.categoryCounts) lines.push(`- **${category}**: ${c}`);
    }

    if (status.subdirs.length) {
      lines.push(``);
      lines.push(`### Disk`);
      for (const { name, count } of status.subdirs) lines.push(`- \`${name}/\` ${count} files`);
    }

    if (status.stalePaths) {
      lines.push(``);
      lines.push(`### ⚠ Stale Paths`);
      lines.push(`DB contains ${status.staleCount} paths not matching current vault dir.`);
      lines.push(`Auto-reindex will fix this on next search or save.`);
    }

    if (status.staleKnowledge?.length > 0) {
      lines.push(``);
      lines.push(`### ⚠ Potentially Stale Knowledge`);
      lines.push(
        `Not updated within kind staleness window (pattern: 180d, decision: 365d, reference: 90d):`
      );
      for (const entry of status.staleKnowledge) {
        const lastUpdated = entry.last_updated ? entry.last_updated.split('T')[0] : 'unknown';
        lines.push(`- "${entry.title}" (${entry.kind}) — last updated ${lastUpdated}`);
      }
      lines.push(`Use save_context to refresh or add expires_at to retire stale entries.`);
    }

    // Error log
    const logPath = errorLogPath(config.dataDir);
    const logCount = errorLogCount(config.dataDir);
    if (logCount > 0) {
      lines.push(``, `### Startup Error Log`);
      lines.push(`- Path: ${logPath}`);
      lines.push(`- Entries: ${logCount} (share this file for support)`);
    }

    // Last startup error
    const lastErrorPath = join(config.dataDir, '.last-error');
    if (existsSync(lastErrorPath)) {
      try {
        const lastError = readFileSync(lastErrorPath, 'utf-8').trim();
        lines.push(``, `### Last Startup Error`);
        lines.push(`\`\`\``);
        lines.push(lastError);
        lines.push(`\`\`\``);
      } catch {}
    }

    // Health: session-level tool call stats
    const ts = ctx.toolStats;
    if (ts) {
      lines.push(``, `### Health`);
      lines.push(`- Tool calls (session): ${ts.ok} ok, ${ts.errors} errors`);
      if (ts.lastError) {
        const { tool, code, timestamp } = ts.lastError;
        lines.push(`- Last error: ${tool ?? 'unknown'} — ${code} (${relativeTime(timestamp)})`);
      }
      if (status.autoCapturedFeedbackCount > 0) {
        lines.push(
          `- Auto-captured feedback entries: ${status.autoCapturedFeedbackCount} (run get_context with kind:feedback tags:auto-captured)`
        );
      }
    }

    // Growth warnings
    const growth = computeGrowthWarnings(status, config.thresholds);
    if (growth.hasWarnings) {
      lines.push('', '### ⚠ Vault Growth Warning');
      for (const w of growth.warnings) {
        lines.push(`  ${w.message}`);
      }
      if (growth.kindBreakdown.length) {
        lines.push('');
        lines.push('  Breakdown by kind:');
        for (const { kind, count, pct } of growth.kindBreakdown) {
          lines.push(`    ${kind}: ${count.toLocaleString()} (${pct}%)`);
        }
      }
      if (growth.actions.length) {
        lines.push('', 'Suggested growth actions:');
        for (const a of growth.actions) {
          lines.push(`  • ${a}`);
        }
      }
    }

    // Suggested actions
    const actions = [];
    if (status.stalePaths) actions.push('- Run `context-vault reindex` to fix stale paths');
    if ((status.embeddingStatus?.missing ?? 0) > 0)
      actions.push('- Run `context-vault reindex` to generate missing embeddings');
    if (!config.vaultDirExists)
      actions.push('- Run `context-vault setup` to create the vault directory');
    if (status.kindCounts.length === 0 && config.vaultDirExists)
      actions.push('- Use `save_context` to add your first entry');

    if (actions.length) {
      lines.push('', '### Suggested Actions', ...actions);
    }

    return ok(lines.join('\n'));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 'STATUS_FAILED');
  }
}
