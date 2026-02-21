/**
 * vault-crypto.js — Bridge between vault entry format and encrypted DB storage.
 *
 * Connects the entry-level data flow with the low-level crypto primitives
 * (crypto.js) and key management (keys.js).
 *
 * Supports two encryption modes:
 *   - legacy: server-only master secret (existing users)
 *   - split-authority: server + client secret required (new users)
 */

import { encryptEntry, decryptEntry } from "./crypto.js";
import { getUserDek, getUserDekAuto } from "./keys.js";
import { prepareMetaStatements, getMetaDb } from "../auth/meta-db.js";

/**
 * Encrypt an entry's sensitive fields for database storage.
 *
 * @param {{ title?: string, body: string, meta?: object }} entry
 * @param {string} userId
 * @param {string} masterSecret
 * @param {string|null} [clientKeyShare] - User's encryption secret (for split-authority)
 * @returns {{ body_encrypted: Buffer, title_encrypted: Buffer|null, meta_encrypted: Buffer|null, iv: Buffer }}
 */
export function encryptForStorage(entry, userId, masterSecret, clientKeyShare) {
  const dek = getDekForUser(userId, masterSecret, clientKeyShare);
  return encryptEntry(entry, dek);
}

/**
 * Decrypt encrypted fields from a database row.
 * Returns plaintext fields. If the row is not encrypted, returns plaintext as-is.
 *
 * @param {{ body_encrypted?: Buffer, title_encrypted?: Buffer, meta_encrypted?: Buffer, iv?: Buffer, body: string, title?: string, meta?: string }} row
 * @param {string} userId
 * @param {string} masterSecret
 * @param {string|null} [clientKeyShare] - User's encryption secret (for split-authority)
 * @returns {{ body: string, title: string|null, meta: object|null }}
 */
export function decryptFromStorage(row, userId, masterSecret, clientKeyShare) {
  if (!row.body_encrypted) {
    // Not encrypted — return plaintext fields
    return {
      body: row.body,
      title: row.title || null,
      meta: row.meta
        ? typeof row.meta === "string"
          ? JSON.parse(row.meta)
          : row.meta
        : null,
    };
  }

  const dek = getDekForUser(userId, masterSecret, clientKeyShare);
  return decryptEntry(row, dek);
}

/**
 * Get the DEK for a user from the meta DB.
 * Automatically handles legacy vs split-authority modes.
 *
 * @param {string} userId
 * @param {string} masterSecret
 * @param {string|null} [clientKeyShare]
 * @returns {Buffer} - 32-byte DEK
 */
function getDekForUser(userId, masterSecret, clientKeyShare) {
  const stmts = prepareMetaStatements(getMetaDb());
  const dekData = stmts.getUserDekData.get(userId);
  if (!dekData?.encrypted_dek || !dekData?.dek_salt) {
    throw new Error(
      `No encryption key found for user ${userId}. Was the user registered with VAULT_MASTER_SECRET set?`,
    );
  }

  const encryptionMode = dekData.encryption_mode || "legacy";

  return getUserDekAuto(
    userId,
    dekData.encrypted_dek,
    dekData.dek_salt,
    masterSecret,
    clientKeyShare || null,
    encryptionMode,
  );
}
