# Development Playbook

**Agent-operated. Human steers with session goals and feedback. Agents handle everything else.**

---

## The Full Cycle

```
HUMAN: session start prompt
        │
        ▼
AGENT reads NORTH-STAR.md
AGENT derives live state (git log, npm view, gh run list)
AGENT self-governance check → GO or HOLD
        │
        ▼ (GO)
AGENT: implement → commit → push to main
        │
        ▼
CI (automatic): test suite + conditional package builds
        │
        ▼
DEPLOY (automatic on CI pass): staging → health check → smoke → production
        │
        ▼
AGENT: updates BACKLOG.md
        │
        ▼
HUMAN: session wrap prompt
        │
        ▼
[NPM RELEASE — separate trigger]
cv-release-manager: version bump → CHANGELOG → git tag
publish.yml: npm publish + GitHub Release
```

No PRs. No branches by default. Push to main, CI and deploy handle the rest.

---

## What You Actually Do

### Session start

```
Session goal: [one sentence]
```

Agent reads NORTH-STAR.md, derives live state, surfaces summary, pitches approach.

### Session wrap

```
Session wrap.
```

Agent confirms what shipped, corrects BACKLOG.md, dumps any open items, tells you what's next.

### Feedback and capture (any time)

```
feedback: [what you experienced or noticed]
capture: [idea]
```

`feedback:` → FEEDBACK.md with [UX] or [DEV] tag — primary roadmap input
`capture:` → INBOX.md — ideas for triage

---

## Deployment Paths

| Package            | Trigger                            | Target                |
| ------------------ | ---------------------------------- | --------------------- |
| packages/core      | bundled — no direct deploy         | —                     |
| packages/local     | git tag `v*`                       | npm                   |
| packages/hosted    | main push (hosted or core changed) | Fly.io staging → prod |
| packages/app       | main push (app or core changed)    | Vercel staging → prod |
| packages/marketing | main push (marketing changed)      | Vercel staging → prod |
| packages/extension | manual dispatch                    | Chrome Web Store      |

**Versioning:** bump root + core + local + extension together. `packages/hosted` is 0.x — never bump with others.

**Deploy order:** staging → health check (30 retries / 5s) → smoke → production. Staging failure = production blocked.

---

## Session Prompts

### Engineering

```
Session goal: [outcome in one sentence]
```

### Quick fix

```
Fix [specific thing] in [file or package].
```

### Parallel agents (branch required)

```
Session goal: [outcome]
[N] independent tasks — confirm zero file overlap before spawning:
1. [Task A] — touches [packages/X] only
2. [Task B] — touches [packages/Y] only
Assign branches, spawn in parallel.
```

### Triage

```
Triage. No code.
Read FEEDBACK.md, INBOX.md, BACKLOG.md.
Process feedback into backlog items. ICE score. Re-score Next.
Tell me what to pull into Now.
```

### Release (npm)

```
Release. Type: [patch / minor / major].
Bump versions (root + core + local + extension — NOT hosted).
Update CHANGELOG. Tag and push.
```

### Session wrap

```
Session wrap.
```

### Strategic re-anchor

```
Lost the thread. No code.
Read NORTH-STAR.md, git log, BACKLOG.md.
Tell me: what's shipped, what's next, whether it serves the product direction.
```

### Planning before building

```
Think through [problem] before writing any code.
Read [relevant files]. Give me 2–3 approaches with trade-offs.
```

---

## Branching (exception, not default)

Default is main. Branch only for:

- Parallel agents working simultaneously (they'd conflict on main)
- Experimental work you might abandon

Branch naming: `feat/<scope>-<slug>` · `fix/<scope>-<slug>` · `chore/<slug>`
Scope: `marketing · hosted · cli · extension · core · infra`
Delete branches after merging.

---

## Agent Roster

| Agent              | Owns                     | Notes                |
| ------------------ | ------------------------ | -------------------- |
| cv-site-dev        | packages/marketing/      |                      |
| cv-content-writer  | docs/gtm/, posts.ts      |                      |
| cv-campaigns       | docs/gtm/assets/         |                      |
| cv-sales-ops       | docs/gtm/ pipeline files |                      |
| cv-release-manager | version + CHANGELOG      | Clean main only      |
| cv-test-runner     | read-only                | No commits           |
| Claude CLI         | any package              | Default for all code |

---

## Parallelism Rules

Zero shared files = parallel-safe. One shared file = sequential.

**Safe in parallel:** marketing page + blog post, hosted fix + CLI change, unrelated test files

**Never parallel:** feature + its tests, two changes to packages/core, any feature + release, two agents on same package

When tasks share a dependency: build the shared thing first, then parallelize.

---

## CI/CD Workflows

| Workflow               | Trigger         | What                                          |
| ---------------------- | --------------- | --------------------------------------------- |
| ci.yml                 | push to main    | Tests + conditional builds                    |
| deploy.yml             | CI pass on main | Staging → health → smoke → prod (path-scoped) |
| publish.yml            | tag `v*`        | npm publish + GitHub Release + dogfood        |
| publish-extension.yml  | manual          | Chrome Web Store                              |
| claude-code-review.yml | PR only         | Inline review (for branch-based work)         |
| claude.yml             | @claude comment | Ad-hoc assistance                             |

---

## Sprint Tracking

BACKLOG.md `Now` = what's actively being built. Agents self-correct drift.

| Event          | Action            |
| -------------- | ----------------- |
| Work started   | Move to Now       |
| Pushed to main | Move to Done      |
| Abandoned      | Move back to Next |

Hard cap: 3 in `Now`.

---

## Common Failure Modes

| Symptom                           | Cause                                       | Fix                                      |
| --------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Wrong branch                      | Session started without checking git status | Check git status at session start        |
| Agents conflict                   | Parallel work on same files                 | Verify zero file overlap before spawning |
| Hosted wrong version              | Bumped with core/local                      | hosted is 0.x, never bump with others    |
| Extension not updated             | publish-extension.yml needs manual dispatch | Run after tagging                        |
| Backlog out of sync               | Agents skipped update                       | Session wrap corrects this               |
| Backlog disconnected from reality | No feedback ingestion                       | Use `feedback:` regularly, run triage    |
| npm install fails post-publish    | Registry lag ~60s                           | `npm cache clean --force` then retry     |
