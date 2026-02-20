# User Personas — Context Vault

Four primary personas, two lifecycle transitions, and two anti-personas derived from [User Journeys](./USER_JOURNEYS.md).

> **Validation status key:** Entries marked *Hypothesis* are based on product reasoning and competitive analysis but have not been validated through user interviews or usage data. Entries marked *Observed* reflect patterns seen in early adopters or beta feedback.

---

## Primary Personas

### 1. The Sovereignty Dev

**Archetype:** Privacy-first developer who keeps everything local.
**Journey:** 1 (Local-First Developer) — may graduate to Journey 3 (Local → Cloud)

**Demographics & Background:** *Hypothesis*
- Senior developer or tech lead, 5-15 years experience
- Works in regulated industries (fintech, healthcare, defense) or at privacy-conscious companies
- Maintains dotfiles, self-hosts tools, contributes to open source
- Uses terminal-native workflows — Claude Code, Neovim/Vim, tmux

**Goals:**
- Persistent AI memory without sending data to third parties
- Portable knowledge base that lives in version control alongside code
- Full control over where data is stored and how it's accessed
- Reproducible setup across machines via dotfiles/scripts

**Pain Points:**
- AI tools forget context between sessions — repeats the same explanations
- Cloud services change terms, sunset features, or get acquired
- Existing "memory" solutions require accounts, cloud storage, or proprietary formats
- Onboarding friction — won't adopt tools that require registration to evaluate

**Behavioral Patterns:**
- Reads the README and source code before installing
- Checks npm download stats, GitHub stars, and open issues before committing
- Will `git clone` and inspect before `npm install -g`
- Values plain-text formats (markdown, YAML) over databases or proprietary blobs
- Shares tools with peers via Slack/Discord if impressed

**Technical Proficiency:** High. Comfortable with CLI, MCP protocol, SQLite internals, embedding models.

**Quote:**
> "If I can't `cat` it, `grep` it, and `git push` it, it's not my data."

**Discovery Channels:** GitHub trending, Hacker News, "awesome-mcp" lists, dev-focused subreddits (r/neovim, r/commandline), word of mouth in private Slack/Discord communities.

**Activation Trigger:** Forgets something across sessions for the third time. Googles "persistent AI memory local."

**Success Metric:** Has 50+ entries after 30 days. Vault directory is checked into a private repo.

**Churn Risks & Mitigations:**
- Embedding model download fails or is too large for CI environments (22 MB) → *Mitigation:* Pre-built model cache, smaller model option. *Gap:* Users behind corporate proxies may still fail.
- MCP config is confusing or breaks on editor update → *Mitigation:* Auto-detection in `context-vault setup`, fallback manual instructions. *Gap:* New editors and MCP spec changes require ongoing maintenance.
- Already built a custom solution (CLAUDE.md files, custom scripts) → *Mitigation:* Position as complementary, not replacement. Import existing markdown files. *Gap:* Hard to dislodge entrenched workflows.

---

### 2. The Pragmatist

**Archetype:** Results-oriented user who wants the fastest path to working memory.
**Journey:** 2 (Cloud-First) — may graduate to Journey 5 (Pro Upgrade)

**Demographics & Background:** *Hypothesis*
- Mid-level developer or technical PM, 2-8 years experience
- Works at a startup or mid-size company with modern tooling
- Uses Cursor, VS Code, or a mix of AI-assisted editors
- Comfortable with cloud services — already pays for GitHub, Vercel, Notion, etc.
- May also use ChatGPT or Claude.ai via browser alongside their IDE

**Goals:**
- AI that remembers decisions, patterns, and project context across sessions
- Works on multiple machines (office desktop, laptop, personal machine)
- Minimal setup — one command, not a weekend project
- Dashboard to browse and manage saved knowledge

**Pain Points:**
- Context window limits mean AI forgets mid-project decisions
- Switching machines means losing all accumulated context
- Local-only tools feel fragile — what if the laptop dies?
- Too many tools already — won't adopt something with heavy maintenance

