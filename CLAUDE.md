# Context Vault — Agent Operating Protocol

Persistent memory layer for AI agents via MCP. Markdown + SQLite FTS + semantic embeddings.

| Resource                | URL                                                |
| ----------------------- | -------------------------------------------------- |
| Repo                    | https://github.com/fellanH/context-vault           |
| App                     | https://app.context-vault.com                      |
| Marketing               | https://contextvault.dev                           |
| API                     | https://api.context-vault.com                      |
| context-vault-app       | https://github.com/fellanH/context-vault-app       |
| context-vault-marketing | https://github.com/fellanH/context-vault-marketing |
| context-vault-extension | https://github.com/fellanH/context-vault-extension |

## Packages

| Package | Runtime                        | Storage                                |
| ------- | ------------------------------ | -------------------------------------- |
| `core`  | shared library                 | —                                      |
| `local` | local MCP server (stdio) + CLI | `~/.context-mcp/vault.db` + `~/vault/` |

Extracted repos: app (includes `server/` backend) · marketing · extension (see URLs above).

## Product Direction

Local-first persistent memory for AI agents. Users own their data as plain markdown files. Hosted tier adds cloud sync, teams, and billing. Never sacrifice data ownership for features.

Tone: technical, honest about trade-offs. No hype. Developer-to-developer.

## Session Start

Derive live state before anything else:

```bash
git status && git log --oneline -5
npm view context-vault version
```

Surface: what shipped, what's next. If not on main — flag it and ask why.

## Input Commands

**`capture: [idea]`** → append to `INBOX.md`: `YYYY-MM-DD — [idea]`. Confirm and return.

**`feedback: [observation]`** → append to `FEEDBACK.md`: `YYYY-MM-DD [UX/DEV] — [observation]`. Confirm and return.

`chaos mode on` → everything to INBOX.md until `chaos mode off`

## Work Cycle

Commit directly to main. Push → CI → deploy. No PRs, no branches unless parallel agents would conflict.

Branch naming: `feat/<scope>-<slug>` · `fix/<scope>-<slug>` · `chore/<slug>`
Scope: `cli · core · infra`

Code self-documents. No inline comments. No docs for anything derivable from code.

**npm release:** update `CHANGELOG.md`, then `node scripts/release.mjs patch|minor|major`

Versioning: bump root + core + local together.

## Deploy Pipeline

| Package        | Trigger      | Target |
| -------------- | ------------ | ------ |
| packages/local | git tag `v*` | npm    |
| packages/core  | git tag `v*` | npm    |

## Agent Boundaries

| Agent              | Allowed paths                      |
| ------------------ | ---------------------------------- |
| cv-release-manager | version files, CHANGELOG, git tags |
| cv-test-runner     | read-only — no commits             |
| Claude CLI         | any package                        |

## Issue Labels

`bug` · `feature` · `enhancement` · `dx` · `infra` · `gtm` · `user-request` · `P0`–`P3`
