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
            with pytest.raises(SystemExit) as exc_info:
                _hook_module._load_authoritative_suppression_baseline()
            assert exc_info.value.code == 3  # EXIT_INFRA

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

    def test_tsconfig_glob_matches_four_files(self) -> None:
        """extension/tsconfig*.json must match exactly four tracked files."""
        files = self._git_ls_files("extension/tsconfig*.json")
        assert len(files) == 4
        assert "extension/tsconfig.json" in files
        assert "extension/tsconfig.build.json" in files
        assert "extension/tsconfig.test.json" in files
        assert "extension/tsconfig.type-tests.json" in files

    def test_no_custom_type_declarations_in_types_directory(self) -> None:
        """types/ must be empty — custom declarations replaced by SDK-provided types."""
        files = self._git_ls_files("types/*.d.ts")
        assert len(files) == 0, f"Unexpected .d.ts files in types/: {files}"


class TestSkipLibCheckProhibited:
    """skipLibCheck: true must not appear in any repo-owned tsconfig.

    This is the TypeScript equivalent of closing ignore_missing_imports
    for Python (#243). All library .d.ts files must be type-checked.
    """

    # All repo-owned tsconfigs — node_modules are excluded by git ls-files.
    REPO_TSCONFIGS = [
        Path("extension") / "tsconfig.json",
        Path("extension") / "tsconfig.test.json",
        Path("extension") / "tsconfig.type-tests.json",
        Path("scripts") / "tsconfig.json",
        Path("tsconfig.json"),
    ]

    def test_no_skip_lib_check_in_any_tsconfig(self) -> None:
        import json

        repo_root = Path(__file__).resolve().parents[2]
        violations: list[str] = []
        for rel_path in self.REPO_TSCONFIGS:
            config_path = repo_root / rel_path
            if not config_path.exists():
                violations.append(f"  {rel_path}: FILE MISSING")
                continue
            data = json.loads(config_path.read_text(encoding="utf-8"))
            compiler_opts = data.get("compilerOptions", {})
            if compiler_opts.get("skipLibCheck") is True:
                violations.append(f"  {rel_path}: skipLibCheck is true")
        assert not violations, (
            "skipLibCheck: true re-enabled in repo-owned tsconfig files.\n"
            "Library .d.ts type-checking must not be skipped (#248).\n"
            + "\n".join(violations)
        )


