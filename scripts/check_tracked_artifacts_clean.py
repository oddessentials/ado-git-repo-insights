#!/usr/bin/env python3
"""Refuse to advance preflight when canonical demo artifacts are dirty."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

TRACKED_PATHS: tuple[str, ...] = (
    "artifacts/demo-enterprise/",
    "artifacts/demo-enterprise-comments-off/",
    "docs/data/",
)


def _resolve_repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"not inside a git working tree (cwd={Path.cwd()}): {result.stderr.strip()}"
        )
    return Path(result.stdout.strip()).resolve()


def _run_git(args: list[str], *, cwd: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {result.returncode}):\n{result.stderr}"
        )
    return result.stdout


def collect_dirty_paths() -> list[str]:
    repo_root = _resolve_repo_root()
    diff_args = ["diff", "--name-only", "HEAD", "--", *TRACKED_PATHS]
    untracked_args = [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        *TRACKED_PATHS,
    ]
    dirty: set[str] = set()
    for line in _run_git(diff_args, cwd=repo_root).splitlines():
        if line.strip():
            dirty.add(line.strip())
    for line in _run_git(untracked_args, cwd=repo_root).splitlines():
        if line.strip():
            dirty.add(line.strip())
    return sorted(dirty)


def main() -> int:
    dirty = collect_dirty_paths()
    if not dirty:
        return 0
    print(
        "Tracked canonical demo artifacts have uncommitted changes:",
        file=sys.stderr,
    )
    for path in dirty:
        print(f"  - {path}", file=sys.stderr)
    print(
        "These paths must remain byte-identical to HEAD between commits. "
        "Restore via `git restore --` and rerun preflight; if the change is "
        "intentional, regenerate via the canonical CI workflow.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
