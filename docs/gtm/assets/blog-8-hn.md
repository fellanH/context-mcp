# Blog #8: Hacker News Post Draft

**Blog post:** "Designing Kinds, Tags, and Folders for Long-Term Memory Quality"
**Pillar:** Education
**Format:** Standard HN submission + author first comment
**Tone:** Technical, honest, solicit feedback on taxonomy design trade-offs
**Status:** Draft

---

## Submission

**Title:** Designing Kinds, Tags, and Folders for Long-Term AI Agent Memory Quality

**URL:** https://contextvault.dev/blog/designing-kinds-tags-folders-for-long-term-memory-quality?utm_source=hn&utm_medium=social&utm_campaign=blog-8

---

## Author First Comment

I wrote this after hitting a concrete problem: my AI agent memory vault worked well at small scale but retrieval quality degraded past a few hundred entries. The fix was taxonomy, not search tuning.

**The core idea**

Context Vault (an MCP memory server) organizes entries along three axes:

1. **Kind** — the structural type of an entry. Built-in kinds map to three categories:
   - Knowledge (insight, decision, pattern, reference) — append-only, enduring
   - Entity (contact, project, tool) — upserted by identity key
   - Event (session, log) — auto-windowed by recency during search (last 30 days by default)

2. **Tags** — free-form strings for cross-cutting queries. The article argues for domain-based tags (auth, billing, api-v2) over temporal ones (sprint-12, wip), and for keeping total vocabulary small (~30 tags vs ~200).

3. **Folders** — physical subdirectories within a kind for project isolation. They don't affect search behavior, only disk layout. Useful for multi-project vaults and git organization.

**Interesting trade-offs**

The category layer behind kinds controls write semantics (append vs upsert) and search behavior (enduring vs decaying). Custom kinds default to knowledge-category. This is an opinionated default — we considered making category a required field on custom kinds but decided the extra friction wasn't worth it for the common case.

The tag vocabulary size recommendation (~30 tags across 500 entries) is based on my experience, not formal study. I'd be interested to hear from anyone who has measured tag cardinality vs retrieval precision more rigorously.

**Limitations**

- The taxonomy is designed for single-developer or small-team vaults. At enterprise scale with many contributors, kind discipline likely breaks down without governance tooling.
- Restructuring taxonomy after the fact (renaming kinds, merging tags) currently requires manual file edits and a reindex. There's no built-in migration command yet.
- The 30-day auto-window for event kinds is a fixed default. It should probably be configurable per-kind, but isn't currently.

**What I'd like feedback on**

1. Is the kind/tag/folder separation too rigid, too flexible, or about right for a developer knowledge base?
2. Has anyone built similar taxonomy systems for structured knowledge management and found different axis designs that work better?
3. The monthly audit pattern (check kind distribution, tag frequency, folder depth) — does anyone have automated approaches for taxonomy health monitoring?

GitHub: https://github.com/fellanH/context-vault
Site: https://contextvault.dev?utm_source=hn&utm_medium=social&utm_campaign=blog-8
