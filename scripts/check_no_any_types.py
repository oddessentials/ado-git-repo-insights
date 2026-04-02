#!/usr/bin/env python3
"""Enforce QG-40: typing.Any MUST NOT grow in src/.

Ratchet-based check: scans all Python files under src/ for ``typing.Any``
token usage, compares against a committed baseline, and fails if the count
increases.  The baseline can only decrease over time (--update-baseline to
ratchet down after fixes).

Mirrors the suppression audit and the TypeScript any-type-ratchet.test.ts.
"""

from __future__ import annotations

import json
import sys
import tokenize
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src"
BASELINE_PATH = REPO_ROOT / ".any-type-baseline.json"


def scan_file(filepath: Path) -> list[tuple[int, str]]:
    """Return list of (line_number, token) for Any tokens in *filepath*."""
    hits: list[tuple[int, str]] = []
    try:
        with filepath.open("rb") as f:
            tokens = list(tokenize.tokenize(f.readline))
    except tokenize.TokenError:
        return hits

    for tok in tokens:
        if tok.type == tokenize.NAME and tok.string == "Any":
            hits.append((tok.start[0], tok.string))
    return hits


def scan_src() -> dict[str, int]:
    """Return {relative_path: count} for every file containing Any."""
    results: dict[str, int] = {}
    for py_file in sorted(SRC_DIR.rglob("*.py")):
        if "__pycache__" in py_file.parts:
            continue
        hits = scan_file(py_file)
        if hits:
            rel = str(py_file.relative_to(REPO_ROOT)).replace("\\", "/")
            results[rel] = len(hits)
    return results


def load_baseline() -> dict[str, int]:
    if not BASELINE_PATH.exists():
        return {}
    data = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    return data.get("files", {})


def save_baseline(current: dict[str, int]) -> None:
    total = sum(current.values())
    data = {
        "_comment": (
            "QG-40 Any-type ratchet baseline. This ceiling can only decrease. "
            "Run: python scripts/check_no_any_types.py --update-baseline"
        ),
        "total": total,
        "files": current,
    }
    BASELINE_PATH.write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"[OK] Baseline updated: {total} Any usages across {len(current)} files")


def main() -> int:
    update = "--update-baseline" in sys.argv

    current = scan_src()
    current_total = sum(current.values())

    if update:
        save_baseline(current)
        return 0

    baseline = load_baseline()
    baseline_total = sum(baseline.values())

    if not baseline:
        print(
            "[FAIL] QG-40: No baseline found. "
            "Run: python scripts/check_no_any_types.py --update-baseline"
        )
        return 1

    # Check for increases per-file
    new_files: list[str] = []
    increased: list[str] = []

    for fpath, count in current.items():
        base_count = baseline.get(fpath, 0)
        if base_count == 0 and count > 0:
            new_files.append(f"  {fpath}: {count} Any (new file, baseline: 0)")
        elif count > base_count:
            increased.append(
                f"  {fpath}: {count} Any (was {base_count}, +{count - base_count})"
            )

    if new_files or increased:
        print(
            f"[FAIL] QG-40: typing.Any count increased (total: {current_total}, baseline: {baseline_total})"
        )
        if new_files:
            print("New files with Any:")
            for line in new_files:
                print(line)
        if increased:
            print("Files with increased Any count:")
            for line in increased:
                print(line)
        print()
        print("Fix: Use precise types (object, TypedDict, Protocol) instead of Any.")
        print("The Any count can only decrease, never increase.")
        return 1

    if current_total < baseline_total:
        print(
            f"[PASS] QG-40: Any count decreased ({current_total} < {baseline_total}). "
            "Run --update-baseline to ratchet down."
        )
    else:
        print(
            f"[PASS] QG-40: Any count within baseline ({current_total} <= {baseline_total})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
