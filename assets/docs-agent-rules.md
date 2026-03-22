# Agent Rules

Agent rules teach your AI tools when and how to use the context vault. They're installed as rules files that your AI tool reads on every session, giving it instructions to check the vault before debugging, save non-obvious discoveries, and avoid duplicate entries.

## What the rules do

The rules file contains five sections:

- **When to Retrieve** -- triggers that tell the agent to search the vault first (starting a session, hitting an error, making a decision, entering unfamiliar code)
- **When to Save** -- triggers that tell the agent to save new knowledge (non-obvious bugs, undocumented behavior, integration patterns, workarounds, architectural decisions)
- **When NOT to Save** -- guardrails to prevent noise (code-derivable facts, generic knowledge, session-specific state)
- **How to Save** -- required fields for every entry (title, tags, kind, tier) so entries are findable later
- **Session Review** -- end-of-session habit to consolidate learnings into 1-3 solid entries

The rules don't add tools or change behavior. They provide guidance that makes the agent a better vault user.

## Installation

Rules are installed automatically during `context-vault setup`. You can also install or reinstall them manually:

```bash
context-vault rules install
```

### Where rules are installed

| Tool | Path | Method |
|------|------|--------|
| Claude Code | `~/.claude/rules/context-vault.md` | Direct file write |
| Cursor | `~/.cursor/rules/context-vault.mdc` | Direct file write |
| Windsurf | `~/.windsurfrules` | Appended with delimiters |

For Claude Code and Cursor, the rules are written as a standalone file. For Windsurf, the rules are appended to the shared `.windsurfrules` file wrapped in delimiter comments (`<!-- context-vault agent rules -->`) so they can be updated or removed without affecting your other rules.

### Skipping rules

If you prefer not to install rules during setup:

```bash
context-vault setup --no-rules
```

## Managing rules

### View installed rules

```bash
context-vault rules show
```

### Check for updates

```bash
context-vault rules diff
```

Shows a line-by-line diff between your installed rules and the version bundled with your current `context-vault` package.

### Upgrade rules

```bash
context-vault setup --upgrade
```

Checks all known tool paths for existing rules, compares version markers, shows what would change, and asks for confirmation before overwriting. Supports `--dry-run` to preview without writing.

You can also force-reinstall by running `context-vault rules install`, which overwrites existing files if the content differs.

### Show installation paths

```bash
context-vault rules path
```

## Customization

The rules file is plain markdown. You can edit it after installation to match your workflow:

- Add project-specific save triggers (e.g., "always save when working with the payments module")
- Adjust retrieval triggers to match your domain
- Add custom "When NOT to Save" entries to reduce noise

For Claude Code and Cursor, edit the file directly at the path shown by `context-vault rules path`. For Windsurf, edit the section between the `<!-- context-vault agent rules -->` delimiters in `~/.windsurfrules`.

**Note:** Running `context-vault rules install` or `context-vault setup --upgrade` will overwrite your customizations. If you've made changes you want to keep, back up the file before upgrading, or skip the rules step during setup with `--no-rules`.

## Version tracking

Rules files include a version comment on the first line:

```
<!-- context-vault-rules v1.0 -->
```

The `setup --upgrade` command uses this to detect whether your installed rules are outdated relative to the bundled version.

## Uninstalling

Rules are removed when you uninstall context-vault:

```bash
context-vault uninstall
```

This removes the Claude Code and Cursor rules files entirely, and strips the delimited section from `.windsurfrules` (preserving any other content in that file).
