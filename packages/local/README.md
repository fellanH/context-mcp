# context-vault

[![npm version](https://img.shields.io/npm/v/context-vault)](https://www.npmjs.com/package/context-vault)
[![npm downloads](https://img.shields.io/npm/dm/context-vault)](https://www.npmjs.com/package/context-vault)
[![license](https://img.shields.io/npm/l/context-vault)](./LICENSE)
[![node](https://img.shields.io/node/v/context-vault)](https://nodejs.org)

Persistent memory for AI agents — saves and searches knowledge across sessions.

<p align="center">
  <img src="https://github.com/fellanH/context-vault/raw/main/demo.gif" alt="context-vault demo — Claude Code and Cursor using the knowledge vault" width="800">
</p>

## Quick Start

```bash
npm install -g context-vault
context-vault setup
```

Setup auto-detects your tools (Claude Code, Codex, Claude Desktop, Cursor, Windsurf, Antigravity, Cline), downloads the embedding model, seeds your vault with a starter entry, and verifies everything works. Then open your AI tool and try:

> "Search my vault for getting started"

For hosted MCP setup (Claude Code, Cursor, GPT Actions), see [connect-in-2-minutes](https://github.com/fellanH/context-vault/blob/main/docs/distribution/connect-in-2-minutes.md).

> **Note:** `context-mcp` still works as a CLI alias but `context-vault` is the primary command.

## What It Does

- **Save** insights, decisions, patterns, and any custom knowledge kind from AI sessions
- **Search** with hybrid full-text + semantic similarity, ranked by relevance and recency
- **Own your data** — plain markdown files in folders you control, git-versioned, human-editable

## Tools

The server exposes six tools. Your AI agent calls them automatically — you don't invoke them directly.

| Tool | Type | Description |
|------|------|-------------|
| `get_context` | Read | Hybrid FTS5 + vector search across all knowledge |
| `save_context` | Write | Save new knowledge or update existing entries by ID |
| `list_context` | Browse | List vault entries with filtering and pagination |
| `delete_context` | Delete | Remove an entry by ID (file + index) |
| `submit_feedback` | Write | Submit bug reports or feature requests |
| `context_status` | Diag | Show resolved config, health, and per-kind file counts |

### `get_context` — Search your vault

```js
get_context({
  query: "react query caching",       // Natural language or keywords
  kind: "insight",                     // Optional: filter by kind
  tags: ["react"],                     // Optional: filter by tags
  limit: 5                             // Optional: max results (default 10)
})
```

Returns entries ranked by combined full-text and semantic similarity, with recency weighting.

### `save_context` — Save or update knowledge

```js
// Create new entry
save_context({
  kind: "insight",                     // Determines folder: insights/
  body: "React Query staleTime defaults to 0",
  tags: ["react", "performance"],
  title: "staleTime gotcha",           // Optional
  meta: { type: "gotcha" },            // Optional: any structured data
  folder: "react/hooks",              // Optional: subfolder organization
  source: "debugging-session"          // Optional: provenance
})
// → ~/vault/knowledge/insights/react/hooks/staletime-gotcha.md

// Update existing entry by ID
save_context({
  id: "01HXYZ...",                     // ULID from a previous save
  body: "Updated content here",        // Only provide fields you want to change
  tags: ["react", "updated"]           // Omitted fields are preserved
})
```

The `kind` field accepts any string — `"insight"`, `"decision"`, `"pattern"`, `"reference"`, or any custom kind. The folder is auto-created from the pluralized kind name.

When updating (`id` provided), omitted fields are preserved from the original. You cannot change `kind` or `identity_key` — delete and re-create instead.

### `list_context` — Browse entries

```js
list_context({
  kind: "insight",                     // Optional: filter by kind
  category: "knowledge",              // Optional: knowledge, entity, or event
  tags: ["react"],                    // Optional: filter by tags
  limit: 10,                          // Optional: max results (default 20, max 100)
  offset: 0                           // Optional: pagination offset
})
```

Returns entry metadata (id, title, kind, category, tags, created_at) without body content. Use `get_context` with a search query to retrieve full entries.

### `delete_context` — Remove an entry

```js
delete_context({
  id: "01HXYZ..."                      // ULID of the entry to delete
})
```

Removes the markdown file from disk and cleans up the database and vector index.

### `context_status` — Diagnostics

Shows vault path, database size, file counts per kind, embedding coverage, and any issues.

## Quick Reference

### CLI Commands

| Command | Description |
|---------|-------------|
| `context-vault setup` | Interactive installer — detects tools, writes configs |
| `context-vault connect --key cv_...` | Connect AI tools to hosted vault |
| `context-vault serve` | Start the MCP server (used by AI clients) |
| `context-vault ui [--port 3141]` | Launch web dashboard |
| `context-vault status` | Show vault health, paths, and entry counts |
| `context-vault reindex` | Rebuild search index from vault files |
| `context-vault update` | Check for and install updates |
| `context-vault uninstall` | Remove MCP configs and optionally data |
| `context-vault migrate` | Migrate vault between local and hosted |

### AI Tool Examples

Tell your AI agent any of these:

- **"Search my vault for React hooks"** → hybrid full-text + semantic search
- **"Save an insight: always use useCallback for event handlers"** → creates a new entry
- **"List my recent decisions"** → browse entries filtered by kind
- **"Show my vault status"** → diagnostics and health check
- **"Delete entry 01HXYZ..."** → remove by ID

## Common Workflows

### Save and Retrieve

```
You: "Save an insight: React Query's staleTime defaults to 0"
AI:  ✓ Saved insight → knowledge/insights/react-querys-staletime-defaults.md

You: "Search my vault for React Query"
AI:  [Returns the saved insight with full content]
```

### Build a Project Knowledge Base

```
You: "Save a decision: we chose SQLite over Postgres for the local-first architecture"
You: "Save a pattern: all API handlers follow the try/catch/respond pattern in src/api/"
You: "What decisions have we made about the database?"
AI:  [Returns relevant decisions ranked by relevance]
```

### Track Contacts and Entities

```
You: "Save a contact for Alice (alice@example.com) — lead developer on Project X"
You: "Search my vault for Alice"
AI:  [Returns the contact entry]
```

### Session Summaries

```
You: "Save a session summary: debugged auth token refresh, fixed race condition in useAuth hook"
You: "What did I work on last week?"
AI:  [Returns recent session entries]
```

## Knowledge Organization

### Folders and Kinds

Entries are organized into three categories — **knowledge** (enduring insights, decisions, patterns), **entity** (contacts, projects, tools), and **event** (sessions, conversations, logs). See [DATA_CATEGORIES](https://github.com/fellanH/context-vault/blob/main/docs/DATA_CATEGORIES.md) for the full category system, kind mappings, and write semantics.

Each top-level subdirectory in the vault maps to a `kind` value. The directory name is depluralized:

```
knowledge/insights/    →  kind: "insight"
knowledge/decisions/   →  kind: "decision"
knowledge/patterns/    →  kind: "pattern"
knowledge/references/  →  kind: "reference"
```

Within each kind directory, nested subfolders provide human-browsable organization. The subfolder path is stored in `meta.folder`:

```
ON DISK                                    IN DB (vault table)
knowledge/insights/                        kind: "insight", meta.folder: null
  flat-file.md
knowledge/insights/react/hooks/            kind: "insight", meta.folder: "react/hooks"
  use-query-gotcha.md
```

Tags are semantic (what the content is about). Folder structure is organizational (where it lives). These are separate concerns.

### File Format

All knowledge files use YAML frontmatter:

```markdown
---
id: 01HXYZ...
tags: ["react", "performance"]
source: claude-code
created: 2026-02-17T12:00:00Z
---
React Query's staleTime defaults to 0 — set it explicitly or every mount triggers a refetch.
```

Standard keys: `id`, `tags`, `source`, `created`. Any extra frontmatter keys (`type`, `status`, `language`, `folder`, etc.) are stored in a `meta` JSON column automatically.

### Custom Kinds

No code changes required:

1. `mkdir ~/vault/knowledge/references/`
2. Add `.md` files with YAML frontmatter
3. The next session auto-indexes them

The kind name comes from the directory: `references/` → kind `reference`.

## Configuration

Works out of the box with zero config. All paths are overridable:

```
CLI args  >  env vars  >  config file  >  convention defaults
```

### Defaults

| Setting | Default |
|---------|---------|
| Vault dir | `~/vault/` |
| Data dir | `~/.context-mcp/` |
| Database | `~/.context-mcp/vault.db` |
| Dev dir | `~/dev/` |

### Config File (`~/.context-mcp/config.json`)

Lives in the data directory alongside the database. Created by `setup`, or create it manually:

```json
{
  "vaultDir": "/Users/you/vault/",
  "dataDir": "/Users/you/.context-mcp",
  "dbPath": "/Users/you/.context-mcp/vault.db",
  "devDir": "/Users/you/dev"
}
```

### Environment Variables

Both `CONTEXT_VAULT_*` and `CONTEXT_MCP_*` prefixes are supported. The `CONTEXT_VAULT_*` prefix takes priority.

| Variable | Overrides |
|----------|-----------|
| `CONTEXT_VAULT_VAULT_DIR` / `CONTEXT_MCP_VAULT_DIR` | Vault directory (knowledge files) |
| `CONTEXT_VAULT_DB_PATH` / `CONTEXT_MCP_DB_PATH` | Database path |
| `CONTEXT_VAULT_DEV_DIR` / `CONTEXT_MCP_DEV_DIR` | Dev directory |
| `CONTEXT_VAULT_DATA_DIR` / `CONTEXT_MCP_DATA_DIR` | Data directory (DB + config storage) |

### CLI Arguments

```bash
context-vault serve --vault-dir /custom/vault --dev-dir /custom/dev
context-vault serve --data-dir /custom/data --db-path /custom/data/vault.db
```

## CLI

```bash
context-vault <command> [options]
```

| Command | Description |
|---------|-------------|
| `setup` | Interactive MCP installer — detects tools, writes configs |
| `connect --key cv_...` | Connect AI tools to hosted vault |
| `serve` | Start the MCP server (used by AI clients in MCP configs) |
| `ui [--port 3141]` | Launch the web dashboard |
| `reindex` | Rebuild search index from knowledge files |
| `status` | Show vault diagnostics (paths, counts, health) |
| `update` | Check for and install updates |
| `uninstall` | Remove MCP configs and optionally data |
| `migrate --to-hosted/--to-local` | Migrate vault between local and hosted |

If running from source without a global install, use `npx context-vault` or `node packages/local/bin/cli.js` instead of `context-vault`.

## Install

### npm (Recommended)

```bash
npm install -g context-vault
context-vault setup
```

The `setup` command auto-detects installed tools (Claude Code, Codex, Claude Desktop, Cursor, Windsurf, Antigravity, Cline), lets you pick which to configure, and writes the correct MCP config for each. Existing configs are preserved — only the `context-vault` entry is added or updated.

### Manual Configuration

If you prefer manual setup, add to your tool's MCP config. Pass `--vault-dir` to point at your vault folder (omit it to use the default `~/vault/`).

**npm install** (portable — survives upgrades):

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

You can also pass config via environment variables in the MCP config block:

```json
{
  "mcpServers": {
    "context-vault": {
      "command": "context-vault",
      "args": ["serve"],
      "env": {
        "CONTEXT_VAULT_VAULT_DIR": "/path/to/vault"
      }
    }
  }
}
```

### How the Server Runs

The server is an MCP (Model Context Protocol) process — you don't start or stop it manually. Your AI client (Claude Code, Codex, Cursor, Windsurf, Cline, etc.) spawns it automatically as a child process when a session begins, based on the `mcpServers` config above. The server communicates over stdio and lives for the duration of the session. When the session ends, the client terminates the process and SQLite cleans up its WAL files.

This means:
- **No daemon, no port, no background service.** The server only runs while your AI client is active.
- **Multiple sessions** can run separate server instances concurrently — SQLite WAL mode handles concurrent access safely.
- **Embedding model** is downloaded during `setup` (~22MB, all-MiniLM-L6-v2). If setup was skipped, it downloads on first use.
- **Auto-reindex** on first tool call per session ensures the search index is always in sync with your files on disk. No manual reindex needed.

## Web Dashboard

The `context-vault ui` command launches a web dashboard for browsing, searching, and managing your vault entries.

## How It Works

```
YOUR FILES (source of truth)         SEARCH INDEX (derived)
~/vault/                         ~/.context-mcp/vault.db
├── knowledge/                       ┌───────────────────────────────┐
│   ├── insights/                    │ vault table                   │
│   │   ├── react-query-caching.md   │   kind: insight               │
│   │   └── react/hooks/             │   meta.folder: "react/hooks"  │
│   │       └── use-query-gotcha.md  │   kind: decision              │
│   ├── decisions/                   │   kind: pattern               │
│   │   └── use-sqlite-over-pg.md    │   kind: <any custom>          │
│   └── patterns/                    │ + FTS5 full-text              │
│       └── api-error-handler.md     │ + vec0 embeddings             │
├── entities/                        └───────────────────────────────┘
└── events/
Human-editable, git-versioned        Fast hybrid search, RAG-ready
You own these files                  Rebuilt from files anytime
```

The SQLite database is stored at `~/.context-mcp/vault.db` by default (configurable via `--db-path`, `CONTEXT_VAULT_DB_PATH`, or `config.json`). It contains FTS5 full-text indexes and sqlite-vec embeddings (384-dim float32, all-MiniLM-L6-v2). The database is a derived index — delete it and the server rebuilds it automatically on next session.

Requires **Node.js 20** or later.

## Troubleshooting

### Native module build failures

`better-sqlite3` and `sqlite-vec` include native C code compiled for your platform. If install fails:

```bash
npm rebuild better-sqlite3 sqlite-vec
```

On Apple Silicon Macs, ensure you're running a native ARM Node.js (not Rosetta). Check with `node -p process.arch` — it should say `arm64`.

### Vault directory not found

If `context_status` or `get_context` reports the vault directory doesn't exist:

```bash
context-vault status    # Shows resolved paths
mkdir -p ~/vault      # Create the default vault directory
```

Or re-run `context-vault setup` to reconfigure.

### Embedding model download

The embedding model (all-MiniLM-L6-v2, ~22MB) is normally downloaded during `context-vault setup`. If setup was skipped or the cache was cleared, it downloads automatically on first use. If it hangs, check your network or proxy settings.

### Stale search index

If search results seem outdated or missing:

```bash
context-vault reindex
```

This rebuilds the entire index from your vault files. Auto-reindex runs on every session start, but manual reindex can help diagnose issues.

### Config path debugging

```bash
context-vault status
```

Shows all resolved paths (vault dir, data dir, DB path, config file) and where each was resolved from (defaults, config file, env, or CLI args).

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol (McpServer, StdioServerTransport) |
| `better-sqlite3` | SQLite driver |
| `sqlite-vec` | Vector search (384-dim float32) |
| `@huggingface/transformers` | Local embeddings (all-MiniLM-L6-v2, ~22MB) |

## License

MIT
