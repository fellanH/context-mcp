Start a new working session.

1. Read `NORTH-STAR.md` — hold this as the product direction for the session.

2. Derive live state — run these commands:

   ```bash
   git status && git log --oneline -5
   npm view context-vault version
   gh run list --workflow=deploy.yml --limit=3
   ```

   Read `BACKLOG.md`, `FEEDBACK.md`, `INBOX.md`. Surface a brief summary: what's shipped recently, what's pending, highest-priority next item.

   If not on `main` — flag it and ask why before proceeding.

3. Ask: **"What is the session goal?"** — one sentence. If the human hasn't stated it, prompt for it.

4. Self-governance check: does this conflict with in-progress work or contradict NORTH-STAR.md? If yes, surface it and wait. Never proceed past a conflict silently.

5. Pitch approach. Wait for approval before writing any code.
