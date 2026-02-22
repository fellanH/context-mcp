---
allowed-tools: Bash, Read, Write
description: >
  Review all batched issues, get human sign-off, determine the release type
  from issue labels, write CHANGELOG entries, and deploy via release.mjs.
---

# Release Batch

## Steps

1. **Load batch**
   Read `.claude/issue-batch.json`.
   If `pending` is empty, report "No issues in batch." and stop.

2. **Generate diff summary**
   Run: `git log v$(node -p "require('./package.json').version")...HEAD --oneline`
   Run: `git diff v$(node -p "require('./package.json').version")...HEAD -- packages/`
   Produce a structured summary: what changed, what files, which issues.

3. **AI self-review**
   For each change, evaluate against the criteria from the existing claude-code-review
   workflow (`.github/workflows/claude-code-review.yml`):
   - Logic errors and correctness
   - Security issues (injection, auth bypass, data exposure, hardcoded secrets)
   - Duplicate constants across packages
   - Missing test coverage
   - Scope creep beyond the issue

   Present findings clearly. Flag any blockers before asking for sign-off.

4. **Human sign-off**
   Present the full review summary and the list of batched issues.
   Wait for the user to explicitly say "approve" or "lgtm" before proceeding.
   If the user requests changes, stop here and let them make corrections.

5. **Determine release type**
   From all batched issue labels, apply highest-wins rule:
   - Any label is `breaking` → `major`
   - Any label is `feature` or `enhancement` or `gtm` → `minor`
   - All labels are `bug`, `dx`, `infra`, `user-request` → `patch`

   Confirm with user: "Release type: patch (based on labels: bug, dx). Confirm?"

6. **Write CHANGELOG entry**
   Read `CHANGELOG.md`.
   Determine new version: run `node -e "const v=require('./package.json').version; ..."` or derive from bump.
   Write a new section at the top:

   ```
   ## [X.Y.Z] — YYYY-MM-DD
   ### Fixed / Added / Changed
   - Issue #N: <title> (<commit sha short>)
   ```

7. **Release**
   Run: `node scripts/release.mjs <patch|minor|major>`
   The release script handles: version bump → tests → npm publish → git tag → push → GitHub Release.

8. **Clear batch**
   Write `{"queue":[],"pending":[],"failed":[]}` to `.claude/issue-batch.json`.

9. **Confirm**
   Report: "Released vX.Y.Z with N issues. Batch cleared."
