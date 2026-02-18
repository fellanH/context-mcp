#!/usr/bin/env bash
# smoke-test.sh — Post-deploy verification for context-vault hosted server.
#
# Usage: bash scripts/smoke-test.sh [BASE_URL]
#   Default: https://www.context-vault.com

set -euo pipefail

BASE="${1:-https://www.context-vault.com}"
PASS=0
FAIL=0

check() {
  local desc="$1" expected_status="$2" url="$3"
  shift 3
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@" "$url")
  if [ "$status" = "$expected_status" ]; then
    echo "  PASS: $desc (HTTP $status)"
    ((PASS++))
  else
    echo "  FAIL: $desc — expected $expected_status, got $status"
    ((FAIL++))
  fi
}

echo "Smoke testing: $BASE"
echo ""

# ─── Basic Endpoints ──────────────────────────────────────────────────────────

# Health check
check "GET /health returns 200" "200" "$BASE/health"

# Health response shape
HEALTH=$(curl -s --max-time 5 "$BASE/health")
if echo "$HEALTH" | grep -q '"status"'; then
  echo "  PASS: /health has status field"
  ((PASS++))
else
  echo "  FAIL: /health missing status field"
  ((FAIL++))
fi

# Version field in health response
if echo "$HEALTH" | grep -q '"version"'; then
  echo "  PASS: /health has version field"
  ((PASS++))
else
  echo "  FAIL: /health missing version field"
  ((FAIL++))
fi

# Unauthenticated MCP returns 401
check "POST /mcp without auth returns 401" "401" "$BASE/mcp" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# Registration without email returns 400
check "POST /api/register without email returns 400" "400" "$BASE/api/register" \
  -X POST -H "Content-Type: application/json" -d '{}'

# Management API without auth returns 401
check "GET /api/keys without auth returns 401" "401" "$BASE/api/keys"

# 404 for unknown routes
check "GET /unknown returns 404" "404" "$BASE/unknown"

# ─── Security Checks ─────────────────────────────────────────────────────────

# Security headers: X-Content-Type-Options: nosniff
HEADERS=$(curl -s -I --max-time 5 "$BASE/health")
if echo "$HEADERS" | grep -qi "x-content-type-options: nosniff"; then
  echo "  PASS: X-Content-Type-Options: nosniff present"
  ((PASS++))
else
  echo "  FAIL: X-Content-Type-Options: nosniff missing"
  ((FAIL++))
fi

# CORS check: evil origin should not get Access-Control-Allow-Origin: *
CORS_HEADERS=$(curl -s -I --max-time 5 -H "Origin: https://evil.com" "$BASE/health")
if echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin: \*"; then
  echo "  FAIL: CORS allows wildcard origin in production"
  ((FAIL++))
else
  echo "  PASS: CORS does not allow wildcard origin"
  ((PASS++))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
