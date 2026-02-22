#!/bin/bash
# Runs after Edit|Write — async, does not block Claude

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for source files
if [[ "$FILE_PATH" != *.js && "$FILE_PATH" != *.mjs && "$FILE_PATH" != *.ts ]]; then
  exit 0
fi

RESULT=$(npm --prefix "$CLAUDE_PROJECT_DIR" test 2>&1)
EXIT_CODE=$?

CONSTANTS_RESULT=$(node "$CLAUDE_PROJECT_DIR/scripts/check-constants.js" 2>&1)
CONSTANTS_EXIT=$?

if [ $EXIT_CODE -eq 0 ] && [ $CONSTANTS_EXIT -eq 0 ]; then
  echo '{"systemMessage": "✓ Tests and constants check passed."}'
else
  MSG="Tests or constants check failed after editing $FILE_PATH."
  [ $EXIT_CODE -ne 0 ] && MSG="$MSG\nTest output:\n$RESULT"
  [ $CONSTANTS_EXIT -ne 0 ] && MSG="$MSG\nConstants issues:\n$CONSTANTS_RESULT"
  echo "{\"systemMessage\": \"$MSG\"}"
fi
