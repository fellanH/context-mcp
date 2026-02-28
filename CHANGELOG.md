# Changelog

All notable changes to context-vault are documented here.

## [2.17.0] — 2026-02-28

### Added

- Issue #168: Tiered search — event category entries are excluded from default `get_context` queries. Events remain accessible via explicit `include_events: true` parameter or category/tag filter-only queries. Reduces noise in agent RAG results.
- Issue #147: Hot-reload `config.json` on every tool call without server restart (backported from 2.16.0 implementation to cover edge cases)
- Issue #146: Growth warning thresholds raised and per-kind breakdown added to `context_status` output
- `context-vault doctor` now checks for auto-captured feedback entries and embedding model health

### Fixed

- Issue #155: Replace hardcoded absolute hook paths (`node /path/to/session-end.mjs`) with CLI subcommands (`context-vault session-end`, `context-vault post-tool-call`). Hooks now survive `npm update` without path breakage. Stale hooks are migrated automatically on reinstall.
- Issue #154: `context-vault uninstall` now removes all Claude Code hooks and installed skills before optionally removing data directory
- Issue #164: `context-vault status` shows a friendly error instead of stack trace when DB parent directory is missing
- Test assertions updated for `~/.vault` default directory (changed in 2.16.0)

## [2.16.0] — 2026-02-27

### Added

- Issue #144: Hot-reload `config.json` without server restart — the MCP server re-reads config on every tool call, so changes to `~/.context-mcp/config.json` take effect immediately

### Fixed

- Issue #143: Setup wizard no longer overwrites existing `vaultDir` — when a valid config already exists, setup uses the configured path instead of defaulting to `~/vault`
- Issue #149: Default `vaultDir` changed from `~/vault` to `~/.vault` — follows dotfolder convention (`.context-mcp`, `.claude`, etc.) and prevents ghost directories; `scanForVaults()` checks both `~/.vault` and `~/vault` for backwards compatibility

## [2.15.0] — 2026-02-26

### Added

- Issue #136: Auto-detect existing vault via `.context-vault` marker file — setup now writes a marker file to the vault root and scans `~/vault`, `~/omni/vault`, cwd, and config path on subsequent runs; prompts to reuse existing vaults instead of creating new ones
- Issue #137: Session capture and auto-capture hooks integrated into setup wizard — when the recall hook is installed, users are now prompted to also install SessionEnd capture (session summaries) and PostToolCall auto-capture (tool call logging) hooks

### Changed

- Issue #138: `npx context-vault` (no subcommand) now runs setup on first run or shows status if a vault exists — matches the documented behavior, no code change needed
- Issue #135: `--vault-dir <path>` flag documented in `--help` output — the flag was already functional but not listed in help text
- Install command across READMEs updated from `npx context-vault setup` to `npx context-vault`

## [2.14.0] — 2026-02-24

### Added

- Issue #96: `create_snapshot` MCP tool — LLM-synthesized context brief from vault entries; pulls relevant entries by topic/tags/kinds, runs a `claude-haiku-4-5-20251001` synthesis pass, saves as `kind: "brief"` with a deterministic `identity_key`, supersedes noise entries (`prompt-history`, `task-notification`)
- Issue #99: Claude Code skills bundled in package — `assets/skills/compile-context/skill.md` versioned inside the npm package; `npx context-vault setup` now prompts to install skills; `context-vault skills install` standalone command added
- Issue #92: Claude Code plugin polish — `runRecall()` output upgraded to `<context-vault>` XML block with 400-char per-entry limit and 2000-char total budget; `context-vault claude install|uninstall` aliases added; `docs/claude-code-plugin.md` added

## [2.13.0] — 2026-02-24

### Added

- Issue #101: `clear_context` MCP tool — resets active session context without deleting vault entries; optional `scope` param filters subsequent `get_context` calls to a tag/project (`53751e1`)
- Issue #97: `detect_conflicts` parameter on `get_context` — surfaces superseded entries and stale duplicates (same kind+tags, updated_at diff > 7 days) in a `## Conflict Detection` section (`c816afe`)
- Issue #102: `context-vault flush` CLI command + `SessionEnd` hook integration — validates DB health and entry count; `hooks install` now offers optional auto-flush at session end (`494d096`)

### Fixed

- Issue #100: MCP server no longer fails silently — uncaught exceptions and unhandled rejections are logged to `~/.context-mcp/error.log` and emitted to stderr; new `context-vault doctor` command diagnoses Node version, config, DB integrity, launcher path, and error log (`215db53`)

