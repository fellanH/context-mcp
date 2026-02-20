# QA Report — Context Vault Monorepo

**Date:** 2026-02-20
**Version:** 2.5.0
**Commit:** `7326b3b` (main)
**Last updated:** 2026-02-20 — P0 + P1 fixes applied

---

## 1. Test Suite

| Metric | Result |
|--------|--------|
| Test files | **18/18 passed** |
| Test cases | **202/202 passed** |
| Duration | 3.80s |
| Failures | 0 |

### Breakdown by File

| File | Tests | Time |
|------|-------|------|
| `test/unit/encryption.test.js` | 16 | 682ms |
| `test/unit/importers.test.js` | 24 | 9ms |
| `test/unit/migration.test.js` | 13 | 3ms |
| `test/unit/ingest-url.test.js` | 18 | 10ms |
| `test/unit/files.test.js` | 12 | 6ms |
| `test/unit/billing.test.js` | 10 | 6ms |
| `test/unit/turso.test.js` | 9 | 24ms |
| `test/unit/frontmatter.test.js` | 9 | 7ms |
| `test/unit/categories.test.js` | 6 | 6ms |
| `test/unit/onboarding.test.js` | 4 | 4ms |
| `test/unit/format.test.js` | 3 | 17ms |
| `test/integration/hosted-auth.test.js` | 31 | 3280ms |
| `test/integration/cli-setup.test.js` | 12 | 3287ms |
| `test/integration/sync.test.js` | 11 | 803ms |
| `test/integration/roundtrip.test.js` | 10 | 773ms |
| `test/integration/list.test.js` | 7 | 842ms |
| `test/integration/hosted.test.js` | 4 | 1838ms |
| `test/integration/feedback.test.js` | 3 | 546ms |

---

## 2. Build Validation

| Package | Status | Notes |
|---------|--------|-------|
| App (`packages/app`) | Pass | Vite build, no errors |
| Marketing (`packages/marketing`) | Pass | Vite build, 3 output files |
| Extension (`packages/extension`) | Pass | 4-step custom build pipeline |
| TypeScript (extension) | Pass | Zero type errors |

### Gaps

- **No ESLint config** exists in the monorepo. No automated linting.
- **No `tsconfig.json`** in `packages/app` — TypeScript checking unavailable for the app package.

---

## 3. Dependency Health

### 3.1 Vulnerabilities

| Package | Severity | Issue | Status |
|---------|----------|-------|--------|
| ~~`hono` < 4.11.10~~ | ~~Low~~ | ~~Timing comparison not hardened in `basicAuth`/`bearerAuth`~~ | **FIXED** — patched via `npm audit fix` (4.11.9 → 4.12.0) |
| `minimatch` < 10.2.1 | **High** | ReDoS via repeated wildcards ([GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26)) | **Deferred** — transitive via `@sentry/node` in hosted package; requires upstream Sentry patch |
| `@sentry/node` ≥ 9.21.0 | **High** | Depends on vulnerable `minimatch` | **Deferred** — actively used in `hosted` (`instrument.js`, `index.js`); cannot remove. Redundant root declaration removed. |

### 3.2 Outdated Packages (Major)

| Package | Current | Latest | Scope |
|---------|---------|--------|-------|
| `react` | 18.3.1 | 19.2.4 | app, extension, marketing |
| `react-dom` | 18.3.1 | 19.2.4 | app, extension, marketing |
| `vite` | 6.4.1 | 7.3.1 | app, extension, marketing |
| `vitest` | 3.2.4 | 4.0.18 | root |
| `@vitejs/plugin-react` | 4.7.0 | 5.1.4 | app, extension, marketing |
| `stripe` | 17.7.0 | 20.3.1 | hosted |
| `date-fns` | 3.6.0 | 4.1.0 | app |
| `react-resizable-panels` | 2.1.7 | 4.6.4 | app |

### 3.3 Outdated Packages (Minor/Patch — Safe to Update)

| Package | Current | Latest | Scope |
|---------|---------|--------|-------|
| ~~`hono`~~ | ~~4.11.9~~ | ~~4.12.0~~ | ~~hosted~~ — **UPDATED** |
| `tailwindcss` | 4.1.12 | 4.2.0 | app, marketing |
| `@tailwindcss/vite` | 4.1.12 | 4.2.0 | app, marketing |
| `tailwind-merge` | 3.2.0 | 3.5.0 | app, marketing |
| `lucide-react` | 0.487.0 | 0.575.0 | app, marketing |
| `motion` | 12.23.24 | 12.34.3 | app |
| `sonner` | 2.0.3 | 2.0.7 | app |
| `react-hook-form` | 7.55.0 | 7.71.1 | app |
| `sharp` | 0.33.5 | 0.34.5 | extension |
| `@libsql/client` | 0.14.0 | 0.17.0 | hosted |

