# Resolve the project virtualenv's Python interpreter for husky-driven hooks
# and prepend its bin directory to PATH so any subprocess that resolves bare
# `python` (notably pre-commit `language: system` hooks declared in
# `.pre-commit-config.yaml`) finds the canonical interpreter without the
# developer having to `source .venv/bin/activate` first.
#
# Sourced from `.husky/pre-commit` and `.husky/pre-push`; not executed
# directly. On exit-2 paths (missing venv, unsupported platform), `set -eu`
# in the calling script propagates the failure with a clear setup message
# BEFORE pre-commit ever spawns its `language: system` hooks — replacing the
# cryptic `Executable 'python' not found` failure mode.
#
# Exports:
#   VENV_PYTHON  Absolute path to the venv's python interpreter
#   PATH         Prepended with the venv's bin directory
#
# Platform contract:
#   Linux / Darwin (incl. WSL)        → ./.venv/bin
#   Git Bash / MSYS / Cygwin (Win)    → ./.venv/Scripts
# A WSL repo can contain a Windows-created `.venv/Scripts/`; we deliberately
# do NOT cross-fall-back, because routing Linux hooks to a Windows-side
# interpreter is exactly the platform skew this helper was written to
# eliminate.

case "$(uname -s)" in
    Linux|Darwin)
        _venv_bin=".venv/bin"
        _python_name="python"
        ;;
    CYGWIN*|MINGW*|MSYS*)
        _venv_bin=".venv/Scripts"
        _python_name="python.exe"
        ;;
    *)
        echo "[hooks] Unsupported platform: $(uname -s)" >&2
        echo "[hooks] Repo hooks support Linux, macOS, and Git Bash/MSYS/Cygwin on Windows." >&2
        exit 2
        ;;
esac

if [ ! -x "$_venv_bin/$_python_name" ]; then
    echo "[hooks] Python venv not found at $_venv_bin/$_python_name" >&2
    echo "[hooks] Run: uv sync --extra dev" >&2
    echo "[hooks] See docs/development/setup.md for details." >&2
    exit 2
fi

VENV_PYTHON="$_venv_bin/$_python_name"
PATH="$_venv_bin:$PATH"
export VENV_PYTHON PATH
unset _venv_bin _python_name
