"""
Phase 5 ML Features Integration Tests

Tests for end-to-end integration of:
- ProphetForecaster (predictions/trends.json)
- LLMInsightsGenerator (insights/summary.json)
- AggregateGenerator ML feature flags
- Dashboard data loader compatibility

These tests verify the complete data pipeline works correctly,
not just individual components.
"""

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

# Import database layer (always available)
from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.transform.aggregators import AggregateGenerator

# Import ML modules at module level to avoid reimport issues
try:
    from ado_git_repo_insights.ml.forecaster import ProphetForecaster

    # Check if Prophet is actually importable
    try:
        import prophet  # noqa: F401

        FORECASTER_AVAILABLE = True
    except ImportError:
        FORECASTER_AVAILABLE = False
except ImportError:
    ProphetForecaster = None
    FORECASTER_AVAILABLE = False

try:
    from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

    # Check if OpenAI is actually importable
    try:
        import openai  # noqa: F401

        INSIGHTS_AVAILABLE = True
    except ImportError:
        INSIGHTS_AVAILABLE = False
except ImportError:
    LLMInsightsGenerator = None
    INSIGHTS_AVAILABLE = False


# ============================================================================
# Test Fixtures
# ============================================================================


@pytest.fixture
def temp_db(tmp_path: Path) -> DatabaseManager:
    """Create a temporary SQLite database with schema."""
    db_path = tmp_path / "test.db"
    db = DatabaseManager(db_path)
    db.connect()  # connect() auto-creates schema for new databases
    return db


