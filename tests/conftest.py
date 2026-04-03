"""Root test conftest — platform-conditional collection and shared typed doubles.

Excludes Windows-only test files from collection on non-Windows
platforms so they are never counted as skipped (CI zero-skip policy).

Runtime path isolation (specs/049-cross-platform-hardening):
  pytest_configure routes basetemp into per-run directories under
  .tmp/pytest/runs/. Coverage path isolation is handled by the launcher
  (scripts/run_pytest.py) which sets COVERAGE_FILE before pytest starts.
  Old run directories are left behind — no cleanup is attempted from
  inside pytest because any rmtree/unlink can hit Windows file locks
  and crash the session.

Typed ModuleType subclasses (FakeProphetModule, FakeOpenAIModule) declare
attributes that bare ModuleType lacks, eliminating type: ignore[attr-defined]
when assigning mock objects to fake module attributes. See research.md R-006.
"""

import os
import sys
import time
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

_REPO_ROOT = Path(__file__).resolve().parent.parent
_TMP_ROOT = _REPO_ROOT / ".tmp" / "pytest"


def pytest_configure(config: object) -> None:
    """Route pytest basetemp into a per-run directory.

    Invariant: pytest must never rely on implicit OS temp or default cache
    paths — only explicitly controlled repo-owned paths. A stale or locked
    artifact from a previous run must never prevent the next run from starting.

    - basetemp → .tmp/pytest/runs/<run_id>/tmp  (per-run, isolated)
    - cache_dir → .tmp/pytest/cache (set in pyproject.toml)
    - No cleanup attempted — leftover dirs are accepted

    Coverage path isolation is handled by the launcher (scripts/run_pytest.py)
    before pytest starts. run_pr_preflight.py overrides basetemp (via CLI)
    and COVERAGE_FILE (via env var).
    """
    run_id = f"run-{os.getpid()}-{int(time.time())}"
    run_dir = _TMP_ROOT / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Per-run basetemp — only if not already set by CLI (e.g., preflight)
    option = getattr(config, "option", None)
    if option is not None and getattr(option, "basetemp", None) is None:
        option.basetemp = str(run_dir / "tmp")

    # Ensure coverage data_file directory exists (pyproject.toml fallback)
    (_TMP_ROOT / "coverage").mkdir(parents=True, exist_ok=True)


collect_ignore_glob: list[str] = []

if sys.platform != "win32":
    collect_ignore_glob.append("**/test_*_windows.py")


class FakeProphetModule(ModuleType):
    """Typed fake for the ``prophet`` module — declares ``Prophet`` attribute."""

    Prophet: MagicMock


class FakeOpenAIModule(ModuleType):
    """Typed fake for the ``openai`` module — declares ``OpenAI`` attribute."""

    OpenAI: MagicMock
