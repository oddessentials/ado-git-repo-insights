#!/usr/bin/env python3
"""Check for coverage threshold changes that require explicit approval.

Replicates the CI threshold-change-guard logic (ci.yml lines 361-414) locally.
Only requires [threshold-update] marker when actual threshold VALUES changed,
not when the file is merely touched for unrelated edits.

Threshold patterns matched (same as CI):
  Jest (jest.config.ts): statements:, branches:, functions:, lines:
  Python (pyproject.toml): fail_under

Exit codes:
  0: No threshold changes, or marker present
  1: Threshold values changed without [threshold-update] marker
"""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Exact patterns from CI (ci.yml lines 382-387)
JEST_THRESHOLD_PATTERN = re.compile(
    r"^\+.*(?:statements|branches|functions|lines):", re.MULTILINE
)
PYTHON_THRESHOLD_PATTERN = re.compile(r"^\+.*fail_under", re.MULTILINE)

THRESHOLD_FILES = {
    "extension/jest.config.ts": JEST_THRESHOLD_PATTERN,
    "pyproject.toml": PYTHON_THRESHOLD_PATTERN,
}


def git_output(*args: str) -> str:
    command = ["git", *args]
    result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    return result.stdout


def check_threshold_changes(base_ref: str) -> int:
    # Stage 1: Which threshold files changed? (same as CI line 371-372)
    changed_files = git_output("diff", f"{base_ref}...HEAD", "--name-only")
    touched = [f for f in THRESHOLD_FILES if f in changed_files.splitlines()]

    if not touched:
        print("[OK] No threshold configuration files changed")
        return 0

    # Stage 2: Did actual threshold VALUES change? (same as CI lines 382-392)
    threshold_changed = False
    for filepath in touched:
        diff = git_output("diff", f"{base_ref}...HEAD", "--", filepath)
        pattern = THRESHOLD_FILES[filepath]
        if pattern.search(diff):
            threshold_changed = True
            print(f"Threshold values changed in {filepath}")

    if not threshold_changed:
        print("[OK] Config files changed but no threshold values modified")
        return 0

    # Stage 3: Check for [threshold-update] marker (same as CI lines 399-400)
    log = git_output("log", "--oneline", f"{base_ref}..HEAD")
    if "[threshold-update]" in log:
        print("[OK] Threshold change approved via [threshold-update] marker")
        return 0

    print("")
    print("Coverage threshold changed without [threshold-update] marker")
    print(
        "Add [threshold-update] to a commit SUBJECT line if this change "
        "is intentional (scanned via `git log --oneline`; markers in "
        "commit bodies are NOT honored)."
    )
    print("")
    print("See: extension/COVERAGE_RATCHET.md for threshold update policy")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check for coverage threshold changes requiring approval."
    )
    parser.add_argument(
        "--base-ref",
        default="origin/main",
        help="Base ref to diff against (default: origin/main)",
    )
    args = parser.parse_args()
    return check_threshold_changes(args.base_ref)


if __name__ == "__main__":
    raise SystemExit(main())
