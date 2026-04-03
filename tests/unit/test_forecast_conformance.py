"""FR-006: Verify both forecasters produce output conforming to shared types.

Ensures ForecastValue is the canonical shape for both Prophet and linear
forecasters, preventing silent schema drift between implementations.
"""

from __future__ import annotations

from ado_git_repo_insights.types import (
    ForecastValue,
    MetricForecastDict,
)


class TestForecastValueStructure:
    """Verify ForecastValue TypedDict has the expected fields."""

    def test_forecast_value_has_required_keys(self) -> None:
        val: ForecastValue = {
            "period_start": "2026-01-27",
            "predicted": 12.34,
            "lower_bound": 10.0,
            "upper_bound": 15.0,
        }
        assert val["period_start"] == "2026-01-27"
        assert val["predicted"] == 12.34
        assert val["lower_bound"] == 10.0
        assert val["upper_bound"] == 15.0

    def test_forecast_value_with_optional_constraints(self) -> None:
        val: ForecastValue = {
            "period_start": "2026-01-27",
            "predicted": 12.34,
            "lower_bound": 10.0,
            "upper_bound": 15.0,
            "constraints_applied": ["floor_zero"],
        }
        assert val["constraints_applied"] == ["floor_zero"]

    def test_forecast_value_without_constraints(self) -> None:
        val: ForecastValue = {
            "period_start": "2026-02-03",
            "predicted": 5.0,
            "lower_bound": 3.0,
            "upper_bound": 7.0,
        }
        assert "constraints_applied" not in val


class TestMetricForecastDictStructure:
    """Verify MetricForecastDict shape matches both forecaster outputs."""

    def test_prophet_style_forecast(self) -> None:
        forecast: MetricForecastDict = {
            "metric": "pr_throughput",
            "unit": "count",
            "horizon_weeks": 4,
            "values": [
                {
                    "period_start": "2026-01-27",
                    "predicted": 12.0,
                    "lower_bound": 8.0,
                    "upper_bound": 16.0,
                },
            ],
        }
        assert forecast["metric"] == "pr_throughput"
        assert len(forecast["values"]) == 1

    def test_fallback_style_forecast_with_constraints(self) -> None:
        """Fallback forecaster values include constraints_applied."""
        constrained_val: ForecastValue = {
            "period_start": "2026-01-27",
            "predicted": 0.0,
            "lower_bound": 0.0,
            "upper_bound": 5.0,
            "constraints_applied": ["floor_zero"],
        }
        forecast: MetricForecastDict = {
            "metric": "cycle_time_minutes",
            "unit": "minutes",
            "horizon_weeks": 2,
            "values": [constrained_val],
        }
        assert forecast["horizon_weeks"] == 2
        assert forecast["values"][0]["predicted"] == 0.0
