---
allowed-tools: Bash, Read, Write
---

You are planning a release batch for context-vault.

## Steps

1. Fetch open issues:
   `gh issue list --state open --limit 50 --json number,title,labels,body`

2. Read `.claude/issue-batch.json` if it exists. Skip any issues already in
   `pending` or `failed` arrays.

3. Select 3–7 issues to batch. Criteria:
   - Well-scoped: no architectural rewrites, no new packages
   - Non-conflicting: avoid issues that touch the same core files
   - Order lowest-risk first: dx/infra/enhancement before bug, simple before complex

4. Determine projected release type (highest-wins across selected labels):
   - Any `breaking` → major
   - Any `feature`, `enhancement`, `gtm` → minor
   - Only `bug`, `dx`, `infra`, `user-request`, `P0`–`P3` → patch

5. Present the planned queue and projected release type. Wait for user to say
   "proceed" or "go" before writing.

6. Write `.claude/issue-batch.json`:

   ```json
   {
     "queue": [{"number": N, "title": "...", "labels": [...]}],
     "pending": [],
     "failed": [],
     "planned_at": "<ISO timestamp>"
   }
   ```

7. Confirm: "Queue ready: N issues (projected: patch/minor/major). Run /run-batch to start."
