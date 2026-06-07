#!/bin/sh
# Deterministic quality-gate entrypoint (entire-proof).
#
# git runs hooks from a single directory (core.hooksPath). `entire` re-injects
# its own wrappers into that directory on every agent turn
# (.claude/settings.json -> `entire hooks claude-code ...`), which breaks
# husky's basename-based dispatch and silently skips commitlint (commit-msg)
# and the full preflight (pre-push).
#
# This file is installed in the dev container OUTSIDE the workspace, owned by
# root and mode 0555 (see .devcontainer/Dockerfile), with core.hooksPath
# pointed at its directory. `entire` runs as the unprivileged `vscode` user and
# therefore cannot overwrite or unlink it — so the gates run on every git
# operation regardless of entire. Each hook name is a copy of this script; it
# delegates to the tracked .husky/<hook> (which invokes both the gate and
# `entire hooks git`, preserving entire's session capture). Stages with no
# tracked husky hook are treated as entire-capture-only.
hook=$(basename "$0")
repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ -f "$repo/.husky/$hook" ]; then
  exec sh "$repo/.husky/$hook" "$@"
fi
if command -v entire >/dev/null 2>&1; then
  exec entire hooks git "$hook" "$@"
fi
exit 0
