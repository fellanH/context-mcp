---
allowed-tools: Bash, Read, Write
description: >
  Review all batched issues, get human sign-off, determine the release type
  from issue labels, write CHANGELOG entries, and deploy via release.mjs.
---

# Release Batch

## Steps

1. **Discover committed issues**
   Run: `git log v$(node -p "require('./package.json').version")...HEAD --oneline`
   If empty, report "Nothing to release." and stop.

   Run: `git log v$(node -p "require('./package.json').version")...HEAD --format="%H %s"`
   Extract all issue numbers from commit messages matching `closes #N`.
   If no issue numbers found, report "No issues found in commits since last release." and stop.

2. **Build issue list**
   For each extracted issue number N:
   `gh issue view N --json number,title,labels`
   Build a structured list: number, title, labels.

   Also run: `git diff v$(node -p "require('./package.json').version")...HEAD -- packages/`
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
   Present the full review summary and the issue list from Step 2.
   Wait for the user to explicitly say "approve" or "lgtm" before proceeding.
   If the user requests changes, stop here and let them make corrections.

5. **Determine release type**
   From all issue labels from Step 2, apply highest-wins rule:
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

8. **Confirm**
   Report: "Released vX.Y.Z with N issues."
