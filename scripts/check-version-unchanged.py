#!/usr/bin/env python3
"""Version guard — blocks manual version bumps.

Fails if any semantic-release managed version fields differ from the
base branch. Prevents accidental manual version bumps that conflict
with automated releases.

Bypass: Add [version-override-acknowledged] to a commit message on the
branch. This works identically in local pre-push and CI.

Direct pushes to main with version changes are NEVER allowed, even
with the marker.

Usage: python scripts/check-version-unchanged.py [base-branch]
Default base-branch: origin/main
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

MARKER = "[version-override-acknowledged]"

# Version files managed by semantic-release
VERSION_FILES = [
    "VERSION",
    "package.json",
    "extension/vss-extension.json",
    "extension/tasks/extract-prs/task.json",
]


def get_current_version(file_path: str) -> str:
    """Read the current version from a version-managed file."""
    if file_path == "VERSION":
        return Path(file_path).read_text(encoding="utf-8").strip()

    with open(file_path, encoding="utf-8") as f:
        data = json.load(f)

    if file_path == "extension/tasks/extract-prs/task.json":
        v = data["version"]
        return f"{v['Major']}.{v['Minor']}.{v['Patch']}"

    return str(data["version"])


def get_base_version(base_branch: str, file_path: str) -> str | None:
    """Read a version from the base branch via git show."""
    try:
        result = subprocess.run(  # noqa: S603 - trusted git invocation
            ["git", "show", f"{base_branch}:{file_path}"],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError:
        return None

    content = result.stdout
    if file_path == "VERSION":
        return content.strip()

    data = json.loads(content)
    if file_path == "extension/tasks/extract-prs/task.json":
        v = data["version"]
        return f"{v['Major']}.{v['Minor']}.{v['Patch']}"

    return str(data["version"])


def check_commit_marker(base_branch: str) -> bool:
    """Check if any commit on the branch contains the bypass marker.

    Scans git log for commits reachable from HEAD but not from the
    base branch (two-dot range). This ensures only branch-local
    commits are inspected — markers on the base branch do not leak
    into the scan.
    """
    try:
        result = subprocess.run(  # noqa: S603 - trusted git invocation
            ["git", "log", "--oneline", f"{base_branch}..HEAD"],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError:
        return False

    return MARKER in result.stdout


def is_direct_push_to_main() -> bool:
    """Check if this is a direct push to main (not a PR)."""
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    ref = os.environ.get("GITHUB_REF", "")
    return event_name == "push" and ref in (
        "refs/heads/main",
        "refs/heads/master",
    )


def main() -> int:
    """Run the version guard check."""
    base_branch = sys.argv[1] if len(sys.argv) > 1 else "origin/main"

    print(f"Checking version fields against {base_branch}...")
    print()

    failed = False

    for file_path in VERSION_FILES:
        if not Path(file_path).is_file():
            print(f"[WARN]  {file_path} not found, skipping")
            continue

        current = get_current_version(file_path)
        base = get_base_version(base_branch, file_path)

        if base is None:
            print(f"[WARN]  {file_path} not in {base_branch}, skipping")
            continue

        if current != base:
            print(f"[FAIL] {file_path}: version changed ({base} -> {current})")
            print(
                "   Manual version bumps are not allowed."
                " semantic-release handles versioning."
            )
            failed = True
        else:
            print(f"[OK]  {file_path}: {current} (unchanged)")

    print()

    if not failed:
        print("All version fields unchanged. [OK]")
        return 0

    # Direct pushes to main with version changes are NEVER allowed
    if is_direct_push_to_main():
        print("ERROR: Direct push to main with version changes is not allowed.")
        print("Version fields are managed exclusively by semantic-release.")
        return 1

    # Check for commit message marker
    if check_commit_marker(base_branch):
        print(f"Version override approved via commit marker ({MARKER}).")
        print("Proceeding with manual version changes.")
        return 0

    print("ERROR: Version fields were manually modified.")
    print()
    print(
        "These files are managed by semantic-release"
        " and should not be changed manually:"
    )
    for file_path in VERSION_FILES:
        print(f"  - {file_path}")
    print()
    print(
        "To fix: revert the version changes and let semantic-release handle versioning."
    )
    print(f"If this is intentional (e.g., marketplace recovery), add {MARKER}")
    print("to a commit message on this branch.")
    print()
    print("MANUAL ONLY: NO AGENT OVERRIDES.")
    print("A human must add this marker by hand after verifying the")
    print("version change is correct. Automated tools must not bypass")
    print("this guard.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
