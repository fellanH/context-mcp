# Core

Shared utilities with zero dependencies on other layers. Every other layer imports from here; this layer imports from nothing except Node.js builtins.

## Modules

| File | Exports | Purpose |
|------|---------|---------|
| `config.js` | `resolveConfig()`, `parseArgs()` | 4-step config resolution: defaults → config file → env vars → CLI args |
| `frontmatter.js` | `formatFrontmatter()`, `parseFrontmatter()`, `parseEntryFromMarkdown()`, `extractCustomMeta()` | YAML frontmatter serialization/deserialization and kind-specific markdown parsing |
| `files.js` | `ulid()`, `slugify()`, `kindToDir()`, `dirToKind()`, `walkDir()` | ID generation, text normalization, kind/directory mapping, recursive `.md` file discovery |
| `status.js` | `gatherVaultStatus(ctx)` | Collects diagnostic data: file counts, DB size, stale path detection, kind counts |

## Dependency Rule

```
core/ → node:fs, node:path, node:os (only)
```

Never import from `capture/`, `index/`, `retrieve/`, or `server/`.
