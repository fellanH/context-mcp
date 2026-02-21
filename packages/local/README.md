# context-vault

[![npm version](https://img.shields.io/npm/v/context-vault)](https://www.npmjs.com/package/context-vault)
[![npm downloads](https://img.shields.io/npm/dm/context-vault)](https://www.npmjs.com/package/context-vault)
[![license](https://img.shields.io/npm/l/context-vault)](./LICENSE)
[![node](https://img.shields.io/node/v/context-vault)](https://nodejs.org)

Persistent memory for AI agents — saves and searches knowledge across sessions. Your data stays local as plain markdown files.

## Quick Start

```bash
npm install -g context-vault
context-vault setup
```

Setup auto-detects your AI tools (Claude Code, Codex, Claude Desktop, Cursor, Windsurf, Cline), downloads the embedding model (~22MB), seeds your vault with a starter entry, and verifies everything works.

Then open your AI tool and try: **"Search my vault for getting started"**

> `context-mcp` still works as a CLI alias — `context-vault` is the primary command.

## What It Does

- **Save** — insights, decisions, patterns, contacts. Your AI agent writes them as you work.
- **Search** — hybrid full-text + semantic search. Ask in natural language.
- **Own your data** — plain markdown in `~/vault/`, git-versioned, human-editable.

## MCP Tools

Your AI agent uses these automatically.

| Tool             | Description                        |
| ---------------- | ---------------------------------- |
| `get_context`    | Search vault (hybrid FTS + vector) |
| `save_context`   | Save or update entries             |
| `list_context`   | Browse with filters                |
| `delete_context` | Remove by ID                       |
| `ingest_url`     | Fetch URL, extract, save           |
| `context_status` | Health and config                  |

Entries are organized by `kind` (insight, decision, pattern, reference, contact, etc.) into `~/vault/knowledge/`, `~/vault/entities/`, `~/vault/events/`. Kind is derived from the subdirectory name.

## CLI

| Command                          | Description                                               |
| -------------------------------- | --------------------------------------------------------- |
| `context-vault setup`            | Interactive installer — detects tools, writes MCP configs |
| `context-vault ui [--port 3141]` | Web dashboard                                             |
| `context-vault status`           | Vault health, paths, entry counts                         |
| `context-vault reindex`          | Rebuild search index                                      |
| `context-vault import <path>`    | Import .md, .csv, .json, .txt                             |
| `context-vault export`           | Export to JSON or CSV                                     |
| `context-vault sync`             | Sync with hosted account                                  |
| `context-vault update`           | Check for updates                                         |
| `context-vault uninstall`        | Remove MCP configs                                        |

## Manual MCP Config

If you prefer manual setup over `context-vault setup`:

```json
{
  "mcpServers": {
    "context-vault": {
      "command": "context-vault",
      "args": ["serve", "--vault-dir", "/path/to/vault"]
    }
  }
}
```

## Hosted Option

No Node.js required — sign up at [app.context-vault.com](https://app.context-vault.com), get an API key, connect in 2 minutes.

## Troubleshooting

**Install fails (native modules):**

```bash
npm rebuild better-sqlite3 sqlite-vec
```

On Apple Silicon, ensure you're running native ARM Node.js: `node -p process.arch` should say `arm64`.

**Stale search results:**

```bash
context-vault reindex
```

**Vault not found:**

```bash
context-vault status   # shows resolved paths
mkdir -p ~/vault
```

## License

MIT
