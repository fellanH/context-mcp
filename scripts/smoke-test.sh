#!/usr/bin/env bash
# smoke-test.sh — Validate production endpoints are healthy.
#
# Usage:
#   bash scripts/smoke-test.sh [BASE_URL]
#
# BASE_URL defaults to https://app.context-vault.com
# Exits 1 if any check fails.

set -euo pipefail

BASE_URL="${1:-https://app.context-vault.com}"
FAILURES=0

check() {
  local label="$1"
  local url="$2"
  local expect_content_type="${3:-}"

  local http_code
  http_code=$(curl -s -o /tmp/smoke-body -w "%{http_code}" "$url")

  if [[ "$http_code" != "200" ]]; then
    echo "FAIL [$label] $url — HTTP $http_code"
    FAILURES=$((FAILURES + 1))
    return
  fi

  if [[ -n "$expect_content_type" ]]; then
    local ct
    ct=$(curl -s -I "$url" | tr -d '\r' | grep -i '^content-type:' | cut -d' ' -f2- | cut -d';' -f1 | xargs)
    if [[ "$ct" != *"$expect_content_type"* ]]; then
      echo "FAIL [$label] $url — expected Content-Type containing '$expect_content_type', got '$ct'"
      FAILURES=$((FAILURES + 1))
      return
    fi
  fi

  echo "OK   [$label] $url"
}

echo "Smoke-testing $BASE_URL"
echo "---"

check "root HTML"    "$BASE_URL/"                            "text/html"
check "openapi.json" "$BASE_URL/api/vault/openapi.json"     "application/json"
check "privacy page" "$BASE_URL/privacy"                    "text/html"

echo "---"
if [[ "$FAILURES" -gt 0 ]]; then
  echo "FAILED — $FAILURES check(s) did not pass."
  exit 1
fi

echo "All checks passed."
exit 0
