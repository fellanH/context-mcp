# context-vault

[![npm version](https://img.shields.io/npm/v/context-vault)](https://www.npmjs.com/package/context-vault)
[![npm downloads](https://img.shields.io/npm/dm/context-vault)](https://www.npmjs.com/package/context-vault)
[![license](https://img.shields.io/npm/l/context-vault)](./LICENSE)
[![node](https://img.shields.io/node/v/context-vault)](https://nodejs.org)

Persistent memory for AI agents — save and search knowledge across sessions. Your data stays local as markdown files.

<p align="center">
  <img src="demo.gif" alt="context-vault demo — Claude Code and Cursor using the knowledge vault" width="800">
</p>

## Quick Start

```bash
npm install -g context-vault
context-vault setup
```

Setup detects your AI tools (Claude Code, Cursor, Codex, Windsurf, etc.), configures MCP, downloads the embedding model (~22MB), and seeds a starter entry. Takes about 2 minutes.

Then open your AI tool and try:

> **"Search my vault for getting started"**

You’re done. The vault lives at `~/vault/` — plain markdown files you own.

## What It Does

- **Save** — Insights, decisions, patterns, contacts. Your AI agent writes them as you work.
- **Search** — Hybrid full-text + semantic search. Ask in natural language.
- **Own your data** — Markdown in folders you control. Git-versioned, human-editable.

## First Steps

| Tell your AI | What happens |
|--------------|--------------|
| "Save an insight: React Query's staleTime defaults to 0" | Creates `~/vault/knowledge/insights/...` |
| "Search my vault for React Query" | Returns matching entries |
| "List my recent decisions" | Browses entries by kind |
| "Show my vault status" | Diagnostics and health |

Optional: run `context-vault ui` for a local web dashboard at `localhost:3141`.

## MCP Tools

Your AI agent uses these automatically — you don’t call them directly.

| Tool | Description |
|------|-------------|
| `get_context` | Search vault (hybrid FTS + vector) |
| `save_context` | Save or update entries |
| `list_context` | Browse with filters |
| `delete_context` | Remove by ID |
| `ingest_url` | Fetch URL, extract, save |
| `context_status` | Health and config |

See [DATA_CATEGORIES.md](./DATA_CATEGORIES.md) for kinds (insight, decision, pattern, etc.) and folder structure.

## CLI Reference

| Command | Description |
|---------|-------------|
| `context-vault setup` | Interactive installer — detects tools, writes MCP configs |
| `context-vault ui [--port 3141]` | Web dashboard |
| `context-vault status` | Vault health, paths, entry counts |
| `context-vault reindex` | Rebuild search index |
| `context-vault import <path>` | Import .md, .csv, .json, .txt |
| `context-vault export` | Export to JSON or CSV |
| `context-vault update` | Check for updates |
| `context-vault uninstall` | Remove MCP configs |

> **Note:** `context-mcp` works as an alias; `context-vault` is the primary command.

## Hosted Option

Prefer cloud over local? No Node.js required — sign up, get an API key, and connect in 2 minutes. See [connect-in-2-minutes.md](./docs/distribution/connect-in-2-minutes.md).

## Configuration

Defaults work out of the box. Override if needed:

| Setting | Default |
|---------|---------|
| Vault dir | `~/vault/` |
| Data dir | `~/.context-mcp/` |
| Database | `~/.context-mcp/vault.db` |

Config: `~/.context-mcp/config.json`. Env vars: `CONTEXT_VAULT_VAULT_DIR`, `CONTEXT_VAULT_DB_PATH`, etc.

## Requirements

Node.js 20+. No daemon — your AI client spawns the server when a session starts.

## Troubleshooting

**Install fails (native modules):**
```bash
npm rebuild better-sqlite3 sqlite-vec
```

**Vault not found:**
```bash
mkdir -p ~/vault
context-vault setup
```

**Stale search results:**
```bash
context-vault reindex
```

## Development

```bash
git clone https://github.com/fellanH/context-mcp.git
cd context-mcp
nvm use
npm install
npm run cli -- setup
```

Use `npx context-vault` or `npm run cli --` instead of `context-vault` when running from source.

## License

MIT
