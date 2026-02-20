# Context Vault — Project Context

Persistent memory layer for AI agents via MCP. Markdown files + SQLite FTS + semantic embeddings.

| Resource | URL |
|----------|-----|
| Repo | `https://github.com/fellanH/context-vault` |
| Marketing | `https://contextvault.dev` |
| App | `https://context-vault.com` |
| Quickstart | `https://github.com/fellanH/context-vault/blob/main/docs/distribution/connect-in-2-minutes.md` |

## Tone

- Technical, helpful, honest about trade-offs
- No hype, no fabricated metrics — show real commands, real output
- Speak as a developer building tools for other developers

## Session Protocol

Every Claude Code working session follows this workflow:

### 1. Orient
- Read `BACKLOG.md` (engineering) or `docs/gtm/GTM-BACKLOG.md` + `docs/gtm/GTM-CONTEXT.md` (GTM)
- Check `Now` section for active work items
- Query context vault: `get_context` with tags `context-vault`

### 2. Pick
- Work on a `Now` item, or pull highest-ICE from `Next`
- GTM work: pick from `docs/gtm/GTM-BACKLOG.md`

### 3. Pitch
Present plan for user approval **before writing code**.

- **Non-trivial**: Why this/why now, 2-3 options with trade-offs, scope & risk
- **Trivial**: One-line summary, proceed after approval

### 4. Branch
- Create `feat/`, `fix/`, or `chore/` branch — no direct commits to `main` (#21)
- GTM-only tasks with no code changes skip this step

### 5. Work
- Implement, test, commit with conventional messages
- Reference issues: `Fixes #N`

### 6. Ship
- Push, wait for CI (`test-and-build`), then `gh pr merge --squash --admin`
- PR body includes `Fixes #N` to auto-close issues

### 7. Update
- Update `BACKLOG.md`: move completed items, add signals, adjust priorities
- File GitHub issues for newly discovered work
- Do not add documentation for anything derivable from code

### 8. Review
End-of-session retrospective: **Shipped**, **Went well**, **Friction**, **Learned**, **Actions**.

Persist: `save_context` (kind: `session-review`, tags: `context-vault, retro`). Durable lessons → memory files or CLAUDE.md. Actionable friction → issues or backlog.

### Branch naming
| Prefix | Use |
|--------|-----|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `chore/` | Infra, deps, cleanup |

### Issue labels
| Label | Purpose |
|-------|---------|
| `bug` | Something broken |
| `feature` | New capability |
| `enhancement` | Improvement to existing |
| `dx` | Developer experience |
| `infra` | CI/CD, deployment |
| `gtm` | Marketing, sales, content |
| `user-request` | Directly from a user |
| `P0`–`P3` | Priority (critical → eventually) |

### ICE scoring
Score = Impact(1-5) × Confidence(1-5) × Ease(1-5). Highest → top of `Next`.

### Weekly triage
Review feedback entries + issues, add community signals, re-score `Next`, pull top items into `Now` (max 3).

### GTM Workflow

Same protocol, different sources:

| Step | Engineering | GTM |
|------|------------|-----|
| Orient | `BACKLOG.md` | `GTM-BACKLOG.md` + `GTM-CONTEXT.md` |
| Branch | Always | Skip unless code changes needed |
| Ship | PR + merge | Post/publish + verify live |
| Update | `BACKLOG.md` | `GTM-BACKLOG.md` + `weekly-log.md` |

**GTM "Ship" definitions:** Distribution = post live + link verified. Onboarding = walkthrough complete. Instrumentation = events firing. Community = channel created. Sales = asset committed.

When GTM requires code: full engineering workflow. GTM item stays open until both code ships AND outcome is verified.

## GTM Context

- **Backlog:** `docs/gtm/GTM-BACKLOG.md`
- **Context:** `docs/gtm/GTM-CONTEXT.md` — ICP, CTAs, content pillars
