import { readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { categoryDirFor } from "./categories.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(): string {
  const now = Date.now();
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[t & 31] + ts;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand += CROCKFORD[Math.floor(Math.random() * 32)];
  }
  return ts + rand;
}

export function slugify(text: string, maxLen = 60): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > maxLen) {
    slug =
      slug.slice(0, maxLen).replace(/-[^-]*$/, "") || slug.slice(0, maxLen);
  }
  return slug;
}

export function kindToDir(kind: string): string {
  return kind;
}

export function dirToKind(dirName: string): string {
  return dirName;
}

export function normalizeKind(input: string): string {
  return input;
}

export function kindToPath(kind: string): string {
  return `${categoryDirFor(kind)}/${kindToDir(kind)}`;
}

export function safeJoin(base: string, ...parts: string[]): string {
  const resolvedBase = resolve(base);
  const result = resolve(join(base, ...parts));
  if (!result.startsWith(resolvedBase + sep) && result !== resolvedBase) {
    throw new Error(
      `Path traversal blocked: resolved path escapes base directory`,
    );
  }
  return result;
}

export interface WalkResult {
  filePath: string;
  relDir: string;
}

export function walkDir(dir: string): WalkResult[] {
  const results: WalkResult[] = [];
  function walk(currentDir: string, relDir: string) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith("_")) {
        walk(fullPath, relDir ? join(relDir, entry.name) : entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push({ filePath: fullPath, relDir });
      }
    }
  }
  walk(dir, "");
  return results;
}
