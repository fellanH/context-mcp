# Code Review — Context Vault

**Date:** 2026-02-20
**Scope:** Full codebase — `packages/core`, `packages/local`, `packages/hosted`
**Reviewer:** Claude Opus 4.6 (senior-level, ruthless mode)

**Status:** 5/5 critical issues fixed, 202/202 tests passing.

---

## Summary

The core local MCP server is solid — clean layering, good separation of concerns, and the capture→index→retrieve flow is well-structured. The main problems cluster around:

1. **The hosted layer bolted on top** — encryption partially undermined by plaintext previews, dual import/export routes, per-request McpServer instances carrying dead reindex logic.
2. **Tag filtering is fundamentally broken** — applied post-LIMIT in both search tools.
3. **Kind normalization gap** — save and search disagree on whether plural kinds are valid.
4. **Legacy mode accumulating dead paths** — shared-DB mode has a real bug (deleteVec with wrong ID type) that nobody hit because everyone's on per-user mode.

The codebase would benefit most from fixing the tag/kind bugs (they affect every user), removing the dead cipher in crypto.js, and deciding whether legacy shared-DB mode is worth maintaining.

---

## CRITICAL — Fix These

### 1. ~~Dead cipher + misleading IV in `encryptEntry`~~ FIXED

**File:** `packages/hosted/src/encryption/crypto.js:71`

```js
const iv = randomBytes(IV_LENGTH);
const cipher = createCipheriv(ALGORITHM, key, iv); // DEAD — never used
const bodyCipher = createCipheriv(ALGORITHM, key, iv); // uses same iv
```

`cipher` is created and never used. The body's IV is generated on line 71 and correctly passed through, but the dead `cipher` object is confusing in a crypto module where every line matters. Crypto code must be unambiguous — dead variables here erode trust in the entire encryption layer.

**Fix:** Delete the unused `cipher` variable. Rename `bodyCipher` to `cipher` or just use `iv` directly with a single cipher.

> **Resolution:** Removed dead `cipher` variable, added clarifying comment for `iv`. `bodyCipher` kept as-is for clarity against `titleCipher`/`metaCipher`.

---

### 2. ~~Account deletion passes entry ID to `deleteVec` instead of rowid~~ FIXED

**File:** `packages/hosted/src/server/management.js:808`

```js
// Legacy mode deletion
for (const entry of entries) {
  if (entry.file_path) try { unlinkSync(entry.file_path); } catch {}
  try { ctx.deleteVec(entry.id); } catch {} // BUG: entry.id is a ULID string, not a rowid
}
```

`deleteVec` calls `BigInt(rowid)` internally (`db.js:252`). Passing a ULID string like `"01HX..."` throws `SyntaxError: Cannot convert ... to a BigInt`. The `try/catch` silently swallows this, so every account deletion in legacy mode leaks orphaned vector rows forever.

**Fix:** Look up the rowid first: `const r = ctx.stmts.getRowid.get(entry.id); if (r?.rowid) ctx.deleteVec(Number(r.rowid));`

> **Resolution:** Changed SELECT to include `rowid`, use `entry.rowid` directly instead of `entry.id`.

---

### 3. ~~Tag filtering applied after SQL LIMIT — silently drops results~~ FIXED

**Files:** `packages/core/src/server/tools.js:159-164` (get_context), `tools.js:376-381` (list_context)

In both `get_context` and `list_context`, tags are filtered in JS after the DB query with its LIMIT:

```js
const rows = ctx.db.prepare(`... LIMIT ?`).all(...params); // e.g. 20 rows
const filtered = tags?.length
  ? rows.filter(r => {
      const entryTags = r.tags ? JSON.parse(r.tags) : [];
      return tags.some(t => entryTags.includes(t));
    })
  : rows;
```

If you request `limit: 10, tags: ["important"]` and only 2 of the first 10 results have that tag, you get 2 results — even though rows 11-100 might have 8 more matches. This silently drops results and makes tag filtering unreliable.

**Impact:** Affects every user who passes tags to `get_context` or `list_context`.

**Fix:** Either move tag filtering into SQL (requires schema change — tags are JSON strings), or fetch a larger result set before filtering and re-apply limit after, or switch to a junction table for tags.

