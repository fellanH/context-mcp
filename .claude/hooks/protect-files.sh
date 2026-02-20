#!/usr/bin/env bash
# PreToolUse hook: block writes to protected files, warn on CHANGELOG
# Receives JSON on stdin; exit 2 + stderr = block, exit 0 + stdout = warn/allow

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Protected files — block all writes
PROTECTED=(
  "packages/core/src/index/db.js"
  "scripts/release.mjs"
  "NORTH-STAR.md"
)

for protected in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$protected" ]]; then
    echo "BLOCKED: $FILE_PATH is a protected file. Edit requires explicit user approval." >&2
    exit 2
  fi
done

# CHANGELOG — allow but remind about format
if [[ "$FILE_PATH" == *"CHANGELOG.md" ]]; then
  echo "Reminder: CHANGELOG entries must follow '## [X.Y.Z] — YYYY-MM-DD' format."
  exit 0
fi

exit 0
