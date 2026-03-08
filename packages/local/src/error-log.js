import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const MAX_LOG_SIZE = 1024 * 1024;

export function errorLogPath(dataDir) {
  return join(dataDir, 'error.log');
}

export function appendErrorLog(dataDir, entry) {
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

export function errorLogCount(dataDir) {
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
