#!/bin/bash
# CI Guard Validation Script
# Ensures critical CI configuration is not accidentally removed or bypassed.
#
# Guards:
# 1. packageManager field must exist in root package.json
# 2. Workflows must use .github/actions/setup-pnpm (not pnpm/action-setup directly)

set -euo pipefail

ERRORS=0

echo "Validating CI guards..."

# Guard 1: packageManager field in root package.json
echo ""
echo "Guard 1: Checking packageManager field..."
if ! grep -q '"packageManager"' package.json; then
  echo "::error::Missing 'packageManager' field in root package.json"
  echo "  The packageManager field is required for deterministic pnpm version resolution."
  echo "  Add: \"packageManager\": \"pnpm@9.15.0\" to package.json"
  ERRORS=$((ERRORS + 1))
else
  PKG_MANAGER=$(grep '"packageManager"' package.json | head -1)
  echo "[OK] packageManager field found: $PKG_MANAGER"
fi

# Guard 2: No direct pnpm/action-setup in workflows (only via composite action)
echo ""
echo "Guard 2: Checking for direct pnpm/action-setup usage..."
DIRECT_USAGE=$(grep -rH "uses: pnpm/action-setup" .github/workflows/ 2>/dev/null || true)
if [[ -n "$DIRECT_USAGE" ]]; then
  echo "::error::Direct pnpm/action-setup usage found in workflows"
  echo "  All workflows must use .github/actions/setup-pnpm instead."
  echo "  This ensures consistent pnpm setup across all CI jobs."
  echo ""
  echo "  Found in:"
  echo "$DIRECT_USAGE" | while read -r line; do
    echo "    $line"
  done
  echo ""
  echo "  Fix: Replace 'uses: pnpm/action-setup@v4' with 'uses: ./.github/actions/setup-pnpm'"
  ERRORS=$((ERRORS + 1))
else
  echo "[OK] No direct pnpm/action-setup usage in workflows"
fi

# Summary
echo ""
echo "=========================================="
if [[ $ERRORS -gt 0 ]]; then
  echo "::error::$ERRORS CI guard(s) failed"
  echo "Fix the above issues before merging."
  exit 1
else
  echo "[OK] All CI guards passed"
fi
