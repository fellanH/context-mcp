# Context Vault 90-Day Production + Distribution + Revenue Plan (MCP-First, Open-Core)

## Summary
This plan merges your active implementation tracks from `/Users/admin/.claude/plans/snug-zooming-llama.md` and `/Users/admin/.claude/plans/enumerated-leaping-castle.md` into a single delivery plan for production readiness, distribution, sales, and marketing.

Current repo/deployment review indicates:
- Core hosted/API foundation is strong, with auth, billing, vault CRUD/search, and staging/prod Fly pipeline already present.
- Deployment hardening is incomplete in CI/smoke validation: `/Users/admin/dev/context-vault/.github/workflows/ci.yml:8` and `/Users/admin/dev/context-vault/scripts/smoke-test.sh:30`.
- Production domain currently serves API health, but key public distribution endpoints are not live: `https://www.context-vault.com/` returns `404`; `https://www.context-vault.com/api/vault/openapi.json` returns `404`.
- App UX is mostly wired to backend, but docs/message consistency is stale: `/Users/admin/dev/context-vault/packages/app/README.md:75` and onboarding snippets in `/Users/admin/dev/context-vault/packages/app/src/app/pages/Dashboard.tsx:80` and `/Users/admin/dev/context-vault/packages/app/src/app/pages/Register.tsx:92`.
- Extension phases 1-5 are mostly in place, but 6-10 are incomplete in code paths: `/Users/admin/dev/context-vault/packages/extension/src/popup/main.tsx:1`, `/Users/admin/dev/context-vault/packages/extension/src/background/index.ts:23`, `/Users/admin/dev/context-vault/packages/extension/scripts/build.mjs:32`, `/Users/admin/dev/context-vault/packages/extension/src/shared/types.ts:43`.

## Business Direction (Locked)
- Primary goal: Paid revenue in 90 days.
- ICP: Solo AI developers.
- GTM motion: Lean founder-led.
- Launch wedge: Hosted MCP API first.
- Packaging: Open-core (free local + paid hosted).

## Scope
In scope:
- Production reliability and deployment correctness.
- MCP-first activation funnel to paid hosted plan.
- Channel distribution for MCP clients, npm, extension, GPT actions.
- Founder-led sales and content marketing motion.

Out of scope for this cycle:
- Enterprise SOC2/ISO programs.
- Team-admin heavy features beyond current tier framework.
- Multi-region active-active infra.

## Workstream 1: Production Deployment Hardening (Weeks 1-2)
1. Fix release gates so deploys can only ship when app/API/public endpoints are valid.
2. Add `build-app` and `build-extension` CI jobs before deploy in `/Users/admin/dev/context-vault/.github/workflows/ci.yml`.
3. Expand smoke checks in `/Users/admin/dev/context-vault/scripts/smoke-test.sh`:
- `GET /` returns HTML with app root.
- `GET /api/vault/openapi.json` returns `200`.
- `GET /privacy` returns `200`.
4. Enforce runtime consistency with Node 20 in dev/CI by adding `.nvmrc` and documenting in root README.
5. Recover staging environment and add explicit staging health gate before production promotion.
6. Confirm production image serves app assets via `/Users/admin/dev/context-vault/packages/hosted/src/index.js:250` and Docker build in `/Users/admin/dev/context-vault/packages/hosted/Dockerfile:1`.

Acceptance criteria:
- Main push executes test → build-app → build-extension → deploy-staging → smoke-staging → deploy-prod → smoke-prod.
- Prod returns `200` on `/`, `/health`, `/api/vault/openapi.json`, `/privacy`.
- Failed smoke blocks prod deploy.

## Workstream 2: Product Completion and Cleanup (Weeks 2-4)
1. Close remaining app plan cleanup:
- Remove stale mock/demo messaging from `/Users/admin/dev/context-vault/packages/app/README.md`.
- Delete `/Users/admin/dev/context-vault/packages/app/src/app/lib/mockData.ts` if no live imports remain.
2. Canonicalize endpoint snippets in app onboarding:
- Replace `https://api.contextvault.io/mcp` with production canonical MCP URL in `/Users/admin/dev/context-vault/packages/app/src/app/pages/Dashboard.tsx:80` and `/Users/admin/dev/context-vault/packages/app/src/app/pages/Register.tsx:92`.
3. Finish extension phases 6-10:
- Wrap popup with ErrorBoundary in `/Users/admin/dev/context-vault/packages/extension/src/popup/main.tsx`.
- Add not-connected CTA/rate-limit warning logic in `/Users/admin/dev/context-vault/packages/extension/src/popup/components/App.tsx`.
- Add onboarding build output in `/Users/admin/dev/context-vault/packages/extension/scripts/build.mjs`.
- Implement multi-kind context menu in `/Users/admin/dev/context-vault/packages/extension/src/background/index.ts`.
- Add extension privacy page under `/Users/admin/dev/context-vault/packages/extension/public/privacy.html`.
4. Fix extension host access model for user-defined vault domains:
- Add `optional_host_permissions` strategy and runtime permission request path.
- Keep minimum default host permissions to reduce install friction.
5. Align default extension server URL to real hosted endpoint in `/Users/admin/dev/context-vault/packages/extension/src/shared/types.ts:43`.

Acceptance criteria:
- App docs match real backend behavior.
- Extension install flow includes onboarding, connectivity, and privacy page.
- Extension can connect to arbitrary user-selected hosted domains with explicit permission grant.

