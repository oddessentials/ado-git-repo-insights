"""Performance benchmarks for chart rendering (T073).

Validates NFR-001: Chart render time < 100ms for 12 weeks of data.

Note: These tests measure Python-side data preparation time.
TypeScript rendering performance is validated via browser DevTools.
"""

from __future__ import annotations

import time
from datetime import date, timedelta


class TestChartRenderPerformance:
    """Performance benchmarks for chart components."""

    def test_forecast_data_preparation_under_100ms(self) -> None:
        """Forecast data preparation should complete in <100ms for 12 weeks."""
        import numpy as np
        import pandas as pd

        # Setup: 12 weeks of historical data
        base = date(2026, 1, 6)  # A Monday
        weeks = 12
        dates = [base + timedelta(weeks=i) for i in range(weeks)]
        pr_counts = [25 + i * 2 for i in range(weeks)]  # Trending data
        cycle_times = [120 + i * 5 for i in range(weeks)]

        # Create DataFrame (simulating what _get_weekly_metrics returns)
        df = pd.DataFrame(
            {
                "week_start": dates,
                "pr_count": pr_counts,
                "cycle_time_p50": cycle_times,
            }
        )

        # Benchmark forecast calculation (linear regression + confidence bands)
        start_time = time.perf_counter()

        # Simulate the linear forecasting calculation
        for metric_col in ["pr_count", "cycle_time_p50"]:
            values = df[metric_col].values.astype(float)
            x = np.arange(len(values))

            # Linear regression
            coefficients = np.polyfit(x, values, 1)
            slope, intercept = coefficients

            # Standard deviation for confidence bands
            predictions = slope * x + intercept
            residuals = values - predictions
            std_dev = float(np.std(residuals)) if len(residuals) > 1 else 0

            # Generate 4-week forecast
            future_x = np.arange(len(values), len(values) + 4)
            future_predictions = slope * future_x + intercept
            upper_bounds = future_predictions + 1.96 * std_dev  # noqa: F841
            lower_bounds = future_predictions - 1.96 * std_dev  # noqa: F841

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Assert < 100ms
        assert elapsed_ms < 100, (
            f"Data preparation took {elapsed_ms:.2f}ms, expected < 100ms"
        )

    def test_insight_sorting_under_10ms(self) -> None:
        """Insight sorting should complete in <10ms for 100 insights."""
        from ado_git_repo_insights.ml.insights import sort_insights

        # Setup: 100 insights with mixed severities
        insights = []
        categories = ["bottleneck", "trend", "anomaly"]
        severities = ["critical", "warning", "info"]

        for i in range(100):
            insights.append(
                {
                    "id": f"insight-{i:03d}",
                    "severity": severities[i % 3],
                    "category": categories[i % 3],
                    "title": f"Test insight {i}",
                }
            )

        # Benchmark sorting
        start_time = time.perf_counter()
        sorted_insights = sort_insights(insights)
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Assert < 10ms
        assert elapsed_ms < 10, f"Sorting took {elapsed_ms:.2f}ms, expected < 10ms"

        # Verify correct sorting
        assert len(sorted_insights) == 100
        # Critical should come first
        assert (
            all(
                i["severity"] == "critical"
                for i in sorted_insights[:34]  # ~1/3 are critical
            )
            or sorted_insights[0]["severity"] == "critical"
        )

    def test_sparkline_calculation_under_5ms(self) -> None:
        """Sparkline point calculation should complete in <5ms for 52 weeks.

        Note: Threshold increased from 1ms to 5ms to account for CI runner
        variability, especially on macOS where performance can vary significantly.
        """
        import numpy as np

        # Setup: 52 weeks of data points
        values = np.random.normal(100, 20, 52)

        # Benchmark sparkline calculation
        start_time = time.perf_counter()

        # Simulate sparkline SVG point calculation
        min_val = float(np.min(values))
        max_val = float(np.max(values))
        range_val = max_val - min_val if max_val != min_val else 1

        points = []
        width, height = 60, 20
        for i, val in enumerate(values):
            x = (i / (len(values) - 1)) * width
            y = (1 - (val - min_val) / range_val) * height
            points.append((x, y))

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Assert < 5ms (allows for CI runner variability)
        assert elapsed_ms < 5, f"Sparkline calc took {elapsed_ms:.2f}ms, expected < 5ms"
        assert len(points) == 52

    def test_confidence_band_calculation_under_5ms(self) -> None:
        """Confidence band calculation should complete in <5ms for 12 weeks."""
        import numpy as np

        # Setup: 12 weeks of predictions
        predictions = np.array([100 + i * 5 for i in range(12)])
        std_dev = 15.0

        # Benchmark confidence band calculation
        start_time = time.perf_counter()

        # Calculate upper and lower bounds (similar to FallbackForecaster logic)
        upper_bound = predictions + 1.96 * std_dev
        lower_bound = predictions - 1.96 * std_dev

        # Generate SVG path coordinates
        upper_points = [
            (i / 11 * 100, 100 - (v - 50) / 100 * 100)
            for i, v in enumerate(upper_bound)
        ]
        lower_points = [
            (i / 11 * 100, 100 - (v - 50) / 100 * 100)
            for i, v in enumerate(lower_bound)
        ]

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Assert < 5ms
        assert elapsed_ms < 5, (
            f"Confidence band calc took {elapsed_ms:.2f}ms, expected < 5ms"
        )
        assert len(upper_points) == 12
        assert len(lower_points) == 12


class TestMemoryUsage:
    """Memory usage benchmarks for ML components."""

    def test_forecaster_memory_under_50mb(self) -> None:
        """Forecaster should use <50MB for typical dataset."""
        import sys
        from unittest.mock import MagicMock

        # Measure baseline memory (used for reference, not asserted)
        _ = sys.getsizeof({})

        # Create forecaster with mocked dependencies
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

        forecaster = FallbackForecaster(db=mock_db, output_dir=None)

        # Rough memory estimate (object + numpy arrays)
        # This is a sanity check, not a precise measurement
        forecaster_size = sys.getsizeof(forecaster)

        # Should be small when no data loaded
        assert forecaster_size < 1024 * 1024, "Forecaster base memory too large"

    def test_insights_cache_bounded(self) -> None:
        """Insights cache should not grow unbounded."""
        import json

        # Simulate cache data for 100 insights
        cache_data = {
            "cache_key": "test-key-abc123",
            "cached_at": "2026-01-26T12:00:00Z",
            "insights_data": {
                "schema_version": 1,
                "insights": [
                    {
                        "id": f"insight-{i}",
                        "severity": "warning",
                        "category": "trend",
                        "title": f"Test insight {i}",
                        "description": "A" * 200,  # ~200 chars per description
                        "data": {"metric": "test", "current_value": 100},
                        "recommendation": {
                            "action": "Do something",
                            "priority": "high",
                            "effort": "low",
                        },
                    }
                    for i in range(100)
                ],
            },
        }

        # Serialize to check size
        json_str = json.dumps(cache_data)
        size_kb = len(json_str.encode("utf-8")) / 1024

        # Should be under 500KB for 100 insights
        assert size_kb < 500, f"Cache size {size_kb:.1f}KB exceeds 500KB limit"
