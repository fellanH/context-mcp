# User Journeys — Context Vault

Five core journeys that define how users discover, adopt, and grow with Context Vault.

---

## 1. Local-First Developer

The purist path. No account needed. Vault is markdown files on disk. Everything stays local.

**Flow:**

1. Discovers Context Vault (landing page, GitHub, blog, word of mouth)
2. `npm install -g context-vault`
3. `context-vault setup` — guided wizard: choose vault directory (default `~/vault/`), download 22MB embedding model, auto-detect and configure AI tools (Claude Code, Cursor, Codex, Windsurf, etc.), run health check
4. Setup seeds two starter entries — user can search immediately and see results
5. Uses AI tool normally — MCP tools are available automatically
6. Tells AI: "Save an insight: React hooks should..." → saved as plain markdown with YAML frontmatter in `~/vault/` (portable, git-friendly)
7. New session, days later. Asks: "What do I know about React hooks?" → hybrid search returns the entry. Memory persists across sessions.
8. Runs `context-vault ui` → local dashboard at `localhost:3141` for browsing, searching, and managing entries

**Entry points:** Landing page "See 2-minute setup", GitHub README, npm
**Auth:** None
**Value prop:** Persistent AI memory with zero cloud dependency
**Graduation:** → Journey 3 (cloud sync) or Journey 4 (Chrome extension)

---

## 2. Cloud-First User

Fastest to value. No local vault setup — everything hosted.

**Flow:**

1. Lands on `www.context-vault.com`
2. Clicks "Start free" → redirected to `/register`
3. Signs up via Google OAuth (or email fallback) → account created
4. Confirmation page shows API key and a ready-to-copy connect command
5. Pastes `npx context-vault connect --key cv_...` into terminal — the only CLI step
6. Connect command detects installed AI tools (Claude Code, Cursor, Codex, Windsurf, etc.) and configures them to use the hosted vault — no local database or embedding model needed
7. Tells AI: "Save a decision: we chose Postgres over MongoDB because..." → entry saved to cloud
8. Opens `app.context-vault.com` → sees the entry in the dashboard immediately. Onboarding checklist guides through remaining setup.
9. Opens a different machine → runs the same connect command → same vault, instant sync
10. Installs Chrome extension (optional) → searches vault and injects context into ChatGPT, Claude.ai, or Gemini web chats

**Entry points:** Landing page "Start free" CTA, direct link to `/register`
**Auth:** Google OAuth (primary), email registration (fallback)
**Value prop:** Works across devices, no local setup beyond one connect command
**Graduation:** → Journey 5 (Pro upgrade) or Journey 4 (Chrome extension power use)

---

## 3. Local → Cloud Migration

The upgrade path. User already has a working local vault and wants
multi-device access, cloud backup, or team features.

**Prerequisite:** Working local vault with entries (Journey 1)

**Flow:**

1. Registers on `app.context-vault.com` → gets API key
2. Uploads local entries to cloud (choose one):
   - **CLI:** `context-vault migrate --to-hosted --key cv_...`
     → reports "Uploaded 147 entries. Your local vault was not modified."
   - **Dashboard:** Logs in → dashboard shows "Upload your local vault?" prompt
     → clicks upload → entries synced to cloud
3. `context-vault connect --key cv_...` → switches AI tools from local to hosted vault
4. Daily workflow unchanged — AI tools work the same, but entries now live in the cloud
5. Opens a second machine → runs `connect` → same vault, same entries
6. Optionally runs `context-vault link --key cv_...` to enable ongoing
   `sync` between local and cloud (incremental, additive-only)

**What happens to local files:** Preserved untouched in `~/vault/`.
Still browsable via `context-vault ui`. Acts as a read-only archive and safe backup.

**Entry points:** Dashboard upload prompt, CLI `migrate` command, onboarding checklist
**Auth:** Requires hosted account + API key
**Value prop:** Keep everything from local, gain cloud benefits (multi-device, backup, dashboard)
**Graduation:** → Journey 4 (Chrome extension) or Journey 5 (Pro upgrade)

---

## 4. Chrome Extension User

Bidirectional context bridge — search your vault from any AI chat,
and capture chat messages back into the vault.

