#!/usr/bin/env bash
# update-agent-context.sh
#
# Refresh the managed Spec Kit section in the coding agent's context file
# (e.g. CLAUDE.md, .github/copilot-instructions.md, AGENTS.md).
#
# Reads `context_file` and `context_markers.{start,end}` from the
# agent-context extension config:
#   .specify/extensions/agent-context/agent-context-config.yml
#
# Usage: update-agent-context.sh [plan_path]
#
# When `plan_path` is omitted, the script picks the most recently modified
# `specs/*/plan.md` if any exist, otherwise emits the section without a
# concrete plan path.

set -euo pipefail

PROJECT_ROOT="$(pwd)"
EXT_CONFIG="$PROJECT_ROOT/.specify/extensions/agent-context/agent-context-config.yml"
DEFAULT_START="<!-- SPECKIT START -->"
DEFAULT_END="<!-- SPECKIT END -->"

if [[ ! -f "$EXT_CONFIG" ]]; then
  echo "agent-context: $EXT_CONFIG not found; nothing to do." >&2
  exit 0
fi

# Locate a Python 3 interpreter with PyYAML available.
# Preference order:
#   1. $PROJECT_ROOT/.venv/bin/python   — the documented repo venv
#                                          (uv sync installs PyYAML per FR-003 +
#                                          FR-021 of PR #416; PyYAML is in the
#                                          dev extra of pyproject.toml)
#   2. `uv run --no-sync python`        — when uv is on PATH and a pyproject.toml
#                                          exists but .venv isn't created yet
#   3. system python3                   — fresh-clone fallback
# Whichever is chosen, PyYAML MUST import successfully; we preflight it below
# and exit non-zero with an actionable message if it fails. Replaces the
# previous silent exit-0 no-op when PyYAML was absent from the selected
# interpreter (the regression Codex flagged on PR #416).
_python_kind=""
if [[ -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
  _python_kind="venv"
elif command -v uv >/dev/null 2>&1 && [[ -f "$PROJECT_ROOT/pyproject.toml" ]]; then
  _python_kind="uv"
elif command -v python3 >/dev/null 2>&1; then
  _python_kind="system"
fi

if [[ -z "$_python_kind" ]]; then
  echo "agent-context: no Python 3 interpreter found (looked for .venv/bin/python, uv+pyproject.toml, python3); cannot update agent context." >&2
  exit 1
fi

# Dispatch the chosen interpreter case-by-case. All variable expansions stay
# fully quoted; no unquoted multi-word $_python expansion.
_run_python() {
  case "$_python_kind" in
    venv)   "$PROJECT_ROOT/.venv/bin/python" "$@" ;;
    uv)     uv run --no-sync python "$@" ;;
    system) python3 "$@" ;;
  esac
}

# Preflight: PyYAML must import on the selected interpreter. Without this,
# the heredoc parse below would catch ImportError, print a stderr hint, and
# bash would catch the non-zero exit and `exit 0` — a silent no-op that
# leaves the agent context stale.
if ! _run_python -c 'import yaml' >/dev/null 2>&1; then
  case "$_python_kind" in
    venv)
      echo "agent-context: .venv/bin/python is present but cannot import PyYAML." >&2
      echo "  Resolve: rerun 'uv sync --extra dev' to install dev dependencies." >&2
      ;;
    uv)
      echo "agent-context: 'uv run --no-sync python' cannot import PyYAML." >&2
      echo "  Resolve: rerun 'uv sync --extra dev' to refresh the resolved env." >&2
      ;;
    system)
      echo "agent-context: system python3 cannot import PyYAML." >&2
      echo "  Resolve: run 'uv sync --extra dev' (creates .venv with PyYAML), or 'pip install pyyaml' in the system interpreter." >&2
      ;;
  esac
  exit 1
fi

# Parse extension config once; emit three newline-separated fields:
# context_file, context_markers.start, context_markers.end
if ! _raw_opts="$(_run_python - "$EXT_CONFIG" <<'PY'
import sys
try:
    import yaml
except ImportError:
    print(
        "agent-context: PyYAML is required to parse extension config but is not available "
        "in the current Python environment.\n"
        "  To resolve: pip install pyyaml (or install it into the environment used by python3).\n"
        "  Context file will not be updated until PyYAML is importable.",
        file=sys.stderr,
    )
    sys.exit(2)
try:
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
except Exception as exc:
    print(
        f"agent-context: unable to parse {sys.argv[1]} ({exc}); cannot update context.",
        file=sys.stderr,
    )
    sys.exit(2)
if not isinstance(data, dict):
    data = {}
def get_str(obj, *keys):
    node = obj
    for k in keys:
        if isinstance(node, dict) and k in node:
            node = node[k]
        else:
            return ""
    return node if isinstance(node, str) else ""
print(get_str(data, "context_file"))
print(get_str(data, "context_markers", "start"))
print(get_str(data, "context_markers", "end"))
PY
)"; then
  echo "agent-context: skipping update (see above for details)." >&2
  exit 0
