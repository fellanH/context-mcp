import { describe, it, expect } from "vitest";
import {
  detectFormat,
  parseMarkdown,
  parseCsv,
  parseJson,
  parseText,
  parseFile,
} from "@context-vault/core/capture/importers";

// ─── detectFormat ────────────────────────────────────────────────────────────

describe("detectFormat", () => {
  it("detects .md files as markdown", () => {
    expect(detectFormat("notes.md")).toBe("markdown");
    expect(detectFormat("README.markdown")).toBe("markdown");
  });

  it("detects .csv and .tsv files", () => {
    expect(detectFormat("data.csv")).toBe("csv");
    expect(detectFormat("data.tsv")).toBe("tsv");
  });

  it("detects .json files", () => {
    expect(detectFormat("entries.json")).toBe("json");
    expect(detectFormat("data.jsonl")).toBe("json");
  });

  it("falls back to text for unknown extensions", () => {
    expect(detectFormat("notes.txt")).toBe("text");
    expect(detectFormat("file.log")).toBe("text");
  });

  it("uses content heuristics when extension is ambiguous", () => {
    expect(detectFormat("file.txt", "---\ntitle: test\n---\nBody")).toBe(
      "markdown",
    );
    expect(detectFormat("file.txt", '[{"kind":"insight"}]')).toBe("json");
    expect(detectFormat("file.txt", '{"entries":[]}')).toBe("json");
  });
});

// ─── parseMarkdown ───────────────────────────────────────────────────────────

describe("parseMarkdown", () => {
  it("parses a markdown file with frontmatter", () => {
    const content = `---
id: TEST123
tags: ["react", "hooks"]
source: manual
---
This is the body content.`;

    const entries = parseMarkdown(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toBe("This is the body content.");
    expect(entries[0].tags).toEqual(["react", "hooks"]);
    expect(entries[0].source).toBe("manual");
  });

  it("uses opts.kind when frontmatter has no kind", () => {
    const content = `---
id: TEST
---
Body text`;

    const entries = parseMarkdown(content, { kind: "decision" });
    expect(entries[0].kind).toBe("decision");
  });

  it("defaults to insight kind", () => {
    const entries = parseMarkdown("Just plain text, no frontmatter");
    expect(entries[0].kind).toBe("insight");
    expect(entries[0].body).toBe("Just plain text, no frontmatter");
  });
});

// ─── parseCsv ────────────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("parses CSV with recognized columns", () => {
    const content = `kind,title,body,tags,source
insight,Test Title,Test body content,"react,hooks",manual`;

    const entries = parseCsv(content, ",");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("insight");
    expect(entries[0].title).toBe("Test Title");
    expect(entries[0].body).toBe("Test body content");
    expect(entries[0].tags).toEqual(["react", "hooks"]);
    expect(entries[0].source).toBe("manual");
  });

  it("puts unknown columns into meta", () => {
    const content = `title,body,language,framework
Test,Body text,javascript,react`;

    const entries = parseCsv(content, ",");
    expect(entries).toHaveLength(1);
    expect(entries[0].meta).toEqual({
      language: "javascript",
      framework: "react",
    });
  });

  it("handles quoted fields with commas", () => {
    const content = `title,body
"Title with, comma","Body with, comma and ""quotes"""`;

    const entries = parseCsv(content, ",");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Title with, comma");
    expect(entries[0].body).toBe('Body with, comma and "quotes"');
  });

  it("skips rows with no body", () => {
    const content = `title,body
Has body,Some content
No body,`;

    const entries = parseCsv(content, ",");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Has body");
  });

  it("returns empty for header-only CSV", () => {
    expect(parseCsv("title,body", ",")).toHaveLength(0);
  });

  it("applies default kind from opts", () => {
    const content = `title,body
Test,Content`;

    const entries = parseCsv(content, ",", { kind: "pattern" });
    expect(entries[0].kind).toBe("pattern");
  });

  it("parses TSV with tab delimiter", () => {
    const content = "title\tbody\nTest\tContent";
    const entries = parseCsv(content, "\t");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Test");
  });
});

// ─── parseJson ───────────────────────────────────────────────────────────────

describe("parseJson", () => {
  it("parses array-of-entries", () => {
    const content = JSON.stringify([
      { kind: "insight", title: "Test", body: "Body" },
      { kind: "decision", title: "Dec", body: "Rationale" },
    ]);

    const entries = parseJson(content);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("insight");
    expect(entries[1].kind).toBe("decision");
  });

  it("parses { entries: [...] } wrapper", () => {
    const content = JSON.stringify({
      entries: [{ kind: "pattern", body: "Code snippet" }],
    });

    const entries = parseJson(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("pattern");
  });

  it("skips entries without body", () => {
    const content = JSON.stringify([
      { kind: "insight", body: "Has body" },
      { kind: "insight", title: "No body" },
    ]);

    const entries = parseJson(content);
    expect(entries).toHaveLength(1);
  });

  it("returns empty for invalid JSON", () => {
    expect(parseJson("not json")).toHaveLength(0);
  });

  it("applies default kind from opts", () => {
    const content = JSON.stringify([{ body: "Content" }]);
    const entries = parseJson(content, { kind: "reference" });
    expect(entries[0].kind).toBe("reference");
  });

  it("detects ChatGPT export format", () => {
    const content = JSON.stringify([
      {
        title: "Test Conversation",
        create_time: 1700000000,
        id: "conv-123",
        mapping: {
          "msg-1": {
            message: {
              author: { role: "assistant" },
              content: { parts: ["Hello, world!"] },
            },
          },
          "msg-2": {
            message: {
              author: { role: "user" },
              content: { parts: ["Hi"] },
            },
          },
        },
      },
    ]);

    const entries = parseJson(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("conversation");
    expect(entries[0].title).toBe("Test Conversation");
    expect(entries[0].body).toContain("Hello, world!");
    expect(entries[0].tags).toContain("chatgpt-import");
  });
});

// ─── parseText ───────────────────────────────────────────────────────────────

describe("parseText", () => {
  it("creates entry from plain text file", () => {
    const entries = parseText("Some plain text content", "/notes/my-note.txt");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("My Note");
    expect(entries[0].body).toBe("Some plain text content");
    expect(entries[0].kind).toBe("insight");
  });

  it("returns empty for blank content", () => {
    expect(parseText("", "empty.txt")).toHaveLength(0);
    expect(parseText("   \n  ", "whitespace.txt")).toHaveLength(0);
  });
});

// ─── parseFile ───────────────────────────────────────────────────────────────

describe("parseFile", () => {
  it("routes to correct parser based on format", () => {
    const md = parseFile("test.md", "---\ntags: []\n---\nBody");
    expect(md).toHaveLength(1);

    const csv = parseFile("test.csv", "title,body\nTest,Content");
    expect(csv).toHaveLength(1);

    const json = parseFile("test.json", '[{"body":"Content"}]');
    expect(json).toHaveLength(1);

    const txt = parseFile("test.txt", "Plain text");
    expect(txt).toHaveLength(1);
  });
});
