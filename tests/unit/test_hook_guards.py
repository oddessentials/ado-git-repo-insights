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
_hook_module = importlib.util.module_from_spec(_spec)
sys.modules["run_repo_hook"] = _hook_module
_spec.loader.exec_module(_hook_module)

require_clean_test_compilation_scope = _hook_module.require_clean_test_compilation_scope
require_clean_tsconfigs = _hook_module.require_clean_tsconfigs
require_clean_ui_sources = _hook_module.require_clean_ui_sources


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
