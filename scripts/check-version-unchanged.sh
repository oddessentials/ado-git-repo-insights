#!/usr/bin/env bash
# check-version-unchanged.sh
#
# Fails if any semantic-release managed version fields differ from main branch.
# This prevents accidental manual version bumps that conflict with automated releases.
#
# Bypass: Add 'VERSION-BUMP-APPROVED' to the PR description to allow intentional
# version changes (e.g., marketplace recovery baselines). Direct pushes to main
# with version changes are NEVER allowed, even with the marker.
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

# ---------------------------------------------------------------------------
# PR approval bypass (follows SUPPRESSION-INCREASE-APPROVED pattern)
# ---------------------------------------------------------------------------

check_pr_approval() {
    local event_path="${GITHUB_EVENT_PATH:-}"
    if [[ -z "$event_path" ]]; then
        return 1
    fi

    if [[ ! -f "$event_path" ]]; then
        echo "Warning: GITHUB_EVENT_PATH is not a valid file: $event_path" >&2
        return 1
    fi

    # SECURITY: Check file size to prevent resource exhaustion (1 MB limit)
    local file_size
    file_size=$(stat -c%s "$event_path" 2>/dev/null || stat -f%z "$event_path" 2>/dev/null || echo 0)
    if (( file_size > 1048576 )); then
        echo "Warning: Event file too large: $file_size bytes" >&2
        return 1
    fi

    # Extract PR body and check for marker
    local pr_body
    pr_body=$(jq -r '.pull_request.body // ""' "$event_path" 2>/dev/null || echo "")
    if [[ "$pr_body" == *"VERSION-BUMP-APPROVED"* ]]; then
        return 0
    fi

    return 1
}

is_direct_push_to_main() {
    local event_name="${GITHUB_EVENT_NAME:-}"
    local ref="${GITHUB_REF:-}"
    [[ "$event_name" == "push" && ( "$ref" == "refs/heads/main" || "$ref" == "refs/heads/master" ) ]]
}

# ---------------------------------------------------------------------------
# Main version check
# ---------------------------------------------------------------------------

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
    # Direct pushes to main with version changes are NEVER allowed
    if is_direct_push_to_main; then
        echo "ERROR: Direct push to main with version changes is not allowed."
        echo "Version fields are managed exclusively by semantic-release."
        exit 1
    fi

    # Check for PR approval marker
    if check_pr_approval; then
        echo "Version bump approved via PR description marker (VERSION-BUMP-APPROVED)."
        echo "Proceeding with manual version changes."
        exit 0
    fi

    echo "ERROR: Version fields were manually modified."
    echo ""
    echo "These files are managed by semantic-release and should not be changed manually:"
    echo "  - VERSION"
    echo "  - package.json"
    echo "  - extension/vss-extension.json"
    echo "  - extension/tasks/extract-prs/task.json"
    echo ""
    echo "To fix: revert the version changes and let semantic-release handle versioning."
    echo "If this is intentional (e.g., marketplace recovery), add 'VERSION-BUMP-APPROVED'"
    echo "to the PR description."
    exit 1
fi

echo "All version fields unchanged. ✓"
