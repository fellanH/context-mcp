# Developer Guide

Internal reference for contributors working on the context-vault monorepo.

For user-facing docs, see [README.md](./README.md).

---

## Monorepo Structure

```
context-vault-monorepo/
├── packages/core       ← Shared library (capture, index, retrieve, tools)
├── packages/local      ← Local MCP server (published to npm as `context-vault`)
├── packages/hosted     ← Cloud server (Hono HTTP, deployed to Fly.io)
├── packages/app        ← React dashboard SPA
├── packages/marketing  ← Landing page / marketing site
└── packages/extension  ← Chrome extension (Manifest v3)
```

### Dependency Graph

```
              ┌─────────────┐
              │  @cv/core   │  Shared: capture, index, retrieve, tools
              └──────┬──────┘
           ┌─────────┼─────────┐
           ▼         ▼         ▼
      ┌────────┐ ┌────────┐ ┌───────────┐
      │ local  │ │ hosted │ │ extension │
      │ (npm)  │ │(Fly.io)│ │ (Chrome)  │
      └────────┘ └───┬────┘ └─────┬─────┘
                     │             │
              ┌──────┴──────┐     │
              │  app + mkt  │     │
              │  (embedded) │     │
              └─────────────┘     │
                     ▲            │
                     └────────────┘
                   (REST API calls)
```

- **core** is consumed by both `local` and `hosted`.
- **app** and **marketing** are built as static assets and served by the hosted server.
- **extension** talks to the hosted server via REST — it does **not** use MCP protocol.

---

## Package Details

### `packages/core` — `@context-vault/core`

The shared library containing all business logic. Both `local` and `hosted` are thin wrappers around it.

**Three-layer architecture:**

```
            WRITE PATH                    READ PATH
         ┌────────────┐              ┌──────────────┐
INPUT ──▶│  Capture   │──▶ .md file  │   Retrieve   │──▶ RESULTS
         │            │              │              │
         │ writeEntry │              │ hybridSearch │
         │ formatters │              │  FTS + Vec   │
         └─────┬──────┘              └──────────────┘
               │                            ▲
               ▼                            │
         ┌─────────────┐                    │
         │    Index     │───────────────────┘
         │  (derived)   │
         │ indexEntry   │
         │ reindex      │
         │ embed + SQL  │
         └──────────────┘
```

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| Capture | `src/capture/` | Write `.md` files to vault dir. No SQL. |
| Index | `src/index/` | SQLite + FTS5 + vector embeddings. Derived from files. |
| Retrieve | `src/retrieve/` | Read-only hybrid search (FTS + semantic). |
| Tools | `src/server/tools.js` | 6 MCP tool handlers that coordinate the layers. |
| Shared | `src/core/` | Config resolution, categories, frontmatter, file utilities. |

**Key rule**: Vault `.md` files are the **source of truth**. The SQLite database is a derived index that can be fully rebuilt via `reindex()`. Never write directly to the DB and expect it to persist independently.

**Exports** (via `package.json` exports map):
```js
import { writeEntry, captureAndIndex } from '@context-vault/core/capture'
import { initDb, prepareStatements }   from '@context-vault/core/index/db'
import { createEmbedder }             from '@context-vault/core/index/embed'
import { hybridSearch }               from '@context-vault/core/retrieve'
import { registerTools }              from '@context-vault/core/server/tools'
import { resolveConfig }              from '@context-vault/core/core/config'
```

### `packages/local` — `context-vault` (npm)

The package users install. Runs as a **stdio MCP server** — Claude Code, Cursor, etc. spawn it as a subprocess.

- Single entry point: `src/server/index.js` (~194 lines)
- Published to npm with `bundledDependencies` (ships `@context-vault/core` inside it)
- `scripts/prepack.js` handles the bundling before publish
- `scripts/postinstall.js` runs setup on install
- No auth, no encryption, no billing — everything runs locally
- Boot sequence: Config → Dirs → DB → MCP Server → Connect stdio

### `packages/hosted` — `@context-vault/hosted`

