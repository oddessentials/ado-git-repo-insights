"""Regression tests for authoritative vs degraded PR preflight behavior."""

from __future__ import annotations

import importlib.util
import sys
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import pytest

_script_path = Path(__file__).resolve().parents[2] / "scripts" / "run_pr_preflight.py"
_spec = importlib.util.spec_from_file_location("run_pr_preflight", _script_path)
assert _spec is not None
assert _spec.loader is not None
_module = importlib.util.module_from_spec(_spec)
sys.modules["run_pr_preflight"] = _module
_spec.loader.exec_module(_module)

build_commands = _module.build_commands
ensure_required_tools = _module.ensure_required_tools
main = _module.main
PNPM_SENTINEL = _module.PNPM_SENTINEL


@pytest.fixture(autouse=True)
def _default_base_ref_for_resolver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Module-level default: set ``BASE_REF=main`` for every test.

    Most tests in this module do not care about the resolver at all —
    they test ``build_commands`` or ``main`` or tool-resolution logic —
    and their parent process environment is not guaranteed to have
    ``BASE_REF`` set. This fixture keeps those tests deterministic and
    still lets resolver-specific tests override the environment
    explicitly inside their own bodies.

    Tests that *do* test the resolver directly (``TestResolvePrBaseRef``)
    override this default inside their own bodies via their own
    ``monkeypatch.setenv`` / ``monkeypatch.delenv`` calls, which run
    AFTER this autouse fixture, so the precedence is correct.
    """
    monkeypatch.setenv("BASE_REF", "main")
    monkeypatch.delenv("GITHUB_BASE_REF", raising=False)


class TestEnsureRequiredTools:
    """Authoritative mode must fail closed when hard-gate tooling is missing."""

    def test_missing_gitleaks_fails_in_authoritative_mode(self) -> None:
        with (
            patch.object(
                _module,
                "ensure_node_child_processes_work",
                return_value=True,
            ),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "resolve_gitleaks", return_value=None),
        ):
            with pytest.raises(SystemExit) as exc_info:
                ensure_required_tools(allow_local_degraded=False)
            assert exc_info.value.code == 3  # EXIT_INFRA

    def test_missing_gitleaks_allows_degraded_mode(self) -> None:
        with (
            patch.object(
                _module,
                "ensure_node_child_processes_work",
                return_value=True,
            ),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "resolve_gitleaks", return_value=None),
        ):
            node_ok, gitleaks = ensure_required_tools(allow_local_degraded=True)

        assert node_ok is True
        assert gitleaks is None


class TestBuildCommands:
    """Secret scan command wiring must reflect resolved local tooling."""

    def test_gitleaks_gate_is_present_when_resolved(self) -> None:
        commands = build_commands(None, gitleaks="gitleaks")
        by_name = {spec.name: spec.command for spec in commands}
        assert by_name["Secret scan (gitleaks)"] == (
            "gitleaks",
            "detect",
            "--config=.gitleaks.toml",
            "--verbose",
            "--log-opts=origin/main..HEAD",
        )

    def test_gitleaks_gate_is_absent_when_unavailable(self) -> None:
        commands = build_commands(None, gitleaks=None)
        names = [spec.name for spec in commands]
        assert "Secret scan (gitleaks)" not in names

    def test_suppression_justification_gate_is_present(self) -> None:
        commands = build_commands(None, gitleaks=None)
        by_name = {spec.name: spec.command for spec in commands}
        assert by_name["Suppression justifications"] == (
            "__PYTHON__",
            "scripts/audit-suppressions.py",
            "--check-justifications",
        )

    def test_python_suite_command_keeps_preflight_temp_paths(self) -> None:
        commands = build_commands(None, gitleaks=None)
        spec = next(
            command
            for command in commands
            if command.name == "Full Python test suite with coverage"
        )

        assert "--basetemp" in spec.command
        assert str(_module.base_temp("python")) in spec.command
        assert spec.extra_env == {"COVERAGE_FILE": str(_module.coverage_file("python"))}


class TestMainBehavior:
    """The default CLI path must be authoritative, with explicit degraded mode."""

    @staticmethod
    def _args(*, allow_local_degraded: bool, self_check: bool) -> Namespace:
        return Namespace(
            verbose=False,
            self_check=self_check,
            strict=False,
            allow_local_degraded=allow_local_degraded,
        )

    def test_self_check_fails_when_node_is_unavailable_authoritatively(self) -> None:
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=False,
                    self_check=True,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                side_effect=SystemExit("Node child-process check failed"),
            ),
        ):
            with pytest.raises(SystemExit, match="Node child-process check failed"):
                main()

    def test_self_check_passes_in_degraded_mode(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=True,
                    self_check=True,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                return_value=(False, None),
            ),
            patch.object(_module, "ensure_paths"),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "check_runner_self"),
        ):
            assert main() == 0

        out = capsys.readouterr().out
        assert "degraded mode only" in out

    def test_degraded_mode_skips_node_backed_commands(self) -> None:
        command_specs = (
            _module.CommandSpec("Python gate", ("__PYTHON__", "-V")),
            _module.CommandSpec("Extension lint", (PNPM_SENTINEL, "run", "lint")),
            _module.CommandSpec(
                "Extension task unit tests",
                ("node", "extension/tasks/extract-prs/index.test.js"),
            ),
        )
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=True,
                    self_check=False,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                return_value=(False, "gitleaks"),
            ),
            patch.object(_module, "ensure_paths"),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "check_runner_self"),
            patch.object(
                _module, "main_branch_suppression_baseline", return_value=None
            ),
            patch.object(_module, "build_commands", return_value=command_specs),
            patch.object(_module, "run_command") as run_command_mock,
        ):
            assert main() == 0

        executed_names = [call.args[0].name for call in run_command_mock.call_args_list]
        assert executed_names == ["Python gate"]

    def test_direct_node_command_is_treated_as_node_dependent(self) -> None:
        assert _module.is_node_dependent_command(
            _module.CommandSpec(
                "Extension task unit tests",
                ("node", "extension/tasks/extract-prs/index.test.js"),
            )
        )

    def test_extension_artifact_wrapper_is_treated_as_extension_dependent(
        self,
    ) -> None:
        assert _module.is_extension_dependent_command(
            _module.CommandSpec(
                "Ratchet bump guard",
                (
                    "__PYTHON__",
                    "scripts/check_ratchet_bump.py",
                    "--junit-extension",
                    "extension/test-results.xml",
                ),
            )
        )

    def test_degraded_mode_skips_extension_artifact_wrappers(
        self,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        command_specs = (
            _module.CommandSpec("Python gate", ("__PYTHON__", "-V")),
            _module.CommandSpec(
                "Ratchet bump guard",
                (
                    "__PYTHON__",
                    "scripts/check_ratchet_bump.py",
                    "--junit-extension",
                    "extension/test-results.xml",
                ),
            ),
        )
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=True,
                    self_check=False,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                return_value=(False, "gitleaks"),
            ),
            patch.object(_module, "ensure_paths"),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "check_runner_self"),
            patch.object(
                _module, "main_branch_suppression_baseline", return_value=None
            ),
            patch.object(_module, "build_commands", return_value=command_specs),
            patch.object(_module, "run_command") as run_command_mock,
        ):
            assert main() == 0

        executed_names = [call.args[0].name for call in run_command_mock.call_args_list]
        assert executed_names == ["Python gate"]
        out = capsys.readouterr().out
        assert "Ratchet bump guard" in out
        assert "DEGRADED MODE:" in out

    def test_degraded_mode_reports_skipped_node_gates_without_ok_footer(
        self,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        command_specs = (
            _module.CommandSpec("Python gate", ("__PYTHON__", "-V")),
            _module.CommandSpec("Extension lint", (PNPM_SENTINEL, "run", "lint")),
        )
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=True,
                    self_check=False,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                return_value=(False, "gitleaks"),
            ),
            patch.object(_module, "ensure_paths"),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "check_runner_self"),
            patch.object(
                _module, "main_branch_suppression_baseline", return_value=None
            ),
            patch.object(_module, "build_commands", return_value=command_specs),
            patch.object(_module, "run_command"),
        ):
            assert main() == 0

        out = capsys.readouterr().out
        assert "DEGRADED MODE:" in out
        assert "CI-hard gate(s) were SKIPPED" in out
        assert "[OK] Local PR preflight passed" not in out

    def test_degraded_mode_reports_missing_gitleaks_in_final_summary(
        self,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        command_specs = (_module.CommandSpec("Python gate", ("__PYTHON__", "-V")),)
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=True,
                    self_check=False,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                return_value=(True, None),
            ),
            patch.object(_module, "ensure_paths"),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "check_runner_self"),
            patch.object(
                _module, "main_branch_suppression_baseline", return_value=None
            ),
            patch.object(_module, "build_commands", return_value=command_specs),
            patch.object(_module, "run_command"),
        ):
            assert main() == 0

        out = capsys.readouterr().out
        assert "Secret scan (gitleaks)" in out
        assert "DEGRADED MODE:" in out
        assert "CI-hard gate(s) were SKIPPED" in out
        assert "[OK] Local PR preflight passed" not in out

    def test_authoritative_mode_keeps_ok_footer(
        self,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        command_specs = (_module.CommandSpec("Python gate", ("__PYTHON__", "-V")),)
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=False,
                    self_check=False,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                return_value=(True, "gitleaks"),
            ),
            patch.object(_module, "ensure_paths"),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "check_runner_self"),
            patch.object(
                _module, "main_branch_suppression_baseline", return_value=None
            ),
            patch.object(_module, "build_commands", return_value=command_specs),
            patch.object(_module, "run_command"),
        ):
            assert main() == 0

        out = capsys.readouterr().out
        assert "[OK] Local PR preflight passed" in out

    def test_authoritative_mode_fails_closed_when_main_baseline_is_unavailable(
        self,
    ) -> None:
        with (
            patch.object(
                _module,
                "parse_args",
                return_value=self._args(
                    allow_local_degraded=False,
                    self_check=False,
                ),
            ),
            patch.object(
                _module, "resolve_baseline_python", return_value=sys.executable
            ),
            patch.object(_module, "probe_python_version", return_value="3.12"),
            patch.object(
                _module,
                "ensure_required_tools",
                return_value=(True, "gitleaks"),
            ),
            patch.object(_module, "ensure_paths"),
            patch.object(_module, "resolve_pnpm", return_value="pnpm"),
            patch.object(_module, "check_runner_self"),
            patch.object(
                _module,
                "main_branch_suppression_baseline",
                side_effect=SystemExit("Could not fetch origin/main"),
            ),
        ):
            with pytest.raises(SystemExit, match="Could not fetch origin/main"):
                main()


class TestResolvePrBaseRef:
    """Lock the PR-base-ref resolver used by the Ratchet bump guard gate.

    The resolver exists so local preflight and the CI ratchet-bump-guard
    job scan the *same* commit range. CI uses ``origin/${github.base_ref}``
    via the ``BASE_REF`` env var. Local preflight honors the same
    ``BASE_REF`` convention, but non-strict local entrypoints still
    default to ``origin/main`` so the repo's documented commands keep
    working. Strict mode remains fail-closed for callers that need
    exact PR-target parity, so each branch of the resolver gets an
    explicit regression lock.
    """

    def test_t34_base_ref_env_var_wins(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """``BASE_REF=release-101.7`` must resolve to ``origin/release-101.7``."""
        monkeypatch.setenv("BASE_REF", "release-101.7")
        monkeypatch.delenv("GITHUB_BASE_REF", raising=False)
        assert _module.resolve_pr_base_ref() == "origin/release-101.7"
        captured = capsys.readouterr()
        assert captured.err == "", (
            "BASE_REF explicit path must NOT emit a fallback warning — "
            "the warning only fires on the origin/main default. "
            f"Unexpected stderr: {captured.err!r}"
        )

    def test_t35_github_base_ref_wins_when_base_ref_unset(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """GitHub Actions sets ``GITHUB_BASE_REF`` in PR context.

        Preflight running inside a CI job (e.g., a self-test of preflight)
        should honor that automatically without the developer needing to
        plumb ``BASE_REF`` through the workflow.
        """
        monkeypatch.delenv("BASE_REF", raising=False)
        monkeypatch.setenv("GITHUB_BASE_REF", "release-101.7")
        assert _module.resolve_pr_base_ref() == "origin/release-101.7"
        assert capsys.readouterr().err == ""

    def test_t36_base_ref_takes_precedence_over_github_base_ref(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Both env vars set ⇒ ``BASE_REF`` wins (documented precedence).

        Rationale: a developer running preflight inside a CI job
        (unusual, but possible for self-testing) can still override
        GitHub's PR context by setting ``BASE_REF`` explicitly. The
        more-specific variable wins over the context-inherited one.
        """
        monkeypatch.setenv("BASE_REF", "release-101.7")
        monkeypatch.setenv("GITHUB_BASE_REF", "main")
        assert _module.resolve_pr_base_ref() == "origin/release-101.7"
        assert capsys.readouterr().err == ""

    def test_t37_empty_env_defaults_to_origin_main_in_non_strict_mode(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Empty env + non-strict mode keeps repo-default local entrypoints alive."""
        monkeypatch.delenv("BASE_REF", raising=False)
        monkeypatch.delenv("GITHUB_BASE_REF", raising=False)
        assert _module.resolve_pr_base_ref() == "origin/main"
        assert capsys.readouterr().err == ""

    def test_t38_empty_env_fails_closed_in_strict_mode(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Strict mode preserves exact CI-parity behavior for explicit callers."""
        monkeypatch.delenv("BASE_REF", raising=False)
        monkeypatch.delenv("GITHUB_BASE_REF", raising=False)

        with pytest.raises(SystemExit) as exc_info:
            _module.resolve_pr_base_ref(strict=True)

        assert exc_info.value.code == _module.EXIT_SETUP

        captured = capsys.readouterr()
        combined = captured.out + captured.err
        assert "[SETUP]" in combined
        assert "BASE_REF" in combined
        assert "GITHUB_BASE_REF" in combined
        assert "BASE_REF=main" in combined
        assert "BASE_REF=release-101.7" in combined
        assert "#280" in combined
