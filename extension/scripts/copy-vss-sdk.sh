#!/usr/bin/env bash
# copy-vss-sdk.sh
#
# Copies VSS SDK from node_modules to ui folder with line ending normalization.
# This prevents CRLF issues from the npm package breaking pre-commit hooks.
#
# Usage: ./scripts/copy-vss-sdk.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE="$EXTENSION_DIR/node_modules/vss-web-extension-sdk/lib/VSS.SDK.min.js"
TARGET="$EXTENSION_DIR/ui/VSS.SDK.min.js"

if [[ ! -f "$SOURCE" ]]; then
    echo "ERROR: VSS SDK not found at $SOURCE"
    echo "Run 'npm install' in the extension directory first."
    exit 1
fi

echo "Copying VSS SDK with line ending normalization..."

# Copy and normalize:
# 1. Convert CRLF to LF (sed removes carriage returns)
# 2. Ensure single trailing newline (printf trick)
sed 's/\r$//' "$SOURCE" > "$TARGET.tmp"
printf '%s\n' "$(cat "$TARGET.tmp")" > "$TARGET"
rm "$TARGET.tmp"

echo "✓ VSS SDK copied to $TARGET"
echo "  - CRLF converted to LF"
echo "  - Trailing newline ensured"
