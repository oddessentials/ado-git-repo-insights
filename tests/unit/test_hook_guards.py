"""Regression tests for pre-commit clean-worktree guard functions.

These tests verify that require_clean_test_compilation_scope() and
require_clean_tsconfigs() cover their full input scope.  If a
pathspec is wrong or a scope is missing, these tests fail.

The guards block commits when the worktree has unstaged changes in
files that tsc or the parity checker would read.  Without them,
pre-commit validates the worktree instead of the staged snapshot.

Tests mock worktree_paths() to simulate unstaged changes without
requiring actual git state manipulation.
"""

import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Import the hook module directly so we can test its functions
_hook_path = Path(__file__).resolve().parents[2] / "scripts" / "run_repo_hook.py"
_spec = importlib.util.spec_from_file_location("run_repo_hook", _hook_path)
assert _spec is not None
assert _spec.loader is not None
_hook_module = importlib.util.module_from_spec(_spec)
sys.modules["run_repo_hook"] = _hook_module
_spec.loader.exec_module(_hook_module)

require_clean_test_compilation_scope = _hook_module.require_clean_test_compilation_scope
require_clean_tsconfigs = _hook_module.require_clean_tsconfigs
require_clean_ui_sources = _hook_module.require_clean_ui_sources
run_pre_commit_stage = _hook_module.run_pre_commit_stage
run_staged_suppression_diff_guard = _hook_module.run_staged_suppression_diff_guard
run_staged_suppression_justification_guard = (
    _hook_module.run_staged_suppression_justification_guard
)


def _mock_worktree_paths(dirty_files: dict[str, list[str]]):
    """Return a mock for worktree_paths that returns dirty files by pathspec.

    dirty_files maps pathspec strings to lists of file paths that would
    be returned by git diff --name-only -- <pathspec>.
    """

    def mock_fn(pathspec: str) -> list[str]:
        return dirty_files.get(pathspec, [])

    return mock_fn


class TestRequireCleanTestCompilationScope:
    """require_clean_test_compilation_scope must cover ALL inputs to build:check-tests.

    tsconfig.test.json compiles: tests/**/*.ts, ui/**/*.ts.
    The tsconfig files themselves are also inputs.
    """

    def test_passes_when_worktree_is_clean(self) -> None:
        with patch.object(_hook_module, "worktree_paths", return_value=[]):
            require_clean_test_compilation_scope()  # should not raise

    def test_blocks_on_unstaged_test_file(self) -> None:
        mock = _mock_worktree_paths(
            {
                "extension/tests/": ["extension/tests/dashboard.test.ts"],
            }
        )
        with patch.object(_hook_module, "worktree_paths", side_effect=mock):
            with pytest.raises(SystemExit):
                require_clean_test_compilation_scope()

    def test_blocks_on_unstaged_ui_file(self) -> None:
        mock = _mock_worktree_paths(
            {
                "extension/ui/": ["extension/ui/dashboard.ts"],
            }
        )
        with patch.object(_hook_module, "worktree_paths", side_effect=mock):
            with pytest.raises(SystemExit):
                require_clean_test_compilation_scope()

    def test_blocks_on_unstaged_tsconfig(self) -> None:
        """This is the exact bug that was fixed — tsconfig files are inputs
        to tsc and must be guarded."""
        mock = _mock_worktree_paths(
            {
                "extension/tsconfig*.json": ["extension/tsconfig.test.json"],
            }
        )
        with patch.object(_hook_module, "worktree_paths", side_effect=mock):
            with pytest.raises(SystemExit):
                require_clean_test_compilation_scope()

    def test_reports_all_dirty_files_across_scopes(self) -> None:
        """When multiple scopes are dirty, all files should be reported,
        not just the first scope's files."""
        mock = _mock_worktree_paths(
            {
                "extension/tests/": ["extension/tests/foo.test.ts"],
                "extension/ui/": ["extension/ui/bar.ts"],
                "extension/tsconfig*.json": ["extension/tsconfig.json"],
            }
        )
        with patch.object(_hook_module, "worktree_paths", side_effect=mock):
            with pytest.raises(SystemExit):
                require_clean_test_compilation_scope()

    def test_blocks_on_unstaged_eslint_config(self) -> None:
        """Unstaged ESLint config must block because lint:tests reads it
        from the worktree, not the staged index."""
        mock = _mock_worktree_paths(
            {
                "extension/eslint.config.mjs": ["extension/eslint.config.mjs"],
            }
        )
        with patch.object(_hook_module, "worktree_paths", side_effect=mock):
            with pytest.raises(SystemExit):
                require_clean_test_compilation_scope()

    def test_checks_all_four_pathspecs(self) -> None:
        """Verify the guard calls worktree_paths for every scope, not just some."""
        calls: list[str] = []

        def tracking_mock(pathspec: str) -> list[str]:
            calls.append(pathspec)
            return []

        with patch.object(_hook_module, "worktree_paths", side_effect=tracking_mock):
            require_clean_test_compilation_scope()

        assert "extension/tests/" in calls
        assert "extension/ui/" in calls
        assert "extension/tsconfig*.json" in calls
        assert "extension/eslint.config.mjs" in calls
        assert len(calls) == 4