Cloud deployment on Fly.io. Wraps core with HTTP transport, auth, encryption, and billing.

| Concern | Files | Notes |
|---------|-------|-------|
| HTTP server | `src/index.js` | Hono app, MCP server factory, middleware chain |
| Auth | `src/auth/` | Google OAuth + API key validation |
| Encryption | `src/encryption/` | AES-256-GCM per-user, key derivation via PBKDF2 |
| Billing | `src/billing/stripe.js` | Stripe checkout, webhooks, tier enforcement |
| REST API | `src/routes/vault-api.js` | 7 endpoints under `/api/vault/` |
| Middleware | `src/middleware/` | Auth, rate limiting, logging |
| Backups | `src/backup/r2-backup.js` | Cloudflare R2 automated backups |
| Context | `src/server/ctx.js`, `user-ctx.js` | Shared + per-user context builders |

**Two interfaces:**
1. REST API (`/api/vault/*`) — used by extension and web app
2. MCP over SSE — for remote MCP clients

**Frontend routing**: The hosted server serves both `app` and `marketing` as static builds, routing by hostname:
- `app.context-vault.com` → app SPA
- `www.context-vault.com` / `context-vault.com` → marketing site

### `packages/app` — `@context-vault/app`

React SPA dashboard for managing vault entries via the hosted API.

- React 19, TypeScript, Tailwind CSS 4, Radix UI, React Router 7, TanStack Query
- Auth via Google OAuth (see `src/components/AuthProvider.tsx`)
- Pages: Dashboard, Search, Knowledge/Entities/Events browsers, Settings (API keys, billing, data, account)
- Built by Vite, output served by the hosted server

### `packages/marketing` — `@context-vault/marketing`

Static landing page. Same UI stack as app (Radix, Tailwind). Built by Vite, served by hosted server.

### `packages/extension` — `@context-vault/extension`

Chrome extension (Manifest v3) for capturing and injecting vault context into AI chat interfaces.

| Component | File(s) | Role |
|-----------|---------|------|
| Service worker | `src/background/index.ts` | Context menus, message routing, connection badge |
| API client | `src/background/api-client.ts` | REST calls to hosted server |
| Content scripts | `src/content/` | Platform detection, text injection, toast notifications |
| Platform adapters | `src/content/platforms/` | ChatGPT, Gemini, Claude, generic selectors |
| Popup | `src/popup/` | React UI (search, results, settings) |
| Onboarding | `src/onboarding/` | First-run setup flow |

**Supported platforms**: `chatgpt.com`, `chat.openai.com`, `gemini.google.com`, `claude.ai`

**Important**: The extension talks REST to the hosted server. It does not use MCP transport.

---

## Local vs Hosted — Key Differences

This is the most important distinction in the codebase.

| | Local (`packages/local`) | Hosted (`packages/hosted`) |
|---|---|---|
| Transport | stdio (MCP subprocess) | HTTP (Hono server) |
| Auth | None — local machine | Google OAuth + API keys |
| Encryption | None — plaintext | AES-256-GCM per-user |
| Billing | Free / open source | Stripe (Free: 50 entries, Pro: unlimited) |
| Multi-tenancy | Single user | `user_id` column isolates data |
| Data location | `~/vault/` + `~/.context-mcp/` | Fly.io volume `/data/` |
| Consumers | Claude Code, Cursor, Windsurf, Cline | Extension, web app, remote MCP clients |
| Published | npm (`context-vault`) | Fly.io (`context-vault` app) |

Both consume `@context-vault/core` and register the same 6 tools. The hosted server adds a per-request `userCtx` wrapper with encryption and tier limits.

---

## The `ctx` Object

Every layer receives a `ctx` object as its first argument. Understanding its shape is critical.

**Local ctx** (created in `packages/local/src/server/index.js`):
```js
{
  db,                    // better-sqlite3 instance
  config,                // Resolved paths (vaultDir, dataDir, dbPath, ...)
  stmts,                 // 12 prepared SQL statements
  embed,                 // (text) => Float32Array[384]
  insertVec,             // (rowid, embedding) => void
  deleteVec,             // (rowid) => void
  activeOps: { count }   // Graceful shutdown counter
}
```

