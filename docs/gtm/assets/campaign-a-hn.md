# Campaign A: Hacker News Show HN Post

**Campaign:** "Ship MCP memory in 5 minutes"
**Format:** Show HN submission + author first comment
**Tone:** Technical, concise, honest about trade-offs
**Status:** Ready for posting

---

## Submission

**Title:** Show HN: Context Vault — local-first persistent memory for AI coding tools via MCP

**URL:** https://github.com/fellanH/context-mcp

---

## Author First Comment

Hi HN — I built Context Vault to solve a specific problem: AI coding tools (Claude Code, Cursor, etc.) have no memory between sessions. Every new conversation starts from scratch, and you spend 10-15 minutes re-explaining project context before doing any real work.

**What it is**

An MCP server that gives any MCP-compatible AI tool persistent, searchable memory. Three core operations: save, search, retrieve. Entries are markdown files with YAML frontmatter — no proprietary format.

**Technical architecture**

- SQLite + sqlite-vec for storage and vector search
- Local embeddings via Hugging Face transformers (no API calls for indexing)
- Hybrid search: BM25 full-text ranking + cosine similarity on embeddings + configurable recency weighting
- MCP protocol for tool integration — works with any compliant client
- ~940 lines of code across 10 source files

**Why local-first**

Your vault is a folder of markdown files on your machine. You can read, edit, grep, and version control them with any tool. The database is a local SQLite file. Nothing leaves your machine unless you opt into hosted.

There's also a hosted option (free tier) for zero-install setup or team sharing — same MCP interface, API key auth, markdown export anytime.

**What I'd like feedback on**

1. Search quality — the hybrid ranking formula balances keyword, semantic, and recency signals. Curious if others have tuned similar systems and found better weighting approaches.
2. Taxonomy — currently uses kind (decision, pattern, insight, reference) + tags + folders. Is this flexible enough or too rigid?
3. MCP integrations — what other MCP clients or workflows would be useful to support?

GitHub: https://github.com/fellanH/context-mcp
Hosted: https://contextvault.dev