## Workstream 3: Distribution System (Weeks 3-6)
1. MCP-native distribution (primary):
- Maintain canonical OpenAPI endpoint for integrations: `/api/vault/openapi.json`.
- Publish “connect in 2 minutes” docs for Claude Code/Cursor/GPT Actions.
2. Packaging surfaces:
- npm package (`context-vault`) remains free/open local path.
- Hosted paid path remains API-key SaaS.
- Extension becomes secondary convenience surface after reliability pass.
3. Directory/platform presence:
- Smithery listing with clear install docs and health URL.
- Cursor MCP setup docs linked from onboarding and dashboard.
- GPT Actions setup docs linked to public OpenAPI + privacy URL.
4. Funnel consistency:
- One canonical domain and URL set across app copy, extension defaults, docs, and README.
- One canonical “Start free” CTA path: register → API key → MCP config copy → first save/search.

Acceptance criteria:
- New user can discover, register, connect MCP, and run first successful `context_status` + `save_context` + `get_context` in <10 minutes without manual support.
- All public docs and in-app snippets use identical base URL.

## Workstream 4: Sales Motion (Founder-Led, Weeks 4-10)
1. ICP sales playbook (solo AI devs):
- Pain: stateless agent sessions.
- Promise: persistent agent memory in minutes.
- Offer: free tier for evaluation, Pro unlock for sustained usage/export.
2. Pipeline structure:
- 50 qualified founder conversations from dev communities and inbound docs CTA.
- 20 activation calls/screenshares.
- 10 conversion asks to Pro.
3. Sales assets:
- 1-page solution brief.
- 3 demo scripts: CLI local, hosted MCP, extension inject flow.
- objection handling around privacy/local-first/open-core.
4. Pricing execution:
- Keep current Free/Pro/Team limits as baseline.
- Add founder-led discount code only for first cohort if conversion stalls.

Revenue targets by day 90:
- 150 activated hosted users.
- 8-12% free-to-paid conversion.
- 12+ paying Pro accounts minimum.

## Workstream 5: Marketing Motion (Lean, Weeks 4-12)
1. Positioning:
- Category: memory layer for AI agents.
- Wedge statement: “Your MCP tools can finally remember.”
- Differentiator: open-core + portable markdown vault + hosted option.
2. Content cadence:
- 2 technical posts/week.
- 1 short demo video/week.
- 1 build-in-public update/week with real metrics.
3. Channel mix:
- Primary: X, GitHub, Hacker News show-and-tell, Reddit dev communities, Cursor/Claude communities.
- Secondary: Product Hunt launch once onboarding and smoke gates are stable.
4. Campaign sequence:
- Campaign A: “Ship MCP memory in 5 minutes.”
- Campaign B: “Move from local vault to hosted without lock-in.”
- Campaign C: “Inject vault context into ChatGPT/Claude/Gemini.”
5. Conversion optimization:
- Landing page focuses on one CTA and one proof path.
- Track visit → register → API key copy → first MCP call → first saved entry → upgrade click.

Marketing targets by day 90:
- 5k monthly site sessions.
- 20% visitor-to-register.
- 35% register-to-activated.

## Important Public API / Interface Changes
1. No net-new backend resource model required; stabilize and guarantee public availability of:
- `GET /api/vault/openapi.json`
- `GET /privacy`
- `POST /mcp`
- `POST /api/register`
2. Standardize public base URL references in app/extension/docs to one canonical host.
3. Extension interface updates:
- Add runtime host permission request flow for user-selected server origins.
- Add onboarding page route and privacy page in packaged artifact.
- Expand context-menu capture interface to explicit kind variants.

## Test Cases and Release Scenarios
1. CI and smoke:
- Test matrix on Node 20.
- Verify all public endpoints and auth failure modes.
- Verify root SPA route and client-side route fallback.
2. Product E2E:
- Register → API key issued → login with key → dashboard loads usage.
- Save entry → search entry → delete entry.
- Billing checkout URL generation and post-checkout return path.
3. Extension E2E:
- Fresh install opens onboarding.
- Settings save + connectivity test success.
- Search in popup, inject to supported chat UIs.
- Context menu sub-items create correct kind.
- Offline/timeout shows resilient error states.
4. Distribution checks:
- OpenAPI import works in GPT Actions.
- MCP setup docs validated on Claude Code and Cursor.
- Smithery listing points to healthy endpoint.
5. Monitoring:
- Uptime and error alerts on `/health`, `/mcp`, `/api/register`, `/api/vault/search`.
- Funnel analytics dashboard updated daily.

Release gates:
- No prod deploy unless staging smoke passes.
- No marketing launch unless extension onboarding/privacy and app root route are live.
- No paid campaign spend until conversion funnel instrumentation is complete.

## Assumptions and Defaults
- Time horizon is 90 days.
- Team is founder-led with limited paid acquisition budget.
- Primary monetization is hosted API subscriptions.
- Local CLI remains free/open as top-of-funnel acquisition.
- MCP API reliability is prioritized over extension feature breadth.

## External Inputs Used
- [Vercel pricing](https://vercel.com/pricing)
- [Fly.io pricing docs](https://fly.io/docs/about/pricing/)
- [OpenAI Actions docs](https://platform.openai.com/docs/actions)
- [Chrome Web Store registration](https://developer.chrome.com/docs/webstore/register/)
- [Chrome Web Store publish flow](https://developer.chrome.com/docs/webstore/publish/)
- [Chrome extension cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Smithery docs](https://docs.smithery.ai/)
- [Cursor MCP docs](https://docs.cursor.com/en/context/model-context-protocol)
- [Anthropic MCP docs](https://docs.anthropic.com/en/docs/agents-and-tools/mcp)
