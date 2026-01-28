"""Contract tests for Prophet forecaster output (Phase 5).

These tests validate the EXACT JSON output schema against the Phase 5 contract.
They are a HARD RELEASE GATE - any failures block merge.

Tests use sys.modules patching to inject fake Prophet module, avoiding [ml] extras
in base CI while ensuring tests work regardless of whether prophet is installed.
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, Mock, patch

import pandas as pd
import pytest


class TestForecasterContract:
    """Schema contract validation for predictions/trends.json."""

    @pytest.fixture
    def mock_db(self) -> Mock:
        """Mock database with sample PR data spanning multiple weeks."""
        db = Mock()
        db.connection = Mock()

        # Mock SQL query result - data spanning 3+ weeks to meet forecaster requirements
        df_data = {
            "closed_date": [
                "2026-01-06",  # Week 1
                "2026-01-07",
                "2026-01-08",
                "2026-01-13",  # Week 2
                "2026-01-14",
                "2026-01-15",
                "2026-01-20",  # Week 3
                "2026-01-21",
            ],
            "cycle_time_minutes": [
                120.0,
                180.0,
                90.0,
                150.0,
                200.0,
                100.0,
                130.0,
                170.0,
            ],
        }

        with patch("pandas.read_sql_query", return_value=pd.DataFrame(df_data)):
            yield db

    @pytest.fixture
    def mock_prophet_class(self) -> MagicMock:
        """Mock Prophet class with deterministic predictions."""
        mock_model_instance = MagicMock()

        # Mock forecast result
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

        # Return a class that when instantiated returns the mock instance
        mock_class = MagicMock(return_value=mock_model_instance)
        return mock_class

    @pytest.fixture
    def fake_prophet_module(self, mock_prophet_class: MagicMock) -> ModuleType:
        """Create a fake prophet module with mock Prophet class."""
        fake_module = ModuleType("prophet")
        fake_module.Prophet = mock_prophet_class  # type: ignore[attr-defined]
        return fake_module

    def test_predictions_schema_structure(
        self, mock_db: Mock, fake_prophet_module: ModuleType, tmp_path: Path
    ) -> None:
        """Predictions JSON has exact required structure."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=mock_db, output_dir=tmp_path)
            success = forecaster.generate()

        assert success is True

        # Verify file exists
        predictions_file = tmp_path / "predictions" / "trends.json"
        assert predictions_file.exists()

        # Load and validate structure
        with predictions_file.open("r") as f:
            data = json.load(f)

        # Root fields
        assert "schema_version" in data
        assert "generated_at" in data
        assert "is_stub" in data
        assert "generated_by" in data
        assert "forecasts" in data

        # Type validation
        assert isinstance(data["schema_version"], int)
        assert isinstance(data["generated_at"], str)
        assert isinstance(data["is_stub"], bool)
        assert isinstance(data["generated_by"], str)
        assert isinstance(data["forecasts"], list)

    def test_predictions_contract_values(
        self, mock_db: Mock, fake_prophet_module: ModuleType, tmp_path: Path
    ) -> None:
        """Predictions JSON has exact contract-compliant values."""
        from ado_git_repo_insights.ml.forecaster import (
            GENERATOR_ID,
            PREDICTIONS_SCHEMA_VERSION,
            ProphetForecaster,
        )

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=mock_db, output_dir=tmp_path)
            forecaster.generate()

        predictions_file = tmp_path / "predictions" / "trends.json"
        with predictions_file.open("r") as f:
            data = json.load(f)

        # Contract values
        assert data["schema_version"] == PREDICTIONS_SCHEMA_VERSION
        assert data["schema_version"] == 1  # Locked value
        assert data["is_stub"] is False  # Real ML, not stub
        assert data["generated_by"] == GENERATOR_ID

        # Timestamp format
        datetime.fromisoformat(data["generated_at"])  # Should not raise

    def test_forecast_metric_enums(
        self, mock_db: Mock, fake_prophet_module: ModuleType, tmp_path: Path
    ) -> None:
        """Forecast metrics match exact contract enums."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        # Review time removed in US2 - only 2 metrics now
        valid_metrics = {"pr_throughput", "cycle_time_minutes"}
        metric_units = {
            "pr_throughput": "count",
            "cycle_time_minutes": "minutes",
        }

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=mock_db, output_dir=tmp_path)
            forecaster.generate()

        predictions_file = tmp_path / "predictions" / "trends.json"
        with predictions_file.open("r") as f:
            data = json.load(f)

        for forecast in data["forecasts"]:
            # Metric enum validation
            assert forecast["metric"] in valid_metrics

            # Unit matches metric
            assert forecast["unit"] == metric_units[forecast["metric"]]

            # Required fields
            assert "horizon_weeks" in forecast
            assert "values" in forecast

    def test_period_start_monday_aligned(
        self, mock_db: Mock, fake_prophet_module: ModuleType, tmp_path: Path
    ) -> None:
        """All period_start dates are Monday-aligned."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=mock_db, output_dir=tmp_path)
            forecaster.generate()

        predictions_file = tmp_path / "predictions" / "trends.json"
        with predictions_file.open("r") as f:
            data = json.load(f)

        for forecast in data["forecasts"]:
            for value in forecast["values"]:
                period_start = date.fromisoformat(value["period_start"])
                assert period_start.weekday() == 0, f"{period_start} is not a Monday"

    def test_forecast_value_fields(
        self, mock_db: Mock, fake_prophet_module: ModuleType, tmp_path: Path
    ) -> None:
        """Forecast values have required bounds fields."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        with patch.dict(sys.modules, {"prophet": fake_prophet_module}):
            forecaster = ProphetForecaster(db=mock_db, output_dir=tmp_path)
            forecaster.generate()

        predictions_file = tmp_path / "predictions" / "trends.json"
        with predictions_file.open("r") as f:
            data = json.load(f)

        for forecast in data["forecasts"]:
            for value in forecast["values"]:
                # Required fields
                assert "period_start" in value
                assert "predicted" in value
                assert "lower_bound" in value
                assert "upper_bound" in value

                # Type validation
                assert isinstance(value["predicted"], (int, float))
                assert isinstance(value["lower_bound"], (int, float))
                assert isinstance(value["upper_bound"], (int, float))

                # Non-negative bounds
                assert value["lower_bound"] >= 0

    def test_empty_forecasts_valid(self, tmp_path: Path) -> None:
        """Empty forecasts array is valid (no data scenario)."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        # Mock empty database
        mock_db = Mock()
        mock_db.connection = Mock()

        with patch("pandas.read_sql_query", return_value=pd.DataFrame()):
            forecaster = ProphetForecaster(db=mock_db, output_dir=tmp_path)
            success = forecaster.generate()

        assert success is True

        predictions_file = tmp_path / "predictions" / "trends.json"
        with predictions_file.open("r") as f:
            data = json.load(f)

        # Empty forecasts allowed
        assert data["forecasts"] == []
        assert data["is_stub"] is False

    def test_prophet_import_failure_returns_false(self, tmp_path: Path) -> None:
        """Prophet import failure returns False without writing file."""
        from ado_git_repo_insights.ml.forecaster import ProphetForecaster

        mock_db = Mock()
        mock_db.connection = Mock()

        # Mock non-empty data spanning multiple weeks so we actually try to import prophet
        df_data = {
            "closed_date": [
                "2026-01-06",
                "2026-01-13",
                "2026-01-20",
            ],
            "cycle_time_minutes": [120.0, 180.0, 150.0],
        }

        # Simulate prophet not installed by setting it to None in sys.modules
        with (
            patch("pandas.read_sql_query", return_value=pd.DataFrame(df_data)),
            patch.dict(sys.modules, {"prophet": None}),
        ):
            forecaster = ProphetForecaster(db=mock_db, output_dir=tmp_path)
            success = forecaster.generate()

        assert success is False

        # File should NOT be written
        predictions_file = tmp_path / "predictions" / "trends.json"
        assert not predictions_file.exists()


