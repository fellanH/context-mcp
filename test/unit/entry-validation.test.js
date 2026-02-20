import { describe, it, expect } from "vitest";
import {
  validateEntryInput,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_KIND_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_COUNT,
  MAX_META_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_IDENTITY_KEY_LENGTH,
  KIND_PATTERN,
} from "../../packages/hosted/src/validation/entry-validation.js";

// ─── Constants ────────────────────────────────────────────────────────────────

describe("validation constants", () => {
  it("MAX_BODY_LENGTH is 100KB", () => {
    expect(MAX_BODY_LENGTH).toBe(100 * 1024);
  });

  it("MAX_TITLE_LENGTH is 500", () => {
    expect(MAX_TITLE_LENGTH).toBe(500);
  });

  it("MAX_KIND_LENGTH is 64", () => {
    expect(MAX_KIND_LENGTH).toBe(64);
  });

  it("MAX_TAG_LENGTH is 100", () => {
    expect(MAX_TAG_LENGTH).toBe(100);
  });

  it("MAX_TAGS_COUNT is 20", () => {
    expect(MAX_TAGS_COUNT).toBe(20);
  });

  it("MAX_META_LENGTH is 10KB", () => {
    expect(MAX_META_LENGTH).toBe(10 * 1024);
  });

  it("MAX_SOURCE_LENGTH is 200", () => {
    expect(MAX_SOURCE_LENGTH).toBe(200);
  });

  it("MAX_IDENTITY_KEY_LENGTH is 200", () => {
    expect(MAX_IDENTITY_KEY_LENGTH).toBe(200);
  });

  it("KIND_PATTERN matches lowercase alphanumeric and hyphens", () => {
    expect(KIND_PATTERN.test("insight")).toBe(true);
    expect(KIND_PATTERN.test("my-kind")).toBe(true);
    expect(KIND_PATTERN.test("kind123")).toBe(true);
    expect(KIND_PATTERN.test("UPPER")).toBe(false);
    expect(KIND_PATTERN.test("has space")).toBe(false);
    expect(KIND_PATTERN.test("has_underscore")).toBe(false);
    expect(KIND_PATTERN.test("")).toBe(false);
  });
});

// ─── Valid inputs ─────────────────────────────────────────────────────────────

describe("validateEntryInput — valid inputs", () => {
  it("accepts minimal valid entry (kind + body)", () => {
    const result = validateEntryInput({ kind: "insight", body: "Some content" });
    expect(result).toBeNull();
  });

  it("accepts full valid entry with all fields", () => {
    const result = validateEntryInput({
      kind: "pattern",
      body: "Pattern description",
      title: "My Pattern",
      tags: ["react", "hooks"],
      meta: { language: "js" },
      source: "claude-code",
      identity_key: "unique-key-1",
    });
    expect(result).toBeNull();
  });

  it("accepts entry with null optional fields", () => {
    const result = validateEntryInput({
      kind: "insight",
      body: "Content",
      title: null,
      tags: null,
      meta: null,
      source: null,
      identity_key: null,
    });
    expect(result).toBeNull();
  });

  it("accepts entry with undefined optional fields", () => {
    const result = validateEntryInput({
      kind: "insight",
      body: "Content",
      title: undefined,
      tags: undefined,
    });
    expect(result).toBeNull();
  });

  it("accepts kind at exactly MAX_KIND_LENGTH", () => {
    const kind = "a".repeat(MAX_KIND_LENGTH);
    const result = validateEntryInput({ kind, body: "Content" });
    expect(result).toBeNull();
  });

  it("accepts title at exactly MAX_TITLE_LENGTH", () => {
    const title = "a".repeat(MAX_TITLE_LENGTH);
    const result = validateEntryInput({ kind: "insight", body: "Content", title });
    expect(result).toBeNull();
  });

  it("accepts body at exactly MAX_BODY_LENGTH", () => {
    const body = "a".repeat(MAX_BODY_LENGTH);
    const result = validateEntryInput({ kind: "insight", body });
    expect(result).toBeNull();
  });

  it("accepts exactly MAX_TAGS_COUNT tags", () => {
    const tags = Array.from({ length: MAX_TAGS_COUNT }, (_, i) => `tag-${i}`);
    const result = validateEntryInput({ kind: "insight", body: "Content", tags });
    expect(result).toBeNull();
  });

  it("accepts tag at exactly MAX_TAG_LENGTH", () => {
    const tag = "a".repeat(MAX_TAG_LENGTH);
    const result = validateEntryInput({ kind: "insight", body: "Content", tags: [tag] });
    expect(result).toBeNull();
  });

  it("accepts source at exactly MAX_SOURCE_LENGTH", () => {
    const source = "a".repeat(MAX_SOURCE_LENGTH);
    const result = validateEntryInput({ kind: "insight", body: "Content", source });
    expect(result).toBeNull();
  });

  it("accepts identity_key at exactly MAX_IDENTITY_KEY_LENGTH", () => {
    const identity_key = "a".repeat(MAX_IDENTITY_KEY_LENGTH);
    const result = validateEntryInput({ kind: "insight", body: "Content", identity_key });
    expect(result).toBeNull();
  });

  it("accepts empty tags array", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", tags: [] });
    expect(result).toBeNull();
  });
});

