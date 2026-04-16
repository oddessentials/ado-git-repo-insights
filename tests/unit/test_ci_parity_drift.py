"""Structural command-parity verification for repo hooks, preflight, and CI."""

from __future__ import annotations

import ast
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import TypedDict

import pytest
import yaml

REPO_ROOT = Path(__file__).parent.parent.parent
PREFLIGHT_SCRIPT = REPO_ROOT / "scripts" / "run_pr_preflight.py"
REPO_HOOK_SCRIPT = REPO_ROOT / "scripts" / "run_repo_hook.py"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
PARITY_BASELINE_PATH = Path("parity-artifacts") / "main-baseline.json"
TEST_FLOOR_ARTIFACT = REPO_ROOT / ".test-floor-contract.json"
INVARIANT_CONTRACTS_SCRIPT = REPO_ROOT / "scripts" / "invariant_contracts.py"


class FloorSuiteEntry(TypedDict):
    min_collected: int
    authority: str


class FloorContractPayload(TypedDict):
    schema_version: int
    python: FloorSuiteEntry
    extension: FloorSuiteEntry


@pytest.fixture(autouse=True)
def _default_base_ref_for_resolver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Module-level default: set ``BASE_REF=main`` so the resolver resolves.

    Most tests in this module exercise ``_normalized_preflight_commands``
    which internally calls ``build_commands`` -> ``resolve_pr_base_ref``.
    Post the #280 fail-closed refactor, the resolver raises SystemExit
    when neither ``BASE_REF`` nor ``GITHUB_BASE_REF`` is set. Pinning
    ``BASE_REF=main`` as the default gives every test a deterministic
    resolver return value without each test having to set it by hand.
    The ``test_preflight_has_ratchet_bump_guard_command_spec`` test
    already asserts against this exact value; the T38 AST lock reads
    source directly and does not care about the env.
    """
    monkeypatch.setenv("BASE_REF", "main")
    monkeypatch.delenv("GITHUB_BASE_REF", raising=False)


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
    ("extension-tests", "Prettier format check"): "Extension format check",
}


def _load_preflight_module():
    spec = importlib.util.spec_from_file_location("run_pr_preflight", PREFLIGHT_SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_pr_preflight"] = module
    spec.loader.exec_module(module)
    return module


def _load_invariant_contracts_module():
    spec = importlib.util.spec_from_file_location(
        "invariant_contracts", INVARIANT_CONTRACTS_SCRIPT
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["invariant_contracts"] = module
    spec.loader.exec_module(module)
    return module


def _load_test_floor_contract() -> FloorContractPayload:
    raw = json.loads(TEST_FLOOR_ARTIFACT.read_text(encoding="utf-8"))
    assert isinstance(raw, dict)
    assert isinstance(raw.get("schema_version"), int)
    python_entry = raw.get("python")
    extension_entry = raw.get("extension")
    assert isinstance(python_entry, dict)
    assert isinstance(extension_entry, dict)
    assert isinstance(python_entry.get("min_collected"), int)
    assert isinstance(python_entry.get("authority"), str)
    assert isinstance(extension_entry.get("min_collected"), int)
    assert isinstance(extension_entry.get("authority"), str)
    return {
        "schema_version": raw["schema_version"],
        "python": {
            "min_collected": python_entry["min_collected"],
            "authority": python_entry["authority"],
        },
        "extension": {
            "min_collected": extension_entry["min_collected"],
            "authority": extension_entry["authority"],
        },
    }


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
        assert "run_invariant_artifact_contract_guards" in called_functions
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


class TestFormatCheckParity:
    """Parity-drift coverage for the Prettier format:check gate.

    Contract: all call sites invoke the ``format:check`` script by name;
    no call site invokes ``prettier`` directly, passes a config path, or
    passes a glob. Invocation form is determined by cwd — ``pnpm run
    format:check`` when cwd is ``extension/`` (via
    ``cwd=EXTENSION_ROOT``, ``working-directory: extension``, or a script
    in ``extension/package.json``); ``pnpm --dir extension run
    format:check`` otherwise.
    """

    def test_format_check_script_uses_repo_root_prettierignore(self) -> None:
        """Lock the authoritative flags in the ``format:check`` script so
        no call site can silently drift on config or ignore-file path."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        script = ext_pkg.get("scripts", {}).get("format:check", "")
        assert script.startswith("prettier --check"), (
            f"format:check must invoke `prettier --check`; got: {script!r}"
        )
        assert "--ignore-path ../.prettierignore" in script, (
            "format:check must use the repo-root .prettierignore via "
            f"`--ignore-path ../.prettierignore`; got: {script!r}"
        )
        assert '"**/*.{ts,js,json,md}"' in script, (
            "format:check glob must be locked to the current scope "
            f"(ts/js/json/md); got: {script!r}"
        )

    def test_preflight_has_extension_format_check_spec(self) -> None:
        """Preflight runs inside ``extension/`` via ``cwd=EXTENSION_ROOT``,
        so the authoritative form is ``pnpm run format:check`` (inside
        form, expressed as the CommandSpec tuple)."""
        preflight = _normalized_preflight_commands()
        assert "Extension format check" in preflight, (
            "Preflight must define an 'Extension format check' CommandSpec"
        )
        assert preflight["Extension format check"] == "__PNPM__ run format:check", (
            f"Preflight format-check command must be `pnpm run format:check`; "
            f"got: {preflight['Extension format check']!r}"
        )

    def test_test_ci_includes_format_check(self) -> None:
        """The ``test:ci`` script runs inside ``extension/`` by definition
        (it is a script in ``extension/package.json``), so the authoritative
        form is ``pnpm run format:check`` (inside form)."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        test_ci = ext_pkg.get("scripts", {}).get("test:ci", "")
        assert "pnpm run format:check" in test_ci, (
            f"extension test:ci must invoke `pnpm run format:check`; got: {test_ci!r}"
        )

    def test_ci_workflow_format_check_step(self) -> None:
        """The CI ``extension-tests`` job sets ``working-directory:
        extension`` on every step, so the authoritative form is ``pnpm
        run format:check`` (inside form via ``working-directory``)."""
        step = _find_ci_step("extension-tests", "Prettier format check")
        assert step.get("working-directory") == "extension", (
            f"CI step must set `working-directory: extension`; "
            f"got: {step.get('working-directory')!r}"
        )
        assert str(step.get("run", "")).strip() == "pnpm run format:check", (
            f"CI step must run `pnpm run format:check` (inside form via "
            f"working-directory); got: {step.get('run')!r}"
        )

    def test_no_direct_prettier_check_outside_authoritative_script(self) -> None:
        """Only one file may contain the literal ``prettier --check``:
        the ``format:check`` script definition in
        ``extension/package.json``. All other call sites must go through
        ``pnpm run format:check`` (inside form) or ``pnpm --dir extension
        run format:check`` (outside form).
        """
        result = subprocess.run(
            ["git", "grep", "-n", "--fixed-strings", "prettier --check"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )
        hits = [line for line in result.stdout.splitlines() if line]

        allowed_prefixes = (
            "extension/package.json:",
            "tests/unit/test_ci_parity_drift.py:",
        )
        disallowed = [h for h in hits if not h.startswith(allowed_prefixes)]
        assert not disallowed, (
            "Direct `prettier --check` invocation found outside the "
            "authoritative script. All call sites must use `pnpm run "
            "format:check` (inside form) or `pnpm --dir extension run "
            "format:check` (outside form).\n"
            "Disallowed hits:\n" + "\n".join(f"  {h}" for h in disallowed)
        )

        pkg_hits = [h for h in hits if h.startswith("extension/package.json:")]
        assert len(pkg_hits) == 1, (
            "extension/package.json must contain exactly one "
            "`prettier --check` occurrence (the format:check script "
            f"definition). Found {len(pkg_hits)}:\n"
            + "\n".join(f"  {h}" for h in pkg_hits)
        )


class TestPartialBranchesParity:
    """Parity-drift coverage for the per-file partial-branch ratchet (#272).

    Contract: all call sites invoke the ``test:partial-branches`` script by
    name; no tier invokes ``check_partial_branches.py`` directly. The script
    in ``extension/package.json`` is the single authoritative surface.
    """

    def test_test_partial_branches_script_is_exact(self) -> None:
        """Lock the authoritative flags in the ``test:partial-branches``
        script so no call site can drift on lcov or baseline path."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        script = ext_pkg.get("scripts", {}).get("test:partial-branches", "")
        assert script == (
            "python ../scripts/check_partial_branches.py "
            "--lcov coverage/lcov.info "
            "--baseline ../.coverage-partial-branches-baseline.json"
        ), (
            "test:partial-branches must invoke check_partial_branches.py with "
            "locked --lcov and --baseline flags relative to extension/; "
            f"got: {script!r}"
        )

    def test_test_ci_includes_partial_branches(self) -> None:
        """``test:ci`` must run the partial-branch gate after ``jest ...
        --coverage`` so lcov.info exists when the gate reads it."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        test_ci = ext_pkg.get("scripts", {}).get("test:ci", "")
        assert "pnpm run test:partial-branches" in test_ci, (
            "extension test:ci must invoke `pnpm run test:partial-branches`; "
            f"got: {test_ci!r}"
        )
        coverage_index = test_ci.find("pnpm run test:coverage")
        gate_index = test_ci.find("pnpm run test:partial-branches")
        assert coverage_index != -1, (
            "test:ci must invoke `pnpm run test:coverage` (the single canonical "
            f"lcov-producing command); got: {test_ci!r}"
        )
        assert gate_index > coverage_index, (
            "test:ci must run test:partial-branches AFTER `pnpm run test:coverage` "
            "so lcov.info is available to the gate"
        )

    def test_preflight_has_partial_branches_spec(self) -> None:
        """Preflight invokes the gate via the outside form (``pnpm --dir
        extension run test:partial-branches``) because preflight runs from
        the repo root."""
        preflight = _normalized_preflight_commands()
        assert "Partial-branch ratchet" in preflight, (
            "Preflight must define a 'Partial-branch ratchet' CommandSpec"
        )
        assert preflight["Partial-branch ratchet"] == (
            "__PNPM__ --dir extension run test:partial-branches"
        ), (
            "Preflight partial-branch command must be `pnpm --dir extension "
            f"run test:partial-branches`; got: {preflight['Partial-branch ratchet']!r}"
        )

    def test_ci_workflow_partial_branches_step(self) -> None:
        """CI dedicated step uses the outside form because the step has no
        ``working-directory`` key — the ``pnpm --dir extension`` flag
        keeps the single-authoritative-command pattern."""
        step = _find_ci_step("extension-tests", "Partial-branch ratchet")
        assert str(step.get("run", "")).strip() == (
            "pnpm --dir extension run test:partial-branches"
        ), (
            "CI step must run `pnpm --dir extension run test:partial-branches` "
            f"(outside form, no working-directory); got: {step.get('run')!r}"
        )

    def test_no_direct_check_partial_branches_outside_script(self) -> None:
        """Only the ``test:partial-branches`` script in
        ``extension/package.json`` may reference ``check_partial_branches.py``
        by path. All other call sites must go through the script name."""
        result = subprocess.run(
            ["git", "grep", "-n", "--fixed-strings", "check_partial_branches.py"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )
        hits = [line for line in result.stdout.splitlines() if line]

        allowed_prefixes = (
            "extension/package.json:",
            "scripts/check_partial_branches.py:",
            "tests/unit/test_ci_parity_drift.py:",
            "tests/unit/test_check_partial_branches.py:",
        )
        disallowed = [h for h in hits if not h.startswith(allowed_prefixes)]
        assert not disallowed, (
            "Direct `check_partial_branches.py` reference found outside the "
            "authoritative script. All call sites must use `pnpm run "
            "test:partial-branches` (inside form) or `pnpm --dir extension "
            "run test:partial-branches` (outside form).\n"
            "Disallowed hits:\n" + "\n".join(f"  {h}" for h in disallowed)
        )

        pkg_hits = [h for h in hits if h.startswith("extension/package.json:")]
        assert len(pkg_hits) == 1, (
            "extension/package.json must contain exactly one "
            "`check_partial_branches.py` occurrence (the test:partial-branches "
            f"script definition). Found {len(pkg_hits)}:\n"
            + "\n".join(f"  {h}" for h in pkg_hits)
        )

    def test_partial_branches_baseline_schema(self) -> None:
        """The committed baseline must match the expected v1 schema."""
        baseline_path = REPO_ROOT / ".coverage-partial-branches-baseline.json"
        assert baseline_path.exists(), f"Baseline file must exist at {baseline_path}"
        data = json.loads(baseline_path.read_text(encoding="utf-8"))
        assert isinstance(data, dict), "baseline must be a JSON object"
        assert data.get("schema_version") == 1, (
            f"baseline schema_version must be 1; got: {data.get('schema_version')!r}"
        )
        generated_from = data.get("generated_from")
        assert isinstance(generated_from, str), (
            f"baseline 'generated_from' must be a string; got: {generated_from!r}"
        )
        assert generated_from, (
            "baseline 'generated_from' provenance string must be non-empty"
        )
        files = data.get("files")
        assert isinstance(files, dict), "baseline 'files' must be a JSON object"
        for key, value in files.items():
            assert isinstance(key, str), (
                f"baseline file key must be a string; got: {key!r}"
            )
            assert key.startswith("extension/"), (
                f"baseline file key must be an 'extension/'-rooted path; got: {key!r}"
            )
            assert isinstance(value, int), (
                f"baseline file count must be an int; {key!r} -> {value!r}"
            )
            assert value > 0, (
                f"baseline file count must be positive; {key!r} -> {value!r}"
            )


class TestTestCountRatchetParity:
    """Parity lock for the committed test-floor contract and parity proof job."""

    def test_preflight_and_ci_read_same_committed_floor_artifact(self) -> None:
        preflight = _normalized_preflight_commands()
        floor_contract = _load_test_floor_contract()

        preflight_python = preflight.get("Python test count validation", "")
        preflight_extension = preflight.get("Extension test count validation", "")
        assert preflight_python == (
            "__PYTHON__ .github/scripts/validate-test-results.py "
            "test-results.xml --min-collected-artifact .test-floor-contract.json "
            "--suite python --max-skips=0"
        )
        assert preflight_extension == (
            "__PYTHON__ .github/scripts/validate-test-results.py "
            "extension/test-results.xml --min-collected-artifact "
            ".test-floor-contract.json --suite extension --max-skips=0"
        )

        ci_python_step = _find_ci_step("test", "Validate Test Results (Python)")
        ci_python_run = str(ci_python_step.get("run", ""))
        assert "--min-collected-artifact .test-floor-contract.json" in ci_python_run
        assert "--suite python" in ci_python_run

        ci_extension_step = _find_ci_step(
            "extension-tests", "Validate Test Results (Extension)"
        )
        ci_extension_run = str(ci_extension_step.get("run", ""))
        assert "--min-collected-artifact .test-floor-contract.json" in ci_extension_run
        assert "--suite extension" in ci_extension_run

        assert floor_contract["schema_version"] == 1
        assert floor_contract["python"]["min_collected"] == 1782
        assert floor_contract["extension"]["min_collected"] > 0

    def test_preflight_and_ci_require_explicit_floor_contract_validation(self) -> None:
        preflight = _normalized_preflight_commands()
        assert preflight["Test floor contract validation"] == (
            "__PYTHON__ scripts/check_test_floor_contract.py --contract "
            ".test-floor-contract.json --extension-junit extension/test-results.xml"
        )

        ci_step = _find_ci_step("ratchet-bump-guard", "Validate test floor contract")
        ci_run = str(ci_step.get("run", ""))
        assert "scripts/check_test_floor_contract.py" in ci_run
        assert "--contract .test-floor-contract.json" in ci_run
        assert "--extension-junit ./artifacts/ts/test-results.xml" in ci_run

    def test_python_ci_includes_cross_os_collection_parity_job(self) -> None:
        job = _load_ci_jobs().get("python-collection-parity")
        assert isinstance(job, dict), (
            "CI must define a dedicated 'python-collection-parity' job so the "
            "canonical filtered collector is proven identical on ubuntu and windows "
            "before the Python floor artifact is treated as authoritative."
        )
        needs = job.get("needs")
        assert needs == "test" or needs == ["test"], (
            "python-collection-parity must depend on the Python test matrix so "
            "it compares artifacts emitted by the canonical collector legs."
        )

        compare_step = _find_ci_step(
            "python-collection-parity", "Compare Python collection parity artifacts"
        )
        compare_run = str(compare_step.get("run", ""))
        assert "scripts/check_python_collection_parity.py compare" in compare_run
        assert (
            "artifacts/python-parity/ubuntu/python-collection-parity.json"
            in compare_run
        )
        assert (
            "artifacts/python-parity/windows/python-collection-parity.json"
            in compare_run
        )

        ratchet_job = _load_ci_jobs()["ratchet-bump-guard"]
        ratchet_needs = ratchet_job.get("needs", [])
        assert "python-collection-parity" in ratchet_needs, (
            "ratchet-bump-guard must depend on python-collection-parity so the "
            "committed Python floor is not trusted before cross-OS parity is green."
        )

    def test_python_collection_parity_script_does_not_import_ratchet_gate(self) -> None:
        parity_script = REPO_ROOT / "scripts" / "check_python_collection_parity.py"
        tree = ast.parse(parity_script.read_text(encoding="utf-8"))

        forbidden_imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "check_ratchet_bump":
                        forbidden_imports.add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module in {"check_ratchet_bump", "scripts.check_ratchet_bump"}:
                    forbidden_imports.add(node.module)

        assert not forbidden_imports, (
            "check_python_collection_parity.py must not import check_ratchet_bump; "
            "the CI parity job has a lighter dependency surface and must not depend "
            f"on ratchet-only imports. Found: {sorted(forbidden_imports)}"
        )


class TestInvariantContractInventory:
    def test_invariant_artifact_contracts_declare_explicit_inputs(self) -> None:
        contracts_module = _load_invariant_contracts_module()
        contracts = contracts_module.INVARIANT_ARTIFACT_CONTRACTS
        assert contracts, "Expected at least one invariant artifact contract manifest."
        for contract in contracts:
            assert contract.artifact_path
            assert contract.input_pathspecs, (
                f"{contract.contract_id} must declare authoritative input pathspecs."
            )
            assert all(
                isinstance(pathspec, str) and pathspec
                for pathspec in contract.input_pathspecs
            ), f"{contract.contract_id} input pathspecs must be non-empty strings."
            assert contract.snapshot_mode in {"index-filesystem", "clean-worktree"}

    def test_typescript_gate_inventory_has_hard_disposition_for_each_reviewed_gate(
        self,
    ) -> None:
        contracts_module = _load_invariant_contracts_module()
        reviews = {
            review.gate_name: review
            for review in contracts_module.TYPESCRIPT_GATE_REVIEWS
        }
        expected_gates = {
            "Extension build check",
            "Extension test type check",
            "Extension test config parity",
            "Extension lint",
            "Extension test lint",
            "Extension format check",
            "Extension test count validation",
            "Partial-branch ratchet",
            "Extension smoke tests",
            "Extension VSIX artifact inspection",
        }
        assert set(reviews) == expected_gates, (
            "TypeScript parity rollout must enumerate every reviewed TS gate with "
            "an explicit disposition; add/remove entries here in the same commit as "
            "the workflow change."
        )
        for review in reviews.values():
            assert review.disposition in {
                "environment-insensitive-by-construction",
                "single-platform-canonical",
                "not-an-artifacted-invariant",
            }
            assert review.authoritative_runner
            assert review.reason


class TestPythonTypeCheckParity:
    """Lock the mypy scope for repo-owned Python automation."""

    def test_preflight_python_type_check_includes_github_scripts(self) -> None:
        preflight = _normalized_preflight_commands()
        assert preflight["Python type check"] == (
            "__PYTHON__ -m mypy src/ tests/ scripts/ .github/scripts/"
        ), (
            "Preflight mypy must cover .github/scripts/ alongside src/, tests/, "
            "and scripts/. CI-owned Python automation should not sit outside the "
            "authoritative typed gate."
        )

    def test_ci_python_type_check_matches_preflight_scope(self) -> None:
        step = _find_ci_step("mypy", "Run mypy type check")
        run_block = str(step.get("run", ""))
        assert "mypy src/ tests/ scripts/ .github/scripts/" in run_block, (
            "CI mypy must match local preflight scope exactly, including "
            ".github/scripts/, or local/CI parity is broken."
        )


class TestPythonCollectionDefinitionParity:
    """Lock shared-floor tests against interpreter-version collection drift."""

    def test_demo_parity_tests_are_not_conditionally_defined_by_python_version(
        self,
    ) -> None:
        targets = (
            REPO_ROOT / "tests" / "demo" / "test_demo_parity_pipeline.py",
            REPO_ROOT / "tests" / "demo" / "test_regeneration.py",
        )
        violations: list[str] = []

        for target in targets:
            tree = ast.parse(target.read_text(encoding="utf-8"), filename=str(target))

            def visit_block(
                nodes: list[ast.stmt], guarded: bool, target_name: str
            ) -> None:
                for node in nodes:
                    next_guarded = guarded
                    if isinstance(node, ast.If) and (
                        (
                            isinstance(node.test, ast.Name)
                            and node.test.id == "_IS_BASELINE_PYTHON"
                        )
                        or (
                            isinstance(node.test, ast.UnaryOp)
                            and isinstance(node.test.op, ast.Not)
                            and isinstance(node.test.operand, ast.Name)
                            and node.test.operand.id == "_IS_BASELINE_PYTHON"
                        )
                    ):
                        visit_block(node.body, True, target_name)
                        visit_block(node.orelse, True, target_name)
                        continue

                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and (
                        node.name.startswith("test_") and guarded
                    ):
                        violations.append(f"{target_name}:{node.name}")

                    child_body = getattr(node, "body", None)
                    if isinstance(child_body, list):
                        visit_block(child_body, next_guarded, target_name)
                    child_orelse = getattr(node, "orelse", None)
                    if isinstance(child_orelse, list):
                        visit_block(child_orelse, next_guarded, target_name)

            visit_block(tree.body, False, target.name)

        assert not violations, (
            "Shared-floor demo tests must not be conditionally defined behind "
            "_IS_BASELINE_PYTHON. Define the test unconditionally and skip inside "
            f"the body so collection remains interpreter-stable. Violations: {violations}"
        )


class TestRatchetBumpGuardParity:
    """Parity lock for the per-commit ratchet-bump discipline gate (#280).

    The gate ships as ``scripts/check_ratchet_bump.py`` and must be wired
    into both ``run_pr_preflight.py`` (CommandSpec) and ``ci.yml`` (a
    dedicated top-level job). These tests pin the exact shapes so a
    future edit cannot silently drop one surface or change the gate's
    exemption semantics.
    """

    def test_preflight_has_ratchet_bump_guard_command_spec(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Pin BASE_REF=main so the resolver returns a deterministic
        # value and we can check the normalized command string. We
        # can NOT use the empty-env path here: as of the fail-closed
        # refactor, empty env raises SystemExit via fail_setup, and
        # the resolver never returns. Setting BASE_REF=main exercises
        # the happy path for the main-targeting-PR case, which is
        # what most developers will run against.
        monkeypatch.setenv("BASE_REF", "main")
        monkeypatch.delenv("GITHUB_BASE_REF", raising=False)
        preflight = _normalized_preflight_commands()
        assert "Ratchet bump guard" in preflight, (
            "Preflight must declare a 'Ratchet bump guard' CommandSpec "
            "(issue #280). It enforces actual == --min-collected floor "
            "at HEAD for Python and Extension and inter-file parity "
            "between run_pr_preflight.py and ci.yml."
        )
        assert preflight["Ratchet bump guard"] == (
            "__PYTHON__ scripts/check_ratchet_bump.py --base-ref origin/main "
            "--junit-extension extension/test-results.xml"
        ), (
            "Preflight 'Ratchet bump guard' command must invoke "
            "check_ratchet_bump.py with --base-ref origin/main when "
            "BASE_REF=main is set; got: "
            f"{preflight['Ratchet bump guard']!r}"
        )

    def test_t38_preflight_ratchet_bump_routes_base_ref_through_resolver(
        self,
    ) -> None:
        """The CommandSpec MUST call ``resolve_pr_base_ref()`` for its ``--base-ref``
        argument, not hardcode a string literal.

        This is the AST-level lock that closes the preflight-vs-CI
        parity hole. The earlier shape test above only verifies the
        *default* value (``origin/main``) that the resolver returns
        when no env vars are set — a future refactor could silently
        revert the CommandSpec back to a hardcoded ``"origin/main"``
        string literal and that shape test would still pass, because
        the normalized command text is identical either way.

        Walking the AST instead of the runtime value is the only way
        to lock the *mechanism*: the ``--base-ref`` argument in the
        ``CommandSpec(...)`` tuple must be a ``Call`` node whose
        callee is named ``resolve_pr_base_ref``. If anyone replaces
        it with an ``ast.Constant`` string, this test fails immediately
        with a message naming the exact regression.
        """
        source = PREFLIGHT_SCRIPT.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(PREFLIGHT_SCRIPT))

        ratchet_specs: list[ast.Call] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (isinstance(func, ast.Name) and func.id == "CommandSpec"):
                continue
            if not node.args:
                continue
            name_arg = node.args[0]
            if not (
                isinstance(name_arg, ast.Constant)
                and isinstance(name_arg.value, str)
                and name_arg.value == "Ratchet bump guard"
            ):
                continue
            ratchet_specs.append(node)

        assert len(ratchet_specs) == 1, (
            f"Expected exactly one CommandSpec named 'Ratchet bump "
            f"guard' in {PREFLIGHT_SCRIPT.name}; found "
            f"{len(ratchet_specs)}. If the gate was renamed or moved, "
            "update this test."
        )

        command_tuple = ratchet_specs[0].args[1]
        assert isinstance(command_tuple, ast.Tuple), (
            "Ratchet bump guard CommandSpec second arg must be a tuple "
            "literal (not a variable) so static analysis can verify "
            f"its shape. Got: {type(command_tuple).__name__}"
        )

        # Find the --base-ref flag and its value.
        flag_index: int | None = None
        for i, element in enumerate(command_tuple.elts):
            if (
                isinstance(element, ast.Constant)
                and isinstance(element.value, str)
                and element.value == "--base-ref"
            ):
                flag_index = i
                break
        assert flag_index is not None, (
            "Ratchet bump guard CommandSpec must pass a `--base-ref` "
            "flag; none found in the tuple literal."
        )
        assert flag_index + 1 < len(command_tuple.elts), (
            "`--base-ref` flag has no value element after it in the CommandSpec tuple."
        )
        value_node = command_tuple.elts[flag_index + 1]

        # Negative assertion first — the exact regression we are
        # locking against is a string-literal base ref.
        assert not (
            isinstance(value_node, ast.Constant) and isinstance(value_node.value, str)
        ), (
            "Ratchet bump guard --base-ref MUST NOT be a hardcoded "
            "string literal. Hardcoding breaks preflight-vs-CI parity "
            "for any PR targeting a non-main branch: CI uses "
            "`origin/${github.base_ref}` but preflight would scan "
            "whatever literal is baked in. Route the value through "
            "`resolve_pr_base_ref()` so local preflight and the CI "
            "ratchet-bump-guard job compute the same commit range. "
            f"Current value node: {ast.dump(value_node)}"
        )

        # Positive assertion — it must be a Call to resolve_pr_base_ref.
        assert isinstance(value_node, ast.Call), (
            "Ratchet bump guard --base-ref must be a Call node "
            "(to resolve_pr_base_ref); got "
            f"{type(value_node).__name__}: {ast.dump(value_node)}"
        )
        callee = value_node.func
        assert isinstance(callee, ast.Name), (
            "Ratchet bump guard --base-ref Call must be to a bare "
            f"function name; got: {ast.dump(callee)}"
        )
        assert callee.id == "resolve_pr_base_ref", (
            "Ratchet bump guard --base-ref must be routed through "
            "`resolve_pr_base_ref()` (issue #280 local/CI parity lock). "
            f"Got a call to: {callee.id!r}"
        )


class TestPatchCoverageParity:
    """Parity lock for the local patch-coverage preview gate (#281).

    ``check_patch_coverage.py`` is intentionally local-only, but it still
    must compute its diff against the same PR base ref a contributor's real
    target branch implies. Hardcoding ``origin/main`` silently breaks preview
    accuracy for release/hotfix PRs, so the CommandSpec must route through the
    same base-ref resolver as the ratchet gate.
    """

    def test_preflight_has_patch_coverage_parity_command_spec(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("BASE_REF", "main")
        monkeypatch.delenv("GITHUB_BASE_REF", raising=False)
        preflight = _normalized_preflight_commands()

        assert "Local patch coverage parity" in preflight, (
            "Preflight must declare a 'Local patch coverage parity' CommandSpec "
            "(issue #281) so contributors can preview Codecov-style patch "
            "coverage against the same PR base branch they will submit to."
        )
        assert preflight["Local patch coverage parity"] == (
            "__PYTHON__ scripts/check_patch_coverage.py --base-ref origin/main "
            "--python-coverage coverage.xml --ts-coverage extension/coverage/lcov.info"
        ), (
            "Preflight 'Local patch coverage parity' command must invoke "
            "check_patch_coverage.py with --base-ref origin/main when "
            "BASE_REF=main is set; got: "
            f"{preflight['Local patch coverage parity']!r}"
        )

    def test_t39_preflight_patch_coverage_routes_base_ref_through_resolver(
        self,
    ) -> None:
        source = PREFLIGHT_SCRIPT.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(PREFLIGHT_SCRIPT))

        patch_specs: list[ast.Call] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (isinstance(func, ast.Name) and func.id == "CommandSpec"):
                continue
            if not node.args:
                continue
            name_arg = node.args[0]
            if not (
                isinstance(name_arg, ast.Constant)
                and isinstance(name_arg.value, str)
                and name_arg.value == "Local patch coverage parity"
            ):
                continue
            patch_specs.append(node)

        assert len(patch_specs) == 1, (
            f"Expected exactly one CommandSpec named 'Local patch coverage "
            f"parity' in {PREFLIGHT_SCRIPT.name}; found {len(patch_specs)}. "
            "If the gate was renamed or moved, update this test."
        )

        command_tuple = patch_specs[0].args[1]
        assert isinstance(command_tuple, ast.Tuple), (
            "Local patch coverage parity CommandSpec second arg must be a tuple "
            "literal (not a variable) so static analysis can verify its shape. "
            f"Got: {type(command_tuple).__name__}"
        )

        flag_index: int | None = None
        for i, element in enumerate(command_tuple.elts):
            if (
                isinstance(element, ast.Constant)
                and isinstance(element.value, str)
                and element.value == "--base-ref"
            ):
                flag_index = i
                break

        assert flag_index is not None, (
            "Local patch coverage parity CommandSpec must pass a `--base-ref` "
            "flag; none found in the tuple literal."
        )
        assert flag_index + 1 < len(command_tuple.elts), (
            "`--base-ref` flag has no value element after it in the CommandSpec tuple."
        )
        value_node = command_tuple.elts[flag_index + 1]

        assert not (
            isinstance(value_node, ast.Constant) and isinstance(value_node.value, str)
        ), (
            "Local patch coverage parity --base-ref MUST NOT be a hardcoded "
            "string literal. Hardcoding breaks the local patch-coverage preview "
            "for non-main-targeting PRs by diffing against the wrong base range. "
            "Route the value through `resolve_pr_base_ref()` so the preview uses "
            "the contributor's actual PR target branch. "
            f"Current value node: {ast.dump(value_node)}"
        )

        assert isinstance(value_node, ast.Call), (
            "Local patch coverage parity --base-ref must be a Call node "
            "(to resolve_pr_base_ref); got "
            f"{type(value_node).__name__}: {ast.dump(value_node)}"
        )
        callee = value_node.func
        assert isinstance(callee, ast.Name), (
            "Local patch coverage parity --base-ref Call must be to a bare "
            f"function name; got: {ast.dump(callee)}"
        )
        assert callee.id == "resolve_pr_base_ref", (
            "Local patch coverage parity --base-ref must be routed through "
            "`resolve_pr_base_ref()` (issue #281 local parity lock). "
            f"Got a call to: {callee.id!r}"
        )

    def test_ci_ratchet_bump_guard_job_is_wired_correctly(self) -> None:
        jobs = _load_ci_jobs()
        assert "ratchet-bump-guard" in jobs, (
            "CI workflow must declare a 'ratchet-bump-guard' top-level "
            "job (issue #280). Local parity lives in the 'Ratchet bump "
            "guard' preflight CommandSpec; CI parity is this dedicated "
            "job so a failing/skipped sibling cannot silently unguard "
            "the gate."
        )
        job = jobs["ratchet-bump-guard"]

        needs = job.get("needs")
        assert needs == ["test", "extension-tests", "python-collection-parity"], (
            "ratchet-bump-guard must declare `needs: [test, extension-tests, "
            "python-collection-parity]` so the gate cannot run before both "
            "test baselines AND the cross-OS Python parity proof are green; "
            f"got: {needs!r}"
        )

        if_expr = str(job.get("if", "")).strip()
        assert if_expr == "always() && !cancelled()", (
            "ratchet-bump-guard must use `if: always() && !cancelled()` so "
            "the liveness-assert step runs even when a sibling fails, "
            "surfacing the reason instead of silently skipping via "
            f"needs-propagation; got: {if_expr!r}"
        )

        step_names: list[str] = []
        for step in job.get("steps", []):
            if isinstance(step, dict):
                name = step.get("name")
                if isinstance(name, str):
                    step_names.append(name)

        for required in (
            "Assert sibling jobs succeeded (liveness)",
            "Download Extension JUnit artifact",
            "Assert Extension JUnit artifact present",
            "Run ratchet bump guard",
        ):
            assert required in step_names, (
                f"ratchet-bump-guard missing required step {required!r}; "
                f"have: {step_names}"
            )

        assert not any(
            "Python JUnit" in name or "Python artifact" in name for name in step_names
        ), (
            "ratchet-bump-guard MUST NOT download or assert the Python "
            "JUnit artifact — the gate measures Python in-job via the "
            "subprocess-isolated pytest collector, identical to local "
            "preflight. Asserting an unused artifact would create false "
            "failures unrelated to the gate's logic. Offending steps: "
            f"{[n for n in step_names if 'Python' in n]}"
        )

        gate_step = _find_ci_step("ratchet-bump-guard", "Run ratchet bump guard")
        run_block = str(gate_step.get("run", ""))
        commands = _extract_shell_commands(run_block)
        assert len(commands) == 2, (
            "ratchet-bump-guard 'Run ratchet bump guard' step must expose "
            "exactly two allowed shell command shapes: one PR/default path "
            "without --marker-range and one push path with --marker-range; "
            f"got: {commands!r}"
        )
        expected_common_prefix = (
            'python scripts/check_ratchet_bump.py --base-ref "origin/${BASE_REF}" '
        )
        expected_common_suffix = "--junit-extension ./artifacts/ts/test-results.xml"
        expected_without_marker = expected_common_prefix + expected_common_suffix
        expected_with_marker = (
            expected_common_prefix
            + '--marker-range "${MARKER_RANGE}" '
            + expected_common_suffix
        )
        assert sorted(commands) == sorted(
            [expected_without_marker, expected_with_marker]
        ), (
            "ratchet-bump-guard invocation must allow exactly the two "
            "command shapes locked by the workflow plan: shared --base-ref "
            "and --junit-extension flags in both branches, with "
            "--marker-range present only in the push branch; "
            f"got: {commands!r}"
        )