**Behavioral Patterns:**
- Clicks "Start free" before reading documentation
- Evaluates tools in under 10 minutes — if it doesn't work by then, moves on
- Will pay $9/mo without hesitation if the tool saves 30 min/week
- Shares discoveries on Twitter/X and in team Slack
- Uses the dashboard more than CLI for browsing entries

**Technical Proficiency:** Moderate-high. Comfortable with CLI basics but prefers GUI for management. Won't debug MCP config issues.

**Quote:**
> "I don't care where it's stored. I care that it works when I open a new tab."

**Discovery Channels:** Twitter/X threads ("my AI workflow" posts), YouTube demos, Product Hunt, dev newsletter roundups, "best AI tools 2026" listicles, colleague recommendations in team Slack.

**Activation Trigger:** Sees a tweet/post showing Context Vault in action. Tries it in 5 minutes.

**Success Metric:** Saves first entry within 10 minutes of signup. Returns within 48 hours to save a second.

**Churn Risks & Mitigations:**
- Connect command fails or MCP config doesn't auto-detect their editor → *Mitigation:* Robust `connect` with fallback manual instructions, clear error messages. *Gap:* Editor plugin ecosystems change fast — detection logic needs constant updates.
- Already uses a competing tool (Mem0, Pieces, Notion AI) → *Mitigation:* Emphasize MCP-native integration and plain-markdown portability. *Gap:* Switching cost is real if they have 100+ entries elsewhere.
- Forgets the tool exists after initial excitement → *Mitigation:* Onboarding checklist, "weekly vault summary" email. *Gap:* Retention emails can feel spammy if poorly timed.

---

### 3. The Polyglot

**Archetype:** Browser-primary user who needs context across AI chat interfaces. Does not use terminal-based AI tools — the extension is their entire interface to the vault.
**Journey:** 4 (Chrome Extension) — enters from any prior journey, but the defining trait is browser-first workflow

**Demographics & Background:** *Hypothesis*
- Developer, designer, product manager, or knowledge worker
- Uses 2-4 AI chat interfaces daily via browser — ChatGPT, Claude.ai, Gemini, Perplexity
- Browser is the primary workspace — 20+ tabs, multiple AI chats open simultaneously
- Does not use Claude Code, Cursor, or other terminal/MCP-capable tools (or uses them rarely)
- Comfortable installing extensions but not configuring CLI tools or JSON config files

**Goals:**
- Unified knowledge layer accessible from any browser tab
- Quick injection of saved context into any AI chat — no copy-paste from files
- Search vault without leaving the browser
- Consistent context regardless of which AI tool is being used

**Pain Points:**
- Knowledge is siloed per tool — Claude doesn't know what was discussed in ChatGPT
- Re-explaining project context every time a new chat starts
- Copy-pasting context snippets between tools is tedious and error-prone
- Browser-based AI tools have no MCP support — the extension is the only bridge
- Terminal-based memory tools are invisible to their workflow

**Behavioral Patterns:**
- Installs browser extensions readily — has 10-15 active extensions
- Uses keyboard shortcuts and expects polish in UI interactions
- Evaluates extension by injecting one piece of context — if it works smoothly, adopts fully
- Uses the extension daily for context injection, less often for saving new entries
- May never use the CLI or dashboard — the extension is their entire interface

**Technical Proficiency:** Low to moderate. Comfortable with browser-based tools but avoids terminal workflows. The extension must require zero CLI interaction after initial connect.

**Quote:**
> "I have six AI chats open right now. None of them know what the others said."

**Discovery Channels:** Chrome Web Store search ("AI memory", "ChatGPT context"), "best AI Chrome extensions" listicles and YouTube roundups, Reddit threads (r/ChatGPT, r/ClaudeAI), browser extension recommendation sites.

**Activation Trigger:** Spends 5 minutes re-explaining a project to ChatGPT that they already told Claude about. Searches Chrome Web Store for "AI memory."