### Changed

- Issue #46: Added `docs/distribution/connect-in-2-minutes.md` (was a dead link from the website); cross-linked from root README and `packages/local/README.md`; includes Claude Code, Cursor, and GPT Actions setup sections with `/health` endpoint reference (`28ef516`)

## [2.12.0] — 2026-02-23

### Added

- Issue #56: In-product feedback prompt after first `save_context` — one-time message to stderr pointing to GitHub Issues; marker file prevents repeat (`7071772`)
- Issue #93: `setup` checks for updates against npm registry on re-run — up-to-date exits cleanly; outdated shows current → latest diff and upgrade command (`6e146e8`)

### Changed

- Issue #44: Canonical URL constants (`APP_URL`, `API_URL`, `MARKETING_URL`, `GITHUB_ISSUES_URL`) extracted to `packages/core/src/constants.js`; all hardcoded strings replaced across `cli.js` and `telemetry.js`; `check-constants.js` enforces no duplicates (`75d5d30`)
- Issue #57: Setup completion now shows explicit "restart your AI tools" notice; embedding download step shows `--skip-embeddings` hint for slow connections (`0e702dc`)

### Infrastructure

- Issue #35: CI pipeline now gates production deploy on staging smoke: `test → build → deploy-staging → smoke-staging → deploy-prod → smoke-prod` (`6b349de`)
- Issue #36: `build-app` and `build-extension` jobs explicitly require `test` and `check-constants` to pass before running (`788a1c6`)

## [2.11.0] — 2026-02-22

### Added

- Issue #91: `context-vault recall` + `hooks install/remove` — Claude Code `UserPromptSubmit` hook that injects relevant vault entries as context on every prompt (`bf59213`)
- Issue #75: Write-time similarity check in `save_context` — warns before creating near-duplicate knowledge; `dry_run` mode and configurable `similarity_threshold` (`bc4385d`)
- Issue #76: `supersedes[]` field in `save_context` — marks referenced entries as retired; superseded entries excluded from search by default; `include_superseded` opt-in in `get_context` (`bca7f78`)
- Issue #88: Opt-in anonymous error telemetry — disabled by default; enable via `"telemetry": true` in config or `CONTEXT_VAULT_TELEMETRY=1`; sends only event type, error code, tool name, version, platform (`baa019e`)
- Issue #79: Vault growth warnings in `context_status` — configurable warn/critical thresholds for entry count and vault size (`bed6b34`)
- Issue #83: Stale knowledge signal in `context_status` — surfaces entries not updated within kind-specific windows (pattern: 180d, decision: 365d, reference: 90d) (`d654b62`)
- Issue #89: Removed daily upload limit for free tier (`0cf2d7e`)

### Changed

- Issue #77: Track `updated_at` separately from `created_at` — schema v9 migration; frontmatter `updated` field written on every edit; shown in `get_context` and `list_context` output (`bca7f78`)
- Issue #81: FTS phrase semantics — multi-word queries now use tiered matching: exact phrase → `NEAR(..., 10)` → `AND` (`8b9af25`)
- Issue #82: Near-duplicate suppression in hybrid search — when results exceed limit, embeddings are compared and near-duplicates (cosine ≥ 0.92) are skipped (`cfc5e75`)
- Issue #78: Expired entries pruned automatically at server startup, not only on `reindex` (`b8a93f4`)

## [2.10.3] — 2026-02-22

### Changed

- `@context-vault/core`: replace 21 hand-listed export entries with wildcard patterns (`./core/*`, `./server/*`, `./capture/*`, etc.) — new files added to core are automatically exported without manual package.json edits

## [2.10.2] — 2026-02-22

### Fixed

- `@context-vault/core`: add missing `./core/error-log` export to package.json exports map — fixes `ERR_PACKAGE_PATH_NOT_EXPORTED` crash on MCP server startup after `npx context-vault setup`

## [2.10.1] — 2026-02-22

### Fixed

- `setup` command: Claude Code configuration now places the server name before `-e` flags, fixing "Invalid environment variable format" error caused by `claude mcp add`'s variadic `--env` parser consuming the server name as an env var

## [2.10.0] — 2026-02-22

### Added

- Issue #84: Write structured error log to disk on startup failures and NativeModuleError — `~/.context-mcp/error.log` (JSON lines, 1 MB rotation); path shown in stderr and `context_status` (`7dfef95`)
- Issue #85: Auto-write local feedback entry on unhandled tool call errors — `tracked()` captures error context as a `feedback` vault entry (tags: `bug`, `auto-captured`) without blocking the original throw (`6b97fef`)
- Issue #87: Surface tool error counts and recent failures in `context_status` — session-level `ok`/`errors` counts and last-error detail with relative timestamp (`35e9a6f`)

