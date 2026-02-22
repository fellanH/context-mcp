---
allowed-tools: Bash, Read, Write
---

You are planning a release batch for context-vault.

## Steps

1. Fetch open issues:
   `gh issue list --state open --limit 50 --json number,title,labels,body`

2. Read `.claude/issue-batch.json` if it exists.

   Build the **skip list**: issue numbers already in `queue`, `pending`, or `failed`.
   - `queue` issues are already planned but not yet run — preserve them, do not re-select
   - `pending` and `failed` issues are already processed — skip entirely

3. Select 3–7 **additional** issues to append to the queue. Criteria:
   - Not in the skip list
   - Well-scoped: no architectural rewrites, no new packages
   - Non-conflicting with each other AND with issues already in `queue`
   - Order lowest-risk first: dx/infra/enhancement before bug, simple before complex

4. Determine projected release type (highest-wins across ALL queued issues —
   existing queue + new additions):
   - Any `breaking` → major
   - Any `feature`, `enhancement`, `gtm` → minor
   - Only `bug`, `dx`, `infra`, `user-request`, `P0`–`P3` → patch

5. Present:
   - Existing queue (if any) — labelled "Already queued"
   - New additions — labelled "Adding"
   - Combined total and projected release type
     Wait for user to say "proceed" or "go" before writing.

6. Write `.claude/issue-batch.json`, merging new issues into the existing queue:

   ```json
   {
     "queue": [<existing queue entries>, <new entries>],
     "pending": [<preserve existing>],
     "failed": [<preserve existing>],
     "planned_at": "<ISO timestamp>"
   }
   ```

   If no prior file exists, `pending` and `failed` default to `[]`.

7. Confirm: "Queue ready: N issues total (projected: patch/minor/major). Run /run-batch to start."
