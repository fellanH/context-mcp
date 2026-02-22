#!/bin/bash
set -euo pipefail

BATCH_FILE="$CLAUDE_PROJECT_DIR/.claude/issue-batch.json"
CMD_FILE="$CLAUDE_PROJECT_DIR/.claude/commands/work-issue.md"
LOG_DIR="$CLAUDE_PROJECT_DIR/.claude/batch-logs"
MAX_TURNS="${MAX_TURNS:-40}"

mkdir -p "$LOG_DIR"

if [ ! -f "$BATCH_FILE" ]; then
  echo "No issue-batch.json found. Run /plan-batch first." >&2
  exit 1
fi

TOTAL=$(jq '(.queue // []) | length' "$BATCH_FILE")
if [ "$TOTAL" -eq 0 ]; then
  echo "Queue is empty. Run /plan-batch first." >&2
  exit 1
fi

echo "Starting batch: $TOTAL issues"
echo ""

DONE=0
while true; do
  QUEUE_LEN=$(jq '(.queue // []) | length' "$BATCH_FILE")
  [ "$QUEUE_LEN" -eq 0 ] && break

  ISSUE_NUM=$(jq -r '.queue[0].number' "$BATCH_FILE")
  ISSUE_TITLE=$(jq -r '.queue[0].title' "$BATCH_FILE")
  # Capture the entry and snapshot BEFORE running claude (subprocess may rewrite the file)
  ENTRY=$(jq '.queue[0]' "$BATCH_FILE")
  SNAPSHOT=$(cat "$BATCH_FILE")
  DONE=$((DONE + 1))
  echo "[$DONE/$TOTAL] #$ISSUE_NUM: $ISSUE_TITLE"

  LOG_FILE="$LOG_DIR/issue-$ISSUE_NUM.log"

  # Build prompt from work-issue command, substituting $ARGUMENTS with issue number
  PROMPT=$(awk '/^---$/{n++; if(n==2){found=1; next}} found{print}' "$CMD_FILE" \
    | sed "s/\\\$ARGUMENTS/$ISSUE_NUM/g")

  set +e
  env -u CLAUDECODE claude -p "$PROMPT" \
    --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
    --output-format json \
    --max-turns "$MAX_TURNS" \
    > "$LOG_FILE" 2>&1
  EXIT_CODE=$?
  set -e

  if [ $EXIT_CODE -eq 0 ]; then
    echo "  ✓ Done — $LOG_FILE"
    # Use post-run file (claude subprocess may have written commit SHA to pending).
    # Only remove from queue; trust the subprocess's pending write if present,
    # otherwise append the entry ourselves.
    CURRENT=$(cat "$BATCH_FILE")
    ALREADY=$(echo "$CURRENT" | jq --argjson num "$ISSUE_NUM" \
      '[.pending[] | select(.number == $num)] | length')
    if [ "$ALREADY" -gt 0 ]; then
      # Subprocess already wrote to pending — just remove from queue
      TMP=$(echo "$CURRENT" | jq '.queue = .queue[1:]')
    else
      # Subprocess didn't write pending — do it ourselves from snapshot
      TMP=$(echo "$SNAPSHOT" | jq --argjson e "$ENTRY" \
        '.queue = .queue[1:] | .pending += [$e]')
    fi
  else
    echo "  ✗ Failed (exit $EXIT_CODE) — $LOG_FILE"
    ERR=$(tail -5 "$LOG_FILE" | tr '\n' ' ')
    # Use snapshot to avoid clobbering subprocess partial writes
    TMP=$(echo "$SNAPSHOT" | jq --argjson e "$ENTRY" --arg err "$ERR" \
      '.queue = .queue[1:] | .failed += [$e + {error: $err}]')
  fi
  echo "$TMP" > "$BATCH_FILE"
done

PENDING=$(jq '(.pending // []) | length' "$BATCH_FILE")
FAILED=$(jq '(.failed // []) | length' "$BATCH_FILE")
echo ""
echo "Batch complete: $PENDING done, $FAILED failed"
[ "$FAILED" -gt 0 ] && jq -r '.failed[] | "  ✗ #\(.number): \(.title)"' "$BATCH_FILE"
echo ""
echo "Run /release-batch to review and ship."
