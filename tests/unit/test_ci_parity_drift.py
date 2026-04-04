"""Structural command-parity verification for repo hooks, preflight, and CI."""

from __future__ import annotations

import ast
import importlib.util
import json
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent.parent
PREFLIGHT_SCRIPT = REPO_ROOT / "scripts" / "run_pr_preflight.py"
REPO_HOOK_SCRIPT = REPO_ROOT / "scripts" / "run_repo_hook.py"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
PARITY_BASELINE_PATH = Path("parity-artifacts") / "main-baseline.json"

HOOK_FUNCTION_TO_GATE = {
    "run_extension_typecheck": "Extension build check",
    "run_extension_test_typecheck": "Extension test type check",
    "run_extension_config_parity": "Extension test config parity",
    "run_extension_lint": "Extension lint",
    "run_extension_test_lint": "Extension test lint",
}

CI_STEP_TO_GATE = {
    (
        "suppression-audit",
        "Verify scope coverage (FR-026)",
    ): "Suppression scope coverage (FR-026)",
    (
        "suppression-audit",
        "Suppression justifications",
    ): "Suppression justifications",
    ("suppression-audit", "Baseline staleness (FR-025)"): "Baseline staleness (FR-025)",
    (
        "suppression-audit",
        "Rule-disable invariants (FR-014)",
    ): "Rule-disable invariants (FR-014)",
    ("extension-tests", "TypeScript Type Check"): "Extension build check",
    ("extension-tests", "TypeScript Test Type Check"): "Extension test type check",
    (
        "extension-tests",
        "TypeScript Test Config Parity",
    ): "Extension test config parity",
    ("extension-tests", "ESLint (production)"): "Extension lint",
    ("extension-tests", "ESLint (tests)"): "Extension test lint",
}


def _load_preflight_module():
    spec = importlib.util.spec_from_file_location("run_pr_preflight", PREFLIGHT_SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_pr_preflight"] = module
    spec.loader.exec_module(module)
    return module


def _normalized_preflight_commands(
    suppression_baseline: Path | None = None,
    *,
    gitleaks: str | None = None,
) -> dict[str, str]:
    module = _load_preflight_module()
    commands = module.build_commands(
        suppression_baseline,
        gitleaks=gitleaks,
    )
    return {
        spec.name: " ".join(spec.command)
        .replace(module.PNPM_SENTINEL, "__PNPM__")
        .replace("\\", "/")
        for spec in commands
    }


def _load_ci_jobs():
    ci_data = yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))
    return ci_data.get("jobs", {})


def _find_ci_step(job_name: str, step_name: str):
    job = _load_ci_jobs()[job_name]
    steps = job.get("steps", [])
    for step in steps:
        if step.get("name") == step_name:
            return step
    raise AssertionError(f"Missing CI step {job_name}/{step_name}")


def _extract_shell_commands(run_block: str) -> list[str]:
    commands: list[str] = []
    current = ""
    for raw_line in run_block.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if current:
            current = f"{current} {line}"
        else:
            current = line
        if current.endswith("\\"):
            current = current[:-1].rstrip()
            continue
        normalized = " ".join(current.split())
        if normalized.startswith(("python ", "pnpm ", "mypy ")):
            commands.append(normalized)
        current = ""
    if current:
        normalized = " ".join(current.split())
        if normalized.startswith(("python ", "pnpm ", "mypy ")):
            commands.append(normalized)
    return commands


def _normalize_ast_token(node: ast.AST) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "sys"
        and node.attr == "executable"
    ):
        return "__PYTHON__"
    if isinstance(node, ast.Name) and node.id == "pnpm":
        return "__PNPM__"
    if isinstance(node, ast.Name):
        return node.id
    return ast.unparse(node)


def _extract_run_command_calls(function_name: str) -> list[tuple[str, str | None]]:
    tree = ast.parse(REPO_HOOK_SCRIPT.read_text(encoding="utf-8"))
    target: ast.FunctionDef | None = None
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == function_name:
            target = node
            break
    assert target is not None, f"Missing function {function_name}"

    calls: list[tuple[str, str | None]] = []

    class Visitor(ast.NodeVisitor):
        def visit_Call(self, node: ast.Call) -> None:
            if isinstance(node.func, ast.Name) and node.func.id == "run_command":
                if node.args and isinstance(node.args[0], ast.List):
                    command = " ".join(
                        _normalize_ast_token(element) for element in node.args[0].elts
                    )
                    cwd = None
                    for keyword in node.keywords:
                        if keyword.arg == "cwd":
                            cwd = _normalize_ast_token(keyword.value)
                    calls.append((command, cwd))
            self.generic_visit(node)

    Visitor().visit(target)
    return calls