**Hosted ctx** (extended per-request in `packages/hosted/src/server/user-ctx.js`):
```js
{
  ...ctx,                // Same base from ctx.js
  userId,                // Authenticated user ID
  encrypt,               // (entry) => encrypted entry
  decrypt,               // (row) => decrypted entry
  checkLimits,           // () => { entryCount, maxEntries, ... }
}
```

---

## Entry System

### Categories and Kinds

Every entry has a `kind` that maps to a `category`, which determines its storage behavior:

| Category | Kinds | Behavior |
|----------|-------|----------|
| **knowledge** | insight, decision, pattern, note, document, reference, prompt | Append-only, no decay |
| **entity** | contact, project, tool, source | **Upsert** by `identity_key`, no decay |
| **event** | conversation, message, session, task, log, feedback | Append-only, **decays** (30-day default) |

Key behavior differences:
- **Knowledge**: Each save creates a new file with a new ULID.
- **Entity**: Saves with the same `(kind, identity_key)` overwrite the existing file. This is how you update a contact or project.
- **Event**: Each save creates a new file, but entries expire after `eventDecayDays` (default 30). `reindex()` prunes expired entries.

### File Format

Entries are stored as markdown files with YAML frontmatter:
```
~/vault/
  knowledge/
    insights/
      01ABC123-my-insight-title.md
    decisions/
      01DEF456-use-sqlite.md
  entity/
    contacts/
      01GHI789-john-doe.md
  event/
    conversations/
      01JKL012-debugging-session.md
```

### Database Schema (v6)

```sql
CREATE TABLE vault (
  id, kind, category, title, body, meta, tags, source, file_path,
  identity_key, expires_at, created_at, user_id,
  body_encrypted, title_encrypted, meta_encrypted, iv
);

CREATE VIRTUAL TABLE vault_fts USING fts5(title, body, tags, kind);
CREATE VIRTUAL TABLE vault_vec USING vec0(embedding float[384]);
```

- `vault_fts` auto-syncs via triggers on INSERT/UPDATE/DELETE.
- `vault_vec` stores 384-dim embeddings (all-MiniLM-L6-v2).
- `*_encrypted` and `iv` columns are only populated in hosted mode. In local mode they're NULL.
- Schema migrations auto-run on DB init. v4→v6 creates a backup before migrating.

---

## Config Resolution

4-step chain, lowest to highest priority:

```
Defaults  →  Config File  →  Env Vars  →  CLI Args
```

| Setting | Default | Env Var | CLI Flag |
|---------|---------|---------|----------|
| Vault dir | `~/vault` | `CONTEXT_MCP_VAULT_DIR` | `--vault-dir` |
| Data dir | `~/.context-mcp` | `CONTEXT_MCP_DATA_DIR` | `--data-dir` |
| DB path | `~/.context-mcp/vault.db` | `CONTEXT_MCP_DB_PATH` | `--db-path` |
| Dev dir | `~/dev` | `CONTEXT_MCP_DEV_DIR` | `--dev-dir` |
| Event decay | 30 days | `CONTEXT_MCP_EVENT_DECAY_DAYS` | `--event-decay-days` |

Config file location: `~/.context-mcp/config.json`

---

## Embedding System

- **Model**: `Xenova/all-MiniLM-L6-v2` (384 dimensions, ~22 MB download)
- **Downloaded to**: `~/.context-mcp/models/`
- **Graceful degradation**: If `@huggingface/transformers` fails to load, semantic search is disabled but FTS still works. Check `context_status` for embedding health.
- **Batch embedding**: `reindex()` processes entries in batches of 32.

---

