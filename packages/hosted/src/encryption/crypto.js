/**
 * crypto.js — AES-256-GCM encryption for vault entry bodies.
 *
 * Design:
 *   - Uses Node.js built-in crypto (no external deps)
 *   - AES-256-GCM provides authenticated encryption
 *   - Each entry gets a unique 12-byte IV (nonce)
 *   - Auth tag is appended to the ciphertext
 *
 * What's encrypted:
 *   - body (always)
 *   - title (encrypted copy — plaintext kept for FTS)
 *   - meta (if present)
 *
 * What stays plaintext:
 *   - kind, category, tags, source, timestamps, identity_key (structural metadata)
 *   - title (for FTS — pragmatic trade-off)
 *   - embeddings (not reversible — semantic search still works)
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce size
const TAG_LENGTH = 16; // Auth tag length in bytes

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param {string} plaintext - Text to encrypt
 * @param {Buffer} key - 32-byte encryption key (DEK)
 * @returns {{ encrypted: Buffer, iv: Buffer }} - Encrypted buffer = ciphertext + auth tag; IV
 */
export function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { encrypted, iv };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 *
 * @param {Buffer} encrypted - Ciphertext + auth tag (last 16 bytes)
 * @param {Buffer} iv - 12-byte IV used during encryption
 * @param {Buffer} key - 32-byte encryption key (DEK)
 * @returns {string} - Decrypted plaintext
 */
export function decrypt(encrypted, iv, key) {
  const ciphertext = encrypted.subarray(0, encrypted.length - TAG_LENGTH);
  const authTag = encrypted.subarray(encrypted.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, null, "utf8") + decipher.final("utf8");
}

/**
 * Encrypt a vault entry's sensitive fields.
 * Returns new fields to merge with the entry row.
 *
 * @param {{ title?: string, body: string, meta?: object }} entry
 * @param {Buffer} key - 32-byte DEK
 * @returns {{ body_encrypted: Buffer, title_encrypted: Buffer|null, meta_encrypted: Buffer|null, iv: Buffer }}
 */
export function encryptEntry(entry, key) {
  // Body IV — stored in the `iv` column for decryption
  const iv = randomBytes(IV_LENGTH);
  const bodyCipher = createCipheriv(ALGORITHM, key, iv);
  const bodyEncrypted = Buffer.concat([
    bodyCipher.update(entry.body, "utf8"),
    bodyCipher.final(),
    bodyCipher.getAuthTag(),
  ]);

  // Encrypt title (if present)
  let titleEncrypted = null;
  if (entry.title) {
    const titleIv = randomBytes(IV_LENGTH);
    const titleCipher = createCipheriv(ALGORITHM, key, titleIv);
    titleEncrypted = Buffer.concat([
      titleIv, // prepend IV for title since it uses a different one
      titleCipher.update(entry.title, "utf8"),
      titleCipher.final(),
      titleCipher.getAuthTag(),
    ]);
  }

  // Encrypt meta (if present)
  let metaEncrypted = null;
  if (entry.meta && Object.keys(entry.meta).length > 0) {
    const metaStr = JSON.stringify(entry.meta);
    const metaIv = randomBytes(IV_LENGTH);
    const metaCipher = createCipheriv(ALGORITHM, key, metaIv);
    metaEncrypted = Buffer.concat([
      metaIv,
      metaCipher.update(metaStr, "utf8"),
      metaCipher.final(),
      metaCipher.getAuthTag(),
    ]);
  }

  return {
    body_encrypted: bodyEncrypted,
    title_encrypted: titleEncrypted,
    meta_encrypted: metaEncrypted,
    iv,
  };
}

/**
 * Decrypt a vault entry's sensitive fields.
 *
 * @param {{ body_encrypted: Buffer, title_encrypted: Buffer|null, meta_encrypted: Buffer|null, iv: Buffer }} row
 * @param {Buffer} key - 32-byte DEK
 * @returns {{ body: string, title: string|null, meta: object|null }}
 */
export function decryptEntry(row, key) {
  // Decrypt body
  const body = decrypt(row.body_encrypted, row.iv, key);

  // Decrypt title (IV prepended)
  let title = null;
  if (row.title_encrypted) {
    const titleIv = row.title_encrypted.subarray(0, IV_LENGTH);
    const titleData = row.title_encrypted.subarray(IV_LENGTH);
    title = decrypt(titleData, titleIv, key);
  }

  // Decrypt meta (IV prepended)
  let meta = null;
  if (row.meta_encrypted) {
    const metaIv = row.meta_encrypted.subarray(0, IV_LENGTH);
    const metaData = row.meta_encrypted.subarray(IV_LENGTH);
    meta = JSON.parse(decrypt(metaData, metaIv, key));
  }

  return { body, title, meta };
}
