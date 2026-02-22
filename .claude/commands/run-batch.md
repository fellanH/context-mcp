---
allowed-tools: Bash, Read
---

You are starting the automated batch loop for context-vault.

## Steps

1. Read `.claude/issue-batch.json`. If the file is missing or `queue` is empty,
   report "No queue found. Run /plan-batch first." and stop.

2. Show the queued issues to the user and confirm they want to proceed.

3. Run the batch script:

   ```bash
   bash "$CLAUDE_PROJECT_DIR/scripts/run-batch.sh"
   ```

   Wait for it to complete. It will print progress for each issue.

4. When the script exits, read `.claude/issue-batch.json` and report:
   - How many issues completed (pending)
   - How many failed (with log paths at `.claude/batch-logs/issue-N.log`)

5. Remind: "Run /release-batch to review and ship."
