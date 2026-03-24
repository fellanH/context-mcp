# vault overflow -- Auto-Memory Graduation Skill

Graduate older, lower-priority auto-memory entries to the context vault when MEMORY.md approaches its 200-line cap. This frees space in auto-memory while preserving knowledge in the vault's semantic search.

**Trigger:** `/vault overflow` or proactive suggestion when `session_start` detects >160 lines in MEMORY.md.

---

## Step 1 -- Detect auto-memory

Locate the Claude Code auto-memory directory:

1. Compute the project key from `cwd`: replace `/` with `-` in the absolute path (keep leading `-`)
2. Check `~/.claude/projects/<project-key>/memory/MEMORY.md`
3. If not found, stop: "No auto-memory detected for this project."

Read `MEMORY.md` and count lines.

If lines <= 160:
  Print: "MEMORY.md is at {lines}/200 lines ({pct}%). No overflow needed yet."
  Offer: "Run anyway to preview graduation candidates? [y/N]"
  If declined, stop.

---

## Step 2 -- Read and rank entries

Read MEMORY.md to extract all referenced memory file links (markdown link format: `[filename.md](filename.md)`).

For each referenced file, read it from the memory directory and parse:
- Frontmatter fields: `name`, `description`, `type` (user/feedback/project/reference)
- File modification time (use filesystem stat)
- Body content

Rank entries for graduation (lowest priority graduates first):

| Priority | Type | Rationale |
|----------|------|-----------|
| 1 (first to graduate) | `reference` | Most useful as searchable vault entries |
| 2 | `project` | Often time-sensitive, frequently stale |
| 3 | `user` | Stable personal context, high value |
| 4 (last to graduate) | `feedback` | Behavioral preferences, highest value in auto-memory |

Within the same type, older entries (by file modification time) graduate first.

Determine how many entries need to graduate to bring MEMORY.md under 120 lines (60% of cap, providing headroom). Estimate ~3 lines per entry in the index (link line + description + blank line).

---

## Step 3 -- Deduplicate against vault

For each graduation candidate, check the vault for existing similar content:

```
get_context(query: "<entry title>: <first 200 chars of body>", limit: 1, similarity_threshold: 0.9)
```

Classify each candidate:
- **New**: no vault match above 0.9 similarity. Will be saved to vault.
- **Duplicate**: vault already has this knowledge (similarity > 0.9). Safe to remove from auto-memory without vault save.
- **Partial overlap**: similarity between 0.7 and 0.9. Flag for user review.

---

## Step 4 -- Present graduation plan

Show the plan to the user. Do NOT proceed without explicit approval.

```
AUTO-MEMORY OVERFLOW REPORT

MEMORY.md: {lines}/200 lines ({pct}%)
Entries found: {total}
Graduation candidates: {count}

GRADUATION PLAN:

  # | File | Type | Action | Reason
  --|------|------|--------|-------
  1 | project_auth_rewrite.md | project | Save to vault | New (no vault match)
  2 | reference_api_docs.md | reference | Remove only | Duplicate (93% match with vault entry "API docs")
  3 | user_preferences.md | user | Skip | Partial overlap (78%), needs review

After graduation: ~{projected_lines}/200 lines

Proceed with graduation? [Y/n/select specific entries]
```

If the user declines, stop. If they select specific entries, only graduate those.

---

## Step 5 -- Execute graduation

For each approved candidate:

### If action is "Save to vault":
```
save_context(
  kind: "reference",
  title: "<entry name>",
  body: "<full entry body, prefixed with: Originally from Claude Code auto-memory ({type} type).>",
  tags: ["graduated-memory", "bucket:<project>"],
  tier: "working",
  source: "auto-memory graduation"
)
```

### If action is "Remove only" (duplicate):
No vault save needed, just remove from auto-memory.

### For all graduated entries:
1. Remove the entry's line from MEMORY.md (the link line and any adjacent description)
2. Delete the memory file from the memory directory

### Important:
- Process one entry at a time. If any vault save fails, stop and report the error.
- After all entries are processed, re-read MEMORY.md and verify the line count decreased.

---

## Step 6 -- Report

```
GRADUATION COMPLETE

Graduated: {count} entries
  - Saved to vault: {saved_count}
  - Removed (duplicates): {dup_count}
  - Skipped: {skip_count}

MEMORY.md: {old_lines} -> {new_lines}/200 lines

Vault entries created:
  - "Entry title" (id: <ULID>)
  - ...

Use `get_context(tags: ["graduated-memory"])` to find all graduated entries.
```

---

## What NOT to do

- Never graduate entries without user approval
- Never modify MEMORY.md format or structure beyond removing graduated entries
- Never graduate `feedback` type entries unless the user is critically over the line limit (>190 lines)
- Never save vault entries about the graduation process itself
- Never delete memory files without first successfully saving to vault (when save is needed)
- If MEMORY.md parsing fails or produces unexpected results, stop and show the raw content to the user
