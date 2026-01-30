#!/usr/bin/env bash
# npm-command-guard: Enforce pnpm-only policy
# Scans workflows, scripts/, and package.json for disallowed npm ci/install commands
# This script lives in .github/scripts/ which is NOT in the search path, avoiding self-matching

set -euo pipefail

echo "Scanning for npm ci/install commands..."

# Search for actual npm commands in CI-relevant locations
# Allowlist: "npm install -g tfx-cli" (global tool, not project dependency)
# Exclusions:
#   - pnpm (obviously not npm)
#   - Comments (# ...)
#   - echo statements (logging)
#   - Job names (name: ...)
MATCHES=$(grep -rn --include="*.yml" --include="*.yaml" --include="*.json" --include="*.sh" \
  -E "(npm ci|npm install)" \
  .github/workflows/ package.json scripts/ 2>/dev/null \
  | grep -v "npm install -g tfx-cli" \
  | grep -v "pnpm" \
  | grep -v "# .*npm" \
  | grep -v "echo.*npm" \
  | grep -v "name:.*npm" \
  || true)

if [ -n "$MATCHES" ]; then
  echo "::error::Found npm ci/install commands (not allowlisted):"
  echo "$MATCHES"
  echo "::error::This repository uses pnpm exclusively. Replace with pnpm install --frozen-lockfile."
  exit 1
fi

echo "[OK] No npm ci/install commands found (except allowlisted tfx-cli)"
