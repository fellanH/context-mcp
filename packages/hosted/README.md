# @context-vault/hosted

Hosted context-vault server — Hono HTTP server with MCP over Streamable HTTP, auth, billing, and multi-tenant vault storage.

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
└─────────────────────────────────────────────────┘
```

Uses `@context-vault/core` for all vault operations. Each request gets a fresh McpServer + transport sharing a per-user ctx (DB, embeddings, config).

## Environment Variables

| Variable                | Required | Default                                   | Description                           |
| ----------------------- | -------- | ----------------------------------------- | ------------------------------------- |
| `PORT`                  | No       | `3000`                                    | HTTP server port                      |
| `AUTH_REQUIRED`         | No       | `false`                                   | Enable API key auth for MCP endpoint  |
| `PUBLIC_URL`            | No       | —                                         | Canonical app URL for OAuth redirects |
| `STRIPE_SECRET_KEY`     | No       | —                                         | Stripe API secret key                 |
| `STRIPE_WEBHOOK_SECRET` | No       | —                                         | Stripe webhook signing secret         |
| `STRIPE_PRICE_PRO`      | No       | —                                         | Stripe Price ID for Pro tier          |
| `APP_HOSTS`             | No       | `app.context-vault.com`                   | Hostnames serving the product app     |
| `MARKETING_HOSTS`       | No       | `www.context-vault.com,context-vault.com` | Hostnames serving marketing           |
| `CONTEXT_MCP_DATA_DIR`  | No       | `~/.context-mcp`                          | Data directory                        |
| `CONTEXT_MCP_VAULT_DIR` | No       | `<data_dir>/vault`                        | Vault markdown storage                |

## Local Development

```bash
npm install
npm run dev --workspace=packages/hosted
```

Server starts at `http://localhost:3000`. Health: `GET /health`, MCP: `POST /mcp`, Management: `/api/*`.

## Deployment

Deployed to Fly.io via CI on push to main. Config lives in `fly.toml` at monorepo root.

## License

BSL-1.1 — See [LICENSE](../../LICENSE) for details.
