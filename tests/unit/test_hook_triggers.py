"""Regression tests for pre-commit trigger functions.

These tests verify that the trigger scope for each pre-commit gate
matches the effective compilation scope of the tsconfig it guards.
This is a structural requirement (QG-35): pre-commit trigger scope
must match or exceed the CI gate's compilation scope.

If a refactor changes trigger logic, these tests catch scope
regressions before they reach CI.
"""

import importlib
import sys
from pathlib import Path

import pytest

# Import the hook module directly so we can test its pure functions
_hook_path = Path(__file__).resolve().parents[2] / "scripts" / "run_repo_hook.py"
_spec = importlib.util.spec_from_file_location("run_repo_hook", _hook_path)
assert _spec is not None
assert _spec.loader is not None
_hook_module = importlib.util.module_from_spec(_spec)
sys.modules["run_repo_hook"] = _hook_module
_spec.loader.exec_module(_hook_module)

is_ui_trigger = _hook_module.is_ui_trigger
is_test_trigger = _hook_module.is_test_trigger
is_pr_record_parity_trigger = _hook_module.is_pr_record_parity_trigger


class TestIsTestTrigger:
    """is_test_trigger must cover the full compilation scope of tsconfig.test.json.

    tsconfig.test.json includes: tests/**/*.ts, ui/**/*.ts, ../types/vss.d.ts
    Any file in that scope can break the test type-check gate.
    """

    @pytest.mark.parametrize(
        "path",
        [
            "extension/tests/dashboard.test.ts",
            "extension/tests/modules/metrics.test.ts",
            "extension/tests/harness/vss-sdk-mock.ts",
            "extension/tests/mocks/ado-sdk.ts",
        ],
    )
    def test_test_files_are_triggers(self, path: str) -> None:
        assert is_test_trigger(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "extension/ui/dashboard.ts",
            "extension/ui/modules/charts/throughput.ts",
            "extension/ui/artifact-client.ts",
        ],
    )
    def test_ui_source_files_are_triggers(self, path: str) -> None:
        """UI .ts files are in tsconfig.test.json's include scope.

        A UI type change can break test compilation. Pre-commit must
        catch this — not defer to pre-push or CI (QG-35 violation).
        """
        assert is_test_trigger(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "extension/tsconfig.json",
            "extension/tsconfig.test.json",
            "extension/tsconfig.type-tests.json",
        ],
    )
    def test_tsconfig_files_are_triggers(self, path: str) -> None:
        assert is_test_trigger(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "types/vss.d.ts",
        ],
    )
    def test_type_declaration_files_are_triggers(self, path: str) -> None:
        """types/vss.d.ts is referenced in tsconfig.test.json as ../types/vss.d.ts.

        Changes to shared type declarations can break test compilation.
        This trigger prevents the gap where CI catches the error but
        pre-commit does not.
        """
        assert is_test_trigger(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "extension/package.json",
            "extension/ui/styles.css",
            "extension/ui/index.html",
            "scripts/run_repo_hook.py",
            "src/ado_git_repo_insights/extract.py",
            "extension/tests/fixtures/some-fixture.json",
            "types/some-other.ts",  # only .d.ts should trigger, not arbitrary .ts in types/
        ],
    )
    def test_non_ts_files_are_not_triggers(self, path: str) -> None:
        assert is_test_trigger(path) is False


class TestIsUiTrigger:
    """Baseline regression tests for is_ui_trigger."""

    @pytest.mark.parametrize(
        "path",
        [
            "extension/ui/dashboard.ts",
            "extension/ui/styles.css",
            "extension/ui/index.html",
            "extension/tsconfig.json",
            "extension/package.json",
            "extension/eslint.config.mjs",
        ],
    )
    def test_ui_files_are_triggers(self, path: str) -> None:
        assert is_ui_trigger(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "extension/tests/dashboard.test.ts",
            "scripts/run_repo_hook.py",
            "src/ado_git_repo_insights/extract.py",
        ],
    )
    def test_non_ui_files_are_not_triggers(self, path: str) -> None:
        assert is_ui_trigger(path) is False


class TestIsPrRecordParityTrigger:
    """is_pr_record_parity_trigger must cover exactly the three files that
    ``scripts/check_pr_record_schema_parity.py`` parses (Feature 310, QG-47).

    Scope is intentionally exact — the gate parses three files and the
    trigger set MUST match those files one-for-one.  Near-miss rejections
    below lock the scope against accidental broadening (e.g. triggering on
    the 060 contract the gate does not read, or on any file under
    ``src/ado_git_repo_insights/`` that is not ``types.py``).
    """

    @pytest.mark.parametrize(
        "path",
        [
            "src/ado_git_repo_insights/types.py",
            "extension/ui/schemas/rollup.schema.ts",
            "specs/310-comments-visualization/contracts/pr-record-comments-fields.md",
        ],
    )
    def test_parity_gate_read_paths_are_triggers(self, path: str) -> None:
        """The three files the parity gate parses MUST each fire the dispatch."""
        assert is_pr_record_parity_trigger(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            # 060 contract is a human-continuity pointer, NOT parsed by the gate.
            "specs/060-throughput-pr-drilldown/contracts/pr-record.md",
            # 310 spec / plan / research / data-model / sibling gate contract
            # are not parsed by the parity gate.
            "specs/310-comments-visualization/spec.md",
            "specs/310-comments-visualization/plan.md",
            "specs/310-comments-visualization/research.md",
            "specs/310-comments-visualization/data-model.md",
            "specs/310-comments-visualization/contracts/schema-parity-gate.md",
            # Other Python files under the same package are out of scope.
            "src/ado_git_repo_insights/models.py",
            "src/ado_git_repo_insights/cli.py",
            # Other TypeScript files under the schemas/ directory are out of scope.
            "extension/ui/schemas/manifest.schema.ts",
            # Unrelated extension and script files are out of scope.
            "extension/ui/dashboard.ts",
            "scripts/run_repo_hook.py",
            "scripts/check_pr_record_schema_parity.py",
            # The gate itself and its pytest wrapper are not gate-triggers.
            "tests/unit/test_pr_record_schema_parity.py",
        ],
    )
    def test_near_miss_paths_are_not_triggers(self, path: str) -> None:
        """Exact-match scope rejects everything outside the three read paths."""
        assert is_pr_record_parity_trigger(path) is False