> **Resolution:** When tags are provided, `fetchLimit = effectiveLimit * 10` over-fetches from DB/search, then `.slice(0, effectiveLimit)` is applied after tag filtering. Applied to both `get_context` (hybrid search + filter-only paths) and `list_context`.

---

### 4. ~~Kind normalization mismatch between save and search~~ FIXED

**Files:** `packages/core/src/server/tools.js:287-290` (save_context) vs `tools.js:113` (get_context)

`save_context` validates kind with `ensureValidKind` (only checks regex format `^[a-z][a-z0-9_-]*$`), then stores the raw kind string. `get_context` normalizes via `normalizeKind(kind)` which maps known plurals to singulars (`"insights"` → `"insight"`).

So saving with `kind: "insights"` stores the DB row with `kind = "insights"`, but searching with `kind: "insights"` filters by `kind = "insight"` — they will never match.

**Impact:** Any user who accidentally uses a plural kind name creates orphaned entries invisible to search.

**Fix:** Normalize kind in `save_context` before writing: `const normalizedKind = normalizeKind(kind);` and use that throughout.

> **Resolution:** Added `const normalizedKind = normalizeKind(kind)` early in the create path. All downstream uses (`categoryFor`, `captureAndIndex`, response message) use `normalizedKind`.

---

### 5. ~~Hardcoded version `"0.1.0"` in hosted MCP server~~ FIXED

**File:** `packages/hosted/src/index.js:118`

```js
const server = new McpServer(
  { name: "context-vault-hosted", version: "0.1.0" }, // hardcoded
```

`pkgVersion` is read from `package.json` on line 108 but not used here. Clients see stale version info.

**Fix:** Replace `"0.1.0"` with `pkgVersion`.

> **Resolution:** Replaced hardcoded `"0.1.0"` with `pkgVersion` variable (already read from package.json on line 108).

---

## HIGH — Architectural Concerns

### 6. Plaintext body preview defeats encryption

**File:** `packages/core/src/index/index.js:61`

```js
const bodyPreview = body.slice(0, 200);
ctx.stmts.insertEntryEncrypted.run(
  id, userIdVal, kind, cat, title || null, bodyPreview, // plaintext in body column
  ...
);
```

The FTS index sees and stores the first 200 chars of every "encrypted" entry in plaintext. The title is also stored unencrypted (documented trade-off for FTS). This means "encrypted at rest" is partially misleading — a significant portion of the entry content is readable without the DEK.

Anyone with database file access can read titles and first 200 chars of every entry without any key material.

**Recommendation:** Document this prominently in security docs. Consider whether FTS over encrypted content is worth the trade-off, or offer a mode where FTS is disabled and only semantic search (via embeddings, which are not reversible) is used.

---

### 7. Status display says schema v6, actual is v7

**File:** `packages/core/src/server/tools.js:547`

```js
`Schema:    v6 (multi-tenancy)`,
```

The DDL comment in `db.js:72` says `v7 — teams` and migrations go up to v7. Users running `context_status` see stale schema info.

**Fix:** Change to `v7 (teams)` or derive from `db.pragma("user_version")`.

---

### 8. Double `initMetaDb` call at startup

**File:** `packages/hosted/src/index.js:95-96`

```js
initMetaDb(metaDbPath);                        // return value discarded
prepareMetaStatements(initMetaDb(metaDbPath));  // called again
```

First call is wasted. The second call re-initializes and returns the DB to `prepareMetaStatements`. This works because init is idempotent, but it's sloppy and confusing.

**Fix:** `const metaDb = initMetaDb(metaDbPath); prepareMetaStatements(metaDb);`

---

### 9. `resolvedFrom` is misleading

**File:** `packages/core/src/core/config.js:39-79`

Each resolution step overwrites `resolvedFrom`. If env sets `vaultDir` and CLI sets `dbPath`, it reports `"CLI args"` even though most config came from defaults/env. This field suggests "where the final config came from" but actually means "which resolution step ran last."

**Fix:** Either track per-field provenance (`vaultDirFrom: "env"`, `dbPathFrom: "CLI args"`) or rename to `lastOverrideSource` to set correct expectations.

---

## MEDIUM — Code Quality / Design Drift

### 10. `tools.js` is a 605-line registration monolith

**File:** `packages/core/src/server/tools.js`

