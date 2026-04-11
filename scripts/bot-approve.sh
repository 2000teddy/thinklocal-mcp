#!/usr/bin/env bash
# Bot-Approve: approves a PR via the thinklocal-bot account.
# Usage: bash scripts/bot-approve.sh <pr-number>
#
# Requires GITHUB_BOT_TOKEN in .env (classic token for peppiseppiullmann-ci).
# Part of the compliance enforcement workflow (Branch Protection requires
# 1 approving review, this bot provides it after CI passes).
set -euo pipefail

PR_NUM="${1:?Usage: bot-approve.sh <pr-number>}"
ENV_FILE="${TLMCP_ENV_FILE:-$(git rev-parse --show-toplevel)/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env file not found at $ENV_FILE" >&2
  exit 1
fi

BOT_TOKEN=$(grep 'GITHUB_BOT_TOKEN' "$ENV_FILE" | cut -d= -f2)
if [ -z "$BOT_TOKEN" ]; then
  echo "ERROR: GITHUB_BOT_TOKEN not found in $ENV_FILE" >&2
  exit 1
fi

# Wait for CI to be green before approving
echo "Checking CI status for PR #$PR_NUM..."
for i in $(seq 1 30); do
  STATUS=$(GH_TOKEN="$BOT_TOKEN" gh pr checks "$PR_NUM" 2>&1 || true)
  if echo "$STATUS" | grep -q "CI	pass"; then
    echo "CI passed. Approving PR #$PR_NUM..."
    GH_TOKEN="$BOT_TOKEN" gh pr review "$PR_NUM" --approve \
      --body "✅ Bot-approved (peppiseppiullmann-ci). CI checks green."
    echo "PR #$PR_NUM approved by bot."
    exit 0
  fi
  if echo "$STATUS" | grep -q "fail"; then
    echo "ERROR: CI failed — cannot approve." >&2
    echo "$STATUS" >&2
    exit 1
  fi
  echo "  CI still running... (attempt $i/30)"
  sleep 10
done

echo "ERROR: Timeout waiting for CI (5 minutes)." >&2
exit 1
