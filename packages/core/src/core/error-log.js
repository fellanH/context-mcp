import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const MAX_LOG_SIZE = 1024 * 1024; // 1MB

export function errorLogPath(dataDir) {
  return join(dataDir, "error.log");
}

/**
 * Append a structured JSON entry to the startup error log.
 * Rotates the file if it exceeds MAX_LOG_SIZE.
 * Never throws — logging failures must not mask the original error.
 *
 * @param {string} dataDir
 * @param {object} entry
 */
export function appendErrorLog(dataDir, entry) {
  try {
    mkdirSync(dataDir, { recursive: true });
    const logPath = errorLogPath(dataDir);
    if (existsSync(logPath) && statSync(logPath).size >= MAX_LOG_SIZE) {
      writeFileSync(logPath, "");
    }
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // intentionally swallowed
  }
}

/**
 * Return number of log lines in the error log, or 0 if absent.
 *
 * @param {string} dataDir
 * @returns {number}
 */
export function errorLogCount(dataDir) {
  try {
    const logPath = errorLogPath(dataDir);
    if (!existsSync(logPath)) return 0;
    return readFileSync(logPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}
