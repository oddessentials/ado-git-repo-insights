#!/usr/bin/env python3
"""Prevent committing files containing environment variable values.

This pre-commit hook detects when staged files contain actual values of
protected environment variables, preventing accidental secret exposure.

Complements gitleaks (pattern-based) with value-based detection.

Security properties:
- Validates git executable via `git --version` output (behavior check)
- Fail-closed: exits non-zero if ANY file cannot be scanned
- No silent bypasses: file errors cause immediate failure
"""

import os
import re
import shutil
import subprocess
import sys

# Environment variables to protect from accidental commits
PROTECTED_VARS = ["ADO_PAT", "OPENAI_API_KEY", "AZURE_DEVOPS_TOKEN"]


def validate_git() -> str:
    """Validate git executable via behavior check.

    Returns:
        Full path to validated git executable

    Exits:
        Non-zero if git not found or validation fails
    """
    git_path = shutil.which("git")
    if not git_path:
        print("::error::git not found in PATH")
        sys.exit(1)

    # Behavior validation: run git --version and check output pattern
    try:
        result = subprocess.run(  # noqa: S603
            [git_path, "--version"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        if not re.match(r"git version \d+\.\d+", result.stdout):
            print(f"::error::Invalid git executable at {git_path}")
            print(f"  Expected 'git version X.Y.Z', got: {result.stdout.strip()}")
            sys.exit(1)
    except subprocess.TimeoutExpired:
        print(f"::error::git --version timed out at {git_path}")
        sys.exit(1)
    except OSError as e:
        print(f"::error::Failed to execute git at {git_path}: {e}")
        sys.exit(1)

    return git_path


def main() -> int:
    """Check staged files for environment variable values.

    Returns:
        0 if no secrets found, 1 if secrets detected

    Security: Fail-closed behavior - exits non-zero on any file error
    """
    # Validate git executable via behavior check
    git_path = validate_git()

    for var in PROTECTED_VARS:
        value = os.environ.get(var)
        # Skip if not set or too short to be meaningful
        if not value or len(value) < 8:
            continue

        # Get list of staged files (S603: git_path is validated above)
        result = subprocess.run(  # noqa: S603
            [git_path, "diff", "--cached", "--name-only"],
            capture_output=True,
            text=True,
            check=False,
        )

        for file in result.stdout.strip().split("\n"):
            if not file or not os.path.isfile(file):
                continue

            # Fail-closed: any file error causes immediate exit
            try:
                with open(file, encoding="utf-8") as f:
                    content = f.read()
            except FileNotFoundError:
                print(f"::error::File not found (deleted?): {file}")
                print("  Commit blocked: cannot verify file is secret-free")
                return 1
            except PermissionError:
                print(f"::error::Permission denied: {file}")
                print("  Commit blocked: cannot verify file is secret-free")
                return 1
            except UnicodeDecodeError:
                print(f"::error::Cannot decode file (binary?): {file}")
                print("  Commit blocked: cannot verify file is secret-free")
                return 1
            except OSError as e:
                print(f"::error::Cannot read file {file}: {e}")
                print("  Commit blocked: cannot verify file is secret-free")
                return 1

            if value in content:
                print(f"::error::{var} value found in {file}")
                print("  Commit blocked to prevent secret exposure.")
                print("  Remove the secret value and try again.")
                return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
