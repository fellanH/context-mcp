# GTM Backlog

**Last triaged:** 2026-02-20

---

## Now

Active work. Hard cap: 3 items. Finish or demote before adding.

| Item                                                   | Type         | Source                                  |
| ------------------------------------------------------ | ------------ | --------------------------------------- |
| Ship Campaign A distribution (X thread, Reddit, HN)    | distribution | `sales-assets.md` — drafts ready        |
| Record demo GIF for landing page product-proof section | content      | `marketing-plan.md` — product-proof gap |
| Submit to awesome-mcp list                             | distribution | Community discovery channel             |

---

## Done

_Only the latest batch. Older items archived — see `weekly-log.md` and git history for full record._

| Item                                             | Type | Date |
| ------------------------------------------------ | ---- | ---- |
| _Nothing shipped yet — GTM backlog just created_ | —    | —    |

---

## Next

Ordered by ICE score (Impact × Confidence × Ease). Pull from top when `Now` has space.

| Item                                                                          | Type            | ICE | I   | C   | E   | Milestone         |
| ----------------------------------------------------------------------------- | --------------- | --- | --- | --- | --- | ----------------- |
| Show HN post                                                                  | distribution    | 75  | 5   | 5   | 3   | GTM blitz         |
| Stress-test fresh install (npm i → first save_context < 2 min)                | onboarding      | 60  | 5   | 4   | 3   | Onboarding funnel |
| Instrument funnel events (lp_view → register → first_save → checkout_success) | instrumentation | 48  | 4   | 4   | 3   | Feedback loop     |
| Set up GitHub Discussions for user feedback                                   | community       | 40  | 4   | 5   | 2   | Feedback loop     |
| Draft "why pay" pricing narrative for /pricing page                           | sales           | 36  | 4   | 3   | 3   | Hosted revenue    |
| Post to r/ClaudeAI and r/cursor subreddits                                    | distribution    | 30  | 3   | 5   | 2   | GTM blitz         |
| Add in-product feedback prompt (post-activation)                              | community       | 24  | 4   | 3   | 2   | Feedback loop     |
| Evaluate re-ranking strategies for search results                             | search-quality  | 20  | 4   | 5   | 1   | Search quality    |
| Explore better embedding model options                                        | search-quality  | 16  | 4   | 4   | 1   | Search quality    |

---

## Later

Parking lot. No commitment, no ordering.

- Discord community server
- Product Hunt launch
- Paid acquisition experiments (Reddit ads, Carbon ads)
- Campaigns B & C (drafts in `sales-assets.md`)
- CRO A/B tests on landing page
- Comparison landing pages (vs Mem, vs Obsidian, vs static .md files)

---

## Signals

Raw user feedback, community mentions, distribution opportunities. Review weekly during triage.

| Date | Signal                                                                     | Source | Action |
| ---- | -------------------------------------------------------------------------- | ------ | ------ |
| —    | _No signals yet. Check vault `feedback` entries and GitHub issues weekly._ | —      | —      |

---

## Decisions

Key GTM choices. Reference, not action items.

| Date       | Decision                                                 | Reasoning                                                                                                                                       |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-20 | Content pieces tracked in `content-tracker.md`, not here | GTM backlog is for strategic/structural tasks. Individual blog posts, videos, and BIP updates stay in the content tracker to avoid duplication. |
| 2026-02-20 | GTM blitz before onboarding optimization                 | Need traffic to measure the funnel. Ship distribution first, then instrument and optimize.                                                      |
| 2026-02-20 | ICE scoring calibrated for GTM context                   | Impact = adoption/revenue lift. Confidence = user signal strength. Ease = session count to ship.                                                |

---

## Cross-Reference: GTM Docs

How this backlog relates to other GTM docs in `docs/gtm/`:

| File                 | Relationship                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GTM-CONTEXT.md`     | ICP, CTAs, content pillars — the strategic foundation this backlog executes against                                             |
| `content-tracker.md` | Individual content pieces (blog, video, BIP). GTM backlog tracks the strategic tasks; content tracker tracks production status. |
| `weekly-log.md`      | Execution journal. When a GTM backlog item ships, record it in the weekly log too.                                              |
| `pipeline.md`        | Founder-led sales CRM. GTM backlog may generate leads that flow into the pipeline.                                              |
| `sales-playbook.md`  | Core pitch and objection handling. Informs GTM backlog items like the pricing narrative.                                        |
| `sales-assets.md`    | Campaign drafts and collateral. GTM backlog items reference assets here; don't duplicate content.                               |
| `funnel-metrics.md`  | Numeric targets. Instrumentation items in this backlog feed data into funnel metrics.                                           |
| `assets/`            | Campaign drafts (X threads, Reddit posts, HN posts). GTM backlog "Ship Campaign A" pulls from here.                             |
| `demos/`             | Demo video scripts. GTM backlog "Record demo GIF" may reference scripts here.                                                   |
