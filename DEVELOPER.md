# Developer Guide

Internal reference for contributors working on the context-vault monorepo.

## Documentation Philosophy

Three layers, no overlap:

| Layer | Tells you | Examples |
|-------|-----------|---------|
| **Code** | What & How | Types, naming, structure, logic |
| **Tests** | Expected behavior | Edge cases, contracts, invariants |
| **Docs** | Why & Where | Business decisions, external URLs, deployment, gotchas |

**Rule:** If an agent can answer the question by reading source files, the doc line is redundant. Pointers over prose.

---

## Code Pointers

These replace detailed sections — read the source for specifics:

| Topic | Start here |
|-------|-----------|
| Monorepo layout | `ls packages/` + each `package.json` |
| Core architecture | `packages/core/src/` — capture → index → retrieve layers |
| ctx object shape | `packages/core/src/server/types.js` |
| Categories & kinds | `packages/core/src/core/categories.js` |
| Config resolution | `packages/core/src/core/config.js` (header comment) |
| Embedding system | `packages/core/src/index/embed.js` |
| DB schema & migrations | `packages/core/src/index/db.js` |
| MCP tool handlers | `packages/core/src/server/tools.js` |
| Local server entry | `packages/local/src/server/index.js` |
| Hosted server entry | `packages/hosted/src/index.js` |
| Sync protocol | `packages/core/src/sync/sync.js` |
| Scripts | root `package.json` scripts section |
| Tests | `test/unit/`, `test/integration/`, `test/helpers/ctx.js` |

---

## Local vs Hosted

This is the most important architectural distinction.

| | Local (`packages/local`) | Hosted (`packages/hosted`) |
|---|---|---|
| Transport | stdio (MCP subprocess) | HTTP (Hono server) |
| Auth | None — local machine | Google OAuth + API keys |
| Encryption | None — plaintext | AES-256-GCM per-user |
| Billing | Free / open source | Stripe (Free: 50 entries, Pro: unlimited) |
| Multi-tenancy | Single user | Per-user DB isolation (LRU pool) |
| Data location | `~/vault/` + `~/.context-mcp/` | Fly.io volume `/data/` |
| Consumers | Claude Code, Cursor, Windsurf, Cline | Extension, web app, remote MCP clients |
| Published | npm (`context-vault`) | Fly.io (`context-vault` app) |

Both consume `@context-vault/core` and register the same 7 tools. The hosted server adds per-request `userCtx` with encryption and tier limits.

## Hosted Architecture

Two interfaces serve different consumers:

1. **REST API** (`/api/vault/*`) — used by the Chrome extension and web app
2. **MCP over Streamable HTTP** (`/mcp`) — for remote MCP clients

Frontend routing uses hostname inspection on the `Host` header — see `packages/hosted/src/index.js`.

---

## Hosted Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `AUTH_REQUIRED` | Yes | `"true"` in production |
| `VAULT_MASTER_SECRET` | Yes (prod) | Encryption master key (>=16 chars) |
| `STRIPE_SECRET_KEY` | Yes (prod) | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Yes (prod) | Stripe webhook verification |
| `STRIPE_PRICE_PRO` | Yes (prod) | Stripe price ID for Pro tier |
| `SENTRY_DSN` | No | Error tracking |
| `PUBLIC_URL` | Yes | Public server URL |
| `APP_HOSTS` | Yes | Hostname(s) for app frontend |
| `MARKETING_HOSTS` | Yes | Hostname(s) for marketing frontend |
| `CONTEXT_MCP_DATA_DIR` | Yes | Data directory inside container |
| `CONTEXT_MCP_VAULT_DIR` | Yes | Vault directory inside container |

---

## CI/CD Pipeline

### `ci.yml` — Hosted Deploy (push to main)

```
Push to main
    │
    ▼
  test-and-build ── Node 20, vitest, build all frontends
    │
    ▼
  deploy-staging ── fly deploy --config fly.staging.toml
    │
    ▼
  health-staging ── Poll /health (30 retries, 5s)
    │
    ▼
  smoke-staging ── scripts/smoke-test.sh
    │
    ▼
  deploy-production ── manual approval required
    │
    ▼
  smoke-production
```

### `publish.yml` — npm Publish (tag push)

```
Push tag v* → checkout → verify tag matches package.json → npm test → npm publish --provenance → GitHub Release
```

Required secret: `NPM_TOKEN` (granular automation token scoped to `context-vault`).

### `publish-extension.yml` — Chrome Web Store (tag push)

```
Push tag v* → verify tag matches manifest.json → extension:build → zip → publish via OAuth2
```

Required secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID`. See `packages/extension/store/SETUP.md`.

### Releasing

```bash
# 1. Add ## [x.y.z] section to CHANGELOG.md
# 2. Run the release script
npm run release -- patch    # or minor / major / 2.5.0
```

The script bumps versions in all package.json files + extension manifest, verifies CHANGELOG, commits, tags, and pushes. Tag push triggers npm + CWS publish workflows.

---

## Common Gotchas

1. **Zod + MCP SDK interop**: The MCP SDK uses `zod/v4-mini`. Use `z.any()` for free-form object params. Pass raw shape objects to `tool()`, not `z.object({...})`.

2. **DB is derived, files are truth**: `reindex()` rebuilds from vault files. Corrupt DB? Delete and reindex — zero data loss.

3. **Local bundles core**: npm package uses `bundledDependencies`. `prepack` script copies `@context-vault/core` before publish.

4. **First-run model download**: Embedding model (~22 MB) downloads on first use. If it fails, search degrades to FTS-only.

5. **Entity upsert vs append**: Most kinds are append-only. Entities upsert by `(user_id, kind, identity_key)`.

6. **Hosted encryption tradeoff**: Plaintext preview (first ~200 chars) stored for FTS. Titles also unencrypted. Full content requires DEK.

7. **Extension uses REST, not MCP**: Chrome extension calls `/api/vault/*` endpoints. No MCP transport.

8. **Frontend routing by hostname**: Hosted server inspects `Host` header to route to app vs marketing frontend. Both embedded as static builds.
