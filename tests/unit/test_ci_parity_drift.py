"""Parity-drift verification for CI gates.

Ensures the root package.json test:ci delegates to extension test:ci,
that extension test:ci includes all required gates (including lint:tests),
and that lint:tests is present in the preflight and CI workflow.

Includes negative tests that verify the detection logic itself catches
missing gates, preventing silent regression if the assertion patterns
are accidentally weakened.
"""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent

# --- Shared detection helpers used by both positive and negative tests ---

REQUIRED_EXTENSION_GATES = [
    "build:check",
    "lint:tests",
    "build:check-tests",
    "test:config-parity",
    "test:types",
    "jest",
    "test:smoke",
]


def find_missing_gates(script: str) -> list[str]:
    """Return gate names not found in the given script string."""
    return [gate for gate in REQUIRED_EXTENSION_GATES if gate not in script]


class TestCiParityDrift:
    """Verify CI gate parity across all enforcement paths."""

    def test_root_test_ci_delegates_to_extension_test_ci(self) -> None:
        """Root test:ci must call 'pnpm run test:ci' inside extension/."""
        root_pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        script = root_pkg.get("scripts", {}).get("test:ci", "")
        assert "pnpm run test:ci" in script, (
            "Root test:ci must delegate to extension's test:ci "
            "to preserve CI gate parity. "
            f"Actual script: {script!r}"
        )

    def test_extension_test_ci_includes_critical_gates(self) -> None:
        """Extension test:ci must include all CI-enforced TypeScript gates."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        script = ext_pkg.get("scripts", {}).get("test:ci", "")
        missing = find_missing_gates(script)
        assert not missing, (
            f"Extension test:ci is missing CI gates: {missing}. "
            f"Actual script: {script!r}"
        )

    def test_root_test_ci_starts_with_suppression_audit(self) -> None:
        """Suppression audit must be the first command in root test:ci."""
        root_pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        script = root_pkg.get("scripts", {}).get("test:ci", "")
        assert script.startswith("python scripts/audit-suppressions.py --diff"), (
            "Root test:ci must start with suppression audit. "
            f"Actual script starts with: {script[:80]!r}"
        )

    def test_extension_lint_tests_script_exists(self) -> None:
        """Extension must define lint:tests as the authoritative test lint command."""
        ext_pkg = json.loads(
            (REPO_ROOT / "extension" / "package.json").read_text(encoding="utf-8")
        )
        script = ext_pkg.get("scripts", {}).get("lint:tests", "")
        assert "eslint tests/" in script, (
            f"lint:tests must run eslint on tests/. Actual: {script!r}"
        )
        assert "--max-warnings=0" in script, (
            f"lint:tests must enforce --max-warnings=0. Actual: {script!r}"
        )

    def test_preflight_includes_lint_tests(self) -> None:
        """PR preflight must include lint:tests as a gate."""
        preflight = (REPO_ROOT / "scripts" / "run_pr_preflight.py").read_text(
            encoding="utf-8"
        )
        assert "lint:tests" in preflight, (
            "run_pr_preflight.py must include lint:tests as a gate"
        )

    def test_ci_workflow_includes_lint_tests(self) -> None:
        """CI workflow must include lint:tests as a step."""
        ci_yml = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(
            encoding="utf-8"
        )
        assert "lint:tests" in ci_yml, (
            ".github/workflows/ci.yml must include lint:tests as a step"
        )


class TestCiParityDriftNegative:
    """Verify the detection logic catches missing gates.

    These tests use synthetic scripts (not real files) to confirm that
    find_missing_gates and the assertion patterns would fail if a gate
    were removed. Without these, a weakened assertion regex could silently
    pass even when a gate is missing.
    """

    def test_missing_single_gate_detected(self) -> None:
        """Removing one gate from the script must produce exactly one missing entry."""
        # Script with lint:tests deliberately removed
        script = (
            "pnpm run build:check && pnpm run build:check-tests && "
            "pnpm run test:config-parity && pnpm run test:types && "
            "jest --ci && pnpm run test:smoke"
        )
        missing = find_missing_gates(script)
        assert "lint:tests" in missing, (
            "find_missing_gates must detect removed lint:tests"
        )
        assert len(missing) == 1

    def test_missing_multiple_gates_detected(self) -> None:
        """Removing several gates must be detected."""
        script = "pnpm run build:check && jest --ci"
        missing = find_missing_gates(script)
        assert "lint:tests" in missing
        assert "build:check-tests" in missing
        assert "test:config-parity" in missing
        assert "test:types" in missing
        assert "test:smoke" in missing
        assert len(missing) == 5

    def test_empty_script_fails_all_gates(self) -> None:
        """An empty script must fail every gate check."""
        missing = find_missing_gates("")
        assert len(missing) == len(REQUIRED_EXTENSION_GATES)

    def test_complete_script_passes(self) -> None:
        """A script containing all gates must produce no missing entries."""
        script = (
            "pnpm run build:check && pnpm run lint:tests && "
            "pnpm run build:check-tests && pnpm run test:config-parity && "
            "pnpm run test:types && jest --ci && pnpm run test:smoke"
        )
        missing = find_missing_gates(script)
        assert missing == []

    def test_delegation_check_catches_missing_delegation(self) -> None:
        """A root script that doesn't delegate must be detectable."""
        script = "python scripts/audit-suppressions.py --diff && pnpm run lint"
        assert "pnpm run test:ci" not in script

    def test_suppression_audit_first_check_catches_wrong_order(self) -> None:
        """A root script that doesn't start with suppression audit must be detectable."""
        script = "pnpm run lint && python scripts/audit-suppressions.py --diff"
        assert not script.startswith("python scripts/audit-suppressions.py --diff")
