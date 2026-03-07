import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import { ulid, slugify, kindToPath } from "./files.js";
import { categoryFor, defaultTierFor } from "./categories.js";
import { parseFrontmatter, formatFrontmatter } from "./frontmatter.js";
import { formatBody } from "./formatters.js";
import type {
  BaseCtx,
  CaptureInput,
  CaptureResult,
  IndexEntryInput,
} from "./types.js";
import { indexEntry } from "./index.js";

function safeFolderPath(
  vaultDir: string,
  kind: string,
  folder?: string | null,
): string {
  const base = resolve(vaultDir, kindToPath(kind));
  if (!folder) return base;
  const resolved = resolve(base, folder);
  const rel = relative(base, resolved);
  if (rel.startsWith("..") || resolve(base, rel) !== resolved) {
    throw new Error(`Folder path escapes vault: "${folder}"`);
  }
  return resolved;
}

function writeEntryFile(
  vaultDir: string,
  kind: string,
  params: {
    id: string;
    title?: string | null;
    body: string;
    meta?: Record<string, unknown> | null;
    tags?: string[] | null;
    source?: string | null;
    createdAt: string;
    updatedAt: string;
    folder?: string | null;
    category: string;
    identity_key?: string | null;
    expires_at?: string | null;
    supersedes?: string[] | null;
    related_to?: string[] | null;
  },
): string {
  const resolvedFolder = params.folder || (params.meta?.folder as string) || "";
  const dir = safeFolderPath(vaultDir, kind, resolvedFolder);

  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new Error(
      `Failed to create directory "${dir}": ${(e as Error).message}`,
    );
  }

  const created = params.createdAt || new Date().toISOString();
  const fmFields: Record<string, unknown> = { id: params.id };

  if (params.meta) {
    for (const [k, v] of Object.entries(params.meta)) {
      if (k === "folder") continue;
      if (v !== null && v !== undefined) fmFields[k] = v;
    }
  }

  if (params.identity_key) fmFields.identity_key = params.identity_key;
  if (params.expires_at) fmFields.expires_at = params.expires_at;
  if (params.supersedes?.length) fmFields.supersedes = params.supersedes;
  if (params.related_to?.length) fmFields.related_to = params.related_to;
  fmFields.tags = params.tags || [];
  fmFields.source = params.source || "claude-code";
  fmFields.created = created;
  if (params.updatedAt && params.updatedAt !== created)
    fmFields.updated = params.updatedAt;

  const mdBody = formatBody(kind, {
    title: params.title || undefined,
    body: params.body,
    meta: params.meta || undefined,
  });

  let filename: string;
  if (params.category === "entity" && params.identity_key) {
    const identitySlug = slugify(params.identity_key);
    filename = identitySlug
      ? `${identitySlug}.md`
      : `${params.id.slice(-8).toLowerCase()}.md`;
  } else {
    const slug = slugify((params.title || params.body).slice(0, 40));
    const shortId = params.id.slice(-8).toLowerCase();
    filename = slug ? `${slug}-${shortId}.md` : `${shortId}.md`;
  }

  const filePath = resolve(dir, filename);
  const md = formatFrontmatter(fmFields) + mdBody;

  try {
    writeFileSync(filePath, md);
  } catch (e) {
    throw new Error(
      `Failed to write entry file "${filePath}": ${(e as Error).message}`,
    );
  }

  return filePath;
}

export function writeEntry(ctx: BaseCtx, data: CaptureInput): CaptureResult {
  if (!data.kind || typeof data.kind !== "string") {
    throw new Error("writeEntry: kind is required (non-empty string)");
  }
  if (!data.body || typeof data.body !== "string" || !data.body.trim()) {
    throw new Error("writeEntry: body is required (non-empty string)");
  }
  if (data.tags != null && !Array.isArray(data.tags)) {
    throw new Error("writeEntry: tags must be an array if provided");
  }
  if (data.meta != null && typeof data.meta !== "object") {
    throw new Error("writeEntry: meta must be an object if provided");
  }

  const category = categoryFor(data.kind);

  let id: string;
  let createdAt: string;
  let updatedAt: string;
  if (category === "entity" && data.identity_key) {
    const identitySlug = slugify(data.identity_key);
    const dir = resolve(ctx.config.vaultDir, kindToPath(data.kind));
    const existingPath = resolve(dir, `${identitySlug}.md`);

    if (existsSync(existingPath)) {
      const raw = readFileSync(existingPath, "utf-8");
      const { meta: fmMeta } = parseFrontmatter(raw);
      id = (fmMeta.id as string) || ulid();
      createdAt = (fmMeta.created as string) || new Date().toISOString();
      updatedAt = new Date().toISOString();
    } else {
      id = ulid();
      createdAt = new Date().toISOString();
      updatedAt = createdAt;
    }
  } else {
    id = ulid();
    createdAt = new Date().toISOString();
    updatedAt = createdAt;
  }

  const filePath = writeEntryFile(ctx.config.vaultDir, data.kind, {
    id,
    title: data.title,
    body: data.body,
    meta: data.meta,
    tags: data.tags,
    source: data.source,
    createdAt,
    updatedAt,
    folder: data.folder,
    category,
    identity_key: data.identity_key,
    expires_at: data.expires_at,
    supersedes: data.supersedes,
    related_to: data.related_to,
  });

  return {
    id,
    filePath,
    kind: data.kind,
    category,
    title: data.title || null,
    body: data.body,
    meta: data.meta || undefined,
    tags: data.tags || null,
    source: data.source || null,
    createdAt,
    updatedAt,
    identity_key: data.identity_key || null,
    expires_at: data.expires_at || null,
    supersedes: data.supersedes || null,
    related_to: data.related_to || null,
    source_files: data.source_files || null,
    tier: data.tier || null,
  };
}

