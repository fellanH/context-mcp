/**
 * user-db.js — LRU connection pool for per-user SQLite databases.
 *
 * Each user gets their own vault.db + vault/ directory under /data/users/{userId}/.
 * This module manages the connection lifecycle:
 *   - get(userId): returns cached connection or creates a new one
 *   - evict(userId): WAL checkpoint + close
 *   - closeAll(): shutdown all connections
 *   - sweepIdle(): close connections idle > 10 minutes
 *
 * The pool is bounded by USER_DB_POOL_SIZE (default 100).
 * When at capacity, the least-recently-used connection is evicted.
 */

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  initDatabase,
  prepareStatements,
  insertVec,
  deleteVec,
} from "@context-vault/core/index/db";

const MAX_POOL_SIZE = parseInt(process.env.USER_DB_POOL_SIZE || "100", 10);
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SWEEP_INTERVAL_MS = 60 * 1000; // check every minute

/** Base directory for per-user data. */
const DATA_DIR =
  process.env.CONTEXT_VAULT_DATA_DIR ||
  process.env.CONTEXT_MCP_DATA_DIR ||
  "/data";

/** Get the directory for a specific user's data. */
export function getUserDir(userId) {
  return join(DATA_DIR, "users", userId);
}

/** Get the path to a user's vault.db file. */
export function getUserDbPath(userId) {
  return join(getUserDir(userId), "vault.db");
}

/** Get the path to a user's vault/ markdown directory. */
export function getUserVaultDir(userId) {
  return join(getUserDir(userId), "vault");
}

/**
 * @typedef {object} PoolEntry
 * @property {import("better-sqlite3").Database} db
 * @property {object} stmts
 * @property {Function} insertVec
 * @property {Function} deleteVec
 * @property {number} lastAccess - timestamp of last get()
 */

class UserDbPool {
  /** @type {Map<string, PoolEntry>} */
  #pool = new Map();
  #sweepTimer = null;

  constructor() {
    this.#sweepTimer = setInterval(() => this.sweepIdle(), SWEEP_INTERVAL_MS);
    this.#sweepTimer.unref(); // don't keep process alive
  }

  /**
   * Get or create a per-user database connection.
   *
   * @param {string} userId
   * @returns {Promise<PoolEntry>}
   */
  async get(userId) {
    const existing = this.#pool.get(userId);
    if (existing) {
      existing.lastAccess = Date.now();
      // Move to end of Map for LRU ordering
      this.#pool.delete(userId);
      this.#pool.set(userId, existing);
      return existing;
    }

    // Evict LRU if at capacity
    if (this.#pool.size >= MAX_POOL_SIZE) {
      const [oldestKey] = this.#pool.keys();
      this.evict(oldestKey);
    }

    // Create user directory structure
    const userDir = getUserDir(userId);
    const vaultDir = getUserVaultDir(userId);
    mkdirSync(userDir, { recursive: true });
    mkdirSync(vaultDir, { recursive: true });

    // Initialize database
    const dbPath = getUserDbPath(userId);
    const db = await initDatabase(dbPath);
    const stmts = prepareStatements(db);

    const entry = {
      db,
      stmts,
      insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
      deleteVec: (rowid) => deleteVec(stmts, rowid),
      lastAccess: Date.now(),
    };

    this.#pool.set(userId, entry);
    return entry;
  }

  /**
   * Evict a user's connection from the pool.
   * WAL checkpoints before closing for data durability.
   *
   * @param {string} userId
   */
  evict(userId) {
    const entry = this.#pool.get(userId);
    if (!entry) return;

    try {
      entry.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {}
    try {
      entry.db.close();
    } catch {}
    this.#pool.delete(userId);
  }

  /**
   * Close all connections (for graceful shutdown).
   */
  closeAll() {
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }

    for (const [userId] of this.#pool) {
      this.evict(userId);
    }
  }

  /**
   * Evict connections that have been idle longer than IDLE_TIMEOUT_MS.
   */
  sweepIdle() {
    const now = Date.now();
    for (const [userId, entry] of this.#pool) {
      if (now - entry.lastAccess > IDLE_TIMEOUT_MS) {
        this.evict(userId);
      }
    }
  }

  /** Number of currently open connections. */
  get size() {
    return this.#pool.size;
  }

  /** Check if a user has an open connection. */
  has(userId) {
    return this.#pool.has(userId);
  }
}

/** Singleton pool instance. */
export const pool = new UserDbPool();
