#!/bin/bash
INPUT=$(cat)

# Prevent infinite loop: if already re-running due to a stop hook, allow stop
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active')
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

# Run tests
if ! npm --prefix "$CLAUDE_PROJECT_DIR" test > /dev/null 2>&1; then
  echo "Tests are failing. Fix before stopping." >&2
  exit 2
fi

# Run constants check
if ! node "$CLAUDE_PROJECT_DIR/scripts/check-constants.js" > /dev/null 2>&1; then
  echo "Constants check failing. Fix duplicates before stopping." >&2
  exit 2
fi

exit 0