### 3.4 Dependency Tree

No broken, invalid, or duplicate dependencies. All `UNMET OPTIONAL DEPENDENCY` entries are platform-specific optional binaries (expected on macOS).

---

## 4. Code Audit

### 4.1 Critical

#### C1 — Vector deletion uses ULID instead of rowid — RESOLVED (pre-existing fix)

**File:** `packages/hosted/src/server/management.js:805`
**Status:** Already fixed in current code. The query selects `rowid` and passes `Number(entry.rowid)` to `deleteVec`.

#### C2 — Team-scoped search silently ignores team filter — FIXED

**File:** `packages/core/src/retrieve/index.js`
**Fix:** Added `teamIdFilter` support to `buildFilterClauses()` and `hybridSearch()`. The filter is now applied in both the FTS SQL query (via `e.team_id = ?`) and the vector post-filter. Vec limits are also increased when team filtering is active to compensate for post-filtering.

#### C3 — Duplicate export routes with inconsistent tier checks — FIXED

**Files:** `packages/hosted/src/server/management.js` (line ~867) and `packages/hosted/src/routes/vault-api.js`
**Fix:** Removed the unguarded duplicate route from `vault-api.js`. The authoritative route in `management.js` (with Pro tier check and proper decryption) is now the only export endpoint.

#### C4 — Manual transaction wrapping async operations

**File:** `packages/core/src/index/index.js:150-294`

The `reindex()` function uses manual `BEGIN`/`COMMIT` with async `embedBatch()` calls inside. If the process is killed between `BEGIN` and `COMMIT`, the database can be left in a dirty state. A long-running reindex with thousands of embeddings holds a write lock for minutes.

### 4.2 Warnings

#### W1 — Race condition in auto-reindex — FIXED

**File:** `packages/core/src/server/tools.js:67-90`
**Fix:** The `reindex()` promise is now assigned to `reindexPromise` synchronously before the async work begins. A second concurrent call to `ensureIndexed()` will see the promise immediately and await it instead of starting a second reindex.

#### W2 — No input size limits on local MCP tools

**File:** `packages/core/src/server/tools.js`

The hosted package has `entry-validation.js` with proper limits (100KB body, 500-char title, etc.), but the core `registerTools()` used by the local server has no validation limits. A malicious or buggy MCP client could send a multi-GB body string and exhaust memory.

#### W3 — `eventDecayDays: 0` rejected by truthy check — FIXED

**File:** `packages/core/src/core/config.js`
**Fix:** Changed all three `eventDecayDays` checks (config file line 51, env vars line 69, CLI args line 79) from truthy checks to `!= null` / `?? null` so that `0` is accepted as a valid value.

#### W4 — OAuth state cookie missing `Secure` flag — FIXED

**File:** `packages/hosted/src/server/management.js:193`
**Fix:** Added `Secure` flag to both the set (line 193) and clear (line 226) `oauth_state` cookie headers.

#### W5 — Schema version hardcoded as "v6" in status output

**File:** `packages/core/src/server/tools.js:547`

The `context_status` tool reports `Schema: v6 (multi-tenancy)` but the actual schema is v7 (teams support). Misleading for diagnostics.

#### W6 — Billing usage query inconsistency in per-user DB mode

**File:** `packages/hosted/src/server/management.js:410-411`

In per-user DB mode, the usage query includes `WHERE user_id = ? OR user_id IS NULL`, which could count orphan entries. The `user-ctx.js` check correctly uses `SELECT COUNT(*) FROM vault` without a WHERE clause, creating an inconsistency.

#### W7 — Stale `prepareMetaStatements()` singleton

**File:** `packages/hosted/src/auth/meta-db.js:157-253`

Prepared statements are cached in a module-level singleton. If `initMetaDb()` is called with a different `dbPath` (e.g., in tests), the cached statements still reference the old DB.

#### W8 — `initMetaDb()` called twice at startup

**File:** `packages/hosted/src/index.js:95-96`

```js
initMetaDb(metaDbPath);
prepareMetaStatements(initMetaDb(metaDbPath));
```

The second call returns early (harmless), but the first call's return value is unused. Suggests incomplete refactor.

#### W9 — ULID uses `Math.random()` instead of crypto

**File:** `packages/core/src/core/files.js:15-28`

ULIDs used as primary keys and in URL paths are generated with `Math.random()`. Not security-critical in this context, but `crypto.randomBytes()` would prevent enumeration attacks on the hosted API.

#### W10 — Frontmatter parser does not handle multi-line YAML values

