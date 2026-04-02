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
SCOPES = _audit_module.SCOPES
is_excluded = _audit_module.is_excluded
scan_file = _audit_module.scan_file
_resolve_scope = _audit_module._resolve_scope
has_tokenize_errors = _audit_module.has_tokenize_errors


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


class TestCanonicalScopeMap:
    """Tests for the canonical SCOPES map and _resolve_scope() (FR-028)."""

    def test_every_scope_has_required_fields(self) -> None:
        """Each scope config must have dir, pattern, and language."""
        for name, cfg in SCOPES.items():
            assert "dir" in cfg, f"Scope {name} missing 'dir'"
            assert "pattern" in cfg, f"Scope {name} missing 'pattern'"
            assert "language" in cfg, f"Scope {name} missing 'language'"
            assert cfg["language"] in (
                "python",
                "typescript",
            ), f"Scope {name} has invalid language: {cfg['language']}"

    def test_scope_dirs_end_with_slash(self) -> None:
        """Scope directories must end with '/' for prefix matching."""
        for name, cfg in SCOPES.items():
            assert cfg["dir"].endswith("/"), (
                f"Scope {name} dir '{cfg['dir']}' must end with '/'"
            )

    def test_resolve_scope_for_known_paths(self) -> None:
        """Files in known directories resolve to the correct scope."""
        # Python scopes
        assert _resolve_scope("src/foo.py") == "python-backend"
        assert _resolve_scope("scripts/bar.py") == "python-scripts"
        assert _resolve_scope("tests/unit/test_x.py") == "python-tests"
        assert _resolve_scope(".github/scripts/gen.py") == "python-ci-scripts"
        # TypeScript scopes
        assert _resolve_scope("extension/ui/dashboard.ts") == "typescript-extension"
        assert _resolve_scope("extension/tests/foo.test.ts") == "typescript-tests"
        assert _resolve_scope("extension/tasks/_shared/index.ts") == "typescript-tasks"
        assert (
            _resolve_scope("extension/scripts/perf.ts")
            == "typescript-extension-scripts"
        )
        assert (
            _resolve_scope("extension/jest.config.ts") == "typescript-extension-config"
        )
        assert _resolve_scope("scripts/validate.ts") == "typescript-root-scripts"
        assert (
            _resolve_scope("specs/009/contracts/schema.ts")
            == "typescript-spec-contracts"
        )
        # Mixed-language directory: scripts/ has both .py and .ts scopes
        assert _resolve_scope("scripts/foo.py") == "python-scripts"
        assert _resolve_scope("scripts/foo.ts") == "typescript-root-scripts"

    def test_resolve_scope_returns_none_for_unknown_path(self) -> None:
        """Files outside all scopes return None (hard error in callers)."""
        assert _resolve_scope("tools/unknown.py") is None
        assert _resolve_scope("unknown.py") is None

    def test_resolve_scope_longest_prefix_wins(self) -> None:
        """Nested scopes resolve to the most specific match."""
        # extension/tests/ must match typescript-tests, not a hypothetical
        # extension/ scope. This test ensures longest-prefix-first logic.
        assert _resolve_scope("extension/tests/unit/foo.test.ts") == "typescript-tests"

    def test_overlapping_scopes_resolve_to_longest_prefix(self) -> None:
        """Nested scopes (e.g., extension/ and extension/ui/) resolve correctly.

        When scopes have overlapping directory prefixes, _resolve_scope must
        always return the most specific (longest prefix) match. This test
        verifies that every scope's own directory resolves to itself, not to
        a shorter parent scope.
        """
        for scope_name, scope_cfg in SCOPES.items():
            # Use the correct extension for the scope's file pattern
            ext = ".py" if scope_cfg["pattern"] == "*.py" else ".ts"
            test_path = scope_cfg["dir"] + "test_file" + ext
            resolved = _resolve_scope(test_path)
            assert resolved == scope_name, (
                f"File in '{scope_cfg['dir']}' resolved to '{resolved}', "
                f"expected '{scope_name}'"
            )


