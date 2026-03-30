#!/usr/bin/env bash
#
# Build demo dashboard for GitHub Pages deployment.
#
# This script:
# 1. Ensures extension dependencies are installed
# 2. Runs the canonical committed-demo builder
# 3. Verifies the published demo surface
#
# Usage:
#     ./scripts/build-demo.sh
#
# Requirements:
#     - pnpm 9.15.0 (via corepack)
#     - Node.js 22
#

set -euo pipefail

# Get script and repo root directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTENSION_DIR="${REPO_ROOT}/extension"
DOCS_DIR="${REPO_ROOT}/docs"
BASELINE_PYTHON=()

resolve_baseline_python() {
    if command -v py >/dev/null 2>&1; then
        if py -3.10 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 10) else 1)" >/dev/null 2>&1; then
            BASELINE_PYTHON=(py -3.10)
            return 0
        fi
    fi

    for candidate in python3.10 python3 python; do
        if command -v "${candidate}" >/dev/null 2>&1; then
            if "${candidate}" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 10) else 1)" >/dev/null 2>&1; then
                BASELINE_PYTHON=("${candidate}")
                return 0
            fi
        fi
    done

    return 1
}

echo "=== Building Demo Dashboard ==="
echo "Repository root: ${REPO_ROOT}"
echo ""

if ! resolve_baseline_python; then
    echo "ERROR: Python 3.10 is required for canonical committed-demo generation."
    echo "Install or expose Python 3.10, then rerun scripts/build-demo.sh."
    exit 1
fi

# Step 1: Prepare extension dependencies
echo "[1/3] Preparing extension dependencies..."
cd "${EXTENSION_DIR}"

# Always reconcile extension dependencies with the lockfile so local stale
# installs cannot skew the canonical published demo surface.
echo "  Syncing extension dependencies to pnpm-lock.yaml..."
pnpm install --frozen-lockfile

# Step 2: Build canonical enterprise demo data and docs surface
echo "[2/3] Building canonical enterprise demo dataset and surface..."
"${BASELINE_PYTHON[@]}" "${SCRIPT_DIR}/build-demo-dataset.py"

echo ""

# Step 3: Verify output
echo "[3/3] Verifying output..."

# Check required files exist
REQUIRED_FILES=(
    "index.html"
    "dashboard.js"
    "dataset-loader.js"
    "artifact-client.js"
    "error-types.js"
    "styles.css"
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

echo "[3/3] Demo surface published successfully."

echo "=== Build Complete ==="
echo ""
echo "To preview locally:"
echo "  cd docs && python -m http.server 8080"
echo "  Open: http://localhost:8080"
echo ""