**Success Metric:** Uses inject feature 3+ times in first week. Extension stays installed after 14 days.

**Churn Risks & Mitigations:**
- Injection fails on a specific platform (DOM changes, layout updates) → *Mitigation:* Per-platform content scripts tested against real DOM, fast release cycle for fixes. *Gap:* ChatGPT/Claude/Gemini can ship DOM changes at any time — requires ongoing monitoring.
- Search returns poor results for short queries → *Mitigation:* Hybrid full-text + semantic search, relevance tuning. *Gap:* Small vaults (< 20 entries) may not have enough data for meaningful results.
- Extension requires CLI setup they can't complete → *Mitigation:* Cloud-only onboarding path that starts in the dashboard, not the terminal. *Gap:* Hosted account is required — local-only users can't use the extension without migration.

---

### 4. The Team Champion

**Archetype:** Engineering manager or team lead who wants shared context across their team.
**Journey:** 2 → 5 (Cloud-First → Pro/Team Upgrade) — adopts individually, then rolls out to team

**Demographics & Background:** *Hypothesis*
- Engineering manager, staff engineer, or tech lead at a 10-100 person engineering org
- 8-15 years experience, 2-5 years in a leadership role
- Responsible for developer productivity, tooling decisions, and onboarding
- Already manages team licenses for GitHub, Linear, Notion, or similar
- Evaluates tools on behalf of the team — personal adoption precedes team rollout

**Goals:**
- Shared knowledge base that preserves institutional decisions and architectural context
- Reduce onboarding time for new team members ("why did we choose Postgres?")
- Standardize how the team captures and retrieves technical decisions
- Single admin dashboard for managing team entries, API keys, and usage

**Pain Points:**
- Tribal knowledge lives in Slack threads, Google Docs, and individual heads
- New hires spend weeks re-discovering decisions that were made months ago
- Individual developers each maintain their own context — nothing is shared
- Existing wiki tools (Confluence, Notion) are write-only graveyards — nobody searches them
- Needs to justify tool spend to engineering leadership

**Behavioral Patterns:**
- Tries Context Vault personally for 2-4 weeks before proposing to the team
- Evaluates based on: ease of team onboarding, admin controls, cost per seat, data export
- Asks "what happens if we stop paying?" before committing team budget
- Wants a single `connect` command that works for every team member
- Will write an internal "how to use Context Vault" doc for the team

**Technical Proficiency:** High personally, but optimizes for the lowest-common-denominator on their team. If one team member can't set it up in 10 minutes, it's a blocker.

**Quote:**
> "We made that decision six months ago. It's in a Slack thread somewhere. Good luck finding it."

**Discovery Channels:** Engineering leadership blogs/newsletters, "developer productivity tools" roundups, peer recommendations at eng-manager meetups or Slack communities (Rands Leadership, Engineering Managers), team member who already uses it individually.

**Activation Trigger:** New hire asks "why did we choose X?" and nobody can find the original decision. Or: a team member demos Context Vault in a team meeting.

**Success Metric:** 3+ team members active within 14 days of team onboarding. Team has 100+ shared entries after 60 days.

**Churn Risks & Mitigations:**
- Team onboarding is too manual (each person must run connect individually) → *Mitigation:* Admin provisioning flow, invite links, SSO integration on Team tier. *Gap:* SSO/SAML is complex to build and may not be ready at launch.
- No admin visibility into team usage or entry quality → *Mitigation:* Team dashboard with usage metrics, entry activity feed. *Gap:* Privacy expectations vary — some teams won't want managers reading individual entries.
- Can't justify $29/mo to leadership without ROI data → *Mitigation:* Usage reports, "time saved" estimates, export for auditing. *Gap:* ROI for knowledge tools is notoriously hard to measure.
- Key person leaves and team stops using it → *Mitigation:* Onboarding checklist, multiple admins, automated reminders. *Gap:* Cultural adoption can't be solved purely by product features.

---

## Lifecycle Transitions

These aren't separate personas — they're predictable moments when an existing persona's needs outgrow their current setup.

