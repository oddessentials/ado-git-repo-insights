#!/usr/bin/env bash
#
# Build demo dashboard for GitHub Pages deployment.
#
# This script:
# 1. Builds the extension UI bundles (pnpm build:ui)
# 2. Publishes the docs demo shell and built assets from a canonical source
# 4. Regenerates the canonical enterprise demo dataset and promotes it to docs/data
# 5. Verifies the published demo surface
#
# Usage:
#     ./scripts/build-demo.sh
#
# Requirements:
#     - pnpm 9.15.0 (via corepack)
#     - Node.js 22
#     - Extension dependencies installed (pnpm install in extension/)
#

set -euo pipefail

# Get script and repo root directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTENSION_DIR="${REPO_ROOT}/extension"
DOCS_DIR="${REPO_ROOT}/docs"

echo "=== Building Demo Dashboard ==="
echo "Repository root: ${REPO_ROOT}"
echo ""

# Step 1: Build extension UI
echo "[1/5] Building extension UI bundles..."
cd "${EXTENSION_DIR}"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "  Installing dependencies..."
    pnpm install --frozen-lockfile
fi

# Build UI bundles (IIFE format)
pnpm run build:ui

echo "  Build complete."
echo ""

# Step 2: Publish docs surface from built extension assets
echo "[2/5] Publishing demo shell and assets..."
python "${SCRIPT_DIR}/publish-demo-surface.py" --source "${EXTENSION_DIR}/dist/ui" --docs-dir "${DOCS_DIR}"

echo ""

# Step 3: Build canonical enterprise demo data and promote to docs/data
echo "[3/5] Building canonical enterprise demo dataset..."
python "${SCRIPT_DIR}/build-demo-dataset.py"

echo ""

# Step 4: Verify output
echo "[4/5] Verifying output..."

# Check required files exist
REQUIRED_FILES=(
    "index.html"
    "dashboard.js"
    "dataset-loader.js"
    "artifact-client.js"
    "error-types.js"
    "styles.css"
    "VSS.SDK.min.js"
    "data/dataset-manifest.json"
    "data/aggregates/dimensions.json"
)

MISSING=0
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "${DOCS_DIR}/${file}" ]; then
        echo "  ✓ ${file}"
    else
        echo "  ✗ ${file} MISSING"
        MISSING=$((MISSING + 1))
    fi
done

# Count weekly rollups
ROLLUP_COUNT=$(find "${DOCS_DIR}/data/aggregates/weekly_rollups" -name "*.json" 2>/dev/null | wc -l)
echo "  ✓ Weekly rollups: ${ROLLUP_COUNT} files"

# Count distributions
DIST_COUNT=$(find "${DOCS_DIR}/data/aggregates/distributions" -name "*.json" 2>/dev/null | wc -l)
echo "  ✓ Distributions: ${DIST_COUNT} files"

# Check docs/ size
DOCS_SIZE=$(du -sh "${DOCS_DIR}" | cut -f1)
echo "  ✓ Total size: ${DOCS_SIZE}"

echo ""

if [ $MISSING -gt 0 ]; then
    echo "ERROR: ${MISSING} required files are missing!"
    exit 1
fi

echo "[5/5] Demo surface published successfully."

echo "=== Build Complete ==="
echo ""
echo "To preview locally:"
echo "  cd docs && python -m http.server 8080"
echo "  Open: http://localhost:8080"
echo ""
