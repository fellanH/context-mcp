# Claude Code Plugin

Context Vault integrates with Claude Code via a `UserPromptSubmit` hook. On every prompt, it searches your vault for relevant entries and injects them as a `<context-vault>` XML block that Claude receives alongside your message.

## Install

```bash
context-vault hooks install
```

Or using the alias:

```bash
context-vault claude install
```

Both commands write a `UserPromptSubmit` hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "context-vault recall",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The install command also offers an optional `SessionEnd` flush hook that confirms vault health at the end of each session. Pass `--flush` to accept without prompting.

## Uninstall

```bash
context-vault hooks uninstall
```

Or:

```bash
context-vault claude uninstall
```

Removes the `UserPromptSubmit` recall hook and any `SessionEnd` flush hook.

## How injection works

`context-vault recall` reads the Claude Code hook payload from stdin, extracts the user prompt, runs a hybrid search (FTS + semantic embeddings) against the vault, and writes a `<context-vault>` block to stdout:

```xml
<context-vault>
<entry kind="insight" tags="react,hooks">
Body text truncated to 400 characters per entry...
</entry>
<entry kind="decision" tags="architecture">
...
</entry>
</context-vault>
```

Up to 5 entries are returned. Total injected output is capped at 2000 characters.

## Design decisions

- **Read-only injection**: The hook only reads from the vault. Writing is explicit via the `save_context` MCP tool.
- **Vault is source of truth**: No sync with `~/.claude/memory`. The vault and CLAUDE.md memory serve different purposes.
- **Opt-in**: The hook is never installed automatically. Run `context-vault hooks install` to enable.
- **Conflict-safe**: Install is append-only and detects duplicates. Existing hooks are never overwritten.
- **Silent on failure**: `context-vault recall` catches all errors and exits cleanly to never interrupt Claude Code.