**Prerequisite:** Local vault with `context-vault ui` running (Journey 1)
or hosted account with API key (Journey 2)

**Flow:**

1. Installs Context Vault extension from Chrome Web Store
2. First-run onboarding wizard: choose Local or Hosted mode → enter credentials (vault path or API key) → connection verified
3. Opens ChatGPT / Claude.ai / Gemini → extension icon shows green dot (active)
4. Presses Cmd+Shift+Space (or Ctrl+Shift+Space) to open popup
5. Types a search query → results appear with relevance scores and previews
6. Clicks "Inject into chat" on a result → text inserted into the chat input, popup auto-closes
7. Switches to the Capture tab → extension extracts all messages from the active chat → selects which to save → entries created in vault
8. On any webpage: selects text → right-click → "Save to Context Vault" as Insight, Note, Reference, or Code Snippet

**Entry points:** Chrome Web Store, dashboard link, documentation
**Auth:** API key (hosted mode) or none (local mode with `context-vault ui`)
**Value prop:** Use your vault in any AI chat, not just MCP-connected tools. Capture knowledge from chats and web pages back into the vault.
**Graduation:** → Journey 5 (Pro upgrade) if approaching rate limits

---

## 5. Pro Upgrade

Revenue conversion triggered by usage limits on the free cloud tier.

**Prerequisite:** Active free cloud account (Journey 2)

**Flow:**

1. Free user accumulates entries and requests over time
2. Dashboard usage meters turn amber at 80%, red at 100% of limits (500 entries, 10 MB storage, 200 requests/day)
3. Hits a wall: API returns 429 "Daily request limit reached. Upgrade to Pro for unlimited usage." — or tries to export and gets 403 "Upgrade to Pro."
4. Navigates to `/settings/billing` → sees plan comparison with current usage
5. Clicks "Upgrade to Pro" → Stripe checkout → completes payment
6. Returns to billing page → toast: "Welcome to your new plan!" → usage meters refresh to show unlimited limits, export unlocked
7. Cancellation available anytime — reverts to free tier limits, existing entries preserved

**Conversion triggers:**
- Dashboard usage meters approaching limits (amber/red)
- API 429 responses with upgrade prompt
- Export 403 with upgrade prompt
- Extension rate limit headers (approaching 0 remaining)

**Entry points:** Dashboard usage meters, billing settings, API error messages
**Auth:** Already authenticated
**Value prop:** Remove all limits, unlock export

---

## Tier Summary

| | Free | Pro ($9/mo) | Team (contact sales) |
|---|---|---|---|
| Entries | 500 | Unlimited | Unlimited |
| Storage | 10 MB | 1 GB | 5 GB |
| Requests/day | 200 | Unlimited | Unlimited |
| API Keys | 1 | Unlimited | Unlimited |
| Export | No | Yes | Yes |
| Support | Community | Priority | Dedicated |

---

## Product Surfaces

| Surface | Purpose | Auth |
|---|---|---|
| Landing page (`www.context-vault.com`) | Discovery, education, CTAs | None |
| Dashboard (`app.context-vault.com`) | Onboarding, browse, search, settings | Google OAuth / API key |
| CLI (`context-vault`) | Setup, serve, migrate, sync, manage | None (local) or API key (hosted) |
| Chrome Extension | Search + inject + capture context in AI chats | API key (hosted) or none (local) |
| MCP Endpoint (`/mcp`) | AI tool integration (save/search/list) | Optional Bearer token |
| REST API (`/api/vault/*`) | Programmatic CRUD + search | Bearer token |

---

## Journey Connections

```
                    ┌──────────────┐
                    │ Landing Page │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
     ┌────────────────┐       ┌─────────────────┐
     │ 1. Local-First │       │ 2. Cloud-First  │
     │   Developer    │       │     User        │
     └───────┬────────┘       └────────┬────────┘
             │                         │
             ├─── Journey 3 ◄──────────┤
             │    (Migration)          │
             │                         │
             ├─── Journey 4 ◄──────────┤
             │    (Extension)          │
             │                         │
             └─────────────────────────┼──► Journey 5
                                       │    (Pro Upgrade)
                                       │
                                       └──► Team (contact sales)
```
