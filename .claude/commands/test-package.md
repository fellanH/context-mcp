Run the test suite for a specific package in the monorepo: **$ARGUMENTS**

## Steps

1. **Validate the package exists.** Check that `packages/$ARGUMENTS` is a real directory in the monorepo. If it does not exist, list the available packages under `packages/` and ask the user to pick one.

2. **Run tests.** Execute `npm test -w packages/$ARGUMENTS` and capture the full output.

3. **Summarize results.** Parse the test output and present a clear summary:
   - Total tests run, passed, failed, skipped
   - Duration
   - If all tests pass, confirm success and stop

4. **If tests fail**, for each failing test:
   - Show the test name and the assertion/error message
   - Read the failing test file to understand what is being tested
   - Read the relevant source file if the failure points to a bug in implementation
   - Suggest a concrete fix — either the test expectation is wrong or the source code has a bug
   - Ask the user whether to apply the fix before proceeding
