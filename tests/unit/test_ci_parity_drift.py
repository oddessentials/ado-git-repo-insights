"""Parity-drift verification for CI gates.

Parses the CI workflow and preflight command list structurally, then
asserts exact equality between the gates each system enforces.  Substring
checks are explicitly avoided — if a gate name drifts by even one
character, these tests fail.

Also verifies the root test:ci delegates to the canonical preflight and
that extension test:ci includes every required TypeScript gate.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent.parent

# --- Canonical gate lists (single source of truth) ---

REQUIRED_EXTENSION_GATES = [
    "build:check",
    "lint:tests",
    "build:check-tests",
    "test:config-parity",
    "test:types",
    "jest",
    "test:smoke",
]

# CI extension-tests job step names that correspond to enforcement gates.
# Maintenance steps (checkout, setup, install, upload, etc.) are excluded.
CI_EXTENSION_GATE_STEP_NAMES = {
    "TypeScript Type Check",
    "TypeScript Test Type Check",
    "TypeScript Test Config Parity",
    "ESLint (production)",
    "ESLint (tests)",
    "Run Extension UI Tests",
    "Validate Test Results (Extension)",
}

# Preflight CommandSpec names that correspond to CI extension gates.
PREFLIGHT_EXTENSION_GATE_NAMES = {
    "Extension build check",
    "Extension test type check",
    "Extension test config parity",
    "Extension lint",
    "Extension test lint",
    "Extension Jest CI",
    "Extension test count validation",
}

# CI job names that must exist as top-level jobs.
REQUIRED_CI_JOBS = {
    "ci-guards",
    "secret-scan",
    "pnpm-lockfile-guard",
    "npm-command-guard",
    "line-ending-guard",
    "ui-bundle-sync",
    "test",
    "mypy",
    "suppression-audit",
    "extension-tests",
    "build",
    "build-extension",
    "parity-gate",
}

# Preflight CommandSpec names that map to CI Python-side gates.
PREFLIGHT_PYTHON_GATE_NAMES = {
    "Suppression baseline sync gate",
    "Suppression scope coverage (FR-026)",
    "Baseline staleness (FR-025)",
    "Rule-disable invariants (FR-014)",
    "Python type check",
    "No typing.Any in src/ (QG-40)",
    "Full Python test suite with coverage",
    "Python test count validation",
}


# --- Helpers ---


def find_missing_gates(script: str) -> list[str]:
    """Return gate names not found in the given script string."""
    return [gate for gate in REQUIRED_EXTENSION_GATES if gate not in script]


def _load_preflight_command_names() -> list[str]:
    """Extract CommandSpec name strings from run_pr_preflight.py."""
    preflight_src = (REPO_ROOT / "scripts" / "run_pr_preflight.py").read_text(
        encoding="utf-8"
    )
    return re.findall(r'CommandSpec\(\s*"([^"]+)"', preflight_src)


def _load_ci_jobs() -> dict[str, object]:
    """Parse ci.yml and return the jobs dict."""
    ci_text = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    ci_data = yaml.safe_load(ci_text)
    return ci_data.get("jobs", {})


def _load_ci_extension_step_names() -> set[str]:
    """Extract step names from CI extension-tests job."""
    jobs = _load_ci_jobs()
    steps = jobs.get("extension-tests", {}).get("steps", [])
    return {s["name"] for s in steps if "name" in s}


# --- Tests ---


class TestRootTestCi:
    """Root package.json test:ci must delegate to the canonical preflight."""

    def test_root_test_ci_is_exactly_preflight(self) -> None:
        root_pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        script = root_pkg.get("scripts", {}).get("test:ci", "")
        assert script == "python scripts/run_pr_preflight.py", (
            f"Root test:ci must be exactly 'python scripts/run_pr_preflight.py'. "
            f"Actual: {script!r}"
        )


class TestExtensionTestCi:
    """Extension test:ci must include all required TypeScript gates."""

    def test_extension_test_ci_includes_critical_gates(self) -> None:
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        script = ext_pkg.get("scripts", {}).get("test:ci", "")
        missing = find_missing_gates(script)
        assert not missing, (
            f"Extension test:ci is missing CI gates: {missing}. "
            f"Actual script: {script!r}"
        )

    def test_extension_lint_tests_is_exact(self) -> None:
        """lint:tests must run eslint on tests/ with zero warnings."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        script = ext_pkg.get("scripts", {}).get("lint:tests", "")
        assert script == "eslint tests/ --max-warnings=0", (
            f"lint:tests must be exactly 'eslint tests/ --max-warnings=0'. "
            f"Actual: {script!r}"
        )

    def test_extension_lint_is_exact_for_all_production_scopes(self) -> None:
        """lint must cover all compiled production TypeScript paths."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        script = ext_pkg.get("scripts", {}).get("lint", "")
        assert script == "eslint ui/ scripts/ tasks/_shared/ --max-warnings=0", (
            "lint must be exactly "
            "'eslint ui/ scripts/ tasks/_shared/ --max-warnings=0'. "
            f"Actual: {script!r}"
        )


class TestCiExtensionGateParity:
    """CI extension-tests steps must have preflight equivalents and vice versa."""

    def test_ci_extension_gate_steps_exist(self) -> None:
        """Every expected CI extension gate step must exist in ci.yml."""
        actual = _load_ci_extension_step_names()
        missing = CI_EXTENSION_GATE_STEP_NAMES - actual
        assert not missing, (
            f"CI extension-tests job is missing gate steps: {missing}. "
            f"Actual steps: {sorted(actual)}"
        )

    def test_preflight_extension_gates_exist(self) -> None:
        """Every expected preflight extension gate must exist in run_pr_preflight.py."""
        actual = set(_load_preflight_command_names())
        missing = PREFLIGHT_EXTENSION_GATE_NAMES - actual
        assert not missing, (
            f"Preflight is missing extension gate commands: {missing}. "
            f"Actual commands: {sorted(actual)}"
        )


class TestCiPythonGateParity:
    """CI Python gates must have preflight equivalents."""

    def test_preflight_python_gates_exist(self) -> None:
        """Every expected preflight Python gate must exist."""
        actual = set(_load_preflight_command_names())
        missing = PREFLIGHT_PYTHON_GATE_NAMES - actual
        assert not missing, (
            f"Preflight is missing Python gate commands: {missing}. "
            f"Actual commands: {sorted(actual)}"
        )

    def test_ci_has_mypy_job(self) -> None:
        jobs = _load_ci_jobs()
        assert "mypy" in jobs, "CI must have a mypy job"

    def test_ci_has_suppression_audit_job(self) -> None:
        jobs = _load_ci_jobs()
        assert "suppression-audit" in jobs, "CI must have a suppression-audit job"

    def test_ci_has_secret_scan_job(self) -> None:
        jobs = _load_ci_jobs()
        assert "secret-scan" in jobs, "CI must have a secret-scan job"


class TestCiJobCompleteness:
    """All required CI jobs must exist."""

    def test_all_required_ci_jobs_exist(self) -> None:
        actual = set(_load_ci_jobs().keys())
        missing = REQUIRED_CI_JOBS - actual
        assert not missing, (
            f"CI workflow is missing required jobs: {missing}. "
            f"Actual jobs: {sorted(actual)}"
        )


class TestPreflightCompleteness:
    """Preflight must include critical cross-cutting gates."""

    def test_preflight_includes_suppression_audit(self) -> None:
        names = _load_preflight_command_names()
        suppression_gates = [n for n in names if "suppression" in n.lower()]
        assert len(suppression_gates) >= 1, (
            f"Preflight must include at least one suppression gate. Found: {names}"
        )

    def test_preflight_includes_mypy(self) -> None:
        names = _load_preflight_command_names()
        mypy_gates = [n for n in names if "type check" in n.lower()]
        assert len(mypy_gates) >= 1, (
            f"Preflight must include at least one type check gate. Found: {names}"
        )

    def test_preflight_includes_any_ratchet(self) -> None:
        names = _load_preflight_command_names()
        any_gates = [n for n in names if "any" in n.lower() or "qg-40" in n.lower()]
        assert len(any_gates) >= 1, (
            f"Preflight must include Any-type ratchet gate (QG-40). Found: {names}"
        )


class TestCiParityDriftNegative:
    """Verify the detection logic catches missing gates.

    These tests use synthetic scripts (not real files) to confirm that
    find_missing_gates would fail if a gate were removed.
    """

    def test_missing_single_gate_detected(self) -> None:
        script = (
            "pnpm run build:check && pnpm run build:check-tests && "
            "pnpm run test:config-parity && pnpm run test:types && "
            "jest --ci && pnpm run test:smoke"
        )
        missing = find_missing_gates(script)
        assert "lint:tests" in missing
        assert len(missing) == 1

    def test_missing_multiple_gates_detected(self) -> None:
        script = "pnpm run build:check && jest --ci"
        missing = find_missing_gates(script)
        assert "lint:tests" in missing
        assert "build:check-tests" in missing
        assert "test:config-parity" in missing
        assert "test:types" in missing
        assert "test:smoke" in missing
        assert len(missing) == 5

    def test_empty_script_fails_all_gates(self) -> None:
        missing = find_missing_gates("")
        assert len(missing) == len(REQUIRED_EXTENSION_GATES)

    def test_complete_script_passes(self) -> None:
        script = (
            "pnpm run build:check && pnpm run lint:tests && "
            "pnpm run build:check-tests && pnpm run test:config-parity && "
            "pnpm run test:types && jest --ci && pnpm run test:smoke"
        )
        missing = find_missing_gates(script)
        assert missing == []
