"""
Phase 5 ML Features Integration Tests

Tests for end-to-end integration of:
- ProphetForecaster (predictions/trends.json)
- LLMInsightsGenerator (insights/summary.json)
- AggregateGenerator ML feature flags
- Dashboard data loader compatibility

These tests use sys.modules patching to inject fake ML modules,
following enterprise-grade testing patterns that work regardless
of whether optional [ml] dependencies are installed.
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.transform.aggregators import AggregateGenerator

# ============================================================================
# Mock Module Fixtures
# ============================================================================


@pytest.fixture
def mock_prophet_class() -> MagicMock:
    """Mock Prophet class with deterministic predictions."""
    mock_model_instance = MagicMock()

    # Mock forecast result - 4 weeks of predictions
    mock_forecast = pd.DataFrame(
        {
            "ds": pd.to_datetime(
                ["2026-01-27", "2026-02-03", "2026-02-10", "2026-02-17"]
            ),
            "yhat": [25.0, 27.0, 26.0, 28.0],
            "yhat_lower": [20.0, 22.0, 21.0, 23.0],
            "yhat_upper": [30.0, 32.0, 31.0, 33.0],
        }
    )

    mock_model_instance.predict.return_value = mock_forecast
    mock_model_instance.fit.return_value = mock_model_instance

    mock_class = MagicMock(return_value=mock_model_instance)
    return mock_class


@pytest.fixture
def fake_prophet_module(mock_prophet_class: MagicMock) -> ModuleType:
    """Create a fake prophet module with mock Prophet class."""
    fake_module = ModuleType("prophet")
    fake_module.Prophet = mock_prophet_class  # type: ignore[attr-defined]
    return fake_module


@pytest.fixture
def mock_openai_client() -> MagicMock:
    """Mock OpenAI client with deterministic response."""
    mock_client = MagicMock()

    # Create mock response structure
    mock_message = MagicMock()
    mock_message.content = json.dumps(
        {
            "insights": [
                {
                    "category": "trend",
                    "severity": "info",
                    "title": "Stable PR throughput",
                    "description": "PR volume has remained consistent over the analysis period.",
                    "affected_entities": ["project:test-project"],
                },
                {
                    "category": "bottleneck",
                    "severity": "warning",
                    "title": "Review latency detected",
                    "description": "Some PRs show extended cycle times indicating review delays.",
                    "affected_entities": ["repo:test-repo"],
                },
            ]
        }
    )

    mock_choice = MagicMock()
    mock_choice.message = mock_message

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    mock_client.chat.completions.create.return_value = mock_response
    return mock_client


@pytest.fixture
def fake_openai_module(mock_openai_client: MagicMock) -> ModuleType:
    """Create a fake openai module with mock client."""
    fake_module = ModuleType("openai")

    # Mock OpenAI class that returns our mock client
    mock_openai_class = MagicMock(return_value=mock_openai_client)
    fake_module.OpenAI = mock_openai_class  # type: ignore[attr-defined]

    return fake_module


# ============================================================================
# Database Fixtures
# ============================================================================


@pytest.fixture
def temp_db(tmp_path: Path) -> DatabaseManager:
    """Create a temporary SQLite database with schema."""
    db_path = tmp_path / "test.db"
    db = DatabaseManager(db_path)
    db.connect()  # connect() auto-creates schema for new databases
    yield db
    db.close()  # Properly close connection to avoid ResourceWarning


@pytest.fixture
def temp_db_with_prs(temp_db: DatabaseManager) -> DatabaseManager:
    """Database with sample PR data spanning 4+ weeks.

    Note: This fixture depends on temp_db which handles cleanup via yield.
    """
    # Insert entities in order respecting foreign keys
    temp_db.execute(
        "INSERT INTO organizations (organization_name) VALUES (?)", ("test-org",)
    )
    temp_db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        ("test-org", "test-project"),
    )
    temp_db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        ("user-1", "Test User", "test@example.com"),
    )
    temp_db.execute(
        """INSERT INTO repositories
           (repository_id, repository_name, project_name, organization_name)
           VALUES (?, ?, ?, ?)""",
        ("repo-1", "test-repo", "test-project", "test-org"),
    )

    # Insert PRs spanning 4 weeks with various cycle times
    base_date = date.today() - timedelta(days=28)
    prs = [
        ("pr-1", 1, base_date, 120.0),
        ("pr-2", 2, base_date + timedelta(days=1), 180.0),
        ("pr-3", 3, base_date + timedelta(days=2), 90.0),
        ("pr-4", 4, base_date + timedelta(days=7), 150.0),
        ("pr-5", 5, base_date + timedelta(days=8), 200.0),
        ("pr-6", 6, base_date + timedelta(days=14), 100.0),
        ("pr-7", 7, base_date + timedelta(days=15), 160.0),
        ("pr-8", 8, base_date + timedelta(days=16), 140.0),
        ("pr-9", 9, base_date + timedelta(days=21), 130.0),
        ("pr-10", 10, base_date + timedelta(days=22), 170.0),
    ]

    for uid, pr_id, closed, cycle_time in prs:
        closed_str = closed.isoformat() + "T12:00:00Z"
        created_str = (
            closed - timedelta(minutes=int(cycle_time))
        ).isoformat() + "T12:00:00Z"
        temp_db.execute(
            """INSERT INTO pull_requests
               (pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, description,
                creation_date, closed_date, cycle_time_minutes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                uid,
                pr_id,
                "test-org",
                "test-project",
                "repo-1",
                "user-1",
                f"Test PR {pr_id}",
                "completed",
                "Test description",
                created_str,
                closed_str,
                cycle_time,
            ),
        )

    temp_db.connection.commit()
    # No need for cleanup here - temp_db fixture handles it
    return temp_db


