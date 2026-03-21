# Context Vault MCP Server — Architecture

## Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | >=22 |
| Language | TypeScript | 5.7+ |
| Database | SQLite (better-sqlite3) | -- |
| Full-text search | SQLite FTS5 | built-in |
| Vector search | sqlite-vec | -- |
| MCP SDK | @modelcontextprotocol/sdk | -- |
| Test runner | Vitest | 4.x |
| Build | TypeScript compiler (tsc) | -- |

## Structure

```
mcp/
├── packages/
│   ├── core/              ← @context-vault/core (pure engine, no I/O assumptions)
│   │   ├── src/
│   │   ├── dist/          ← compiled JS (pre-compiled, not tsx)
│   │   └── package.json
│   └── local/             ← context-vault (CLI + MCP server, stdio transport)
│       ├── src/
│       ├── bin/cli.js     ← CLI entry point
│       ├── dist/
│       └── package.json
├── test/                  ← integration tests
├── scripts/
│   ├── release.mjs        ← full release automation
│   └── check-constants.js
├── docs/
├── package.json           ← workspace root (npm workspaces)
└── vitest.config.js
```

## Package Separation

**core** (`@context-vault/core`): pure library with no I/O assumptions. Contains:
- Database schema and migrations
- Search engine (FTS5 + semantic hybrid)
- Entry CRUD operations
- Embedding generation
- Deduplication logic

**local** (`context-vault`): CLI and MCP server. Contains:
- MCP tool handlers (save, get, list, delete)
- stdio transport
- CLI commands (setup, reindex, export, import)
- File system operations (markdown read/write)
- Config management (`~/.context-mcp/config.json`)

This separation allows the app/server to import `@context-vault/core` without pulling in CLI/MCP dependencies.

## Data Flow

```
Agent → MCP tool call (stdio) → local/src/server.ts
                                      ↓
                              core/src/vault.ts (CRUD + search)
                                      ↓
                              vault.db (SQLite + FTS5 + sqlite-vec)
                                      ↓
                              ~/omni/vault/ (markdown files)
```

## Storage Paths

| Concern | Default Path |
|---------|-------------|
| Vault database | `~/.context-mcp/vault.db` |
| Vault markdown files | `~/omni/vault/` (configurable) |
| Config | `~/.context-mcp/config.json` |
| Daemon log | `~/.context-mcp/daemon.log` |

## Deploy Pipeline

Local script, no CI publish step:

1. Update `CHANGELOG.md` with new version section
2. `node scripts/release.mjs patch|minor|major`
3. Script: bump version (root + core + local) -> test -> build -> npm publish -> git tag -> push -> GitHub Release

Published packages:
- `@context-vault/core` (public, used by app/server)
- `context-vault` (public, installed by end users)

## Constraints

- Must work entirely offline (no network for local mode)
- Pre-compiled to JS before shipping (no tsx at runtime, see mcp.md rule)
- Node.js >=22 required
- Markdown files are source of truth, database is derived and rebuildable
- Embedding model runs locally (no API calls for embeddings)

## Key Decisions

- Monorepo with npm workspaces: core (pure engine) + local (CLI/MCP). Allows app/server to use core without CLI deps [2026-02]
- SQLite + FTS5 + sqlite-vec over Postgres/Pinecone: local-first, zero-ops, single file [2026-01]
- Hybrid search (semantic + full-text): catches both exact matches and conceptual similarity [2026-01]
- Tiered storage (durable/working/ephemeral): prevents noise in search results from old events [2026-02]
- Version bump all three package.json files together: avoids version skew [2026-02]
- Markdown frontmatter format for vault files: human-readable, git-diffable, tool-agnostic [2026-01]
