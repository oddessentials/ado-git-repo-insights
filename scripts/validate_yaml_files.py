#!/usr/bin/env python3
"""Validate repository YAML files without modifying them."""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
SKIP_PARTS = {"node_modules", ".venv", ".git", "__pycache__"}


def iter_yaml_files(root: Path) -> list[Path]:
    """Return repository YAML files that should be parse-validated."""
    files: list[Path] = []
    for path in root.rglob("*"):
        if path.suffix.lower() not in {".yml", ".yaml"}:
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        files.append(path)
    return sorted(files)


def main() -> int:
    failures: list[str] = []
    for path in iter_yaml_files(REPO_ROOT):
        try:
            yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            rel_path = path.relative_to(REPO_ROOT).as_posix()
            failures.append(f"{rel_path}: {exc}")

    if failures:
        print("[yaml-validate] invalid YAML detected:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("[yaml-validate] all YAML files parsed successfully")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
