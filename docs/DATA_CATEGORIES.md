# Data Categories

Three fundamental categories derived from two irreducible behavioral axes:

1. **Mutability** — is the data written once (append) or updated in place (upsert)?
2. **Temporal relevance** — does value endure or decay over time?

|              | Append-only | Upsert  |
| ------------ | ----------- | ------- |
| **Enduring** | Knowledge   | Entity  |
| **Decaying** | Event       | Entity¹ |

¹ Decaying + upsert is just an Entity with a TTL, not a distinct category.

The `category` determines system behavior — write path, retrieval strategy, lifecycle. The `kind` is a subtype label within a category, useful for filtering and display but not for routing logic.

---

## Knowledge — what you know

Distilled understanding captured during work. Written once, valuable indefinitely.

- **Write path**: `INSERT` — append-only, never mutated
- **Identity**: ULID (no external key needed)
- **Retrieval**: Semantic search, tag filtering
- **Lifecycle**: No decay, no archival

### Kinds

**`insight`** — Discoveries, gotchas, and learnings.
General-purpose knowledge captured during sessions or curated manually.

**`decision`** — Architectural or strategic decisions with rationale.
The "why" behind choices. Valuable when revisiting or onboarding.

**`pattern`** — Reusable code templates and conventions.
Tagged by language and domain. Retrieved by tag match + semantic relevance.

**`prompt`** — Effective prompts worth reusing across sessions.
Agent-captured or manually curated.

**`note`** — Freeform text tied to a project or topic.
Scoped by project tags. The default kind when nothing more specific applies.

**`document`** — Long-form documentation, specs, or reference material.
May require chunking at index time due to length. Structurally identical to other knowledge — chunking is an indexing concern, not a category concern.

**`reference`** — External material imported for context.
Web pages, API docs, third-party specs. Same behavior as `document`.

---

## Entity — what exists

Things in the world that have identity and mutable state. Updated in place when state changes.

- **Write path**: `INSERT OR REPLACE` on identity key
- **Identity**: Explicit key per kind (email for contacts, repo+path for source, etc.)
- **Retrieval**: Exact match on identity key, semantic search as fallback
- **Lifecycle**: Updated in place; optional TTL for temporary entities

### Kinds

**`contact`** — People: clients, collaborators, vendors.
Identity key: `email` or `name`. Upsert on match — update existing, never duplicate.

**`project`** — Projects and engagements with current status.
Identity key: `slug` or `name`. Tracks active state, team, and scope.

**`tool`** — Tools, services, and integrations in active use.
Identity key: `name`. Configuration, access notes, and usage context.

**`source`** — Key files from codebases: interfaces, configs, important modules.
Identity key: `repo + path`. Index selectively, not exhaustively. Updated when the source changes.

---

## Event — what happened

Things that occurred at a point in time. Append-only with timestamps. Relevance decays naturally.

- **Write path**: `INSERT` — append-only with required timestamp
- **Identity**: ULID + timestamp (no external key)
- **Retrieval**: Time-window filter first, then semantic search within window
- **Lifecycle**: Decays after configurable relevance window; archived or pruned

### Kinds

**`conversation`** — Session history and key exchanges with AI agents.
Captured from exports or agent-selected highlights during sessions.

**`message`** — Chat messages from Slack, Teams, email, or similar.
Channel and sender are metadata fields, not structural differences. An email and a Slack message are both messages.

**`session`** — Summary of an agent work session.
Higher-level than individual messages — captures what was accomplished, not every exchange.

**`log`** — Build logs, error traces, operational output.
High volume. May need sampling or aggregation before storage. Short TTL.

---

## How category drives the system

| Concern           | Knowledge                    | Entity                         | Event                        |
| ----------------- | ---------------------------- | ------------------------------ | ---------------------------- |
| Write semantics   | `INSERT`                     | `INSERT OR REPLACE` on key     | `INSERT`                     |
| Identity          | ULID                         | Explicit key per kind          | ULID + timestamp             |
| Retrieval default | Semantic                     | Exact match, semantic fallback | Time-window + semantic       |
| Decay             | Never                        | Optional TTL                   | Configurable window          |
| Chunking          | If content exceeds threshold | No                             | If content exceeds threshold |
| Embedding         | Full content                 | Full content                   | Full content                 |

### Adding new kinds

To decide where a new kind belongs, ask two questions:

1. **Does it have identity that gets updated?** → Entity
2. **Does its relevance decay over time?** → Event
3. **Neither?** → Knowledge

A new kind never requires a new category. If it does, the model is wrong.