def _extract_called_function_names(function_name: str) -> list[str]:
    tree = ast.parse(REPO_HOOK_SCRIPT.read_text(encoding="utf-8"))
    target: ast.FunctionDef | None = None
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == function_name:
            target = node
            break
    assert target is not None, f"Missing function {function_name}"

    called: list[str] = []

    class Visitor(ast.NodeVisitor):
        def visit_Call(self, node: ast.Call) -> None:
            if isinstance(node.func, ast.Name):
                called.append(node.func.id)
            self.generic_visit(node)

    Visitor().visit(target)
    return called


class TestRootTestCi:
    def test_root_test_ci_is_exactly_preflight(self) -> None:
        root_pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        script = root_pkg.get("scripts", {}).get("test:ci", "")
        assert script == "python scripts/run_pr_preflight.py"


class TestExtensionPackageScripts:
    def test_extension_lint_tests_is_exact(self) -> None:
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        assert ext_pkg.get("scripts", {}).get("lint:tests", "") == (
            "eslint tests/ --max-warnings=0"
        )

    def test_extension_lint_is_exact_for_all_production_scopes(self) -> None:
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        assert ext_pkg.get("scripts", {}).get("lint", "") == (
            "eslint ui/ scripts/ tasks/_shared/ --max-warnings=0"
        )


class TestPrecommitParity:
    def test_precommit_python_commands_match_preflight_and_ci(self) -> None:
        preflight = _normalized_preflight_commands()
        called_functions = _extract_called_function_names("run_pre_commit_hook")
        suppression_commands = _extract_shell_commands(
            str(
                _find_ci_step(
                    "suppression-audit", "Run suppression audit against main baseline"
                )["run"]
            )
        )
        justification_commands = _extract_shell_commands(
            str(_find_ci_step("suppression-audit", "Suppression justifications")["run"])
        )
        any_step = _find_ci_step(
            "mypy", "No typing.Any in src/, tests/, scripts/ (QG-40)"
        )

        assert "run_staged_suppression_diff_guard" in called_functions
        assert "run_staged_suppression_justification_guard" in called_functions
        guard_calls = _extract_called_function_names(
            "run_staged_suppression_diff_guard"
        )
        assert "_load_authoritative_suppression_baseline" in guard_calls
        assert preflight["Suppression baseline sync gate"] == (
            "__PYTHON__ scripts/audit-suppressions.py --diff"
        )
        assert (
            "python scripts/audit-suppressions.py --diff --baseline /tmp/main-baseline.json"
            in suppression_commands
        )
        assert preflight["Suppression justifications"] == (
            "__PYTHON__ scripts/audit-suppressions.py --check-justifications"
        )
        assert (
            "python scripts/audit-suppressions.py --check-justifications"
            in justification_commands
        )

        repo_calls = dict(_extract_run_command_calls("run_pre_commit_hook"))
        assert preflight["No typing.Any in src/, tests/, scripts/ (QG-40)"] == (
            "__PYTHON__ scripts/check_no_any_types.py"
        )
        assert repo_calls["__PYTHON__ scripts/check_no_any_types.py --diff"] is None
        assert str(any_step["run"]).strip() == "python scripts/check_no_any_types.py"

    def test_ci_suppression_step_fails_closed_without_main_baseline(self) -> None:
        run_block = str(
            _find_ci_step(
                "suppression-audit", "Run suppression audit against main baseline"
            )["run"]
        )
        assert "git fetch origin main --quiet" in run_block
        assert "using committed baseline" not in run_block.lower()
        assert "exit 1" in run_block
        assert "origin/main:.suppression-baseline.json is required" in run_block


