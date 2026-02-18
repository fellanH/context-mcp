# context-mcp

Personal context vault — an MCP server that connects any AI agent to your accumulated knowledge.

Your knowledge lives as markdown files in plain folders you own and can edit, version, or move freely. The SQLite database is a derived search index — rebuilt from those files at any time. The canonical flow is **files → DB** with a clean two-way mapping: disk structure determines folder placement, the DB stays flat and lightweight.

## How It Works

```
YOUR FILES (source of truth)         SEARCH INDEX (derived)
~/vault/                         ~/.context-mcp/vault.db
├── insights/                        ┌───────────────────────────────┐
│   ├── react-query-caching.md       │ vault table                   │
│   ├── sqlite-fts5-gotchas.md       │   kind: insight               │
│   └── react/                       │   meta.folder: null (flat)    │
│       └── hooks/                   │   meta.folder: "react/hooks"  │
│           └── use-query-gotcha.md  │   kind: decision              │
├── decisions/                       │   kind: pattern               │
│   └── use-sqlite-over-pg.md        │   kind: <any custom>          │
├── patterns/                        │ + FTS5 full-text              │
│   └── api-error-handler.md         │ + vec0 embeddings             │
└── references/  (custom kind)       └───────────────────────────────┘
    └── react-19-notes.md
Human-editable, git-versioned        Fast hybrid search, RAG-ready
You own these files                  Rebuilt from files anytime
```

The SQLite database is stored at `~/.context-mcp/vault.db` by default (configurable via `--db-path`, `CONTEXT_MCP_DB_PATH`, or `config.json`). It contains FTS5 full-text indexes and sqlite-vec embeddings (384-dim float32, all-MiniLM-L6-v2). The database is a derived index — delete it and the server rebuilds it automatically on next session.

Requires **Node.js 20** or later.

## Install

### npm (Recommended)

```bash
npm install -g @fellanh/context-mcp
context-mcp setup
```

The `setup` command auto-detects installed tools (Claude Code, Claude Desktop, Cursor, Windsurf, Cline), lets you pick which to configure, and writes the correct MCP config for each. Existing configs are preserved — only the `context-mcp` entry is added or updated.

### Local Development

```bash
git clone https://github.com/fellanH/context-mcp.git
cd context-mcp
npm install

# Interactive setup — detects your tools and configures them
node bin/cli.js setup
```

For non-interactive environments (CI, scripts):

```bash
context-mcp setup --yes
```

### Manual Configuration

If you prefer manual setup, add to your tool's MCP config. Pass `--vault-dir` to point at your vault folder (omit it to use the default `~/vault/`).

**npm install** (portable — survives upgrades):

```json
{
  "mcpServers": {
    "context-mcp": {
      "command": "context-mcp",
      "args": ["serve", "--vault-dir", "/path/to/vault"]
    }
  }
}
```

**Local dev clone** (absolute path to source):

```json
{
  "mcpServers": {
    "context-mcp": {
      "command": "node",
      "args": ["/path/to/context-mcp/src/server/index.js", "--vault-dir", "/path/to/vault"]
    }
  }
}
```

You can also pass config via environment variables in the MCP config block:

```json
{
  "mcpServers": {
    "context-mcp": {
      "command": "context-mcp",
      "args": ["serve"],
      "env": {
        "CONTEXT_MCP_VAULT_DIR": "/path/to/vault"
      }
    }
  }
}
```

### How the Server Runs

The server is an MCP (Model Context Protocol) process — you don't start or stop it manually. Your AI client (Claude Code, Cursor, Cline, etc.) spawns it automatically as a child process when a session begins, based on the `mcpServers` config above. The server communicates over stdio and lives for the duration of the session. When the session ends, the client terminates the process and SQLite cleans up its WAL files.

This means:
- **No daemon, no port, no background service.** The server only runs while your AI client is active.
- **Multiple sessions** can run separate server instances concurrently — SQLite WAL mode handles concurrent access safely.
- **First launch** downloads the embedding model (~22MB, all-MiniLM-L6-v2) and creates the database. Subsequent starts are fast.
- **Auto-reindex** on first tool call per session ensures the search index is always in sync with your files on disk. No manual reindex needed.

## Tools

The server exposes three tools. Your AI agent calls them automatically — you don't invoke them directly.

| Tool | Type | Description |
|------|------|-------------|
| `get_context` | Read | Hybrid FTS5 + vector search across all knowledge |
| `save_context` | Write | Save any kind of knowledge to the vault |
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

### `save_context` — Save knowledge