class TestRequireCleanTsconfigs:
    """require_clean_tsconfigs must cover all extension/tsconfig*.json files."""

    def test_passes_when_worktree_is_clean(self) -> None:
        with patch.object(_hook_module, "worktree_paths", return_value=[]):
            require_clean_tsconfigs()  # should not raise

    def test_blocks_on_unstaged_production_tsconfig(self) -> None:
        with patch.object(
            _hook_module,
            "worktree_paths",
            return_value=["extension/tsconfig.json"],
        ):
            with pytest.raises(SystemExit):
                require_clean_tsconfigs()

    def test_blocks_on_unstaged_test_tsconfig(self) -> None:
        with patch.object(
            _hook_module,
            "worktree_paths",
            return_value=["extension/tsconfig.test.json"],
        ):
            with pytest.raises(SystemExit):
                require_clean_tsconfigs()

    def test_blocks_on_unstaged_type_tests_tsconfig(self) -> None:
        with patch.object(
            _hook_module,
            "worktree_paths",
            return_value=["extension/tsconfig.type-tests.json"],
        ):
            with pytest.raises(SystemExit):
                require_clean_tsconfigs()


class TestRequireCleanUiSources:
    """require_clean_ui_sources must guard ESLint config alongside ui/ sources."""

    def test_passes_when_worktree_is_clean(self) -> None:
        with patch.object(_hook_module, "worktree_paths", return_value=[]):
            require_clean_ui_sources()  # should not raise

    def test_blocks_on_unstaged_eslint_config(self) -> None:
        """Unstaged ESLint config must block because pnpm run lint reads it
        from the worktree, not the staged index."""
        mock = _mock_worktree_paths(
            {
                "extension/eslint.config.mjs": ["extension/eslint.config.mjs"],
            }
        )
        with patch.object(_hook_module, "worktree_paths", side_effect=mock):
            with pytest.raises(SystemExit):
                require_clean_ui_sources()

    def test_uses_glob_pathspec(self) -> None:
        """Verify the guard uses extension/tsconfig*.json, not the bare
        prefix extension/tsconfig that matches nothing."""
        calls: list[str] = []

        def tracking_mock(pathspec: str) -> list[str]:
            calls.append(pathspec)
            return []

        with patch.object(_hook_module, "worktree_paths", side_effect=tracking_mock):
            require_clean_tsconfigs()

        assert calls == ["extension/tsconfig*.json"]


class TestPreCommitStageImmutability:
    """Formatting must not mutate the staged set after staged-only guards ran."""

    def test_run_pre_commit_stage_does_not_auto_stage_worktree_changes(self) -> None:
        process_result = type(
            "CompletedProcess",
            (),
            {"returncode": 1, "stdout": "", "stderr": ""},
        )()
        with (
            patch.object(_hook_module, "resolve_pre_commit", return_value="pre-commit"),
            patch("subprocess.run", return_value=process_result),
            patch.object(
                _hook_module,
                "modified_worktree_files",
                return_value=["src/example.py"],
            ),
            patch.object(_hook_module, "run_command") as run_command_mock,
        ):
            with pytest.raises(SystemExit, match="changed files"):
                run_pre_commit_stage()

        run_command_mock.assert_not_called()


