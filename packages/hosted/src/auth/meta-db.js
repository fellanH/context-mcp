/**
 * meta-db.js — Shared meta database for users, API keys, and usage tracking.
 *
 * Uses better-sqlite3 (same driver as vault DB).
 * In production, this would be a Turso database shared across instances.
 * For now, uses a local SQLite file at ~/.context-mcp/meta.db.
 */

import Database from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";

const META_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    tier            TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    vault_db_url    TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    key_hash        TEXT UNIQUE NOT NULL,
    key_prefix      TEXT NOT NULL,
    name            TEXT NOT NULL DEFAULT 'default',
    scopes          TEXT DEFAULT '["*"]',
    last_used       TEXT,
    expires_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

  CREATE TABLE IF NOT EXISTS usage_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    operation       TEXT NOT NULL,
    timestamp       TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_log(user_id, timestamp);

  CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id     TEXT PRIMARY KEY,
    event_type   TEXT NOT NULL,
    processed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT PRIMARY KEY,
    count        INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    owner_id           TEXT NOT NULL REFERENCES users(id),
    tier               TEXT DEFAULT 'team',
    stripe_customer_id TEXT,
    created_at         TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id   TEXT NOT NULL REFERENCES teams(id),
    user_id   TEXT NOT NULL REFERENCES users(id),
    role      TEXT NOT NULL CHECK(role IN ('owner','admin','member')) DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS team_invites (
    id         TEXT PRIMARY KEY,
    team_id    TEXT NOT NULL REFERENCES teams(id),
    email      TEXT NOT NULL,
    invited_by TEXT NOT NULL REFERENCES users(id),
    token      TEXT UNIQUE NOT NULL,
    status     TEXT NOT NULL CHECK(status IN ('pending','accepted','expired')) DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token);
  CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email);
