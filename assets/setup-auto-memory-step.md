# Auto-Memory Integration Step for /vault setup

This document describes the auto-memory detection step to add to the `/vault setup` skill flow. Insert this after the existing bucket scanning step and before the final summary.

---

## Step: Auto-Memory Integration

After completing existing setup steps, detect and optionally integrate Claude Code's auto-memory system.

### Detection

1. Get the current working directory
2. Compute the Claude Code project key: replace `/` with `-` in the absolute path (keep the leading `-`)
3. Check `~/.claude/projects/<project-key>/memory/MEMORY.md`
4. If not found, skip silently (auto-memory is optional)

### Reporting

If auto-memory is detected, read the directory and report:

```
Step N: Auto-Memory Integration

Detected Claude Code auto-memory at:
  ~/.claude/projects/-Users-example-myproject/memory/
  ({entry_count} entries, {lines_used}/200 lines used)

The context vault can enhance your auto-memory with:
  1. Semantic search across all memories (not just flat file matching)
  2. Cross-project memory sharing via vault buckets
  3. Overflow management when MEMORY.md approaches 200 lines
  4. Richer session briefs that combine both sources

This does NOT modify your existing memories. The vault sits alongside auto-memory.

Index existing memories into the vault? [Y/n]
```

### Indexing (if user approves)

For each memory file in the auto-memory directory (excluding MEMORY.md):

1. Read and parse the file (frontmatter: name, description, type + body)
2. Check vault for duplicates: `save_context(dry_run: true, ...)`
3. If no duplicate (or user wants to save anyway):

```
save_context(
  kind: "reference",
  title: "<memory name>",
  body: "<full body content>",
  tags: ["auto-memory-indexed", "bucket:<project>"],
  tier: "working",
  source: "auto-memory sync during /vault setup"
)
```

4. Do NOT modify the original auto-memory files. These are copies.

### Overflow skill mention

After indexing, mention the overflow skill:

```
Auto-memory indexed: {saved}/{total} entries copied to vault
({skipped} skipped as duplicates)

Tip: When MEMORY.md approaches 200 lines, use /vault overflow
to graduate older entries to the vault and free space.
```

### What this step does NOT do

- Does not modify MEMORY.md or any memory files
- Does not set up automatic syncing between systems
- Does not change how Claude Code reads auto-memory
- Does not install hooks that intercept memory writes
