# Resolve a Python interpreter that can import the project package, and
# expose it via HOOK_PYTHON for the husky-driven hook chain. Sources rather
# than executes — `.husky/pre-commit` and `.husky/pre-push` invoke this with
# `. ./.husky/_python_path.sh`. Failures `exit 2` the calling shell, which
# is the correct posture for a hook entry point: pre-commit / pre-push must
# abort with a clear setup message rather than silently fall back to a
# Python that lacks the project package.
#
# The invariant is *capability*, not path existence: hooks must run against
# an interpreter where `import ado_git_repo_insights` succeeds. This holds
# for both supported layouts:
#   - Local: `uv sync --extra dev` populates `.venv/`.
#   - CI:    `actions/setup-python` + `pip install -e .[dev]` against the
#            system interpreter (no `.venv/` is created).
# The earlier helper required `.venv/` to exist, which broke CI's
# `hook-entrypoint-test` job that simulates the husky chain in a
# venv-less environment. Probe-based selection mirrors the same fix
# Codex caught in `extension/tests/python-integration/python-subprocess.ts`.
#
# Candidate order:
#   1. Repo `.venv/<bin|Scripts>/python<.exe>` — canonical local layout.
#   2. System `python3`.
#   3. System `python`.
# For each, run `<candidate> -c "import ado_git_repo_insights"`. The first
# candidate whose probe succeeds is selected. If none pass, fail with both
# the local (`uv sync --extra dev`) and CI (`pip install -e .[dev]`)
# remediation paths in the message.
#
# Exports on success:
#   HOOK_PYTHON  Path or name of the resolved interpreter. Renamed from the
#                earlier `VENV_PYTHON` because the resolved interpreter may
#                be a system Python in CI's layout.
#   PATH         Prepended with `.venv/<bin|Scripts>` ONLY when option 1
#                wins. System fallbacks rely on the inherited PATH.

case "$(uname -s)" in
    Linux|Darwin)
        _hook_venv_bin=".venv/bin"
        _hook_python_name="python"
        ;;
    CYGWIN*|MINGW*|MSYS*)
        _hook_venv_bin=".venv/Scripts"
        _hook_python_name="python.exe"
        ;;
    *)
        echo "[hooks] Unsupported platform: $(uname -s)" >&2
        echo "[hooks] Repo hooks support Linux, macOS, and Git Bash/MSYS/Cygwin on Windows." >&2
        exit 2
        ;;
esac

_hook_resolved_python=""
_hook_resolved_venv_bin=""

# 1. Repo .venv interpreter.
if [ -x "$_hook_venv_bin/$_hook_python_name" ] \
        && "$_hook_venv_bin/$_hook_python_name" -c "import ado_git_repo_insights" >/dev/null 2>&1; then
    _hook_resolved_python="$_hook_venv_bin/$_hook_python_name"
    _hook_resolved_venv_bin="$_hook_venv_bin"
fi

# 2-3. System python3 / python.
if [ -z "$_hook_resolved_python" ]; then
    for _hook_candidate in python3 python; do
        _hook_candidate_path=$(command -v "$_hook_candidate" 2>/dev/null) || continue
        if "$_hook_candidate_path" -c "import ado_git_repo_insights" >/dev/null 2>&1; then
            _hook_resolved_python="$_hook_candidate_path"
            break
        fi
    done
    unset _hook_candidate _hook_candidate_path
fi

if [ -z "$_hook_resolved_python" ]; then
    echo "[hooks] No Python interpreter with project deps was found." >&2
    echo "[hooks] Locally: run \`uv sync --extra dev\`." >&2
    echo "[hooks] CI: ensure \`pip install -e .[dev]\` ran against the active interpreter." >&2
    echo "[hooks] See docs/development/setup.md for details." >&2
    exit 2
fi

HOOK_PYTHON="$_hook_resolved_python"
if [ -n "$_hook_resolved_venv_bin" ]; then
    PATH="$_hook_resolved_venv_bin:$PATH"
fi
export HOOK_PYTHON PATH

unset _hook_venv_bin _hook_python_name _hook_resolved_python _hook_resolved_venv_bin
