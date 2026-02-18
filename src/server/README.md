# Server (Coordinator)

The MCP server entry point. This is the only place where layers cross. It wires together Capture, Index, and Retrieve into MCP tool handlers.

## Coordinator Pattern

Each tool handler orchestrates layers sequentially:

```
save_context → writeEntry(ctx, data)      [Capture Layer]
             → indexEntry(ctx, entry)      [Index Layer]

get_context  → hybridSearch(ctx, query)    [Retrieve Layer]
```

No layer calls another layer directly — the server coordinates all cross-layer operations.

## Auto-Reindex

On the first tool call per session, the server runs a full reindex to ensure the search index matches the files on disk. This is transparent to the agent — no manual reindex tool needed.

## Context Object (`ctx`)

Bundles shared state passed to all layers:

```js
{ db, config, stmts, embed, insertVec, deleteVec }
```

## MCP Tools

| Tool | Layers Used | Description |
|------|-------------|-------------|
| `get_context` | Retrieve | Hybrid FTS5 + vector search |
| `save_context` | Capture → Index | Write-through knowledge capture |
| `context_status` | Core (status) | Diagnostics |

## Dependency Rule

```
server/ → core/, capture/, index/, retrieve/ (all layers)
```

This is the only module allowed to import across layer boundaries.
