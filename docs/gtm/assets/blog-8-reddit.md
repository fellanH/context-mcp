# Blog #8: Reddit Post Draft

**Blog post:** "Designing Kinds, Tags, and Folders for Long-Term Memory Quality"
**Pillar:** Education
**Format:** Educational deep-dive / experience post
**Subreddits:** r/ClaudeAI, r/LocalLLaMA
**Tone:** Technical, first-person, helpful — lead with the problem, not the product
**Status:** Draft

---

## Title Options

1. "How I structure AI agent memory so retrieval doesn't break at scale (kinds, tags, folders)"
2. "Taxonomy design for persistent AI memory — what actually works at 500+ entries"
3. "Lessons from scaling an MCP memory vault: why flat notes fail and what to do instead"

Pick based on subreddit norms. Option 1 for r/ClaudeAI (more practical/workflow focus), option 2 or 3 for r/LocalLLaMA (more architecture focus).

---

## Post Body

**The problem**

I've been using a persistent memory layer (Context Vault, via MCP) for my AI coding sessions. When my vault had 50 entries, every search returned exactly what I needed. When it crossed 300, retrieval quality dropped noticeably — I was getting debug notes when I searched for architectural decisions, and old session logs buried the patterns I actually wanted.

The issue wasn't the search engine. It was my taxonomy. I was saving everything as generic "notes" with inconsistent tags and deeply nested folders. The search index was doing its best, but the data structure was fighting against it.

**What I changed**

I restructured around three axes that Context Vault supports natively: kinds, tags, and folders.

**Kinds — the primary organizing axis**

Instead of dumping everything as a "note," I use the most specific kind that fits:
- `decision` — when I chose between two approaches and want to remember why
- `pattern` — reusable code or workflow approaches
- `insight` — surprising discoveries about APIs, libraries, or behavior
- `reference` — external docs, endpoints, config values

The system also has entity kinds (contact, project, tool) that get upserted by identity key, and event kinds (session, log) that auto-decay in search after 30 days. That last part is key — old session logs stop crowding out durable decisions without any manual cleanup.

**Tags — cross-cutting queries**

I redesigned my tags around domains and features: `auth`, `billing`, `onboarding`, `postgres`. These stay useful for months.

I dropped temporal tags like `sprint-12` and `wip` — they become noise within weeks. If I need time-based filtering, the `since`/`until` parameters on `get_context` handle that properly.

I also cut my total tag vocabulary from ~80 to under 30. Fewer, more consistent tags means the agent can actually filter effectively.

**Folders — physical grouping, not retrieval**

Folders create subdirectories within a kind for project isolation: `react/hooks`, `client-a/api`. But search doesn't use folder paths — all entries of a kind are indexed together. So folders are for browsing and git organization, not for query filtering. That distinction matters. 1-2 levels of depth max.

**Results**

After restructuring (~2 hours of work across 300 entries), my first-result relevance went from roughly 50% back to 80%+. The key insight: retrieval precision is a product of taxonomy quality, not search algorithm tuning.

**Monthly audit checklist I follow now**

- Kinds with only 1-2 entries -> merge into a broader kind
- Tags on 50%+ of entries -> too generic, split or remove
- Folders with a single file -> unnecessary nesting, flatten

**Links**

- Full guide with examples: https://contextvault.dev/blog/designing-kinds-tags-folders-for-long-term-memory-quality?utm_source=reddit&utm_medium=social&utm_campaign=blog-8
- GitHub (open source): https://github.com/fellanH/context-vault
- Start free (hosted): https://contextvault.dev?utm_source=reddit&utm_medium=social&utm_campaign=blog-8

Happy to answer questions about taxonomy design or retrieval tuning. Curious how others are structuring their agent memory systems too.
