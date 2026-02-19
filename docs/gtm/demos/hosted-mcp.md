# Demo Script: Hosted MCP Endpoint Setup

**Duration:** 2-3 minutes
**Format:** Terminal + browser walkthrough (screencast-ready)
**Goal:** Show a developer going from zero to first memory cycle using the hosted MCP endpoint — no Node.js required.

---

## Prerequisites

- A contextvault.dev account (free tier)
- An MCP-compatible client (Claude Code, Cursor, Windsurf, etc.)
- No Node.js or local installation required

---

## Script

### Step 1: Register and Copy API Key

Navigate to contextvault.dev and create a free account.

**Say:** "No local install needed. Just sign up, grab your API key, and you're ready."

---

### Step 2: Add Hosted MCP Endpoint to Your Client

Paste the hosted MCP endpoint and API key into your client's MCP settings:

```json
{
  "mcpServers": {
    "context-vault": {
      "url": "https://mcp.contextvault.dev",
      "headers": {
        "Authorization": "Bearer cv_your_api_key_here"
      }
    }
  }
}
```

**Say:** "Same MCP tool interface whether you're running local or hosted. Paste the config, add your API key, done."

---

### Step 3: Verify Connection

Use the MCP tool `context_status`:

```json
{}
```

**Expected output:**
```
Vault status:  connected
Entries:       1 (seed entry)
Database:      healthy
Embeddings:    loaded
Plan:          free
```

**Say:** "Status confirms the hosted vault is live and ready. The seed entry validates that search is working."

---

### Step 4: Save Your First Entry

Use the MCP tool `save_context`:

```json
{
  "kind": "decision",
  "title": "Use hosted MCP for team-shared context",
  "body": "Chose hosted over local so all team members share the same vault without syncing files. API key per user, single source of truth.",
  "tags": ["architecture", "team", "hosting"]
}
```

**Expected output:**
```
Saved: decision/use-hosted-mcp-for-team-shared-context.md
Indexed: 1 new entry
```

**Say:** "One tool call. The entry is saved, indexed for full-text and semantic search, and available immediately."

---

### Step 5: Retrieve It

Use the MCP tool `get_context`:

```json
{
  "query": "why hosted instead of local vault"
}
```

**Expected output:**
```
1. Use hosted MCP for team-shared context (score: 0.91)
   Kind: decision | Tags: architecture, team, hosting
   "Chose hosted over local so all team members share the same vault..."
```

**Say:** "Hybrid search finds it even though the query uses completely different words than the original entry. Semantic similarity plus keyword matching."

---

### Step 6: Show Portability

Use the MCP tool `get_context` with a direct lookup, then highlight the markdown format:

```markdown
---
title: Use hosted MCP for team-shared context
kind: decision
category: knowledge
tags:
  - architecture
  - team
  - hosting
created_at: 2026-02-20T10:00:00.000Z
---

Chose hosted over local so all team members share the same vault without syncing files. API key per user, single source of truth.
```

**Say:** "Even on hosted, every entry is standard markdown with YAML frontmatter. You can export your entire vault anytime and run it locally. No lock-in."

---

## Key Moments to Emphasize

1. **Zero install** — No Node.js, no CLI, no local setup. Paste config and go.
2. **Same MCP interface** — Identical tool calls whether local or hosted. Switch anytime.
3. **Portability proof** — Show the markdown format to demonstrate that hosted doesn't mean locked in.

---

## Closing

"That's a full hosted memory cycle — register, connect, save, retrieve, and verify portability. Zero install, same tools, no lock-in. Start free at contextvault.dev."
