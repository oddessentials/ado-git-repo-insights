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
import subprocess
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
run_pre_push_hook = _hook_module.run_pre_push_hook
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


class TestPrePushPreflightCommand:
    def test_pre_push_runs_non_strict_preflight(self) -> None:
        with (
            patch.object(_hook_module, "run_version_guard"),
            patch.object(_hook_module, "run_pre_push_pre_commit_checks"),
            patch.object(_hook_module, "run_crlf_guard"),
            patch.object(_hook_module, "run_asset_validation"),
            patch.object(_hook_module, "run_command") as run_command_mock,
        ):
            run_pre_push_hook()

        preflight_call = run_command_mock.call_args_list[-1]
        assert preflight_call.args == ([sys.executable, "scripts/run_pr_preflight.py"],)
        assert preflight_call.kwargs == {}

    def test_pre_push_does_not_depend_on_branch_name(
        self,
    ) -> None:
        assert not hasattr(_hook_module, "_current_branch")

        with (
            patch.object(_hook_module, "run_version_guard"),
            patch.object(_hook_module, "run_pre_push_pre_commit_checks"),
            patch.object(_hook_module, "run_crlf_guard"),
            patch.object(_hook_module, "run_asset_validation"),
            patch.object(_hook_module, "run_command") as run_command_mock,
        ):
            run_pre_push_hook()

        assert run_command_mock.call_args_list[-1].args == (
            [sys.executable, "scripts/run_pr_preflight.py"],
        )


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
            patch.object(_hook_module, "run_invariant_artifact_contract_guards"),
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


class TestInvariantArtifactContracts:
    def test_pre_commit_invokes_invariant_artifact_contract_guards(self) -> None:
        with (
            patch.object(_hook_module, "run_staged_suppression_diff_guard"),
            patch.object(_hook_module, "run_staged_suppression_justification_guard"),
            patch.object(_hook_module, "run_command"),
            patch.object(_hook_module, "run_acl_health_check"),
            patch.object(_hook_module, "repair_husky_hook_dispatchers"),
            patch.object(_hook_module, "run_pre_commit_stage"),
            patch.object(_hook_module, "ensure_no_compiled_js"),
            patch.object(_hook_module, "run_pnpm_lockfile_guard"),
            patch.object(_hook_module, "run_npm_command_guard"),
            patch.object(_hook_module, "run_pagination_token_guard"),
            patch.object(_hook_module, "run_scope_coverage_guard"),
            patch.object(_hook_module, "run_rule_disable_invariants_guard"),
            patch.object(
                _hook_module, "run_invariant_artifact_contract_guards"
            ) as contract_guards,
            patch.object(_hook_module, "run_ui_bundle_guards"),
            patch.object(_hook_module, "staged_paths", return_value=[]),
        ):
            _hook_module.run_pre_commit_hook()

        contract_guards.assert_called_once_with("pre-commit")

    def test_pre_push_invokes_invariant_artifact_contract_guards(self) -> None:
        with (
            patch.object(_hook_module, "run_version_guard"),
            patch.object(_hook_module, "run_pre_push_pre_commit_checks"),
            patch.object(_hook_module, "run_crlf_guard"),
            patch.object(_hook_module, "run_asset_validation"),
            patch.object(
                _hook_module, "run_invariant_artifact_contract_guards"
            ) as contract_guards,
            patch.object(_hook_module, "run_command"),
        ):
            _hook_module.run_pre_push_hook()

        contract_guards.assert_called_once_with("pre-push")


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


repair_husky_hook_dispatchers = _hook_module.repair_husky_hook_dispatchers