class TestStagedSuppressionGuards:
    def test_authoritative_baseline_loader_fails_closed_without_degraded_mode(
        self,
    ) -> None:
        fetch_result = type(
            "CompletedProcess",
            (),
            {"returncode": 1, "stdout": "", "stderr": "fetch failed"},
        )()
        with (
            patch("subprocess.run", return_value=fetch_result),
            patch.dict("os.environ", {}, clear=False),
        ):
            with pytest.raises(SystemExit, match="Could not fetch origin/main"):
                _hook_module._load_authoritative_suppression_baseline()

    def test_authoritative_baseline_loader_allows_explicit_degraded_mode(self) -> None:
        fetch_result = type(
            "CompletedProcess",
            (),
            {"returncode": 1, "stdout": "", "stderr": "fetch failed"},
        )()
        with (
            patch("subprocess.run", return_value=fetch_result),
            patch.dict("os.environ", {"ADO_HOOK_ALLOW_LOCAL_DEGRADED": "1"}),
        ):
            baseline = _hook_module._load_authoritative_suppression_baseline()
        assert baseline is None

    def test_diff_guard_skips_when_authoritative_baseline_is_unavailable_in_degraded_mode(
        self,
    ) -> None:
        with patch.object(
            _hook_module,
            "_load_authoritative_suppression_baseline",
            return_value=None,
        ):
            run_staged_suppression_diff_guard()

    def test_diff_guard_fails_when_staged_net_delta_is_positive(self) -> None:
        with (
            patch.object(
                _hook_module,
                "_load_authoritative_suppression_baseline",
                return_value={"by_file": {"src/example.py": 0}},
            ),
            patch.object(
                _hook_module,
                "_staged_suppression_delta_inputs",
                return_value=({"src/example.py": 0}, {"src/example.py": 1}, []),
            ),
        ):
            with pytest.raises(SystemExit):
                run_staged_suppression_diff_guard()

    def test_diff_guard_passes_when_staged_net_delta_is_zero(self) -> None:
        with (
            patch.object(
                _hook_module,
                "_load_authoritative_suppression_baseline",
                return_value={
                    "by_file": {
                        "src/old.py": 1,
                        "src/new.py": 0,
                    }
                },
            ),
            patch.object(
                _hook_module,
                "_staged_suppression_delta_inputs",
                return_value=(
                    {"src/old.py": 1, "src/new.py": 0},
                    {"src/old.py": 0, "src/new.py": 1},
                    [],
                ),
            ),
        ):
            run_staged_suppression_diff_guard()

    def test_diff_guard_allows_suppression_preserving_move(self) -> None:
        with (
            patch.object(
                _hook_module,
                "_load_authoritative_suppression_baseline",
                return_value={
                    "by_file": {
                        "src/old.py": 1,
                    }
                },
            ),
            patch.object(
                _hook_module,
                "_staged_suppression_delta_inputs",
                return_value=(
                    {"src/old.py": 1, "src/new.py": 0},
                    {"src/old.py": 0, "src/new.py": 1},
                    [],
                ),
            ),
        ):
            run_staged_suppression_diff_guard()

    def test_diff_guard_handles_real_rename_status_flow(self) -> None:
        with (
            patch.object(
                _hook_module,
                "_load_authoritative_suppression_baseline",
                return_value={"by_file": {"src/old.py": 1}},
            ),
            patch.object(
                _hook_module,
                "suppression_staged_name_status",
                return_value=[("R100", "src/old.py", "src/new.py")],
            ),
            patch.object(
                _hook_module,
                "staged_file_content",
                return_value="x = 1  # noqa: E501\n",
            ),
        ):
            run_staged_suppression_diff_guard()

    def test_diff_guard_blocks_suppression_increase_on_rename(self) -> None:
        """Regression: rename must not double-count baseline to mask new suppressions."""
        with (
            patch.object(
                _hook_module,
                "_load_authoritative_suppression_baseline",
                return_value={"by_file": {"src/old.py": 1}},
            ),
            patch.object(
                _hook_module,
                "suppression_staged_name_status",
                return_value=[("R100", "src/old.py", "src/new.py")],
            ),
            patch.object(
                _hook_module,
                "staged_file_content",
                return_value="x = 1  # noqa: E501\ny = 2  # noqa: E501\n",
            ),
        ):
            with pytest.raises(SystemExit):
                run_staged_suppression_diff_guard()

    def test_justification_guard_fails_for_unjustified_staged_suppression(self) -> None:
        with patch.object(
            _hook_module,
            "_scan_staged_suppressions",
            return_value={
                "src/example.py": [
                    {
                        "type": "noqa",
                        "line": 3,
                        "rules": [],
                        "has_justification": False,
                    }
                ]
            },
        ):
            with pytest.raises(SystemExit):
                run_staged_suppression_justification_guard()


