"""Tests for scripts/audit-suppressions.py.

Tests the suppression audit functionality including:
- File exclusion patterns (directories and file patterns)
- Live constant verification against the script's actual values
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

# Path to the audit script
AUDIT_SCRIPT = Path(__file__).parent.parent.parent / "scripts" / "audit-suppressions.py"

# Import the live constants and functions directly from the script
# so tests always validate the script's actual behavior, not stale copies.
_spec = importlib.util.spec_from_file_location("audit_suppressions", AUDIT_SCRIPT)
_audit_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_audit_module)

EXCLUDED_DIRS = _audit_module.EXCLUDED_DIRS
EXCLUDED_FILE_PATTERNS = _audit_module.EXCLUDED_FILE_PATTERNS
is_excluded = _audit_module.is_excluded
scan_file = _audit_module.scan_file


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

    def test_does_not_exclude_type_test_files(self) -> None:
        """Type-test files must NOT be excluded — zero-suppression policy.

        The *.type-test.ts exclusion was removed in 043-zero-suppressions.
        All files are now scanned equally (FR-023, FR-024).
        """
        path = Path("extension/tests/types/rollup.type-test.ts")
        assert is_excluded(path) is False, (
            "*.type-test.ts must not be excluded — zero-suppression policy"
        )

    def test_does_not_exclude_type_test_files_any_directory(self) -> None:
        """Type-test files must be scanned regardless of directory."""
        path = Path("some/other/path/foo.type-test.ts")
        assert is_excluded(path) is False, (
            "*.type-test.ts must not be excluded in any directory"
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

    def test_excluded_file_patterns_covers_non_source_files(self) -> None:
        """EXCLUDED_FILE_PATTERNS prevents false positives from docs, snapshots, locks.

        These patterns exclude files that may contain suppression keywords
        in non-code context (markdown prose, serialized snapshots, lockfile
        dependency metadata). Source files are never excluded.
        """
        expected = {"*.md", "*.snap", "*.lock", "pnpm-lock.yaml", "package-lock.json"}
        assert EXCLUDED_FILE_PATTERNS == expected, (
            f"EXCLUDED_FILE_PATTERNS mismatch, got: {EXCLUDED_FILE_PATTERNS}"
        )

    def test_type_test_pattern_not_in_exclusions(self) -> None:
        """*.type-test.ts must not be in exclusion set (removed in 043)."""
        assert "*.type-test.ts" not in EXCLUDED_FILE_PATTERNS


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

    def test_diff_allows_negative_delta_against_nonzero_external_baseline(
        self, tmp_path: Path
    ) -> None:
        """Migration case: external baseline with total>0 must allow reduction.

        When CI runs --diff --baseline /tmp/main-baseline.json and main still
        has total:50, the branch scan yielding 0 must produce delta:-50 (PASS),
        NOT fail because the loaded baseline is non-zero.
        """
        repo_root = Path(__file__).parent.parent.parent
        baseline_path = tmp_path / "nonzero_baseline.json"
        baseline_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "generated_at": "2026-03-22T00:00:00Z",
                    "total": 50,
                    "by_scope": {
                        "python-backend": 9,
                        "typescript-extension": 36,
                        "typescript-tests": 5,
                    },
                    "by_type": {
                        "eslint-disable-block": 2,
                        "eslint-disable-line": 0,
                        "eslint-disable-next-line": 38,
                        "noqa": 9,
                        "ts-expect-error": 1,
                        "ts-ignore": 0,
                        "type-ignore": 0,
                    },
                    "by_file": {
                        "extension/tests/dashboard.test.ts": 1,
                        "extension/tests/helpers/fs-test-utils.ts": 1,
                        "extension/tests/production-issues.test.ts": 2,
                        "extension/tests/smoke/negative-fixture.smoke.ts": 1,
                        "extension/ui/artifact-client.ts": 3,
                        "extension/ui/dashboard.ts": 1,
                        "extension/ui/dataset-loader.ts": 2,
                        "extension/ui/error-codes.ts": 1,
                        "extension/ui/modules/charts/cycle-time.ts": 1,
                        "extension/ui/modules/charts/predictions.ts": 4,
                        "extension/ui/modules/charts/summary-cards.ts": 2,
                        "extension/ui/modules/dom.ts": 5,
                        "extension/ui/modules/metrics.ts": 1,
                        "extension/ui/modules/ml.ts": 1,
                        "extension/ui/modules/shared/format.ts": 2,
                        "extension/ui/modules/shared/security.ts": 1,
                        "extension/ui/modules/typeahead-dropdown.ts": 2,
                        "extension/ui/schemas/utils.ts": 1,
                        "extension/ui/types.ts": 9,
                        "src/ado_git_repo_insights/cli.py": 2,
                        "src/ado_git_repo_insights/ml/__init__.py": 1,
                        "src/ado_git_repo_insights/persistence/database.py": 2,
                        "src/ado_git_repo_insights/transform/aggregators.py": 2,
                        "src/ado_git_repo_insights/transform/csv_generator.py": 1,
                        "src/ado_git_repo_insights/utils/run_summary.py": 1,
                    },
                    "by_rule": {
                        "@typescript-eslint/no-explicit-any": 9,
                        "F401": 3,
                        "S311": 2,
                        "S603": 1,
                        "S607": 1,
                        "S608": 1,
                        "UP006": 2,
                        "prefer-const": 3,
                        "security/detect-object-injection": 26,
                    },
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        env = self._local_env()
        result = subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--diff",
                "--baseline",
                str(baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=repo_root,
            env=env,
        )
        assert result.returncode == 0, (
            f"Expected pass (negative delta) but got rc={result.returncode}.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert (
            "reduced" in result.stdout.lower()
            or "no suppression" in result.stdout.lower()
        )

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


class TestSuppressionPatternDetection:
    """Verify that each suppression family is detected and non-matching text is safe.

    Each test creates a temp file in the correct scope directory, scans it,
    and checks whether the pattern was detected.
    """

    REPO_ROOT = Path(__file__).parent.parent.parent

    def _scan_ts_content(self, content: str, tmp_path: Path, scope: str) -> int:
        """Write content to a .ts temp file and return suppression count."""
        if scope == "typescript-tests":
            target_dir = self.REPO_ROOT / "extension" / "tests"
        else:
            target_dir = self.REPO_ROOT / "extension" / "ui"
        test_file = target_dir / f"_audit_test_{id(content)}.ts"
        test_file.write_text(content, encoding="utf-8")
        try:
            results = scan_file(test_file, scope, self.REPO_ROOT)
            return len(results)
        finally:
            test_file.unlink(missing_ok=True)

    def _scan_py_content(self, content: str) -> int:
        """Write content to a .py temp file in src/ and return suppression count."""
        target_dir = self.REPO_ROOT / "src"
        test_file = target_dir / f"_audit_test_{id(content)}.py"
        test_file.write_text(content, encoding="utf-8")
        try:
            results = scan_file(test_file, "python-backend", self.REPO_ROOT)
            return len(results)
        finally:
            test_file.unlink(missing_ok=True)

    # ── Coverage suppressions ─────────────────────────────────────

    def test_istanbul_ignore_detected(self, tmp_path: Path) -> None:
        """istanbul ignore next in a comment → detected."""
        count = self._scan_ts_content(
            "/* istanbul ignore next */\nconst x = 1;\n",
            tmp_path,
            "typescript-extension",
        )
        assert count == 1

    def test_istanbul_in_prose_not_detected(self, tmp_path: Path) -> None:
        """The word 'istanbul' in normal text → NOT detected."""
        count = self._scan_ts_content(
            "// the istanbul bridge was built in 1973\n",
            tmp_path,
            "typescript-extension",
        )
        assert count == 0

    def test_c8_ignore_detected(self, tmp_path: Path) -> None:
        """c8 ignore next in a comment → detected."""
        count = self._scan_ts_content(
            "/* c8 ignore next */\nconst x = 1;\n",
            tmp_path,
            "typescript-extension",
        )
        assert count == 1

    def test_c8_ignore_with_double_space_detected(self, tmp_path: Path) -> None:
        """/* c8  ignore next */ with double space → detected."""
        count = self._scan_ts_content(
            "/* c8  ignore next */\nconst x = 1;\n",
            tmp_path,
            "typescript-extension",
        )
        assert count == 1

    def test_c8_in_prose_not_detected(self, tmp_path: Path) -> None:
        """The text 'c8' without ignore pattern → NOT detected."""
        count = self._scan_ts_content(
            "// c8 is a coverage tool\n",
            tmp_path,
            "typescript-extension",
        )
        assert count == 0

    # ── Test escapes ──────────────────────────────────────────────

    def test_it_only_detected(self, tmp_path: Path) -> None:
        """it.only( → detected in test scope."""
        count = self._scan_ts_content(
            'it.only("focused test", () => {});\n',
            tmp_path,
            "typescript-tests",
        )
        assert count == 1

    def test_it_only_each_detected(self, tmp_path: Path) -> None:
        """it.only.each() → detected (Jest parameterized variant)."""
        count = self._scan_ts_content(
            "it.only.each([1, 2])('test %i', (n) => {});\n",
            tmp_path,
            "typescript-tests",
        )
        assert count == 1

    def test_test_skip_each_detected(self, tmp_path: Path) -> None:
        """test.skip.each() → detected (Jest parameterized variant)."""
        count = self._scan_ts_content(
            "test.skip.each([1, 2])('test %i', (n) => {});\n",
            tmp_path,
            "typescript-tests",
        )
        assert count == 1

    def test_only_with_space_before_paren_detected(self, tmp_path: Path) -> None:
        """it.only ("x") with space before paren → detected."""
        count = self._scan_ts_content(
            'it.only ("focused test", () => {});\n',
            tmp_path,
            "typescript-tests",
        )
        assert count == 1

    def test_only_property_not_detected(self, tmp_path: Path) -> None:
        """result.only without parens → NOT detected."""
        count = self._scan_ts_content(
            "const x = result.only;\n",
            tmp_path,
            "typescript-tests",
        )
        assert count == 0

    def test_skip_property_not_detected(self, tmp_path: Path) -> None:
        """result.skip_count without call syntax → NOT detected."""
        count = self._scan_ts_content(
            "const x = result.skip_count;\n",
            tmp_path,
            "typescript-tests",
        )
        assert count == 0

    # ── ts-nocheck ────────────────────────────────────────────────

    def test_ts_nocheck_detected(self, tmp_path: Path) -> None:
        """// @ts-nocheck → detected."""
        count = self._scan_ts_content(
            "// @ts-nocheck\nconst x = 1;\n",
            tmp_path,
            "typescript-extension",
        )
        assert count == 1

    def test_ts_nocheck_prose_not_detected(self, tmp_path: Path) -> None:
        """ts-nocheck without @ → NOT detected."""
        count = self._scan_ts_content(
            "// ts-nocheck is documented here\n",
            tmp_path,
            "typescript-extension",
        )
        assert count == 0

    # ── Python suppressions ───────────────────────────────────────

    def test_type_ignore_detected(self) -> None:
        """# type: ignore in a Python file → detected."""
        count = self._scan_py_content(
            "x = foo()  # type: ignore[attr-defined]\n",
        )
        assert count == 1

    def test_type_ignore_prose_not_detected(self) -> None:
        """The words 'type' and 'ignore' in normal prose → NOT detected."""
        count = self._scan_py_content(
            "# The type system ignores this pattern\n",
        )
        assert count == 0

    def test_noqa_detected(self) -> None:
        """# noqa in a Python file → detected."""
        count = self._scan_py_content(
            "import os  # noqa: F401\n",
        )
        assert count == 1

    def test_noqa_prose_not_detected(self) -> None:
        """The word 'noqa' in normal prose without # prefix → NOT detected."""
        count = self._scan_py_content(
            "# See noqa documentation for details\n",
        )
        assert count == 0
