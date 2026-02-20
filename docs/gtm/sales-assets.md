# Sales Assets

Collateral for founder-led sales. Status: `not-started` → `in-progress` → `review` → `done`

---

## 1. Solution Brief

One-page PDF following pain → promise → proof format.

| Asset              | Status | Target | Location                            | Notes                                                                                     |
| ------------------ | ------ | ------ | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Solution brief PDF | done   | W4     | `docs/gtm/assets/solution-brief.md` | Pain: stateless AI. Promise: persistent memory in minutes. Proof: open-core + hosted MCP. |

**Outline:**

- Pain: AI sessions restart from zero. Decisions, patterns, and context vanish.
- Promise: Context Vault gives your AI tools persistent memory through MCP — set up in minutes, own your data forever.
- Proof: open-source local vault, hosted MCP endpoint, markdown portability, hybrid search.
- CTA: Start free at context-vault.com

---

## 2. Demo Scripts

Each demo has a script file in `docs/gtm/demos/`. Scripts cover setup, key moments, and expected output.

| #   | Demo                     | Status      | Target | Script Location                      | Duration |
| --- | ------------------------ | ----------- | ------ | ------------------------------------ | -------- |
| 1   | CLI local setup          | done        | W4     | `docs/gtm/demos/cli-local.md`        | 2-3 min  |
| 2   | Hosted MCP endpoint      | done        | W5     | `docs/gtm/demos/hosted-mcp.md`       | 2-3 min  |
| 3   | Browser extension inject | not-started | W6     | `docs/gtm/demos/extension-inject.md` | 2-3 min  |

---

## 3. Campaign Materials

### Campaign A: "Ship MCP memory in 5 minutes" (W5)

Target: developers already using MCP-compatible tools who want persistent context.

| Asset                              | Status      | Notes                                    |
| ---------------------------------- | ----------- | ---------------------------------------- |
| X thread (5 tweets)                | done        | `docs/gtm/assets/campaign-a-x-thread.md` |
| Reddit post (r/ClaudeAI, r/cursor) | done        | `docs/gtm/assets/campaign-a-reddit.md`   |
| HN Show post                       | done        | `docs/gtm/assets/campaign-a-hn.md`       |
| Landing page variant               | not-started | UTM-tagged `/` with campaign messaging   |

### Campaign B: "Local to hosted without lock-in" (W7)

Target: privacy-conscious developers evaluating hosted options.

| Asset                | Status      | Notes                                                                        |
| -------------------- | ----------- | ---------------------------------------------------------------------------- |
| X thread (5 tweets)  | not-started | Hook: "I moved 500 vault entries to hosted in 2 minutes. No vendor lock-in." |
| Blog companion post  | not-started | Links to post #12 (local-first vs hosted)                                    |
| Comparison one-pager | not-started | Side-by-side local vs hosted feature matrix                                  |

### Campaign C: "Inject vault context into ChatGPT/Claude/Gemini" (W9)

Target: users of multiple AI tools who want cross-platform memory.

| Asset                        | Status      | Notes                                                   |
| ---------------------------- | ----------- | ------------------------------------------------------- |
| X thread (5 tweets)          | not-started | Hook: "Same memory across Claude, ChatGPT, and Cursor." |
| Demo video (extension)       | not-started | Show inject flow across 3 different AI UIs              |
| GPT Actions integration post | not-started | Links to post #6 (MCP + GPT Actions)                    |

---

## 4. Objection Handling Cheatsheet

Quick-reference for founder conversations. Keep in pipeline notes or open during calls.

| Objection                                    | One-liner                                                                                         | Longer response                                                                                                                                                                                                                                                                                                                                                             | Status |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| "I already use notes/Notion"                 | "Notes aren't retrieval-ready for agents. CV uses hybrid search so your AI finds what it needs."  | Your notes exist but your AI can't search them. Context Vault combines full-text search with semantic embeddings so the AI finds relevant entries even when queries don't match exact keywords. Unlike manual copy-paste from Notion, MCP tools let the agent pull context automatically at the start of every session.                                                     | done   |
| "What about privacy?"                        | "Your data stays in your vault. Hosted accounts are isolated by API key. You can export anytime." | Everything runs local-first by default — your vault is a folder of markdown files on your machine. We never train on user data. Hosted accounts are isolated by API key with no cross-tenant access. You can export your entire vault as markdown files at any time and self-host if you prefer.                                                                            | done   |
| "Will I get locked in?"                      | "Everything is markdown files. Export, move, or self-host whenever you want."                     | The core is open-source and every entry is a standard markdown file with YAML frontmatter. There's no proprietary format — you can read, edit, and version control entries with any tool. The MCP protocol is an open standard, so you can switch to any compatible server without rewriting integrations.                                                                  | done   |
| "Seems complex to set up"                    | "One MCP endpoint plus copy-paste config. Under 5 minutes."                                       | Install the CLI with one npm command, run setup, and paste the MCP config into your editor settings. The whole process takes under 5 minutes. We have step-by-step guides for Claude Code, Cursor, and Windsurf. The hosted option is even simpler — just paste an API key and endpoint URL.                                                                                | done   |
| "Why not just use .cursorrules / CLAUDE.md?" | "Those are static. CV gives semantic search, tagging, and retrieval across sessions."             | Static files work for small, stable context but break down as your project grows. You can't search them semantically, tag entries by topic, or retrieve selectively. Context Vault gives you structured kinds, tags, and hybrid search so the right context surfaces automatically — even across multiple projects and hundreds of entries.                                 | done   |
| "I'll build my own"                          | "You could! CV saves you weeks and gives you hybrid search + hosted MCP out of the box."          | Totally possible, and many developers start down that path. The challenge is building reliable hybrid search with FTS and semantic embeddings, handling embedding model management, and maintaining an MCP server. Context Vault gives you all of that out of the box plus a hosted option, so you ship memory in an afternoon instead of spending weeks on infrastructure. | done   |
