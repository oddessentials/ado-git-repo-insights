#!/usr/bin/env python3
"""Synchronize extension UI assets into the Python ui_bundle copy.

Hardening features:
- Explicit ALLOWED_EXTENSIONS allowlist (only .js, .html, .css)
- EXCLUDE_PATTERNS blocklist (no .map, .d.ts, etc.)
- Staleness check when --check-stale is passed
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import shutil
import sys
from pathlib import Path

# Explicit allowlist of file extensions permitted in ui_bundle
# Only these extensions will be synced - everything else is ignored
ALLOWED_EXTENSIONS = {".js", ".html", ".css"}

# Explicit blocklist of patterns to exclude even if extension matches
EXCLUDE_PATTERNS = {
    "*.map",  # Source maps
    "*.d.ts",  # TypeScript declarations
    ".DS_Store",  # macOS metadata
    "*.swp",  # Vim swap files
    "*~",  # Backup files
    "*.bak",  # Backup files
}


def _should_include(path: Path) -> bool:
    """Check if file should be included based on allowlist and blocklist."""
    name = path.name
    ext = path.suffix.lower()

    # Check blocklist first
    if any(fnmatch.fnmatch(name, pattern) for pattern in EXCLUDE_PATTERNS):
        return False

    # Check allowlist
    return ext in ALLOWED_EXTENSIONS


def _gather_files(root: Path) -> set[Path]:
    """Gather all allowed files relative to root directory."""
    files: set[Path] = set()
    for current_root, _, filenames in os.walk(root):
        current_path = Path(current_root)
        for filename in filenames:
            file_path = current_path / filename
            if _should_include(file_path):
                files.add(file_path.relative_to(root))
    return files


def _ensure_directory(path: Path) -> None:
    """Create directory and parents if needed."""
    path.mkdir(parents=True, exist_ok=True)


def check_staleness(source_dir: Path, ui_source_dir: Path) -> bool:
    """Check if dist/ui is older than ui/ source files.

    Returns True if dist is stale (source is newer), False otherwise.
    """
    if not source_dir.exists():
        return True  # No dist = definitely stale

    if not ui_source_dir.exists():
        return False  # No source to compare

    # Get newest TypeScript source file modification time
    ts_files = list(ui_source_dir.glob("*.ts"))
    if not ts_files:
        return False  # No TS files to compare

    newest_source = max(f.stat().st_mtime for f in ts_files)

    # Get newest dist JS file modification time
    js_files = list(source_dir.glob("*.js"))
    if not js_files:
        return True  # No JS files = stale

    newest_dist = max(f.stat().st_mtime for f in js_files)

    return newest_dist < newest_source


def sync_ui_bundle(source_dir: Path, bundle_dir: Path) -> int:
    """Synchronize source UI directory to bundle directory.

    Returns the number of files changed (added + removed).
    """
    if not source_dir.is_dir():
        raise FileNotFoundError(f"Source directory not found: {source_dir}")
    if not bundle_dir.is_dir():
        _ensure_directory(bundle_dir)

    source_files = _gather_files(source_dir)
    bundle_files = _gather_files(bundle_dir)

    # Remove files in bundle that are not in source
    removed = 0
    for relative_path in sorted(bundle_files - source_files):
        target = bundle_dir / relative_path
        if target.exists():
            target.unlink()
            removed += 1

    # Copy files from source to bundle
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
    parser.add_argument(
        "--check-stale",
        action="store_true",
        help="Fail if source dist/ is older than ui/ TypeScript files",
    )
    parser.add_argument(
        "--ui-source",
        type=Path,
        default=Path("extension/ui"),
        help="UI TypeScript source directory for staleness check",
    )

    args = parser.parse_args()

    # Staleness check if requested
    if args.check_stale:
        if check_staleness(args.source, args.ui_source):
            print(
                f"::error::dist/ui is stale - source files in {args.ui_source} "
                f"are newer than {args.source}"
            )
            print("Run 'npm run build:ui' in extension/ before syncing")
            return 1

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
