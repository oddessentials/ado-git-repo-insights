"""
T052-T054: Schema validation and data coverage tests for demo synthetic data.

Tests verify:
- All JSON files pass schema validation
- Date range covers 260 weeks (2021-W01 to 2025-W52)
- Entity counts match spec (3 orgs, 8 projects, 20+ repos, 200 users)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# Paths relative to repository root
REPO_ROOT = Path(__file__).parent.parent.parent
DOCS_DATA = REPO_ROOT / "docs" / "data"
SCHEMAS_DIR = REPO_ROOT / "schemas"


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def manifest() -> dict:
    """Load dataset manifest."""
    manifest_path = DOCS_DATA / "dataset-manifest.json"
    with open(manifest_path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def dimensions() -> dict:
    """Load dimensions file."""
    dimensions_path = DOCS_DATA / "aggregates" / "dimensions.json"
    with open(dimensions_path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def predictions() -> dict:
    """Load predictions file."""
    predictions_path = DOCS_DATA / "predictions" / "trends.json"
    with open(predictions_path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def insights() -> dict:
    """Load insights file."""
    insights_path = DOCS_DATA / "insights" / "summary.json"
    with open(insights_path, encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# T052: Schema Validation Tests
# =============================================================================


class TestSchemaValidation:
    """T052: Validate all JSON files against schemas."""

    def test_manifest_has_required_fields(self, manifest: dict) -> None:
        """Manifest has all required top-level fields."""
        required = [
            "dataset_schema_version",
            "manifest_schema_version",
            "aggregates_schema_version",
            "predictions_schema_version",
            "insights_schema_version",
            "run_id",
            "generated_at",
            "features",
            "coverage",
            "aggregate_index",
        ]
        for field in required:
            assert field in manifest, f"Missing required field: {field}"

    def test_manifest_features_structure(self, manifest: dict) -> None:
        """Manifest features have expected structure."""
        features = manifest["features"]
        assert isinstance(features.get("teams"), bool)
        assert isinstance(features.get("comments"), bool)
        assert isinstance(features.get("predictions"), bool)
        assert isinstance(features.get("ai_insights"), bool)

    def test_manifest_aggregate_index(self, manifest: dict) -> None:
        """Manifest aggregate_index has weekly_rollups and distributions."""
        agg_index = manifest["aggregate_index"]
        assert "weekly_rollups" in agg_index
        assert "distributions" in agg_index
        assert len(agg_index["weekly_rollups"]) == 260
        assert len(agg_index["distributions"]) == 5

    def test_dimensions_has_required_fields(self, dimensions: dict) -> None:
        """Dimensions file has projects, repositories, users, and date_range."""
        # Note: organizations are derived from projects, not stored separately
        required = ["projects", "repositories", "users", "date_range"]
        for field in required:
            assert field in dimensions, f"Missing required field: {field}"

    def test_weekly_rollup_schema(self) -> None:
        """Sample weekly rollup files have required fields."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        sample_files = ["2021-W01.json", "2023-W26.json", "2025-W52.json"]

        for filename in sample_files:
            rollup_path = rollups_dir / filename
            assert rollup_path.exists(), f"Missing rollup: {filename}"

            with open(rollup_path, encoding="utf-8") as f:
                rollup = json.load(f)

            required = [
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
                "by_repository",
            ]
            for field in required:
                assert field in rollup, f"Missing {field} in {filename}"

            # by_team should be present (teams enabled in demo data)
            assert "by_team" in rollup, f"Missing by_team in {filename}"
            assert isinstance(rollup["by_team"], dict), (
                f"by_team not a dict in {filename}"
            )
            assert len(rollup["by_team"]) == 4, (
                f"Expected 4 teams in by_team in {filename}"
            )

    def test_distribution_schema(self) -> None:
        """Distribution files have required fields."""
        dist_dir = DOCS_DATA / "aggregates" / "distributions"

        for year in range(2021, 2026):
            dist_path = dist_dir / f"{year}.json"
            assert dist_path.exists(), f"Missing distribution: {year}.json"

            with open(dist_path, encoding="utf-8") as f:
                dist = json.load(f)

            required = [
                "year",
                "start_date",
                "end_date",
                "total_prs",
                "cycle_time_buckets",
                "prs_by_month",
            ]
            for field in required:
                assert field in dist, f"Missing {field} in {year}.json"

    def test_predictions_schema(self, predictions: dict) -> None:
        """Predictions file has required structure."""
        required = ["schema_version", "generated_at", "forecasts"]
        for field in required:
            assert field in predictions, f"Missing required field: {field}"

        assert len(predictions["forecasts"]) == 3  # 3 metrics

        for forecast in predictions["forecasts"]:
            assert "metric" in forecast
            assert "unit" in forecast
            assert "values" in forecast
            assert len(forecast["values"]) == 12  # 12-week horizon

    def test_insights_schema(self, insights: dict) -> None:
        """Insights file has required structure."""
        required = ["schema_version", "generated_at", "insights"]
        for field in required:
            assert field in insights, f"Missing required field: {field}"

        assert len(insights["insights"]) >= 5  # T049 requires 5+ insights

        for insight in insights["insights"]:
            assert "id" in insight
            assert "category" in insight
            assert "severity" in insight
            assert "title" in insight
            assert "description" in insight
            assert "affected_entities" in insight


