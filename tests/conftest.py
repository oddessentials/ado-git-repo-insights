"""Root test conftest — platform-conditional collection.

Excludes Windows-only test files from collection on non-Windows
platforms so they are never counted as skipped (CI zero-skip policy).
"""

import sys

collect_ignore_glob: list[str] = []

if sys.platform != "win32":
    collect_ignore_glob.append("**/test_*_windows.py")
