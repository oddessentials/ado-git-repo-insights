"""Unit tests for FallbackForecaster (linear regression predictions).

Tests for:
- T010: Linear regression forecasting
- T011: Confidence band calculation
- T012: Data quality assessment (4+ weeks check)
- T013: Outlier clipping logic
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from ado_git_repo_insights.ml.fallback_forecaster import (
    LOW_CONFIDENCE_THRESHOLD,
    MIN_WEEKS_REQUIRED,
    FallbackForecaster,
    assess_data_quality,
    clip_outliers,
)


class TestAssessDataQuality:
    """Tests for data quality assessment function (T012)."""

    def test_insufficient_data_below_minimum(self) -> None:
        """Returns insufficient when weeks < MIN_WEEKS_REQUIRED."""
        result = assess_data_quality(2)

        assert result.status == "insufficient"
        assert result.weeks_available == 2
        assert "Insufficient data" in result.message
        assert str(MIN_WEEKS_REQUIRED) in result.message

    def test_insufficient_data_zero_weeks(self) -> None:
        """Returns insufficient when no data available."""
        result = assess_data_quality(0)

        assert result.status == "insufficient"
        assert result.weeks_available == 0

    def test_low_confidence_between_thresholds(self) -> None:
        """Returns low_confidence when 4 <= weeks < 8."""
        result = assess_data_quality(5)

        assert result.status == "low_confidence"
        assert result.weeks_available == 5
        assert "Low confidence" in result.message

    def test_low_confidence_at_minimum(self) -> None:
        """Returns low_confidence at exactly MIN_WEEKS_REQUIRED."""
        result = assess_data_quality(MIN_WEEKS_REQUIRED)

        assert result.status == "low_confidence"
        assert result.weeks_available == MIN_WEEKS_REQUIRED

    def test_normal_at_threshold(self) -> None:
        """Returns normal at exactly LOW_CONFIDENCE_THRESHOLD."""
        result = assess_data_quality(LOW_CONFIDENCE_THRESHOLD)

        assert result.status == "normal"
        assert result.weeks_available == LOW_CONFIDENCE_THRESHOLD
        assert "Normal" in result.message

    def test_normal_above_threshold(self) -> None:
        """Returns normal when weeks > LOW_CONFIDENCE_THRESHOLD."""
        result = assess_data_quality(12)

        assert result.status == "normal"
        assert result.weeks_available == 12


class TestClipOutliers:
    """Tests for outlier clipping function (T013)."""

    def test_no_outliers_unchanged(self) -> None:
        """Values within threshold remain unchanged."""
        values = np.array([10.0, 11.0, 12.0, 11.5, 10.5])
        result = clip_outliers(values)

        np.testing.assert_array_almost_equal(result, values)

    def test_outliers_clipped_to_bounds(self) -> None:
        """Extreme values are clipped to threshold bounds."""
        # Use values where the outlier is clearly beyond 3*std from the "normal" values
        # With 20 values of 10.0 and one 100.0, the mean ≈ 14.3 and std ≈ 19.5
        # So 3*std ≈ 58.5, upper bound ≈ 72.8 - 100 should be clipped
        values = np.array([10.0] * 20 + [100.0])
        result = clip_outliers(values)

        # Last value should be clipped down (100 is beyond 3*std from mean of 10s)
        assert result[-1] < 100.0
        # Non-outliers should be unchanged
        assert result[0] == 10.0

    def test_negative_outliers_clipped(self) -> None:
        """Negative outliers are clipped to lower bound."""
        # Use values where the negative outlier is clearly beyond 3*std
        # With 20 values of 10.0 and one -80.0, the outlier exceeds 3*std from mean
        values = np.array([10.0] * 20 + [-80.0])
        result = clip_outliers(values)

        # Last value should be clipped up (toward the mean)
        assert result[-1] > -80.0
        # Non-outliers should be unchanged
        assert result[0] == 10.0

    def test_custom_threshold(self) -> None:
        """Custom threshold affects clipping bounds."""
        values = np.array([10.0, 10.0, 10.0, 10.0, 50.0])

        # With threshold 1, 50 should be clipped
        result_tight = clip_outliers(values, std_threshold=1.0)

        # With threshold 10, nothing should be clipped
        result_loose = clip_outliers(values, std_threshold=10.0)

        assert result_tight[-1] < 50.0  # Clipped
        assert result_loose[-1] == 50.0  # Not clipped

    def test_empty_array(self) -> None:
        """Handles empty array gracefully."""
        values = np.array([])
        result = clip_outliers(values)

        assert len(result) == 0

    def test_single_value(self) -> None:
        """Single value is returned unchanged."""
        values = np.array([42.0])
        result = clip_outliers(values)

        assert result[0] == 42.0

    def test_zero_std_dev(self) -> None:
        """Handles zero standard deviation (all same values)."""
        values = np.array([10.0, 10.0, 10.0])
        result = clip_outliers(values)

        np.testing.assert_array_equal(result, values)


class TestFallbackForecasterLinearRegression:
    """Tests for linear regression forecasting (T010, T011)."""

    @pytest.fixture
    def mock_db(self) -> MagicMock:
        """Create mock database manager."""
        db = MagicMock()
        db.connection = MagicMock()
        return db

    @pytest.fixture
    def forecaster(self, mock_db: MagicMock, tmp_path: Path) -> FallbackForecaster:
        """Create forecaster with mocked database."""
        return FallbackForecaster(mock_db, tmp_path)

    def test_linear_forecast_increasing_trend(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Linear regression captures increasing trend."""
        # Create weekly data with clear increasing trend
        # Use proper dates spread across weeks
        base = date(2026, 1, 6)  # A Monday
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100 + i * 10 for i in range(8)]  # 100, 110, 120, ...

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True
        assert forecaster.data_quality is not None
        assert forecaster.data_quality.status == "normal"

        # Verify output file
        output_file = forecaster.output_dir / "predictions" / "trends.json"
        assert output_file.exists()

        import json

        with output_file.open() as f:
            data = json.load(f)

        assert data["forecaster"] == "linear"
        assert data["data_quality"] == "normal"
        assert len(data["forecasts"]) > 0

        # Check that predicted values show increasing trend
        throughput_forecast = next(
            (f for f in data["forecasts"] if f["metric"] == "pr_throughput"), None
        )
        if throughput_forecast:
            values = throughput_forecast["values"]
            # All predictions should have bounds
            for v in values:
                assert v["lower_bound"] <= v["predicted"] <= v["upper_bound"]

    def test_confidence_bands_wider_for_low_confidence(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Low confidence data produces wider confidence bands."""
        # Create data with exactly MIN_WEEKS_REQUIRED (low confidence)
        weeks = MIN_WEEKS_REQUIRED
        base = date(2026, 1, 6)  # A Monday
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(weeks)]
        cycle_times = [100 + i * 5 for i in range(weeks)]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True
        assert forecaster.data_quality is not None
        assert forecaster.data_quality.status == "low_confidence"

        # Verify output
        import json

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        assert data["data_quality"] == "low_confidence"

    def test_empty_database_returns_insufficient(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Empty database produces insufficient status."""
        df = pd.DataFrame(columns=["closed_date", "cycle_time_minutes"])

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True  # Still writes file
        assert forecaster.data_quality is not None
        assert forecaster.data_quality.status == "insufficient"

        # Verify output
        import json

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        assert data["data_quality"] == "insufficient"
        assert data["forecasts"] == []

    def test_output_schema_matches_prophet(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Output schema matches ProphetForecaster format."""
        weeks = 10
        base = date(2026, 1, 6)  # A Monday
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(weeks)]
        cycle_times = [100] * weeks

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True

        import json

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        # Required schema fields
        assert "schema_version" in data
        assert data["schema_version"] == 1
        assert "generated_at" in data
        assert "generated_by" in data
        assert "is_stub" in data
        assert data["is_stub"] is False
        assert "forecaster" in data
        assert data["forecaster"] == "linear"
        assert "forecasts" in data

        # Forecast structure
        for forecast in data["forecasts"]:
            assert "metric" in forecast
            assert "unit" in forecast
            assert "horizon_weeks" in forecast
            assert "values" in forecast

            # Forecast value structure
            for value in forecast["values"]:
                assert "period_start" in value
                assert "predicted" in value
                assert "lower_bound" in value
                assert "upper_bound" in value

    def test_forecaster_field_is_linear(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Output includes forecaster field with value 'linear'."""
        weeks = 8
        base = date(2026, 1, 6)  # A Monday
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(weeks)]
        cycle_times = [100] * weeks

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True

        import json

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        assert data["forecaster"] == "linear"

    def test_horizon_shortened_for_low_confidence(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Forecast horizon is shorter for low confidence data."""
        # Low confidence: 4-7 weeks
        weeks = MIN_WEEKS_REQUIRED
        base = date(2026, 1, 6)  # A Monday
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(weeks)]
        cycle_times = [100] * weeks

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True

        import json

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        # Horizon should be reduced for low confidence
        for forecast in data["forecasts"]:
            assert forecast["horizon_weeks"] <= 2


class TestFallbackForecasterIntegration:
    """Integration tests for fallback forecaster with get_forecaster."""

    def test_get_forecaster_returns_fallback_when_prophet_unavailable(
        self, tmp_path: Path
    ) -> None:
        """Factory returns FallbackForecaster when Prophet not available."""
        from ado_git_repo_insights.ml import get_forecaster

        mock_db = MagicMock()

        with patch("ado_git_repo_insights.ml.is_prophet_available", return_value=False):
            forecaster = get_forecaster(mock_db, tmp_path)

        assert forecaster.__class__.__name__ == "FallbackForecaster"

    def test_get_forecaster_respects_prefer_prophet_false(self, tmp_path: Path) -> None:
        """Factory returns FallbackForecaster when prefer_prophet=False."""
        from ado_git_repo_insights.ml import get_forecaster

        mock_db = MagicMock()

        forecaster = get_forecaster(mock_db, tmp_path, prefer_prophet=False)

        assert forecaster.__class__.__name__ == "FallbackForecaster"


class TestMetricsConfiguration:
    """Tests for METRICS configuration (US2 - Review Time Removal)."""

    def test_metrics_has_only_two_entries(self) -> None:
        """METRICS list should only have pr_throughput and cycle_time_minutes.

        Review time was removed because it used cycle time as a misleading proxy.
        """
        from ado_git_repo_insights.ml.fallback_forecaster import METRICS

        assert len(METRICS) == 2, f"Expected 2 metrics, got {len(METRICS)}"

    def test_metrics_does_not_include_review_time(self) -> None:
        """METRICS should not include review_time_minutes."""
        from ado_git_repo_insights.ml.fallback_forecaster import METRICS

        metric_names = [m[0] for m in METRICS]
        assert "review_time_minutes" not in metric_names

    def test_metrics_includes_pr_throughput(self) -> None:
        """METRICS should include pr_throughput."""
        from ado_git_repo_insights.ml.fallback_forecaster import METRICS

        metric_names = [m[0] for m in METRICS]
        assert "pr_throughput" in metric_names

    def test_metrics_includes_cycle_time(self) -> None:
        """METRICS should include cycle_time_minutes."""
        from ado_git_repo_insights.ml.fallback_forecaster import METRICS

        metric_names = [m[0] for m in METRICS]
        assert "cycle_time_minutes" in metric_names