## Hosted Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `AUTH_REQUIRED` | Yes | `"true"` in production, `"false"` for local dev |
| `VAULT_MASTER_SECRET` | Yes (prod) | Encryption master key (>=16 chars) |
| `STRIPE_SECRET_KEY` | Yes (prod) | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Yes (prod) | Stripe webhook verification |
| `STRIPE_PRICE_PRO` | Yes (prod) | Stripe price ID for Pro tier |
| `SENTRY_DSN` | No | Error tracking |
| `PUBLIC_URL` | Yes | Public server URL |
| `APP_HOSTS` | Yes | Hostname(s) that serve the app frontend |
| `MARKETING_HOSTS` | Yes | Hostname(s) that serve the marketing frontend |
| `CONTEXT_MCP_DATA_DIR` | Yes | Data directory inside container |
| `CONTEXT_MCP_VAULT_DIR` | Yes | Vault directory inside container |

---

## CI/CD Pipeline

```
Push to main
    │
    ▼
  test-and-build
    Node 20, npm ci, vitest, build app + marketing + extension
    │
    ▼
  deploy-staging
    fly deploy --config fly.staging.toml
    │
    ▼
  health-staging
    Poll /health (30 retries, 5s interval)
    │
    ▼
  smoke-staging
    scripts/smoke-test.sh against staging URL
    │
    ▼
  deploy-production  (manual approval required)
    fly deploy
    │
    ▼
  smoke-production
    scripts/smoke-test.sh against production URL
```

The Dockerfile (`packages/hosted/Dockerfile`) is a two-stage build:
1. **Builder**: Node 20-slim, install deps, build app + marketing
2. **Production**: Slim image, `tini` init, non-root `vault` user, `curl` health check

---

## Scripts

```bash
# Root
npm test                          # Vitest (unit + integration)
npm run cli                       # Run local MCP server
npm run ui                        # Build app then launch local UI
npm run deploy                    # Fly.io production deploy
npm run docker:build              # Build Docker image
npm run docker:run                # Run Docker container locally

# Per-workspace
npm run dev -w packages/app       # App dev server
npm run dev -w packages/marketing # Marketing dev server
npm run dev -w packages/extension # Extension watch build
npm run build -w packages/extension  # Extension production build
npm run dev -w packages/hosted    # Hosted server with --watch
```

---

## Testing

```bash
npm test          # Run all tests
npm run test:watch  # Watch mode
```

Test files live in `/test/`:
- `test/unit/` — Frontmatter, files, categories, encryption, billing, formatting
- `test/integration/` — Round-trip save/search, list, feedback, hosted auth
- `test/helpers/ctx.js` — Shared test context builder

---

## Common Gotchas

1. **Zod + MCP SDK interop**: The MCP SDK uses `zod/v4-mini` internally. `z.record(z.unknown())` from full `zod` breaks when the SDK converts to JSON schema. Use `z.any()` for free-form object params. Pass raw shape objects `{ key: z.string() }` to `tool()`, not `z.object({...})`.

2. **DB is derived, files are truth**: Never treat the database as canonical. `reindex()` rebuilds it entirely from vault files. If the DB gets corrupted, delete it and reindex — zero data loss.

3. **Local bundles core**: The npm package uses `bundledDependencies` to ship `@context-vault/core` inside it. The `prepack` script copies it before `npm publish`.

4. **First-run model download**: The embedding model (~22 MB) downloads on first use to `~/.context-mcp/models/`. If it fails, search silently degrades to FTS-only (no vectors).

5. **Entity upsert vs append**: Most kinds are append-only. Entities upsert by `(user_id, kind, identity_key)` — the existing file gets overwritten, not duplicated.

6. **Hosted encryption tradeoff**: In hosted mode, `body`/`title`/`meta` are encrypted in the DB. A plaintext preview (first ~200 chars of body) is stored for FTS. Full content requires decryption via the user's derived key.

7. **Extension uses REST, not MCP**: The Chrome extension calls `/api/vault/*` endpoints on the hosted server. It has no MCP transport layer.

8. **Frontend routing by hostname**: The hosted server inspects the `Host` header to decide whether to serve the app or marketing frontend. Both are embedded as static builds.
