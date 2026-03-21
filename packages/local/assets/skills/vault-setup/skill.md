---
name: vault-setup
description: >
  Agent-assisted context vault setup and customization. Verifies the MCP
  connection, detects existing rules, scans projects for vault buckets, and
  resolves conflicts with existing instructions — all with explicit user approval
  before making any changes.
  Triggers: "/vault setup", "set up my vault", "configure vault", "customize vault",
  "vault setup", "personalize vault".
---

# vault-setup skill

Agent-assisted setup that customizes the context-vault installation for the user's workflow. Always show what you plan to do before doing it. Never modify existing rules without permission.

## Step 1 — Verify vault connection

Call `context_status()` (or `get_context(query: "test", limit: 1)` if context_status is unavailable). Report:
- Whether the MCP connection is working
- Vault location and entry count
- If it fails: print the exact error and stop — the MCP server needs to be running first

## Step 2 — Scan existing rules

Read these locations silently (do not write anything yet):
- `~/.claude/rules/` — list all files
- `~/.claude/rules/context-vault.md` — the installed rules file (if present)
- `CLAUDE.md` in the current working directory (if it exists)
- `~/.claude/CLAUDE.md` (if it exists)
- `.cursorrules` in cwd (if it exists)
- `.windsurfrules` in cwd (if it exists)

Report what you found:
- Whether a context-vault rules file is already installed and its version
- Any existing vault-related instructions in other files (quote them)
- Any conflicts or redundancies

## Step 3 — Check for conflicts

Compare the installed rules (if any) against the user's existing instructions. Flag:
- Contradictions (e.g., "always save everything" vs the vault's quality heuristic)
- Redundancies (e.g., the user already has identical instructions in CLAUDE.md)
- Missing rules (vault connection not verified, no bucket conventions set)

Ask the user how to resolve each conflict before proceeding.

## Step 4 — Scan for projects

Look in the current working directory and one level up for project roots:
- Files: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`
- Directories: `.git`

For each project found, propose a vault bucket name (lowercase, hyphens, derived from the project name or directory). Example: `my-app` → `bucket:my-app`.

Ask: "I found these projects. Create vault buckets for them? I'll add bucket conventions to your rules."

Only proceed if the user approves.

## Step 5 — Apply changes

For each approved change, show the exact content and path before writing. Changes may include:
- Creating or updating `~/.claude/rules/context-vault.md` with project-specific bucket conventions
- Appending project bucket notes to the rules file

Never modify the user's own rules files (CLAUDE.md, .cursorrules, etc.). Only write to the dedicated context-vault rules file.

## Step 6 — Summary

Print a final summary:
- What was configured
- Where each file was written
- How to view the rules: `context-vault rules show`
- How to remove everything: `context-vault uninstall`

## What NOT to do

- Do not save vault entries about the setup itself (the setup is not vault-worthy knowledge)
- Do not modify files without showing exact content first
- Do not delete or overwrite user-written rules
- Do not assume project structure — verify with file reads
- Do not proceed past a failed vault connection
