"""Construction tests for TypedDict substitutions in generate-demo-data.py.

Verifies that inline dict constructions match the SliceMetrics,
ReviewerSliceMetrics, and CommentsCoverage TypedDicts exactly —
no missing or extra keys.  Added as part of #243 (QG-40 scripts/
Any elimination) to guard against structural drift.
"""

from __future__ import annotations

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
            "authors_count",
            "reviewers_count",
        }
        assert SLICE_METRICS_KEYS == expected

    def test_inline_construction(self) -> None:
        entry: SliceMetrics = {
            "pr_count": 10,
            "cycle_time_p50": 120.5,
            "cycle_time_p90": 480.0,
            "authors_count": 3,
            "reviewers_count": 2,
        }
        assert set(entry) == SLICE_METRICS_KEYS

    def test_nullable_cycle_times(self) -> None:
        entry: SliceMetrics = {
            "pr_count": 2,
            "cycle_time_p50": None,
            "cycle_time_p90": None,
            "authors_count": 1,
            "reviewers_count": 1,
        }
        assert entry["cycle_time_p50"] is None
        assert entry["cycle_time_p90"] is None


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
