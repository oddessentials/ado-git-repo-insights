#!/usr/bin/env bash
# check-ui-bundle-sync.sh
#
# Verifies that extension/ui/ and src/ado_git_repo_insights/ui_bundle/ are synchronized.
# These two locations must stay in sync because:
#   - extension/ui/ is the source of truth for the Azure DevOps extension
#   - ui_bundle/ is a copy for Python pip package (symlinks don't work with setuptools wheels)
#
# Exit codes:
#   0 - Directories are in sync
#   1 - Directories are out of sync (diff shown in patch format)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_DIR="$REPO_ROOT/extension/ui"
BUNDLE_DIR="$REPO_ROOT/src/ado_git_repo_insights/ui_bundle"

# Validate directories exist
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "::error::Source directory not found: extension/ui/"
    exit 1
fi

if [[ ! -d "$BUNDLE_DIR" ]]; then
    echo "::error::Bundle directory not found: src/ado_git_repo_insights/ui_bundle/"
    exit 1
fi

echo "Checking UI bundle synchronization..."
echo "  Source: extension/ui/"
echo "  Bundle: src/ado_git_repo_insights/ui_bundle/"
echo ""

# Use diff with exclude patterns for ignored files
# -r: recursive
# -u: unified format (patch-like)
# -N: treat absent files as empty
# --exclude: patterns to ignore
DIFF_OUTPUT=""
DIFF_EXIT=0

DIFF_OUTPUT=$(diff -ruN \
    --exclude='*.map' \
    --exclude='.DS_Store' \
    --exclude='*.swp' \
    --exclude='*~' \
    --exclude='*.bak' \
    "$SOURCE_DIR" "$BUNDLE_DIR" 2>&1) || DIFF_EXIT=$?

if [[ $DIFF_EXIT -eq 0 ]]; then
    echo "✓ UI bundle is in sync with extension/ui/"
    exit 0
fi

# Directories are out of sync - show helpful error
echo "::error::UI bundle is OUT OF SYNC with extension/ui/"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo "DIFF (patch format):"
echo "════════════════════════════════════════════════════════════════════════════════"
echo "$DIFF_OUTPUT"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo "HOW TO FIX:"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "  After modifying files in extension/ui/, sync to ui_bundle:"
echo ""
echo "    cp -r extension/ui/* src/ado_git_repo_insights/ui_bundle/"
echo ""
echo "  Then commit both locations together."
echo ""
echo "  WHY: The Python pip package requires actual files (not symlinks) because"
echo "  setuptools wheel builds don't preserve symlinks. See docs/PHASE7.md for details."
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
exit 1
