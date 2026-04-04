"""Regression tests: narrowing must fail closed on malformed input.

Proves that the fail-open paths introduced during Any elimination are
closed.  Each test injects one malformed value into an otherwise valid
structure and asserts an exception with path/context information.

Added as part of #243 hardening — these must never pass silently.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"


def _ensure_script_module(name: str) -> ModuleType:
    """Load a scripts/ module and register it in sys.modules so sibling imports resolve."""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / f"{name}.py")
    if spec is None or spec.loader is None:
        raise AssertionError(f"Unable to load {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# Pre-register shared modules so sibling imports from scripts work
_ensure_script_module("demo_generation_common")
_ensure_script_module("demo_shell")


def _load_script(name: str) -> ModuleType:
    return _ensure_script_module(name)


def _write_rollup(rollups_dir: Path, rollup: dict[str, object]) -> None:
    """Write a single rollup JSON file."""
    week = rollup.get("week", "2025-W01")
    (rollups_dir / f"{week}.json").write_text(
        json.dumps(rollup, indent=2), encoding="utf-8"
    )


def _valid_rollup(**overrides: object) -> dict[str, object]:
    """Return a minimal valid rollup dict, with optional overrides."""
    base: dict[str, object] = {
        "week": "2025-W01",
        "start_date": "2025-01-06",
        "end_date": "2025-01-12",
        "pr_count": 10,
        "cycle_time_p50": 120.0,
        "cycle_time_p90": 480.0,
        "authors_count": 5,
        "reviewers_count": 3,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1. Malformed weekly_rollups entry in manifest
# ---------------------------------------------------------------------------


class TestLoadRollupIndexFailClosed:
    """_load_rollup_index must reject non-dict entries, not filter them."""

    def test_non_dict_entry_raises_with_index(self) -> None:
        mod = _load_script("build-demo-dataset")
        manifest: Mapping[str, object] = {
            "aggregate_index": {
                "weekly_rollups": [
                    {"week": "2025-W01", "path": "rollups/2025-W01.json"},
                    "not-a-dict",
                    {"week": "2025-W03", "path": "rollups/2025-W03.json"},
                ]
            }
        }

        with pytest.raises(TypeError, match=r"weekly_rollups\[1\] expected dict"):
            mod._load_rollup_index(Path("/nonexistent"), manifest)


# ---------------------------------------------------------------------------
# 2. Malformed reviewer_filter_examples entry mixed with valid ones
# ---------------------------------------------------------------------------


class TestReviewerFilterExamplesFailClosed:
    """reviewer_filter_examples must reject non-dict entries, not filter them."""

    def test_non_dict_example_raises_with_index(self, tmp_path: Path) -> None:
        mod = _load_script("build-demo-dataset")

        manifest_data = {
            "aggregate_index": {"weekly_rollups": [], "distributions": []},
            "reviewer_fixtures": {
                "fixture_week": "2025-W10",
                "minimum_active_reviewers": 3,
                "minimum_reviewed_prs_per_reviewer": 5,
                "minimum_review_actions_per_reviewer": 5,
                "minimum_multi_repo_reviewers": 2,
                "reviewer_filter_examples": [
                    {"week": "2025-W10", "reviewer_id": "r1", "reviewer_name": "Alice"},
                    42,
                ],
                "reviewer_constrained_example": {},
                "reviewer_team_disallowed_example": {},
            },
        }

        (tmp_path / "dataset-manifest.json").write_text(
            json.dumps(manifest_data), encoding="utf-8"
        )
        (tmp_path / "aggregates").mkdir(parents=True, exist_ok=True)
        (tmp_path / "aggregates" / "dimensions.json").write_text(
            json.dumps({"reviewers": [], "teams": []}), encoding="utf-8"
        )

        with pytest.raises(
            TypeError, match=r"reviewer_filter_examples\[1\] expected dict"
        ):
            mod.validate_reviewer_fixture_contract(tmp_path)


# ---------------------------------------------------------------------------
# 3. Reviewer metric type enforcement (reviewed_prs, reviews_count, thresholds)
# ---------------------------------------------------------------------------


def _minimal_reviewer_fixture_on_disk(
    tmp_path: Path,
    *,
    by_reviewer: Mapping[str, object],
    fixture_week: str = "2025-W10",
) -> Path:
    """Write the minimum files needed by validate_reviewer_fixture_contract."""
    data_dir = tmp_path / "data"
    rollups_dir = data_dir / "aggregates" / "weekly_rollups"
    rollups_dir.mkdir(parents=True)

    reviewer_ids = list(by_reviewer.keys())
    reviewers_dim = [
        {"reviewer_id": rid, "reviewer_name": f"User-{rid}"} for rid in reviewer_ids
    ]
    (data_dir / "aggregates" / "dimensions.json").write_text(
        json.dumps({"reviewers": reviewers_dim, "teams": []}), encoding="utf-8"
    )

    rollup = {
        "week": fixture_week,
        "start_date": "2025-03-03",
        "end_date": "2025-03-09",
        "pr_count": 50,
        "cycle_time_p50": 120.0,
        "cycle_time_p90": 480.0,
        "authors_count": 10,
        "reviewers_count": len(reviewer_ids),
        "by_reviewer": by_reviewer,
        "by_repository": {},
    }
    (rollups_dir / f"{fixture_week}.json").write_text(
        json.dumps(rollup, indent=2), encoding="utf-8"
    )

    manifest = {
        "aggregate_index": {
            "weekly_rollups": [
                {
                    "week": fixture_week,
                    "path": f"aggregates/weekly_rollups/{fixture_week}.json",
                }
            ],
            "distributions": [],
        },
        "reviewer_fixtures": {
            "minimum_active_reviewers": 1,
            "minimum_reviewed_prs_per_reviewer": 2,
            "minimum_review_actions_per_reviewer": 2,
            "minimum_multi_repo_reviewers": 0,
            "reviewer_filter_examples": [
                {
                    "week": fixture_week,
                    "reviewer_id": reviewer_ids[0],
                    "reviewer_name": f"User-{reviewer_ids[0]}",
                }
            ],
            "reviewer_constrained_example": {
                "week": fixture_week,
                "reviewer_id": reviewer_ids[0],
                "repository_name": "dummy-repo",
            },
            "reviewer_team_disallowed_example": {
                "week": fixture_week,
                "reviewer_id": reviewer_ids[0],
                "team_name": "dummy-team",
            },
        },
    }
    (data_dir / "dataset-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    return data_dir


class TestReviewerMetricTypeEnforcement:
    """Non-numeric reviewed_prs/reviews_count must raise, not be silently skipped."""

    def test_string_reviewed_prs_raises(self) -> None:
        mod = _load_script("build-demo-dataset")
        fixture_by_reviewer = {
            "r1": {
                "reviewed_prs": "many",
                "reviews_count": 10,
                "repositories_count": 1,
            },
        }
        with pytest.raises(TypeError, match=r"reviewer 'r1'.*non-numeric reviewed_prs"):
            mod._collect_eligible_reviewer_ids(
                fixture_by_reviewer, minimum_reviewed_prs=2, minimum_review_actions=2
            )

    def test_string_reviews_count_raises(self) -> None:
        mod = _load_script("build-demo-dataset")
        fixture_by_reviewer = {
            "r1": {
                "reviewed_prs": 10,
                "reviews_count": "lots",
                "repositories_count": 1,
            },
        }
        with pytest.raises(
            TypeError, match=r"reviewer 'r1'.*non-numeric reviews_count"
        ):
            mod._collect_eligible_reviewer_ids(
                fixture_by_reviewer, minimum_reviewed_prs=2, minimum_review_actions=2
            )

    def test_none_reviewed_prs_raises(self) -> None:
        mod = _load_script("build-demo-dataset")
        fixture_by_reviewer = {
            "r1": {"reviewed_prs": None, "reviews_count": 10, "repositories_count": 1},
        }
        with pytest.raises(TypeError, match=r"reviewer 'r1'.*non-numeric reviewed_prs"):
            mod._collect_eligible_reviewer_ids(
                fixture_by_reviewer, minimum_reviewed_prs=2, minimum_review_actions=2
            )

    def test_valid_numeric_values_accepted(self) -> None:
        mod = _load_script("build-demo-dataset")
        fixture_by_reviewer = {
            "r1": {"reviewed_prs": 10, "reviews_count": 8, "repositories_count": 2},
            "r2": {"reviewed_prs": 3.0, "reviews_count": 5.0, "repositories_count": 1},
        }
        result = mod._collect_eligible_reviewer_ids(
            fixture_by_reviewer, minimum_reviewed_prs=2, minimum_review_actions=2
        )
        assert set(result) == {"r1", "r2"}


class TestReviewerThresholdTypeEnforcement:
    """Non-numeric fixture threshold values must raise, not pass through assert."""

    def test_string_threshold_raises(self) -> None:
        mod = _load_script("build-demo-dataset")
        fixtures = {
            "minimum_active_reviewers": "three",
            "minimum_reviewed_prs_per_reviewer": 5,
            "minimum_review_actions_per_reviewer": 5,
            "minimum_multi_repo_reviewers": 2,
        }
        with pytest.raises(
            TypeError,
            match=r"reviewer_fixtures\['minimum_active_reviewers'\] expected numeric",
        ):
            mod._collect_reviewer_fixture_thresholds(fixtures)

    def test_none_threshold_raises(self) -> None:
        mod = _load_script("build-demo-dataset")
        fixtures = {
            "minimum_active_reviewers": 3,
            "minimum_reviewed_prs_per_reviewer": None,
            "minimum_review_actions_per_reviewer": 5,
            "minimum_multi_repo_reviewers": 2,
        }
        with pytest.raises(
            TypeError,
            match=r"reviewer_fixtures\['minimum_reviewed_prs_per_reviewer'\] expected numeric",
        ):
            mod._collect_reviewer_fixture_thresholds(fixtures)


class TestMixedValidInvalidReviewerSlices:
    """A single malformed reviewer entry must fail the entire contract."""

    def test_mixed_reviewer_metrics_fail_contract(self, tmp_path: Path) -> None:
        mod = _load_script("build-demo-dataset")
        by_reviewer = {
            "r1": {"reviewed_prs": 10, "reviews_count": 8, "repositories_count": 2},
            "r2": {
                "reviewed_prs": "corrupted",
                "reviews_count": 5,
                "repositories_count": 1,
            },
        }
        data_dir = _minimal_reviewer_fixture_on_disk(tmp_path, by_reviewer=by_reviewer)

        with pytest.raises(TypeError, match=r"reviewer 'r2'.*non-numeric reviewed_prs"):
            mod.validate_reviewer_fixture_contract(data_dir)

    def test_mixed_reviews_count_fail_contract(self, tmp_path: Path) -> None:
        mod = _load_script("build-demo-dataset")
        by_reviewer = {
            "r1": {"reviewed_prs": 10, "reviews_count": 8, "repositories_count": 2},
            "r2": {
                "reviewed_prs": 5,
                "reviews_count": {"nested": True},
                "repositories_count": 1,
            },
        }
        data_dir = _minimal_reviewer_fixture_on_disk(tmp_path, by_reviewer=by_reviewer)

        with pytest.raises(
            TypeError, match=r"reviewer 'r2'.*non-numeric reviews_count"
        ):
            mod.validate_reviewer_fixture_contract(data_dir)


class TestRepositoriesCountTypeEnforcement:
    """Non-numeric repositories_count in multi-repo check must raise, not skip."""

    def test_string_repositories_count_raises(self, tmp_path: Path) -> None:
        mod = _load_script("build-demo-dataset")
        # r1 is eligible (meets thresholds) but has non-numeric repositories_count
        by_reviewer = {
            "r1": {
                "reviewed_prs": 10,
                "reviews_count": 8,
                "repositories_count": "many",
            },
        }
        data_dir = _minimal_reviewer_fixture_on_disk(tmp_path, by_reviewer=by_reviewer)

        with pytest.raises(
            TypeError, match=r"reviewer 'r1'.*non-numeric repositories_count"
        ):
            mod.validate_reviewer_fixture_contract(data_dir)


# ---------------------------------------------------------------------------
# 4. python -O must not disable fail-fast validation
# ---------------------------------------------------------------------------


def _write_optimize_runner(tmp_path: Path, body: str) -> Path:
    """Write a helper script that loads scripts/ modules via importlib.

    Avoids sys.path manipulation — registers modules in sys.modules
    using importlib.util.spec_from_file_location instead.
    """
    runner = tmp_path / "_optimize_runner.py"
    runner.write_text(
        "import importlib.util, sys\n"
        "from pathlib import Path\n"
        "\n"
        "def _load(name, rel_path):\n"
        "    spec = importlib.util.spec_from_file_location(name, rel_path)\n"
        "    mod = importlib.util.module_from_spec(spec)\n"
        "    sys.modules[name] = mod\n"
        "    spec.loader.exec_module(mod)\n"
        "    return mod\n"
        "\n"
        "_load('demo_generation_common', 'scripts/demo_generation_common.py')\n"
        "_load('demo_shell', 'scripts/demo_shell.py')\n"
        "\n" + body + "\n",
        encoding="utf-8",
    )
    return runner


class TestPythonOptimizeModeStillFails:
    """Assert-based guards were replaced with explicit raises; verify under -O."""

    def test_non_numeric_threshold_fails_under_optimize(self, tmp_path: Path) -> None:
        """_collect_reviewer_fixture_thresholds must fail even with python -O."""
        runner = _write_optimize_runner(
            tmp_path,
            "build = _load('build_demo_dataset', 'scripts/build-demo-dataset.py')\n"
            "build._collect_reviewer_fixture_thresholds({\n"
            "    'minimum_active_reviewers': 'bad',\n"
            "    'minimum_reviewed_prs_per_reviewer': 5,\n"
            "    'minimum_review_actions_per_reviewer': 5,\n"
            "    'minimum_multi_repo_reviewers': 2,\n"
            "})\n",
        )
        result = subprocess.run(
            [sys.executable, "-O", str(runner)],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )
        assert result.returncode != 0
        assert "expected numeric" in result.stderr

    def test_non_dict_features_fails_under_optimize(self, tmp_path: Path) -> None:
        """refresh_demo_manifest_features must fail even with python -O."""
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(
            json.dumps({"features": "not-a-dict"}), encoding="utf-8"
        )
        runner = _write_optimize_runner(
            tmp_path,
            "common = _load('demo_generation_common', "
            "'scripts/demo_generation_common.py')\n"
            f"common.refresh_demo_manifest_features(Path(r'{manifest_path}'), "
            "Path('.'))\n",
        )
        result = subprocess.run(
            [sys.executable, "-O", str(runner)],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )
        assert result.returncode != 0
        assert "expected dict" in result.stderr


# ---------------------------------------------------------------------------
# 5. Non-numeric cycle_time_p50 in predictions (subprocess — complex module setup)
# ---------------------------------------------------------------------------


class TestPredictionsCycleTimeFailClosed:
    """Predictions must reject non-numeric cycle_time_p50, not coerce to 0.0."""

    def _run_predictions(
        self, tmp_path: Path, rollup: dict[str, object]
    ) -> subprocess.CompletedProcess[str]:
        data_dir = tmp_path / "data"
        rollups_dir = data_dir / "aggregates" / "weekly_rollups"
        rollups_dir.mkdir(parents=True)
        _write_rollup(rollups_dir, rollup)

        return subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / "generate-demo-predictions.py"),
                "--output-root",
                str(data_dir),
            ],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )

    def test_string_cycle_time_raises(self, tmp_path: Path) -> None:
        result = self._run_predictions(
            tmp_path, _valid_rollup(cycle_time_p50="corrupted")
        )
        assert result.returncode != 0
        assert "cycle_time_p50" in result.stderr
        assert "expected numeric or null" in result.stderr

    def test_null_cycle_time_allowed(self, tmp_path: Path) -> None:
        """None/null cycle_time_p50 is a valid contract value → coerce to 0.0."""
        result = self._run_predictions(tmp_path, _valid_rollup(cycle_time_p50=None))
        # Should not crash — null is valid per contract
        # (may fail for other reasons like missing 8 weeks of data, but NOT TypeError)
        assert "expected numeric or null" not in (result.stderr or "")


# ---------------------------------------------------------------------------
# 4. Malformed cycle_time in insights top-level rollup (subprocess)
# ---------------------------------------------------------------------------


class TestInsightsCycleTimeFailClosed:
    """Insights must reject non-numeric cycle times, not silently coerce to None."""

    def _run_insights(
        self, tmp_path: Path, rollup: dict[str, object]
    ) -> subprocess.CompletedProcess[str]:
        data_dir = tmp_path / "data"
        rollups_dir = data_dir / "aggregates" / "weekly_rollups"
        rollups_dir.mkdir(parents=True)
        _write_rollup(rollups_dir, rollup)

        return subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / "generate-demo-insights.py"),
                "--output-root",
                str(data_dir),
            ],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )

    def test_string_cycle_time_in_rollup_raises(self, tmp_path: Path) -> None:
        result = self._run_insights(tmp_path, _valid_rollup(cycle_time_p50="bad_value"))
        assert result.returncode != 0
        assert "cycle_time_p50" in result.stderr
        assert "expected numeric or null" in result.stderr


# ---------------------------------------------------------------------------
# 5. Malformed cycle_time inside by_repository in insights (subprocess)
# ---------------------------------------------------------------------------


class TestInsightsRepoCycleTimeFailClosed:
    """Insights must reject non-numeric cycle times in repo breakdowns."""

    def test_string_cycle_time_in_repo_raises(self, tmp_path: Path) -> None:
        data_dir = tmp_path / "data"
        rollups_dir = data_dir / "aggregates" / "weekly_rollups"
        rollups_dir.mkdir(parents=True)
        rollup = _valid_rollup(
            by_repository={
                "my-repo": {
                    "pr_count": 5,
                    "cycle_time_p50": {"nested": "object"},
                    "cycle_time_p90": 200.0,
                    "authors_count": 2,
                    "reviewers_count": 1,
                }
            },
        )
        _write_rollup(rollups_dir, rollup)

        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / "generate-demo-insights.py"),
                "--output-root",
                str(data_dir),
            ],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )
        assert result.returncode != 0
        assert "cycle_time_p50" in result.stderr
        assert "expected numeric or null" in result.stderr
