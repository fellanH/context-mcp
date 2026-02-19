# Demo Script: CLI Local Setup

**Duration:** 2-3 minutes
**Format:** Terminal walkthrough (screencast-ready)
**Goal:** Show a developer going from zero to first memory cycle with Context Vault locally.

---

## Prerequisites

- Node.js 20+
- Terminal (macOS/Linux/WSL)
- No account required for local usage

---

## Script

### Step 1: Install Context Vault CLI

```bash
npm install -g context-vault
```

**Expected output:**
```
added 1 package in 3s
```

**Say:** "One global install. No config files, no Docker, no cloud account."

---

### Step 2: Run Setup

```bash
context-vault setup
```

**Expected output:**
```
Creating vault directory at ~/.context-vault/
Downloading embedding model (first run only)...
Initializing database...
Setup complete. Vault ready at ~/.context-vault/
```

**Say:** "Setup handles everything — vault folder, embedding model download, database init. Takes about 30 seconds on first run."

---

### Step 3: Verify Health

```bash
context-vault status
```

**Expected output:**
```
Vault path:    ~/.context-vault
Entries:       1 (seed entry)
Database:      healthy
Embeddings:    loaded
Schema:        v5
```

**Say:** "Status confirms everything is working. The seed entry is a welcome note that also validates search."

---

### Step 4: Save Your First Entry

Use the MCP tool `save_context` (or demonstrate via CLI):

```json
{
  "kind": "insight",
  "title": "SQLite is fast enough for local search",
  "body": "Tested with 1,000 entries — hybrid search returns results in under 50ms. No need for external search infrastructure at this scale.",
  "tags": ["performance", "sqlite", "architecture"]
}
```

**Expected output:**
```
Saved: insight/sqlite-is-fast-enough-for-local-search.md
Indexed: 1 new entry
```

**Say:** "One tool call saves the insight, writes a markdown file, and indexes it for both full-text and semantic search."

---

### Step 5: Retrieve It

Use the MCP tool `get_context`:

```json
{
  "query": "sqlite performance local search"
}
```

**Expected output:**
```
1. SQLite is fast enough for local search (score: 0.92)
   Kind: insight | Tags: performance, sqlite, architecture
   "Tested with 1,000 entries — hybrid search returns results in under 50ms..."
```

**Say:** "Hybrid search combines keyword matching with semantic similarity. The query doesn't need to match exact words — it understands intent."

---

### Step 6: Show the File on Disk

```bash
cat ~/.context-vault/insight/sqlite-is-fast-enough-for-local-search.md
```

**Expected output:**
```markdown
---
title: SQLite is fast enough for local search
kind: insight
category: knowledge
tags:
  - performance
  - sqlite
  - architecture
created_at: 2026-02-19T10:00:00.000Z
---

Tested with 1,000 entries — hybrid search returns results in under 50ms. No need for external search infrastructure at this scale.
```

**Say:** "This is just a markdown file with YAML frontmatter. You can read it, edit it, version control it, or move it anywhere. No lock-in."

---

## Key Moments to Emphasize

1. **Setup speed** — From install to working vault in under 2 minutes
2. **File-on-disk proof** — Show the actual markdown file to demonstrate portability and transparency
3. **Search quality** — The semantic search finds the entry even with different wording than the original

---

## Closing

"That's a full memory cycle — install, save, retrieve, and verify the file on disk. All local, all yours. Start free at contextvault.dev."
