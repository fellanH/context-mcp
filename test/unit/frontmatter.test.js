import { describe, it, expect } from "vitest";
import {
  formatFrontmatter,
  parseFrontmatter,
  extractCustomMeta,
} from "@context-vault/core/core/frontmatter";

describe("formatFrontmatter + parseFrontmatter roundtrip", () => {
  it("roundtrips simple scalar fields", () => {
    const meta = {
      id: "01ABC",
      source: "claude-code",
      created: "2026-01-01T00:00:00Z",
    };
    const formatted = formatFrontmatter(meta);
    const { meta: parsed } = parseFrontmatter(formatted + "\nSome body text");
    expect(parsed.id).toBe("01ABC");
    expect(parsed.source).toBe("claude-code");
    expect(parsed.created).toBe("2026-01-01T00:00:00Z");
  });

  it("roundtrips array fields (tags)", () => {
    const meta = { id: "01ABC", tags: ["react", "hooks", "performance"] };
    const formatted = formatFrontmatter(meta);
    const { meta: parsed } = parseFrontmatter(formatted + "\nBody");
    expect(parsed.tags).toEqual(["react", "hooks", "performance"]);
  });

  it("roundtrips empty tags array", () => {
    const meta = { id: "01ABC", tags: [] };
    const formatted = formatFrontmatter(meta);
    const { meta: parsed } = parseFrontmatter(formatted + "\nBody");
    expect(parsed.tags).toEqual([]);
  });

  it("preserves body content", () => {
    const meta = { id: "01ABC" };
    const bodyText = "This is the body.\n\nWith multiple paragraphs.";
    const formatted = formatFrontmatter(meta) + "\n" + bodyText;
    const { body } = parseFrontmatter(formatted);
    expect(body).toBe(bodyText);
  });

  it("quotes strings with special characters", () => {
    const meta = { id: "01ABC", source: "http://example.com:3000" };
    const formatted = formatFrontmatter(meta);
    expect(formatted).toContain('"http://example.com:3000"');
    const { meta: parsed } = parseFrontmatter(formatted + "\nBody");
    expect(parsed.source).toBe("http://example.com:3000");
  });

  it("skips null and undefined values", () => {
    const meta = { id: "01ABC", title: null, source: undefined, tags: ["a"] };
    const formatted = formatFrontmatter(meta);
    expect(formatted).not.toContain("title");
    expect(formatted).not.toContain("source");
    expect(formatted).toContain("tags");
  });
});

describe("parseFrontmatter", () => {
  it("returns empty meta and full body when no frontmatter", () => {
    const { meta, body } = parseFrontmatter("Just plain text");
    expect(meta).toEqual({});
    expect(body).toBe("Just plain text");
  });
});

describe("extractCustomMeta", () => {
  it("extracts non-reserved keys", () => {
    const fm = {
      id: "01ABC",
      tags: ["a"],
      source: "test",
      language: "js",
      status: "accepted",
    };
    const custom = extractCustomMeta(fm);
    expect(custom).toEqual({ language: "js", status: "accepted" });
  });

  it("returns null when no custom keys", () => {
    const fm = {
      id: "01ABC",
      tags: ["a"],
      source: "test",
      created: "2026-01-01",
    };
    expect(extractCustomMeta(fm)).toBeNull();
  });
});