class TestCheckCoverage:
    """Tests for --check-coverage file enumeration (FR-018, FR-026)."""

    REPO_ROOT = Path(__file__).parent.parent.parent

    def test_check_coverage_passes_on_real_repo(self) -> None:
        """T018: all tracked .py/.ts files in the real repo are scoped."""
        result = subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(AUDIT_SCRIPT), "--check-coverage"],
            capture_output=True,
            text=True,
            cwd=self.REPO_ROOT,
        )
        assert result.returncode == 0, (
            f"Coverage check failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )

    def test_check_coverage_fails_for_unscoped_file(self, tmp_path: Path) -> None:
        """T017: unscoped .py file causes exit code 1 with path listed."""
        import shutil

        # Create a minimal git repo with an unscoped .py file
        subprocess.run(  # noqa: S603 - trusted test setup
            ["git", "init"],  # noqa: S607
            cwd=tmp_path,
            capture_output=True,
        )
        unscoped = tmp_path / "tools" / "helper.py"
        unscoped.parent.mkdir()
        unscoped.write_text("x = 1\n", encoding="utf-8")
        subprocess.run(  # noqa: S603 - trusted test setup
            ["git", "add", "tools/helper.py"],  # noqa: S607
            cwd=tmp_path,
            capture_output=True,
        )
        # Copy the audit script to tmp so it runs against this repo
        shutil.copy(AUDIT_SCRIPT, tmp_path / "audit.py")
        result = subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(tmp_path / "audit.py"), "--check-coverage"],
            capture_output=True,
            text=True,
            cwd=tmp_path,
        )
        assert result.returncode == 1, (
            f"Expected failure for unscoped file, got rc={result.returncode}\n"
            f"stdout: {result.stdout}"
        )
        assert "tools/helper.py" in result.stdout or "tools/helper.py" in result.stderr


