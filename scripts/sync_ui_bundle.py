#!/usr/bin/env python3
"""Synchronize extension UI assets into the Python ui_bundle copy.

Thin wrapper around ado_git_repo_insights.utils.ui_sync library.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


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
        "--force",
        action="store_true",
        help="Force sync even if content hashes match",
    )

    args = parser.parse_args()

    # Import from the library module
    try:
        from ado_git_repo_insights.utils.ui_sync import (
            SyncError,
            sync_needed,
            sync_ui_bundle,
            validate_dist,
        )
    except ImportError:
        print("::error::Could not import ui_sync module. Is the package installed?")
        print("Run: pip install -e .")
        return 1

    # Validate source
    try:
        validate_dist(args.source)
    except SyncError as e:
        print(f"::error::{e}")
        return 1

    # Check if sync needed
    if not args.force and not sync_needed(args.source, args.bundle):
        print(f"UI bundle sync: no changes needed (source={args.source})")
        return 0

    # Perform sync
    try:
        manifest = sync_ui_bundle(args.source, args.bundle)
    except SyncError as e:
        print(f"::error::{e}")
        return 1

    print(f"UI bundle sync complete: {len(manifest)} files")
    print(f"  source={args.source}")
    print(f"  bundle={args.bundle}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
