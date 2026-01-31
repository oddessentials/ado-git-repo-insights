"""
T052-T054: Schema validation and data coverage tests for demo synthetic data.

Tests verify:
- All JSON files pass schema validation
- Date range covers 260 weeks (2021-W01 to 2025-W52)
- Entity counts match spec (3 orgs, 8 projects, 20+ repos, 50 users)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

# Paths relative to repository root
REPO_ROOT = Path(__file__).parent.parent.parent
DOCS_DATA = REPO_ROOT / "docs" / "data"
SCHEMAS_DIR = REPO_ROOT / "schemas"


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def manifest() -> dict[str, Any]:
    """Load dataset manifest."""
    manifest_path = DOCS_DATA / "dataset-manifest.json"
    with open(manifest_path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def dimensions() -> dict[str, Any]:
    """Load dimensions file."""
    dimensions_path = DOCS_DATA / "aggregates" / "dimensions.json"
    with open(dimensions_path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def predictions() -> dict[str, Any]:
    """Load predictions file."""
    predictions_path = DOCS_DATA / "predictions" / "trends.json"
    with open(predictions_path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def insights() -> dict[str, Any]:
    """Load insights file."""
    insights_path = DOCS_DATA / "insights" / "summary.json"
    with open(insights_path, encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# T052: Schema Validation Tests
# =============================================================================


class TestSchemaValidation:
    """T052: Validate all JSON files against schemas."""

    def test_manifest_has_required_fields(self, manifest: dict[str, Any]) -> None:
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

    def test_manifest_features_structure(self, manifest: dict[str, Any]) -> None:
        """Manifest features have expected structure."""
        features = manifest["features"]
        assert isinstance(features.get("teams"), bool)
        assert isinstance(features.get("comments"), bool)
        assert isinstance(features.get("predictions"), bool)
        assert isinstance(features.get("ai_insights"), bool)

    def test_manifest_aggregate_index(self, manifest: dict[str, Any]) -> None:
        """Manifest aggregate_index has weekly_rollups and distributions."""
        agg_index = manifest["aggregate_index"]
        assert "weekly_rollups" in agg_index
        assert "distributions" in agg_index
        assert len(agg_index["weekly_rollups"]) == 260
        assert len(agg_index["distributions"]) == 5

    def test_dimensions_has_required_fields(self, dimensions: dict[str, Any]) -> None:
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
                "authors_count",
                "reviewers_count",
                "by_repository",
            ]
            for field in required:
                assert field in rollup, f"Missing {field} in {filename}"

            # by_team should NOT be present (omitted when teams disabled)
            assert "by_team" not in rollup, f"by_team should be omitted in {filename}"

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

    def test_predictions_schema(self, predictions: dict[str, Any]) -> None:
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

    def test_insights_schema(self, insights: dict[str, Any]) -> None:
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

    def test_first_week_is_2021_w01(self, manifest: dict[str, Any]) -> None:
        """First week in manifest is 2021-W01."""
        first_rollup = manifest["aggregate_index"]["weekly_rollups"][0]
        assert first_rollup["week"] == "2021-W01"

    def test_last_week_is_2025_w52(self, manifest: dict[str, Any]) -> None:
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

    def test_organization_count(self, dimensions: dict[str, Any]) -> None:
        """Exactly 3 organizations exist (derived from projects)."""
        # Organizations are derived from projects, not stored separately
        org_names = {proj["organization_name"] for proj in dimensions["projects"]}
        assert len(org_names) == 3, f"Expected 3 orgs, got {len(org_names)}"

    def test_project_count(self, dimensions: dict[str, Any]) -> None:
        """Exactly 8 projects exist."""
        projects = dimensions["projects"]
        assert len(projects) == 8, f"Expected 8 projects, got {len(projects)}"

    def test_repository_count(self, dimensions: dict[str, Any]) -> None:
        """At least 20 repositories exist."""
        repos = dimensions["repositories"]
        assert len(repos) >= 20, f"Expected >=20 repos, got {len(repos)}"

    def test_user_count(self, dimensions: dict[str, Any]) -> None:
        """Exactly 50 users exist."""
        users = dimensions["users"]
        assert len(users) == 50, f"Expected 50 users, got {len(users)}"

    def test_organization_names(self, dimensions: dict[str, Any]) -> None:
        """Organizations have expected names (derived from projects)."""
        org_names = {proj["organization_name"] for proj in dimensions["projects"]}
        expected = {"acme-corp", "contoso-dev", "fabrikam-eng"}
        assert org_names == expected

    def test_projects_distributed_across_orgs(self, dimensions: dict[str, Any]) -> None:
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

    def test_pr_counts_have_variation(self, manifest: dict[str, Any]) -> None:
        """PR counts show realistic variation (not constant)."""
        pr_counts = [
            r["pr_count"] for r in manifest["aggregate_index"]["weekly_rollups"]
        ]

        min_pr = min(pr_counts)
        max_pr = max(pr_counts)
        range_pct = (max_pr - min_pr) / ((max_pr + min_pr) / 2)

        # Expect at least 30% variation
        assert range_pct >= 0.3, f"PR counts lack variation: range={range_pct:.1%}"

    def test_predictions_have_confidence_intervals(
        self, predictions: dict[str, Any]
    ) -> None:
        """All forecast values have lower_bound < predicted < upper_bound."""
        for forecast in predictions["forecasts"]:
            for value in forecast["values"]:
                assert value["lower_bound"] < value["predicted"]
                assert value["predicted"] < value["upper_bound"]

    def test_insights_cover_multiple_categories(self, insights: dict[str, Any]) -> None:
        """Insights span multiple categories."""
        categories = {i["category"] for i in insights["insights"]}
        assert len(categories) >= 2, f"Only {len(categories)} category found"

    def test_insights_cover_multiple_severities(self, insights: dict[str, Any]) -> None:
        """Insights span multiple severity levels."""
        severities = {i["severity"] for i in insights["insights"]}
        assert len(severities) >= 2, f"Only {len(severities)} severity found"
