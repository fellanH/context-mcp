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
  it("returns kinds as-is (identity function)", () => {
    expect(normalizeKind("insight")).toBe("insight");
    expect(normalizeKind("decision")).toBe("decision");
    expect(normalizeKind("insights")).toBe("insights");
    expect(normalizeKind("decisions")).toBe("decisions");
    expect(normalizeKind("custom")).toBe("custom");
    expect(normalizeKind("foobar")).toBe("foobar");
  });
});

describe("kindToDir / dirToKind", () => {
  it("returns kind as directory name (no pluralization)", () => {
    expect(kindToDir("insight")).toBe("insight");
    expect(kindToDir("decision")).toBe("decision");
    expect(kindToDir("custom")).toBe("custom");
  });

  it("returns directory name as kind (identity)", () => {
    expect(dirToKind("insight")).toBe("insight");
    expect(dirToKind("decision")).toBe("decision");
  });
});

describe("kindToPath", () => {
  it("returns category/kind path using singular kind names", () => {
    expect(kindToPath("insight")).toBe("knowledge/insight");
    expect(kindToPath("contact")).toBe("entities/contact");
    expect(kindToPath("session")).toBe("events/session");
  });
});
