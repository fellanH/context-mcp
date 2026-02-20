# Context Vault — Shared Project Context

## Product

- **Name:** Context Vault
- **What it is:** Persistent memory layer for AI agents via MCP (Model Context Protocol)
- **Core tech:** markdown files + SQLite FTS + semantic embeddings, served over MCP
- **Repo:** `github.com/fellanH/context-vault`
- **Marketing site:** contextvault.dev (SPA in `packages/marketing/`)
- **App:** context-vault.com (SPA in `packages/app/`)

## ICP (Ideal Customer Profile)

- Solo AI developers
- Technical founders shipping AI-powered products
- Small product teams using Claude Code, Cursor, Codex, or GPT Actions

## Core Pitch

> AI sessions are stateless. Context Vault gives persistent memory through MCP in minutes.

## CTAs

- **Primary:** "Start free" → `appHref("/register")` (cross-origin to app)
- **Secondary:** "See 2-minute setup" → `/get-started`

## Content Pillars

1. **Integration** — Setup guides for specific AI clients (Claude Code, Cursor, GPT Actions, Windsurf)
2. **Playbook** — Practical workflows and use-case guides
3. **Education** — Deep dives on architecture, retrieval, taxonomy design
4. **Comparison** — Honest comparisons against alternatives (notes apps, static files, hosted-only tools)

## Key URLs

| Resource | URL |
|----------|-----|
| GitHub repo | `https://github.com/fellanH/context-vault` |
| Marketing site | `https://contextvault.dev` |
| App | `https://context-vault.com` |
| Docs quickstart | `https://github.com/fellanH/context-vault/blob/main/docs/distribution/connect-in-2-minutes.md` |

## GTM Docs Location

All go-to-market strategy and tracking docs live in `docs/gtm/`:

| File | Purpose |
|------|---------|
| `marketing-plan.md` | Landing page architecture, SEO, events, CRO backlog |
| `content-tracker.md` | Status of all 32 content pieces (blog, video, BIP) |
| `weekly-log.md` | Execution journal and weekly scorecard |
| `pipeline.md` | Founder-led sales CRM |
| `sales-playbook.md` | Core pitch, pipeline targets, objection handling |
| `sales-assets.md` | Campaign materials, demo scripts, collateral status |
| `funnel-metrics.md` | Funnel stages and 90-day numeric targets |
| `assets/` | Campaign drafts (X threads, Reddit posts, HN posts, BIP posts) |
| `demos/` | Demo video scripts |

## Tone

- Technical, helpful, honest about trade-offs
- No hype, no fabricated metrics, no fake testimonials
- Show real commands, real output, real workflows
- Speak as a developer building tools for other developers

## Session Protocol

Every Claude Code working session follows this workflow:

### 1. Orient
- Read `BACKLOG.md` to understand current priorities
- Check `Now` section for active work items

### 2. Pick
- Work on an item from `Now`, or triage if the user requests it
- If `Now` is empty, pull the highest-ICE item from `Next`

### 3. Branch
- Create a branch: `feat/<name>`, `fix/<name>`, or `chore/<name>`
- Direct commits to `main` only for single-line fixes or docs

### 4. Work
- Implement, test, commit with conventional commit messages
- Reference the GitHub issue: `Fixes #N` in commit messages

### 5. Ship
- Create a PR with `Fixes #N` to auto-close the issue on merge
- Self-merge via squash merge is fine for solo work

### 6. Update
- Update `BACKLOG.md`: move completed items, add new signals, adjust priorities
- If new work was discovered during the session, file GitHub issues

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
| `enhancement` | Improvement to existing feature |
| `dx` | Developer experience (setup, docs, onboarding) |
| `infra` | CI/CD, deployment, monitoring |
| `gtm` | Marketing, sales, content |
| `user-request` | Directly from a user |
| `P0-critical` | Must fix before next release |
| `P1-high` | Next release |
| `P2-medium` | Soon |
| `P3-low` | Eventually |

### ICE scoring (for ordering `Next` items)
- **Impact** (1-5): How many users affected? How much does it move revenue/adoption?
- **Confidence** (1-5): How sure is this the right thing? (User signal = high, gut = low)
- **Ease** (1-5): How fast can it ship? (1 session = 5, multi-day = 1)
- Score = I × C × E. Highest goes to top of `Next`.

### Weekly triage
- Review vault `feedback` entries and new GitHub issues
- Add community signals (Reddit, X, HN) to `Signals` section
- Re-score `Next` items if priorities shifted
- Pull top items into `Now` (max 3)