**File:** `packages/core/src/core/frontmatter.js:24-52`

The hand-rolled YAML parser splits on newlines and processes each line independently. Multi-line YAML values (block scalars with `|` or `>`) will be silently misinterpreted. Acceptable for system-generated frontmatter but could corrupt user-edited files.

### 4.3 Info

| ID | Issue | File |
|----|-------|------|
| I1 | Dead `cipher` variable in `encryptEntry()` — created but never used | `hosted/src/encryption/crypto.js:71-72` |
| I2 | Duplicated `extractCustomMeta()` with slightly different reserved key sets | `core/src/core/frontmatter.js` vs `hosted/src/migration/migrate.js` |
| I3 | `context_status` tool not wrapped in `tracked()` — won't timeout or track in `activeOps` | `core/src/server/tools.js:531` |
| I4 | `walkDir` silently ignores directories starting with `_` — undocumented convention | `core/src/core/files.js:106` |
| I5 | OAuth callback passes API key and encryption secret via URL fragment — appears in browser history | `hosted/src/server/management.js:317` |
| I6 | `/api/vault/export` loads all entries into memory — no streaming or pagination for large vaults | `hosted/src/server/management.js:867+` |
| I7 | HTML-to-markdown regex parser can truncate nested `<article>` tags | `core/src/capture/ingest-url.js` |

---

## 5. Test Coverage Analysis

### 5.1 Well-Covered Modules

| Module | Test File | Verdict |
|--------|-----------|---------|
| `categories.js` | `test/unit/categories.test.js` | Excellent — all functions, edge cases |
| `files.js` (partial) | `test/unit/files.test.js` | Good — `slugify`, `normalizeKind`, `kindToDir`, `dirToKind`, `kindToPath` |
| `frontmatter.js` | `test/unit/frontmatter.test.js` | Good — roundtrip serialization, special characters |
| `importers.js` | `test/unit/importers.test.js` | Excellent — all 6 exported functions, edge cases |
| `ingest-url.js` (HTML parsing) | `test/unit/ingest-url.test.js` | Good — 13 `htmlToMarkdown` cases, 5 `extractHtmlContent` cases |
| `crypto.js` + `keys.js` | `test/unit/encryption.test.js` | Excellent — roundtrips, wrong key, tampered data, unique IVs |
| `turso.js` | `test/unit/turso.test.js` | Good — schema, CRUD, FTS triggers, encrypted columns |
| `billing.js` (tier logic) | `test/unit/billing.test.js` | Good — all tiers, boundary conditions |
| Roundtrip integration | `test/integration/roundtrip.test.js` | Excellent — full lifecycle: save → search → update → delete |
| Hosted auth integration | `test/integration/hosted-auth.test.js` | Outstanding — 31 tests covering registration, auth, encryption, multi-user isolation, tier limits, account deletion |
| Sync planning | `test/integration/sync.test.js` | Excellent — 9 scenarios including large manifests, deduplication |

### 5.2 Modules With No Tests (by risk)

| Risk | Module | Why It Matters |
|------|--------|----------------|
| **High** | `hybridSearch` (`core/src/retrieve/index.js`) | Core retrieval engine — FTS query building, score normalization, recency decay, filter combinations |
| **High** | `config.js` (`core/src/core/config.js`) | 4-layer resolution chain (defaults → file → env → CLI) — common source of bugs |
| **High** | `safeJoin` / `safeFolderPath` (`core/src/core/files.js`, `core/src/capture/file-ops.js`) | Security-critical path traversal guards |
| **High** | `entry-validation.js` (`hosted/src/validation/`) | All input size limits for hosted — 7 field validators |
| **High** | `writeEntry` validation (`core/src/capture/index.js`) | Input validation for kind, body, tags, meta type checks |
| **High** | `indexEntry` / `reindex` (`core/src/index/index.js`) | Entity upsert, encrypted insert, batch embedding, expired entry pruning |
| **High** | `db.js` schema migrations (`core/src/index/db.js`) | v5 → v6 → v7 migration paths |
| **High** | `meta-db.js` (`hosted/src/auth/meta-db.js`) | 40+ prepared statements for user/key/usage/team management |
| **High** | `UserDbPool` (`hosted/src/server/user-db.js`) | LRU connection pool — eviction, idle sweep, concurrency |
| **Medium** | Split-authority encryption (`hosted/src/encryption/keys.js`) | `generateDekSplitAuthority`, `decryptDekSplitAuthority`, `getUserDekAuto` |
| **Medium** | REST vault-api routes (`hosted/src/routes/vault-api.js`) | 10 endpoints — separate code path from MCP tools |
| **Medium** | Team management routes (`hosted/src/server/management.js`) | 7 team routes (create, list, get, invite, join, remove, usage) |
| **Medium** | `r2-backup.js` (`hosted/src/backup/`) | Backup scheduling, restore, pruning |
| **Medium** | `embed.js` (`core/src/index/embed.js`) | Graceful degradation, batch validation, health-check re-init |
| **Medium** | `ingestUrl` async function (`core/src/capture/ingest-url.js`) | HTTP fetch, timeout handling, content-type detection |
| **Low** | `status.js`, `formatters.js`, `helpers.js` | Simple utilities tested indirectly |

