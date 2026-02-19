# Bugs, Improvements & Roadmap

**Last updated:** 2026-02-19

---

## Contents

- [Active Bugs](#active-bugs)
- [In Progress](#in-progress)
- [Backlog](#backlog)
- [Future](#future)
- [Completed](#completed)

---

## Active Bugs

None known.

---

## In Progress

_Nothing in progress._

---

## Backlog

### Dashboard & onboarding `P1`

- Add quick access to main user journey steps on first dashboard view.
- Surface missing setup steps: local folder connection, hosted vault upload, MCP server in AI agent tools.
- Improve user journey so onboarding is seamless and intuitive at all stages.

### Hosted UX `P1`

- **Registration:** Auto-connect MCP server settings to major providers for new users.
- **Local folder:** Allow folder picker (Finder) instead of typing path; enable connect without login.
- **Post-connect:** After creating account post local-connect, prompt to upload local folder to hosted vault with optional sync. (Evaluate and discuss.)

### Auth `P1`

- Replace confusing API key creation during login/signup with proper auth (e.g. Google email sign-in).

### CLI / Setup `P2`

- Add Codex and Antigravity support during `context-mcp setup`.

---

## Future

### Near-term

**Data import flexibility**

- Support formats beyond JSON.
- Allow uploading a folder or document of any kind.
- Auto-categorize and convert to vault structure (markdown + YAML).

**Local-mode API parity**

- Add local endpoints: `/api/vault/import`, `/api/vault/export`, `/api/account` (if desired).

**Account management**

- Local users: sign in to / create cloud account.
- Connect local account to cloud account.
- Seamless transition between local and cloud.

### Later

**External URL ingestion**

- Accept URLs to hosted docs, blog articles, social posts, or video.
- Different pipelines per source type to convert to structured context documents.

**Export & data ownership**

- **Principle:** Never lock data behind paywall; free users must be able to export.
- **Incentive for paid:** Managed hosting, storage, convenience.
- **Privacy:** Data always private, fully encrypted, accessible only to account owner.
- Improve export UX to avoid lock-in; easy data access is critical.

### Someday

**Pricing & free tier**

- Review and refine pricing tiers and free user model over time.

---

## Completed

| Item | Status | Resolution | Date |
|------|--------|------------|------|
| API key creation fails in local mode | Fixed | Local mode disables hosted API key create/delete; shows local-mode guidance instead of failing. | 2026-02 |
| Storage card number overflow | Fixed | Storage values normalized and displayed with concise precision (up to 2 decimals). | 2026-02 |
| Search result click does nothing | Fixed | Search results open inline entry inspector; Enter/Space keyboard activation supported. | 2026-02 |
| Drawer layout issues | Fixed | Entry drawer has improved spacing; metadata uses compact responsive grid. | 2026-02 |
| Getting started card validity | Improved | Checklist completion derived from real signals (auth mode, API key, key activity, entries). | 2026-02 |
| MCP server status visibility | Added | Top bar shows mode + connection: `Local/Hosted` + `Connected/Degraded/Disconnected`. | 2026-02 |
| Dashboard quick setup bar | Added | When steps incomplete: direct actions for Create API key, Copy MCP config, Add first entry; "Show full checklist" when dismissed. | 2026-02 |
| First-entry step links | Added | Checklist now links to Add entry and Import data when first-entry incomplete. | 2026-02 |
