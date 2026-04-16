#!/usr/bin/env python3
"""Generate and compare hermetic Python collection parity artifacts.

This script reuses :mod:`scripts.check_ratchet_bump`'s canonical hermetic
collector so parity proofs exercise the same runner the ratchet gate trusts.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import check_ratchet_bump as ratchet

if TYPE_CHECKING:
    from _platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS
else:
    try:
        from ._platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS
    except ImportError:
        from _platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS


def generate_artifact(output_path: Path) -> int:
    """Write the canonical filtered Python collection artifact."""
    try:
        snapshot = ratchet.collect_python_snapshot(apply_platform_filters=True)
    except ratchet.RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return 2

    artifact = {
        "schema_version": 1,
        "platform": sys.platform,
        "count": snapshot.count,
        "platform_filters_applied": snapshot.platform_filters_applied,
        "filter_globs": list(PLATFORM_CONDITIONAL_IGNORE_GLOBS),
        "node_ids": list(snapshot.node_ids),
    }
    output_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        f"[PASS] Wrote Python collection parity artifact to {output_path} "
        f"({snapshot.count} collected node IDs)"
    )
    return 0


def compare_artifacts(left_path: Path, right_path: Path) -> int:
    """Compare two collection artifacts and report normalized node-id diffs."""
    left = json.loads(left_path.read_text(encoding="utf-8"))
    right = json.loads(right_path.read_text(encoding="utf-8"))

    left_node_ids = left.get("node_ids", [])
    right_node_ids = right.get("node_ids", [])
    if not isinstance(left_node_ids, list) or not all(
        isinstance(node_id, str) for node_id in left_node_ids
    ):
        print(f"[SETUP] {left_path} node_ids must be a JSON array of strings")
        return 2
    if not isinstance(right_node_ids, list) or not all(
        isinstance(node_id, str) for node_id in right_node_ids
    ):
        print(f"[SETUP] {right_path} node_ids must be a JSON array of strings")
        return 2

    left_meta = {
        key: value
        for key, value in left.items()
        if key not in {"node_ids", "platform", "count"}
    }
    right_meta = {
        key: value
        for key, value in right.items()
        if key not in {"node_ids", "platform", "count"}
    }

    if left_meta != right_meta:
        print("[FAIL] Python collection parity artifact metadata differs:")
        print(f"  left : {left_meta}")
        print(f"  right: {right_meta}")
        return 1

    left_set = set(left_node_ids)
    right_set = set(right_node_ids)
    left_only = sorted(left_set - right_set)
    right_only = sorted(right_set - left_set)

    if left_only or right_only:
        print("[FAIL] Python collection parity drift detected.")
        print(
            "  Comparison semantics: exact filtered node-id set equality "
            "(same canonical collector, line order ignored)."
        )
        if left_only:
            print(f"  Node IDs present only in {left.get('platform', 'left')}:")
            for node_id in left_only:
                print(f"    {node_id}")
        if right_only:
            print(f"  Node IDs present only in {right.get('platform', 'right')}:")
            for node_id in right_only:
                print(f"    {node_id}")
        print(
            f"  Counts: {left.get('platform', 'left')}={left.get('count')} "
            f"{right.get('platform', 'right')}={right.get('count')}"
        )
        return 1

    print(
        "[PASS] Python collection parity artifacts match "
        f"({left.get('count')} filtered node IDs)"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate_parser = subparsers.add_parser("generate")
    generate_parser.add_argument("--output", required=True, type=Path)

    compare_parser = subparsers.add_parser("compare")
    compare_parser.add_argument("--left", required=True, type=Path)
    compare_parser.add_argument("--right", required=True, type=Path)

    args = parser.parse_args()
    if args.command == "generate":
        return generate_artifact(args.output)
    return compare_artifacts(args.left, args.right)


if __name__ == "__main__":
    raise SystemExit(main())
