# @context-vault/sdk

Context lifecycle SDK for AI agents. Save, search, and manage persistent context with freshness scoring.

## Install

```bash
# Hosted mode (zero native deps)
npm install @context-vault/sdk

# Embedded mode (local SQLite)
npm install @context-vault/sdk @context-vault/core
```

## Quick start

```typescript
import { ContextVault } from '@context-vault/sdk';

// Hosted
const vault = ContextVault.hosted({ apiKey: 'cv_...' });

// Or embedded
const vault = ContextVault.local();

// Save
const { id } = await vault.save({
  kind: 'insight',
  title: 'Express 5 body parser change',
  body: 'Raw body parser must be configured before...',
  tags: ['express', 'bucket:myproject'],
});

// Search
const results = await vault.search('express middleware', { limit: 5 });

// Vault health
const health = await vault.health();
console.log(health.distribution); // { fresh: 120, aging: 80, stale: 30, dormant: 10 }

// Delete
await vault.delete(id);
```

## Modes

**Hosted mode** connects to api.context-vault.com via HTTP. Zero native dependencies. Requires an API key.

**Embedded mode** uses a local SQLite vault via `@context-vault/core`. Requires `@context-vault/core` as a peer dependency. Data stays on your machine.

## API

### `ContextVault.hosted(opts)`

Create an instance using the hosted API.

- `apiKey` (required): Your Context Vault API key
- `baseUrl` (optional): Override the API base URL

### `ContextVault.local(opts?)`

Create an instance using the local SQLite vault.

- `dir` (optional): Data directory path (defaults to `~/.context-mcp`)

### `vault.save(options)`

Save an entry to the vault. Returns the entry ID and freshness score.

### `vault.search(query, options?)`

Search the vault. Returns matching entries with scores and freshness.

### `vault.health()`

Get vault health metrics: freshness distribution, averages, entries needing attention.

### `vault.delete(id)`

Delete an entry by ID.