# =============================================================================
# T053: Date Range Coverage Tests
# =============================================================================


class TestDateRangeCoverage:
    """T053: Verify 260 weeks from 2021-W01 to 2025-W52."""

    def test_weekly_rollup_count(self) -> None:
        """Exactly 260 weekly rollup files exist."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        rollup_files = list(rollups_dir.glob("*.json"))
        assert len(rollup_files) == 260, (
            f"Expected 260 rollups, got {len(rollup_files)}"
        )

    def test_week_range_coverage(self) -> None:
        """All 260 weeks from 2021-W01 to 2025-W52 are present."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"

        expected_weeks = []
        for year in range(2021, 2026):
            for week in range(1, 53):
                expected_weeks.append(f"{year}-W{week:02d}")

        actual_weeks = sorted(p.stem for p in rollups_dir.glob("*.json"))

        assert len(actual_weeks) == 260
        assert actual_weeks == expected_weeks

    def test_first_week_is_2021_w01(self, manifest: dict) -> None:
        """First week in manifest is 2021-W01."""
        first_rollup = manifest["aggregate_index"]["weekly_rollups"][0]
        assert first_rollup["week"] == "2021-W01"

    def test_last_week_is_2025_w52(self, manifest: dict) -> None:
        """Last week in manifest is 2025-W52."""
        last_rollup = manifest["aggregate_index"]["weekly_rollups"][-1]
        assert last_rollup["week"] == "2025-W52"

    def test_distribution_years(self) -> None:
        """Distribution files exist for 2021-2025."""
        dist_dir = DOCS_DATA / "aggregates" / "distributions"
        for year in range(2021, 2026):
            dist_path = dist_dir / f"{year}.json"
            assert dist_path.exists(), f"Missing distribution for {year}"


# =============================================================================
# T054: Entity Count Verification Tests
# =============================================================================


class TestEntityCounts:
    """T054: Verify entity counts match spec requirements."""

    def test_organization_count(self, dimensions: dict) -> None:
        """Exactly 3 organizations exist (derived from projects)."""
        # Organizations are derived from projects, not stored separately
        org_names = {proj["organization_name"] for proj in dimensions["projects"]}
        assert len(org_names) == 3, f"Expected 3 orgs, got {len(org_names)}"

    def test_project_count(self, dimensions: dict) -> None:
        """Exactly 8 projects exist."""
        projects = dimensions["projects"]
        assert len(projects) == 8, f"Expected 8 projects, got {len(projects)}"

    def test_repository_count(self, dimensions: dict) -> None:
        """At least 20 repositories exist."""
        repos = dimensions["repositories"]
        assert len(repos) >= 20, f"Expected >=20 repos, got {len(repos)}"

    def test_user_count(self, dimensions: dict) -> None:
        """Exactly 200 users exist."""
        users = dimensions["users"]
        assert len(users) == 200, f"Expected 200 users, got {len(users)}"

    def test_organization_names(self, dimensions: dict) -> None:
        """Organizations have expected names (derived from projects)."""
        org_names = {proj["organization_name"] for proj in dimensions["projects"]}
        expected = {"acme-corp", "contoso-dev", "fabrikam-eng"}
        assert org_names == expected

    def test_projects_distributed_across_orgs(self, dimensions: dict) -> None:
        """Projects are distributed across all 3 organizations."""
        orgs_with_projects = {
            proj["organization_name"] for proj in dimensions["projects"]
        }
        assert len(orgs_with_projects) == 3


