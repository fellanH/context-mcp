# Context Vault — Persistent Memory for AI Agents

---

## The Problem

- **AI sessions restart from zero.** Every new conversation, your AI assistant forgets prior decisions, architectural context, and learned patterns.
- **Decisions and patterns vanish between chats.** The insights from Tuesday's session are gone by Thursday. You re-explain the same constraints repeatedly.
- **Existing notes aren't retrieval-ready for agents.** Notion pages, markdown files, and docs exist — but your AI tools can't search them semantically or access them through standard protocols.

---

## The Promise

Give your AI tools durable, searchable memory through MCP. Set up in minutes. Own your data forever.

Context Vault bridges the gap between your knowledge and your AI tools. Save decisions, patterns, and references during work — retrieve them automatically in future sessions. Your AI starts every conversation with the context it needs.

---

## How It Works

### 1. Install
Install the CLI globally or connect to hosted MCP. One command, no infrastructure required.

### 2. Save Context During Work
Use `save_context` to capture insights, decisions, patterns, and references as you work. Entries are stored as portable markdown files with YAML frontmatter.

### 3. Retrieve in Future Sessions
Your AI tools call `get_context` to search your vault. Hybrid full-text + semantic search returns the most relevant entries, weighted by recency and relevance.

---

## Why Context Vault

- **Open-source core** — Inspect, modify, and self-host. No black box.
- **Hybrid FTS + semantic search** — Keyword precision combined with meaning-based retrieval. Not just keyword matching, not just embeddings — both.
- **Markdown file portability** — Every entry is a readable markdown file. Export, version control, or migrate anytime.
- **Hosted MCP for zero-infra** — Don't want to self-host? Connect via hosted endpoint with one config line. Same data format, no lock-in.
- **MCP protocol native** — Works with Claude Code, Cursor, Windsurf, and any MCP-compatible client out of the box.

---

## Pricing

| Tier | What You Get | Cost |
|------|-------------|------|
| **Free (local)** | Full CLI, unlimited local entries, hybrid search, all MCP tools | Free forever |
| **Pro (hosted)** | Managed MCP endpoint, cloud sync, API key access, zero infrastructure | Per-usage pricing |

---

## Get Started

Start free at **contextvault.dev**

Install locally in under 2 minutes:
```
npm install -g context-vault && context-vault setup
```

Or connect to hosted MCP with one config line — no install required.
