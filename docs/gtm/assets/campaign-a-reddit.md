# Campaign A: Reddit Post Draft

**Campaign:** "Ship MCP memory in 5 minutes"
**Format:** Integration guide / experience post
**Subreddits:** r/ClaudeAI, r/cursor
**Tone:** Technical, helpful, first-person — not promotional
**Status:** Ready for posting

---

## Title Options

1. "I built persistent memory for Claude Code / Cursor using MCP — here's the setup"
2. "How I stopped re-explaining my project to AI every session (MCP memory layer)"
3. "Open-source persistent memory for AI coding tools via MCP — setup guide"

Pick based on subreddit norms. Option 1 for r/ClaudeAI, option 2 or 3 for r/cursor.

---

## Post Body

**The problem**

I kept losing 10-15 minutes at the start of every AI coding session re-explaining my project's architecture, conventions, and recent decisions. Across 3-4 sessions a day, that's nearly an hour of wasted context rebuilding.

The core issue: AI coding tools don't have memory between sessions. Every conversation starts from scratch.

**What I built**

Context Vault is an MCP server that gives your AI tools persistent memory. It works with Claude Code, Cursor, and any MCP-compatible client.

Three core tools:

- `save_context` — saves an entry as a markdown file and indexes it for search
- `get_context` — hybrid search combining full-text matching, semantic similarity, and recency weighting
- `context_status` — health check for your vault

Every entry is a standard markdown file with YAML frontmatter. No proprietary format, no lock-in.

**Setup (3 steps)**

1. Install globally:

```bash
npm install -g context-vault
```

2. Run setup (creates vault, downloads embedding model, initializes DB):

```bash
context-vault setup
```

3. Add the MCP config to your editor settings:

```json
{
  "mcpServers": {
    "context-vault": {
      "command": "context-vault",
      "args": ["mcp"]
    }
  }
}
```

That's it. First save → retrieve cycle takes under 2 minutes.

**Daily workflow**

During sessions: save decisions, patterns, and debugging insights as they come up. Use specific kinds (decision, pattern, insight) and tags for your domain areas.

Before sessions: run a quick `get_context` query for what you're about to work on. The AI gets primed with relevant prior context automatically.

After two weeks of this, my session startup dropped from 15 minutes of re-explanation to under 2 minutes.

**Technical details**

- Local-first: SQLite + sqlite-vec for storage, local embeddings via Hugging Face transformers
- Hybrid search: BM25 full-text + cosine similarity + recency decay
- Markdown files: human-readable, git-friendly, portable
- Hosted option available if you want zero install (same MCP interface, API key auth)

**Links**

- GitHub (open source): github.com/fellanH/context-vault
- Hosted (free tier): context-vault.com
- Setup guide: [link to blog post]

Happy to answer questions about the architecture or help with setup.
