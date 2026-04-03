#!/usr/bin/env python3
"""Launch pytest with per-run isolated coverage paths.

This is the documented local test entrypoint. It sets COVERAGE_FILE and
COVERAGE_NO_CLEANUP before pytest starts loading plugins, so pytest-cov
never binds to a shared file and never fails deleting locked shards.

Usage:
    python scripts/run_pytest.py                    # full suite
    python scripts/run_pytest.py tests/unit/ -v     # subset with args
    python scripts/run_pytest.py -k test_foo        # any pytest args

Preflight (run_pr_preflight.py) sets its own COVERAGE_FILE and is not
affected by this launcher.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_TMP_ROOT = _REPO_ROOT / ".tmp" / "pytest"


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
    # Per-run unique COVERAGE_FILE — set before pytest loads any plugins.
    # Preflight sets its own COVERAGE_FILE; don't override it.
    if "COVERAGE_FILE" not in os.environ:
        run_id = f"run-{os.getpid()}-{int(time.time())}"
        run_dir = _TMP_ROOT / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        os.environ["COVERAGE_FILE"] = str(run_dir / ".coverage")

    # Prevent coverage from failing on shard deletion during erase/combine.
    os.environ.setdefault("COVERAGE_NO_CLEANUP", "1")

    extra_args: list[str] = []

    # When running a subset, disable the coverage floor so developers can
    # iterate fast without the full suite. The 75% floor still applies to
    # full-suite runs, preflight, and CI.
    user_args = sys.argv[1:]
    if _has_test_paths(user_args):
        extra_args.append("--cov-fail-under=0")

    import pytest

    return pytest.main(extra_args + user_args)


if __name__ == "__main__":
    raise SystemExit(main())
