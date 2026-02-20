# Blog #8: X Thread Draft

**Blog post:** "Designing Kinds, Tags, and Folders for Long-Term Memory Quality"
**Pillar:** Education
**Format:** 5-tweet thread
**Target:** Developers using AI memory/context tools who struggle with retrieval quality at scale
**Status:** Draft

---

## Thread

### Tweet 1 (Hook)

Your AI memory system works fine at 50 entries. At 500 it returns garbage.

The problem isn't search — it's taxonomy. Here's how to structure kinds, tags, and folders so retrieval stays precise as your vault grows.

Thread:

---

### Tweet 2 (Problem)

Most devs dump everything as "notes."

At scale, that means:
- Architectural decisions mixed with debug logs
- Tags like "wip" and "tuesday" that are useless in 2 weeks
- Deeply nested folders that no search engine uses

Flat taxonomy = noisy retrieval = agent can't find what it needs.

---

### Tweet 3 (Solution — Kinds)

Context Vault organizes entries on 3 axes:

**Kinds** — the primary axis. Built-in types:
- Knowledge (insight, decision, pattern, reference)
- Entity (contact, project, tool) — upserted by identity key
- Event (session, log) — auto-windowed by recency

Use the most specific kind that fits. "Decision" not "note."

---

### Tweet 4 (Solution — Tags + Folders)

**Tags** — cross-cutting filters across kinds.

Design around domains: auth, billing, api-v2
NOT around time: sprint-12, tuesday-standup

Keep vocabulary under 30 tags. Check existing ones before adding new.

**Folders** — physical grouping within a kind. 1-2 levels max. Use for project isolation, not granularity.

---

### Tweet 5 (CTA)

The full guide covers category behavior, monthly audits, and how to measure retrieval precision.

Blog post: https://contextvault.dev/blog/designing-kinds-tags-folders-for-long-term-memory-quality?utm_source=x&utm_medium=social&utm_campaign=blog-8

GitHub: https://github.com/fellanH/context-vault
Start free: https://contextvault.dev?utm_source=x&utm_medium=social&utm_campaign=blog-8
