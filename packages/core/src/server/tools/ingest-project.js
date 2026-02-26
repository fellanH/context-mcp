import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { captureAndIndex } from "../../capture/index.js";
import { ok, err, ensureVaultExists } from "../helpers.js";

export const name = "ingest_project";

export const description =
  "Scan a local project directory and register it as a project entity in the vault. Extracts metadata from package.json, git history, and README. Also creates a bucket entity for project-scoped tagging.";

export const inputSchema = {
  path: z.string().describe("Absolute path to the project directory to ingest"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Additional tags to apply (bucket tags are auto-generated)"),
  pillar: z
    .string()
    .optional()
    .describe("Parent pillar/domain name — creates a bucket:pillar tag"),
};

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function safeExec(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function detectTechStack(projectPath, pkgJson) {
  const stack = [];

  if (existsSync(join(projectPath, "pyproject.toml")) || existsSync(join(projectPath, "setup.py"))) {
    stack.push("python");
  }
  if (existsSync(join(projectPath, "Cargo.toml"))) {
    stack.push("rust");
  }
  if (existsSync(join(projectPath, "go.mod"))) {
    stack.push("go");
  }
  if (pkgJson) {
    stack.push("javascript");
    const allDeps = {
      ...(pkgJson.dependencies || {}),
      ...(pkgJson.devDependencies || {}),
    };
    if (allDeps.typescript || existsSync(join(projectPath, "tsconfig.json"))) {
      stack.push("typescript");
    }
    if (allDeps.react || allDeps["react-dom"]) stack.push("react");
    if (allDeps.next || allDeps["next"]) stack.push("nextjs");
    if (allDeps.vue) stack.push("vue");
    if (allDeps.svelte) stack.push("svelte");
    if (allDeps.express) stack.push("express");
    if (allDeps.fastify) stack.push("fastify");
    if (allDeps.hono) stack.push("hono");
    if (allDeps.vite) stack.push("vite");
    if (allDeps.electron) stack.push("electron");
    if (allDeps.tauri || allDeps["@tauri-apps/api"]) stack.push("tauri");
  }

  return [...new Set(stack)];
}

function extractReadmeDescription(projectPath) {
  const raw = safeRead(join(projectPath, "README.md")) || safeRead(join(projectPath, "readme.md"));
  if (!raw) return null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed.slice(0, 200);
  }
  return null;
}

function buildProjectBody({ projectName, description, techStack, repoUrl, lastCommit, projectPath, hasClaudeMd }) {
  const lines = [];
  lines.push(`## ${projectName}`);
  if (description) lines.push("", description);
  lines.push("", "### Metadata");
  lines.push(`- **Path**: \`${projectPath}\``);
  if (repoUrl) lines.push(`- **Repo**: ${repoUrl}`);
  if (techStack.length) lines.push(`- **Stack**: ${techStack.join(", ")}`);
  if (lastCommit) lines.push(`- **Last commit**: ${lastCommit}`);
  lines.push(`- **CLAUDE.md**: ${hasClaudeMd ? "yes" : "no"}`);
  return lines.join("\n");
}

/**
 * @param {object} args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} ctx
 * @param {import('../types.js').ToolShared} shared
 */
export async function handler({ path: projectPath, tags, pillar }, ctx, { ensureIndexed }) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  if (!projectPath?.trim()) {
    return err("Required: path (absolute path to project directory)", "INVALID_INPUT");
  }
  if (!existsSync(projectPath)) {
    return err(`Directory not found: ${projectPath}`, "INVALID_INPUT");
  }

  await ensureIndexed();

  // Read package.json if present
  let pkgJson = null;
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
    } catch {
      pkgJson = null;
    }
  }

  // Derive project name
  let projectName = basename(projectPath);
  if (pkgJson?.name) {
    projectName = pkgJson.name.replace(/^@[^/]+\//, "");
  }

  // Slug-safe identity_key
  const identityKey = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  // Description: package.json > README
  const description =
    pkgJson?.description || extractReadmeDescription(projectPath) || null;

  // Tech stack detection
  const techStack = detectTechStack(projectPath, pkgJson);

  // Git metadata
  const isGitRepo = existsSync(join(projectPath, ".git"));
  const repoUrl = isGitRepo
    ? safeExec("git remote get-url origin", projectPath)
    : null;
  const lastCommit = isGitRepo
    ? safeExec("git log -1 --format=%ci", projectPath)
    : null;

  // CLAUDE.md presence
  const hasClaudeMd = existsSync(join(projectPath, "CLAUDE.md"));

  // Build tags
  const bucketTag = `bucket:${identityKey}`;
  const autoTags = [bucketTag];
  if (pillar) autoTags.push(`bucket:${pillar}`);
  const allTags = [...new Set([...autoTags, ...(tags || [])])];

  // Build body
  const body = buildProjectBody({
    projectName,
    description,
    techStack,
    repoUrl,
    lastCommit,
    projectPath,
    hasClaudeMd,
  });

  // Build meta
  const meta = {
    path: projectPath,
    ...(repoUrl ? { repo_url: repoUrl } : {}),
    ...(techStack.length ? { tech_stack: techStack } : {}),
    has_claude_md: hasClaudeMd,
  };

  // Save project entity
  const projectEntry = await captureAndIndex(ctx, {
    kind: "project",
    title: projectName,
    body,
    tags: allTags,
    identity_key: identityKey,
    meta,
    userId,
  });

  // Save bucket entity if it doesn't already exist
  const bucketUserClause = userId !== undefined ? "AND user_id = ?" : "";
  const bucketParams = userId !== undefined ? [bucketTag, userId] : [bucketTag];
  const bucketExists = ctx.db
    .prepare(
      `SELECT 1 FROM vault WHERE kind = 'bucket' AND identity_key = ? ${bucketUserClause} LIMIT 1`,
    )
    .get(...bucketParams);

  let bucketEntry = null;
  if (!bucketExists) {
    bucketEntry = await captureAndIndex(ctx, {
      kind: "bucket",
      title: projectName,
      body: `Bucket for project: ${projectName}`,
      tags: allTags,
      identity_key: bucketTag,
      meta: { project_path: projectPath },
      userId,
    });
  }

  const relPath = projectEntry.filePath
    ? projectEntry.filePath.replace(config.vaultDir + "/", "")
    : projectEntry.filePath;

  const parts = [
    `✓ Ingested project → ${relPath}`,
    `  id: ${projectEntry.id}`,
    `  title: ${projectEntry.title}`,
    `  tags: ${allTags.join(", ")}`,
    ...(techStack.length ? [`  stack: ${techStack.join(", ")}`] : []),
    ...(repoUrl ? [`  repo: ${repoUrl}`] : []),
  ];

  if (bucketEntry) {
    const bucketRelPath = bucketEntry.filePath
      ? bucketEntry.filePath.replace(config.vaultDir + "/", "")
      : bucketEntry.filePath;
    parts.push(``, `✓ Created bucket → ${bucketRelPath}`);
    parts.push(`  id: ${bucketEntry.id}`);
  } else {
    parts.push(``, `  (bucket '${bucketTag}' already exists — skipped)`);
  }

  parts.push("", "_Use get_context with bucket tag to retrieve project-scoped entries._");
  return ok(parts.join("\n"));
}
