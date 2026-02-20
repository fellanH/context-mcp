# Changelog

All notable changes to context-vault are documented here.

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
