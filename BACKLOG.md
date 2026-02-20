# Backlog

**Last triaged:** 2026-02-20

---

## Now

Active work. Hard cap: 3 items. Finish or demote before adding.

| Item | Source | Issue |
|------|--------|-------|
| ~~Add unit tests for `hybridSearch`~~ | [qa] | #1 — PR #15, 46 tests |
| Add input size limits to local MCP tools | [qa] | #2 |
| Fix schema version string "v6" → "v7" in `context_status` output | [qa] | #3 |

---

## Next

Ordered by ICE score (Impact × Confidence × Ease). Pull from top when `Now` has space.

| Item | ICE | Source | Issue |
|------|-----|--------|-------|
| Add unit tests for `safeJoin` / `safeFolderPath` path traversal guards | 80 | [qa] | #4 |
| Add unit tests for config resolution chain (defaults → file → env → CLI) | 48 | [qa] | #5 |
| Document encryption trade-offs (plaintext FTS preview, title exposure) | 45 | [internal] | #6 |
| Add unit tests for `entry-validation.js` field validators | 36 | [qa] | #7 |
| Consolidate duplicate import routes in hosted package | 30 | [internal] | #8 |
| Clean up startup: remove double `initMetaDb`, fix stale singleton | 30 | [internal] | #9 |
| Add ESLint config and `tsconfig.json` to `packages/app` | 24 | [qa] | #10 |

---

## Later

Parking lot. No commitment, no ordering.

- Refactor `tools.js` into individual tool handler modules (#11)
- Add JSDoc `@typedef` for `ctx` shapes per mode (#12)
- Streaming export for large vaults (currently loads all to memory) (#13)
- Cache `buildUserCtx` per connection instead of per request (#14)
- React 18 → 19 migration
- Vite 6 → 7 migration
- Stripe 17 → 20 migration
- Multi-source URL ingestion pipelines (video transcripts, PDFs, social posts)
- Pricing tier refinements
- Remove `captureAndIndex` callback indirection (always same function)
- Restructure reindex to separate sync DB ops from async embedding

---

## Signals

Raw user feedback, community mentions, feature requests. Review weekly during triage.

| Date | Signal | Source | Action |
|------|--------|--------|--------|
| — | _No signals yet. Check vault `feedback` entries and GitHub issues weekly._ | — | — |

---

## Decisions

Key architectural choices made during development. Reference, not action items.

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-02-20 | Tag filtering over-fetches ×10 then slices | Avoids schema change (tags stored as JSON strings). Revisit if vaults exceed 10k entries. |
| 2026-02-20 | Kind normalization applied at save time | Prevents orphaned entries from plural kind names. Search and save now agree. |
| 2026-02-20 | Split-authority encryption with plaintext FTS | Trade-off: full-text search requires some plaintext. Documented, not a bug. |
| 2026-02-20 | Open-core model (MIT local + BSL hosted) | Free local CLI drives top-of-funnel. Hosted API is monetization path. |
| 2026-02-20 | Adopted BACKLOG.md + GitHub Issues workflow | File-based tracking for Claude Code session continuity. Issues for public record. |
