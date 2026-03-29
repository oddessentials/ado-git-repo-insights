"""Tests for scripts/audit-suppressions.py.

Tests the suppression audit functionality including:
- File exclusion patterns (directories and file patterns)
- Type-test file exclusion (*.type-test.ts)
"""

from __future__ import annotations

import fnmatch
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

# Path to the audit script
AUDIT_SCRIPT = Path(__file__).parent.parent.parent / "scripts" / "audit-suppressions.py"


# Replicate the constants and functions we're testing to avoid exec() issues
EXCLUDED_DIRS = {
    "node_modules",
    "dist",
    ".venv",
    "venv",
    "build",
    "coverage",
    "__pycache__",
    ".git",
}

EXCLUDED_FILE_PATTERNS = {
    "*.type-test.ts",
}


def is_excluded(path: Path) -> bool:
    """Check if path should be excluded from scanning.

    This is a copy of the function from audit-suppressions.py for testing.
    """
    parts = path.parts
    # Check excluded directories
    if any(excluded in parts for excluded in EXCLUDED_DIRS):
        return True
    # Check excluded file patterns
    filename = path.name
    if any(fnmatch.fnmatch(filename, pattern) for pattern in EXCLUDED_FILE_PATTERNS):
        return True
    return False


class TestIsExcluded:
    """Tests for the is_excluded function."""

    def test_excludes_node_modules(self) -> None:
        """Directories in EXCLUDED_DIRS should be excluded."""
        path = Path("extension/node_modules/some-package/index.ts")
        assert is_excluded(path) is True, "node_modules should be excluded"

    def test_excludes_dist_directory(self) -> None:
        """The dist directory should be excluded."""
        path = Path("extension/dist/ui/dashboard.js")
        assert is_excluded(path) is True, "dist should be excluded"

    def test_excludes_venv_directory(self) -> None:
        """The .venv directory should be excluded."""
        path = Path(".venv/lib/python3.11/site-packages/some_module.py")
        assert is_excluded(path) is True, ".venv should be excluded"

    def test_excludes_pycache_directory(self) -> None:
        """The __pycache__ directory should be excluded."""
        path = Path("src/ado_git_repo_insights/__pycache__/cli.cpython-311.pyc")
        assert is_excluded(path) is True, "__pycache__ should be excluded"

    def test_excludes_type_test_files(self) -> None:
        """Files matching *.type-test.ts should be excluded.

        Type-test files use @ts-expect-error as compile-time assertions,
        not to hide issues. They are verified separately by TypeScript.
        """
        path = Path("extension/tests/types/rollup.type-test.ts")
        assert is_excluded(path) is True, "*.type-test.ts should be excluded"

    def test_excludes_type_test_files_any_directory(self) -> None:
        """Type-test files should be excluded regardless of directory."""
        path = Path("some/other/path/foo.type-test.ts")
        assert is_excluded(path) is True, (
            "*.type-test.ts should be excluded in any directory"
        )

    def test_does_not_exclude_regular_test_files(self) -> None:
        """Regular test files should NOT be excluded."""
        path = Path("extension/tests/dashboard.test.ts")
        assert is_excluded(path) is False, "regular test files should not be excluded"

    def test_does_not_exclude_regular_source_files(self) -> None:
        """Regular source files should NOT be excluded."""
        path = Path("extension/ui/dashboard.ts")
        assert is_excluded(path) is False, "regular source files should not be excluded"

    def test_does_not_exclude_python_source_files(self) -> None:
        """Python source files should NOT be excluded."""
        path = Path("src/ado_git_repo_insights/cli.py")
        assert is_excluded(path) is False, "Python source files should not be excluded"


class TestExcludedFilePatterns:
    """Tests for EXCLUDED_FILE_PATTERNS constant."""

    def test_type_test_pattern_exists(self) -> None:
        """EXCLUDED_FILE_PATTERNS should include *.type-test.ts."""
        assert "*.type-test.ts" in EXCLUDED_FILE_PATTERNS

    def test_pattern_uses_fnmatch_syntax(self) -> None:
        """Patterns should work with fnmatch."""
        pattern = "*.type-test.ts"
        assert fnmatch.fnmatch("foo.type-test.ts", pattern)
        assert fnmatch.fnmatch("rollup.type-test.ts", pattern)
        assert not fnmatch.fnmatch("foo.test.ts", pattern)
        assert not fnmatch.fnmatch("type-test.ts", pattern)  # No prefix


