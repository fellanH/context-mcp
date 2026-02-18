# Capture Layer

The write path. Creates `.md` files in the vault directory with YAML frontmatter. That is its entire job — it does not index, embed, or query.

## Public API (`index.js`)

```js
writeEntry(ctx, { kind, title, body, meta, tags, source, folder })
  → { id, filePath, kind, title, body, meta, tags, source, createdAt }

captureAndIndex(ctx, data, indexFn)
  → Promise<entry>  // Writes file, indexes, rolls back file on index failure
```

`captureAndIndex` is the primary entry point used by `save_context`. It writes the file via `writeEntry`, then calls the provided `indexFn`. If indexing fails, the file is deleted to maintain consistency.

## Dependency Rule

```
capture/ → core/ (only)
```

Never import from `index/`, `retrieve/`, or `server/`.