class TestDeleteOnlyCommits:
    def test_deleted_js_does_not_trigger_compiled_js_guard(self) -> None:
        with patch.object(_hook_module, "staged_paths", return_value=[]):
            _hook_module.ensure_no_compiled_js()

    def test_deleted_unscoped_file_does_not_trigger_scope_coverage(self) -> None:
        with patch.object(_hook_module, "staged_paths", return_value=[]):
            _hook_module.run_scope_coverage_guard()

    def test_deleted_files_do_not_trigger_ui_or_test_builds(self) -> None:
        with (
            patch.object(_hook_module, "staged_paths", return_value=[]),
            patch.object(_hook_module, "run_staged_suppression_diff_guard"),
            patch.object(_hook_module, "run_staged_suppression_justification_guard"),
            patch.object(_hook_module, "run_command"),
            patch.object(_hook_module, "run_acl_health_check"),
            patch.object(_hook_module, "run_pre_commit_stage"),
            patch.object(_hook_module, "ensure_no_compiled_js"),
            patch.object(_hook_module, "run_pnpm_lockfile_guard"),
            patch.object(_hook_module, "run_npm_command_guard"),
            patch.object(_hook_module, "run_pagination_token_guard"),
            patch.object(_hook_module, "run_scope_coverage_guard"),
            patch.object(_hook_module, "run_rule_disable_invariants_guard"),
            patch.object(_hook_module, "run_ui_bundle_guards"),
            patch.object(_hook_module, "run_extension_typecheck") as ext_typecheck,
            patch.object(_hook_module, "run_extension_lint") as ext_lint,
            patch.object(
                _hook_module, "run_extension_test_typecheck"
            ) as test_typecheck,
            patch.object(_hook_module, "run_extension_test_lint") as test_lint,
        ):
            _hook_module.run_pre_commit_hook()

        ext_typecheck.assert_not_called()
        ext_lint.assert_not_called()
        test_typecheck.assert_not_called()
        test_lint.assert_not_called()


git_output = _hook_module.git_output


class TestPathspecsMatchRealFiles:
    """Verify that the pathspecs used by guards actually match tracked files
    in this repository.  If git's pathspec semantics change or files move,
    these tests catch it."""

    @staticmethod
    def _git_ls_files(pathspec: str) -> list[str]:
        output = git_output("ls-files", "--", pathspec)
        return [f for f in output.strip().splitlines() if f]

    def test_tsconfig_glob_matches_three_files(self) -> None:
        """extension/tsconfig*.json must match exactly three tracked files."""
        files = self._git_ls_files("extension/tsconfig*.json")
        assert len(files) == 3
        assert "extension/tsconfig.json" in files
        assert "extension/tsconfig.test.json" in files
        assert "extension/tsconfig.type-tests.json" in files

    def test_no_custom_type_declarations_in_types_directory(self) -> None:
        """types/ must be empty — custom declarations replaced by SDK-provided types."""
        files = self._git_ls_files("types/*.d.ts")
        assert len(files) == 0, f"Unexpected .d.ts files in types/: {files}"