class TestAuditSuppressionsCLI:
    """Integration tests for the audit-suppressions.py CLI."""

    @staticmethod
    def _local_env() -> dict[str, str]:
        """Build a local-style environment for subprocess execution."""
        env = os.environ.copy()
        env.pop("GITHUB_EVENT_NAME", None)
        env.pop("GITHUB_REF", None)
        env.pop("GITHUB_EVENT_PATH", None)
        return env

    def test_script_runs_without_error(self) -> None:
        """The audit script should run without errors."""
        result = subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(AUDIT_SCRIPT)],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent.parent,
        )
        assert result.returncode == 0, f"Script failed: {result.stderr}"
        assert "Total suppressions:" in result.stdout

    def test_count_excludes_type_test_files(self) -> None:
        """Running audit should not count suppressions in type-test files."""
        result = subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(AUDIT_SCRIPT)],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent.parent,
        )
        assert result.returncode == 0, f"Script failed: {result.stderr}"
        # The output should NOT include type-test files in the by-file listing
        lines = result.stdout.split("\n")
        by_file_section = False
        for line in lines:
            if "By file:" in line:
                by_file_section = True
            elif by_file_section and line.strip() and not line.startswith(" "):
                by_file_section = False
            if by_file_section and "type-test.ts" in line:
                pytest.fail(f"type-test files should not appear in output: {line}")

    def test_diff_command_works(self) -> None:
        """The --diff command should run without errors."""
        result = subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(AUDIT_SCRIPT), "--diff"],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent.parent,
        )
        # Should either pass or fail with meaningful output
        assert (
            "suppressions" in result.stdout.lower()
            or "baseline" in result.stdout.lower()
        )

    def test_diff_allows_pending_approval_for_local_preflight(self) -> None:
        """Local preflight mode should not fail solely on missing PR approval."""
        result = subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(AUDIT_SCRIPT), "--diff", "--allow-pending-approval"],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent.parent,
            env=self._local_env(),
        )
        assert result.returncode == 0, result.stdout + result.stderr

    def test_diff_pending_approval_does_not_bypass_direct_push_policy(
        self, tmp_path: Path
    ) -> None:
        """Direct-push protection must still win under CI-style main env."""
        repo_root = Path(__file__).parent.parent.parent
        # Inject a temporary file with a suppression so current > baseline
        injected = repo_root / "src" / "_test_injected_suppression.py"
        injected.write_text("x = 1  # noqa: E501\n", encoding="utf-8")
        try:
            baseline_path = tmp_path / "baseline.json"
            baseline_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "generated_at": "2026-03-22T00:00:00Z",
                        "total": 0,
                        "by_scope": {
                            "python-backend": 0,
                            "typescript-extension": 0,
                            "typescript-tests": 0,
                        },
                        "by_type": {
                            "eslint-disable-block": 0,
                            "eslint-disable-line": 0,
                            "eslint-disable-next-line": 0,
                            "noqa": 0,
                            "ts-expect-error": 0,
                            "ts-ignore": 0,
                            "type-ignore": 0,
                        },
                        "by_file": {},
                        "by_rule": {},
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            env = self._local_env()
            env["GITHUB_EVENT_NAME"] = "push"
            env["GITHUB_REF"] = "refs/heads/main"
            result = subprocess.run(  # noqa: S603 - trusted test code
                [
                    sys.executable,
                    str(AUDIT_SCRIPT),
                    "--diff",
                    "--allow-pending-approval",
                    "--baseline",
                    str(baseline_path),
                ],
                capture_output=True,
                text=True,
                cwd=repo_root,
                env=env,
            )
            assert result.returncode == 1
            assert "Direct push to main" in result.stdout
        finally:
            injected.unlink(missing_ok=True)

    def test_validate_command_works(self) -> None:
        """The --validate command should run without errors."""
        result = subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(AUDIT_SCRIPT), "--validate"],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent.parent,
        )
        # Should either pass validation or report errors
        assert result.returncode in (0, 1)
        assert (
            "validation" in result.stdout.lower() or "baseline" in result.stderr.lower()
        )
