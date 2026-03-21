# Context Vault MCP Server — Product Requirements

## Problem

AI agents have no persistent memory. Every session starts blank. Users re-explain context, preferences, and prior discoveries every time. Existing memory solutions are cloud-only, vendor-locked, or require giving up data ownership.

## Target Users

1. Developers using AI coding tools (Claude Code, Cursor, Windsurf) who want persistent context across sessions
2. Developers building AI agents who need a memory layer
3. Power users who want full control over their data (local files, no cloud dependency)

## Functional Requirements

### MCP Tools
- `save_context`: create or update a vault entry with title, body, tags, kind, tier, category
- `get_context`: hybrid search (semantic embeddings + FTS5 full-text) with tag filtering, tier scoping, and similarity ranking
- `list_context`: browse entries by kind, tags, date range
- `delete_context`: remove an entry by ID

### Storage
- Markdown files in `~/omni/vault/` as source of truth (git-versioned, human-readable)
- SQLite database (`~/.context-mcp/vault.db`) as derived index with FTS5 + sqlite-vec embeddings
- Rebuildable: `context-vault reindex` reconstructs the DB from markdown files

### CLI
- `context-vault setup`: configure MCP in Claude Code / Cursor settings
- `context-vault reindex`: rebuild database from vault files
- `context-vault export`: export vault entries
- `context-vault import`: import vault entries
- `context-vault sync`: manual immediate indexing

### Deduplication
- Similarity detection on save using `conflict_resolution: "suggest"` (default)
- Returns SKIP/UPDATE suggestions for near-duplicate entries (>0.95 similarity)

### Tiered Search
- Hot/cold scope: `default` searches durable + working tiers, `all` includes ephemeral and events
- Allows agents to surface relevant context without noise from historical records

### Categories and Kinds
- Kinds: knowledge, decision, insight, pattern, event, reference
- Categories: user-defined strings for custom organization
- Tags: freeform, with `bucket:<project>` convention for scoping

## Data Model

### Entry
- `id`: UUID
- `title`: string (required)
- `body`: markdown text
- `kind`: knowledge | decision | insight | pattern | event | reference
- `category`: string
- `tags`: string[]
- `tier`: durable | working | ephemeral
- `created_at`, `updated_at`: timestamps
- `meta`: JSON (arbitrary metadata)
- `embedding`: float[] (computed from body via local embedding model)

## User Flows

### First Install
1. User runs `npx context-vault@latest setup`
2. CLI detects Claude Code / Cursor and configures MCP settings
3. Next agent session: `save_context` and `get_context` tools are available

### Save and Retrieve
1. Agent discovers something useful during a session
2. Calls `save_context(title, body, tags: ["bucket:project"], kind: "insight")`
3. Server writes markdown file to vault, indexes in SQLite
4. Later session: agent calls `get_context(query: "that useful thing")`
5. Server returns ranked results from hybrid search

### Release
1. Update CHANGELOG.md with new version section
2. Run `node scripts/release.mjs patch|minor|major`
3. Script bumps version in root + core + local package.json
4. Runs tests, builds, publishes to npm (`@context-vault/core` + `context-vault`)
5. Creates git tag, pushes, creates GitHub Release with changelog notes

## Success Criteria

- `npx context-vault setup` works in <60 seconds with zero manual configuration
- Hybrid search returns relevant results for natural language queries
- Vault survives server crashes (markdown files are source of truth)
- No network required for local mode
- Embedding generation does not block save operations noticeably (<500ms)

## Scope Boundaries

### Out of Scope
- Hosted/cloud sync (handled by app/server)
- Web UI for browsing entries (handled by app/)
- Browser extension integration (handled by extension/)
- Real-time collaboration
- Non-MCP protocols
