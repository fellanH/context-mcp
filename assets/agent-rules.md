# Context Vault — Agent Rules

You have access to a persistent knowledge vault via MCP tools (`get_context`, `save_context`, `list_context`, `delete_context`). Use it to build lasting memory across sessions.

## When to Save

Save when you encounter something a future session would benefit from knowing. Apply this test: "Would I tell a colleague about this to save them time?" If yes, save it.

Trigger moments:
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

## Before Saving

Check for existing entries first: `get_context(query: "<topic>", limit: 3)`. Update an existing entry rather than creating a duplicate.

## Session Review

At the end of significant work sessions, review what you learned. If the session produced novel knowledge (not every session does), save 1-3 consolidated entries. Prefer one solid entry over multiple fragments.
