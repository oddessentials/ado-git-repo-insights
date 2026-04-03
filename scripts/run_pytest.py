#!/usr/bin/env python3
"""Launch pytest with a Windows-safe local coverage path.

This is the documented local test entrypoint. It keeps pytest-cov as the
coverage engine so local semantics match CI, while routing coverage data into a
repo-owned per-run location before pytest starts loading plugins. The launcher
also loads a local plugin that preserves coverage shard files on Windows so
pytest-cov combine does not crash deleting them.

Usage:
    python scripts/run_pytest.py                    # full suite
    python scripts/run_pytest.py tests/unit/ -v     # subset with args
    python scripts/run_pytest.py -k test_foo        # any pytest args

Preflight (run_pr_preflight.py) sets its own COVERAGE_FILE and is not
affected by this launcher.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import time
from pathlib import Path

_TMP_ROOT = Path(__file__).resolve().parent.parent / ".tmp" / "pytest"
_PLUGIN_PATH = Path(__file__).with_name("pytest_cov_launcher_plugin.py")
_MAX_RUN_DIRS = 20
_MAX_RUN_AGE_SECONDS = 7 * 24 * 60 * 60


def _load_launcher_plugin() -> object:
    spec = importlib.util.spec_from_file_location(
        "pytest_cov_launcher_plugin", _PLUGIN_PATH
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _prune_old_runs(runs_root: Path) -> None:
    """Best-effort cleanup for old launcher run directories.

    Keep recent runs for inspection, but prevent `.tmp/pytest/runs/` from
    growing without bound when shard files are intentionally left behind.
    Failures here must never block the launcher.
    """

    try:
        entries = [entry for entry in runs_root.iterdir() if entry.is_dir()]
    except OSError:
        return

    def sort_key(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    now = time.time()
    for index, path in enumerate(sorted(entries, key=sort_key, reverse=True)):
        try:
            age_seconds = now - path.stat().st_mtime
        except OSError:
            age_seconds = _MAX_RUN_AGE_SECONDS + 1

        if index < _MAX_RUN_DIRS and age_seconds <= _MAX_RUN_AGE_SECONDS:
            continue

        shutil.rmtree(path, ignore_errors=True)


def _has_test_paths(args: list[str]) -> bool:
    """Return True if any argument is an explicit test path on disk.

    Recognizes both plain paths and pytest node IDs (path::node).
    """
    for arg in args:
        if arg.startswith("-"):
            continue
        base = arg.split("::", 1)[0]
        if Path(base).exists():
            return True
    return False


def main() -> int:
    runs_root = _TMP_ROOT / "runs"
    runs_root.mkdir(parents=True, exist_ok=True)
    _prune_old_runs(runs_root)

    run_id = f"run-{os.getpid()}-{int(time.time())}"
    run_dir = runs_root / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Per-run unique COVERAGE_FILE — set before pytest loads any plugins.
    # Preflight sets its own COVERAGE_FILE and basetemp; don't override it.
    os.environ.setdefault("COVERAGE_FILE", str(run_dir / ".coverage"))

    # Preserve the prior contract for any subprocesses that inspect this env var.
    os.environ.setdefault("COVERAGE_NO_CLEANUP", "1")

    # When running a subset, disable the coverage floor so developers can
    # iterate fast without the full suite. The 75% floor still applies to
    # full-suite runs, preflight, and CI.
    user_args = sys.argv[1:]
    extra_args: list[str] = []
    if _has_test_paths(user_args):
        extra_args.append("--cov-fail-under=0")

    import pytest

    return int(pytest.main(extra_args + user_args, plugins=[_load_launcher_plugin()]))


if __name__ == "__main__":
    raise SystemExit(main())
