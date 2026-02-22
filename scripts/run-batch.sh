#!/bin/bash
set -euo pipefail

CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BATCH_FILE="$CLAUDE_PROJECT_DIR/.claude/issue-batch.json"
CMD_FILE="$CLAUDE_PROJECT_DIR/.claude/commands/work-issue.md"
LOG_DIR="$CLAUDE_PROJECT_DIR/.claude/batch-logs"
LOCK_DIR="$CLAUDE_PROJECT_DIR/.claude/batch.lock"
MAX_TURNS="${MAX_TURNS:-40}"
ISSUE_TIMEOUT="${ISSUE_TIMEOUT:-1800}"

mkdir -p "$LOG_DIR"

# Lock: prevent concurrent runs (mkdir is atomic on POSIX)
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another batch is already running. Remove $LOCK_DIR to force." >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [ ! -f "$BATCH_FILE" ]; then
  echo "No issue-batch.json found. Run /plan-batch first." >&2
  exit 1
fi

QUEUE_LEN=$(jq '(.queue // []) | length' "$BATCH_FILE")
if [ "$QUEUE_LEN" -eq 0 ]; then
  echo "Queue is empty. Run /plan-batch first." >&2
  exit 1
fi

# TOTAL counts queue + already processed — correct counter on resume
TOTAL=$(jq '((.queue // []) + (.pending // []) + (.failed // [])) | length' "$BATCH_FILE")

echo "Starting batch: $QUEUE_LEN to process ($TOTAL total)"
echo ""

# Stamp started_at
TMP=$(jq --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.started_at = $t' "$BATCH_FILE")
echo "$TMP" > "$BATCH_FILE"

while true; do
  QUEUE_LEN=$(jq '(.queue // []) | length' "$BATCH_FILE")
  [ "$QUEUE_LEN" -eq 0 ] && break

  ISSUE_NUM=$(jq -r '.queue[0].number' "$BATCH_FILE")
  ISSUE_TITLE=$(jq -r '.queue[0].title' "$BATCH_FILE")
  ENTRY=$(jq '.queue[0]' "$BATCH_FILE")
  SNAPSHOT=$(cat "$BATCH_FILE")

  DONE=$((TOTAL - QUEUE_LEN + 1))
  echo "[$DONE/$TOTAL] #$ISSUE_NUM: $ISSUE_TITLE"

  LOG_FILE="$LOG_DIR/issue-$ISSUE_NUM.log"

  PROMPT=$(awk '/^---$/{n++; if(n==2){found=1; next}} found{print}' "$CMD_FILE" \
    | sed "s/\\\$ARGUMENTS/$ISSUE_NUM/g")

  set +e
  # Run with per-issue timeout via background + timer process
  env -u CLAUDECODE claude -p "$PROMPT" \
    --allowedTools "Bash,Read,Edit,Write,Glob,Grep,TaskCreate,TaskUpdate,TaskList" \
    --output-format json \
    --max-turns "$MAX_TURNS" \
    > "$LOG_FILE" 2>&1 &
  CLAUDE_PID=$!
  ( sleep "$ISSUE_TIMEOUT" && kill -TERM "$CLAUDE_PID" 2>/dev/null && sleep 5 && kill -KILL "$CLAUDE_PID" 2>/dev/null ) &
  TIMER_PID=$!
  wait "$CLAUDE_PID"
  EXIT_CODE=$?
  kill "$TIMER_PID" 2>/dev/null || true
  wait "$TIMER_PID" 2>/dev/null || true
  set -e

  if [ $EXIT_CODE -eq 0 ]; then
    echo "  ✓ Done — $LOG_FILE"
    CURRENT=$(cat "$BATCH_FILE")
    ALREADY=$(echo "$CURRENT" | jq --argjson num "$ISSUE_NUM" \
      '[.pending[] | select(.number == $num)] | length')
    if [ "$ALREADY" -gt 0 ]; then
      # Subprocess wrote to pending — use CURRENT pending/failed but SNAPSHOT queue.
      # Never trust CURRENT.queue: the subprocess may have removed itself from the
      # queue, which would cause .queue[1:] to skip the next issue entirely.
      TMP=$(jq -n \
        --argjson snap "$SNAPSHOT" \
        --argjson curr "$CURRENT" \
        '$snap | .queue = (.queue[1:]) | .pending = $curr.pending | .failed = $curr.failed')
    else
      TMP=$(echo "$SNAPSHOT" | jq --argjson e "$ENTRY" \
        '.queue = .queue[1:] | .pending += [$e]')
    fi
  else
    if [ $EXIT_CODE -eq 143 ] || [ $EXIT_CODE -eq 137 ]; then
      TIMEOUT_MSG=" (timed out after ${ISSUE_TIMEOUT}s)"
    else
      TIMEOUT_MSG=""
    fi
    echo "  ✗ Failed (exit $EXIT_CODE)${TIMEOUT_MSG} — $LOG_FILE"
    ERR=$(jq -r '.result // empty' "$LOG_FILE" 2>/dev/null | head -c 200 | tr '\n' ' ')
    [ -z "$ERR" ] && ERR="exit $EXIT_CODE${TIMEOUT_MSG}"
    TMP=$(echo "$SNAPSHOT" | jq --argjson e "$ENTRY" --arg err "$ERR" \
      '.queue = .queue[1:] | .failed += [$e + {error: $err}]')
  fi
  echo "$TMP" > "$BATCH_FILE"
done

# Stamp completed_at
TMP=$(jq --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.completed_at = $t' "$BATCH_FILE")
echo "$TMP" > "$BATCH_FILE"

PENDING=$(jq '(.pending // []) | length' "$BATCH_FILE")
FAILED=$(jq '(.failed // []) | length' "$BATCH_FILE")
echo ""
echo "Batch complete: $PENDING done, $FAILED failed"
jq -r '.pending[] | "  ✓ #\(.number): \(.title)" + (if .commit then " (\(.commit[0:8]))" else "" end)' "$BATCH_FILE"
[ "$FAILED" -gt 0 ] && jq -r '.failed[] | "  ✗ #\(.number): \(.title) — \(.error)"' "$BATCH_FILE"
echo ""
echo "Run /release-batch to review and ship."