### Changed

- Issue #86: Tool error responses now include `_meta` with `cv_version`, `node_version`, `platform`, `arch` for easier remote diagnosis (`d78670a`)
- Issue #80: `list_context` now applies the same 30-day auto-window as `get_context` for event queries; both tools surface an explicit `ℹ` notice and better empty-result messaging when the window is active (`50b9149`)

## [2.9.0] — 2026-02-22

### Changed

- **Replaced `better-sqlite3` with `node:sqlite` built-in** — eliminates all native addon dependencies and the `prebuild-install` deprecation warning on `npm install`
- Require Node.js >=24 (stable `DatabaseSync` API)
- Generated MCP server configs now include `NODE_OPTIONS=--no-warnings=ExperimentalWarning` to suppress the sqlite experimental warning until `node:sqlite` reaches stable status
- Removed native-module rebuild logic from `postinstall.js` (no longer needed)

## [2.8.19] — 2026-02-22

### Changed

- Upgraded `vitest` dev dependency from v3 to v4
- Removed dead `ui` script from root `package.json`

## [2.8.18] — 2026-02-22

### Changed

- Removed bundled web UI (`context-vault ui`, `local-server.js`, `app-dist/`) — the dashboard is part of the hosted product only; this package remains focused on CLI and MCP server

## [2.8.17] — 2026-02-22

### Added

- `context-vault ui` command opens the vault dashboard in the browser at `http://localhost:4422` (fully offline — no Vercel, no network required)
- `packages/local/src/local-server.js` — pure Node.js HTTP server serving the bundled React app and a local REST API (`/api/vault/status`, `/api/vault/entries` CRUD, `/api/me`)
- `prepack.js` now builds the React app from the sibling `context-vault-app` repo and copies `dist/` into `app-dist/` for tarball inclusion; skips gracefully if the sibling repo is absent

## [2.8.16] — 2026-02-22

### Fixed

- `reindex()` now deletes stale vectors atomically with insert (only on successful embedding), preventing entries from being permanently left without vectors if `embedBatch()` fails mid-batch
- `indexEntry()` skips writing already-expired entries to the DB and FTS index
- `export` command no longer crashes on malformed JSON in `tags`/`meta` columns — falls back to `[]`/`{}` gracefully
- Tag post-filter over-fetch is now capped at 500 rows (`MAX_FETCH_LIMIT`) to bound memory usage
- `context-status` tool name corrected in vault-not-found error message (was `context_status`)
- `embed.js` JSDoc updated to document the `loadingPromise` state (fourth state alongside `null/true/false`)

## [2.8.15] — 2026-02-22

### Fixed

- Tool timeout wrapper now suppresses the orphaned handler promise rejection after a 60s timeout, preventing unhandled promise rejection warnings in the host process
- `delete_context` surfaces non-ENOENT file deletion failures (e.g. permission errors) as a warning in the success response instead of silently swallowing them
- `embedBatch` now uses `subarray()` instead of `new Float32Array(buffer, offset, dim)`, correctly handling typed array views with non-zero `byteOffset`

## [2.8.14] — 2026-02-22

### Fixed

- Embedding pipeline no longer spawns multiple concurrent model loads — concurrent `embed()` / `embedBatch()` calls now await a single shared `loadingPromise`; health-check resets and `resetEmbedPipeline()` clear it correctly
- `reindex()` no longer crashes with a null dereference when `getRowid` returns nothing after a successful `INSERT OR IGNORE` — missing rowid now skips embedding for that entry rather than aborting the full reindex
- Vector KNN query uses a bound parameter for `LIMIT` instead of string interpolation

## [2.8.13] — 2026-02-21

### Fixed

- Embedding download during setup now times out after 90 seconds instead of hanging indefinitely — falls back to FTS-only mode with a clear retry message
- Download spinner now shows bytes downloaded (X.X MB / ~22 MB) alongside elapsed time
- Setup exits immediately with a clear error if the user declines to create the vault directory (previously continued and crashed at seed phase)

## [2.8.12] — 2026-02-21

### Changed

- Release script now automatically creates a GitHub Release with CHANGELOG notes after each npm publish

## [2.8.11] — 2026-02-21

### Fixed

