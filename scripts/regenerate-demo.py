#!/usr/bin/env python3
"""Backward-compatible wrapper for canonical demo regeneration.

Deprecated in favor of `build-demo-dataset.py`, which generates the canonical
enterprise demo artifact under `artifacts/demo-enterprise/` and promotes it
into `docs/data/`.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_scripts_dir = Path(__file__).parent


def main() -> int:
    """Delegate to the canonical demo build pipeline."""
    result = subprocess.run(  # noqa: S603
        [sys.executable, str(_scripts_dir / "build-demo-dataset.py")],
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
