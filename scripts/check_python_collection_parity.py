#!/usr/bin/env python3
"""Generate and compare hermetic Python collection parity artifacts."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from _platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS
else:
    try:
        from ._platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS
    except ImportError:
        from _platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS

_CLEANUP_RETRY_ATTEMPTS = 3
_CLEANUP_RETRY_SLEEP_SECONDS = 0.05


class ParitySetupError(RuntimeError):
    """Raised when parity collection cannot produce a verdict."""


@dataclass(frozen=True)
class PythonCollectionSnapshot:
    count: int
    node_ids: tuple[str, ...]
    platform_filters_applied: bool


def collect_python_snapshot(
    *, apply_platform_filters: bool
) -> PythonCollectionSnapshot:
    """Collect Python node IDs via the hermetic pytest subprocess."""
    fd, count_path_str = tempfile.mkstemp(
        prefix=f"parity-count-{os.getpid()}-", suffix=".txt"
    )
    os.close(fd)
    count_file = Path(count_path_str)
    nodeids_fd, nodeids_path_str = tempfile.mkstemp(
        prefix=f"parity-nodeids-{os.getpid()}-", suffix=".json"
    )
    os.close(nodeids_fd)
    nodeids_file = Path(nodeids_path_str)

    def _best_effort_unlink(path: Path) -> None:
        for attempt in range(_CLEANUP_RETRY_ATTEMPTS):
            try:
                path.unlink(missing_ok=True)
                break
            except PermissionError:
                if attempt + 1 < _CLEANUP_RETRY_ATTEMPTS:
                    time.sleep(_CLEANUP_RETRY_SLEEP_SECONDS)

    try:
        scrubbed_env = {
            key: value
            for key, value in os.environ.items()
            if key not in {"PYTEST_ADDOPTS", "PYTEST_PLUGINS"}
        }
        scrubbed_env.update(
            {
                "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
                "RATCHET_COUNT_OUTPUT": str(count_file),
                "RATCHET_NODEIDS_OUTPUT": str(nodeids_file),
                "PYTHONDONTWRITEBYTECODE": "1",
                "COVERAGE_PROCESS_START": "",
                "COVERAGE_RCFILE": os.devnull,
            }
        )
        ignore_args: tuple[str, ...] = (
            tuple(
                f"--ignore-glob={pattern}"
                for pattern in PLATFORM_CONDITIONAL_IGNORE_GLOBS
            )
            if apply_platform_filters
            else ()
        )
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "--collect-only",
                "--no-header",
                "-q",
                "-o",
                "addopts=",
                "-p",
                "no:cacheprovider",
                "-p",
                "no:randomly",
                "-p",
                "no:xdist",
                "-p",
                "no:sugar",
                "-p",
                "no:forked",
                "-p",
                "scripts._pytest_count_collector",
                "--import-mode=importlib",
                *ignore_args,
                "tests/",
            ],
            env=scrubbed_env,
            cwd=Path(__file__).resolve().parent.parent,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode != 0:
            raise ParitySetupError(
                "Hermetic pytest --collect-only failed with exit code "
                f"{result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        try:
            count = int(count_file.read_text(encoding="utf-8").strip())
        except (OSError, ValueError) as exc:
            raise ParitySetupError(
                f"Collector count output malformed or unreadable: {count_file}"
            ) from exc
        try:
            node_ids_raw = json.loads(nodeids_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ParitySetupError(
                f"Collector node ID output malformed or unreadable: {nodeids_file}"
            ) from exc
        if not isinstance(node_ids_raw, list) or not all(
            isinstance(node_id, str) for node_id in node_ids_raw
        ):
            raise ParitySetupError(
                "Collector node ID output must be a JSON array of strings"
            )
        return PythonCollectionSnapshot(
            count=count,
            node_ids=tuple(sorted(node_ids_raw)),
            platform_filters_applied=apply_platform_filters,
        )
    finally:
        _best_effort_unlink(count_file)
        _best_effort_unlink(nodeids_file)


def generate_artifact(output_path: Path) -> int:
    """Write the canonical filtered Python collection artifact."""
    try:
        snapshot = collect_python_snapshot(apply_platform_filters=True)
    except ParitySetupError as exc:
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
