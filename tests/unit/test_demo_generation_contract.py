"""Tests for the committed-demo generation contract validator."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_SCRIPT = REPO_ROOT / "scripts" / "validate_demo_generation_contract.py"


def test_demo_generation_contract_validator_passes() -> None:
    """The canonical demo workflow and preflight contract must stay in sync."""
    result = subprocess.run(
        [sys.executable, str(VALIDATOR_SCRIPT)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
