/**
 * Unit tests for encryption module.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encrypt,
  decrypt,
  encryptEntry,
  decryptEntry,
} from "../../packages/hosted/src/encryption/crypto.js";
import {
  deriveKey,
  generateDek,
  decryptDek,
} from "../../packages/hosted/src/encryption/keys.js";

describe("AES-256-GCM encrypt/decrypt", () => {
  const key = randomBytes(32);

  it("roundtrips simple text", () => {
    const plaintext = "Hello, encrypted world!";
    const { encrypted, iv } = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, iv, key);
    expect(decrypted).toBe(plaintext);
  });

  it("roundtrips empty string", () => {
    const { encrypted, iv } = encrypt("", key);
    expect(decrypt(encrypted, iv, key)).toBe("");
  });

  it("roundtrips unicode text", () => {
    const text =
      "Encrypted vault entry with unicode: \u00e4\u00f6\u00fc\u00df \ud83d\ude80 \u65e5\u672c\u8a9e";
    const { encrypted, iv } = encrypt(text, key);
    expect(decrypt(encrypted, iv, key)).toBe(text);
  });

  it("roundtrips large text", () => {
    const text = "x".repeat(100000);
    const { encrypted, iv } = encrypt(text, key);
    expect(decrypt(encrypted, iv, key)).toBe(text);
  });

  it("fails with wrong key", () => {
    const { encrypted, iv } = encrypt("secret", key);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(encrypted, iv, wrongKey)).toThrow();
  });

  it("fails with tampered ciphertext", () => {
    const { encrypted, iv } = encrypt("secret", key);
    encrypted[0] ^= 0xff; // flip a byte
    expect(() => decrypt(encrypted, iv, key)).toThrow();
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const text = "same text";
    const r1 = encrypt(text, key);
    const r2 = encrypt(text, key);
    expect(r1.iv).not.toEqual(r2.iv);
    expect(r1.encrypted).not.toEqual(r2.encrypted);
  });
});

describe("entry encryption", () => {
  const key = randomBytes(32);

  it("encrypts and decrypts a full entry", () => {
    const entry = {
      title: "Test Decision",
      body: "We decided to use AES-256-GCM for encryption.",
      meta: { language: "js", status: "accepted" },
    };

    const encrypted = encryptEntry(entry, key);
    expect(encrypted.body_encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.title_encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.meta_encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.iv).toBeInstanceOf(Buffer);
    expect(encrypted.iv.length).toBe(12);

    const decrypted = decryptEntry(encrypted, key);
    expect(decrypted.body).toBe(entry.body);
    expect(decrypted.title).toBe(entry.title);
    expect(decrypted.meta).toEqual(entry.meta);
  });

  it("handles entry without title", () => {
    const entry = { body: "Just a body" };
    const encrypted = encryptEntry(entry, key);
    expect(encrypted.title_encrypted).toBeNull();

    const decrypted = decryptEntry(encrypted, key);
    expect(decrypted.body).toBe("Just a body");
    expect(decrypted.title).toBeNull();
  });

  it("handles entry without meta", () => {
    const entry = { title: "No meta", body: "Body text" };
    const encrypted = encryptEntry(entry, key);
    expect(encrypted.meta_encrypted).toBeNull();

    const decrypted = decryptEntry(encrypted, key);
    expect(decrypted.meta).toBeNull();
  });
});

describe("key derivation", () => {
  it("derives consistent key from same password + salt", () => {
    const salt = randomBytes(16);
    const k1 = deriveKey("password123", salt);
    const k2 = deriveKey("password123", salt);
    expect(k1).toEqual(k2);
  });

  it("derives different keys from different passwords", () => {
    const salt = randomBytes(16);
    const k1 = deriveKey("password1", salt);
    const k2 = deriveKey("password2", salt);
    expect(k1).not.toEqual(k2);
  });

  it("derives different keys from different salts", () => {
    const s1 = randomBytes(16);
    const s2 = randomBytes(16);
    const k1 = deriveKey("same", s1);
    const k2 = deriveKey("same", s2);
    expect(k1).not.toEqual(k2);
  });
});

describe("DEK management", () => {
  const masterSecret = "test-master-secret-for-tests-only";

  it("generates and decrypts a DEK", () => {
    const { encryptedDek, dekSalt, dek } = generateDek(masterSecret);
    expect(dek.length).toBe(32);
    expect(encryptedDek.length).toBeGreaterThan(12); // IV + encrypted data

    const recovered = decryptDek(encryptedDek, dekSalt, masterSecret);
    expect(recovered).toEqual(dek);
  });

  it("fails to decrypt DEK with wrong master secret", () => {
    const { encryptedDek, dekSalt } = generateDek(masterSecret);
    expect(() => decryptDek(encryptedDek, dekSalt, "wrong-secret")).toThrow();
  });

  it("generates unique DEKs per call", () => {
    const r1 = generateDek(masterSecret);
    const r2 = generateDek(masterSecret);
    expect(r1.dek).not.toEqual(r2.dek);
    expect(r1.dekSalt).not.toEqual(r2.dekSalt);
  });
});
