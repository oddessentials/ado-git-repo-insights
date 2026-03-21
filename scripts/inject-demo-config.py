#!/usr/bin/env python3
"""Inject the deterministic demo shell transform into docs/index.html."""

import sys
from pathlib import Path

from demo_shell import write_demo_html


def inject_config(index_path: Path) -> None:
    """Apply the canonical demo transform to index_path in place."""
    write_demo_html(index_path, index_path)
    print("  Configuration injected successfully.")


def main() -> int:
    """Main entry point."""
    if len(sys.argv) > 1:
        index_path = Path(sys.argv[1])
    else:
        # Default path
        index_path = Path(__file__).parent.parent / "docs" / "index.html"

    if not index_path.exists():
        print(f"Error: {index_path} not found")
        return 1

    inject_config(index_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
