# Backlog

**Last triaged:** 2026-02-20 (workflow overhaul session)

---

## Now

Active work. Hard cap: 3 items. Finish or demote before adding.

| Item                     | Source | Issue |
| ------------------------ | ------ | ----- |
| _Empty — pull from Next_ |        |       |

---

## Done

_Only the latest release. Older items archived — see CHANGELOG.md and git history for full record._

| Item                                                                          | Issue | Release |
| ----------------------------------------------------------------------------- | ----- | ------- |
| Dev playbook + guardian system (CLAUDE.md, DEV-PLAYBOOK.md, INBOX.md)         | #65   | —       |
| Hosted dashboard for local vaults (`context-vault ui` → hosted UI)            | #61   | —       |
| Path-scope CI/deploy workflows + fix staging `--prod` bug                     | #62   | —       |
| Branch ownership rules in all agent definitions                               | #63   | —       |
| Sprint tracking + branch ownership in session protocol (CLAUDE.md)            | #64   | —       |
| Restructure reindex to separate sync DB ops from async embedding              | #29   | v2.8.0  |
| Remove `captureAndIndex` callback indirection (always `indexEntry`)           | —     | v2.8.0  |
| Add reindex unit test coverage (12 tests)                                     | —     | v2.8.0  |
| Code-as-documentation overhaul (DEVELOPER.md, CLAUDE.md, archive CODE_REVIEW) | #26   | —       |
| Split CI and deploy into separate workflows                                   | #24   | —       |
| Paginated export for large vaults (replace load-all with limit/offset)        | #13   | —       |
| Cache `buildUserCtx` per connection instead of per request                    | #14   | —       |
| Add ESLint config and `tsconfig.json` to `packages/app`                       | #10   | v2.7.0  |
| Refactor `tools.js` into individual tool handler modules                      | #11   | v2.7.0  |
| Add JSDoc `@typedef` for `ctx` shapes per mode                                | #12   | v2.7.0  |

---

## Next

Ordered by ICE score (Impact × Confidence × Ease). Pull from top when `Now` has space.

| Item                                                                                | ICE | Source               | Issue |
| ----------------------------------------------------------------------------------- | --- | -------------------- | ----- |
| Configure Claude Code hooks (file protection, auto-test, orient, self-verify Stop)  | 100 | AI workflow research | —     |
| Add `claude-code-action` workflow (PR review, issue triage, @claude mentions)       | 64  | AI workflow research | —     |
| Add headless CI checks (duplicate constant detector, cross-package impact analysis) | 36  | AI workflow research | —     |

---

## Later

Parking lot. No commitment, no ordering. ICE scores from 2026-02-20 triage.

- Feedback→GitHub issue pipeline via `repository_dispatch` (ICE 36 — no user signal yet, revisit when feedback volume grows)
- Scheduled vault health check via GitHub Actions cron (ICE 32 — low urgency, useful once hosted has active users)
- Inngest for event-driven workflows / drip email sequences (ICE 27 — premature without user base; fits stack well)
- Label-gated issue-to-PR automation via `claude-code-action` (ICE 12 — tools not mature, prompt injection risk on public repo)
- Stripe 17 → 20 migration (ICE 12 — no urgency, revisit if deprecation warnings appear)
- Vite 6 → 7 migration (ICE 9 — no user-facing benefit)
- Pricing tier refinements (ICE 6 — no spec or user signal yet)
- Multi-source URL ingestion pipelines (ICE 3 — video transcripts, PDFs, social posts; no user signal)
- React 18 → 19 migration (ICE 2 — Radix compat unclear, high effort, zero user impact)

---

## Signals

Raw user feedback, community mentions, feature requests. Review weekly during triage.

| Date | Signal                                                                     | Source | Action |
| ---- | -------------------------------------------------------------------------- | ------ | ------ |
| —    | _No signals yet. Check vault `feedback` entries and GitHub issues weekly._ | —      | —      |

---

## Decisions

Key architectural choices made during development. Reference, not action items.

| Date       | Decision                                                          | Reasoning                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-20 | Tag filtering over-fetches ×10 then slices                        | Avoids schema change (tags stored as JSON strings). Revisit if vaults exceed 10k entries.                                                                                                                               |
| 2026-02-20 | Kind normalization applied at save time                           | Prevents orphaned entries from plural kind names. Search and save now agree.                                                                                                                                            |
| 2026-02-20 | Split-authority encryption with plaintext FTS                     | Trade-off: full-text search requires some plaintext. Documented, not a bug.                                                                                                                                             |
| 2026-02-20 | Open-core model (MIT local + BSL hosted)                          | Free local CLI drives top-of-funnel. Hosted API is monetization path.                                                                                                                                                   |
| 2026-02-20 | Adopted BACKLOG.md + GitHub Issues workflow                       | File-based tracking for Claude Code session continuity. Issues for public record.                                                                                                                                       |
| 2026-02-20 | Always grep whole repo before fixing hardcoded values             | v2.6.0 missed CLI schema string (v5) while fixing MCP tool (v6→v7). Required v2.6.1 patch.                                                                                                                              |
| 2026-02-20 | Dogfood every release — install globally + verify MCP             | Catches issues that tests miss (stale MCP server, registry propagation, etc.)                                                                                                                                           |
| 2026-02-20 | Separate CI (test-and-build) from deploy pipeline                 | CI stays lean for PR validation; deploy chains via `workflow_run` + gate job. Manual deploy via `workflow_dispatch`.                                                                                                    |
| 2026-02-20 | Code-as-documentation: docs cover only why/where, never what/how  | Code tells what/how, tests tell behavior, docs tell why/where. Pointers over prose. Cuts agent context waste and prevents stale docs.                                                                                   |
| 2026-02-20 | AI dev workflow: GitHub Actions + Inngest over n8n                | n8n overkill at current scale. GitHub Actions for CI-native tasks (PR review, issue triage, health checks). Inngest when event-driven/drip workflows needed. Revisit n8n if team grows or non-devs need visual builder. |
| 2026-02-20 | Phased AI automation: hooks → PR review → CI checks → issue-to-PR | Start with zero-cost local DX (hooks), then CI quality gates (claude-code-action ~$8-20/mo), then headless checks. Issue-to-PR automation deferred — tools not mature, prompt injection risk on public repo.            |
