#!/usr/bin/env python3
"""Publish the deterministic docs demo shell and static UI assets."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from demo_shell import write_demo_html

REPO_ROOT = Path(__file__).resolve().parent.parent
DIST_UI_DIR = REPO_ROOT / "extension" / "dist" / "ui"
UI_SOURCE_DIR = REPO_ROOT / "extension" / "ui"
DOCS_DIR = REPO_ROOT / "docs"
BROKEN_DOCS_DIR = REPO_ROOT / "extension" / "tests" / "fixtures" / "broken-docs"

STATIC_ASSET_FILES = [
    "dashboard.js",
    "dataset-loader.js",
    "artifact-client.js",
    "error-types.js",
    "error-codes.js",
    "styles.css",
]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Publish the docs demo shell from extension/ui and assets from extension/dist/ui."
    )
    parser.add_argument(
        "--list-assets",
        action="store_true",
        help="Print the canonical static asset filenames (one per line) and exit.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DIST_UI_DIR,
        help="Built UI directory (default: extension/dist/ui)",
    )
    parser.add_argument(
        "--docs-dir",
        type=Path,
        default=DOCS_DIR,
        help="Published docs directory (default: docs)",
    )
    parser.add_argument(
        "--sync-broken-fixture",
        action="store_true",
        help="Also refresh the broken-docs fixture shell and static assets.",
    )
    return parser.parse_args(argv)


def require_source_file(source_dir: Path, relative_path: str) -> Path:
    """Return a required source file or raise a helpful error."""
    source_path = source_dir / relative_path
    if not source_path.exists():
        raise FileNotFoundError(
            f"Missing required built UI asset: {source_path}. "
            "Run `pnpm --dir extension run build:ui` first."
        )
    return source_path


def copy_static_assets(source_dir: Path, destination_dir: Path) -> None:
    """Copy built JS/CSS assets into destination_dir."""
    destination_dir.mkdir(parents=True, exist_ok=True)
    for relative_path in STATIC_ASSET_FILES:
        shutil.copyfile(
            require_source_file(source_dir, relative_path),
            destination_dir / relative_path,
        )


def publish_docs_shell(
    docs_dir: Path, *, shell_source_dir: Path = UI_SOURCE_DIR
) -> None:
    """Render and publish docs/index.html from the canonical extension shell."""
    docs_dir.mkdir(parents=True, exist_ok=True)
    source_index = require_source_file(shell_source_dir, "index.html")
    write_demo_html(source_index, docs_dir / "index.html")


def publish_broken_fixture(source_dir: Path) -> None:
    """Refresh broken-docs shell assets while preserving malformed dataset data."""
    BROKEN_DOCS_DIR.mkdir(parents=True, exist_ok=True)
    copy_static_assets(source_dir, BROKEN_DOCS_DIR)
    publish_docs_shell(BROKEN_DOCS_DIR)


def main(argv: list[str] | None = None) -> int:
    """Publish the docs demo shell and static assets."""
    args = parse_args(argv)

    if args.list_assets:
        for filename in STATIC_ASSET_FILES:
            print(filename)
        return 0

    source_dir = args.source.resolve()
    docs_dir = args.docs_dir.resolve()

    copy_static_assets(source_dir, docs_dir)
    publish_docs_shell(docs_dir)

    if args.sync_broken_fixture:
        publish_broken_fixture(source_dir)

    print(f"[demo-surface] published docs shell from {source_dir} -> {docs_dir}")
    if args.sync_broken_fixture:
        print(f"[demo-surface] refreshed broken-docs fixture at {BROKEN_DOCS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
