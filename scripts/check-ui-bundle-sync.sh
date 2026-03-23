#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if command -v py >/dev/null 2>&1 && py -3 -c "import sys" >/dev/null 2>&1; then
    exec py -3 scripts/manage_generated_artifacts.py verify --scope ui
elif command -v python3 >/dev/null 2>&1 && python3 -c "import sys" >/dev/null 2>&1; then
    exec python3 scripts/manage_generated_artifacts.py verify --scope ui
elif command -v python >/dev/null 2>&1 && python -c "import sys" >/dev/null 2>&1; then
    exec python scripts/manage_generated_artifacts.py verify --scope ui
else
    echo "Python is required to verify generated UI artifacts."
    exit 1
fi