class TestProphetMetricsConfiguration:
    """Tests for Prophet METRICS configuration (US2 - Review Time Removal)."""

    def test_metrics_has_only_two_entries(self) -> None:
        """METRICS list should only have pr_throughput and cycle_time_minutes.

        Review time was removed because it used cycle time as a misleading proxy.
        """
        from ado_git_repo_insights.ml.forecaster import METRICS

        assert len(METRICS) == 2, f"Expected 2 metrics, got {len(METRICS)}"

    def test_metrics_does_not_include_review_time(self) -> None:
        """METRICS should not include review_time_minutes."""
        from ado_git_repo_insights.ml.forecaster import METRICS

        metric_names = [m[0] for m in METRICS]
        assert "review_time_minutes" not in metric_names

    def test_metrics_includes_pr_throughput(self) -> None:
        """METRICS should include pr_throughput."""
        from ado_git_repo_insights.ml.forecaster import METRICS

        metric_names = [m[0] for m in METRICS]
        assert "pr_throughput" in metric_names

    def test_metrics_includes_cycle_time(self) -> None:
        """METRICS should include cycle_time_minutes."""
        from ado_git_repo_insights.ml.forecaster import METRICS

        metric_names = [m[0] for m in METRICS]
        assert "cycle_time_minutes" in metric_names