All 7+ tool handlers are defined inside a single `registerTools()` function, each with inline business logic, formatting, and error handling. The auto-reindex state machine (5 variables: `reindexDone`, `reindexPromise`, `reindexAttempts`, `reindexFailed`, `MAX_REINDEX_ATTEMPTS`) is closed over in the same scope.

This makes testing individual tools impossible without going through the MCP server. Each handler is 30-80 lines with formatting, validation, and query logic interleaved.

**Recommendation:** Extract each tool handler into a named function. Extract auto-reindex into its own module. Extract the markdown response formatting into a formatter.

---

### 11. `ctx` is an untyped grab-bag

Depending on mode, ctx may contain any subset of: `{db, config, stmts, embed, insertVec, deleteVec, activeOps, userId, teamId, encrypt, decrypt, checkLimits}`. No interface, no validation. A function receiving `ctx` has no way to know which properties it can rely on.

The "module convention" boundary noted in STRATEGY.md is just developer discipline — nothing enforces it. Passing a local-mode ctx (no `encrypt`) to code that expects hosted-mode ctx (with `encrypt`) fails silently.

**Recommendation:** At minimum, add JSDoc `@typedef` for the ctx shapes. Ideally, validate ctx shape at construction time with a factory function per mode.

---

### 12. `captureAndIndex` receives `indexEntry` as a callback — always the same one

**Files:** `packages/core/src/server/tools.js:313`, `packages/core/src/capture/index.js:130`

```js
const entry = await captureAndIndex(ctx, data, indexEntry);
```

`indexEntry` is always the same function. It's passed as a parameter in every call site across the codebase (tools.js, import-pipeline.js, sync.js, vault-api.js, management.js). This indirection was presumably for testability, but it's never substituted with anything else.

**Recommendation:** Either use it for testing (add tests that substitute a mock), or remove the parameter and import `indexEntry` directly inside `captureAndIndex`.

---

### 13. Manual transaction management in `reindex` with async operations

**File:** `packages/core/src/index/index.js:150-294`

Uses `db.exec("BEGIN")` / `db.exec("COMMIT")` instead of better-sqlite3's `db.transaction()` because the function is async (embedding calls await). This works, but if any code path throws between BEGIN and COMMIT without hitting the catch block, the transaction stays open.

The async-in-sync-transaction tension is a known pain point with better-sqlite3. Currently safe because:
- Local mode: single-threaded stdio transport, no concurrent requests
- Hosted mode: per-user DB isolation, reindex is skipped

But if either assumption changes, this becomes a real problem.

**Recommendation:** Document prominently. Consider restructuring to separate sync DB ops from async embed ops — collect all texts that need embedding, COMMIT the transaction, then batch-embed outside the transaction, then INSERT vectors in a second transaction.

---

### 14. Duplicate vault import/export routes

**Files:** `packages/hosted/src/routes/vault-api.js` + `packages/hosted/src/server/management.js`

Both files define import/export endpoints:

| Route | vault-api.js | management.js |
|-------|-------------|---------------|
| Import | `POST /api/vault/import/bulk` | `POST /api/vault/import` |
| Export | `GET /api/vault/export` | `GET /api/vault/export` |

Two export endpoints with different authorization and formatting logic. The management version checks tier limits for export; the vault-api version doesn't. Both are mounted under the same Hono app — Hono matches the first registered route for identical paths.

**Recommendation:** Consolidate into one location. The duplicate `/api/vault/export` is a latent bug — one will shadow the other depending on mount order.

---

### 15. `buildUserCtx` called per-request in hosted mode

**File:** `packages/hosted/src/routes/vault-api.js` (every endpoint)

Every REST endpoint calls `await buildUserCtx(ctx, user, masterSecret)`. In per-user DB mode, this hits the pool (fast if cached), but also:
- Allocates new closure objects for `encrypt`, `decrypt`, `checkLimits` each time
- Calls `prepareMetaStatements(getMetaDb())` on every DEK lookup via `vault-crypto.js:64`

This is per-request overhead that scales with traffic. The closures are cheap, but the meta DB prepared statement re-preparation is unnecessary.

**Recommendation:** Cache the DEK lookup result more aggressively, or build userCtx once per connection rather than per request.

---

## LOW — Nits

### 16. ULID uses `Math.random()`

**File:** `packages/core/src/core/files.js:25`

The random portion of ULIDs uses `Math.random()`, which is not cryptographically secure. Fine for identifiers (which they are), but if ULIDs are ever used for anything security-sensitive, this would be a problem.