`;

let metaDb = null;
let metaDbPath = null;

/**
 * Initialize the meta database.
 * @param {string} dbPath
 * @returns {import("better-sqlite3").Database}
 */
export function initMetaDb(dbPath) {
  if (metaDb && metaDbPath === dbPath) return metaDb;
  // If called with a different path, invalidate cached statements
  if (metaDb && metaDbPath !== dbPath) {
    stmts = null;
  }
  metaDbPath = dbPath;
  metaDb = new Database(dbPath);
  metaDb.pragma("journal_mode = WAL");
  metaDb.pragma("foreign_keys = ON");
  metaDb.exec(META_SCHEMA);

  // Add DEK columns for at-rest encryption (idempotent)
  const cols = metaDb
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("encrypted_dek")) {
    metaDb.exec(`ALTER TABLE users ADD COLUMN encrypted_dek BLOB`);
  }
  if (!cols.includes("dek_salt")) {
    metaDb.exec(`ALTER TABLE users ADD COLUMN dek_salt BLOB`);
  }
  if (!cols.includes("google_id")) {
    metaDb.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`);
    metaDb.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL`,
    );
  }
  if (!cols.includes("encryption_mode")) {
    metaDb.exec(
      `ALTER TABLE users ADD COLUMN encryption_mode TEXT NOT NULL DEFAULT 'legacy'`,
    );
  }
  if (!cols.includes("client_key_share_hash")) {
    metaDb.exec(`ALTER TABLE users ADD COLUMN client_key_share_hash TEXT`);
  }

  return metaDb;
}

/**
 * Get the meta database instance.
 */
export function getMetaDb() {
  if (!metaDb)
    throw new Error("Meta DB not initialized. Call initMetaDb first.");
  return metaDb;
}

// ─── API Key Helpers ────────────────────────────────────────────────────────

/** Generate a new API key: cv_<random 40 hex chars> */
export function generateApiKey() {
  const raw = randomBytes(20).toString("hex");
  return `cv_${raw}`;
}

/** Hash an API key for storage (SHA-256). */
export function hashApiKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

/** Extract prefix for display: cv_abc1...ef23 */
export function keyPrefix(key) {
  return key.slice(0, 7) + "..." + key.slice(-4);
}

// ─── Prepared Statements ────────────────────────────────────────────────────

let stmts = null;

export function prepareMetaStatements(db) {
  if (stmts) return stmts;
  stmts = {
    // Users
    createUser: db.prepare(
      `INSERT INTO users (id, email, name, tier) VALUES (?, ?, ?, ?)`,
    ),
    getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
    updateUserTier: db.prepare(
      `UPDATE users SET tier = ?, updated_at = datetime('now') WHERE id = ?`,
    ),
    getUserByStripeCustomerId: db.prepare(
      `SELECT * FROM users WHERE stripe_customer_id = ?`,
    ),
    updateUserStripeId: db.prepare(
      `UPDATE users SET stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?`,
    ),

    getUserByGoogleId: db.prepare(`SELECT * FROM users WHERE google_id = ?`),
    createUserWithGoogle: db.prepare(
      `INSERT INTO users (id, email, name, tier, google_id) VALUES (?, ?, ?, ?, ?)`,
    ),

    // API Keys
    createApiKey: db.prepare(
      `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)`,
    ),
    getKeyByHash: db.prepare(
      `SELECT ak.*, u.tier, u.email, u.stripe_customer_id FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_hash = ?`,
    ),
    updateKeyLastUsed: db.prepare(
      `UPDATE api_keys SET last_used = datetime('now') WHERE id = ?`,
    ),
    listUserKeys: db.prepare(
      `SELECT id, key_prefix, name, scopes, last_used, expires_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    ),
    deleteApiKey: db.prepare(
      `DELETE FROM api_keys WHERE id = ? AND user_id = ?`,
    ),

    // Usage
    logUsage: db.prepare(
      `INSERT INTO usage_log (user_id, operation) VALUES (?, ?)`,
    ),
    countUsageToday: db.prepare(
      `SELECT COUNT(*) as c FROM usage_log WHERE user_id = ? AND operation = ? AND timestamp >= date('now')`,
    ),
    countEntries: db.prepare(
      `SELECT COUNT(*) as c FROM usage_log WHERE user_id = ? AND operation = 'save_context'`,
    ),

    // DEK (encryption)
    updateUserDek: db.prepare(
      `UPDATE users SET encrypted_dek = ?, dek_salt = ?, updated_at = datetime('now') WHERE id = ?`,
    ),
    updateUserDekSplitAuthority: db.prepare(
      `UPDATE users SET encrypted_dek = ?, dek_salt = ?, encryption_mode = 'split-authority', client_key_share_hash = ?, updated_at = datetime('now') WHERE id = ?`,
    ),
    getUserDekData: db.prepare(
      `SELECT encrypted_dek, dek_salt, encryption_mode FROM users WHERE id = ?`,
    ),

    // Account deletion
    deleteUserKeys: db.prepare(`DELETE FROM api_keys WHERE user_id = ?`),
    deleteUserUsage: db.prepare(`DELETE FROM usage_log WHERE user_id = ?`),
    deleteUser: db.prepare(`DELETE FROM users WHERE id = ?`),

    // Webhook idempotency
    getProcessedWebhook: db.prepare(
      `SELECT event_id FROM processed_webhooks WHERE event_id = ?`,
    ),
    insertProcessedWebhook: db.prepare(
      `INSERT INTO processed_webhooks (event_id, event_type) VALUES (?, ?)`,
    ),
    pruneOldWebhooks: db.prepare(
      `DELETE FROM processed_webhooks WHERE processed_at < datetime('now', '-7 days')`,
    ),

    // Rate limiting (persistent across restarts)
    checkRateLimit: db.prepare(
      `SELECT count, window_start FROM rate_limits WHERE key = ?`,
    ),
    upsertRateLimit: db.prepare(`
      INSERT INTO rate_limits (key, count, window_start)
      VALUES (?, 1, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        count = CASE
          WHEN datetime(window_start, '+1 hour') < datetime('now')
          THEN 1
          ELSE count + 1
        END,
        window_start = CASE
          WHEN datetime(window_start, '+1 hour') < datetime('now')
          THEN datetime('now')
          ELSE window_start
        END
    `),
    pruneRateLimits: db.prepare(
      `DELETE FROM rate_limits WHERE datetime(window_start, '+1 hour') < datetime('now')`,
    ),

    // Teams
    createTeam: db.prepare(
      `INSERT INTO teams (id, name, owner_id, tier, stripe_customer_id) VALUES (?, ?, ?, ?, ?)`,
    ),
    getTeamById: db.prepare(`SELECT * FROM teams WHERE id = ?`),
    getTeamsByUserId: db.prepare(`
      SELECT t.*, tm.role FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = ?
      ORDER BY t.created_at DESC
    `),
    updateTeam: db.prepare(`UPDATE teams SET name = ? WHERE id = ?`),
    deleteTeam: db.prepare(`DELETE FROM teams WHERE id = ?`),
    updateTeamStripeId: db.prepare(
      `UPDATE teams SET stripe_customer_id = ? WHERE id = ?`,
    ),

    // Team Members
    addTeamMember: db.prepare(
      `INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)`,
    ),
    getTeamMember: db.prepare(
      `SELECT * FROM team_members WHERE team_id = ? AND user_id = ?`,
    ),
    getTeamMembers: db.prepare(`
      SELECT tm.*, u.email, u.name FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
      ORDER BY tm.joined_at ASC
    `),
    updateMemberRole: db.prepare(
      `UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?`,
    ),
    removeTeamMember: db.prepare(
      `DELETE FROM team_members WHERE team_id = ? AND user_id = ?`,
    ),
    countTeamMembers: db.prepare(
      `SELECT COUNT(*) as c FROM team_members WHERE team_id = ?`,
    ),

    // Team Invites
    createTeamInvite: db.prepare(
      `INSERT INTO team_invites (id, team_id, email, invited_by, token, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    getInviteByToken: db.prepare(
      `SELECT * FROM team_invites WHERE token = ? AND status = 'pending'`,
    ),
    getInvitesByTeam: db.prepare(
      `SELECT * FROM team_invites WHERE team_id = ? ORDER BY created_at DESC`,
    ),
    getPendingInviteByEmail: db.prepare(
      `SELECT * FROM team_invites WHERE team_id = ? AND email = ? AND status = 'pending'`,
    ),
    updateInviteStatus: db.prepare(
      `UPDATE team_invites SET status = ? WHERE id = ?`,
    ),
    expireOldInvites: db.prepare(
      `UPDATE team_invites SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')`,
    ),
  };
  return stmts;
}

/**
 * Validate an API key and return the associated user+key info.
 * Returns null if invalid.
 */
export function validateApiKey(key) {
  if (!key || !key.startsWith("cv_")) return null;
  const hash = hashApiKey(key);
  const s = prepareMetaStatements(getMetaDb());
  const row = s.getKeyByHash.get(hash);
  if (!row) return null;

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Update last used (fire-and-forget)
  try {
    s.updateKeyLastUsed.run(row.id);
  } catch {}

  return {
    keyId: row.id,
    userId: row.user_id,
    email: row.email,
    tier: row.tier,
    scopes: JSON.parse(row.scopes || '["*"]'),
    stripeCustomerId: row.stripe_customer_id || null,
  };
}