_HUSKY_DISPATCHER = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n'
_ENTIRE_WRAPPER = (
    "#!/bin/sh\n"
    "# Entire CLI hooks\n"
    "if command -v entire >/dev/null 2>&1; then\n"
    '    entire hooks git commit-msg "$1" || true\n'
    "fi\n"
    '_entire_hook_dir="$(dirname "$0")"\n'
    'if [ -x "$_entire_hook_dir/commit-msg.pre-entire" ]; then\n'
    '    "$_entire_hook_dir/commit-msg.pre-entire" "$@"\n'
    "fi\n"
)


class TestHuskyDispatcherAutoRepair:
    """Unit tests for the pre-commit self-heal that restores husky's hook
    dispatchers after an external tool (e.g. ``entire``) overwrites them.

    Git executes ``.husky/_/<hook>`` (via ``core.hooksPath``), not the tracked
    ``.husky/<hook>``.  ``entire`` overwrites those dispatchers and chains to a
    renamed backup that husky's name-based resolver never finds, silently
    skipping commitlint (commit-msg) and the preflight (pre-push).
    ``repair_husky_hook_dispatchers()`` restores husky's dispatcher in
    pre-commit so both run on the same commit / next push.
    """

    @staticmethod
    def _setup(
        tmp_path: Path,
        *,
        dispatchers: dict[str, str],
        with_helper: bool = True,
        user_hooks: tuple[str, ...] = ("commit-msg", "pre-push"),
    ) -> None:
        internal = tmp_path / ".husky" / "_"
        internal.mkdir(parents=True, exist_ok=True)
        for name, content in dispatchers.items():
            (internal / name).write_text(content, encoding="utf-8")
        if with_helper:
            (internal / "h").write_text(
                "#!/usr/bin/env sh\n# helper\n", encoding="utf-8"
            )
        for name in user_hooks:
            (tmp_path / ".husky" / name).write_text(
                "#!/bin/sh\ncommitlint\n", encoding="utf-8"
            )

    def test_repairs_overwritten_commit_msg_dispatcher(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        self._setup(tmp_path, dispatchers={"commit-msg": _ENTIRE_WRAPPER})
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            repair_husky_hook_dispatchers()
        restored = (tmp_path / ".husky" / "_" / "commit-msg").read_text(
            encoding="utf-8"
        )
        assert restored == _HUSKY_DISPATCHER
        assert "restored husky hook dispatcher" in capsys.readouterr().out

    def test_repairs_overwritten_pre_push_dispatcher(self, tmp_path: Path) -> None:
        # pre-push runs the authoritative preflight — the blind spot the old
        # warn-only commit-msg check never covered.
        self._setup(tmp_path, dispatchers={"pre-push": _ENTIRE_WRAPPER})
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            repair_husky_hook_dispatchers()
        restored = (tmp_path / ".husky" / "_" / "pre-push").read_text(encoding="utf-8")
        assert restored == _HUSKY_DISPATCHER

    def test_leaves_clean_dispatchers_untouched(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        self._setup(
            tmp_path,
            dispatchers={
                "commit-msg": _HUSKY_DISPATCHER,
                "pre-push": _HUSKY_DISPATCHER,
            },
        )
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            repair_husky_hook_dispatchers()
        out = capsys.readouterr().out
        assert "restored" not in out
        assert (tmp_path / ".husky" / "_" / "commit-msg").read_text(
            encoding="utf-8"
        ) == _HUSKY_DISPATCHER

    def test_skips_when_dispatcher_not_yet_generated(self, tmp_path: Path) -> None:
        # No .husky/_/ — fresh clone before pnpm install.  Silent, no crash.
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            repair_husky_hook_dispatchers()

    def test_warns_without_overwriting_when_helper_missing(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # Can't safely restore a dispatcher that would source a missing helper.
        self._setup(
            tmp_path,
            dispatchers={"commit-msg": _ENTIRE_WRAPPER},
            with_helper=False,
        )
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            repair_husky_hook_dispatchers()
        out = capsys.readouterr().out
        assert "pnpm exec husky" in out
        assert (tmp_path / ".husky" / "_" / "commit-msg").read_text(
            encoding="utf-8"
        ) == _ENTIRE_WRAPPER

    def test_does_not_touch_non_enforcement_hooks(self, tmp_path: Path) -> None:
        # post-rewrite only calls entire (no commitlint/preflight), so entire's
        # wrapper is left in place — minimal blast radius.
        self._setup(
            tmp_path,
            dispatchers={"post-rewrite": _ENTIRE_WRAPPER},
            user_hooks=(),
        )
        with patch.object(_hook_module, "REPO_ROOT", tmp_path):
            repair_husky_hook_dispatchers()
        assert (tmp_path / ".husky" / "_" / "post-rewrite").read_text(
            encoding="utf-8"
        ) == _ENTIRE_WRAPPER


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


class TestCrlfGuardChecksIndexNotWorktree:
    """run_crlf_guard validates indexed (push-bound) line endings, not raw
    working-tree bytes.

    The Windows pattern that motivated this fix: an editor or script writes
    CRLF, ``git add`` converts to LF in the index per ``.gitattributes``
    ``text=auto eol=lf``, and ``git status`` reports clean. The OLD guard
    read working-tree bytes and falsely blocked the push even though git
    was about to push LF blobs. The fix reads ``git ls-files --eol`` so the
    guard sees the same content git is about to send.
    """

    def test_check_crlf_in_index_passes_when_index_is_lf(self) -> None:
        """LF in index (regardless of worktree) → False (push allowed)."""
        eol_map = {"scripts/foo.py": "lf"}
        assert _hook_module.check_crlf_in_index("scripts/foo.py", eol_map) is False

    def test_check_crlf_in_index_fails_when_index_is_crlf(self) -> None:
        """CRLF in index → True (push blocked — genuine repo-content issue)."""
        eol_map = {"scripts/foo.py": "crlf"}
        assert _hook_module.check_crlf_in_index("scripts/foo.py", eol_map) is True

    def test_check_crlf_in_index_fails_when_index_is_mixed(self) -> None:
        """Mixed line endings in index → True (push blocked)."""
        eol_map = {"scripts/foo.py": "mixed"}
        assert _hook_module.check_crlf_in_index("scripts/foo.py", eol_map) is True

    def test_check_crlf_in_index_passes_for_untracked_path(self) -> None:
        """Untracked file → False (won't be pushed; out of scope)."""
        assert _hook_module.check_crlf_in_index("scripts/new.py", {}) is False

    def test_check_crlf_in_index_passes_for_binary(self) -> None:
        """Binary file (i/none) → False (no line-ending question)."""
        eol_map = {"extension/ui/icon.png": "none"}
        assert (
            _hook_module.check_crlf_in_index("extension/ui/icon.png", eol_map) is False
        )

    def test_run_crlf_guard_blocks_when_indexed_eol_is_crlf(self) -> None:
        """Block when ``git ls-files --eol`` reports a CRLF blob in scope."""
        with patch.object(
            _hook_module,
            "_scan_indexed_eol",
            return_value={"scripts/bad.py": "crlf"},
        ):
            with pytest.raises(SystemExit):
                _hook_module.run_crlf_guard()

    def test_run_crlf_guard_blocks_when_indexed_eol_is_mixed(self) -> None:
        """Mixed-line-ending blob in scope → blocked."""
        with patch.object(
            _hook_module,
            "_scan_indexed_eol",
            return_value={"extension/ui/foo.ts": "mixed"},
        ):
            with pytest.raises(SystemExit):
                _hook_module.run_crlf_guard()

    def test_run_crlf_guard_passes_when_lf_index_with_crlf_worktree(
        self,
    ) -> None:
        """The motivating regression: LF in index + CRLF in worktree → PASS.

        Mocks ``_scan_indexed_eol`` to report all-LF; the guard MUST
        succeed even though the real worktree on Windows might render
        CRLF after a Python script write.
        """
        with patch.object(
            _hook_module,
            "_scan_indexed_eol",
            return_value={
                "scripts/foo.py": "lf",
                "extension/ui/dashboard.ts": "lf",
                ".husky/pre-push": "lf",
            },
        ):
            _hook_module.run_crlf_guard()  # must not raise

    def test_run_crlf_guard_ignores_files_outside_scope(self) -> None:
        """CRLF in an out-of-scope file (e.g., docs/) does not block."""
        with patch.object(
            _hook_module,
            "_scan_indexed_eol",
            return_value={"docs/random.md": "crlf"},
        ):
            _hook_module.run_crlf_guard()  # must not raise

    def test_run_crlf_guard_passes_against_real_repo_index(self) -> None:
        """Regression: real repo index is LF, guard MUST pass.

        This is the live integration check that would have caught the
        original false-positive: before the fix the guard scanned raw
        worktree bytes and could fail here on Windows; after the fix it
        reads the LF-normalized index and passes.
        """
        try:
            _hook_module.run_crlf_guard()
        except SystemExit as exc:
            pytest.fail(
                f"run_crlf_guard incorrectly blocked clean repo: exit={exc.code}"
            )

    def test_run_crlf_guard_passes_with_real_crlf_worktree_and_lf_index(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The exact Windows parity bug: real git repo, LF blob, CRLF worktree.

        Sets up a real git repository with ``text=auto eol=lf`` in
        ``.gitattributes``, commits a file (so the indexed blob is LF),
        then writes raw CRLF bytes to the worktree (mimicking what a
        Python script using default text mode does on Windows).
        ``git ls-files --eol`` then reports ``i/lf w/crlf``.  The pre-push
        guard MUST PASS — the push-bound (indexed) content is clean LF;
        worktree CRLF is incidental Windows rendering.

        Pre-fix the guard read raw worktree bytes and falsely blocked.
        Post-fix it reads ``git ls-files --eol`` and validates the
        push-bound view, restoring local = CI parity on Windows.
        """
        repo = tmp_path / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(
            ["git", "config", "user.email", "t@example.invalid"],
            cwd=repo,
            check=True,
        )
        subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)
        (repo / ".gitattributes").write_bytes(b"* text=auto eol=lf\n")
        (repo / "scripts").mkdir()
        sample = repo / "scripts" / "foo.py"
        sample.write_bytes(b"hello\nworld\n")
        subprocess.run(["git", "add", "."], cwd=repo, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "init"],
            cwd=repo,
            check=True,
        )

        # Now force CRLF bytes into the worktree (Python text-mode write
        # on Windows produces this exact state).  Index stays LF.
        sample.write_bytes(b"hello\r\nworld\r\n")
        assert b"\r\n" in sample.read_bytes(), "worktree must have CRLF"

        # Point the guard at the temp repo so it scans the right index.
        monkeypatch.setattr(_hook_module, "REPO_ROOT", repo)

        # Setup invariant: indexed blob is LF, worktree is CRLF.
        eol_map = _hook_module._scan_indexed_eol()
        assert eol_map.get("scripts/foo.py") == "lf", (
            f"index should be LF after .gitattributes normalization, got: "
            f"{eol_map.get('scripts/foo.py')!r}"
        )
        eol_inspect = subprocess.run(
            ["git", "ls-files", "--eol"],
            cwd=repo,
            capture_output=True,
            text=True,
            check=True,
        )
        assert "w/crlf" in eol_inspect.stdout, (
            f"git ls-files --eol should report w/crlf for the mutated worktree, "
            f"got: {eol_inspect.stdout!r}"
        )

        # The guard MUST pass: what gets pushed is the LF blob.
        try:
            _hook_module.run_crlf_guard()
        except SystemExit as exc:
            pytest.fail(
                "run_crlf_guard incorrectly blocked push despite LF index "
                f"(parity-bug regression): exit={exc.code}"
            )
