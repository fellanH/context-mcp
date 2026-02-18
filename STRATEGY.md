# Context MCP — Strategy

## The Problem

AI agents are stateless. Every session starts from zero. The agent has no memory of what you decided yesterday, what the client said last week, what patterns have worked, or what documentation you've already gathered. Each conversation burns tokens re-explaining context that already exists somewhere.

Humans solve this with messy, distributed systems — notes in Notion, messages in Slack, code in repos, contacts in a CRM, docs in Google Drive. But AI agents can't navigate that landscape. They need a single interface that answers: *"What do I already know about X?"*

## The Core Thesis

A private, portable, permanent knowledge store that any AI agent can read from and write to through a single protocol (MCP), with human-readable files as the source of truth and SQLite as a fast retrieval index.

This is not a database product. It's a **memory layer for AI agents** — the difference between an agent that starts every conversation from scratch and one that accumulates institutional knowledge over time.

## System Architecture

The system has three layers, each with a single responsibility:

### Capture

The write path. Takes context from any source and persists it as markdown files with YAML frontmatter in a vault directory. That is its entire job. It does not index, embed, or query. It writes files to a folder.

Anything that gets context into that folder is part of the capture layer — an MCP tool during an agent session, a CLI importer for bulk data, a user editing files by hand, a script pulling from an external API. The system is agnostic about how files arrive. It cares that they exist and follow a consistent format.

### Index

The structuring layer. Reads the vault directory, builds a SQLite database with full-text search and vector embeddings, and keeps the index in sync with the files on disk.

The database is derived, disposable, and rebuildable. Delete it and reindex — nothing is lost. This layer owns the schema, the embedding model, and the sync logic. It does not decide what to store or what to return. It makes the data queryable.

### Retrieve

The read path. Given a query and optional context, returns the most relevant entries from the index.

This is where the product lives. Scoring, ranking, freshness weighting, scoping, and result quality are all retrieval concerns. An agent that reliably finds the right answer from 200 entries will scale to 200,000. An agent that returns mediocre results from 200 entries will be useless at scale.

### Separation of Concerns

Capture does not care where context comes from. Index does not care what the data means. Retrieve does not care how data got there. Each layer can evolve independently.

```
            Any source                       Any agent
               │                                 ▲
               ▼                                 │
┌──────────────────────────┐    ┌──────────────────────────┐
│         CAPTURE          │    │         RETRIEVE         │
│                          │    │                          │
│  Writes markdown files   │    │  Queries the index       │
│  to the vault directory  │    │  Returns ranked results  │
└────────────┬─────────────┘    └────────────▲─────────────┘
             │                               │
             ▼                               │
┌──────────────────────────────────────────────────────────┐
│                        VAULT                             │
│                                                          │
│   ~/vault/**/*.md          ~/.context-mcp/vault.db       │
│   (source of truth)        (derived index)               │
│                                                          │
│                        INDEX                             │
│              Syncs files → database                      │
│              FTS + vector embeddings                     │
└──────────────────────────────────────────────────────────┘
```

## Principles

### The files are the source of truth

Markdown files with YAML frontmatter are the canonical store. The database is a derived index that can be rebuilt at any time. This means the vault is human-readable, git-versionable, greppable, and deletable. Remove a file, reindex, it's gone. No ghosts in a database.

### Privacy and portability are non-negotiable

This store will contain emails, client data, internal decisions, and proprietary knowledge. It must be local-first — SQLite and files on your machine, no cloud dependency. Copy the vault directory and database to another machine and it works.

### Multi-vault by design

Users operate across multiple contexts — personal, work, per-client, per-project. The system supports multiple independent vaults, each with its own directory and database. Vault selection is a top-level concern, not an afterthought bolted onto a single-vault design.

### Not all data has the same lifecycle

An architectural decision is permanent. A Slack thread is relevant for weeks. A build log is useful for days. The system must handle all of these without high-volume ephemeral data drowning out permanent knowledge. Retrieval must account for the difference between data that ages out and data that doesn't.

### Kinds are extensible

The `kind` field on each entry (insight, decision, pattern, email, conversation, contact, etc.) is the primary organizing axis. Kinds are not a fixed enum — creating a new kind is as simple as creating a new folder. But kinds carry implicit expectations about structure, lifecycle, and retrieval behavior. The system should have sensible defaults for unknown kinds and allow configuration for known ones.

See [DATA_CATEGORIES.md](./DATA_CATEGORIES.md) for a reference of envisioned data types and their characteristics.

### Retrieval quality is the product

The hardest problem is not storage — it's returning the right 5 results from 100,000 entries. A knowledge store that returns irrelevant results is worse than no knowledge store, because it wastes tokens and pollutes the agent's context window. Retrieval quality depends on relevance matching, recency awareness, usage signals, and the ability to scope queries to a specific context.

### MCP is the agent interface, not the only interface

The MCP server exposes tools for agents to search and capture knowledge. But bulk ingestion — importing thousands of emails, syncing a Slack workspace, indexing a codebase — should happen through separate processes that write to the same vault directory. The MCP server stays focused on real-time agent interaction.

## What This System Is Not

- **Not a transactional database.** This is a knowledge store, not a replacement for Postgres or Supabase for live application data.
- **Not a user-facing search product.** No pagination, faceted filters, or search UI. The interface is programmatic, optimized for agent context windows.
- **Not a data warehouse.** It stores reference knowledge, not raw event streams. Analytics and reporting belong elsewhere.
- **Not a backup system.** The vault stores curated knowledge, not comprehensive archives of everything. Be selective about what goes in.
- **Not a sync engine.** Data flows in from external sources. It does not flow back out. The vault is a one-way funnel — external sources are captured, agents read.

## Success Metrics

The system is working when:

1. **An agent finds the right context on the first search** — not the third or fourth attempt.
2. **Knowledge accumulates without drowning** — 10,000 entries retrieves as well as 100.
3. **Data flows in without friction** — importing a new source is trivial.
4. **Nothing is lost** — markdown files are the source of truth, always inspectable, always recoverable.
5. **It's invisible when working** — agents use it naturally, users don't manage it.

## Open Questions

- **Concurrent access**: If multiple agents connect to the same vault simultaneously, how are concurrent writes handled?
- **Summarization**: Should the system auto-summarize high-volume data to create denser, more retrievable entries? Or is that the agent's job?
- **Access control**: As sensitive data enters the vault, should certain kinds or scopes be restricted to specific agents or sessions?
