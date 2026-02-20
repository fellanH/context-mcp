Walk through the full release workflow for context-vault. Guide the user through each phase interactively — wait for confirmation at every checkpoint. Do NOT auto-run destructive or publishing commands.

## Phase 1: Pre-Release Checks

1. Run `npm test` and confirm all tests pass. If any fail, stop and help fix them before proceeding.
2. Run `git diff --stat` and `git log --oneline -10` to review recent changes. Call out any security-sensitive diffs (credentials, auth logic, permission changes).
3. Read `CHANGELOG.md` and verify it has a section for the new version. If missing, stop and ask the user to update it (or offer to draft the entry based on recent commits).

**Stop and confirm** with the user that all pre-release checks look good before proceeding.

## Phase 2: Version Bump

Present two options to the user:

- **Option A (recommended):** `npm run release` — handles version bumps across packages, changelog verification, commit, tag, and push automatically.
- **Option B (manual):** Bump versions individually in these files:
  - `package.json` (root)
  - `packages/core/package.json`
  - `packages/local/package.json`
  - `packages/extension/manifest.json`
  - `package-lock.json` (run `npm install` to regenerate)
  - Note: `packages/hosted/package.json` is versioned separately (0.x) — do NOT bump it with the main release.

**Stop and confirm** which option the user wants before executing anything.

## Phase 3: After Push

Once the version is tagged and pushed, verify the pipeline:

1. Run `npm view context-vault version` — confirm it shows the new version (may take up to 60 seconds for registry propagation).
2. Run `gh run list --limit 5` — confirm CI pipeline is green.
3. Check that the GitHub release was auto-created from the tag (do NOT run `gh release create` manually — it will 422 since the workflow already creates it).
4. Confirm Chrome extension publish triggered (only fires on tag push).

**Stop and report** status of all checks to the user.

## Phase 4: Post-Deploy Verification

Guide the user through final verification:

1. `npm cache clean --force` (registry can lag ~60s after publish)
2. `npm install -g context-vault@<version>` — install the new version globally
3. `context-vault --version` — confirm it prints the new version
4. Remind the user to restart their Claude session so the new MCP server is picked up
5. Run `context_status` MCP tool to verify the correct schema version is reported

**Stop and confirm** everything is green. If any step fails, help diagnose the issue.

## Phase 5: Wrap Up

- Update `BACKLOG.md` if the release closes any items.
- Save a session context entry: `save_context` with kind `release`, tags `context-vault, release`, summarizing what shipped in this version.
