#!/usr/bin/env python3
"""Enforce QG-40: typing.Any MUST NOT grow in src/ or tests/.

Ratchet-based check: scans all Python files under src/ and tests/ for
``typing.Any`` token usage, compares against a committed baseline, and fails
if the count increases.  The baseline can only decrease over time
(--update-baseline to ratchet down after fixes).

Mirrors the suppression audit and the TypeScript any-type-ratchet.test.ts.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tokenize
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src"
TESTS_DIR = REPO_ROOT / "tests"
BASELINE_PATH = REPO_ROOT / ".any-type-baseline.json"


def scan_file(filepath: Path) -> tuple[list[tuple[int, str]], str | None]:
    """Return ``(hits, parse_error)`` for Any tokens in *filepath*."""
    try:
        return scan_bytes(filepath.read_bytes())
    except OSError as exc:
        return [], f"{type(exc).__name__}: {exc}"


def scan_bytes(content: bytes) -> tuple[list[tuple[int, str]], str | None]:
    """Return ``(hits, parse_error)`` for Any tokens in *content*."""
    hits: list[tuple[int, str]] = []
    try:
        tokens = list(tokenize.tokenize(io.BytesIO(content).readline))
    except (tokenize.TokenError, IndentationError) as exc:
        return hits, f"{type(exc).__name__}: {exc}"

    for tok in tokens:
        if tok.type == tokenize.NAME and tok.string == "Any":
            hits.append((tok.start[0], tok.string))
    return hits, None


def scan_paths(py_files: list[Path]) -> tuple[dict[str, int], list[str]]:
    """Return ``({relative_path: count}, parse_failures)`` for the given files."""
    results: dict[str, int] = {}
    parse_failures: list[str] = []
    for py_file in sorted(py_files):
        if "__pycache__" in py_file.parts:
            continue
        rel = str(py_file.relative_to(REPO_ROOT)).replace("\\", "/")
        hits, parse_error = scan_file(py_file)
        if parse_error is not None:
            parse_failures.append(f"  {rel}: {parse_error}")
            continue
        if hits:
            results[rel] = len(hits)
    return results, parse_failures


def scan_staged_paths(rel_paths: list[str]) -> tuple[dict[str, int], list[str]]:
    """Return ``({relative_path: count}, parse_failures)`` for staged files."""
    results: dict[str, int] = {}
    parse_failures: list[str] = []
    for rel in sorted(rel_paths):
        content = staged_file_bytes(rel)
        if content is None:
            parse_failures.append(f"  {rel}: could not read staged blob")
            continue
        hits, parse_error = scan_bytes(content)
        if parse_error is not None:
            parse_failures.append(f"  {rel}: {parse_error}")
            continue
        if hits:
            results[rel] = len(hits)
    return results, parse_failures


def scan_src() -> tuple[dict[str, int], list[str]]:
    """Return ``({relative_path: count}, parse_failures)`` for src/ and tests/."""
    py_files = list(SRC_DIR.rglob("*.py")) + list(TESTS_DIR.rglob("*.py"))
    return scan_paths(py_files)


def staged_src_py_files() -> list[str]:
    """Return staged Python files under src/ and tests/."""
    result = subprocess.run(
        [
            "git",
            "diff",
            "--cached",
            "--name-only",
            "--diff-filter=d",
            "--",
            "src",
            "tests",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        print(f"[FAIL] QG-40: git diff failed: {result.stderr.strip()}")
        raise SystemExit(1)

    files: list[str] = []
    for line in result.stdout.splitlines():
        rel = line.strip().replace("\\", "/")
        if not rel.endswith(".py"):
            continue
        files.append(rel)
    return files


def staged_file_bytes(rel_path: str) -> bytes | None:
    result = subprocess.run(
        ["git", "show", f":{rel_path}"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout


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
    diff_mode = "--diff" in sys.argv

    if update and diff_mode:
        print(
            "[FAIL] QG-40: --diff and --update-baseline cannot be used together. "
            "Update the baseline from a full-tree scan only."
        )
        return 1

    if diff_mode:
        staged_files = staged_src_py_files()
        if not staged_files:
            print("[PASS] QG-40: No staged Python files under src/ or tests/")
            return 0
        current, parse_failures = scan_staged_paths(staged_files)
    else:
        current, parse_failures = scan_src()
    current_total = sum(current.values())

    if parse_failures:
        print("[FAIL] QG-40: Could not parse Python file(s):")
        for line in parse_failures:
            print(line)
        print()
        print("Fix syntax/indentation errors before relying on the Any-type ratchet.")
        return 1

    if update:
        save_baseline(current)
        return 0

    baseline = load_baseline()
    baseline_total = sum(baseline.values())

    if not BASELINE_PATH.exists():
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

    if diff_mode:
        print(
            f"[PASS] QG-40: No staged typing.Any increases "
            f"({len(current)} staged file(s) checked)"
        )
        return 0

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
