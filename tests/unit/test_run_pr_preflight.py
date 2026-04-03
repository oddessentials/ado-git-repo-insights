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
