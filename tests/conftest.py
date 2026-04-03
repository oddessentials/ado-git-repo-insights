"""Root test conftest — platform-conditional collection and shared typed doubles.

Excludes Windows-only test files from collection on non-Windows
platforms so they are never counted as skipped (CI zero-skip policy).

Runtime path isolation (specs/049-cross-platform-hardening):
  pytest_configure routes basetemp into per-run directories under
  .tmp/pytest/runs/ so stale locked files never brick future runs.
  Coverage path isolation is handled by the launcher (scripts/run_pytest.py)
  which sets COVERAGE_FILE before pytest starts loading plugins.
  Old runs are cleaned up on a best-effort basis (locked dirs are skipped).

Typed ModuleType subclasses (FakeProphetModule, FakeOpenAIModule) declare
attributes that bare ModuleType lacks, eliminating type: ignore[attr-defined]
when assigning mock objects to fake module attributes. See research.md R-006.
"""

import os
import shutil
import sys
import time
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

_REPO_ROOT = Path(__file__).resolve().parent.parent
_TMP_ROOT = _REPO_ROOT / ".tmp" / "pytest"


def _self_heal_cache(cache_dir: Path) -> None:
    """Probe cache directory and nuke it if locked or corrupted."""
    if not cache_dir.is_dir():
        return
    probe = cache_dir / ".probe.tmp"
    try:
        probe.write_text("probe", encoding="ascii")
        probe.unlink()
    except OSError:
        # Cache is locked — delete and let pytest recreate it
        shutil.rmtree(cache_dir, ignore_errors=True)


def _cleanup_old_runs(runs_dir: Path, current_run_id: str) -> None:
    """Delete old per-run directories, skipping any that are locked."""
    if not runs_dir.is_dir():
        return
    for entry in runs_dir.iterdir():
        if entry.name == current_run_id or not entry.is_dir():
            continue
        shutil.rmtree(entry, ignore_errors=True)


def pytest_configure(config: object) -> None:
    """Route pytest temp paths into isolated per-run directories.

    Invariant: pytest must never rely on implicit OS temp or default cache
    paths — only explicitly controlled repo-owned paths.

    - basetemp → .tmp/pytest/runs/<run_id>/tmp  (per-run, isolated)
    - cache_dir stays fixed at .tmp/pytest/cache (set in pyproject.toml)
      but gets self-healed if locked

    Coverage path isolation is NOT handled here — it is set by the launcher
    (scripts/run_pytest.py) before pytest starts. run_pr_preflight.py also
    overrides basetemp (via CLI) and COVERAGE_FILE (via env var).
    """
    run_id = f"run-{os.getpid()}-{int(time.time())}"
    runs_dir = _TMP_ROOT / "runs"
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Per-run basetemp — only if not already set by CLI (e.g., preflight)
    option = getattr(config, "option", None)
    if option is not None and getattr(option, "basetemp", None) is None:
        option.basetemp = str(run_dir / "tmp")

    # Ensure coverage data_file directory exists (pyproject.toml fallback)
    (_TMP_ROOT / "coverage").mkdir(parents=True, exist_ok=True)

    # Self-healing: probe cache and nuke if locked
    _self_heal_cache(_TMP_ROOT / "cache")

    # Self-healing: clean up old runs (skip locked)
    _cleanup_old_runs(runs_dir, run_id)


collect_ignore_glob: list[str] = []

if sys.platform != "win32":
    collect_ignore_glob.append("**/test_*_windows.py")


class FakeProphetModule(ModuleType):
    """Typed fake for the ``prophet`` module — declares ``Prophet`` attribute."""

    Prophet: MagicMock


class FakeOpenAIModule(ModuleType):
    """Typed fake for the ``openai`` module — declares ``OpenAI`` attribute."""

    OpenAI: MagicMock
