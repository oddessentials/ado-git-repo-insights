#!/usr/bin/env python3
"""Prevent committing files containing environment variable values.

This pre-commit hook detects when staged files contain actual values of
protected environment variables, preventing accidental secret exposure.

Complements gitleaks (pattern-based) with value-based detection.
"""

import os
import shutil
import subprocess
import sys

# Environment variables to protect from accidental commits
PROTECTED_VARS = ["ADO_PAT", "OPENAI_API_KEY", "AZURE_DEVOPS_TOKEN"]


def main() -> int:
    """Check staged files for environment variable values.

    Returns:
        0 if no secrets found, 1 if secrets detected
    """
    # Find git executable - S607 requires full path for security
    git_path = shutil.which("git")
    if not git_path:
        print("::error::git not found in PATH")
        return 1

    for var in PROTECTED_VARS:
        value = os.environ.get(var)
        # Skip if not set or too short to be meaningful
        if not value or len(value) < 8:
            continue

        # Get list of staged files (S603: git_path is from shutil.which, trusted)
        result = subprocess.run(  # noqa: S603
            [git_path, "diff", "--cached", "--name-only"],
            capture_output=True,
            text=True,
            check=False,  # Don't raise on non-zero exit
        )

        for file in result.stdout.strip().split("\n"):
            if not file or not os.path.isfile(file):
                continue
            try:
                with open(file, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    if value in content:
                        print(f"::error::{var} value found in {file}")
                        print("  Commit blocked to prevent secret exposure.")
                        print("  Remove the secret value and try again.")
                        return 1
            except OSError:
                # Skip files that can't be read
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
