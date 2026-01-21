#!/usr/bin/env python3
"""Synchronize extension UI assets into the Python ui_bundle copy."""

from __future__ import annotations

import argparse
import fnmatch
import os
import shutil
import sys
from pathlib import Path

EXCLUDE_PATTERNS = {
    "*.map",
    "*.d.ts",  # TypeScript declarations - only compiled JS in ui_bundle
    ".DS_Store",
    "*.swp",
    "*~",
    "*.bak",
}


def _should_exclude(path: Path) -> bool:
    name = path.name
    return any(fnmatch.fnmatch(name, pattern) for pattern in EXCLUDE_PATTERNS)


def _gather_files(root: Path) -> set[Path]:
    files: set[Path] = set()
    for current_root, _, filenames in os.walk(root):
        current_path = Path(current_root)
        for filename in filenames:
            file_path = current_path / filename
            if _should_exclude(file_path):
                continue
            files.add(file_path.relative_to(root))
    return files


def _ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def sync_ui_bundle(source_dir: Path, bundle_dir: Path) -> int:
    if not source_dir.is_dir():
        raise FileNotFoundError(f"Source directory not found: {source_dir}")
    if not bundle_dir.is_dir():
        _ensure_directory(bundle_dir)

    source_files = _gather_files(source_dir)
    bundle_files = _gather_files(bundle_dir)

    removed = 0
    for relative_path in sorted(bundle_files - source_files):
        target = bundle_dir / relative_path
        if target.exists():
            target.unlink()
            removed += 1

    copied = 0
    for relative_path in sorted(source_files):
        src = source_dir / relative_path
        dest = bundle_dir / relative_path
        _ensure_directory(dest.parent)
        shutil.copy2(src, dest)
        copied += 1

    return removed + copied


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Synchronize extension UI assets into the Python ui_bundle copy."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("extension/dist/ui"),
        help="Source UI directory (default: extension/dist/ui - compiled JS)",
    )
    parser.add_argument(
        "--bundle",
        type=Path,
        default=Path("src/ado_git_repo_insights/ui_bundle"),
        help="Destination bundle directory (default: src/ado_git_repo_insights/ui_bundle)",
    )

    args = parser.parse_args()

    try:
        changes = sync_ui_bundle(args.source, args.bundle)
    except FileNotFoundError as exc:
        print(f"::error::{exc}")
        return 1

    print(f"UI bundle sync complete: source={args.source} bundle={args.bundle}")
    if changes == 0:
        print("No changes required.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
