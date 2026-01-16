"""CI guard: verify SUMMARY.md test references exist.

This test prevents documentation drift by ensuring all test files
referenced in SUMMARY.md actually exist in the tests/ directory.
"""

from __future__ import annotations

import re
from pathlib import Path


class TestSummaryDriftGuard:
    """CI guard to prevent SUMMARY.md from referencing non-existent tests."""

    def test_summary_test_file_references_exist(self) -> None:
        """All test files cited in SUMMARY.md must exist."""
        # Find project root (tests/unit -> project root)
        project_root = Path(__file__).parent.parent.parent
        summary_path = project_root / "SUMMARY.md"
        tests_path = project_root / "tests"

        if not summary_path.exists():
            # Skip if SUMMARY.md doesn't exist (e.g., in package-only installs)
            return

        content = summary_path.read_text(encoding="utf-8")

        # Match patterns like `test_*.py` (backtick-wrapped test file names)
        test_file_refs = re.findall(r"`(test_\w+\.py)`", content)

        missing = []
        for ref in test_file_refs:
            matches = list(tests_path.rglob(ref))
            if not matches:
                missing.append(ref)

        assert not missing, (
            f"SUMMARY.md references test files that don't exist: {missing}\n"
            "Either create the missing tests or update the documentation."
        )

    def test_summary_test_class_references_exist(self) -> None:
        """Test classes cited in SUMMARY.md should exist in their files."""
        project_root = Path(__file__).parent.parent.parent
        summary_path = project_root / "SUMMARY.md"
        tests_path = project_root / "tests"

        if not summary_path.exists():
            return

        content = summary_path.read_text(encoding="utf-8")

        # Match patterns like `test_foo.py::TestClassName`
        class_refs = re.findall(r"`(test_\w+\.py)::(Test\w+)`", content)

        missing = []
        for file_name, class_name in class_refs:
            # Find the file
            matches = list(tests_path.rglob(file_name))
            if not matches:
                missing.append(f"{file_name}::{class_name}")
                continue

            # Read file and check for class def
            file_content = matches[0].read_text(encoding="utf-8")
            if f"class {class_name}" not in file_content:
                missing.append(f"{file_name}::{class_name}")

        assert not missing, (
            f"SUMMARY.md references test classes that don't exist: {missing}\n"
            "Either create the missing tests or update the documentation."
        )
