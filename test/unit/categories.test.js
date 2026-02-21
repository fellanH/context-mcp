import { describe, it, expect } from "vitest";
import {
  categoryFor,
  categoryDirFor,
  CATEGORY_DIRS,
} from "@context-vault/core/core/categories";

describe("categoryFor", () => {
  it("returns knowledge for knowledge kinds", () => {
    expect(categoryFor("insight")).toBe("knowledge");
    expect(categoryFor("decision")).toBe("knowledge");
    expect(categoryFor("pattern")).toBe("knowledge");
    expect(categoryFor("reference")).toBe("knowledge");
  });

  it("returns entity for entity kinds", () => {
    expect(categoryFor("contact")).toBe("entity");
    expect(categoryFor("project")).toBe("entity");
    expect(categoryFor("tool")).toBe("entity");
    expect(categoryFor("source")).toBe("entity");
  });

  it("returns event for event kinds", () => {
    expect(categoryFor("conversation")).toBe("event");
    expect(categoryFor("session")).toBe("event");
    expect(categoryFor("log")).toBe("event");
  });

  it("defaults to knowledge for unknown kinds", () => {
    expect(categoryFor("custom")).toBe("knowledge");
    expect(categoryFor("foobar")).toBe("knowledge");
  });
});

describe("categoryDirFor", () => {
  it("returns correct directory names", () => {
    expect(categoryDirFor("insight")).toBe("knowledge");
    expect(categoryDirFor("contact")).toBe("entities");
    expect(categoryDirFor("session")).toBe("events");
  });
});

describe("CATEGORY_DIRS", () => {
  it("contains all category directory names", () => {
    expect(CATEGORY_DIRS.has("knowledge")).toBe(true);
    expect(CATEGORY_DIRS.has("entities")).toBe(true);
    expect(CATEGORY_DIRS.has("events")).toBe(true);
  });
});
