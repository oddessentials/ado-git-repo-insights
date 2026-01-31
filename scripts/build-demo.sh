#!/usr/bin/env bash
#
# Build demo dashboard for GitHub Pages deployment.
#
# This script:
# 1. Builds the extension UI bundles (pnpm build:ui)
# 2. Copies built assets to docs/
# 3. Injects LOCAL_DASHBOARD_MODE and DATASET_PATH configuration
# 4. Adds <base href="./"> for relative path resolution
# 5. Adds synthetic data disclaimer banner
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
echo "[1/4] Building extension UI bundles..."
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

# Step 2: Copy built assets to docs/
echo "[2/4] Copying built assets to docs/..."

# List of files to copy from extension/dist/ui/
UI_FILES=(
    "dashboard.js"
    "dataset-loader.js"
    "artifact-client.js"
    "error-types.js"
    "error-codes.js"
    "styles.css"
    "VSS.SDK.min.js"
)

# Also copy from ui/ source (HTML template and SDK)
SRC_FILES=(
    "index.html"
)

# Copy built JS/CSS files
for file in "${UI_FILES[@]}"; do
    if [ -f "${EXTENSION_DIR}/dist/ui/${file}" ]; then
        cp "${EXTENSION_DIR}/dist/ui/${file}" "${DOCS_DIR}/"
        echo "  Copied: dist/ui/${file}"
    elif [ -f "${EXTENSION_DIR}/ui/${file}" ]; then
        cp "${EXTENSION_DIR}/ui/${file}" "${DOCS_DIR}/"
        echo "  Copied: ui/${file}"
    else
        echo "  Warning: ${file} not found"
    fi
done

# Copy source HTML
for file in "${SRC_FILES[@]}"; do
    cp "${EXTENSION_DIR}/ui/${file}" "${DOCS_DIR}/"
    echo "  Copied: ui/${file}"
done

echo ""

# Step 3: Inject local mode configuration into index.html
echo "[3/4] Injecting local mode configuration..."

# Use separate Python script for cross-platform compatibility
python "${SCRIPT_DIR}/inject-demo-config.py" "${DOCS_DIR}/index.html"

echo ""

# Step 4: Verify output
echo "[4/4] Verifying output..."

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

echo "=== Build Complete ==="
echo ""
echo "To preview locally:"
echo "  cd docs && python -m http.server 8080"
echo "  Open: http://localhost:8080"
echo ""
