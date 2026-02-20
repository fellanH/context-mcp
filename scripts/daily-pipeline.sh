#!/usr/bin/env bash
# daily-pipeline.sh — Triage feedback and implement changes using Claude Code
#
# Three stages:
#   0. Collect — gather new feedback from vault
#   1. Triage  — group, dedupe, prioritize via claude --print
#   2. Implement — create branch, implement P0/P1 items via claude -p
#   3. Verify  — run tests, generate summary, mark feedback processed
#
# Usage: bash scripts/daily-pipeline.sh
# Env:   VAULT_DIR (default: ~/vault), PROJECT_DIR (default: script's repo root)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
VAULT_DIR="${VAULT_DIR:-$HOME/vault}"
FEEDBACK_DIR="$VAULT_DIR/events/feedbacks"
DATE="$(date +%Y-%m-%d)"
RUN_DIR="$PROJECT_DIR/.pipeline/runs/$DATE"

# ─── Setup ───────────────────────────────────────────────────────────────────

mkdir -p "$RUN_DIR"
exec > >(tee -a "$RUN_DIR/pipeline.log") 2>&1

echo "=== context-vault daily pipeline — $DATE ==="
echo "Project: $PROJECT_DIR"
echo "Vault:   $VAULT_DIR"
echo "Run dir: $RUN_DIR"
echo ""

# ─── Stage 0: Collect ───────────────────────────────────────────────────────

echo "--- Stage 0: Collect ---"

if [ ! -d "$FEEDBACK_DIR" ]; then
  echo "No feedback directory found at $FEEDBACK_DIR. Nothing to do."
  exit 0
fi

BUNDLE="$RUN_DIR/feedback-bundle.md"
: > "$BUNDLE"
COUNT=0

for f in "$FEEDBACK_DIR"/*.md; do
  [ -f "$f" ] || continue
  if grep -q "status: new" "$f" 2>/dev/null; then
    echo "---" >> "$BUNDLE"
    echo "# File: $(basename "$f")" >> "$BUNDLE"
    cat "$f" >> "$BUNDLE"
    echo "" >> "$BUNDLE"
    COUNT=$((COUNT + 1))
  fi
done

if [ "$COUNT" -eq 0 ]; then
  echo "No new feedback found. Exiting."
  exit 0
fi

echo "Collected $COUNT new feedback entries → $BUNDLE"
echo ""

# ─── Stage 1: Triage ────────────────────────────────────────────────────────

echo "--- Stage 1: Triage ---"

TRIAGE_REPORT="$RUN_DIR/triage-report.md"

claude --print -p "You are a development triage bot for context-vault (an MCP server, npm: context-vault).

Below is a bundle of user/agent feedback entries. Each has a type (bug/feature/improvement), severity, and description.

Your job:
1. Group duplicate or related feedback
2. Assign priority: P0 (critical bug), P1 (important), P2 (nice to have), P3 (backlog)
3. For each group, write a clear action item with:
   - Priority (P0-P3)
   - Type (bug/feature/improvement)
   - Summary (one line)
   - Details (what to do)
   - Affected files (if you can infer)

Output a structured markdown report. If nothing is actionable, say 'NO_ACTION' on the first line.

---

$(cat "$BUNDLE")" > "$TRIAGE_REPORT"

echo "Triage report → $TRIAGE_REPORT"

# Check if nothing actionable
if head -1 "$TRIAGE_REPORT" | grep -q "NO_ACTION"; then
  echo "No actionable feedback. Marking all as processed."
  for f in "$FEEDBACK_DIR"/*.md; do
    [ -f "$f" ] || continue
    if grep -q "status: new" "$f" 2>/dev/null; then
      sed -i '' 's/status: new/status: processed/' "$f"
    fi
  done
  exit 0
fi

echo ""

# ─── Stage 2: Implement ─────────────────────────────────────────────────────

echo "--- Stage 2: Implement ---"

cd "$PROJECT_DIR"

# Create pipeline branch from main
BRANCH="pipeline/$DATE"
git checkout main
git pull --ff-only origin main 2>/dev/null || true
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

echo "Branch: $BRANCH"

IMPLEMENT_LOG="$RUN_DIR/implement-log.txt"

claude -p "You are implementing changes for context-vault based on the triage report below.

Rules:
- Only implement P0 and P1 items
- Follow existing code patterns exactly (check src/server/tools.js, src/core/ for style)
- Run 'npm test' after changes to verify
- Make one commit per fix/feature with a descriptive message
- Do NOT modify package.json version
- Do NOT push to remote
- If a change is too risky or complex, skip it and note why

Triage report:
$(cat "$TRIAGE_REPORT")

The project is at: $PROJECT_DIR
Work on branch: $BRANCH" \
  --allowedTools "Edit,Write,Bash,Read,Glob,Grep" \
  > "$IMPLEMENT_LOG" 2>&1 || true

echo "Implementation log → $IMPLEMENT_LOG"
echo ""

# ─── Stage 3: Verify ────────────────────────────────────────────────────────

echo "--- Stage 3: Verify ---"

cd "$PROJECT_DIR"

# Run tests
TEST_RESULTS="$RUN_DIR/test-results.txt"
npm test > "$TEST_RESULTS" 2>&1 || true

TEST_STATUS="FAIL"
if grep -q "Tests.*passed" "$TEST_RESULTS" 2>/dev/null; then
  TEST_STATUS="PASS"
fi

echo "Tests: $TEST_STATUS → $TEST_RESULTS"

# Generate summary
SUMMARY="$RUN_DIR/summary.md"
COMMITS=$(git log main.."$BRANCH" --oneline 2>/dev/null || echo "(none)")
FILES_CHANGED=$(git diff main.."$BRANCH" --stat 2>/dev/null || echo "(none)")

cat > "$SUMMARY" << EOF
# Pipeline Run: $DATE

## Overview
- **Feedback entries:** $COUNT
- **Tests:** $TEST_STATUS
- **Branch:** $BRANCH
- **Commits:**
\`\`\`
$COMMITS
\`\`\`

## Files Changed
\`\`\`
$FILES_CHANGED
\`\`\`

## Triage Report
$(cat "$TRIAGE_REPORT")

## Next Steps
1. Review the branch: \`git diff main...$BRANCH\`
2. Run tests: \`npm test\`
3. If satisfied: \`git checkout main && git merge $BRANCH\`
4. If not: \`git branch -D $BRANCH\`
EOF

echo "Summary → $SUMMARY"

# Mark feedback as processed
for f in "$FEEDBACK_DIR"/*.md; do
  [ -f "$f" ] || continue
  if grep -q "status: new" "$f" 2>/dev/null; then
    sed -i '' 's/status: new/status: processed/' "$f"
  fi
done

echo "Marked $COUNT feedback entries as processed."

# Return to main
git checkout main 2>/dev/null || true

echo ""
echo "=== Pipeline complete ==="
echo "Review: git diff main...$BRANCH"
echo "Merge:  git checkout main && git merge $BRANCH"
echo "Delete: git branch -D $BRANCH"