### Transition A: Local → Cloud Migration

**Who:** The Sovereignty Dev after 3-6 months of local use.
**Journey:** 3 (Local → Cloud)

**Trigger Events:**
- Gets a new machine and realizes vault isn't synced
- Wants to use the Chrome extension (requires hosted endpoint)
- Team members ask to share the vault
- Laptop SSD scare — realizes local-only has no backup

**Emotional State:** Cautious. Has invested in local entries and doesn't want to lose them or cede control.

**Requirements for Conversion:**
- Migration must be non-destructive — local files preserved as-is
- Clear explanation of what "cloud" means (their data, their account, not training data)
- Ability to maintain local as read-only backup
- Optional `sync` for ongoing bidirectional sync (not forced cloud-only switch)

**Friction Points:**
- "What happens to my local vault?" — must be answered before they'll proceed
- API key management feels like lock-in — needs reassurance
- Wants to verify cloud entries match local entries after migration

**Conversion Metric:** Completes migration within one session. Verifies entry count matches. Connects a second machine within 7 days.

---

### Transition B: Free → Pro Upgrade

**Who:** The Pragmatist (or any cloud user) after 2-4 months of active use.
**Journey:** 5 (Pro Upgrade)

**Trigger Events:**
- Hits 500 entry limit on an active project
- Rate-limited during a productive session (429 errors break flow)
- Wants to create separate API keys for different machines/tools
- Team wants shared access

**Emotional State:** Mildly frustrated but already bought in. The tool works — they just need more of it.

**Requirements for Conversion:**
- Limits must be clearly communicated before they're hit (usage meters, not surprise blocks)
- Upgrade must be instant — no waiting, no sales calls, no "contact us"
- Price must feel proportional to value ($9/mo is an easy yes if it saves 2+ hours/month)
- Downgrade path must exist (reduces churn anxiety)

**Friction Points:**
- Surprise rate limits during a productive session create anger, not conversion
- Unclear what "Pro" adds beyond higher numbers — needs tangible feature differentiation
- Team tier at $29/mo needs clear multi-seat value, not just higher limits

**Conversion Metric:** Upgrades within 48 hours of first limit hit. Retention at 90 days post-upgrade > 80%.

---

### Transition C: Individual → Team Rollout

**Who:** The Team Champion after 2-4 weeks of personal use.
**Journey:** 2 → 5 (Cloud-First → Team Upgrade)

**Trigger Events:**
- Realizes their personal vault entries would be useful to the whole team
- New hire onboarding reveals how much tribal knowledge is undocumented
- Team retrospective identifies "lost context" as a recurring problem
- Another team member independently discovers Context Vault

**Emotional State:** Enthusiastic but risk-aware. Needs to sell this internally and will look bad if it fails.

**Requirements for Conversion:**
- Low-friction team onboarding — ideally a single invite link or shared config
- Admin controls: manage members, view usage, export data
- Clear per-seat or flat-rate pricing they can expense without executive approval
- Data portability guarantee — can export everything if the team stops using it

**Friction Points:**
- "Can I demo this to my team without them each creating accounts?" — needs a compelling demo path
- Individual entries mixed with team entries creates confusion — needs clear workspace separation
- If the cheapest team plan is $29/mo and only 2 people use it, feels expensive

**Conversion Metric:** Moves from personal Pro to Team tier within 30 days of first sharing entries with a colleague. 3+ team members active within 14 days of team creation.

---

## Anti-Personas

These are people Context Vault is explicitly **not** built for. Documenting them prevents feature creep and sharpens positioning.

### The Note-Taker

**Who they are:** Knowledge worker who wants a general-purpose note-taking app. Uses Notion, Obsidian, or Apple Notes for everything. Organizes notes manually with folders and tags.

**Why they're not our user:**
- Wants manual organization, not AI-driven retrieval
- Doesn't use AI coding tools — no MCP integration point
- Expects rich text editing, drag-and-drop, mobile apps
- Would compare Context Vault to Notion and find it lacking in every dimension except AI search

