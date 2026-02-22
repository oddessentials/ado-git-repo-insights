#!/usr/bin/env python3
"""Regenerate all demo data in dependency order (FR-012).

Runs all three generators sequentially as subprocesses:
1. generate-demo-data.py — weekly rollups, dimensions, distributions, manifest
2. generate-demo-predictions.py — trend forecasts (reads rollups)
3. generate-demo-insights.py — AI insights (reads rollups)

Usage:
    python scripts/regenerate-demo.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_scripts_dir = Path(__file__).parent


def main() -> int:
    """Run all generators in dependency order."""
    generators = [
        "generate-demo-data.py",
        "generate-demo-predictions.py",
        "generate-demo-insights.py",
    ]

    for script_name in generators:
        print(f"\n{'=' * 60}")
        print(f"Step: {script_name}")
        print(f"{'=' * 60}")

        result = subprocess.run(  # noqa: S603
            [sys.executable, str(_scripts_dir / script_name)],
            check=False,
        )
        if result.returncode != 0:
            print(f"\nFAILED: {script_name} exited with code {result.returncode}")
            return result.returncode

    print(f"\n{'=' * 60}")
    print("All generators completed successfully.")
    print(f"{'=' * 60}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