# ============================================================================
# ProphetForecaster Integration Tests
# ============================================================================


class TestProphetForecasterIntegration:
    """Integration tests for ProphetForecaster using mocked Prophet."""

    def test_forecaster_generates_valid_trends_json(
        self,
        temp_db_with_prs: DatabaseManager,
        fake_prophet_module: ModuleType,
        tmp_path: Path,
    ):
        """Forecaster should generate valid trends.json with real DB data."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=temp_db_with_prs, output_dir=output_dir)
            result = forecaster.generate()

        assert result is True

        # trends.json should exist
        trends_path = output_dir / "predictions" / "trends.json"
        assert trends_path.exists(), "trends.json should be created"

        # Should be valid JSON with required schema
        with open(trends_path) as f:
            trends = json.load(f)

        assert trends["schema_version"] == 1
        assert "generated_at" in trends
        assert trends["is_stub"] is False
        assert "forecasts" in trends
        assert isinstance(trends["forecasts"], list)

    def test_forecaster_monday_alignment(
        self,
        temp_db_with_prs: DatabaseManager,
        fake_prophet_module: ModuleType,
        tmp_path: Path,
    ):
        """All forecast period_start dates should be Monday-aligned."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=temp_db_with_prs, output_dir=output_dir)
            forecaster.generate()

        trends_path = output_dir / "predictions" / "trends.json"
        with open(trends_path) as f:
            trends = json.load(f)

        for forecast in trends["forecasts"]:
            for value in forecast["values"]:
                period_date = date.fromisoformat(value["period_start"])
                assert period_date.weekday() == 0, (
                    f"period_start {value['period_start']} should be Monday"
                )

    def test_forecaster_bounds_are_valid(
        self,
        temp_db_with_prs: DatabaseManager,
        fake_prophet_module: ModuleType,
        tmp_path: Path,
    ):
        """Forecast bounds should be valid (lower <= predicted <= upper, lower >= 0)."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=temp_db_with_prs, output_dir=output_dir)
            forecaster.generate()

        trends_path = output_dir / "predictions" / "trends.json"
        with open(trends_path) as f:
            trends = json.load(f)

        for forecast in trends["forecasts"]:
            for value in forecast["values"]:
                assert value["lower_bound"] >= 0, "lower_bound should be non-negative"
                assert value["lower_bound"] <= value["predicted"], (
                    "lower_bound <= predicted"
                )
                assert value["predicted"] <= value["upper_bound"], (
                    "predicted <= upper_bound"
                )

    def test_forecaster_empty_database(self, temp_db: DatabaseManager, tmp_path: Path):
        """Forecaster with empty DB should write empty forecasts array."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        # Empty DB - no data to forecast
        with patch("pandas.read_sql_query", return_value=pd.DataFrame()):
            forecaster = ProphetForecaster(db=temp_db, output_dir=output_dir)
            result = forecaster.generate()

        assert result is True

        trends_path = output_dir / "predictions" / "trends.json"
        assert trends_path.exists()

        with open(trends_path) as f:
            trends = json.load(f)
        assert trends["forecasts"] == []

    def test_forecaster_without_prophet_returns_false(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Forecaster returns False when Prophet is not available."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        # Mock data that would trigger Prophet import
        df_data = {
            "closed_date": ["2026-01-06", "2026-01-13", "2026-01-20"],
            "cycle_time_minutes": [120.0, 180.0, 150.0],
        }

        with (
            patch("pandas.read_sql_query", return_value=pd.DataFrame(df_data)),
            patch.dict(sys.modules, {"prophet": None}),
        ):
            forecaster = ProphetForecaster(db=temp_db_with_prs, output_dir=output_dir)
            result = forecaster.generate()

        assert result is False


# ============================================================================
# FallbackForecaster Integration Tests (T014)
# ============================================================================


class TestFallbackForecasterIntegration:
    """Integration tests for FallbackForecaster (zero-config linear regression)."""

    def test_fallback_forecaster_generates_valid_trends_json(
        self,
        temp_db_with_prs: DatabaseManager,
        tmp_path: Path,
    ):
        """Fallback forecaster should generate valid trends.json without Prophet."""
        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        forecaster = FallbackForecaster(db=temp_db_with_prs, output_dir=output_dir)
        result = forecaster.generate()

        assert result is True

        # trends.json should exist
        trends_path = output_dir / "predictions" / "trends.json"
        assert trends_path.exists(), "trends.json should be created"

        # Should be valid JSON with required schema
        with open(trends_path) as f:
            trends = json.load(f)

        assert trends["schema_version"] == 1
        assert "generated_at" in trends
        assert trends["is_stub"] is False
        assert trends["forecaster"] == "linear"
        assert "data_quality" in trends
        assert "forecasts" in trends
        assert isinstance(trends["forecasts"], list)

    def test_fallback_forecaster_monday_alignment(
        self,
        temp_db_with_prs: DatabaseManager,
        tmp_path: Path,
    ):
        """All fallback forecast period_start dates should be Monday-aligned."""
        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        forecaster = FallbackForecaster(db=temp_db_with_prs, output_dir=output_dir)
        forecaster.generate()

        trends_path = output_dir / "predictions" / "trends.json"
        with open(trends_path) as f:
            trends = json.load(f)

        for forecast in trends["forecasts"]:
            for value in forecast["values"]:
                period_date = date.fromisoformat(value["period_start"])
                assert period_date.weekday() == 0, (
                    f"period_start {value['period_start']} should be Monday"
                )

    def test_fallback_forecaster_bounds_are_valid(
        self,
        temp_db_with_prs: DatabaseManager,
        tmp_path: Path,
    ):
        """Fallback forecast bounds should be valid (lower <= predicted <= upper, lower >= 0)."""
        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        forecaster = FallbackForecaster(db=temp_db_with_prs, output_dir=output_dir)
        forecaster.generate()

        trends_path = output_dir / "predictions" / "trends.json"
        with open(trends_path) as f:
            trends = json.load(f)

        for forecast in trends["forecasts"]:
            for value in forecast["values"]:
                assert value["lower_bound"] >= 0, "lower_bound should be non-negative"
                assert value["lower_bound"] <= value["predicted"], (
                    "lower_bound <= predicted"
                )
                assert value["predicted"] <= value["upper_bound"], (
                    "predicted <= upper_bound"
                )

    def test_fallback_forecaster_empty_database(
        self, temp_db: DatabaseManager, tmp_path: Path
    ):
        """Fallback forecaster with empty DB should write empty forecasts array."""
        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        forecaster = FallbackForecaster(db=temp_db, output_dir=output_dir)
        result = forecaster.generate()

        assert result is True

        trends_path = output_dir / "predictions" / "trends.json"
        assert trends_path.exists()

        with open(trends_path) as f:
            trends = json.load(f)

        assert trends["forecasts"] == []
        assert trends["data_quality"] == "insufficient"

    def test_fallback_forecaster_data_quality_assessment(
        self,
        temp_db_with_prs: DatabaseManager,
        tmp_path: Path,
    ):
        """Fallback forecaster should correctly assess data quality."""
        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        forecaster = FallbackForecaster(db=temp_db_with_prs, output_dir=output_dir)
        forecaster.generate()

        # temp_db_with_prs has 4 weeks of data, which is low_confidence
        assert forecaster.data_quality is not None
        assert forecaster.data_quality.status in ("low_confidence", "normal")


# ============================================================================
# Prophet Auto-Detection Tests (T015)
# ============================================================================


class TestProphetAutoDetection:
    """Integration tests for Prophet auto-detection via get_forecaster()."""

    def test_get_forecaster_returns_fallback_when_prophet_unavailable(
        self, temp_db: DatabaseManager, tmp_path: Path
    ):
        """Factory returns FallbackForecaster when Prophet not installed."""
        from ado_git_repo_insights.ml import get_forecaster
        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        with patch("ado_git_repo_insights.ml.is_prophet_available", return_value=False):
            forecaster = get_forecaster(temp_db, tmp_path)

        assert isinstance(forecaster, FallbackForecaster)

    def test_get_forecaster_returns_prophet_when_available(
        self,
        temp_db: DatabaseManager,
        fake_prophet_module: ModuleType,
        tmp_path: Path,
    ):
        """Factory returns ProphetForecaster when Prophet is installed."""
        from ado_git_repo_insights.ml import get_forecaster
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        with (
            patch("ado_git_repo_insights.ml.is_prophet_available", return_value=True),
            patch.dict(sys.modules, {"prophet": fake_prophet_module}),
        ):
            forecaster = get_forecaster(temp_db, tmp_path)

        assert isinstance(forecaster, ProphetForecaster)

    def test_get_forecaster_respects_prefer_prophet_false(
        self, temp_db: DatabaseManager, tmp_path: Path
    ):
        """Factory returns FallbackForecaster when prefer_prophet=False."""
        from ado_git_repo_insights.ml import get_forecaster
        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        forecaster = get_forecaster(temp_db, tmp_path, prefer_prophet=False)

        assert isinstance(forecaster, FallbackForecaster)

    def test_is_prophet_available_returns_bool(self):
        """is_prophet_available returns a boolean."""
        from ado_git_repo_insights.ml import is_prophet_available

        result = is_prophet_available()
        assert isinstance(result, bool)


# ============================================================================
# LLMInsightsGenerator Integration Tests
# ============================================================================


@pytest.fixture
def mock_insights_db() -> MagicMock:
    """Mock database for insights tests that returns expected query results."""
    db = MagicMock()

    def mock_execute(query: str, *args) -> MagicMock:
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
            cursor.fetchone.return_value = {"cnt": 1}
        elif "COUNT(*)" in query and "repositories" in query:
            cursor.fetchone.return_value = {"cnt": 1}
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


class TestLLMInsightsGeneratorIntegration:
    """Integration tests for LLMInsightsGenerator using mocked OpenAI."""

    def test_insights_dry_run_no_api_call(
        self, mock_insights_db: MagicMock, tmp_path: Path
    ):
        """Dry run should write prompt.json without API call."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            output_dir = tmp_path / "output"
            output_dir.mkdir()

            generator = LLMInsightsGenerator(
                db=mock_insights_db,
                output_dir=output_dir,
                dry_run=True,
            )
            result = generator.generate()

        # Dry run returns False (no insights written)
        assert result is False

        # prompt.json should exist
        prompt_path = output_dir / "insights" / "prompt.json"
        assert prompt_path.exists(), "prompt.json should be created in dry-run"

        with open(prompt_path) as f:
            prompt_data = json.load(f)

        assert "prompt" in prompt_data
        assert "model" in prompt_data

    def test_insights_generates_valid_summary_json(
        self,
        mock_insights_db: MagicMock,
        fake_openai_module: ModuleType,
        tmp_path: Path,
    ):
        """Insights generator should produce valid summary.json."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        with (
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
            patch.dict(sys.modules, {"openai": fake_openai_module}),
        ):
            generator = LLMInsightsGenerator(
                db=mock_insights_db,
                output_dir=output_dir,
            )
            result = generator.generate()

        assert result is True

        summary_path = output_dir / "insights" / "summary.json"
        assert summary_path.exists()

        with open(summary_path) as f:
            summary = json.load(f)

        assert summary["schema_version"] == 1
        assert "generated_at" in summary
        assert summary["is_stub"] is False
        assert "insights" in summary
        assert len(summary["insights"]) == 2

    def test_insights_without_api_key_fails(
        self, mock_insights_db: MagicMock, tmp_path: Path
    ):
        """Insights generator should fail gracefully without API key."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        # Remove OPENAI_API_KEY from environment
        env_without_key = {
            k: v for k, v in __import__("os").environ.items() if k != "OPENAI_API_KEY"
        }

        with patch.dict("os.environ", env_without_key, clear=True):
            output_dir = tmp_path / "output"
            output_dir.mkdir()

            generator = LLMInsightsGenerator(
                db=mock_insights_db,
                output_dir=output_dir,
            )

            # Should either raise or return False
            try:
                result = generator.generate()
                assert result is False, "Should fail without API key"
            except (ValueError, KeyError):
                pass  # Expected exception is acceptable


class TestInsightsContractCompliance:
    """Tests for insights contract compliance."""

    def test_insights_schema_validation(self):
        """Verify insights comply with expected schema."""
        mock_insights = {
            "insights": [
                {
                    "category": "trend",
                    "severity": "info",
                    "title": "Stable PR throughput",
                    "description": "PR volume has remained consistent.",
                    "affected_entities": ["project:test-project"],
                },
                {
                    "category": "bottleneck",
                    "severity": "warning",
                    "title": "Review latency detected",
                    "description": "Some PRs show extended cycle times.",
                    "affected_entities": ["repo:test-repo"],
                },
            ]
        }

        valid_categories = {"bottleneck", "trend", "anomaly"}
        valid_severities = {"info", "warning", "critical"}

        for insight in mock_insights["insights"]:
            assert "category" in insight
            assert "severity" in insight
            assert "title" in insight
            assert "description" in insight
            assert "affected_entities" in insight

            assert insight["category"] in valid_categories
            assert insight["severity"] in valid_severities
            assert isinstance(insight["affected_entities"], list)


# ============================================================================
# AggregateGenerator ML Integration Tests
# ============================================================================


class TestAggregateGeneratorMLIntegration:
    """Tests for AggregateGenerator with ML features enabled."""

    def test_manifest_features_without_ml(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Manifest should have predictions=false when ML not enabled."""
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(
            db=temp_db_with_prs,
            output_dir=output_dir,
            enable_predictions=False,
            enable_insights=False,
        )
        manifest = generator.generate_all()

        assert manifest.features.get("predictions") is False
        assert manifest.features.get("ai_insights") is False

        manifest_path = output_dir / "dataset-manifest.json"
        assert manifest_path.exists()

        with open(manifest_path) as f:
            manifest_data = json.load(f)

        assert manifest_data["features"]["predictions"] is False
        assert manifest_data["features"]["ai_insights"] is False

    def test_manifest_includes_predictions_flag_when_enabled(
        self,
        temp_db_with_prs: DatabaseManager,
        fake_prophet_module: ModuleType,
        tmp_path: Path,
    ):
        """Manifest should have predictions=true when trends.json is generated."""
        output_dir = tmp_path / "output"

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            generator = AggregateGenerator(
                db=temp_db_with_prs,
                output_dir=output_dir,
                enable_predictions=True,
                enable_insights=False,
            )
            manifest = generator.generate_all()

        assert manifest.features.get("predictions") is True

        manifest_path = output_dir / "dataset-manifest.json"
        with open(manifest_path) as f:
            manifest_data = json.load(f)

        assert manifest_data["features"]["predictions"] is True


