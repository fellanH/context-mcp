Start a fresh working session for this repo. Follow the session protocol from CLAUDE.md:

1. **Orient** — Read `BACKLOG.md` to understand current priorities. Query context vault for recent session reviews: `get_context` with tags `context-vault, retro` (limit 3). Check `git status` and `git log --oneline -5` for repo state.

2. **Pick** — If `Now` has items, work on those. If `Now` is empty, propose pulling the top item from `Next` (highest ICE score). Present the pick to the user for confirmation before proceeding.

3. **Pitch** — Once an item is picked, pitch the plan per the session protocol before writing any code.

Do NOT skip ahead to implementation. Stop after the pitch and wait for approval.
