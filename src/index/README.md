# Index Layer

The sync layer. Owns the SQLite database as a derived index. Handles both single-entry indexing (write-through from capture) and bulk sync (reindex from disk).

## Public API (`index.js`)

```js
indexEntry(ctx, entry)       → Promise<void>   // Index a single entry after capture
reindex(ctx, { fullSync })   → Promise<stats>  // Bulk sync vault dir ↔ database
```

- `indexEntry` — called immediately after `writeEntry()` in the server coordinator. Inserts the row and generates a vector embedding.
- `reindex` — walks the vault directory, diffs against DB state, and adds/updates/removes entries. `fullSync: true` enables updates and deletions; `false` is add-only.

## Internal

| File | Purpose |
|------|---------|
| `db.js` | Schema DDL (v4), `initDatabase()`, `prepareStatements()`, `insertVec()`, `deleteVec()` |
| `embed.js` | HuggingFace `all-MiniLM-L6-v2` embedding via `@huggingface/transformers`. Lazy-loaded singleton. |

## Dependency Rule

```
index/ → core/ (only)
```

Never import from `capture/`, `retrieve/`, or `server/`.