fi

_opts_lines=()
while IFS= read -r _line || [[ -n "$_line" ]]; do
  _opts_lines+=("$_line")
done < <(printf '%s\n' "$_raw_opts")
if (( ${#_opts_lines[@]} < 3 )); then
  echo "agent-context: malformed config parser output; expected 3 lines (context_file, marker_start, marker_end), got ${#_opts_lines[@]}; skipping update." >&2
  exit 0
fi
CONTEXT_FILE="${_opts_lines[0]}"
MARKER_START="${_opts_lines[1]}"
MARKER_END="${_opts_lines[2]}"

if [[ -z "$CONTEXT_FILE" ]]; then
  echo "agent-context: context_file not set in extension config; nothing to do." >&2
  exit 0
fi

# Reject absolute paths, backslash separators, and '..' path segments in context_file
if [[ "$CONTEXT_FILE" == /* ]] || [[ "$CONTEXT_FILE" =~ ^[A-Za-z]: ]]; then
  echo "agent-context: context_file must be a project-relative path; got '$CONTEXT_FILE'." >&2
  exit 1
fi
if [[ "$CONTEXT_FILE" == *\\* ]]; then
  echo "agent-context: context_file must not contain backslash separators; got '$CONTEXT_FILE'." >&2
  exit 1
fi
IFS='/' read -ra _cf_parts <<< "$CONTEXT_FILE"
for _seg in "${_cf_parts[@]}"; do
  if [[ "$_seg" == ".." ]]; then
    echo "agent-context: context_file must not contain '..' path segments; got '$CONTEXT_FILE'." >&2
    exit 1
  fi
done
unset _cf_parts _seg

[[ -z "$MARKER_START" ]] && MARKER_START="$DEFAULT_START"
[[ -z "$MARKER_END"   ]] && MARKER_END="$DEFAULT_END"

PLAN_PATH="${1:-}"
if [[ -z "$PLAN_PATH" ]]; then
  # Pick the most recently modified plan.md one level deep (specs/<feature>/plan.md).
  # Use find + sort by modification time to avoid ls/head fragility with
  # spaces in paths or SIGPIPE from pipefail.
  _plan_abs="$(_run_python - "$PROJECT_ROOT" <<'PY'
import sys, os
from pathlib import Path
specs = Path(sys.argv[1]) / "specs"
plans = sorted(
    specs.glob("*/plan.md"),
    key=lambda p: p.stat().st_mtime,
    reverse=True,
)
print(plans[0] if plans else "")
PY
)"
  if [[ -n "$_plan_abs" ]]; then
    PLAN_PATH="${_plan_abs#"$PROJECT_ROOT/"}"
  fi
fi

CTX_PATH="$PROJECT_ROOT/$CONTEXT_FILE"
mkdir -p "$(dirname "$CTX_PATH")"

# Build the managed section
TMP_SECTION="$(mktemp)"
trap 'rm -f "$TMP_SECTION"' EXIT
{
  echo "$MARKER_START"
  echo "For additional context about technologies to be used, project structure,"
  echo "shell commands, and other important information, read the current plan"
  if [[ -n "$PLAN_PATH" ]]; then
    echo "at $PLAN_PATH"
  fi
  echo "$MARKER_END"
} > "$TMP_SECTION"

_run_python - "$CTX_PATH" "$MARKER_START" "$MARKER_END" "$TMP_SECTION" <<'PY'
import sys, os
ctx_path, start, end, section_path = sys.argv[1:5]
with open(section_path, "r", encoding="utf-8") as fh:
    section = fh.read().rstrip("\n") + "\n"

if os.path.exists(ctx_path):
    with open(ctx_path, "r", encoding="utf-8-sig") as fh:
        content = fh.read()
    s = content.find(start)
    e = content.find(end, s if s != -1 else 0)
    if s != -1 and e != -1 and e > s:
        end_of_marker = e + len(end)
        if end_of_marker < len(content) and content[end_of_marker] == "\r":
            end_of_marker += 1
        if end_of_marker < len(content) and content[end_of_marker] == "\n":
            end_of_marker += 1
        new_content = content[:s] + section + content[end_of_marker:]
    elif s != -1:
        new_content = content[:s] + section
    elif e != -1:
        end_of_marker = e + len(end)
        if end_of_marker < len(content) and content[end_of_marker] == "\r":
            end_of_marker += 1
        if end_of_marker < len(content) and content[end_of_marker] == "\n":
            end_of_marker += 1
        new_content = section + content[end_of_marker:]
    else:
        if content and not content.endswith("\n"):
            content += "\n"
        new_content = (content + "\n" + section) if content else section
else:
    new_content = section

new_content = new_content.replace("\r\n", "\n").replace("\r", "\n")
with open(ctx_path, "wb") as fh:
    fh.write(new_content.encode("utf-8"))
PY

echo "agent-context: updated $CONTEXT_FILE"