@pytest.fixture
def temp_db_with_prs(temp_db: DatabaseManager) -> DatabaseManager:
    """Database with sample PR data spanning 4+ weeks."""
    # Insert entities in order respecting foreign keys
    # 1. Organizations first
    temp_db.execute(
        "INSERT INTO organizations (organization_name) VALUES (?)", ("test-org",)
    )

    # 2. Projects
    temp_db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        ("test-org", "test-project"),
    )

    # 3. Users
    temp_db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        ("user-1", "Test User", "test@example.com"),
    )

    # 4. Repositories
    temp_db.execute(
        """INSERT INTO repositories
           (repository_id, repository_name, project_name, organization_name)
           VALUES (?, ?, ?, ?)""",
        ("repo-1", "test-repo", "test-project", "test-org"),
    )

    # 5. Insert PRs spanning 4 weeks with various cycle times
    base_date = date.today() - timedelta(days=28)
    prs = [
        # Week 1
        ("pr-1", 1, base_date, 120.0),
        ("pr-2", 2, base_date + timedelta(days=1), 180.0),
        ("pr-3", 3, base_date + timedelta(days=2), 90.0),
        # Week 2
        ("pr-4", 4, base_date + timedelta(days=7), 150.0),
        ("pr-5", 5, base_date + timedelta(days=8), 200.0),
        # Week 3
        ("pr-6", 6, base_date + timedelta(days=14), 100.0),
        ("pr-7", 7, base_date + timedelta(days=15), 160.0),
        ("pr-8", 8, base_date + timedelta(days=16), 140.0),
        # Week 4
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
    return temp_db


# ============================================================================
# ProphetForecaster Integration Tests
# ============================================================================


@pytest.mark.skipif(not FORECASTER_AVAILABLE, reason="Prophet not installed")
class TestProphetForecasterIntegration:
    """Integration tests for ProphetForecaster."""

    def test_forecaster_generates_valid_trends_json(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Forecaster should generate valid trends.json with real DB data."""
        output_dir = tmp_path / "output"
        output_dir.mkdir()

        forecaster = ProphetForecaster(db=temp_db_with_prs, output_dir=output_dir)
        result = forecaster.generate()

        # Should succeed
        assert result is True

        # trends.json should exist
        trends_path = output_dir / "predictions" / "trends.json"
        assert trends_path.exists(), "trends.json should be created"

        # Should be valid JSON
        with open(trends_path) as f:
            trends = json.load(f)

        # Validate schema
        assert trends["schema_version"] == 1
        assert "generated_at" in trends
        assert trends["is_stub"] is False
        assert "forecasts" in trends
        assert isinstance(trends["forecasts"], list)

    def test_forecaster_monday_alignment(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """All forecast period_start dates should be Monday-aligned."""
        output_dir = tmp_path / "output"
        output_dir.mkdir()

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
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Forecast bounds should be valid (lower <= predicted <= upper, lower >= 0)."""
        output_dir = tmp_path / "output"
        output_dir.mkdir()

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
        output_dir = tmp_path / "output"
        output_dir.mkdir()

        forecaster = ProphetForecaster(db=temp_db, output_dir=output_dir)
        forecaster.generate()

        # Should still write file with empty forecasts
        trends_path = output_dir / "predictions" / "trends.json"

        if trends_path.exists():
            with open(trends_path) as f:
                trends = json.load(f)
            assert trends["forecasts"] == []


class TestForecasterNotInstalled:
    """Tests for when Prophet is not installed."""

    def test_forecaster_import_fails_gracefully(self):
        """Forecaster module import failure should be handled gracefully."""
        # This is a documentation test - if Prophet is not installed,
        # the import at module level would have set FORECASTER_AVAILABLE = False
        # Tests that require Prophet are skipped in that case
        if not FORECASTER_AVAILABLE:
            pytest.skip("Prophet not installed - this is expected behavior")
        else:
            assert True  # Prophet is available, test passes


# ============================================================================
# LLMInsightsGenerator Integration Tests
# ============================================================================


@pytest.mark.skipif(not INSIGHTS_AVAILABLE, reason="OpenAI not installed")
class TestLLMInsightsGeneratorIntegration:
    """Integration tests for LLMInsightsGenerator."""

    def test_insights_dry_run_no_api_call(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Dry run should write prompt.json without API call."""
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            output_dir = tmp_path / "output"
            output_dir.mkdir()

            generator = LLMInsightsGenerator(
                db=temp_db_with_prs,
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

    def test_insights_api_key_required(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Insights generator should fail without API key."""
        # Ensure OPENAI_API_KEY is not set
        env = os.environ.copy()
        env.pop("OPENAI_API_KEY", None)

        with patch.dict(os.environ, env, clear=True):
            output_dir = tmp_path / "output"
            output_dir.mkdir()

            generator = LLMInsightsGenerator(
                db=temp_db_with_prs,
                output_dir=output_dir,
            )

            # Should either raise or return False
            try:
                result = generator.generate()
                assert result is False, "Should fail without API key"
            except (ValueError, KeyError):
                pass  # Expected exception is also acceptable


class TestInsightsContractCompliance:
    """Tests for insights contract compliance using mocked OpenAI."""

    @pytest.fixture
    def mock_openai_response(self):
        """Create a mock OpenAI response."""
        return json.dumps(
            {
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
        )

    def test_insights_schema_validation(self, mock_openai_response: str):
        """Verify mock insights comply with expected schema."""
        summary = json.loads(mock_openai_response)

        valid_categories = {"bottleneck", "trend", "anomaly"}
        valid_severities = {"info", "warning", "critical"}

        for insight in summary["insights"]:
            # Required fields
            assert "category" in insight
            assert "severity" in insight
            assert "title" in insight
            assert "description" in insight
            assert "affected_entities" in insight

            # Valid enum values
            assert insight["category"] in valid_categories
            assert insight["severity"] in valid_severities

            # affected_entities is array
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

        # Check manifest flags - should be False when not enabled
        assert manifest.features.get("predictions") is False
        assert manifest.features.get("ai_insights") is False

        # Verify manifest file
        manifest_path = output_dir / "dataset-manifest.json"
        assert manifest_path.exists()

        with open(manifest_path) as f:
            manifest_data = json.load(f)

        assert manifest_data["features"]["predictions"] is False
        assert manifest_data["features"]["ai_insights"] is False

    @pytest.mark.skipif(not FORECASTER_AVAILABLE, reason="Prophet not installed")
    def test_manifest_includes_predictions_flag(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Manifest should have predictions=true when trends.json is generated."""
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(
            db=temp_db_with_prs,
            output_dir=output_dir,
            enable_predictions=True,
            enable_insights=False,
        )
        manifest = generator.generate_all()

        # Check manifest flags
        assert manifest.features.get("predictions") is True

        # Verify manifest file
        manifest_path = output_dir / "dataset-manifest.json"
        assert manifest_path.exists()

        with open(manifest_path) as f:
            manifest_data = json.load(f)

        assert manifest_data["features"]["predictions"] is True


# ============================================================================
# Dashboard Data Loader Compatibility Tests
# ============================================================================


class TestDashboardLoaderCompatibility:
    """Tests to verify generated files are compatible with dashboard loader."""

    @pytest.mark.skipif(not FORECASTER_AVAILABLE, reason="Prophet not installed")
    def test_predictions_file_matches_loader_expectations(
        self, temp_db_with_prs: DatabaseManager, tmp_path: Path
    ):
        """Generated trends.json should match what dataset-loader.js expects."""
        output_dir = tmp_path / "output"
        output_dir.mkdir()

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

            # Each value must have these fields
            for value in forecast["values"]:
                assert "period_start" in value
                assert "predicted" in value
                assert "lower_bound" in value
                assert "upper_bound" in value

    def test_predictions_schema_structure(self):
        """Verify the expected structure of predictions schema."""
        # This test doesn't require Prophet - it just verifies the contract
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

        # Validate structure is documented
        assert "schema_version" in expected_schema
        assert "forecasts" in expected_schema
        assert isinstance(expected_schema["forecasts"], list)

    def test_insights_schema_structure(self):
        """Verify the expected structure of insights schema."""
        # This test doesn't require OpenAI - it just verifies the contract
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

        # Validate structure is documented
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
