#!/usr/bin/env python3
"""Verify the committed test-floor contract against canonical collectors."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from check_ratchet_bump import (
        RatchetSetupError,
        measure_extension_count,
        measure_python_count,
    )
    from test_floor_contract import load_test_floor_contract
else:
    try:
        from .check_ratchet_bump import (
            RatchetSetupError,
            measure_extension_count,
            measure_python_count,
        )
        from .test_floor_contract import load_test_floor_contract
    except ImportError:
        from check_ratchet_bump import (
            RatchetSetupError,
            measure_extension_count,
            measure_python_count,
        )
        from test_floor_contract import load_test_floor_contract


def verify_contract(contract_path: Path, *, extension_junit: Path) -> int:
    try:
        contract = load_test_floor_contract(contract_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[SETUP] Could not load test floor contract {contract_path}: {exc}")
        return 2

    try:
        python_actual = measure_python_count()
        extension_actual = measure_extension_count(extension_junit)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}")
        return 2

    exit_code = 0
    if contract.python.min_collected != python_actual:
        print(
            "[FAIL] Python test floor contract stale:\n"
            f"  committed: {contract.python.min_collected}\n"
            f"  current:   {python_actual}\n"
            "  authority: scripts.check_ratchet_bump.collect_python_snapshot"
            "(apply_platform_filters=True)"
        )
        exit_code = 1
    else:
        print(
            "[PASS] Python test floor contract matches canonical collector "
            f"({python_actual})"
        )

    if contract.extension.min_collected != extension_actual:
        print(
            "[FAIL] Extension test floor contract stale:\n"
            f"  committed: {contract.extension.min_collected}\n"
            f"  current:   {extension_actual}\n"
            "  authority: extension/test-results.xml parsed via measure_extension_count"
        )
        exit_code = 1
    else:
        print(
            "[PASS] Extension test floor contract matches canonical collector "
            f"({extension_actual})"
        )

    if exit_code:
        print(
            "  Fix: regenerate .test-floor-contract.json in the same commit as the "
            "count-changing test changes."
        )
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--contract",
        type=Path,
        default=Path(".test-floor-contract.json"),
        help="Path to committed floor contract JSON",
    )
    parser.add_argument(
        "--extension-junit",
        type=Path,
        default=Path("extension/test-results.xml"),
        help="Extension JUnit XML used to measure the canonical extension count",
    )
    args = parser.parse_args()
    return verify_contract(args.contract, extension_junit=args.extension_junit)


if __name__ == "__main__":
    raise SystemExit(main())
