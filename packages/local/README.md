# context-vault

[![npm version](https://img.shields.io/npm/v/context-vault)](https://www.npmjs.com/package/context-vault)
[![npm downloads](https://img.shields.io/npm/dm/context-vault)](https://www.npmjs.com/package/context-vault)
[![license](https://img.shields.io/npm/l/context-vault)](./LICENSE)
[![node](https://img.shields.io/node/v/context-vault)](https://nodejs.org)

Persistent memory for AI agents — saves and searches knowledge across sessions. Your data stays local as plain markdown files.

## Quick Start

```bash
npx context-vault setup
```

One command — no global install required. Setup detects your AI tools (Claude Code, Codex, Claude Desktop, Cursor, Windsurf, Cline, and more), downloads the embedding model (~22MB), seeds your vault, and configures MCP.

Then open your AI tool and try: **"Search my vault for getting started"**

## What It Does

- **Save** — insights, decisions, patterns, contacts. Your AI agent writes them as you work.
- **Search** — hybrid full-text + semantic search. Ask in natural language.
- **Own your data** — plain markdown in `~/vault/`, git-versioned, human-editable.

## MCP Tools

Your AI agent uses these automatically.

| Tool             | Description                        |
| ---------------- | ---------------------------------- |
| `get_context`    | Search vault (hybrid FTS + vector) |
| `save_context`   | Save or update entries             |
| `list_context`   | Browse with filters                |
| `delete_context` | Remove by ID                       |
| `ingest_url`     | Fetch URL, extract, save           |
| `context_status` | Health and config                  |

Entries are organized by `kind` (insight, decision, pattern, reference, contact, etc.) into `~/vault/knowledge/`, `~/vault/entities/`, `~/vault/events/`. Kind is derived from the subdirectory name.

## CLI

| Command                       | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `context-vault setup`         | Interactive installer — detects tools, writes MCP configs  |
| `context-vault connect --key` | Connect AI tools to hosted vault                           |
| `context-vault switch`        | Switch between local and hosted MCP modes                  |
| `context-vault serve`         | Start the MCP server (used by AI clients)                  |
| `context-vault status`        | Vault health, paths, entry counts                          |
| `context-vault flush`         | Confirm DB is accessible; prints entry count and last save |
| `context-vault hooks install` | Install Claude Code memory and optional session flush hook |
| `context-vault hooks remove`  | Remove the recall and session flush hooks                  |
| `context-vault reindex`       | Rebuild search index                                       |
| `context-vault import <path>` | Import .md, .csv, .json, .txt                              |
| `context-vault export`        | Export to JSON or CSV                                      |
| `context-vault ingest <url>`  | Fetch URL and save as vault entry                          |
| `context-vault update`        | Check for updates                                          |
| `context-vault uninstall`     | Remove MCP configs                                         |

## Claude Code Lifecycle Hooks

Claude Code exposes shell hooks that fire on session events. context-vault integrates with two of them:

**UserPromptSubmit** — runs `context-vault recall` on every prompt, injecting relevant vault entries as context (installed via `hooks install`).

**SessionEnd** — runs `context-vault flush` when a session ends, confirming the vault is healthy and logging the current entry count. Install it when prompted by `hooks install`, or add it manually to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx context-vault flush",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The `flush` command reads the DB, prints a one-line status (`context-vault ok — N entries, last save: <timestamp>`), and exits 0. It is intentionally a no-op write — its purpose is to confirm reachability at session boundaries.

To install both hooks at once:

```bash
context-vault hooks install
# Follow the second prompt: "Install session auto-flush hook? (y/N)"
```

To remove both hooks:

```bash
context-vault hooks remove
```

## Manual MCP Config

If you prefer manual setup over `context-vault setup`:

```json
{
  "mcpServers": {
    "context-vault": {
      "command": "context-vault",
      "args": ["serve", "--vault-dir", "/path/to/vault"]
    }
  }
}
```

## Hosted Option

No Node.js required — sign up at [app.context-vault.com](https://app.context-vault.com), get an API key, connect in 2 minutes.

Full setup instructions for Claude Code, Cursor, and GPT Actions: [docs/distribution/connect-in-2-minutes.md](../../docs/distribution/connect-in-2-minutes.md)

## Troubleshooting

**Install fails (native modules):**

```bash
npm rebuild better-sqlite3 sqlite-vec
```

On Apple Silicon, ensure you're running native ARM Node.js: `node -p process.arch` should say `arm64`.

**Stale search results:**

```bash
context-vault reindex
```

**Vault not found:**

```bash
context-vault status   # shows resolved paths
mkdir -p ~/vault
```

## License

MIT