# =============================================================================
# Additional Data Quality Tests
# =============================================================================


class TestDataQuality:
    """Additional quality checks for synthetic data."""

    def test_pr_counts_have_variation(self, manifest: dict) -> None:
        """PR counts show realistic variation (not constant)."""
        pr_counts = [
            r["pr_count"] for r in manifest["aggregate_index"]["weekly_rollups"]
        ]

        min_pr = min(pr_counts)
        max_pr = max(pr_counts)
        range_pct = (max_pr - min_pr) / ((max_pr + min_pr) / 2)

        # Expect at least 30% variation
        assert range_pct >= 0.3, f"PR counts lack variation: range={range_pct:.1%}"

    def test_predictions_have_confidence_intervals(self, predictions: dict) -> None:
        """All forecast values have lower_bound <= predicted <= upper_bound with non-zero width."""
        for forecast in predictions["forecasts"]:
            for value in forecast["values"]:
                assert value["lower_bound"] <= value["predicted"], (
                    f"lower_bound ({value['lower_bound']}) > predicted ({value['predicted']})"
                )
                assert value["predicted"] <= value["upper_bound"], (
                    f"predicted ({value['predicted']}) > upper_bound ({value['upper_bound']})"
                )
                assert value["upper_bound"] > value["lower_bound"], (
                    f"Zero-width confidence interval at {value.get('period_start', '?')}"
                )

    def test_insights_cover_multiple_categories(self, insights: dict) -> None:
        """Insights span multiple categories."""
        categories = {i["category"] for i in insights["insights"]}
        assert len(categories) >= 2, f"Only {len(categories)} category found"

    def test_insights_cover_multiple_severities(self, insights: dict) -> None:
        """Insights span multiple severity levels."""
        severities = {i["severity"] for i in insights["insights"]}
        assert len(severities) >= 2, f"Only {len(severities)} severity found"


