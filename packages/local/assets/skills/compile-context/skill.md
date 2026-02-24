---
name: compile-context
description: >
  Compiles scattered vault entries on a topic into a single authoritative brief
  for isolated retrieval in a fresh context window. Use when starting a new work
  session on a project, preparing a handoff, or loading focused context without
  noise. Also audits for stale or contradicting entries.
  Triggers: "compile context", "create a brief", "context snapshot", "context bucket",
  "make a brief for X", "load context for X".
---

# compile-context skill

When the user asks to compile context or create a brief for a topic, call `create_snapshot` to synthesize a context brief from the vault.

## Step 1 — Identify the topic

If the user provided a topic or project name, use it. If not, ask:

> "What topic or project should I compile context for?"

Derive a slug: lowercase, hyphens, no spaces (e.g. `neonode`, `context-vault`, `klarhimmel-infra`).

## Step 2 — Call create_snapshot

Call `create_snapshot` with:

- `topic`: the topic name the user provided
- `identity_key`: `snapshot-<slug>` (e.g. `snapshot-context-vault`)
- `tags` (optional): any relevant tags the user mentions
- `kinds` (optional): restrict to specific entry kinds if the user requests it

The tool handles retrieval, deduplication, LLM synthesis, and saving automatically.

## Step 3 — Report

After the tool returns, tell the user:

- The ULID of the saved brief
- How many entries were synthesized
- The exact call to retrieve it in a future session:
  ```
  get_context(identity_key: "snapshot-<slug>")
  ```
- Suggest pinning the identity key in the relevant CLAUDE.md or MEMORY.md for zero-cost retrieval in fresh windows.
