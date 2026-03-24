import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AutoMemoryEntry {
  file: string;
  name: string;
  description: string;
  type: string;
  body: string;
}

export interface AutoMemoryResult {
  detected: boolean;
  path: string | null;
  entries: AutoMemoryEntry[];
  linesUsed: number;
}

/**
 * Detect the Claude Code auto-memory directory for the current project.
 * Convention: ~/.claude/projects/-<cwd-with-slashes-replaced-by-dashes>/memory/
 */
export function detectAutoMemoryPath(): string | null {
  try {
    const cwd = process.cwd();
    const projectKey = cwd.replace(/\//g, '-');
    const memoryDir = join(homedir(), '.claude', 'projects', projectKey, 'memory');
    const memoryIndex = join(memoryDir, 'MEMORY.md');
    if (existsSync(memoryIndex)) return memoryDir;
  } catch {}
  return null;
}

/**
 * Parse YAML-ish frontmatter from a memory file.
 * Returns { name, description, type } and the body after frontmatter.
 */
export function parseMemoryFile(content: string): { name: string; description: string; type: string; body: string } {
  const result = { name: '', description: '', type: '', body: content };
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) return result;

  const frontmatter = fmMatch[1];
  result.body = fmMatch[2].trim();

  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (key === 'name') result.name = val.trim();
    else if (key === 'description') result.description = val.trim();
    else if (key === 'type') result.type = val.trim();
  }
  return result;
}

/**
 * Read and parse all auto-memory entries from a memory directory.
 */
export function readAutoMemory(memoryDir: string): AutoMemoryResult {
  const indexPath = join(memoryDir, 'MEMORY.md');
  let linesUsed = 0;

  try {
    const indexContent = readFileSync(indexPath, 'utf-8');
    linesUsed = indexContent.split('\n').length;
  } catch {
    return { detected: true, path: memoryDir, entries: [], linesUsed: 0 };
  }

  const entries: AutoMemoryEntry[] = [];

  try {
    const files = readdirSync(memoryDir).filter(
      (f) => f.endsWith('.md') && f !== 'MEMORY.md'
    );

    for (const file of files) {
      try {
        const content = readFileSync(join(memoryDir, file), 'utf-8');
        const parsed = parseMemoryFile(content);
        entries.push({
          file,
          name: parsed.name || file.replace('.md', ''),
          description: parsed.description,
          type: parsed.type,
          body: parsed.body,
        });
      } catch {}
    }
  } catch {}

  return { detected: true, path: memoryDir, entries, linesUsed };
}

/**
 * Resolve auto-memory path from explicit param or auto-detection.
 */
export function resolveAutoMemoryPath(explicitPath?: string): string | null {
  if (explicitPath?.trim()) {
    return existsSync(join(explicitPath.trim(), 'MEMORY.md')) ? explicitPath.trim() : null;
  }
  return detectAutoMemoryPath();
}

/**
 * Get auto-memory result: detect path and read entries.
 */
export function getAutoMemory(explicitPath?: string): AutoMemoryResult {
  const resolvedPath = resolveAutoMemoryPath(explicitPath);
  if (!resolvedPath) {
    return { detected: false, path: null, entries: [], linesUsed: 0 };
  }
  return readAutoMemory(resolvedPath);
}

/**
 * Check if a text is similar to any auto-memory entry body.
 * Returns matches above the given threshold (simple text comparison).
 * For real similarity, callers should use embeddings.
 */
export function findAutoMemoryOverlaps(
  autoMemory: AutoMemoryResult,
  text: string,
  threshold = 0.9
): Array<{ file: string; name: string; type: string; similarity: number }> {
  if (!autoMemory.detected || autoMemory.entries.length === 0) return [];

  const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalizedText) return [];

  const overlaps: Array<{ file: string; name: string; type: string; similarity: number }> = [];

  for (const entry of autoMemory.entries) {
    const entryText = [entry.name, entry.description, entry.body]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    if (!entryText) continue;

    // Simple token overlap similarity (Jaccard-like)
    const textTokens = new Set(normalizedText.split(' ').filter(w => w.length >= 3));
    const entryTokens = new Set(entryText.split(' ').filter(w => w.length >= 3));

    if (textTokens.size === 0 || entryTokens.size === 0) continue;

    let intersection = 0;
    for (const token of textTokens) {
      if (entryTokens.has(token)) intersection++;
    }
    const union = textTokens.size + entryTokens.size - intersection;
    const similarity = union > 0 ? intersection / union : 0;

    if (similarity >= threshold) {
      overlaps.push({
        file: entry.file,
        name: entry.name,
        type: entry.type,
        similarity,
      });
    }
  }

  return overlaps.sort((a, b) => b.similarity - a.similarity);
}
