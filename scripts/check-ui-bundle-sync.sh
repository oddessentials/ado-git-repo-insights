#!/usr/bin/env bash
# check-ui-bundle-sync.sh
#
# Verifies that extension/dist/ui/ and src/ado_git_repo_insights/ui_bundle/ are synchronized.
# These two locations must stay in sync because:
#   - extension/dist/ui/ is the compiled IIFE JS output from esbuild
#   - ui_bundle/ is a copy for Python pip package (symlinks don't work with setuptools wheels)
#
# Exit codes:
#   0 - Directories are in sync and committed
#   1 - Directories are out of sync or uncommitted changes detected
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_DIR="$REPO_ROOT/extension/dist/ui"
BUNDLE_DIR="$REPO_ROOT/src/ado_git_repo_insights/ui_bundle"

# Build UI first (produces IIFE-bundled JS)
echo "Building UI bundles..."
if [[ -f "$REPO_ROOT/extension/package.json" ]]; then
    (cd "$REPO_ROOT/extension" && npm run build:ui)
fi

# Validate directories exist
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "::error::Source directory not found: extension/dist/ui/"
    echo "Run 'npm run build:ui' in extension/ directory first"
    exit 1
fi

if [[ ! -d "$BUNDLE_DIR" ]]; then
    echo "::error::Bundle directory not found: src/ado_git_repo_insights/ui_bundle/"
    exit 1
fi

echo "Synchronizing UI bundle from extension/dist/ui..."
python "$REPO_ROOT/scripts/sync_ui_bundle.py" --source "$SOURCE_DIR" --bundle "$BUNDLE_DIR"

echo "Checking UI bundle synchronization..."
echo "  Source: extension/dist/ui/"
echo "  Bundle: src/ado_git_repo_insights/ui_bundle/"
echo ""

DIFF_OUTPUT=""
DIFF_EXIT=0

DIFF_OUTPUT=$(diff -ruN \
    --exclude='*.map' \
    --exclude='.DS_Store' \
    --exclude='*.swp' \
    --exclude='*~' \
    --exclude='*.bak' \
    "$SOURCE_DIR" "$BUNDLE_DIR" 2>&1) || DIFF_EXIT=$?

if [[ $DIFF_EXIT -ne 0 ]]; then
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
    echo "  Run: python scripts/sync_ui_bundle.py"
    echo ""
    echo "  Then commit both locations together."
    echo ""
    echo "  WHY: The Python pip package requires actual files (not symlinks) because"
    echo "  setuptools wheel builds don't preserve symlinks. See docs/PHASE7.md for details."
    echo ""
    echo "════════════════════════════════════════════════════════════════════════════════"
    exit 1
fi

if ! git -C "$REPO_ROOT" diff --quiet -- "$BUNDLE_DIR"; then
    echo "::error::UI bundle sync generated uncommitted changes."
    echo ""
    git -C "$REPO_ROOT" status --short -- "$BUNDLE_DIR"
    echo ""
    echo "Commit the synchronized UI bundle before merging."
    exit 1
fi

echo "✓ UI bundle is in sync with extension/dist/ui/"
exit 0