class TestReviewTimePresence:
    """Gate: committed demo rollups must contain representative non-null review_time values.

    Prevents closing T049/T050 on schema-only parity — the demo must actually
    exercise the review time rendering path with non-null data.
    """

    def test_root_review_time_not_all_null(self) -> None:
        """At least some root-level review_time_p50 values must be non-null."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        nonnull_p50 = 0
        nonnull_p90 = 0
        total = 0
        for path in sorted(rollups_dir.glob("*.json")):
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            total += 1
            if rollup.get("review_time_p50") is not None:
                nonnull_p50 += 1
            if rollup.get("review_time_p90") is not None:
                nonnull_p90 += 1
        assert total >= 260, f"Expected 260 rollups, found {total}"
        assert nonnull_p50 > 0, (
            "All 260 root review_time_p50 values are null — demo cards won't render"
        )
        assert nonnull_p90 > 0, (
            "All 260 root review_time_p90 values are null — demo cards won't render"
        )

    def test_breakdown_review_time_not_all_null(self) -> None:
        """At least some breakdown entries must have non-null review_time values."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        nonnull_breakdown = 0
        for path in sorted(rollups_dir.glob("*.json")):
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            for dim in ("by_repository", "by_team", "by_author"):
                for entry in rollup.get(dim, {}).values():
                    if (
                        entry.get("review_time_p50") is not None
                        or entry.get("review_time_p90") is not None
                    ):
                        nonnull_breakdown += 1
        assert nonnull_breakdown > 0, (
            "All breakdown review_time values are null — filtered cards won't render"
        )

    def test_per_percentile_null_independence(self) -> None:
        """P50 and P90 must have different null/non-null patterns (FR-010)."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        p50_null_weeks: set[str] = set()
        p90_null_weeks: set[str] = set()
        for path in sorted(rollups_dir.glob("*.json")):
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            week = rollup["week"]
            if rollup.get("review_time_p50") is None:
                p50_null_weeks.add(week)
            if rollup.get("review_time_p90") is None:
                p90_null_weeks.add(week)
        assert p50_null_weeks != p90_null_weeks, (
            "P50 and P90 have identical null patterns — "
            "per-percentile independence is not exercised"
        )

    def test_review_time_ratio_to_cycle_time(self) -> None:
        """T043: Non-null review_time is typically 30-70% of cycle_time."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        ratios: list[float] = []
        for path in sorted(rollups_dir.glob("*.json")):
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            ct = rollup.get("cycle_time_p50")
            rt = rollup.get("review_time_p50")
            if ct is not None and rt is not None and ct > 0:
                ratios.append(rt / ct)
        assert len(ratios) > 0, "No rollups with both cycle_time and review_time"
        avg_ratio = sum(ratios) / len(ratios)
        assert 0.25 <= avg_ratio <= 0.75, (
            f"Average review_time/cycle_time ratio {avg_ratio:.2f} outside 0.25-0.75"
        )

    def test_breakdown_entries_include_review_time(self) -> None:
        """T045: Breakdown entries in by_repository/by_author/by_team have review_time fields."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        sample_files = ["2021-W26.json", "2023-W26.json", "2025-W26.json"]
        for filename in sample_files:
            path = rollups_dir / filename
            if not path.exists():
                continue
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            for dim in ("by_repository", "by_team", "by_author"):
                entries = rollup.get(dim, {})
                for name, entry in entries.items():
                    assert "review_time_p50" in entry, (
                        f"{dim}[{name}] missing review_time_p50 in {filename}"
                    )
                    assert "review_time_p90" in entry, (
                        f"{dim}[{name}] missing review_time_p90 in {filename}"
                    )

    def test_review_time_p50_le_p90(self) -> None:
        """Statistical coherence: review_time_p50 <= review_time_p90 everywhere."""
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        violations = 0
        checked = 0
        for path in sorted(rollups_dir.glob("*.json")):
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            p50 = rollup.get("review_time_p50")
            p90 = rollup.get("review_time_p90")
            if p50 is not None and p90 is not None:
                checked += 1
                if p50 > p90:
                    violations += 1
            for dim in ("by_repository", "by_team", "by_author"):
                for entry in rollup.get(dim, {}).values():
                    ep50 = entry.get("review_time_p50")
                    ep90 = entry.get("review_time_p90")
                    if ep50 is not None and ep90 is not None:
                        checked += 1
                        if ep50 > ep90:
                            violations += 1
        assert checked > 0, "No p50/p90 pairs to check"
        assert violations == 0, (
            f"{violations} of {checked} pairs have review_time_p50 > review_time_p90"
        )

    def test_author_review_time_fields_present(self) -> None:
        """Author-level entries must include review_time_p50/p90 fields.

        Values may be null (sparse author data below threshold is expected),
        but the FIELDS must be present for schema parity.
        """
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        sample_files = ["2021-W26.json", "2023-W26.json", "2025-W26.json"]
        for filename in sample_files:
            path = rollups_dir / filename
            if not path.exists():
                continue
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            for aid, entry in rollup.get("by_author", {}).items():
                assert "review_time_p50" in entry, (
                    f"by_author[{aid}] missing review_time_p50 in {filename}"
                )
                assert "review_time_p90" in entry, (
                    f"by_author[{aid}] missing review_time_p90 in {filename}"
                )

    def test_single_dim_review_time_uses_2pr_threshold(self) -> None:
        """Single-dimension slices with 2-4 PRs must emit review_time.

        Regression: demo used pr_count < 5 threshold for review_time,
        but production uses _ROLLUP_MIN_SAMPLE=2 for single-dimension
        slices. Slices with 2-4 reviewed PRs were incorrectly null.
        """
        rollups_dir = DOCS_DATA / "aggregates" / "weekly_rollups"
        suppressed_2_to_4 = 0
        eligible_2_to_4 = 0
        for path in sorted(rollups_dir.glob("*.json")):
            with open(path, encoding="utf-8") as f:
                rollup = json.load(f)
            for dim in ("by_repository", "by_team"):
                for entry in rollup.get(dim, {}).values():
                    pr_count = entry.get("pr_count", 0)
                    if 2 <= pr_count <= 4:
                        eligible_2_to_4 += 1
                        rt_p50 = entry.get("review_time_p50")
                        if rt_p50 is None:
                            suppressed_2_to_4 += 1
        # With 2-4 PRs, review_time should be non-null (unless the
        # review_time generation itself happened to null via the
        # independent null injection). Allow some nulls from injection
        # but not ALL — that would indicate the threshold is wrong.
        if eligible_2_to_4 > 0:
            suppressed_pct = suppressed_2_to_4 / eligible_2_to_4
            assert suppressed_pct < 0.5, (
                f"{suppressed_2_to_4}/{eligible_2_to_4} "
                f"({suppressed_pct:.0%}) single-dim slices with 2-4 PRs "
                f"have null review_time — threshold likely too high"
            )