// ─── kind validation ──────────────────────────────────────────────────────────

describe("validateEntryInput — kind", () => {
  it("rejects missing kind when requireKind is true (default)", () => {
    const result = validateEntryInput({ body: "Content" });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/kind is required/);
  });

  it("allows missing kind when requireKind is false", () => {
    const result = validateEntryInput({ body: "Content" }, { requireKind: false });
    expect(result).toBeNull();
  });

  it("rejects empty string kind", () => {
    const result = validateEntryInput({ kind: "", body: "Content" });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });

  it("rejects kind with uppercase letters", () => {
    const result = validateEntryInput({ kind: "MyKind", body: "Content" });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/lowercase/);
  });

  it("rejects kind with underscores", () => {
    const result = validateEntryInput({ kind: "my_kind", body: "Content" });
    expect(result).not.toBeNull();
  });

  it("rejects kind with spaces", () => {
    const result = validateEntryInput({ kind: "my kind", body: "Content" });
    expect(result).not.toBeNull();
  });

  it("rejects kind exceeding MAX_KIND_LENGTH", () => {
    const kind = "a".repeat(MAX_KIND_LENGTH + 1);
    const result = validateEntryInput({ kind, body: "Content" });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });

  it("rejects non-string kind", () => {
    const result = validateEntryInput({ kind: 123, body: "Content" });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });

  it("validates kind even when requireKind is false if kind is provided", () => {
    const result = validateEntryInput({ kind: "INVALID", body: "Content" }, { requireKind: false });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/lowercase/);
  });
});

// ─── body validation ──────────────────────────────────────────────────────────

describe("validateEntryInput — body", () => {
  it("rejects missing body when requireBody is true (default)", () => {
    const result = validateEntryInput({ kind: "insight" });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/body is required/);
  });

  it("allows missing body when requireBody is false", () => {
    const result = validateEntryInput({ kind: "insight" }, { requireBody: false });
    expect(result).toBeNull();
  });

  it("rejects empty string body when requireBody is true", () => {
    const result = validateEntryInput({ kind: "insight", body: "" });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/body is required/);
  });

  it("rejects body exceeding MAX_BODY_LENGTH", () => {
    const body = "a".repeat(MAX_BODY_LENGTH + 1);
    const result = validateEntryInput({ kind: "insight", body });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/100KB/);
  });

  it("rejects non-string body", () => {
    const result = validateEntryInput({ kind: "insight", body: 123 });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });

  it("rejects array body", () => {
    const result = validateEntryInput({ kind: "insight", body: ["content"] });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });
});

// ─── title validation ─────────────────────────────────────────────────────────

describe("validateEntryInput — title", () => {
  it("accepts valid title", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", title: "My Title" });
    expect(result).toBeNull();
  });

  it("rejects title exceeding MAX_TITLE_LENGTH", () => {
    const title = "a".repeat(MAX_TITLE_LENGTH + 1);
    const result = validateEntryInput({ kind: "insight", body: "Content", title });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/500/);
  });

  it("rejects non-string title", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", title: 42 });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });

  it("accepts empty string title", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", title: "" });
    expect(result).toBeNull();
  });
});

// ─── tags validation ──────────────────────────────────────────────────────────

