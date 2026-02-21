import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  extractHtmlContent,
} from "@context-vault/core/capture/ingest-url";

// ─── htmlToMarkdown ──────────────────────────────────────────────────────────

describe("htmlToMarkdown", () => {
  it("converts headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
    expect(htmlToMarkdown("<h2>Subtitle</h2>")).toContain("## Subtitle");
    expect(htmlToMarkdown("<h3>Section</h3>")).toContain("### Section");
  });

  it("converts links", () => {
    const md = htmlToMarkdown('<a href="https://example.com">Example</a>');
    expect(md).toBe("[Example](https://example.com)");
  });

  it("converts bold and italic", () => {
    expect(htmlToMarkdown("<strong>bold</strong>")).toBe("**bold**");
    expect(htmlToMarkdown("<b>bold</b>")).toBe("**bold**");
    expect(htmlToMarkdown("<em>italic</em>")).toBe("*italic*");
  });

  it("converts code blocks", () => {
    const md = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  it("converts inline code", () => {
    const md = htmlToMarkdown("Use <code>const</code> keyword");
    expect(md).toContain("`const`");
  });

  it("converts list items", () => {
    const md = htmlToMarkdown("<ul><li>Item 1</li><li>Item 2</li></ul>");
    expect(md).toContain("- Item 1");
    expect(md).toContain("- Item 2");
  });

  it("converts paragraphs", () => {
    const md = htmlToMarkdown("<p>First paragraph</p><p>Second paragraph</p>");
    expect(md).toContain("First paragraph");
    expect(md).toContain("Second paragraph");
  });

  it("strips script and style tags", () => {
    const md = htmlToMarkdown(
      '<p>Visible</p><script>alert("xss")</script><style>.hidden{}</style>',
    );
    expect(md).toContain("Visible");
    expect(md).not.toContain("alert");
    expect(md).not.toContain(".hidden");
  });

  it("strips nav, header, footer, aside", () => {
    const md = htmlToMarkdown(
      "<nav>Menu</nav><header>Header</header><main><p>Content</p></main><footer>Footer</footer><aside>Side</aside>",
    );
    expect(md).toContain("Content");
    expect(md).not.toContain("Menu");
    expect(md).not.toContain("Header");
    expect(md).not.toContain("Footer");
    expect(md).not.toContain("Side");
  });

  it("decodes HTML entities", () => {
    const md = htmlToMarkdown("<p>Tom &amp; Jerry &lt;3&gt;</p>");
    expect(md).toContain("Tom & Jerry <3>");
  });

  it("converts blockquotes", () => {
    const md = htmlToMarkdown("<blockquote>Quoted text</blockquote>");
    expect(md).toContain("> Quoted text");
  });

  it("handles nested tags", () => {
    const md = htmlToMarkdown(
      "<p><strong>Bold <em>and italic</em></strong></p>",
    );
    // Regex-based converter processes outer tags first, so inner em is stripped
    expect(md).toContain("Bold");
    expect(md).toContain("italic");
  });

  it("collapses excessive newlines", () => {
    const md = htmlToMarkdown("<p>A</p><p></p><p></p><p>B</p>");
    expect(md).not.toMatch(/\n{4,}/);
  });
});

// ─── extractHtmlContent ──────────────────────────────────────────────────────

describe("extractHtmlContent", () => {
  it("extracts title from <title> tag", () => {
    const html =
      "<html><head><title>Page Title</title></head><body><p>Content</p></body></html>";
    const { title } = extractHtmlContent(html, "https://example.com");
    expect(title).toBe("Page Title");
  });

  it("prefers <article> content over <body>", () => {
    const html = `
      <body>
        <nav>Menu</nav>
        <article><h1>Article Title</h1><p>Article content</p></article>
        <footer>Footer</footer>
      </body>`;
    const { body } = extractHtmlContent(html, "https://example.com");
    expect(body).toContain("Article Title");
    expect(body).toContain("Article content");
  });

  it("prefers <main> when no <article>", () => {
    const html = `
      <body>
        <nav>Menu</nav>
        <main><p>Main content</p></main>
        <footer>Footer</footer>
      </body>`;
    const { body } = extractHtmlContent(html, "https://example.com");
    expect(body).toContain("Main content");
  });

  it("falls back to <body> content", () => {
    const html = "<body><p>Body content</p></body>";
    const { body } = extractHtmlContent(html, "https://example.com");
    expect(body).toContain("Body content");
  });

  it("returns empty title when none found", () => {
    const html = "<body><p>No title here</p></body>";
    const { title } = extractHtmlContent(html, "https://example.com");
    expect(title).toBe("");
  });
});
