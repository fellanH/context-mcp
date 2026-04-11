import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const MAX_LOG_SIZE = 1024 * 1024;

export function errorLogPath(dataDir: string): string {
  return join(dataDir, 'error.log');
}

export function appendErrorLog(dataDir: string, entry: Record<string, unknown>): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    const logPath = errorLogPath(dataDir);
    if (existsSync(logPath) && statSync(logPath).size >= MAX_LOG_SIZE) {
      writeFileSync(logPath, '');
    }
    appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // intentionally swallowed
  }
}

export function errorLogCount(dataDir: string): number {
  try {
    const logPath = errorLogPath(dataDir);
    if (!existsSync(logPath)) return 0;
    return readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/** Scan the tail of error.log for embedding-related lines (support + large-vault triage). */
export function embedRelatedLogTail(dataDir: string, maxBytes = 16_384, maxMatches = 8): string[] {
  try {
    const logPath = errorLogPath(dataDir);
    if (!existsSync(logPath)) return [];
    const size = statSync(logPath).size;
    let raw: string;
    if (size <= maxBytes) {
      raw = readFileSync(logPath, 'utf-8');
    } else {
      const buf = Buffer.alloc(maxBytes);
      const fd = openSync(logPath, 'r');
      try {
        readSync(fd, buf, 0, maxBytes, size - maxBytes);
      } finally {
        closeSync(fd);
      }
      raw = buf.toString('utf-8');
    }
    const embedRe = /\bembed(ding|dings)?\b/i;
    const lines = raw.split('\n').filter((l) => l.trim() && embedRe.test(l));
    return lines.slice(-maxMatches);
  } catch {
    return [];
  }
}