class TestTwoPhaseGating:
    """Tests for advisory/blocking scope_policy in baseline v2 (FR-019)."""

    REPO_ROOT = Path(__file__).parent.parent.parent

    def _run_diff(
        self, baseline_path: Path, *, cwd: Path | None = None
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        for var in ("GITHUB_EVENT_NAME", "GITHUB_REF", "GITHUB_EVENT_PATH"):
            env.pop(var, None)
        return subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--diff",
                "--baseline",
                str(baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=cwd or self.REPO_ROOT,
            env=env,
        )

    def test_advisory_scope_with_suppressions_passes(self, tmp_path: Path) -> None:
        """T026: advisory scope logs warning but returns exit code 0."""
        # Generate real baseline, set new scopes to advisory
        baseline_path = tmp_path / "baseline.json"
        subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--update-baseline",
                "--baseline",
                str(baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=self.REPO_ROOT,
        )
        data = json.loads(baseline_path.read_text(encoding="utf-8"))
        # Set all scopes to advisory — any suppressions should be warnings
        data["scope_policy"] = dict.fromkeys(data["by_scope"], "advisory")
        # Set all counts to 0 so current scan shows increases
        for key in data["by_scope"]:
            data["by_scope"][key] = 0
        data["total"] = 0
        data["by_file"] = {}
        data["by_rule"] = {}
        data["by_type"] = dict.fromkeys(data["by_type"], 0)
        baseline_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

        result = self._run_diff(baseline_path)
        assert result.returncode == 0, (
            f"Advisory scopes should pass even with suppressions.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )

    def test_blocking_scope_with_increase_fails(self, tmp_path: Path) -> None:
        """T027: blocking scope with suppression increase returns exit code 1."""
        baseline_path = tmp_path / "baseline.json"
        subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--update-baseline",
                "--baseline",
                str(baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=self.REPO_ROOT,
        )
        data = json.loads(baseline_path.read_text(encoding="utf-8"))
        # Set all scopes to blocking, zero out counts → current scan shows increases
        data["scope_policy"] = dict.fromkeys(data["by_scope"], "blocking")
        for key in data["by_scope"]:
            data["by_scope"][key] = 0
        data["total"] = 0
        data["by_file"] = {}
        data["by_rule"] = {}
        data["by_type"] = dict.fromkeys(data["by_type"], 0)
        baseline_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

        result = self._run_diff(baseline_path)
        assert result.returncode == 1, (
            f"Blocking scopes with increases should fail.\nstdout: {result.stdout}"
        )

    def test_v1_baseline_treated_as_all_blocking(self, tmp_path: Path) -> None:
        """T028: v1 baseline (no scope_policy) = all blocking."""
        baseline_path = tmp_path / "baseline.json"
        subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--update-baseline",
                "--baseline",
                str(baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=self.REPO_ROOT,
        )
        data = json.loads(baseline_path.read_text(encoding="utf-8"))
        # Remove scope_policy to simulate v1, zero counts
        data.pop("scope_policy", None)
        data["version"] = 1
        for key in data["by_scope"]:
            data["by_scope"][key] = 0
        data["total"] = 0
        data["by_file"] = {}
        data["by_rule"] = {}
        data["by_type"] = dict.fromkeys(data["by_type"], 0)
        # Keep only original 3 scopes for v1
        data["by_scope"] = {
            k: v
            for k, v in data["by_scope"].items()
            if k in ("python-backend", "typescript-extension", "typescript-tests")
        }
        baseline_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

        result = self._run_diff(baseline_path)
        # v1 baseline with 3 scopes + scan with 6 scopes:
        # missing scopes treated as advisory during transition → should pass
        # OR if all are blocking → should fail for the new scopes
        # Per plan: missing scopes = advisory during transition
        # So this should PASS (the new scopes' increases are advisory)
        assert result.returncode == 0, (
            f"v1 baseline with missing scopes should treat them as advisory.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )

    def test_missing_scope_treated_as_advisory_during_transition(
        self, tmp_path: Path
    ) -> None:
        """T029: scope in scan but absent from baseline → advisory + warning."""
        baseline_path = tmp_path / "baseline.json"
        subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--update-baseline",
                "--baseline",
                str(baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=self.REPO_ROOT,
        )
        data = json.loads(baseline_path.read_text(encoding="utf-8"))
        # Remove python-tests scope to simulate partial baseline
        data["by_scope"].pop("python-tests", 0)
        # Also remove files belonging to that scope and recalculate total
        data["by_file"] = {
            k: v for k, v in data["by_file"].items() if not k.startswith("tests/")
        }
        data["total"] = sum(data["by_file"].values())
        data.pop("scope_policy", None)
        data["version"] = 1
        baseline_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

        result = self._run_diff(baseline_path)
        # Missing scope should be treated as advisory
        assert result.returncode == 0, (
            f"Missing scope should be advisory during transition.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )


class TestNewFileMultiSuppressionDelta:
    """Regression test: new files with multiple suppressions must report accurate delta."""

    REPO_ROOT = Path(__file__).parent.parent.parent

    def test_new_file_with_two_suppressions_reports_delta_2(
        self, tmp_path: Path
    ) -> None:
        """A new file with 2 noqa comments must show delta +2, not +1."""
        # Generate real baseline, then inject a new file with 2 suppressions
        baseline_path = tmp_path / "baseline.json"
        env = os.environ.copy()
        for var in ("GITHUB_EVENT_NAME", "GITHUB_REF", "GITHUB_EVENT_PATH"):
            env.pop(var, None)
        subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--update-baseline",
                "--baseline",
                str(baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=self.REPO_ROOT,
            env=env,
        )
        # Inject a new file with 2 suppressions into a blocking scope (src/)
        injected = self.REPO_ROOT / "src" / "_test_multi_suppression.py"
        injected.write_text(
            "import os  # noqa: F401\nx = 1  # noqa: E501\n",
            encoding="utf-8",
        )
        try:
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
                cwd=self.REPO_ROOT,
                env=env,
            )
            # Should fail (blocking scope increase) with accurate delta
            assert result.returncode == 1, (
                f"Expected failure, got rc={result.returncode}\nstdout: {result.stdout}"
            )
            # The output should mention +2, not +1
            assert "(+2)" in result.stdout or "delta: +2" in result.stdout.lower(), (
                f"Expected delta +2 for 2-suppression file, got:\n{result.stdout}"
            )
        finally:
            injected.unlink(missing_ok=True)


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
        has a higher total, the branch scan yielding fewer suppressions must
        produce a negative delta (PASS), NOT fail.

        Strategy: generate a real baseline from the current codebase, inflate
        its total by adding a phantom file entry, then verify --diff reports
        a negative delta.
        """
        repo_root = Path(__file__).parent.parent.parent
        # Generate a real baseline so it includes all 6 scopes
        real_baseline_path = tmp_path / "real_baseline.json"
        env = self._local_env()
        gen_result = subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--update-baseline",
                "--baseline",
                str(real_baseline_path),
            ],
            capture_output=True,
            text=True,
            cwd=repo_root,
            env=env,
        )
        assert gen_result.returncode == 0, (
            f"Baseline generation failed: {gen_result.stdout}\n{gen_result.stderr}"
        )
        # Inflate the baseline by adding a phantom file, keeping keys sorted
        baseline_data = json.loads(real_baseline_path.read_text(encoding="utf-8"))
        baseline_data["total"] += 10
        baseline_data["by_file"]["phantom/inflated.py"] = 10
        baseline_data["by_file"] = dict(sorted(baseline_data["by_file"].items()))
        baseline_data["by_scope"]["python-backend"] = (
            baseline_data["by_scope"].get("python-backend", 0) + 10
        )
        baseline_data["by_scope"] = dict(sorted(baseline_data["by_scope"].items()))
        inflated_path = tmp_path / "inflated_baseline.json"
        inflated_path.write_text(json.dumps(baseline_data, indent=2), encoding="utf-8")

        result = subprocess.run(  # noqa: S603 - trusted test code
            [
                sys.executable,
                str(AUDIT_SCRIPT),
                "--diff",
                "--baseline",
                str(inflated_path),
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

    def test_fit_detected(self, tmp_path: Path) -> None:
        """fit() focused-test alias → detected."""
        count = self._scan_ts_content(
            'fit("focused test", () => {});\n',
            tmp_path,
            "typescript-tests",
        )
        assert count == 1

    def test_fdescribe_detected(self, tmp_path: Path) -> None:
        """fdescribe() focused-suite alias → detected."""
        count = self._scan_ts_content(
            'fdescribe("focused suite", () => {});\n',
            tmp_path,
            "typescript-tests",
        )
        assert count == 1

    def test_outfit_not_detected(self, tmp_path: Path) -> None:
        """'outfit(' is not a focused-test call → NOT detected."""
        count = self._scan_ts_content(
            'const outfit = getOutfit("casual");\n',
            tmp_path,
            "typescript-tests",
        )
        assert count == 0

    def test_fdescribe_in_identifier_not_detected(self, tmp_path: Path) -> None:
        """'safe_fdescribe_name' is not a focused-test call → NOT detected."""
        count = self._scan_ts_content(
            "const safe_fdescribe_name = true;\n",
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

    # ── Scanner false-positive regression tests (T008-T013, FR-006) ──

    def test_string_literal_noqa_not_counted(self) -> None:
        """T008: # noqa inside a string literal MUST NOT be counted."""
        count = self._scan_py_content(
            'msg = "x = 1  # noqa: E501\\n"\nreal = 1  # noqa: E501\n',
        )
        assert count == 1, "Only the real comment should be counted, not the string"

    def test_docstring_type_ignore_not_counted(self) -> None:
        """T009: # type: ignore inside a docstring MUST NOT be counted."""
        count = self._scan_py_content(
            '"""Use # type: ignore for mypy suppression."""\nx = 1\n',
        )
        assert count == 0, "Docstring mention should not be counted"

    def test_fstring_noqa_not_counted(self) -> None:
        """T010: # noqa inside an f-string MUST NOT be counted."""
        count = self._scan_py_content(
            'err = f"Expected: x=1  # noqa to disable"\ny = 2  # noqa: F841\n',
        )
        assert count == 1, "Only the real comment should be counted, not the f-string"

    def test_multiline_string_suppression_not_counted(self) -> None:
        """T011: suppression patterns in multi-line strings MUST NOT be counted."""
        count = self._scan_py_content(
            'text = """\nline with # noqa: E501 inside\nand # type: ignore too\n"""\n',
        )
        assert count == 0, "Multi-line string content should not be counted"

    def test_syntax_error_causes_hard_error(self) -> None:
        """T012: file with syntax error → scanner returns error sentinel, not empty list."""
        target_dir = self.REPO_ROOT / "src"
        test_file = target_dir / "_audit_test_syntax_error.py"
        test_file.write_text("def broken(\n", encoding="utf-8")
        try:
            results = scan_file(test_file, "python-backend", self.REPO_ROOT)
            # Post-hardening: returns a sentinel with __tokenize_error__ type
            assert len(results) == 1, f"Expected 1 sentinel, got {len(results)}"
            assert results[0]["type"] == "__tokenize_error__", (
                f"Expected __tokenize_error__ sentinel, got {results[0]['type']}"
            )
        finally:
            test_file.unlink(missing_ok=True)

    def test_syntax_error_exit_code_via_subprocess(self) -> None:
        """T013: audit-suppressions.py returns exit code 1 for syntax errors."""
        target_dir = self.REPO_ROOT / "src"
        test_file = target_dir / "_audit_test_syntax_error_cli.py"
        test_file.write_text("def broken(\n", encoding="utf-8")
        try:
            result = subprocess.run(  # noqa: S603 - trusted test code
                [sys.executable, str(AUDIT_SCRIPT)],
                capture_output=True,
                text=True,
                cwd=self.REPO_ROOT,
            )
            # After tokenize hardening, this should return exit code 1
            # with "[ERROR] Cannot tokenize" in stderr.
            # Pre-hardening: returns 0 (silent skip — the bug).
            assert result.returncode == 1, (
                f"Expected exit code 1 for syntax error, got {result.returncode}.\n"
                f"stderr: {result.stderr}"
            )
            assert "[ERROR] Cannot tokenize" in result.stderr
        finally:
            test_file.unlink(missing_ok=True)

    def test_indentation_error_causes_hard_error(self) -> None:
        """Mixed-indent file raises IndentationError, not TokenError — must also be caught."""
        target_dir = self.REPO_ROOT / "src"
        test_file = target_dir / "_audit_test_indent_error.py"
        test_file.write_text("if True:\n\tx = 1\n    y = 2\n", encoding="utf-8")
        try:
            results = scan_file(test_file, "python-backend", self.REPO_ROOT)
            assert len(results) == 1, f"Expected 1 sentinel, got {len(results)}"
            assert results[0]["type"] == "__tokenize_error__", (
                f"Expected __tokenize_error__ sentinel, got {results[0]['type']}"
            )
        finally:
            test_file.unlink(missing_ok=True)

    def test_indentation_error_exit_code_via_subprocess(self) -> None:
        """Mixed-indent file must produce exit code 1, same as TokenError."""
        target_dir = self.REPO_ROOT / "src"
        test_file = target_dir / "_audit_test_indent_error_cli.py"
        test_file.write_text("if True:\n\tx = 1\n    y = 2\n", encoding="utf-8")
        try:
            result = subprocess.run(  # noqa: S603 - trusted test code
                [sys.executable, str(AUDIT_SCRIPT)],
                capture_output=True,
                text=True,
                cwd=self.REPO_ROOT,
            )
            assert result.returncode == 1, (
                f"Expected exit code 1 for IndentationError, got {result.returncode}.\n"
                f"stderr: {result.stderr}"
            )
            assert "[ERROR] Cannot tokenize" in result.stderr
        finally:
            test_file.unlink(missing_ok=True)