- `setup --vault-dir <path>` now works — custom vault path is respected in non-interactive mode and pre-filled in interactive mode
- Setup exits with a clear error if the vault directory path is occupied by a file (not a directory)
- `server.mjs` launcher is created/refreshed on every `setup` run for globally installed packages, keeping it current after updates
- `configureClaude` and `configureCodex` now use `execFileSync` with argument arrays instead of shell-interpolated strings — paths with spaces in the node binary or vault dir no longer cause failures
- Windsurf: config is written to `~/.windsurf/mcp.json` for new-style installs (previously always used `~/.codeium/windsurf/mcp_config.json`)

## [2.8.10] — 2026-02-21

### Fixed

- MCP server no longer fails to start in Claude Code and other tools with restricted `PATH` — setup now records the full path to the node binary (`process.execPath`) instead of bare `"node"`

## [2.8.9] — 2026-02-21

### Changed

- Auto-select the single detected tool during setup — skips the selection prompt when there's no choice to make
- "No tools detected" manual config snippet now shows `npx` format instead of bare `context-vault` command
- Completion box CLI commands and embedding retry message use `npx context-vault` when running via npx
- Removed extra blank line before vault directory prompt (stage banner already provides spacing)

## [2.8.8] — 2026-02-21

### Changed

- `npx context-vault setup` is now the canonical install command across all docs and error messages
- Removed stale `context-vault ui` reference from README (command removed in 2.8.6)

## [2.8.7] — 2026-02-21

### Removed

- Global install prompt at end of `setup` — npx caches after first run, no prompt needed
- `configureWithLauncher()` helper — no longer needed without global install path
- "Prefer a permanent install?" block from README Quick Start

## [2.8.6] — 2026-02-21

### Removed

- `ui`, `link`, and `sync` CLI commands — product is now purely local MCP server (stdio) + CLI; no web dashboard or cloud sync
- `packages/local/scripts/local-server.js` (794-line HTTP server, no longer needed)
- `specs/local-ui-bundle.md` (cancelled spec)

## [2.8.5] — 2026-02-21

### Fixed

- `context-vault ui` now correctly starts the local REST API server (`local-server.js`) and opens `https://app.context-vault.com?local=<port>` — the dead `app-dist` check was causing an early return that opened the cloud UI without the `?local=` param and never started the local server

### Removed

- Stale post-extraction artifacts: `.dockerignore`, dead `app-dist` bundling in `prepack.js`, workspace dist fallback in `local-server.js`, `"app-dist/"` entry from `packages/local` files array

## [2.8.4] — 2026-02-21

### Fixed

- `@huggingface/transformers` moved from `dependencies` to `optionalDependencies` in `@context-vault/core` — prevents install failures caused by `sharp`'s broken lifecycle scripts in constrained environments (global npm, Docker, CI)

## [2.8.3] — 2026-02-21

### Fixed

- `release.mjs` now publishes `@context-vault/core` before `context-vault` to prevent dependency resolution gaps

## [2.8.2] — 2026-02-21

### Added

- `@context-vault/core` is now published to npm as a public package (`publishConfig.access: public`) — enables `context-vault-hosted` to depend on it without the monorepo

### Changed

