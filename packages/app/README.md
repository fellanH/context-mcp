# Context Vault App

Web app for Context Vault. Built with React Router, React Query, Tailwind CSS, and shadcn/ui.

> **Note:** The app supports both **local** (no auth, SQLite vault) and **hosted** (API key auth) modes. Run `context-vault ui` for local mode.

## What It Includes

- API key authentication (`/login`, `/register`)
- Dashboard with usage, onboarding checklist, and recent activity
- Vault explorers for knowledge, entities, and events
- Search experience backed by `/api/vault/search`
- Entry creation, inspection, update, and deletion
- Settings for API keys, billing, data import/export, and account management

## Backend Contract

**Target:** The app should support both local (MCP + SQLite) and hosted (HTTP API) backends. Currently implemented for hosted only.

This app talks directly to the hosted server endpoints under `/api`:

- `GET /api/me`
- `POST /api/register`
- `GET/POST/DELETE /api/keys`
- `GET /api/billing/usage`
- `POST /api/billing/checkout`
- `GET/POST/PUT/DELETE /api/vault/entries`
- `POST /api/vault/search`
- `GET /api/vault/status`
- `POST /api/vault/import`
- `GET /api/vault/export`
- `DELETE /api/account`

Default API base is relative (`/api`) so the app can be served from the same origin as the hosted API.

## Routes

```
/ (RootLayout)
├── / (Dashboard)
├── /search
├── /vault/knowledge
├── /vault/entities
├── /vault/events
├── /settings/api-keys
├── /settings/billing
├── /settings/data
└── /settings/account

/login
/register
```

## Local Development

From repo root:

```bash
npm install
npm run dev --workspace=packages/hosted
npm run dev --workspace=packages/app
```

Vite proxy config forwards `/api` to `http://localhost:3000`.

## Build

```bash
npm run build --workspace=packages/app
```

The hosted Docker image copies `packages/app/dist` and serves it from the hosted Hono server.
