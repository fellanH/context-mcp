---
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
description: >
  Implement a GitHub issue end-to-end: fetch requirements, implement, test,
  commit, and add to the release batch for later review and deployment.
---

# Work on GitHub Issue

You are working on GitHub issue #$ARGUMENTS for the context-vault project.

## Steps

1. **Fetch issue details**
   Run: `gh issue view $ARGUMENTS --json number,title,body,labels`
   Parse: title, requirements from body, labels (bug/feature/enhancement/etc.)

2. **Plan implementation**
   Use TaskCreate to break the issue into concrete sub-tasks.
   Read relevant source files before making changes.

3. **Implement**
   Make targeted changes only — no scope creep beyond what the issue requires.
   Follow existing patterns; no new abstractions unless necessary.

4. **Test**
   Run: `npm test`
   Run: `node scripts/check-constants.js`
   Both must pass before continuing.

5. **Commit**
   Stage and commit with message format:
   `fix: <issue title> (closes #N)` for bugs
   `feat: <issue title> (closes #N)` for features/enhancements

6. **Track in batch**
   Read `.claude/issue-batch.json` (create if absent with `{"queue":[],"pending":[],"failed":[]}`).
   Append to `pending` only — queue management is the script's job:

   ```json
   { "number": N, "title": "...", "labels": ["..."], "commit": "<sha>" }
   ```

   Write back to `.claude/issue-batch.json`.

7. **Report**
   Summarize what changed and confirm:
   "Issue #N complete. Added to release batch. Run /release-batch when ready."
