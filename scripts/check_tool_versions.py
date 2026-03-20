#!/usr/bin/env python3
"""
Validate pinned tool versions stay in sync across repo configuration.

This catches configuration drift locally before it fails CI.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PRE_COMMIT_CONFIG = REPO_ROOT / ".pre-commit-config.yaml"
PYPROJECT = REPO_ROOT / "pyproject.toml"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _extract_pre_commit_rev(repo_fragment: str) -> str:
    lines = _read_text(PRE_COMMIT_CONFIG).splitlines()
    for index, line in enumerate(lines):
        if repo_fragment in line:
            for follow in lines[index + 1 :]:
                stripped = follow.strip()
                if stripped.startswith("rev:"):
                    return stripped.split(":", 1)[1].strip().removeprefix("v")
                if stripped.startswith("- repo:"):
                    break
    raise RuntimeError(f"Could not find pre-commit repo containing {repo_fragment!r}")


def _extract_dev_dependency(package_name: str) -> str:
    pattern = re.compile(rf'^\s*["\']{re.escape(package_name)}==([0-9][^"\',; ]*)["\']')
    for line in _read_text(PYPROJECT).splitlines():
        match = pattern.match(line)
        if match:
            return match.group(1)
    raise RuntimeError(f"Could not find pinned dev dependency for {package_name!r}")


def check_ruff_version_parity() -> list[str]:
    pre_commit_version = _extract_pre_commit_rev("ruff-pre-commit")
    pyproject_version = _extract_dev_dependency("ruff")

    if pre_commit_version != pyproject_version:
        return [
            "Ruff version mismatch detected.",
            f"  .pre-commit-config.yaml: {pre_commit_version}",
            f"  pyproject.toml: {pyproject_version}",
            "  Update both files to the same pinned Ruff version.",
        ]
    return []


def main() -> int:
    errors = []
    errors.extend(check_ruff_version_parity())

    if errors:
        for line in errors:
            print(line, file=sys.stderr)
        return 1

    print("[OK] Tool version pins are in sync")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