class TestCommitlintInfrastructure:
    """Commitlint config and tracked hook file must reference commitlint.

    These tests verify that the *tracked* infrastructure exists.  They do
    NOT verify the dispatcher git actually executes (.husky/_/commit-msg) —
    see TestCommitlintDispatcherHealthCheck for that.
    """

    def test_commitlint_config_exists(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        config = repo_root / "commitlint.config.cjs"
        assert config.exists(), (
            "commitlint.config.cjs is missing — commit message linting is disabled"
        )

    def test_tracked_commit_msg_hook_references_commitlint(self) -> None:
        """Verify .husky/commit-msg (tracked) references commitlint.

        This checks the tracked hook file that husky dispatches to.
        It does NOT prove commitlint runs — the dispatcher (.husky/_/)
        can be overwritten by external tools, breaking the chain.
        """
        repo_root = Path(__file__).resolve().parents[2]
        hook = repo_root / ".husky" / "commit-msg"
        assert hook.exists(), ".husky/commit-msg hook is missing"
        content = hook.read_text(encoding="utf-8")
        assert "commitlint" in content, (
            ".husky/commit-msg does not reference commitlint"
        )


run_commitlint_dispatcher_health_check = (
    _hook_module.run_commitlint_dispatcher_health_check
)


class TestCommitlintDispatcherHealthCheck:
    """Unit tests for the runtime check that detects dispatcher corruption.

    Git executes .husky/_/commit-msg (set via core.hooksPath), not the
    tracked .husky/commit-msg.  External tools can overwrite the dispatcher,
    silently breaking commitlint.  run_commitlint_dispatcher_health_check()
    is the function that detects this at commit time.
    """

    @staticmethod
    def _write_dispatcher(tmp_path: Path, content: str) -> None:
        husky_internal = tmp_path / ".husky" / "_"
        husky_internal.mkdir(parents=True, exist_ok=True)
        (husky_internal / "commit-msg").write_text(content, encoding="utf-8")

    def test_passes_on_standard_husky_dispatcher(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        self._write_dispatcher(tmp_path, '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n')
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            run_commitlint_dispatcher_health_check()
        captured = capsys.readouterr()
        assert "corrupted" not in captured.out

    def test_warns_on_corrupted_dispatcher(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Dispatcher overwritten by external tool — warn with fix command."""
        self._write_dispatcher(
            tmp_path,
            "#!/bin/sh\n"
            "# Entire CLI hooks\n"
            'entire hooks git commit-msg "$1" || exit 1\n',
        )
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            run_commitlint_dispatcher_health_check()
        captured = capsys.readouterr()
        assert "corrupted" in captured.out
        assert "pnpm exec husky" in captured.out

    def test_skips_when_dispatcher_not_yet_generated(self, tmp_path: Path) -> None:
        """Before pnpm install, .husky/_/ does not exist — silent skip.

        This is expected on first clone before bootstrapping.  The CI
        commitlint job is the authoritative gate regardless.
        """
        # tmp_path has no .husky/_/ directory
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            run_commitlint_dispatcher_health_check()  # should return silently


_acl_write_probe = _hook_module._acl_write_probe
run_acl_health_check = _hook_module.run_acl_health_check


class TestAclWriteProbe:
    """Tests for the Python ACL write-probe that replaced check-git-acl-health.ps1."""

    def test_returns_none_for_nonexistent_directory(self, tmp_path: Path) -> None:
        missing = tmp_path / "does-not-exist"
        assert _acl_write_probe(missing) is None

    def test_returns_none_for_writable_directory(self, tmp_path: Path) -> None:
        assert _acl_write_probe(tmp_path) is None

    def test_probe_file_is_cleaned_up(self, tmp_path: Path) -> None:
        _acl_write_probe(tmp_path)
        assert not (tmp_path / ".acl-probe.tmp").exists()

    def test_returns_error_message_on_permission_failure(self, tmp_path: Path) -> None:
        target = tmp_path / "locked"
        target.mkdir()
        with patch.object(
            Path, "write_text", side_effect=PermissionError("Access denied")
        ):
            result = _acl_write_probe(target)
        assert result is not None
        assert "Access denied" in result


class TestRunAclHealthCheck:
    """Integration tests for run_acl_health_check."""

    def test_is_noop_on_non_windows(self) -> None:
        with patch.object(_hook_module, "os") as mock_os:
            mock_os.name = "posix"
            run_acl_health_check()  # should return immediately

    def test_passes_when_all_probes_succeed(self) -> None:
        with (
            patch.object(_hook_module, "os") as mock_os,
            patch.object(_hook_module, "_acl_write_probe", return_value=None),
            patch.object(_hook_module, "REPO_ROOT", Path("/fake/repo")),
        ):
            mock_os.name = "nt"
            # Mock iterdir to return no .pytest-tmp dirs
            with patch.object(Path, "iterdir", return_value=[]):
                run_acl_health_check()

    def test_fails_when_probe_returns_error(self) -> None:
        with (
            patch.object(_hook_module, "os") as mock_os,
            patch.object(
                _hook_module,
                "_acl_write_probe",
                return_value="Permission denied",
            ),
            patch.object(_hook_module, "REPO_ROOT", Path("/fake/repo")),
        ):
            mock_os.name = "nt"
            with (
                patch.object(Path, "iterdir", return_value=[]),
                pytest.raises(SystemExit),
            ):
                run_acl_health_check()
