Search the entire monorepo for all occurrences of: **$ARGUMENTS**

This addresses a known gotcha: duplicate constants across packages — hardcoded strings exist in multiple files. Always grep for the value across the whole repo before assuming a single fix is enough.

## Steps

1. **Search.** Use Grep to find every occurrence of `$ARGUMENTS` across the repo, excluding `node_modules`, `.git`, `dist`, and `build` directories.

2. **Group by location.** Organize the results by package/directory:
   - `packages/core/`
   - `packages/local/`
   - `packages/hosted/`
   - `packages/app/`
   - `packages/marketing/`
   - `packages/extension/`
   - Root config files
   - Tests
   - Other locations

3. **Analyze consistency.** For each occurrence, show the file path, line number, and surrounding context. Then:
   - **Flag inconsistencies** — if the same logical constant appears with different values across packages, highlight the mismatch and which one looks correct.
   - **Flag missing occurrences** — if a value appears in most packages but is absent from one that would be expected to have it, call that out.
   - **Flag stale values** — if a value in one location looks outdated compared to others (e.g., an old version string), highlight it.

4. **Recommend.** If any inconsistencies are found, propose a concrete fix plan — which files to update and to what value. Ask the user for confirmation before making any changes.

If no issues are found, confirm that all occurrences are consistent and report the total count.
