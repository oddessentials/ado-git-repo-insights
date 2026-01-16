#!/usr/bin/env bash
# check-version-unchanged.sh
#
# Fails if any semantic-release managed version fields differ from main branch.
# This prevents accidental manual version bumps that conflict with automated releases.
#
# Usage: ./scripts/check-version-unchanged.sh [base-branch]
# Default base-branch: origin/main

set -euo pipefail

BASE_BRANCH="${1:-origin/main}"

# Files and their jq paths for version extraction
declare -A VERSION_CHECKS=(
    ["VERSION"]="."
    ["package.json"]=".version"
    ["extension/vss-extension.json"]=".version"
    ["extension/tasks/extract-prs/task.json"]='.version | "\(.Major).\(.Minor).\(.Patch)"'
)

echo "Checking version fields against ${BASE_BRANCH}..."
echo ""

FAILED=0

for file in "${!VERSION_CHECKS[@]}"; do
    if [[ ! -f "$file" ]]; then
        echo "⚠️  $file not found, skipping"
        continue
    fi

    JQ_PATH="${VERSION_CHECKS[$file]}"

    # Get current version
    if [[ "$file" == "VERSION" ]]; then
        CURRENT_VERSION=$(cat "$file" | tr -d '[:space:]')
    else
        CURRENT_VERSION=$(jq -r "$JQ_PATH" "$file")
    fi

    # Get base branch version
    if [[ "$file" == "VERSION" ]]; then
        BASE_VERSION=$(git show "${BASE_BRANCH}:${file}" 2>/dev/null | tr -d '[:space:]' || echo "")
    else
        BASE_VERSION=$(git show "${BASE_BRANCH}:${file}" 2>/dev/null | jq -r "$JQ_PATH" || echo "")
    fi

    if [[ -z "$BASE_VERSION" ]]; then
        echo "⚠️  $file not in ${BASE_BRANCH}, skipping"
        continue
    fi

    if [[ "$CURRENT_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ $file: version changed ($BASE_VERSION → $CURRENT_VERSION)"
        echo "   Manual version bumps are not allowed. semantic-release handles versioning."
        FAILED=1
    else
        echo "✓  $file: $CURRENT_VERSION (unchanged)"
    fi
done

echo ""

if [[ $FAILED -eq 1 ]]; then
    echo "ERROR: Version fields were manually modified."
    echo ""
    echo "These files are managed by semantic-release and should not be changed manually:"
    echo "  - VERSION"
    echo "  - package.json"
    echo "  - extension/vss-extension.json"
    echo "  - extension/tasks/extract-prs/task.json"
    echo ""
    echo "To fix: revert the version changes and let semantic-release handle versioning."
    exit 1
fi

echo "All version fields unchanged. ✓"
