"""Parity-drift verification for root test:ci vs extension CI gates.

Ensures the root package.json test:ci script delegates to the extension's
test:ci, which is the authoritative gate list. If the root script duplicates
or skips extension gates, this test catches the drift.
"""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent


class TestCiParityDrift:
    """Verify root test:ci delegates to extension test:ci."""

    def test_root_test_ci_delegates_to_extension_test_ci(self) -> None:
        """Root test:ci must call 'pnpm run test:ci' inside extension/.

        This ensures all extension-defined CI gates (build:check,
        build:check-tests, test:config-parity, test:types, jest, test:smoke)
        are run locally without duplication.
        """
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
        required_gates = [
            "build:check",
            "build:check-tests",
            "test:config-parity",
            "test:types",
            "jest",
            "test:smoke",
        ]
        missing = [gate for gate in required_gates if gate not in script]
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
