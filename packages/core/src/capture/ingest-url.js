/**
 * ingest-url.js — URL fetch + HTML → markdown conversion
 *
 * Fetches a URL, extracts readable content, converts to markdown,
 * and returns an EntryData object ready for captureAndIndex().
 *
 * Uses Node built-in fetch() (Node 18+). No external dependencies.
 */

// ─── HTML → Markdown ─────────────────────────────────────────────────────────

/**
 * Convert HTML to simplified markdown.
 * Strips scripts/styles, converts headings/links/lists/code.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  let md = html;

  // Remove scripts, styles, nav, header, footer, aside
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  md = md.replace(/<header[\s\S]*?<\/header>/gi, "");
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  md = md.replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n# ${stripTags(c).trim()}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n## ${stripTags(c).trim()}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n#### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n##### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n###### ${stripTags(c).trim()}\n`);

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanText = stripTags(text).trim();
    return cleanText ? `[${cleanText}](${href})` : "";
  });

  // Convert code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, c) => `\n\`\`\`\n${decodeEntities(c).trim()}\n\`\`\`\n`);
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\`\`\`\n${decodeEntities(stripTags(c)).trim()}\n\`\`\`\n`);

  // Convert inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decodeEntities(c).trim()}\``);

  // Convert strong/em
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => `**${stripTags(c).trim()}**`);
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => `*${stripTags(c).trim()}*`);

  // Convert list items
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripTags(c).trim()}\n`);

  // Convert paragraphs and line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n${stripTags(c).trim()}\n`);
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
    return "\n" + stripTags(c).trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n";
  });

  // Remove remaining HTML tags
  md = stripTags(md);

  // Decode HTML entities
  md = decodeEntities(md);

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "");
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ─── HTML Content Extraction ─────────────────────────────────────────────────

/**
 * Extract the main readable content from an HTML page.
 * Prefers <article> or <main>, falls back to <body>.
 *
 * @param {string} html
 * @param {string} url
 * @returns {{ title: string, body: string }}
 */
export function extractHtmlContent(html, url) {
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(decodeEntities(titleMatch[1])).trim() : "";

  // Try to extract main content area
  let contentHtml = "";

  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

  if (articleMatch) {
    contentHtml = articleMatch[1];
  } else if (mainMatch) {
    contentHtml = mainMatch[1];
  } else {
    // Fall back to <body>
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    contentHtml = bodyMatch ? bodyMatch[1] : html;
  }

  const body = htmlToMarkdown(contentHtml);

  return { title, body };
}

// ─── URL Ingestion ───────────────────────────────────────────────────────────

/**
 * Fetch a URL, extract readable content, and return an EntryData object.
 *
 * @param {string} url
 * @param {{ kind?: string, tags?: string[], source?: string, maxBodyLength?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{ kind: string, title: string, body: string, tags: string[], meta: object, source: string }>}
 */
export async function ingestUrl(url, opts = {}) {
  const {
    kind = "reference",
    tags = [],
    source,
    maxBodyLength = 50000,
    timeoutMs = 15000,
  } = opts;

  let domain;
  try {
    domain = new URL(url).hostname;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ContextVault/1.0 (+https://github.com/fellanH/context-vault)",
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      },
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Fetch failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const html = await response.text();

  let title, body;

  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    const extracted = extractHtmlContent(html, url);
    title = extracted.title;
    body = extracted.body;
  } else {
    // Plain text or other — use as-is
    title = domain;
    body = html;
  }

  // Truncate if too long
  if (body.length > maxBodyLength) {
    body = body.slice(0, maxBodyLength) + "\n\n[Content truncated]";
  }

  if (!body.trim()) {
    throw new Error("No readable content extracted from URL");
  }

  return {
    kind,
    title: title || domain,
    body,
    tags: [...tags, "web-import"],
    meta: {
      url,
      domain,
      fetched_at: new Date().toISOString(),
      content_type: contentType.split(";")[0].trim() || "text/html",
    },
    source: source || domain,
  };
}