class TestHookEntrypointSmoke:
    def test_hook_entrypoint_uses_disposable_formatter_clean_fixture(self) -> None:
        run_block = str(
            _find_ci_step(
                "hook-entrypoint-test",
                "Stage a trivial change and run pre-commit hook",
            )["run"]
        )

        assert 'smoke_file="hook-entrypoint-smoke.txt"' in run_block
        assert "printf 'hook entrypoint smoke\\n' > \"$smoke_file\"" in run_block
        assert 'git add "$smoke_file"' in run_block
        assert "CONTRIBUTING.md" not in run_block

    def test_extension_helper_commands_match_preflight_and_ci(self) -> None:
        preflight = _normalized_preflight_commands()

        for function_name, gate_name in HOOK_FUNCTION_TO_GATE.items():
            helper_calls = _extract_run_command_calls(function_name)
            assert len(helper_calls) == 1, (
                f"{function_name} should have exactly one run_command call"
            )
            command, cwd = helper_calls[0]
            assert cwd == "EXTENSION_ROOT"
            assert command == preflight[gate_name]

        for (job_name, step_name), gate_name in CI_STEP_TO_GATE.items():
            commands = _extract_shell_commands(
                str(_find_ci_step(job_name, step_name)["run"])
            )
            assert commands == [
                preflight[gate_name]
                .replace("__PNPM__", "pnpm")
                .replace("__PYTHON__", "python")
            ]


class TestPreflightConditionalParity:
    def test_main_baseline_gate_matches_ci_command(self) -> None:
        preflight = _normalized_preflight_commands(PARITY_BASELINE_PATH)
        ci_commands = _extract_shell_commands(
            str(
                _find_ci_step(
                    "suppression-audit", "Run suppression audit against main baseline"
                )["run"]
            )
        )

        assert preflight["Suppression main-baseline gate"] == (
            "__PYTHON__ scripts/audit-suppressions.py --diff --baseline "
            "parity-artifacts/main-baseline.json"
        )
        assert (
            "python scripts/audit-suppressions.py --diff --baseline /tmp/main-baseline.json"
            in ci_commands
        )

    def test_secret_scan_gate_is_conditionally_present_and_ci_has_gitleaks_job(
        self,
    ) -> None:
        preflight = _normalized_preflight_commands(
            PARITY_BASELINE_PATH, gitleaks="gitleaks"
        )
        assert preflight["Secret scan (gitleaks)"] == (
            "gitleaks detect --config=.gitleaks.toml --verbose --log-opts=origin/main..HEAD"
        )

        secret_scan_job = _load_ci_jobs()["secret-scan"]
        uses_values = [
            step["uses"]
            for step in secret_scan_job.get("steps", [])
            if isinstance(step, dict) and "uses" in step
        ]
        assert "gitleaks/gitleaks-action@v2.3.9" in uses_values
        range_step = _find_ci_step("secret-scan", "Compute gitleaks log range")
        assert "git fetch origin main --quiet" in str(range_step["run"])
        assert 'echo "range=origin/main..HEAD" >> "$GITHUB_OUTPUT"' in str(
            range_step["run"]
        )
        gitleaks_step = _find_ci_step("secret-scan", "Run gitleaks")
        assert (
            str(gitleaks_step["with"]["args"]).strip()
            == "--config=.gitleaks.toml --log-opts=${{ steps.gitleaks-range.outputs.range }}"
        )


class TestPreflightCiParity:
    def test_python_gate_commands_match_ci_steps(self) -> None:
        preflight = _normalized_preflight_commands(PARITY_BASELINE_PATH)

        expected = {
            "Suppression scope coverage (FR-026)": (
                "suppression-audit",
                "Verify scope coverage (FR-026)",
            ),
            "Suppression justifications": (
                "suppression-audit",
                "Suppression justifications",
            ),
            "Baseline staleness (FR-025)": (
                "suppression-audit",
                "Baseline staleness (FR-025)",
            ),
            "Rule-disable invariants (FR-014)": (
                "suppression-audit",
                "Rule-disable invariants (FR-014)",
            ),
            "Python test count validation": ("test", "Validate Test Results (Python)"),
            "Extension test count validation": (
                "extension-tests",
                "Validate Test Results (Extension)",
            ),
        }

        for gate_name, (job_name, step_name) in expected.items():
            ci_commands = _extract_shell_commands(
                str(_find_ci_step(job_name, step_name)["run"])
            )
            expected_ci = preflight[gate_name].replace("__PYTHON__", "python")
            assert expected_ci in ci_commands, (
                f"CI drift for {job_name}/{step_name}: expected {expected_ci!r}, "
                f"got {ci_commands!r}"
            )

    def test_ci_jobs_needed_for_parity_still_exist(self) -> None:
        jobs = _load_ci_jobs()
        for job_name in (
            "mypy",
            "suppression-audit",
            "extension-tests",
            "parity-gate",
            "secret-scan",
        ):
            assert job_name in jobs
