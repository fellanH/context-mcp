import { describe, it, expect } from "vitest";
import {
  slugify,
  normalizeKind,
  kindToDir,
  dirToKind,
  kindToPath,
} from "@context-vault/core/core/files";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric with dashes", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("--test--")).toBe("test");
  });

  it("truncates to maxLen and breaks at dash boundary", () => {
    const long =
      "this-is-a-very-long-string-that-should-be-truncated-at-some-point-here";
    const result = slugify(long, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).not.toMatch(/-$/);
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  it("handles special characters", () => {
    expect(slugify("café & résumé")).toBe("caf-r-sum");
  });
});

describe("normalizeKind", () => {
  it("returns known singular kinds as-is", () => {
    expect(normalizeKind("insight")).toBe("insight");
    expect(normalizeKind("decision")).toBe("decision");
  });

  it("converts known plural forms to singular", () => {
    expect(normalizeKind("insights")).toBe("insight");
    expect(normalizeKind("decisions")).toBe("decision");
    expect(normalizeKind("patterns")).toBe("pattern");
  });

  it("returns unknown kinds as-is", () => {
    expect(normalizeKind("custom")).toBe("custom");
    expect(normalizeKind("foobar")).toBe("foobar");
  });
});

describe("kindToDir / dirToKind", () => {
  it("maps known kinds to plural directories", () => {
    expect(kindToDir("insight")).toBe("insights");
    expect(kindToDir("decision")).toBe("decisions");
  });

  it("maps known plural dirs back to singular kinds", () => {
    expect(dirToKind("insights")).toBe("insight");
    expect(dirToKind("decisions")).toBe("decision");
  });

  it("appends 's' for unknown kinds", () => {
    expect(kindToDir("custom")).toBe("customs");
  });
});

describe("kindToPath", () => {
  it("returns category/kind path", () => {
    expect(kindToPath("insight")).toBe("knowledge/insights");
    expect(kindToPath("contact")).toBe("entities/contacts");
    expect(kindToPath("session")).toBe("events/sessions");
  });
});
