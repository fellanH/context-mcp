# Context Vault: Agent-Assisted Setup Prompt

Paste the prompt below into your AI coding assistant (Claude Code, Cursor, Windsurf, etc.) after installing context-vault to customize your installation.

---

## Prompt

```
I just installed context-vault as an MCP server. Help me set it up properly for my workflow. Do these steps in order, asking me before making any changes:

1. Verify the vault MCP connection is working by calling context_status()

2. Scan my existing rules and instructions:
   - Read files in ~/.claude/rules/ (or equivalent for this client)
   - Read any CLAUDE.md in my current project and home directory
   - Read .cursorrules or .windsurfrules if they exist
   - Tell me if you find any existing vault-related instructions

3. Check if a context-vault rules file is already installed. If not, offer to install one. The rules file teaches you when and how to save knowledge to my vault automatically. Show me the exact content before writing anything.

4. Check for conflicts between the vault rules and my existing instructions. Flag any contradictions or redundancies and ask me how to resolve them.

5. Scan my current workspace for projects (look for package.json, .git, Cargo.toml, pyproject.toml, etc.). For each project, propose a vault bucket name and create it if I approve.

6. Check for Claude Code auto-memory integration:
   - Look for auto-memory files at ~/.claude/projects/-<project-key>/memory/MEMORY.md
     (project key = absolute cwd path with / replaced by -, leading - kept)
   - If found, report stats: entry count, lines used out of 200 cap
   - Offer to index existing memories into the vault as searchable copies
     (kind: "reference", tags: ["auto-memory-indexed", "bucket:<project>"])
   - This does NOT modify auto-memory files, only creates vault copies
   - Mention the /vault overflow command for future overflow management

7. Check for team vault configuration:
   - Look for remote.teamId in the vault config (via context_status())
   - If a team is configured, confirm the agent rules include team sharing heuristics
   - If no team is configured, mention that teams can be set up later via the app at https://app.context-vault.com

8. Show me a summary of everything you configured.

Important:
- Never modify my existing rules files. Only create a new dedicated context-vault rules file or append with clear delimiter markers.
- Show me exact file paths and content before writing anything.
- If I decline any step, skip it.
```

---

## What this does

After running this prompt, your AI agent will:

- **Verify** your vault connection is working
- **Detect** your existing rules and avoid conflicts
- **Install** a rules file that teaches the agent when to save knowledge automatically
- **Configure** project-specific vault buckets for organized storage
- **Detect** Claude Code auto-memory and offer to index entries into the vault

The rules file is a small (~50 lines) markdown file that guides your agent on:
- When to save (after solving non-obvious bugs, finding undocumented behavior, etc.)
- When NOT to save (generic knowledge, code-derivable facts)
- How to save (with proper titles, tags, and tiers)
- Session review (consolidating learnings at end of work sessions)

You can edit or delete the rules file at any time. It lives at:
- **Claude Code:** `~/.claude/rules/context-vault.md`
- **Cursor:** `~/.cursor/rules/context-vault.mdc` (global Cursor rules)
- **Windsurf:** `~/.windsurfrules` (appended with delimiter markers)

## Manual installation

If you prefer not to use agent-assisted setup, you can copy the rules file content directly from the [Agent Rules Reference](/docs/agent-rules) page on our website.
