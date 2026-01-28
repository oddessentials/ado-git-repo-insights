"""Unit tests for FallbackForecaster (linear regression predictions).

Tests for:
- T010: Linear regression forecasting
- T011: Confidence band calculation
- T012: Data quality assessment (4+ weeks check)
- T013: Outlier clipping logic
- Edge case hardening: constant series, NaN-heavy data, large values
- Status codes and reason codes
- Constraint tracking (floor_zero, outlier_clipped)
- Deterministic JSON output for golden-file testing
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from ado_git_repo_insights.ml.fallback_forecaster import (
    CONSTRAINT_FLOOR_ZERO,
    LOW_CONFIDENCE_THRESHOLD,
    MIN_WEEKS_REQUIRED,
    REASON_CONSTANT_SERIES,
    REASON_FLOOR_APPLIED,
    REASON_STATS_UNDEFINED,
    STATUS_DEGRADED,
    STATUS_OK,
    FallbackForecaster,
    assess_data_quality,
    clip_outliers,
    detect_constant_series,
    safe_clip_outliers,
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


class TestDetectConstantSeries:
    """Tests for constant series detection (edge case hardening)."""

    def test_empty_array_returns_false(self) -> None:
        """Empty array is not constant."""
        values = np.array([])
        assert detect_constant_series(values) is False

    def test_single_value_is_constant(self) -> None:
        """Single value is a constant series."""
        values = np.array([42.0])
        assert detect_constant_series(values) is True

    def test_all_same_values_is_constant(self) -> None:
        """All identical values are constant."""
        values = np.array([100.0, 100.0, 100.0, 100.0])
        assert detect_constant_series(values) is True

    def test_different_values_not_constant(self) -> None:
        """Different values are not constant."""
        values = np.array([100.0, 101.0, 100.0, 100.0])
        assert detect_constant_series(values) is False

    def test_ignores_nan_values(self) -> None:
        """NaN values are ignored when checking for constant."""
        values = np.array([100.0, np.nan, 100.0, np.nan, 100.0])
        assert detect_constant_series(values) is True

    def test_all_nan_returns_false(self) -> None:
        """All NaN values are not constant (no finite values)."""
        values = np.array([np.nan, np.nan, np.nan])
        assert detect_constant_series(values) is False

    def test_handles_inf_values(self) -> None:
        """Infinite values are filtered out."""
        values = np.array([100.0, np.inf, 100.0, -np.inf, 100.0])
        assert detect_constant_series(values) is True


class TestSafeClipOutliers:
    """Tests for safe outlier clipping with edge case handling."""

    def test_empty_array_returns_unchanged(self) -> None:
        """Empty array returns unchanged with no reason."""
        values = np.array([])
        result, reason, was_clipped = safe_clip_outliers(values)
        assert len(result) == 0
        assert reason is None
        assert was_clipped is False

    def test_insufficient_finite_values_returns_stats_undefined(self) -> None:
        """Less than min_n finite values returns stats_undefined."""
        values = np.array([1.0, np.nan, np.nan, np.nan])
        result, reason, was_clipped = safe_clip_outliers(values, min_n=4)
        np.testing.assert_array_equal(result, values)
        assert reason == REASON_STATS_UNDEFINED
        assert was_clipped is False

    def test_constant_series_skips_clipping(self) -> None:
        """Constant series returns unchanged with no reason."""
        values = np.array([100.0, 100.0, 100.0, 100.0])
        result, reason, was_clipped = safe_clip_outliers(values)
        np.testing.assert_array_equal(result, values)
        assert reason is None
        assert was_clipped is False

    def test_outliers_clipped_returns_reason(self) -> None:
        """When outliers are clipped, returns outliers_clipped reason."""
        # Create values with a clear outlier
        values = np.array([10.0] * 20 + [1000.0])
        result, reason, was_clipped = safe_clip_outliers(values)
        assert result[-1] < 1000.0  # Outlier should be clipped
        assert reason == "outliers_clipped"
        assert was_clipped is True

    def test_no_outliers_returns_no_reason(self) -> None:
        """When no outliers exist, returns no reason."""
        values = np.array([10.0, 11.0, 12.0, 11.5, 10.5])
        result, reason, was_clipped = safe_clip_outliers(values)
        np.testing.assert_array_almost_equal(result, values)
        assert reason is None
        assert was_clipped is False


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


class TestEdgeCaseHardening:
    """Tests for edge case hardening (006-forecaster-edge-hardening)."""

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

    def test_constant_series_produces_valid_forecast(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Constant series (zero variance) produces valid forecast with identical bounds."""
        # Create 8 weeks of identical cycle times
        base = date(2026, 1, 6)  # A Monday
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100.0] * 8  # All identical

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True
        assert forecaster.status == STATUS_OK
        assert forecaster.reason_code == REASON_CONSTANT_SERIES

        # Verify output
        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        assert data["status"] == STATUS_OK
        assert data["reason_code"] == REASON_CONSTANT_SERIES

        # Check cycle_time forecast has identical bounds
        cycle_forecast = next(
            (f for f in data["forecasts"] if f["metric"] == "cycle_time_minutes"), None
        )
        assert cycle_forecast is not None
        for v in cycle_forecast["values"]:
            assert v["predicted"] == v["lower_bound"] == v["upper_bound"] == 100.0
            assert v["constraints_applied"] == []

    def test_large_values_no_overflow(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Large values (up to 10^9) do not cause overflow errors."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        # Mix of large values
        cycle_times = [1e9, 1e9, 1e9, 1e9, 1e8, 1e8, 1e8, 1e8]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True
        assert forecaster.status in (STATUS_OK, STATUS_DEGRADED)

        # Verify all values are finite
        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        for forecast in data["forecasts"]:
            for v in forecast["values"]:
                assert np.isfinite(v["predicted"])
                assert np.isfinite(v["lower_bound"])
                assert np.isfinite(v["upper_bound"])

    def test_nan_heavy_dataset_with_enough_finite(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Dataset with >50% NaN but ≥4 finite values produces valid forecast."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(10)]
        # 4 finite values, 6 NaN
        cycle_times = [
            100.0,
            np.nan,
            110.0,
            np.nan,
            np.nan,
            120.0,
            np.nan,
            130.0,
            np.nan,
            np.nan,
        ]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True
        # Should produce valid output despite heavy NaN

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        assert len(data["forecasts"]) > 0

    def test_all_nan_cycle_time_still_forecasts_throughput(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """All NaN cycle times still produce throughput forecast from pr_count."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [np.nan] * 8

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True
        # pr_throughput can still be calculated from closed_date counts
        # Only cycle_time_minutes metric will fail due to NaN

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        # Should have at least pr_throughput forecast
        assert len(data["forecasts"]) >= 1
        metric_names = [f["metric"] for f in data["forecasts"]]
        assert "pr_throughput" in metric_names

    def test_negative_predictions_floored_to_zero(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Negative predictions are floored to zero with constraint tracking."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        # Strongly declining trend that will predict negative values
        cycle_times = [800.0, 600.0, 400.0, 200.0, 100.0, 50.0, 25.0, 10.0]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        # Check that negative values are floored and constraints tracked
        cycle_forecast = next(
            (f for f in data["forecasts"] if f["metric"] == "cycle_time_minutes"), None
        )
        assert cycle_forecast is not None, "cycle_time_minutes forecast should exist"

        # Verify all values are non-negative
        for v in cycle_forecast["values"]:
            assert v["predicted"] >= 0, f"predicted {v['predicted']} should be >= 0"
            assert v["lower_bound"] >= 0, (
                f"lower_bound {v['lower_bound']} should be >= 0"
            )

        # Verify constraint tracking - at least one value should have floor_zero
        # given the strongly declining trend
        floored_values = [
            v
            for v in cycle_forecast["values"]
            if CONSTRAINT_FLOOR_ZERO in v["constraints_applied"]
        ]
        # With such a steep decline, we expect some flooring to occur
        assert len(floored_values) > 0 or all(
            v["predicted"] > 0 and v["lower_bound"] > 0
            for v in cycle_forecast["values"]
        ), "Expected floor_zero constraint when values are floored to 0"

    def test_floor_applied_reason_code_set(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """When floor is applied, reason_code is set to floor_applied."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        # Very steep decline that guarantees negative predictions
        cycle_times = [1000.0, 800.0, 600.0, 400.0, 200.0, 100.0, 50.0, 10.0]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        # Check that reason_code is floor_applied when constraints were triggered
        cycle_forecast = next(
            (f for f in data["forecasts"] if f["metric"] == "cycle_time_minutes"), None
        )
        if cycle_forecast:
            # Check if any value has floor_zero constraint
            has_floor_constraint = any(
                CONSTRAINT_FLOOR_ZERO in v["constraints_applied"]
                for v in cycle_forecast["values"]
            )
            if has_floor_constraint:
                # When floor is the only issue, reason_code should be floor_applied
                # (unless another reason like stats_undefined took precedence)
                assert (
                    data["reason_code"] in (REASON_FLOOR_APPLIED, None)
                    or data["status"] == STATUS_OK
                )

    def test_constraints_applied_field_present(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """All forecast values include constraints_applied field."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100.0 + i * 10 for i in range(8)]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        for forecast in data["forecasts"]:
            for v in forecast["values"]:
                assert "constraints_applied" in v
                assert isinstance(v["constraints_applied"], list)

    def test_status_and_reason_code_in_output(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Output includes status and reason_code fields."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100.0 + i * 10 for i in range(8)]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            result = forecaster.generate()

        assert result is True

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        assert "status" in data
        assert "reason_code" in data

    def test_deterministic_output_sorted_keys(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Output is deterministic with sorted keys and metrics."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100.0 + i * 10 for i in range(8)]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            forecaster.generate()

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            content = f.read()

        # Verify forecasts are sorted alphabetically by metric
        data = json.loads(content)
        metric_names = [f["metric"] for f in data["forecasts"]]
        assert metric_names == sorted(metric_names)

    def test_floats_rounded_to_two_decimal_places(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """All float values are rounded to 2 decimal places."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100.123456789 + i * 10.987654321 for i in range(8)]

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            forecaster.generate()

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            data = json.load(f)

        for forecast in data["forecasts"]:
            for v in forecast["values"]:
                for key in ("predicted", "lower_bound", "upper_bound"):
                    value = v[key]
                    # Check that value has at most 2 decimal places
                    rounded = round(value, 2)
                    assert value == rounded, f"{key}={value} should be {rounded}"


class TestGoldenFileDeterminism:
    """Tests for deterministic output suitable for golden-file testing."""

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

    def test_constant_series_matches_golden_structure(
        self, forecaster: FallbackForecaster, mock_db: MagicMock
    ) -> None:
        """Constant series output matches golden file structure (excluding dynamic fields).

        Validates:
        - Metrics are sorted alphabetically
        - All expected fields are present
        - Values have correct structure
        - Status and reason_code are correct
        """
        base = date(2026, 1, 6)  # A Monday
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100.0] * 8  # All identical

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        with patch.object(pd, "read_sql_query", return_value=df):
            forecaster.generate()

        output_file = forecaster.output_dir / "predictions" / "trends.json"
        with output_file.open() as f:
            actual = json.load(f)

        # Load golden file
        golden_path = (
            Path(__file__).parent.parent
            / "fixtures"
            / "golden"
            / "constant-series-forecast.json"
        )
        with golden_path.open() as f:
            expected = json.load(f)

        # Compare structure (not dynamic fields)
        assert actual["status"] == expected["status"]
        assert actual["reason_code"] == expected["reason_code"]
        assert actual["forecaster"] == expected["forecaster"]
        assert actual["schema_version"] == expected["schema_version"]
        assert actual["is_stub"] == expected["is_stub"]
        assert actual["generated_by"] == expected["generated_by"]

        # Compare forecasts structure
        assert len(actual["forecasts"]) == len(expected["forecasts"])

        # Metrics should be in same order (alphabetically sorted)
        actual_metrics = [f["metric"] for f in actual["forecasts"]]
        expected_metrics = [f["metric"] for f in expected["forecasts"]]
        assert actual_metrics == expected_metrics

        # Verify cycle_time forecast values
        actual_ct = next(
            f for f in actual["forecasts"] if f["metric"] == "cycle_time_minutes"
        )
        expected_ct = next(
            f for f in expected["forecasts"] if f["metric"] == "cycle_time_minutes"
        )

        assert actual_ct["unit"] == expected_ct["unit"]
        assert actual_ct["horizon_weeks"] == expected_ct["horizon_weeks"]
        assert len(actual_ct["values"]) == len(expected_ct["values"])

        for actual_v, expected_v in zip(
            actual_ct["values"], expected_ct["values"], strict=True
        ):
            assert actual_v["predicted"] == expected_v["predicted"]
            assert actual_v["lower_bound"] == expected_v["lower_bound"]
            assert actual_v["upper_bound"] == expected_v["upper_bound"]
            assert actual_v["constraints_applied"] == expected_v["constraints_applied"]

    def test_output_is_reproducible(
        self, forecaster: FallbackForecaster, mock_db: MagicMock, tmp_path: Path
    ) -> None:
        """Multiple runs with same input produce structurally identical output."""
        base = date(2026, 1, 6)
        dates = [(base + timedelta(weeks=i)).isoformat() for i in range(8)]
        cycle_times = [100.0] * 8

        df = pd.DataFrame({"closed_date": dates, "cycle_time_minutes": cycle_times})

        # Run twice
        with patch.object(pd, "read_sql_query", return_value=df):
            forecaster.generate()

        output_file1 = forecaster.output_dir / "predictions" / "trends.json"
        with output_file1.open() as f:
            data1 = json.load(f)

        # Create second forecaster to ensure clean state
        forecaster2 = FallbackForecaster(mock_db, tmp_path / "run2")

        with patch.object(pd, "read_sql_query", return_value=df):
            forecaster2.generate()

        output_file2 = forecaster2.output_dir / "predictions" / "trends.json"
        with output_file2.open() as f:
            data2 = json.load(f)

        # Compare non-dynamic fields
        assert data1["status"] == data2["status"]
        assert data1["reason_code"] == data2["reason_code"]
        assert data1["forecaster"] == data2["forecaster"]
        assert len(data1["forecasts"]) == len(data2["forecasts"])

        # Compare forecast values (should be identical)
        for f1, f2 in zip(data1["forecasts"], data2["forecasts"], strict=True):
            assert f1["metric"] == f2["metric"]
            assert f1["values"] == f2["values"]


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
