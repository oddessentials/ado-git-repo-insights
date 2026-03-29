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
_hook_module = importlib.util.module_from_spec(_spec)
sys.modules["run_repo_hook"] = _hook_module
_spec.loader.exec_module(_hook_module)

is_ui_trigger = _hook_module.is_ui_trigger
is_test_trigger = _hook_module.is_test_trigger


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
            "extension/package.json",
            "extension/ui/styles.css",
            "extension/ui/index.html",
            "scripts/run_repo_hook.py",
            "src/ado_git_repo_insights/extract.py",
            "extension/tests/fixtures/some-fixture.json",
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
