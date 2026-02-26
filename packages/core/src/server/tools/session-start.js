import { z } from "zod";
import { execSync } from "node:child_process";
import { ok, err, ensureVaultExists } from "../helpers.js";

const DEFAULT_MAX_TOKENS = 4000;
const RECENT_DAYS = 7;
const MAX_BODY_PER_ENTRY = 400;
const PRIORITY_KINDS = ["decision", "insight", "pattern"];
const SESSION_SUMMARY_KIND = "session";

export const name = "session_start";

export const description =
  "Auto-assemble a context brief for the current project on session start. Pulls recent entries, last session summary, and active decisions/blockers into a token-budgeted capsule formatted for agent consumption.";

export const inputSchema = {
  project: z
    .string()
    .optional()
    .describe(
      "Project name or tag to scope the brief. Auto-detected from cwd/git remote if not provided.",
    ),
  max_tokens: z
    .number()
    .optional()
    .describe(
      "Token budget for the capsule (rough estimate: 1 token ~ 4 chars). Default: 4000.",
    ),
};

function detectProject() {
  try {
    const remote = execSync("git remote get-url origin 2>/dev/null", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (remote) {
      const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) return match[1];
    }
  } catch {}

  try {
    const cwd = process.cwd();
    const parts = cwd.split(/[/\\]/);
    return parts[parts.length - 1];
  } catch {}

  return null;
}

function truncateBody(body, maxLen = MAX_BODY_PER_ENTRY) {
  if (!body) return "(no body)";
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + "...";
}

function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

function formatEntry(entry) {
  const tags = entry.tags ? JSON.parse(entry.tags) : [];
  const tagStr = tags.length ? tags.join(", ") : "none";
  const date = entry.updated_at || entry.created_at || "unknown";
  return [
    `- **${entry.title || "(untitled)"}** [${entry.kind}]`,
    `  tags: ${tagStr} | ${date} | id: \`${entry.id}\``,
    `  ${truncateBody(entry.body).replace(/\n+/g, " ").trim()}`,
  ].join("\n");
}

export async function handler({ project, max_tokens }, ctx, { ensureIndexed }) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  await ensureIndexed();

  const effectiveProject = project?.trim() || detectProject();
  const tokenBudget = max_tokens || DEFAULT_MAX_TOKENS;

  const sinceDate = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();

  const sections = [];
  let tokensUsed = 0;

  sections.push(
    `# Session Brief${effectiveProject ? ` — ${effectiveProject}` : ""}`,
  );
  sections.push(
    `_Generated ${new Date().toISOString().slice(0, 10)} | budget: ${tokenBudget} tokens_\n`,
  );
  tokensUsed += estimateTokens(sections.join("\n"));

  const lastSession = queryLastSession(ctx, userId, effectiveProject);
  if (lastSession) {
    const sessionBlock = [
      "## Last Session Summary",
      truncateBody(lastSession.body, 600),
      "",
    ].join("\n");
    const sessionTokens = estimateTokens(sessionBlock);
    if (tokensUsed + sessionTokens <= tokenBudget) {
      sections.push(sessionBlock);
      tokensUsed += sessionTokens;
    }
  }

  const decisions = queryByKinds(
    ctx,
    PRIORITY_KINDS,
    sinceDate,
    userId,
    effectiveProject,
  );
  if (decisions.length > 0) {
    const header = "## Active Decisions, Insights & Patterns\n";
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines = [];
      tokensUsed += headerTokens;
      for (const entry of decisions) {
        const line = formatEntry(entry);
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        entryLines.push(line);
        tokensUsed += lineTokens;
      }
      if (entryLines.length > 0) {
        sections.push(header + entryLines.join("\n") + "\n");
      }
    }
  }

  const recent = queryRecent(ctx, sinceDate, userId, effectiveProject);
  const seenIds = new Set(decisions.map((d) => d.id));
  if (lastSession) seenIds.add(lastSession.id);
  const deduped = recent.filter((r) => !seenIds.has(r.id));

  if (deduped.length > 0) {
    const header = `## Recent Entries (last ${RECENT_DAYS} days)\n`;
    const headerTokens = estimateTokens(header);
    if (tokensUsed + headerTokens <= tokenBudget) {
      const entryLines = [];
      tokensUsed += headerTokens;
      for (const entry of deduped) {
        const line = formatEntry(entry);
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        entryLines.push(line);
        tokensUsed += lineTokens;
      }
      if (entryLines.length > 0) {
        sections.push(header + entryLines.join("\n") + "\n");
      }
    }
  }

  const totalEntries =
    (lastSession ? 1 : 0) +
    decisions.length +
    deduped.filter((d) => {
      const line = formatEntry(d);
      return true;
    }).length;

  sections.push("---");
  sections.push(
    `_${tokensUsed} / ${tokenBudget} tokens used | project: ${effectiveProject || "unscoped"}_`,
  );

  const result = ok(sections.join("\n"));
  result._meta = {
    project: effectiveProject || null,
    tokens_used: tokensUsed,
    tokens_budget: tokenBudget,
    sections: {
      last_session: lastSession ? 1 : 0,
      decisions: decisions.length,
      recent: deduped.length,
    },
  };
  return result;
}

function queryLastSession(ctx, userId, project) {
  const clauses = [`kind = '${SESSION_SUMMARY_KIND}'`];
  const params = [];

  if (userId !== undefined) {
    clauses.push("user_id = ?");
    params.push(userId);
  }
  clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
  clauses.push("superseded_by IS NULL");

  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = ctx.db
    .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT 5`)
    .all(...params);

  if (project) {
    const match = rows.find((r) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return tags.includes(project);
    });
    if (match) return match;
  }
  return rows[0] || null;
}

function queryByKinds(ctx, kinds, since, userId, project) {
  const kindPlaceholders = kinds.map(() => "?").join(",");
  const clauses = [`kind IN (${kindPlaceholders})`];
  const params = [...kinds];

  clauses.push("created_at >= ?");
  params.push(since);

  if (userId !== undefined) {
    clauses.push("user_id = ?");
    params.push(userId);
  }
  clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
  clauses.push("superseded_by IS NULL");

  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = ctx.db
    .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT 50`)
    .all(...params);

  if (project) {
    const tagged = rows.filter((r) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return tags.includes(project);
    });
    if (tagged.length > 0) return tagged;
  }
  return rows;
}

function queryRecent(ctx, since, userId, project) {
  const clauses = ["created_at >= ?"];
  const params = [since];

  if (userId !== undefined) {
    clauses.push("user_id = ?");
    params.push(userId);
  }
  clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
  clauses.push("superseded_by IS NULL");

  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = ctx.db
    .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT 50`)
    .all(...params);

  if (project) {
    const tagged = rows.filter((r) => {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      return tags.includes(project);
    });
    if (tagged.length > 0) return tagged;
  }
  return rows;
}
