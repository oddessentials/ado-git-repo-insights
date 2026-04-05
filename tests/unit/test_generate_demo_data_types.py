"""Construction tests for TypedDict substitutions in generate-demo-data.py.

Verifies that inline dict constructions match the SliceMetrics,
ReviewerSliceMetrics, and CommentsCoverage TypedDicts exactly —
no missing or extra keys.  Added as part of #243 (QG-40 scripts/
Any elimination) to guard against structural drift.

The ProducerSchemaConsistency class (added in #217, 052-review-time-pipeline)
guards against schema widening that doesn't update all producers atomically.
"""

from __future__ import annotations

from dataclasses import fields as dc_fields
from pathlib import Path
from types import ModuleType

from ado_git_repo_insights.transform.aggregators import WeeklyRollup
from ado_git_repo_insights.types import (
    CommentsCoverage,
    ReviewerSliceMetrics,
    SliceMetrics,
)

SLICE_METRICS_KEYS = frozenset(SliceMetrics.__annotations__)
REVIEWER_SLICE_METRICS_KEYS = frozenset(ReviewerSliceMetrics.__annotations__)
COMMENTS_COVERAGE_KEYS = frozenset(CommentsCoverage.__annotations__)


class TestSliceMetricsConstruction:
    """Verify dicts matching SliceMetrics have exactly the right keys."""

    def test_keys_are_complete(self) -> None:
        expected = {
            "pr_count",
            "cycle_time_p50",
            "cycle_time_p90",
            "review_time_p50",
            "review_time_p90",
            "authors_count",
            "reviewers_count",
        }
        assert SLICE_METRICS_KEYS == expected

    def test_inline_construction(self) -> None:
        entry: SliceMetrics = {
            "pr_count": 10,
            "cycle_time_p50": 120.5,
            "cycle_time_p90": 480.0,
            "review_time_p50": 60.25,
            "review_time_p90": 240.0,
            "authors_count": 3,
            "reviewers_count": 2,
        }
        assert set(entry) == SLICE_METRICS_KEYS

    def test_nullable_cycle_times(self) -> None:
        entry: SliceMetrics = {
            "pr_count": 2,
            "cycle_time_p50": None,
            "cycle_time_p90": None,
            "review_time_p50": None,
            "review_time_p90": None,
            "authors_count": 1,
            "reviewers_count": 1,
        }
        assert entry["cycle_time_p50"] is None
        assert entry["cycle_time_p90"] is None
        assert entry["review_time_p50"] is None
        assert entry["review_time_p90"] is None


class TestReviewerSliceMetricsConstruction:
    """Verify dicts matching ReviewerSliceMetrics have exactly the right keys."""

    def test_keys_are_complete(self) -> None:
        expected = {
            "reviewed_prs",
            "reviews_count",
            "approval_rate",
            "authors_count",
            "repositories_count",
        }
        assert REVIEWER_SLICE_METRICS_KEYS == expected

    def test_inline_construction(self) -> None:
        entry: ReviewerSliceMetrics = {
            "reviewed_prs": 15,
            "reviews_count": 20,
            "approval_rate": 0.85,
            "authors_count": 5,
            "repositories_count": 3,
        }
        assert set(entry) == REVIEWER_SLICE_METRICS_KEYS


class TestCommentsCoverageConstruction:
    """Verify dicts matching CommentsCoverage have exactly the right keys."""

    def test_keys_are_complete(self) -> None:
        expected = {
            "status",
            "threads_fetched",
            "comments_fetched",
            "prs_with_threads",
            "capped",
        }
        assert COMMENTS_COVERAGE_KEYS == expected

    def test_inline_construction(self) -> None:
        entry: CommentsCoverage = {
            "status": "partial",
            "capped": True,
            "threads_fetched": 100,
            "comments_fetched": 300,
            "prs_with_threads": 50,
        }
        assert set(entry) == COMMENTS_COVERAGE_KEYS


