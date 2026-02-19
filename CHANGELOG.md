# Changelog

All notable changes to context-vault are documented here.

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
