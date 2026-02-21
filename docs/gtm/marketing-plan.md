# Context Vault Website Plan (High-Conversion Landing + Blog)

This plan turns the existing GTM strategy into a website system optimized for activation and paid conversion.

## 1) Targets and Success Criteria

Primary conversion goal:

- Visitor -> Register (`/register`)

Activation goal:

- Register -> first successful MCP usage:
- API key copied
- first `context_status`
- first `save_context`
- first `get_context`

Paid goal:

- Upgrade click -> paid conversion

90-day targets (aligned with `docs/gtm/funnel-metrics.md`):

- 5,000 monthly sessions
- 20% visitor -> register
- 35% register -> activated
- 8-12% free -> paid
- 12+ paying Pro accounts

## 2) ICP and Messaging Fit

Primary ICP:

- Solo AI developers
- Technical founders shipping AI workflows
- Small product teams using Claude/Cursor/Codex/GPT Actions

Core pains:

- AI sessions are stateless and repetitive
- Valuable decisions get lost between chats
- Existing notes/docs are not agent-friendly retrieval systems

Core promise:

- "Your MCP tools can finally remember."

Positioning stack:

- Category: memory layer for AI agents
- Wedge: ship persistent memory in minutes
- Differentiator: open-core local vault + hosted MCP path + markdown portability

## 3) Landing Page Architecture (Single Primary CTA)

Route:

- `/` (public marketing landing page)

Primary CTA everywhere:

- `Start free`
- Destination: `/register`

Secondary CTA (lower emphasis):

- `See 2-minute setup`
- Destination: `/docs/distribution/connect-in-2-minutes`

Recommended page structure:

1. Hero (above the fold)

- Headline: "Persistent memory for AI agents."
- Subheadline: "Save and retrieve context across Claude, Cursor, and MCP-compatible tools in minutes."
- Proof strip: npm version/downloads + open source + local-first
- CTA row: `Start free` + `See 2-minute setup`

2. Problem -> Outcome

- "Agents restart from zero every session."
- "Context Vault gives them durable memory with portable files."
- 3 measurable outcomes:
- less repeated prompting
- faster task continuation
- reusable institutional context

3. How It Works (3 steps)

- Step 1: install + setup
- Step 2: save context during work
- Step 3: retrieve context in future sessions
- Include one real command and one real tool call example

4. Product Proof

- Demo GIF
- Short "before vs after" workflow snapshot
- Reliability points: local-first data ownership, rebuildable index, hybrid retrieval

5. Objection Handling (conversion-critical)

- Privacy: data remains in user-controlled vault, hosted accounts isolated by key
- Lock-in: markdown files + export path
- Complexity: one MCP endpoint + copy/paste config

6. Pricing Teaser

- Free vs Pro summary (no decision fatigue)
- Clear upgrade trigger: higher limits + sustained hosted usage
- CTA: `Start free`

7. Final CTA + FAQ

- Repeat promise and next step
- FAQ:
- "Can I stay fully local?"
- "Can I move to hosted later?"
- "Will this work with my AI client?"

## 4) Conversion Rules (Non-Negotiable)

- One primary CTA label (`Start free`) across all high-intent sections
- Keep first action low-friction (register, copy config, run first call)
- No paid campaign before full funnel instrumentation is live
- No launch campaign unless `/`, `/privacy`, and `/api/vault/openapi.json` are healthy
- Place one proof element before first CTA on mobile viewport

## 5) Blog Strategy (Demand Capture + Trust Building)

Route:

- `/blog`

Blog mission:

- Capture high-intent search traffic
- Educate technical users to first successful MCP usage
- Push readers into activation funnel, not vanity traffic

Content pillars:

1. Integration guides (highest conversion intent)

- "Context Vault + Claude Code in 5 minutes"
- "Context Vault + Cursor setup and best practices"
- "Using MCP memory with GPT Actions"

2. Use-case playbooks

- "Build an AI dev memory system for client work"
- "How solo founders prevent context loss across sessions"
- "Project handoff with persistent agent memory"

3. Product education / retrieval depth

- "How hybrid FTS + embedding retrieval improves relevance"
- "Designing kinds/tags/folders for long-term memory quality"
- "Local-first memory architecture with markdown + SQLite"

4. Comparisons and objections

- "Notes app vs agent memory layer"
- "Why local-first memory beats opaque hosted-only memory"
- "Avoid lock-in: portable context patterns"

## 6) Blog Conversion Template (Every Post)

Required structure:

- Clear technical outcome in first 120 words
- Step-by-step implementation body
- Lightweight proof (commands, screenshots, expected output)
- CTA block at mid-article: `Start free`
- CTA block at end:
- primary: `Start free`
- secondary: `See 2-minute setup`

Internal linking requirements:

- Each new post links to 2 relevant older posts
- Each post links to one product page section and one docs quickstart
- Add "Related guides" section before final CTA

## 7) SEO and Distribution Plan

On-page requirements:

- One primary keyword per page/post
- Intent-matching title + meta description
- Clean H2 structure mirroring user tasks
- FAQ schema on landing page
- Article schema on blog posts

Technical requirements:

- Fast LCP on mobile
- Static rendering for landing + blog pages where possible
- Auto-generated sitemap and RSS feed
- Canonical URLs on all posts

Distribution cadence:

- 2 technical blog posts/week
- 1 short demo video/week
- 1 build-in-public metric update/week
- Repurpose each post for GitHub/X/Reddit/communities

## 8) Instrumentation (Event Map)

Core events:

- `lp_view`
- `lp_cta_click_start_free`
- `lp_cta_click_docs`
- `register_success`
- `api_key_copy`
- `mcp_call_context_status_success`
- `mcp_call_save_context_success`
- `mcp_call_get_context_success`
- `upgrade_click`
- `checkout_success`

Required dashboards:

- Visitor -> register conversion by channel
- Register -> activated conversion by cohort
- Activated -> paid conversion by plan and channel
- Top blog posts by assisted conversion (not only pageviews)

## 9) CRO Experiment Backlog (Prioritized)

Run at least one test every 2 weeks.

P1 tests:

1. Hero headline:

- A: "Persistent memory for AI agents"
- B: "Your MCP tools can finally remember"

2. CTA copy:

- A: `Start free`
- B: `Set up in 2 minutes`

3. Proof placement:

- Demo above fold vs below fold

P2 tests:

1. Pricing teaser length:

- short bullets vs mini-comparison table

2. Objection block order:

- privacy first vs lock-in first

3. Blog CTA format:

- inline text link vs visual CTA card

## 10) 12-Week Execution Plan

Weeks 1-2:

- Finalize messaging, landing wireframe, and analytics events
- Ship V1 landing page with hero, proof, objections, CTA
- Publish 4 high-intent integration posts

Weeks 3-6:

- Add pricing teaser, FAQ, comparison content
- Publish 8 additional posts across use-case and retrieval pillars
- Start first 3 CRO tests

Weeks 7-12:

- Double down on top-converting channels/posts
- Expand cluster pages around top-performing keywords
- Run next 3 CRO tests and keep winners only

## 11) Acceptance Gates for Launch

Landing + blog launch is "ready" when:

- Funnel events are firing end-to-end in production
- `/`, `/privacy`, `/api/vault/openapi.json` pass smoke checks
- At least 3 integration posts are live and internally linked
- First-time visitor can reach `register_success` in < 3 minutes