class TestProducerSchemaConsistency:
    """Guard against schema widening without updating all producers.

    If a field is added to WeeklyRollup or SliceMetrics, every producer
    (aggregators.py, generate-demo-data.py, generate-synthetic-dataset.py)
    must emit that field. This test catches drift by comparing the canonical
    TypedDict/dataclass fields against a hardcoded expected set that must be
    updated explicitly whenever the schema widens.
    """

    def test_weekly_rollup_fields_match_expected(self) -> None:
        """WeeklyRollup dataclass fields must match the declared contract."""
        actual = {f.name for f in dc_fields(WeeklyRollup)}
        expected = {
            "week",
            "start_date",
            "end_date",
            "pr_count",
            "cycle_time_p50",
            "cycle_time_p90",
            "review_time_p50",
            "review_time_p90",
            "authors_count",
            "reviewers_count",
        }
        assert actual == expected, (
            f"WeeklyRollup fields changed. Update all producers and this test. "
            f"Added: {actual - expected}, Removed: {expected - actual}"
        )

    def test_slice_metrics_fields_match_expected(self) -> None:
        """SliceMetrics TypedDict fields must match the declared contract."""
        actual = frozenset(SliceMetrics.__annotations__)
        expected = {
            "pr_count",
            "cycle_time_p50",
            "cycle_time_p90",
            "review_time_p50",
            "review_time_p90",
            "authors_count",
            "reviewers_count",
        }
        assert actual == expected, (
            f"SliceMetrics fields changed. Update all producers and this test. "
            f"Added: {actual - expected}, Removed: {expected - actual}"
        )


def _load_demo_module() -> ModuleType:
    """Import the demo generator script as a module."""
    import importlib.util
    import sys

    script_path = (
        Path(__file__).resolve().parent.parent.parent
        / "scripts"
        / "generate-demo-data.py"
    )
    spec = importlib.util.spec_from_file_location("generate_demo_data", script_path)
    assert spec is not None
    assert spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    # Register before exec so dataclass introspection can resolve the module.
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


class TestDemoGeneratorInProcessDeterminism:
    """Calling the demo generator twice in the same process must produce
    byte-identical output.

    Regression: _REVIEW_TIME_RNG was a module-global mutable RNG seeded only
    at import time.  The second in-process call consumed RNG state left over
    from the first run, producing different review_time values.
    """

    def test_main_in_process_determinism(self, tmp_path: Path) -> None:
        """Two in-process main() calls must produce byte-identical output."""
        import hashlib

        mod = _load_demo_module()

        def _run_and_hash(output_dir: Path) -> dict[str, str]:
            mod.main(["--output-root", str(output_dir)])
            hashes: dict[str, str] = {}
            for p in sorted(output_dir.rglob("*.json")):
                hashes[str(p.relative_to(output_dir))] = hashlib.sha256(
                    p.read_bytes()
                ).hexdigest()
            return hashes

        hashes_a = _run_and_hash(tmp_path / "run_a")
        hashes_b = _run_and_hash(tmp_path / "run_b")

        assert hashes_a == hashes_b, (
            "In-process repeated demo generation produced different output — "
            "check that all RNGs are reset in main()"
        )

    def test_generate_weekly_rollups_in_process_determinism(self) -> None:
        """Two in-process generate_weekly_rollups() calls with identical
        inputs must produce identical review_time values.

        This is the actual entry surface called out in the bug report —
        generate_weekly_rollups reads RNG state directly, not through main().
        """
        from dataclasses import asdict

        mod = _load_demo_module()

        # Reset main RNG to known state (same as main() does).
        mod.RNG = mod.init_random(mod.SEED)
        repos = mod.generate_repositories(mod.generate_projects())
        teams = mod.generate_teams(mod.generate_projects())
        users = mod.generate_users()

        # Call 1
        mod.RNG = mod.init_random(mod.SEED)
        rollups_a = mod.generate_weekly_rollups(repos, teams, users)

        # Call 2 — same inputs, same main RNG state
        mod.RNG = mod.init_random(mod.SEED)
        rollups_b = mod.generate_weekly_rollups(repos, teams, users)

        assert len(rollups_a) == len(rollups_b)
        for i, (a, b) in enumerate(zip(rollups_a, rollups_b, strict=True)):
            a_dict = asdict(a)
            b_dict = asdict(b)
            assert a_dict == b_dict, (
                f"Week {i} ({a.week}) differs between calls — "
                f"review_time_p50: {a.review_time_p50} vs {b.review_time_p50}, "
                f"review_time_p90: {a.review_time_p90} vs {b.review_time_p90}"
            )