### 5.3 Test Quality Issues

1. **`migration.test.js` re-implements source functions inline** instead of importing from `packages/hosted/src/migration/migrate.js`. Tests validate the test's own logic, not production code.

2. **`cli-setup.test.js` simulates behavior** by manually performing file operations rather than calling the actual `configureJsonTool` function.

3. **`list.test.js` uses raw SQL** instead of calling the `list_context` MCP tool handler — misses tool handler logic (normalization, tag post-filtering, pagination, encrypted entry handling).

4. **No negative/error-path tests** for core functions: `writeEntry` validation, `captureAndIndex` rollback, `indexEntry` UNIQUE constraint fallback, `hybridSearch` with malformed FTS queries, `reindex` with corrupt frontmatter.

5. **No concurrency tests** for `UserDbPool` (LRU pool), auto-reindex (shared promise), or `tracked` wrapper (`activeOps` counter).

---

## 6. Recommended Actions

### Immediate (bugs / security)

| Priority | Action | Issue | Status |
|----------|--------|-------|--------|
| **P0** | ~~Fix vector deletion to use `rowid` instead of ULID `id`~~ | C1 | **RESOLVED** (pre-existing fix) |
| **P0** | ~~Implement `teamIdFilter` in `hybridSearch`~~ | C2 | **FIXED** — added to `buildFilterClauses`, signature, and vec post-filter |
| **P0** | ~~Deduplicate export routes or add tier check to both~~ | C3 | **FIXED** — removed unguarded route from `vault-api.js` |
| **P1** | ~~Run `npm audit fix` to patch `hono` timing vulnerability~~ | Dep vuln | **FIXED** — hono 4.11.9 → 4.12.0 |
| **P1** | ~~Evaluate `@sentry/node` vulnerability~~ | Dep vuln | **RESOLVED** — actively used in hosted; removed redundant root declaration; minimatch vuln deferred to upstream |

### Short-term (stability)

| Priority | Action | Issue | Status |
|----------|--------|-------|--------|
| **P1** | ~~Add mutex/guard to prevent concurrent `reindex()` calls~~ | W1 | **FIXED** — promise assigned synchronously |
| **P1** | ~~Fix `eventDecayDays: 0` truthy check~~ | W3 | **FIXED** — all 3 layers use `!= null` |
| **P1** | ~~Add `Secure` flag to OAuth state cookie~~ | W4 | **FIXED** — set + clear headers |
| **P2** | Update schema version string from "v6" to "v7" in status output | W5 | Open |
| **P2** | Add input size limits to local MCP tools | W2 | Open |
| **P2** | Remove dead `cipher` variable in `encryptEntry()` | I1 | Open |

### Medium-term (test coverage)

| Priority | Action | Coverage Gap |
|----------|--------|-------------|
| **P1** | Add unit tests for `hybridSearch` (FTS query building, scoring, filters) | Core retrieval engine |
| **P1** | Add unit tests for `safeJoin` / `safeFolderPath` (path traversal) | Security guards |
| **P2** | Add unit tests for `config.js` resolution chain | Startup config |
| **P2** | Add unit tests for `entry-validation.js` field validators | Input validation |
| **P2** | Add unit tests for `writeEntry` validation paths | Capture layer |
| **P2** | Add unit tests for split-authority encryption functions | Security |
| **P3** | Add unit tests for `UserDbPool` (LRU, eviction, concurrency) | Connection management |
| **P3** | Add REST API route tests for `vault-api.js` | HTTP layer |
| **P3** | Add team management route tests | Feature coverage |
| **P3** | Fix `migration.test.js` to import from actual source | Test quality |

### Deferred (upgrades)

| Action | Notes |
|--------|-------|
| React 18 → 19 | Breaking — plan separately |
| Vite 6 → 7 | Breaking — plan separately |
| Vitest 3 → 4 | Breaking — plan separately |
| Stripe 17 → 20 | Breaking — plan separately |
| Update safe minor/patch deps | `tailwindcss`, `lucide-react`, `motion`, `sonner`, `react-hook-form`, Radix packages |