```js
save_context({
  kind: "insight",                     // Determines folder: insights/
  body: "React Query staleTime defaults to 0",
  tags: ["react", "performance"],
  title: "staleTime gotcha",           // Optional
  meta: { type: "gotcha" },            // Optional: any structured data
  folder: "react/hooks",              // Optional: subfolder organization
  source: "debugging-session"          // Optional: provenance
})
// → ~/vault/insights/react/hooks/staletime-gotcha.md
```

The `kind` field accepts any string — `"insight"`, `"decision"`, `"pattern"`, `"reference"`, or any custom kind. The folder is auto-created from the pluralized kind name.

### `context_status` — Diagnostics

Shows vault path, database size, file counts per kind, embedding coverage, and any issues.

## Knowledge Organization

### Folders and Kinds

Each top-level subdirectory in the vault maps to a `kind` value. The directory name is depluralized:

```
insights/    →  kind: "insight"
decisions/   →  kind: "decision"
patterns/    →  kind: "pattern"
references/  →  kind: "reference"
```

Within each kind directory, nested subfolders provide human-browsable organization. The subfolder path is stored in `meta.folder`:

```
ON DISK                                    IN DB (vault table)
insights/                                  kind: "insight", meta.folder: null
  flat-file.md
insights/react/hooks/                      kind: "insight", meta.folder: "react/hooks"
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

1. `mkdir ~/vault/references/`
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

| Variable | Overrides |
|----------|-----------|
| `CONTEXT_MCP_VAULT_DIR` | Vault directory (knowledge files) |
| `CONTEXT_MCP_DB_PATH` | Database path |
| `CONTEXT_MCP_DEV_DIR` | Dev directory |
| `CONTEXT_MCP_DATA_DIR` | Data directory (DB + config storage) |

### CLI Arguments

```bash
context-mcp serve --vault-dir /custom/vault --dev-dir /custom/dev
context-mcp serve --data-dir /custom/data --db-path /custom/data/vault.db
```

## CLI

```bash
context-mcp <command> [options]
```

| Command | Description |
|---------|-------------|
| `setup` | Interactive MCP installer — detects tools, writes configs |
| `serve` | Start the MCP server (used by AI clients in MCP configs) |
| `ui [--port 3141]` | Launch the web dashboard |
| `reindex` | Rebuild search index from knowledge files |
| `status` | Show vault diagnostics (paths, counts, health) |

If running from source without a global install, use `node bin/cli.js` instead of `context-mcp`.

## Desktop App (macOS)

A macOS dock application that starts the UI server and opens the dashboard in your browser.

```bash
osacompile -o "/Applications/Context.app" ui/Context.applescript
```

The app checks if port 3141 is already in use, starts the server if not, and opens `http://localhost:3141`. Server logs are written to `/tmp/context-mcp.log`.

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
context-mcp status    # Shows resolved paths
mkdir -p ~/vault      # Create the default vault directory
```

Or re-run `context-mcp setup` to reconfigure.

### Embedding model download stalls

The first run downloads the all-MiniLM-L6-v2 embedding model (~22MB) from Hugging Face. This requires internet access and can take a moment. If it hangs, check your network or proxy settings.

### Stale search index

If search results seem outdated or missing:

```bash
context-mcp reindex
```

This rebuilds the entire index from your vault files. Auto-reindex runs on every session start, but manual reindex can help diagnose issues.

### Config path debugging

```bash
context-mcp status
```

Shows all resolved paths (vault dir, data dir, DB path, config file) and where each was resolved from (defaults, config file, env, or CLI args).

## Architecture

```
src/
├── core/                Shared utilities (config, frontmatter, files, status)
├── capture/             Write path — creates .md files in the vault
├── index/               Sync layer — SQLite schema, embeddings, reindex
├── retrieve/            Read path — hybrid FTS5 + vector search
└── server/              MCP server — wires layers into tool handlers

bin/
└── cli.js               CLI entry point (setup, serve, ui, reindex, status)

ui/
├── serve.js             HTTP server for web dashboard
├── index.html           Single-page dashboard UI
└── Context.applescript  macOS dock app launcher
```

Each layer has a single responsibility and can be understood independently. The server is the only module that imports across layer boundaries.

### Module Dependency Graph

```
core/files.js, core/frontmatter.js  ←  capture/
                                              ↑
core/config.js                          server/  ←  bin/cli.js
                                              ↑
index/embed.js  ←  retrieve/        ←   ui/serve.js
                                              ↑
index/db.js     ←──────────────────  (all consumers)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol (McpServer, StdioServerTransport) |
| `better-sqlite3` | SQLite driver |
| `sqlite-vec` | Vector search (384-dim float32) |
| `@huggingface/transformers` | Local embeddings (all-MiniLM-L6-v2, ~22MB) |

## License

MIT