---

### 17. HTML-to-markdown via regex

**File:** `packages/core/src/capture/ingest-url.js:19-75`

Known fragile pattern. Nested tags, attributes containing `>`, self-closing tags in non-void elements will produce garbage. The `<article>` / `<main>` extraction also uses non-greedy regex which fails on nested elements of the same type.

Acceptable for "good enough" URL ingestion, but will produce bad results on complex pages (SPAs, deeply nested layouts, attribute-heavy frameworks).

---

### 18. Frontmatter parser handles only single-line values

**File:** `packages/core/src/core/frontmatter.js:29-50`

Multi-line YAML values, nested objects, and block scalars are silently dropped or misread. The format is "YAML-like" but not YAML. Fine since you control both read and write paths, but will silently corrupt any hand-edited files that use real YAML features (multi-line descriptions, nested metadata objects).

---

### 19. `reindex` does per-kind table scans

**File:** `packages/core/src/index/index.js:160`

```js
const dbRows = ctx.db.prepare("SELECT id, file_path, body, title, tags, meta FROM vault WHERE kind = ?").all(kind);
```

For each discovered kind directory, it does a full scan filtered by kind. With N kinds, this is N scans. A single query grouping by kind or indexed by `file_path` would be more efficient. Irrelevant at current scale but will matter if vaults grow to thousands of entries.

---

### 20. Per-request McpServer in hosted mode carries dead reindex logic

**File:** `packages/hosted/src/index.js:116-124`, `packages/core/src/server/tools.js:61`

Each HTTP request creates a fresh `McpServer`, which calls `registerTools`, which sets up the auto-reindex state machine. But in hosted mode, `userId !== undefined` is always true, so `reindexDone` is immediately set to `true` on line 61:

```js
let reindexDone = userId !== undefined ? true : false;
```

The entire reindex state machine (5 variables, retry logic, promise tracking) is instantiated and immediately short-circuited on every request. Pure dead code in hosted context.

---

## Appendix: Files Reviewed

### packages/core/src/ (19 files)
- `index.js` — barrel exports
- `core/config.js` — CLI arg parsing, config resolution
- `core/files.js` — ULID, slugify, kind/dir mapping, walkDir, safeJoin
- `core/frontmatter.js` — YAML-like frontmatter parser/formatter
- `core/categories.js` — kind→category static mapping
- `core/status.js` — vault diagnostics data gathering
- `capture/index.js` — writeEntry, updateEntryFile, captureAndIndex
- `capture/file-ops.js` — writeEntryFile (disk operations)
- `capture/formatters.js` — kind-specific markdown body templates
- `capture/importers.js` — format detection + parsers (md, csv, json, text)
- `capture/import-pipeline.js` — batch import orchestrator
- `capture/ingest-url.js` — URL fetch + HTML→markdown
- `index/db.js` — schema DDL, initDatabase, prepareStatements, vec helpers
- `index/embed.js` — HuggingFace transformers embedding
- `index/index.js` — indexEntry (single) + reindex (bulk sync)
- `retrieve/index.js` — hybridSearch (FTS5 + vector similarity)
- `server/tools.js` — MCP tool registrations (7 tools)
- `server/helpers.js` — ok/err response helpers, validation
- `sync/sync.js` — bidirectional sync protocol

### packages/local/src/ (1 file)
- `server/index.js` — stdio MCP server entry point

### packages/hosted/src/ (14 files)
- `index.js` — Hono HTTP server, MCP over Streamable HTTP
- `server/ctx.js` — shared context construction
- `server/user-ctx.js` — per-user context builder
- `server/user-db.js` — LRU connection pool for per-user SQLite
- `server/management.js` — REST API (auth, billing, teams, GDPR)
- `routes/vault-api.js` — REST API (CRUD, search, import/export)
- `encryption/crypto.js` — AES-256-GCM primitives
- `encryption/keys.js` — scrypt key derivation, DEK management
- `encryption/vault-crypto.js` — bridge between vault entries and crypto
- `middleware/auth.js` — bearer token authentication
- `middleware/rate-limit.js` — rate limiting
- `middleware/logger.js` — structured JSON request logging
- `billing/stripe.js` — Stripe checkout, webhooks, tier limits
- `validation/entry-validation.js` — input validation