- `scripts/release.mjs` publishes both `context-vault` and `@context-vault/core` on each release
- `packages/hosted` moved to [`context-vault-app/server/`](https://github.com/fellanH/context-vault-app) — SaaS backend now lives alongside the frontend; this repo is a focused OSS npm package

### Removed

- `packages/hosted/` directory, `fly.toml`, `.github/workflows/deploy.yml`
- Hosted integration and unit tests (`hosted.test.js`, `hosted-auth.test.js`, `billing.test.js`, `turso.test.js`, `encryption.test.js`) — moved to `context-vault-app/server/test/`

### Test suite

- **~330 tests** across 17 test files (hosted tests moved to context-vault-app/server/)

## [2.8.1] — 2026-02-21

### Fixed

- Removed stale test files (`format.test.js`, `onboarding.test.js`) that imported from `packages/app` after it was extracted to a separate repo — CI was failing on `npm test`
- `context-vault ui` now opens `app.context-vault.com` instead of exiting with an error when no local app bundle is present

### Changed

- `prepack.js` warns (no longer fails) when app-dist is not pre-built — package publishes without bundled UI
- Simplified GitHub Actions: removed `publish.yml` (CI-triggered npm publish) and `publish-extension.yml` (extension moved to separate repo); npm releases now run locally via `scripts/release.mjs`
- Simplified Fly.io deploy pipeline: removed staging environment, smoke tests; push to main → CI → deploy production → health check

### Test suite

- **399 tests** across 22 test files

## [2.8.0] — 2026-02-20

### Changed

- **Restructured `reindex()` transaction handling** — sync DB ops (INSERT/UPDATE/DELETE) now commit before async embedding starts; FTS is searchable immediately and embedding failures cannot roll back DB state (#29)
- **Removed `captureAndIndex` callback indirection** — `indexEntry` is now imported directly instead of passed as a parameter across 12 call sites; callers simplified to `captureAndIndex(ctx, data)`

### Added

- 12 new unit tests for `reindex()` covering directory scanning, change detection, orphan cleanup, expired entry pruning, and stats reporting

### Test suite

- **406 tests** across 24 test files

## [2.7.1] — 2026-02-20

### Added

- **Paginated export for large vaults** — hosted `GET /api/vault/export` accepts optional `?limit=N&offset=N` query params, returns `{entries, total, limit, offset, hasMore}` (#13)
- CLI `context-vault export` gains `--page-size N` flag for chunked memory-safe export
- 6 new integration tests for paginated export queries

### Test suite

- **392 tests** across 23 test files

## [2.7.0] — 2026-02-20

### Added

- ESLint flat config and `tsconfig.json` for `packages/app` — strict mode, path aliases, React hooks + refresh plugins (#10)
- JSDoc `@typedef` definitions for `BaseCtx`, `LocalCtx`, `HostedCtx` in new `packages/core/src/server/types.js` — typed ctx shapes across all tool handlers and shared modules (#12)

### Changed

- Refactored `tools.js` (693 → ~100 lines) into 7 individual handler modules under `packages/core/src/server/tools/` (#11)

### Fixed

- `AuthCallback.tsx` and `team/Invite.tsx` — replaced `setState` in `useEffect` with synchronous initial state computation (caught by new ESLint config)

### Test suite

- **386 tests** across 22 test files (unchanged — refactor only, no behavioral changes)

## [2.6.1] — 2026-02-20

### Fixed

- Schema version in CLI `status` command corrected from "v5" to "v7 (teams)" (missed in 2.6.0 which only fixed the MCP tool output)

## [2.6.0] — 2026-02-20

### Security

- **Input size limits on local MCP tools** — `save_context` and `ingest_url` now enforce body (100KB), title (500 chars), kind (64 chars), tags (20 max, 100 chars each), meta (10KB), source (200 chars), and URL (2048 chars) limits, matching hosted validation (#2)

### Fixed

- Schema version string corrected from "v6" to "v7 (teams)" in `context_status` output (#3)
- Removed duplicate `POST /api/vault/import` route in hosted package — consolidated to single `/api/vault/entries` endpoint (#8)
- Fixed double `initMetaDb()` call at hosted startup — now called once (#9)
- Fixed stale prepared-statement singleton in `meta-db.js` — invalidates cache when DB path changes (#9)

### Added

- 138 new unit tests: path traversal guards (41), config resolution chain (36), entry validation (61) (#4, #5, #7)
- `docs/encryption-trade-offs.md` — documents plaintext FTS exposure, split-authority model, and recommendations (#6)
- Exported `safeFolderPath` from `file-ops.js` for direct testing

### Test suite

- **386 tests** across 22 test files (up from 202 in v2.5.1)

## [2.5.1] — 2026-02-20

### Changed

- **Repo rename** — all references updated from `context-mcp` to `context-vault` (GitHub URLs, package metadata, scripts, docs, campaign assets)
- Renamed `dev.context-mcp.pipeline.plist` → `dev.context-vault.pipeline.plist` with corrected paths
- Backward compatibility preserved: `~/.context-mcp/` data dir, `CONTEXT_MCP_*` env vars, and `context-mcp` CLI alias still work

## [2.5.0] — 2026-02-19

### Added

- **Data import flexibility** — import entries from markdown, CSV/TSV, JSON, and plain text files or directories
  - CLI: `context-vault import <path>` with `--kind`, `--source`, `--dry-run`
  - REST: `POST /api/vault/import/bulk` and `POST /api/vault/import/file` on local server
  - Auto-detects ChatGPT export format
- **Export** — dump entire vault to JSON or CSV
  - CLI: `context-vault export [--format json|csv] [--output file]`
  - REST: `GET /api/vault/export` on both local and hosted servers
- **URL ingestion** — fetch a web page, extract readable content as markdown, save as vault entry
  - CLI: `context-vault ingest <url>` with `--kind`, `--tags`, `--dry-run`
  - MCP tool: `ingest_url` available to all AI agents
  - REST: `POST /api/vault/ingest` on both local and hosted servers
- **Account linking** — connect local vault to a hosted Context Vault account
  - CLI: `context-vault link --key cv_...`
  - Config reads `hostedUrl`, `apiKey`, `userId`, `email`, `linkedAt` from config.json
  - Env var overrides: `CONTEXT_VAULT_API_KEY`, `CONTEXT_VAULT_HOSTED_URL`
- **Bidirectional sync** — additive-only sync between local and hosted vaults
  - CLI: `context-vault sync` with `--dry-run`, `--push-only`, `--pull-only`
  - REST: `POST /api/local/sync`, `GET/POST /api/local/link`
  - Manifest-based diffing via `GET /api/vault/manifest`
- **Sync settings page** in web dashboard (`/settings/sync`)
- **CORS preflight** support on local server (OPTIONS handler + full CORS headers)
- 42 new unit tests for importers and URL ingestion (107 total)

### Fixed

- **`context-vault ui` now works after npm install** — pre-built web dashboard is bundled in the npm package via prepack; dual-path resolution falls back to workspace path for local dev

### New core exports

- `@context-vault/core/capture/importers` — Format detection + multi-format parsers
- `@context-vault/core/capture/import-pipeline` — Batch import orchestrator
- `@context-vault/core/capture/ingest-url` — URL fetch + HTML-to-markdown
- `@context-vault/core/sync` — Bidirectional sync protocol

## [2.4.2] — 2026-02-19

### Added

- Automated npm publishing via GitHub Actions (tag push triggers publish with provenance)
- `npm run release` script — bumps versions, verifies changelog, commits, tags, and pushes in one command

## [2.4.1] — 2026-02-19

### Changed

- Deprecated `/ui/` directory in favor of `packages/app` React application
- Updated README.md to reflect new web dashboard architecture
- Removed deprecated UI files (Context.applescript, index.html, serve.js)

### Fixed

- Removed deprecated `ui/` reference from published package files array

## [2.4.0] — 2026-02-18

### Added

- Hardening release with native module resilience and graceful degradation
- Cross-platform support improvements
- Production readiness features: R2 backups, CORS lockdown, Sentry hardening
- Persistent rate limits and staging CI/CD

### Improved

- Native module build resilience
- Graceful degradation for missing dependencies

## [2.3.0] — 2026-02-18

### Added

- Search results now show entry `id` for easy follow-up with save/update/delete
- Filter-only mode for `get_context` — use tags, kind, or category without a search query
- Body preview in `list_context` results (120-char truncated)
- Actionable suggestions in `context_status` output
- `context-mcp update` command to check for and install updates
- `context-mcp uninstall` command to cleanly remove MCP configs
- Setup upgrade detection — re-running setup offers "update tools only" option
- Non-blocking update check on server startup
- Richer seed entries during setup (getting-started + example decision)
- Expanded post-setup guidance with CLI and AI tool examples
- Quick Reference and Common Workflows sections in README

### Improved

- Tool descriptions now include usage hints for agents
- Save confirmations include follow-up hints (update/verify)

## [2.2.0] — 2026-02-17

### Added

- `list_context` tool for browsing vault entries with filtering and pagination
- `delete_context` tool for removing entries by ID
- `save_context` update mode — pass `id` to update existing entries (omitted fields preserved)
- `submit_feedback` tool for bug reports and feature requests
- Comprehensive test suite (25 tests)
- Branding and compact formatting for MCP tool responses

## [2.1.0] — 2026-02-16

### Added

- Unified `vault` table with v5 schema (categories: knowledge, entity, event)
- Three-category system with kind→category mapping
- Embedding model warmup during setup
- Seed entry created during setup
- Health check at end of setup
- Restructured README with architecture docs

### Changed

- Config resolution: CLI args > env vars > config file > convention defaults

## [2.0.0] — 2026-02-15

### Added

- Initial release with MCP server
- `get_context` hybrid search (FTS5 + vector similarity)
- `save_context` for creating knowledge entries
- `context_status` diagnostics tool
- Interactive `context-mcp setup` wizard
- Auto-detection for Claude Code, Claude Desktop, Cursor, Windsurf, Cline
- SQLite with sqlite-vec for vector search
- all-MiniLM-L6-v2 embeddings via @huggingface/transformers
- Plain markdown files as source of truth
- Auto-reindex on first tool call per session
- CLI commands: setup, serve, ui, reindex, status
