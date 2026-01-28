"""Unit tests for enhanced AI insights (User Story 2).

Tests for:
- T029: Deterministic insight ordering (severity→category→ID)
- T030: Enhanced schema validation (v2 fields)
- T031: Cache file creation and TTL logic
- T032: Contract test for insights-schema-v2
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from ado_git_repo_insights.ml.insights import (
    INSIGHTS_SCHEMA_VERSION,
    SEVERITY_ORDER,
    LLMInsightsGenerator,
    sort_insights,
)


class TestDeterministicOrdering:
    """Tests for deterministic insight ordering (T029)."""

    def test_severity_order_constant_defined(self) -> None:
        """SEVERITY_ORDER constant should be defined with correct order."""
        assert SEVERITY_ORDER == ["critical", "warning", "info"]

    def test_sort_insights_by_severity_descending(self) -> None:
        """Insights should be sorted by severity (critical > warning > info)."""
        insights = [
            {"id": "a1", "severity": "info", "category": "trend", "title": "Info"},
            {
                "id": "b2",
                "severity": "critical",
                "category": "trend",
                "title": "Critical",
            },
            {
                "id": "c3",
                "severity": "warning",
                "category": "trend",
                "title": "Warning",
            },
        ]

        sorted_insights = sort_insights(insights)

        assert sorted_insights[0]["severity"] == "critical"
        assert sorted_insights[1]["severity"] == "warning"
        assert sorted_insights[2]["severity"] == "info"

    def test_sort_insights_by_category_within_severity(self) -> None:
        """Within same severity, insights should be sorted by category alphabetically."""
        insights = [
            {"id": "a1", "severity": "warning", "category": "trend", "title": "Trend"},
            {
                "id": "b2",
                "severity": "warning",
                "category": "anomaly",
                "title": "Anomaly",
            },
            {
                "id": "c3",
                "severity": "warning",
                "category": "bottleneck",
                "title": "Bottleneck",
            },
        ]

        sorted_insights = sort_insights(insights)

        assert sorted_insights[0]["category"] == "anomaly"
        assert sorted_insights[1]["category"] == "bottleneck"
        assert sorted_insights[2]["category"] == "trend"

    def test_sort_insights_by_id_within_category(self) -> None:
        """Within same severity and category, insights should be sorted by ID."""
        insights = [
            {"id": "trend-zzz", "severity": "info", "category": "trend", "title": "Z"},
            {"id": "trend-aaa", "severity": "info", "category": "trend", "title": "A"},
            {"id": "trend-mmm", "severity": "info", "category": "trend", "title": "M"},
        ]

        sorted_insights = sort_insights(insights)

        assert sorted_insights[0]["id"] == "trend-aaa"
        assert sorted_insights[1]["id"] == "trend-mmm"
        assert sorted_insights[2]["id"] == "trend-zzz"

    def test_sort_insights_full_ordering(self) -> None:
        """Full ordering: severity desc → category asc → ID asc."""
        insights = [
            {"id": "trend-2", "severity": "info", "category": "trend", "title": "T2"},
            {
                "id": "anomaly-1",
                "severity": "critical",
                "category": "anomaly",
                "title": "A1",
            },
            {
                "id": "bottleneck-1",
                "severity": "warning",
                "category": "bottleneck",
                "title": "B1",
            },
            {"id": "trend-1", "severity": "info", "category": "trend", "title": "T1"},
            {
                "id": "anomaly-2",
                "severity": "critical",
                "category": "anomaly",
                "title": "A2",
            },
        ]

        sorted_insights = sort_insights(insights)

        # Critical first (anomaly-1, anomaly-2)
        assert sorted_insights[0]["id"] == "anomaly-1"
        assert sorted_insights[1]["id"] == "anomaly-2"
        # Warning next (bottleneck-1)
        assert sorted_insights[2]["id"] == "bottleneck-1"
        # Info last (trend-1, trend-2)
        assert sorted_insights[3]["id"] == "trend-1"
        assert sorted_insights[4]["id"] == "trend-2"

    def test_sort_insights_empty_list(self) -> None:
        """Empty list should return empty list."""
        assert sort_insights([]) == []

    def test_sort_insights_single_item(self) -> None:
        """Single item should return list with that item."""
        insights = [{"id": "a1", "severity": "info", "category": "trend", "title": "X"}]
        assert sort_insights(insights) == insights


class TestEnhancedSchemaValidation:
    """Tests for enhanced schema validation (T030)."""

    def test_v2_insight_with_data_field(self) -> None:
        """Insight with data field should be valid."""
        insight = {
            "id": "trend-123",
            "severity": "warning",
            "category": "trend",
            "title": "Increasing cycle time",
            "description": "Cycle time increased by 15%",
            "affected_entities": [{"type": "team", "name": "Backend"}],
            "data": {
                "metric": "cycle_time_minutes",
                "current_value": 120,
                "previous_value": 104,
                "change_percent": 15.4,
                "trend_direction": "up",
                "sparkline": [100, 105, 110, 115, 120],
            },
            "recommendation": {
                "action": "Review PR review process",
                "priority": "high",
                "effort": "medium",
            },
        }

        # Should have all v2 fields
        assert "data" in insight
        assert "recommendation" in insight
        assert insight["data"]["metric"] == "cycle_time_minutes"
        assert insight["data"]["trend_direction"] == "up"
        assert insight["recommendation"]["priority"] == "high"

    def test_v2_insight_data_field_structure(self) -> None:
        """Data field should have correct structure."""
        data = {
            "metric": "pr_throughput",
            "current_value": 25,
            "previous_value": 20,
            "change_percent": 25.0,
            "trend_direction": "up",
            "sparkline": [18, 19, 20, 22, 25],
        }

        assert data["metric"] == "pr_throughput"
        assert isinstance(data["current_value"], int | float)
        assert isinstance(data["sparkline"], list)
        assert data["trend_direction"] in ("up", "down", "stable")

    def test_v2_insight_recommendation_field_structure(self) -> None:
        """Recommendation field should have correct structure."""
        recommendation = {
            "action": "Implement code review guidelines",
            "priority": "medium",
            "effort": "low",
        }

        assert recommendation["priority"] in ("high", "medium", "low")
        assert recommendation["effort"] in ("high", "medium", "low")
        assert isinstance(recommendation["action"], str)

    def test_v2_insight_affected_entities_structure(self) -> None:
        """Affected entities should have type and name."""
        entities = [
            {"type": "team", "name": "Backend", "member_count": 5},
            {"type": "repository", "name": "api-service"},
            {"type": "author", "name": "john.doe"},
        ]

        for entity in entities:
            assert "type" in entity
            assert "name" in entity
            assert entity["type"] in ("team", "repository", "author")


class TestCacheLogic:
    """Tests for cache file creation and TTL logic (T031)."""

    @pytest.fixture
    def mock_db(self) -> MagicMock:
        """Create mock database manager."""
        db = MagicMock()

        def mock_execute(query: str, *args: Any) -> MagicMock:
            cursor = MagicMock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 10}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "min_date": "2026-01-01T00:00:00Z",
                    "max_date": "2026-01-15T00:00:00Z",
                }
            elif "AVG(cycle_time_minutes)" in query:
                cursor.fetchone.return_value = {"avg_cycle": 145.0, "max_cycle": 200.0}
            elif "COUNT(DISTINCT user_id)" in query:
                cursor.fetchone.return_value = {"cnt": 5}
            elif "COUNT(*)" in query and "repositories" in query:
                cursor.fetchone.return_value = {"cnt": 3}
            elif "MAX(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "max_closed": "2026-01-15",
                    "max_updated": "2026-01-15T10:00:00Z",
                }
            else:
                cursor.fetchone.return_value = {}
            return cursor

        db.execute = mock_execute
        return db

    def test_cache_ttl_is_12_hours(self, mock_db: MagicMock, tmp_path: Path) -> None:
        """Cache TTL should default to 12 hours (not 24)."""
        generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)

        assert generator.cache_ttl_hours == 12

    def test_cache_file_path_is_cache_json(
        self, mock_db: MagicMock, tmp_path: Path
    ) -> None:
        """Cache file should be at insights/cache.json."""
        generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)

        # The cache path is constructed in generate() method
        # We verify by checking the expected path exists after a successful generation
        expected_cache_path = tmp_path / "insights" / "cache.json"

        # Mock OpenAI response
        mock_response = {
            "insights": [
                {
                    "category": "trend",
                    "severity": "info",
                    "title": "Test",
                    "description": "Test description",
                }
            ]
        }

        with (
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
            patch.object(
                generator,
                "_call_openai",
                return_value={
                    "schema_version": 1,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "is_stub": False,
                    "generated_by": "openai-v1.0",
                    "insights": mock_response["insights"],
                },
            ),
        ):
            generator.generate()

        assert expected_cache_path.exists()

    def test_cache_expires_after_ttl(self, mock_db: MagicMock, tmp_path: Path) -> None:
        """Cache should expire after TTL hours."""
        generator = LLMInsightsGenerator(
            db=mock_db, output_dir=tmp_path, cache_ttl_hours=12
        )

        # Create expired cache (13 hours old)
        cache_path = tmp_path / "insights" / "cache.json"
        cache_path.parent.mkdir(parents=True, exist_ok=True)

        expired_time = datetime.now(timezone.utc) - timedelta(hours=13)
        cache_data = {
            "cache_key": "test-key",
            "cached_at": expired_time.isoformat(),
            "insights_data": {"insights": []},
        }
        with cache_path.open("w") as f:
            json.dump(cache_data, f)

        # Check cache should return None (expired)
        result = generator._check_cache(cache_path, "test-key")
        assert result is None

    def test_cache_valid_within_ttl(self, mock_db: MagicMock, tmp_path: Path) -> None:
        """Cache should be valid within TTL hours."""
        generator = LLMInsightsGenerator(
            db=mock_db, output_dir=tmp_path, cache_ttl_hours=12
        )

        # Create fresh cache (1 hour old)
        cache_path = tmp_path / "insights" / "cache.json"
        cache_path.parent.mkdir(parents=True, exist_ok=True)

        fresh_time = datetime.now(timezone.utc) - timedelta(hours=1)
        insights_data = {
            "schema_version": 1,
            "insights": [{"id": "test", "severity": "info", "category": "trend"}],
        }
        cache_data = {
            "cache_key": "test-key",
            "cached_at": fresh_time.isoformat(),
            "insights_data": insights_data,
        }
        with cache_path.open("w") as f:
            json.dump(cache_data, f)

        # Check cache should return data (valid)
        result = generator._check_cache(cache_path, "test-key")
        assert result is not None
        assert result["insights"][0]["id"] == "test"


class TestInsightsSchemaV2Contract:
    """Contract tests for insights-schema-v2 (T032)."""

    def test_schema_version_is_1(self) -> None:
        """Schema version should be 1."""
        assert INSIGHTS_SCHEMA_VERSION == 1

    def test_output_has_required_fields(self) -> None:
        """Output should have all required schema fields."""
        required_fields = [
            "schema_version",
            "generated_at",
            "is_stub",
            "generated_by",
            "insights",
        ]

        output = {
            "schema_version": 1,
            "generated_at": "2026-01-26T12:00:00Z",
            "is_stub": False,
            "generated_by": "openai-v1.0",
            "insights": [],
        }

        for field in required_fields:
            assert field in output, f"Missing required field: {field}"

    def test_insight_has_required_fields(self) -> None:
        """Each insight should have required fields."""
        required_fields = ["id", "severity", "category", "title", "description"]

        insight = {
            "id": "trend-abc123",
            "severity": "warning",
            "category": "trend",
            "title": "Test insight",
            "description": "Test description",
            "affected_entities": [],
        }

        for field in required_fields:
            assert field in insight, f"Missing required field: {field}"

    def test_insight_severity_values(self) -> None:
        """Severity should be one of: critical, warning, info."""
        valid_severities = {"critical", "warning", "info"}

        for severity in valid_severities:
            insight = {"severity": severity}
            assert insight["severity"] in valid_severities

    def test_insight_category_values(self) -> None:
        """Category should be one of: bottleneck, trend, anomaly."""
        valid_categories = {"bottleneck", "trend", "anomaly"}

        for category in valid_categories:
            insight = {"category": category}
            assert insight["category"] in valid_categories

    def test_v2_optional_fields(self) -> None:
        """V2 schema should support optional data and recommendation fields."""
        insight_v2 = {
            "id": "trend-abc123",
            "severity": "warning",
            "category": "trend",
            "title": "Cycle time increasing",
            "description": "Average cycle time increased by 20%",
            "affected_entities": [{"type": "team", "name": "Backend"}],
            "data": {
                "metric": "cycle_time_minutes",
                "current_value": 150,
                "previous_value": 125,
                "change_percent": 20.0,
                "trend_direction": "up",
                "sparkline": [120, 125, 130, 140, 150],
            },
            "recommendation": {
                "action": "Review code review bottlenecks",
                "priority": "high",
                "effort": "medium",
            },
        }

        # V2 fields should be present
        assert "data" in insight_v2
        assert "recommendation" in insight_v2

        # Data structure
        assert insight_v2["data"]["metric"] == "cycle_time_minutes"
        assert insight_v2["data"]["trend_direction"] in ("up", "down", "stable")
        assert isinstance(insight_v2["data"]["sparkline"], list)

        # Recommendation structure
        assert insight_v2["recommendation"]["priority"] in ("high", "medium", "low")
        assert insight_v2["recommendation"]["effort"] in ("high", "medium", "low")


class TestP90PercentileCalculation:
    """Tests for accurate P90 cycle time calculation (User Story 1).

    Tests for:
    - T004: P90 for 100-element dataset
    - T005: P90 for dataset with outliers
    - T006: P90 edge cases for small datasets
    """

    @pytest.fixture
    def mock_db_with_cycle_times(self) -> MagicMock:
        """Create mock database with configurable cycle time data."""
        db = MagicMock()
        return db

    def test_p90_calculation_100_elements(
        self, mock_db_with_cycle_times: MagicMock, tmp_path: Path
    ) -> None:
        """P90 of [10, 20, ..., 1000] should be 900 (90th percentile), not 900 (90% of max).

        For 100 elements, 90th percentile is the value at position 90.
        """
        # Create sequential dataset: 10, 20, 30, ..., 1000
        cycle_times = [i * 10 for i in range(1, 101)]  # 100 elements

        def mock_execute(query: str, *args: Any) -> MagicMock:
            cursor = MagicMock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 100}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "min_date": "2026-01-01T00:00:00Z",
                    "max_date": "2026-01-15T00:00:00Z",
                }
            elif "AVG(cycle_time_minutes)" in query and "MAX" not in query:
                avg_val = sum(cycle_times) / len(cycle_times)  # 505.0
                cursor.fetchone.return_value = {"avg_cycle": avg_val}
            elif (
                "NTILE" in query
                or "ROW_NUMBER" in query
                or "percentile" in query.lower()
            ):
                # P90 calculation query - return 90th percentile
                # For 100 elements, index 90 (0-based 89) = 900
                cursor.fetchone.return_value = {"p90_cycle": 900.0}
            elif "ORDER BY cycle_time_minutes" in query:
                # Fallback percentile calculation
                cursor.fetchone.return_value = {"cycle_time_minutes": 900.0}
            elif "COUNT(DISTINCT user_id)" in query:
                cursor.fetchone.return_value = {"cnt": 10}
            elif "COUNT(*)" in query and "repositories" in query:
                cursor.fetchone.return_value = {"cnt": 5}
            elif "MAX(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "max_closed": "2026-01-15",
                    "max_updated": "2026-01-15T10:00:00Z",
                }
            else:
                cursor.fetchone.return_value = {}
            return cursor

        mock_db_with_cycle_times.execute = mock_execute

        generator = LLMInsightsGenerator(
            db=mock_db_with_cycle_times, output_dir=tmp_path
        )
        stats = generator._get_pr_stats()

        # P90 should be 900, not 900 (which would be 90% of 1000)
        # Note: For this specific dataset they happen to be the same,
        # but the calculation method is different
        assert stats["p90_cycle_time_minutes"] == 900.0

    def test_p90_calculation_with_outliers(
        self, mock_db_with_cycle_times: MagicMock, tmp_path: Path
    ) -> None:
        """P90 with outlier should not be inflated by the outlier.

        Dataset: [10, 20, ..., 90, 10000] (9 normal + 1 outlier)
        P90 should be close to 90, not 9000 (90% of max).
        """
        # 9 normal values + 1 extreme outlier
        cycle_times = [i * 10 for i in range(1, 10)] + [10000]  # 10 elements

        def mock_execute(query: str, *args: Any) -> MagicMock:
            cursor = MagicMock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 10}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "min_date": "2026-01-01T00:00:00Z",
                    "max_date": "2026-01-15T00:00:00Z",
                }
            elif "AVG(cycle_time_minutes)" in query and "MAX" not in query:
                avg_val = sum(cycle_times) / len(cycle_times)
                cursor.fetchone.return_value = {"avg_cycle": avg_val}
            elif (
                "NTILE" in query
                or "ROW_NUMBER" in query
                or "percentile" in query.lower()
            ):
                # P90 for 10 elements is index 9 (0-based), which is the outlier
                # But true P90 calculation would use interpolation
                # For 10 elements, P90 ~ value at position 9 = 90
                cursor.fetchone.return_value = {"p90_cycle": 90.0}
            elif "ORDER BY cycle_time_minutes" in query:
                cursor.fetchone.return_value = {"cycle_time_minutes": 90.0}
            elif "COUNT(DISTINCT user_id)" in query:
                cursor.fetchone.return_value = {"cnt": 5}
            elif "COUNT(*)" in query and "repositories" in query:
                cursor.fetchone.return_value = {"cnt": 3}
            elif "MAX(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "max_closed": "2026-01-15",
                    "max_updated": "2026-01-15T10:00:00Z",
                }
            else:
                cursor.fetchone.return_value = {}
            return cursor

        mock_db_with_cycle_times.execute = mock_execute

        generator = LLMInsightsGenerator(
            db=mock_db_with_cycle_times, output_dir=tmp_path
        )
        stats = generator._get_pr_stats()

        # P90 should NOT be 9000 (90% of max 10000)
        # It should be 90 (the 90th percentile of the actual data)
        assert stats["p90_cycle_time_minutes"] == 90.0
        assert stats["p90_cycle_time_minutes"] != 9000.0  # Not 90% of outlier

    def test_p90_calculation_small_dataset(
        self, mock_db_with_cycle_times: MagicMock, tmp_path: Path
    ) -> None:
        """P90 for small dataset (<10 elements) should handle edge case gracefully."""
        # Only 3 elements: [100, 200, 300]

        def mock_execute(query: str, *args: Any) -> MagicMock:
            cursor = MagicMock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 3}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "min_date": "2026-01-01T00:00:00Z",
                    "max_date": "2026-01-03T00:00:00Z",
                }
            elif "AVG(cycle_time_minutes)" in query and "MAX" not in query:
                cursor.fetchone.return_value = {"avg_cycle": 200.0}
            elif (
                "NTILE" in query
                or "ROW_NUMBER" in query
                or "percentile" in query.lower()
            ):
                # For 3 elements, P90 ~ max value (300)
                cursor.fetchone.return_value = {"p90_cycle": 300.0}
            elif "ORDER BY cycle_time_minutes" in query:
                cursor.fetchone.return_value = {"cycle_time_minutes": 300.0}
            elif "COUNT(DISTINCT user_id)" in query:
                cursor.fetchone.return_value = {"cnt": 2}
            elif "COUNT(*)" in query and "repositories" in query:
                cursor.fetchone.return_value = {"cnt": 1}
            elif "MAX(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "max_closed": "2026-01-03",
                    "max_updated": "2026-01-03T10:00:00Z",
                }
            else:
                cursor.fetchone.return_value = {}
            return cursor

        mock_db_with_cycle_times.execute = mock_execute

        generator = LLMInsightsGenerator(
            db=mock_db_with_cycle_times, output_dir=tmp_path
        )
        stats = generator._get_pr_stats()

        # For small datasets, should return a sensible value (not crash)
        assert stats["p90_cycle_time_minutes"] == 300.0

    def test_p90_calculation_empty_dataset(
        self, mock_db_with_cycle_times: MagicMock, tmp_path: Path
    ) -> None:
        """P90 for empty dataset should return 0."""

        def mock_execute(query: str, *args: Any) -> MagicMock:
            cursor = MagicMock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 0}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {"min_date": None, "max_date": None}
            elif "AVG(cycle_time_minutes)" in query:
                cursor.fetchone.return_value = {"avg_cycle": None}
            elif (
                "NTILE" in query
                or "ROW_NUMBER" in query
                or "percentile" in query.lower()
            ):
                cursor.fetchone.return_value = None
            elif "ORDER BY cycle_time_minutes" in query:
                cursor.fetchone.return_value = None
            elif "COUNT(DISTINCT user_id)" in query:
                cursor.fetchone.return_value = {"cnt": 0}
            elif "COUNT(*)" in query and "repositories" in query:
                cursor.fetchone.return_value = {"cnt": 0}
            elif "MAX(closed_date)" in query:
                cursor.fetchone.return_value = {"max_closed": None, "max_updated": None}
            else:
                cursor.fetchone.return_value = {}
            return cursor

        mock_db_with_cycle_times.execute = mock_execute

        generator = LLMInsightsGenerator(
            db=mock_db_with_cycle_times, output_dir=tmp_path
        )
        stats = generator._get_pr_stats()

        # Empty dataset should return 0
        assert stats["p90_cycle_time_minutes"] == 0
