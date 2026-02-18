# Data Categories

Reference for envisioned data types in the vault. Each category maps to a `kind` and has its own expectations around structure, lifecycle, and retrieval.

This document is descriptive, not prescriptive — it captures how different types of data behave, not how the system must implement them.

---

## Permanent Knowledge

Data that remains valuable indefinitely. No decay, no archival.

### Insights

General discoveries, gotchas, and learnings captured during work.

- **Kind**: `insight`
- **Sources**: Agent capture during sessions, manual curation
- **Retrieval**: Semantic search

### Decisions

Architectural or strategic decisions with rationale.

- **Kind**: `decision`
- **Sources**: Agent capture, manual curation
- **Retrieval**: Semantic search, tag filtering

### Patterns

Reusable code templates and conventions.

- **Kind**: `pattern`
- **Sources**: Agent capture, manual curation
- **Retrieval**: Tag and language filtering, usage-weighted

### Prompts

Effective prompts worth reusing across sessions.

- **Kind**: `prompt`
- **Sources**: Agent capture during sessions
- **Retrieval**: Semantic search, tag filtering

---

## Project Context

Data scoped to a project or engagement. Relevant for weeks to months.

### Notes

Freeform text tied to a project or topic.

- **Kind**: `note`
- **Sources**: Agent capture, manual creation, import from note apps
- **Retrieval**: Semantic search, project scoping

### Documents & References

Long-form documentation, specs, or external reference material.

- **Kind**: `document`, `reference`
- **Sources**: CLI import from directories, web scraping
- **Retrieval**: Semantic search (may require chunking for long content)

---

## Operational Data

Data with a natural expiration. Relevant for days to weeks, then decays.

### Conversations

Session history and key exchanges with AI agents.

- **Kind**: `conversation`
- **Sources**: Import from conversation exports, agent captures key exchanges
- **Retrieval**: Temporal and semantic search

### Emails

Inbound/outbound email content.

- **Kind**: `email`
- **Sources**: MBOX/EML import, API connectors
- **Retrieval**: Structured fields (from, to, date) and semantic search

### Messages

Chat messages from Slack, Teams, or similar.

- **Kind**: `message`
- **Sources**: Export JSON, API connectors
- **Retrieval**: Channel, temporal, and semantic search

---

## Living Data

Data that gets updated in place rather than appended.

### Contacts

People — clients, collaborators, vendors.

- **Kind**: `contact`
- **Sources**: CSV import, CRM connectors, manual creation
- **Retrieval**: Exact match (name, email) and semantic search (role, context)
- **Note**: Needs upsert semantics — update existing, don't duplicate

### Source Code

Key files from codebases — interfaces, configs, important modules.

- **Kind**: `source`
- **Sources**: Selective import from repositories
- **Retrieval**: Semantic search, language and file path filtering
- **Note**: Index selectively, not exhaustively

---

## Ephemeral Signals

High-volume, short-lived data. Relevant for hours to days.

### Logs & Metrics

Build logs, error traces, analytics snapshots.

- **Kind**: `log`, `metric`
- **Sources**: CLI import, log file parsing
- **Retrieval**: Temporal and structured filters
- **Note**: High volume — may need sampling or aggregation before storage