describe("validateEntryInput — tags", () => {
  it("rejects non-array tags", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", tags: "not-array" });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/array/);
  });

  it("rejects tags object instead of array", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", tags: { a: 1 } });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/array/);
  });

  it("rejects too many tags", () => {
    const tags = Array.from({ length: MAX_TAGS_COUNT + 1 }, (_, i) => `tag-${i}`);
    const result = validateEntryInput({ kind: "insight", body: "Content", tags });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/max.*20/i);
  });

  it("rejects non-string tag in array", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", tags: [123] });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/string/);
  });

  it("rejects tag exceeding MAX_TAG_LENGTH", () => {
    const longTag = "a".repeat(MAX_TAG_LENGTH + 1);
    const result = validateEntryInput({ kind: "insight", body: "Content", tags: [longTag] });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/100/);
  });

  it("accepts tags with empty strings", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", tags: [""] });
    expect(result).toBeNull();
  });
});

// ─── meta validation ──────────────────────────────────────────────────────────

describe("validateEntryInput — meta", () => {
  it("accepts valid meta object", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", meta: { key: "value" } });
    expect(result).toBeNull();
  });

  it("rejects oversized meta", () => {
    const meta = { data: "x".repeat(MAX_META_LENGTH) };
    const result = validateEntryInput({ kind: "insight", body: "Content", meta });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/10KB/);
  });

  it("accepts meta just under the limit", () => {
    // Create a meta object whose JSON serialization is just under the limit
    const padding = "x".repeat(MAX_META_LENGTH - 20);
    const meta = { d: padding };
    const result = validateEntryInput({ kind: "insight", body: "Content", meta });
    expect(result).toBeNull();
  });
});

// ─── source validation ────────────────────────────────────────────────────────

describe("validateEntryInput — source", () => {
  it("accepts valid source", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", source: "claude-code" });
    expect(result).toBeNull();
  });

  it("rejects source exceeding MAX_SOURCE_LENGTH", () => {
    const source = "a".repeat(MAX_SOURCE_LENGTH + 1);
    const result = validateEntryInput({ kind: "insight", body: "Content", source });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/200/);
  });

  it("rejects non-string source", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", source: 42 });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });

  it("accepts empty string source", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", source: "" });
    expect(result).toBeNull();
  });
});

// ─── identity_key validation ──────────────────────────────────────────────────

describe("validateEntryInput — identity_key", () => {
  it("accepts valid identity_key", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", identity_key: "my-key" });
    expect(result).toBeNull();
  });

  it("rejects identity_key exceeding MAX_IDENTITY_KEY_LENGTH", () => {
    const identity_key = "a".repeat(MAX_IDENTITY_KEY_LENGTH + 1);
    const result = validateEntryInput({ kind: "insight", body: "Content", identity_key });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/200/);
  });

  it("rejects non-string identity_key", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", identity_key: 123 });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });

  it("accepts empty string identity_key", () => {
    const result = validateEntryInput({ kind: "insight", body: "Content", identity_key: "" });
    expect(result).toBeNull();
  });
});

// ─── options behavior ─────────────────────────────────────────────────────────

describe("validateEntryInput — options", () => {
  it("defaults requireKind to true", () => {
    const result = validateEntryInput({ body: "Content" });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/kind is required/);
  });

  it("defaults requireBody to true", () => {
    const result = validateEntryInput({ kind: "insight" });
    expect(result).not.toBeNull();
    expect(result.error).toMatch(/body is required/);
  });

  it("both requireKind and requireBody can be false", () => {
    const result = validateEntryInput({}, { requireKind: false, requireBody: false });
    expect(result).toBeNull();
  });

  it("returns 400 status for all validation errors", () => {
    const errors = [
      validateEntryInput({ body: "c" }),                          // missing kind
      validateEntryInput({ kind: "insight" }),                    // missing body
      validateEntryInput({ kind: "UPPER", body: "c" }),           // invalid kind
      validateEntryInput({ kind: "insight", body: "c", title: 1 }), // invalid title type
      validateEntryInput({ kind: "insight", body: "c", tags: "str" }), // invalid tags type
    ];
    for (const err of errors) {
      expect(err).not.toBeNull();
      expect(err.status).toBe(400);
    }
  });
});
