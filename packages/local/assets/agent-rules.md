<!-- context-vault-rules v1.0 -->
# Context Vault — Agent Rules

You have access to a persistent knowledge vault via MCP tools (`get_context`, `save_context`, `list_context`, `delete_context`). Use it to build lasting memory across sessions.

## When to Retrieve

Check the vault when you're about to invest effort that past knowledge could shortcut. Apply this test: "Might I or a previous session have encountered this before?" If yes, search first.

Retrieval triggers:
- **Starting a session**: call `session_start()` or `get_context(query: "<project or task context>")` to load relevant prior knowledge
- **Hitting an error**: search for the error message or root cause before debugging from scratch
- **Making a decision**: check if this architectural or design choice was already made and why
- **Integrating with an API, library, or service**: search for known quirks, gotchas, or working patterns
- **Entering an unfamiliar area of the codebase**: check for prior insights about that module or domain
- **Before saving**: search to avoid duplicates and to update existing entries instead

A vault search takes milliseconds. Debugging from scratch takes minutes. Always check first.

## When to Save

Save when you encounter something a future session would benefit from knowing. Apply this test: "Would I tell a colleague about this to save them time?" If yes, save it.

Save triggers:
- Solved a non-obvious bug (root cause was not apparent from the error)
- Discovered undocumented API/library/tool behavior
- Found a working integration pattern requiring non-obvious configuration
- Hit a framework limitation and found a workaround
- Made an architectural decision with tradeoffs worth preserving

## When NOT to Save

- Facts derivable from reading the current code or git history
- The fix itself (that belongs in the commit, not the vault)
- Generic programming knowledge you already know
- Session-specific state (files edited, commands run)

## How to Save

Every entry must have:
- `title`: clear, specific (not "auth fix" but "Express 5 raw body parser breaks Stripe webhook verification")
- `tags`: at minimum a `bucket:<project>` tag for scoping
- `kind`: insight, pattern, reference, decision, or event
- `tier`: `working` for active context, `durable` for long-term reference

Capture what was learned (the insight), why it matters (what problem it prevents), and when it applies (what context makes it relevant).

## Session Review

At the end of significant work sessions, review what you learned. If the session produced novel knowledge (not every session does), save 1-3 consolidated entries. Prefer one solid entry over multiple fragments.