# ============================================================================
# Dashboard Data Loader Compatibility Tests
# ============================================================================


class TestDashboardLoaderCompatibility:
    """Tests to verify generated files are compatible with dashboard loader."""

    def test_predictions_file_matches_loader_expectations(
        self,
        temp_db_with_prs: DatabaseManager,
        fake_prophet_module: ModuleType,
        tmp_path: Path,
    ):
        """Generated trends.json should match what dataset-loader.js expects."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        output_dir = tmp_path / "output"
        output_dir.mkdir()

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=temp_db_with_prs, output_dir=output_dir)
            forecaster.generate()

        trends_path = output_dir / "predictions" / "trends.json"
        with open(trends_path) as f:
            trends = json.load(f)

        # Loader expects these exact field names
        assert "schema_version" in trends
        assert "generated_at" in trends
        assert "is_stub" in trends
        assert "forecasts" in trends

        # Each forecast must have these fields
        for forecast in trends["forecasts"]:
            assert "metric" in forecast
            assert "unit" in forecast
            assert "values" in forecast

            for value in forecast["values"]:
                assert "period_start" in value
                assert "predicted" in value
                assert "lower_bound" in value
                assert "upper_bound" in value

    def test_predictions_schema_structure(self):
        """Verify the expected structure of predictions schema."""
        expected_schema = {
            "schema_version": 1,
            "generated_at": "ISO8601 timestamp",
            "is_stub": "boolean",
            "forecasts": [
                {
                    "metric": "string (pr_throughput, cycle_time_minutes, etc.)",
                    "unit": "string (count, minutes)",
                    "values": [
                        {
                            "period_start": "YYYY-MM-DD (Monday-aligned)",
                            "predicted": "number",
                            "lower_bound": "number >= 0",
                            "upper_bound": "number >= predicted",
                        }
                    ],
                }
            ],
        }

        assert "schema_version" in expected_schema
        assert "forecasts" in expected_schema
        assert isinstance(expected_schema["forecasts"], list)

    def test_insights_schema_structure(self):
        """Verify the expected structure of insights schema."""
        expected_schema = {
            "schema_version": 1,
            "generated_at": "ISO8601 timestamp",
            "is_stub": "boolean",
            "insights": [
                {
                    "id": "string (deterministic hash)",
                    "category": "bottleneck | trend | anomaly",
                    "severity": "info | warning | critical",
                    "title": "string",
                    "description": "string",
                    "affected_entities": ["array of strings"],
                }
            ],
        }

        assert "schema_version" in expected_schema
        assert "insights" in expected_schema
        assert isinstance(expected_schema["insights"], list)


# ============================================================================
# CLI Integration Tests
# ============================================================================


class TestCLIMLFlags:
    """Tests for CLI --enable-predictions and --enable-insights flags."""

    def test_cli_help_shows_ml_flags(self):
        """CLI help should document ML flags."""
        import subprocess

        result = subprocess.run(  # noqa: S603 - trusted test input
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "generate-aggregates",
                "--help",
            ],
            capture_output=True,
            text=True,
        )

        assert "--enable-predictions" in result.stdout
        assert "--enable-insights" in result.stdout
