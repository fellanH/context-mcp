# Campaign A: X Thread Draft

**Campaign:** "Ship MCP memory in 5 minutes"
**Format:** 5-tweet thread
**Target:** Developers using MCP-compatible tools (Claude Code, Cursor, Windsurf)
**Status:** Ready for posting

---

## Thread

### Tweet 1 (Hook)

Your AI forgets everything between sessions. Here's how to fix it in 5 min.

Context Vault adds persistent memory to Claude Code, Cursor, and any MCP client. Local-first, open source, hybrid search.

Thread ↓

---

### Tweet 2 (Problem)

Every session starts from zero:
- Re-explain your architecture
- Re-describe your conventions
- Re-share the decisions you made yesterday

~20 min/day on context rebuilding = 2+ hours/week wasted on work your AI already did.

---

### Tweet 3 (Solution)

Context Vault is an MCP memory layer:

- save_context → writes a markdown file + indexes it
- get_context → hybrid search (full-text + semantic + recency)
- Entries are markdown with YAML frontmatter — portable, version-controllable, yours

Works with any MCP-compatible client.

---

### Tweet 4 (Proof)

Setup is 3 commands:

```
npm install -g context-vault
context-vault setup
# paste MCP config into your editor
```

First save → retrieve cycle takes under 2 minutes.

No Docker, no cloud account required. Hosted option available if you want zero install.

---

### Tweet 5 (CTA)

Open source: github.com/fellanH/context-vault
Hosted (free tier): contextvault.dev

No lock-in. Every entry is a markdown file you own.

Full setup guide: [link to blog post #3]
