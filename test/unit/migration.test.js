/**
 * Unit tests for migration helpers (no network calls).
 *
 * Tests the extract/format logic used in migrateToHosted and migrateToLocal.
 */

import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  formatFrontmatter,
} from "@context-vault/core/core/frontmatter";
import { formatBody } from "@context-vault/core/capture/formatters";

describe("migration: extractCustomMeta", () => {
  const RESERVED_FM_KEYS = new Set([
    "id",
    "tags",
    "source",
    "created",
    "identity_key",
    "expires_at",
    "kind",
    "title",
  ]);

  function extractCustomMeta(meta) {
    const custom = {};
    for (const [k, v] of Object.entries(meta)) {
      if (!RESERVED_FM_KEYS.has(k)) custom[k] = v;
    }
    return Object.keys(custom).length ? custom : undefined;
  }

  it("extracts non-reserved keys as custom meta", () => {
    const meta = {
      id: "abc",
      tags: ["x"],
      language: "python",
      status: "accepted",
    };
    const custom = extractCustomMeta(meta);
    expect(custom).toEqual({ language: "python", status: "accepted" });
  });

  it("returns undefined when no custom keys", () => {
    const meta = {
      id: "abc",
      tags: ["x"],
      source: "test",
      created: "2026-01-01",
    };
    expect(extractCustomMeta(meta)).toBeUndefined();
  });

  it("handles empty meta", () => {
    expect(extractCustomMeta({})).toBeUndefined();
  });
});

describe("migration: guessKindFromPath", () => {
  function guessKindFromPath(filePath, vaultDir) {
    const rel = filePath.replace(vaultDir + "/", "");
    const parts = rel.split("/");
    if (parts.length >= 2) {
      const dirName = parts[parts.length - 2];
      return dirName.replace(/s$/, "");
    }
    return "insight";
  }

  it("extracts kind from directory name", () => {
    expect(
      guessKindFromPath("/vault/knowledge/decisions/my-decision.md", "/vault"),
    ).toBe("decision");
    expect(
      guessKindFromPath("/vault/knowledge/insights/my-insight.md", "/vault"),
    ).toBe("insight");
  });

  it("removes plural 's' from directory name", () => {
    expect(guessKindFromPath("/vault/decisions/foo.md", "/vault")).toBe(
      "decision",
    );
    expect(guessKindFromPath("/vault/notes/bar.md", "/vault")).toBe("note");
  });

  it("defaults to 'insight' for root-level files", () => {
    expect(guessKindFromPath("/vault/file.md", "/vault")).toBe("insight");
  });
});

describe("migration: roundtrip frontmatter for migrate-to-local", () => {
  it("creates valid frontmatter for a migrated entry", () => {
    const fm = {
      id: "01ABC",
      tags: ["test", "migration"],
      source: "migration",
      created: "2026-01-15T10:00:00Z",
    };
    const formatted = formatFrontmatter(fm);
    const { meta, body } = parseFrontmatter(
      formatted + "\nMigrated body content",
    );

    expect(meta.id).toBe("01ABC");
    expect(meta.tags).toEqual(["test", "migration"]);
    expect(meta.source).toBe("migration");
    expect(meta.created).toBe("2026-01-15T10:00:00Z");
    expect(body).toBe("Migrated body content");
  });

  it("preserves custom meta fields through roundtrip", () => {
    const fm = {
      id: "01DEF",
      tags: [],
      source: "sync-pull",
      created: "2026-02-01T00:00:00Z",
      language: "typescript",
      confidence: "high",
    };
    const formatted = formatFrontmatter(fm);
    const { meta } = parseFrontmatter(formatted + "\nBody");

    expect(meta.language).toBe("typescript");
    expect(meta.confidence).toBe("high");
  });

  it("handles identity_key and expires_at in frontmatter", () => {
    const fm = {
      id: "01GHI",
      identity_key: "user-pref-theme",
      expires_at: "2026-12-31T23:59:59Z",
      tags: [],
      source: "test",
      created: "2026-01-01T00:00:00Z",
    };
    const formatted = formatFrontmatter(fm);
    const { meta } = parseFrontmatter(formatted + "\nBody");

    expect(meta.identity_key).toBe("user-pref-theme");
    expect(meta.expires_at).toBe("2026-12-31T23:59:59Z");
  });
});

describe("migration: slug generation", () => {
  function generateSlug(title, body, id) {
    const slug = (title || body || "")
      .slice(0, 40)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const shortId = (id || "").slice(-8).toLowerCase();
    return slug ? `${slug}-${shortId}.md` : `${shortId}.md`;
  }

  it("generates filename from title", () => {
    expect(generateSlug("My Decision About SQLite", "", "01ABCDEFGH")).toBe(
      "my-decision-about-sqlite-abcdefgh.md",
    );
  });

  it("truncates long titles to 40 chars", () => {
    const longTitle = "A".repeat(60);
    const filename = generateSlug(longTitle, "", "01ABCDEFGH");
    const slugPart = filename.replace("-abcdefgh.md", "");
    expect(slugPart.length).toBeLessThanOrEqual(40);
  });

  it("falls back to ID-only filename when no title or body", () => {
    expect(generateSlug("", "", "01ABCDEFGH")).toBe("abcdefgh.md");
  });

  it("strips special characters from slugs", () => {
    expect(generateSlug("Hello, World! @#$%", "", "01ABCDEFGH")).toBe(
      "hello-world-abcdefgh.md",
    );
  });
});
