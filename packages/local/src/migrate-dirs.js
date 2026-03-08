import {
  existsSync,
  readdirSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

export const PLURAL_TO_SINGULAR = {
  insights: 'insight',
  decisions: 'decision',
  patterns: 'pattern',
  statuses: 'status',
  analyses: 'analysis',
  contacts: 'contact',
  projects: 'project',
  tools: 'tool',
  sources: 'source',
  conversations: 'conversation',
  messages: 'message',
  sessions: 'session',
  logs: 'log',
  feedbacks: 'feedback',
  notes: 'note',
  prompts: 'prompt',
  documents: 'document',
  references: 'reference',
  tasks: 'task',
  buckets: 'bucket',
  architectures: 'architecture',
  briefs: 'brief',
  companies: 'company',
  discoveries: 'discovery',
  events: 'event',
  ideas: 'idea',
  issues: 'issue',
  agents: 'agent',
  'session-summaries': 'session-summary',
  'session-reviews': 'session-review',
  'user-prompts': 'user-prompt',
};

const CATEGORY_DIRS = ['knowledge', 'entities', 'events'];

function countMdFiles(dir) {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count += countMdFiles(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++;
      }
    }
  } catch {}
  return count;
}

export function planMigration(vaultDir) {
  const ops = [];

  for (const catName of CATEGORY_DIRS) {
    const catDir = join(vaultDir, catName);
    if (!existsSync(catDir) || !statSync(catDir).isDirectory()) continue;

    let entries;
    try {
      entries = readdirSync(catDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      const singular = PLURAL_TO_SINGULAR[dirName];
      if (!singular) continue;

      const pluralDir = join(catDir, dirName);
      const singularDir = join(catDir, singular);
      if (pluralDir === singularDir) continue;

      const fileCount = countMdFiles(pluralDir);
      const singularExists = existsSync(singularDir);

      ops.push({
        action: singularExists ? 'merge' : 'rename',
        pluralDir,
        singularDir,
        pluralName: dirName,
        singularName: singular,
        fileCount,
      });
    }
  }

  return ops;
}

function mergeDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      mergeDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      if (!existsSync(dstPath)) {
        copyFileSync(srcPath, dstPath);
      }
    }
  }
}

export function executeMigration(ops) {
  let renamed = 0;
  let merged = 0;
  const errors = [];

  for (const op of ops) {
    try {
      if (op.action === 'rename') {
        renameSync(op.pluralDir, op.singularDir);
        renamed++;
      } else {
        mergeDir(op.pluralDir, op.singularDir);
        rmSync(op.pluralDir, { recursive: true, force: true });
        merged++;
      }
    } catch (e) {
      errors.push(`${op.pluralName} → ${op.singularName}: ${e.message}`);
    }
  }

  return { renamed, merged, errors };
}