export function updateEntryFile(
  ctx: BaseCtx,
  existing: Record<string, unknown>,
  updates: {
    title?: string | null;
    body?: string | null;
    tags?: string[] | null;
    meta?: Record<string, unknown> | null;
    source?: string | null;
    expires_at?: string | null;
    supersedes?: string[] | null;
    related_to?: string[] | null;
    source_files?: Array<{ path: string; hash: string }> | null;
  },
): IndexEntryInput & {
  supersedes?: string[] | null;
  related_to?: string[] | null;
} {
  const raw = readFileSync(existing.file_path as string, "utf-8");
  const { meta: fmMeta } = parseFrontmatter(raw);

  const existingMeta = existing.meta ? JSON.parse(existing.meta as string) : {};
  const existingTags = existing.tags ? JSON.parse(existing.tags as string) : [];
  const existingRelatedTo = existing.related_to
    ? JSON.parse(existing.related_to as string)
    : (fmMeta.related_to as string[]) || null;

  const title =
    updates.title !== undefined
      ? updates.title
      : (existing.title as string | null);
  const body =
    updates.body !== undefined
      ? (updates.body as string)
      : (existing.body as string);
  const tags = updates.tags !== undefined ? updates.tags : existingTags;
  const source =
    updates.source !== undefined
      ? updates.source
      : (existing.source as string | null);
  const expires_at =
    updates.expires_at !== undefined
      ? updates.expires_at
      : (existing.expires_at as string | null);
  const supersedes =
    updates.supersedes !== undefined
      ? updates.supersedes
      : (fmMeta.supersedes as string[]) || null;
  const related_to =
    updates.related_to !== undefined ? updates.related_to : existingRelatedTo;
  const source_files =
    updates.source_files !== undefined
      ? updates.source_files
      : existing.source_files
        ? JSON.parse(existing.source_files as string)
        : null;

  let mergedMeta: Record<string, unknown>;
  if (updates.meta !== undefined) {
    mergedMeta = { ...existingMeta, ...(updates.meta || {}) };
  } else {
    mergedMeta = { ...existingMeta };
  }

  const now = new Date().toISOString();
  const fmFields: Record<string, unknown> = { id: existing.id };
  for (const [k, v] of Object.entries(mergedMeta)) {
    if (k === "folder") continue;
    if (v !== null && v !== undefined) fmFields[k] = v;
  }
  if (existing.identity_key) fmFields.identity_key = existing.identity_key;
  if (expires_at) fmFields.expires_at = expires_at;
  if (supersedes?.length) fmFields.supersedes = supersedes;
  if (related_to?.length) fmFields.related_to = related_to;
  fmFields.tags = tags;
  fmFields.source = source || "claude-code";
  fmFields.created =
    (fmMeta.created as string) || (existing.created_at as string);
  if (now !== fmFields.created) fmFields.updated = now;

  const mdBody = formatBody(existing.kind as string, {
    title: title || undefined,
    body,
    meta: mergedMeta,
  });
  const md = formatFrontmatter(fmFields) + mdBody;

  writeFileSync(existing.file_path as string, md);

  const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

  return {
    id: existing.id as string,
    filePath: existing.file_path as string,
    kind: existing.kind as string,
    category: existing.category as string,
    title: title || null,
    body,
    meta: finalMeta,
    tags,
    source,
    createdAt: (fmMeta.created as string) || (existing.created_at as string),
    identity_key: (existing.identity_key as string) || null,
    expires_at: expires_at || null,
    supersedes,
    related_to: related_to || null,
    source_files: source_files || null,
    tier: (existing.tier as string) || null,
  };
}

export async function captureAndIndex(
  ctx: BaseCtx,
  data: CaptureInput,
  precomputedEmbedding?: Float32Array | null,
): Promise<CaptureResult> {
  let previousContent: string | null = null;
  if (categoryFor(data.kind) === "entity" && data.identity_key) {
    const identitySlug = slugify(data.identity_key);
    const dir = resolve(ctx.config.vaultDir, kindToPath(data.kind));
    const existingPath = resolve(dir, `${identitySlug}.md`);
    if (existsSync(existingPath)) {
      previousContent = readFileSync(existingPath, "utf-8");
    }
  }

  const entry = writeEntry(ctx, data);
  try {
    await indexEntry(ctx, entry, precomputedEmbedding);
    if (entry.supersedes?.length && ctx.stmts.updateSupersededBy) {
      for (const supersededId of entry.supersedes) {
        if (typeof supersededId === "string" && supersededId.trim()) {
          ctx.stmts.updateSupersededBy.run(entry.id, supersededId.trim());
        }
      }
    }
    if (entry.related_to?.length && ctx.stmts.updateRelatedTo) {
      ctx.stmts.updateRelatedTo.run(JSON.stringify(entry.related_to), entry.id);
    }
    return entry;
  } catch (err) {
    if (previousContent) {
      try {
        writeFileSync(entry.filePath, previousContent);
      } catch {}
    } else {
      try {
        unlinkSync(entry.filePath);
      } catch {}
    }
    throw new Error(
      `Capture succeeded but indexing failed — file rolled back. ${(err as Error).message}`,
    );
  }
}
