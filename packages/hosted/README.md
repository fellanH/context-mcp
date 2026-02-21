# @context-vault/hosted

Hosted context-vault server — Hono HTTP server serving MCP over Streamable HTTP transport with auth, billing, and multi-tenant vault storage.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Hono HTTP Server                               │
│                                                 │
│  GET  /health              Health check         │
│  POST /mcp                 MCP Streamable HTTP  │
│  POST /api/register        User registration    │
│  *    /api/keys/*          API key management   │
│  *    /api/billing/*       Stripe billing       │
│  POST /api/vault/import    Entry import         │
│  GET  /api/vault/export    Entry export (Pro)   │
│                                                 │
│  ┌───────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Auth      │  │ Billing  │  │ Core Vault  │  │
│  │ (API key) │  │ (Stripe) │  │ (shared)    │  │
│  └───────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────────┘
```

Uses `@context-vault/core` for all vault operations (same 6 MCP tools as local mode). Each HTTP request gets a fresh McpServer + transport but shares the same ctx (DB, embeddings, config).

## Environment Variables

| Variable                | Required | Default                                   | Description                                                             |
| ----------------------- | -------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                  | No       | `3000`                                    | HTTP server port                                                        |
| `AUTH_REQUIRED`         | No       | `false`                                   | Enable API key auth for MCP endpoint                                    |
| `PUBLIC_URL`            | No       | —                                         | Canonical app URL used for OAuth/login redirects (set to app subdomain) |
| `STRIPE_SECRET_KEY`     | No       | —                                         | Stripe API secret key (enables billing)                                 |
| `STRIPE_WEBHOOK_SECRET` | No       | —                                         | Stripe webhook signing secret                                           |
| `STRIPE_PRICE_PRO`      | No       | —                                         | Stripe Price ID for Pro tier                                            |
| `APP_HOSTS`             | No       | `app.context-vault.com`                   | Comma-separated hostnames that should serve product app frontend        |
| `MARKETING_HOSTS`       | No       | `www.context-vault.com,context-vault.com` | Comma-separated hostnames that should serve marketing frontend          |
| `DEFAULT_FRONTEND`      | No       | `marketing`                               | Frontend for unknown hosts (`marketing` or `app`)                       |
| `LOCALHOST_FRONTEND`    | No       | `app`                                     | Frontend for localhost dev host (`marketing` or `app`)                  |
| `CONTEXT_MCP_DATA_DIR`  | No       | `~/.context-mcp`                          | Data directory (databases)                                              |
| `CONTEXT_MCP_VAULT_DIR` | No       | `<data_dir>/vault`                        | Vault markdown file storage                                             |

## Local Development

```bash
# From monorepo root
npm install

# Start in dev mode (no auth, auto-reload)
npm run dev --workspace=packages/hosted

# Start with auth enabled
AUTH_REQUIRED=true npm run dev --workspace=packages/hosted
```

The server starts at `http://localhost:3000` with:

- Health check: `GET /health`
- MCP endpoint: `POST /mcp`
- Management API: `/api/*`

### Quick Test

```bash
# Health check
curl http://localhost:3000/health

# Register a user (returns API key)
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"email": "dev@test.com", "name": "Dev"}'

# Use the returned key for authenticated requests
export API_KEY="cv_..."

# Import an entry
curl -X POST http://localhost:3000/api/vault/import \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind": "insight", "body": "Test entry", "tags": ["test"]}'

# Check billing/usage
curl http://localhost:3000/api/billing/usage \
  -H "Authorization: Bearer $API_KEY"
```

## Deployment

**Preferred platform:** Fly.io (Docker-based) for the hosted MCP server.

### Hosting Architecture

Recommended production setup is a single Fly.io app:

| Surface              | Host / Route              | Served by                                       |
| -------------------- | ------------------------- | ----------------------------------------------- |
| Marketing site (SPA) | `www.context-vault.com/*` | Hono static serving (`packages/marketing/dist`) |
| Product app (SPA)    | `app.context-vault.com/*` | Hono static serving (`packages/app/dist`)       |
| Hosted REST API      | `/api/*`                  | Hono routes                                     |
| MCP endpoint         | `/mcp`                    | Streamable HTTP MCP transport                   |
| OpenAPI schema       | `/api/vault/openapi.json` | Public route                                    |
| Privacy policy       | `/privacy`                | Public route                                    |

This keeps marketing and product surfaces isolated while retaining one hosted runtime.

### Fly.io (recommended)

From the monorepo root:

```bash
# Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
fly launch --name context-vault --copy-config --no-deploy

# Set secrets (use live keys for production)
fly secrets set AUTH_REQUIRED=true
fly secrets set STRIPE_SECRET_KEY=sk_live_...
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...
fly secrets set STRIPE_PRICE_PRO=price_...

# Deploy
fly deploy
```

Create a `fly.toml` at monorepo root:

```toml
# fly.toml
app = "context-vault"

[build]
  dockerfile = "packages/hosted/Dockerfile"
  [build.context]
    path = "."

  [build.args]
    VITE_APP_BASE_URL = "https://app.context-vault.com"

[env]
  PORT = "3000"
  AUTH_REQUIRED = "true"
  PUBLIC_URL = "https://app.context-vault.com"
  APP_HOSTS = "app.context-vault.com"
  MARKETING_HOSTS = "www.context-vault.com,context-vault.com"
  CONTEXT_MCP_DATA_DIR = "/data"
  CONTEXT_MCP_VAULT_DIR = "/data/vault"

[[mounts]]
  source = "context_vault_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]
```

Create the volume before first deploy: `fly volumes create context_vault_data --size 1`

### Railway

```bash
# Set environment variables in Railway dashboard:
# PORT=3000
# AUTH_REQUIRED=true
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# STRIPE_PRICE_PRO=price_...

# Deploy from monorepo root
railway up
```

### Docker (standalone)

```bash
docker build \
  --build-arg VITE_APP_BASE_URL=https://app.context-vault.com \
  -f packages/hosted/Dockerfile \
  -t context-vault .
docker run -p 3000:3000 \
  -e AUTH_REQUIRED=true \
  -e PUBLIC_URL=https://app.context-vault.com \
  -e APP_HOSTS=app.context-vault.com \
  -e MARKETING_HOSTS=www.context-vault.com,context-vault.com \
  -e STRIPE_SECRET_KEY=sk_live_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  -e STRIPE_PRICE_PRO=price_... \
  -v context_vault_data:/data \
  -e CONTEXT_MCP_DATA_DIR=/data \
  -e CONTEXT_MCP_VAULT_DIR=/data/vault \
  context-vault
```

## Management API Reference

All management endpoints (except `/api/register`) require `Authorization: Bearer <api_key>`.

### Registration

**POST /api/register** — Create a new user account

```json
// Request
{ "email": "user@example.com", "name": "User Name" }
// Response 201
{ "userId": "...", "email": "...", "tier": "free", "apiKey": { "id": "...", "key": "cv_...", "prefix": "cv_abc1...ef23" } }
```

### API Keys

**GET /api/keys** — List all keys for the authenticated user

**POST /api/keys** — Create a new API key

```json
// Request
{ "name": "my-key" }
// Response 201
{ "id": "...", "key": "cv_...", "prefix": "...", "name": "my-key" }
```

**DELETE /api/keys/:id** — Delete an API key

### Billing

**GET /api/billing/usage** — Current tier, limits, and usage stats

**POST /api/billing/checkout** — Create a Stripe Checkout session for Pro upgrade

```json
// Request (optional)
{ "successUrl": "https://...", "cancelUrl": "https://..." }
// Response
{ "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }
```

**POST /api/billing/webhook** — Stripe webhook endpoint (configure in Stripe dashboard)

### Vault Import/Export

**POST /api/vault/import** — Import a single entry

```json
// Request
{ "kind": "insight", "body": "Entry content", "title": "Optional title", "tags": ["tag1"], "source": "migration" }
// Response
{ "id": "01HXY..." }
```

**GET /api/vault/export** — Export all entries (Pro tier only)

```json
// Response
{ "entries": [{ "id": "...", "kind": "...", "title": "...", "body": "...", "tags": [...], ... }] }
```

### Tier Limits

| Feature      | Free  | Pro       | Team      |
| ------------ | ----- | --------- | --------- |
| Entries      | 500   | Unlimited | Unlimited |
| Storage      | 10 MB | 1 GB      | 5 GB      |
| Requests/day | 200   | Unlimited | Unlimited |
| API Keys     | 1     | Unlimited | Unlimited |
| Export       | No    | Yes       | Yes       |

## License

BSL-1.1 — See [LICENSE](../../LICENSE) for details.
