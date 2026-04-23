"""Shape-guard test for `assert_synthetic_shape` (feature 309, slice 2b).

Contract: `specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md` §3.

Drives the helper directly against the four committed fixture trees under
``tests/demo/fixtures/strip_gate/`` plus inline tmp_path fixtures that
exercise specific rule violations (missing `_prs_cap`; `_prs_cap != 500`).

The helper lives in ``scripts/build-demo-dataset.py`` per contract; this
test loads the script as a module via ``importlib.util.spec_from_file_location``
so the unit test can import it without going through the demo-build pipeline.

Cross-OS (QG-39): pathlib + UTF-8; no shell.
Typing  (QG-40): full annotations; no `typing.Any`.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
BUILD_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "build-demo-dataset.py"
FIXTURES_ROOT: Final[Path] = REPO_ROOT / "tests" / "demo" / "fixtures" / "strip_gate"


def _load_script_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None, f"Cannot build spec for {name} at {path}"
    assert spec.loader is not None, f"Spec for {name} has no loader"
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def build_module() -> ModuleType:
    """Load build-demo-dataset.py once per test module, priming its dependencies."""
    scripts_dir = REPO_ROOT / "scripts"
    _load_script_module(
        "demo_generation_common", scripts_dir / "demo_generation_common.py"
    )
    _load_script_module("demo_shell", scripts_dir / "demo_shell.py")
    _load_script_module("strip_pr_arrays", scripts_dir / "strip_pr_arrays.py")
    return _load_script_module("build_demo_dataset", BUILD_SCRIPT)


@pytest.mark.parametrize(
    ("fixture_name", "expect_raise"),
    [
        ("sentinel-present-synthetic-shaped", False),
        ("sentinel-present-tenant-shaped", True),
        ("sentinel-absent-clean", False),
        ("sentinel-absent-with-residue", False),
    ],
)
def test_assert_synthetic_shape_matches_fixture_outcome(
    build_module: ModuleType, fixture_name: str, expect_raise: bool
) -> None:
    aggregates_dir = FIXTURES_ROOT / fixture_name / "aggregates"
    assert aggregates_dir.is_dir(), f"Fixture missing: {aggregates_dir}"
    if expect_raise:
        with pytest.raises(build_module.SyntheticShapeError) as excinfo:
            build_module.assert_synthetic_shape(aggregates_dir)
        assert fixture_name in str(excinfo.value) or "2025-W10" in str(excinfo.value), (
            "SyntheticShapeError message must include the offending file path"
        )
    else:
        build_module.assert_synthetic_shape(aggregates_dir)


def test_assert_synthetic_shape_rejects_missing_prs_cap(
    build_module: ModuleType, tmp_path: Path
) -> None:
    aggregates = tmp_path / "aggregates"
    rollups = aggregates / "weekly_rollups"
    rollups.mkdir(parents=True)
    payload = {
        "week": "2025-W20",
        "pr_count": 1,
        "prs": [
            {
                "id": 1,
                "title": "solo",
                "author_id": "u",
                "repository_id": "r",
                "cycle_time": 10.0,
            }
        ],
        "_prs_truncated": False,
    }
    (rollups / "2025-W20.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    with pytest.raises(build_module.SyntheticShapeError):
        build_module.assert_synthetic_shape(aggregates)


def test_assert_synthetic_shape_rejects_non_500_prs_cap(
    build_module: ModuleType, tmp_path: Path
) -> None:
    aggregates = tmp_path / "aggregates"
    rollups = aggregates / "weekly_rollups"
    rollups.mkdir(parents=True)
    payload = {
        "week": "2025-W21",
        "pr_count": 1,
        "prs": [
            {
                "id": 2,
                "title": "solo",
                "author_id": "u",
                "repository_id": "r",
                "cycle_time": 10.0,
            }
        ],
        "_prs_truncated": False,
        "_prs_cap": 1000,
    }
    (rollups / "2025-W21.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    with pytest.raises(build_module.SyntheticShapeError):
        build_module.assert_synthetic_shape(aggregates)