**What we'd have to build to serve them:** Rich text editor, mobile apps, folder hierarchy, sharing/collaboration UI — all of which distract from the core MCP-native value prop.

**Boundary this enforces:** Context Vault is a *retrieval layer for AI tools*, not a note-taking app. Entries are captured through AI conversation, not manual editing.

---

### The Enterprise Buyer

**Who they are:** IT procurement or security team at a 500+ person company. Requires SSO/SAML, SOC 2 compliance, data residency guarantees, audit logs, and a vendor security questionnaire before evaluating.

**Why they're not our user (yet):**
- Compliance and procurement requirements would consume 6+ months of engineering
- Sales cycle is 3-6 months with multiple stakeholders — incompatible with current stage
- Requires SLAs, uptime guarantees, and dedicated support infrastructure
- Would demand on-premises deployment or specific cloud regions

**What we'd have to build to serve them:** SSO/SAML, SOC 2 audit, data residency controls, audit logging, SLA infrastructure, on-prem deployment option, enterprise sales process.

**Boundary this enforces:** The Team tier ($29/mo) serves small-to-mid teams who can self-serve. Enterprise is a future expansion, not a launch target. Don't add SSO, audit logs, or compliance features until there's clear demand from paying Team-tier customers growing into it.

---

## Persona Overlap Matrix

Shows which product surfaces matter most to each persona.

| Surface | Sovereignty Dev | Pragmatist | Polyglot | Team Champion |
|---------|:-:|:-:|:-:|:-:|
| Landing page | Low | High | Medium | Medium |
| Dashboard | Low | High | Low | High |
| CLI | High | Medium | Low | Medium |
| Chrome Extension | Low | Medium | High | Low |
| MCP Endpoint | High | High | Low | High |
| REST API | Medium | Low | Low | Medium |
| Admin/Team mgmt | None | None | None | High |

---

## Persona-to-Feature Priority

What each persona needs most in the next release cycle.

| Priority | Sovereignty Dev | Pragmatist | Polyglot | Team Champion |
|----------|----------------|------------|----------|---------------|
| P0 (must have) | Bulletproof local setup, plain markdown files | One-command connect, auto-detect editors | Reliable inject on ChatGPT/Claude/Gemini | Team workspace with invite flow |
| P1 (should have) | Git-friendly sync, export/import | Dashboard search + browse | Keyboard shortcuts, search-as-you-type | Usage dashboard, member management |
| P2 (nice to have) | Offline embedding model options | Onboarding checklist | Save-from-browser (capture, not just inject) | Entry-level permissions (read/write) |
| P3 (future) | Self-hosted cloud option | Team sharing | Cross-browser support (Firefox, Safari) | SSO/SAML, audit logs |

---

## Journey Connections (Persona View)

```
  Sovereignty Dev              Pragmatist               Team Champion
        │                          │                          │
 ┌──────┴──────┐            ┌──────┴──────┐                   │
 │ Journey 1   │            │ Journey 2   │            (adopts via
 │ Local-First │            │ Cloud-First │             Journey 2
 └──────┬──────┘            └──────┬──────┘             personally)
        │                          │                          │
        │ Transition A             ├── Transition B ──────────┤
        │ (3-6 months)             │   (2-4 months)           │
        ▼                          ▼                          │
 ┌─────────────┐            ┌─────────────┐                   │
 │ Journey 3   │            │ Journey 5   │      Transition C │
 │ Migration   │            │ Pro Upgrade │      (2-4 weeks)  │
 └──────┬──────┘            └─────────────┘                   │
        │                                                     ▼
        │                                             ┌──────────────┐
        │                                             │ Journey 5    │
        │                                             │ Team Upgrade │
        │                                             └──────────────┘
        ▼
 ┌─────────────┐
 │  Polyglot   │◄──── enters from Journey 1, 2, or 3
 │ Journey 4   │      (browser-primary, not CLI users)
 │ Extension   │
 └─────────────┘
```
