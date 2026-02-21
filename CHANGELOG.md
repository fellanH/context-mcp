# Changelog

All notable changes to context-vault are documented here.

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
