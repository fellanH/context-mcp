# Retrieve Layer

The read path. All query logic lives here — hybrid search and any future retrieval strategies.

## Public API (`index.js`)

```js
hybridSearch(ctx, query, { kindFilter, limit, offset })  → Promise<Array<result>>
```

Runs both FTS5 text matching and vector cosine similarity, merges scores with recency weighting, and returns results sorted by combined relevance.

## Dependency Rule

```
retrieve/ → core/ (allowed but currently unused)
```

Read-only access to the database via `ctx.db`. Never imports from `capture/`, `index/`, or `server/`.
