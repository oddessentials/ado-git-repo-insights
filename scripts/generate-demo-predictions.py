#!/usr/bin/env python3
"""
Generate deterministic ML predictions for GitHub Pages demo dashboard.

This script produces 12-week forecasts for 3 metrics using linear trend
continuation from the last 8 weeks of generated rollup data.

Output: docs/data/predictions/trends.json

Usage:
    python scripts/generate-demo-predictions.py

Requirements:
    - Must run AFTER generate-demo-data.py (needs weekly rollups)
    - Python 3.12.x baseline (machine-enforced for committed demo artifacts)
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from demo_generation_common import (
    FIXED_GENERATED_AT,
    list_stable_json_files,
    load_json_file,
    narrow_int,
    refresh_demo_manifest_features,
    require_demo_generation_baseline_for_output,
    round_float,
    write_json_file,
)

# =============================================================================
# Configuration Constants
# =============================================================================

# Forecast parameters (per data-model.md and tasks.md)
FORECAST_HORIZON_WEEKS = 12
TREND_LOOKBACK_WEEKS = 8
BASE_CONFIDENCE_INTERVAL = 0.15  # ±15%
CONFIDENCE_WIDENING_PER_WEEK = 0.01  # +1% per week
REVIEW_TIME_FRACTION = 0.4  # Review time is ~40% of total cycle time

DEFAULT_DATA_DIR = Path(__file__).parent.parent / "docs" / "data"
GENERATOR_SCRIPT = "scripts/generate-demo-predictions.py"
# Schema version
PREDICTIONS_SCHEMA_VERSION = 1
# =============================================================================
# Data Loading
# =============================================================================


@dataclass
class WeeklyMetrics:
    """Extracted metrics from a weekly rollup."""

    week: str
    start_date: date
    pr_count: int
    cycle_time_p50: float


def load_weekly_rollups(rollups_dir: Path) -> list[WeeklyMetrics]:
    """Load all weekly rollups and extract relevant metrics."""
    last_error: OSError | None = None
    for attempt in range(5):
        try:
            rollups = []
            for rollup_file in list_stable_json_files(rollups_dir):
                data = load_json_file(rollup_file)

                week_val = data["week"]
                if not isinstance(week_val, str):
                    raise TypeError(
                        f"Expected str for week, got {type(week_val).__name__}"
                    )
                sd_val = data["start_date"]
                if not isinstance(sd_val, str):
                    raise TypeError(
                        f"Expected str for start_date, got {type(sd_val).__name__}"
                    )
                ct_p50_raw = data["cycle_time_p50"]
                if ct_p50_raw is None:
                    ct_p50_f = 0.0
                elif isinstance(ct_p50_raw, (int, float)):
                    ct_p50_f = float(ct_p50_raw)
                else:
                    raise TypeError(
                        f"cycle_time_p50 in {rollup_file.name} expected "
                        f"numeric or null, got {type(ct_p50_raw).__name__}"
                    )

                rollups.append(
                    WeeklyMetrics(
                        week=week_val,
                        start_date=date.fromisoformat(sd_val),
                        pr_count=narrow_int(data["pr_count"]),
                        cycle_time_p50=ct_p50_f,
                    )
                )
            return sorted(rollups, key=lambda r: r.week)
        except OSError as exc:
            last_error = exc
            if attempt < 4:
                time.sleep(0.1 * (attempt + 1))
            else:
                raise RuntimeError(
                    "Weekly rollups did not stabilize before predictions generation"
                ) from last_error

    raise AssertionError("unreachable")


# =============================================================================
# Linear Trend Calculation (T032)
# =============================================================================


def calculate_linear_trend(values: list[float]) -> tuple[Decimal, Decimal]:
    """
    Calculate linear trend (slope and intercept) using least squares.

    Uses Decimal arithmetic for cross-platform reproducibility.

    Returns (slope, intercept) where:
        predicted_value = slope * week_index + intercept
    """
    n = len(values)
    if n == 0:
        return Decimal("0"), Decimal("0")
    if n == 1:
        return Decimal("0"), Decimal(str(values[0]))

    # Convert to Decimal for deterministic arithmetic
    d_values = [Decimal(str(v)) for v in values]
    d_n = Decimal(n)

    # Simple least squares using Decimal
    d_x_mean = Decimal(n - 1) / Decimal("2")  # Mean of 0, 1, 2, ..., n-1
    d_y_mean = sum(d_values) / d_n

    d_numerator = sum(
        ((Decimal(i) - d_x_mean) * (y - d_y_mean) for i, y in enumerate(d_values)),
        Decimal("0"),
    )
    d_denominator = sum(
        ((Decimal(i) - d_x_mean) ** 2 for i in range(n)),
        Decimal("0"),
    )

    if d_denominator == 0:
        return Decimal("0"), d_y_mean

    d_slope = d_numerator / d_denominator
    d_intercept = d_y_mean - d_slope * d_x_mean

    return d_slope, d_intercept


def generate_forecast(
    historical_values: list[float],
    last_date: date,
    horizon_weeks: int,
    base_confidence: float = BASE_CONFIDENCE_INTERVAL,
    widening_per_week: float = CONFIDENCE_WIDENING_PER_WEEK,
) -> list[dict[str, object]]:
    """
    Generate forecast values with widening confidence intervals.

    Uses Decimal arithmetic throughout to ensure cross-platform reproducibility.

    Args:
        historical_values: Last N weeks of values for trend calculation
        last_date: The start date of the last historical week
        horizon_weeks: Number of weeks to forecast
        base_confidence: Base confidence interval (±percentage)
        widening_per_week: Additional confidence per forecast week

    Returns:
        List of forecast value dictionaries
    """
    slope, intercept = calculate_linear_trend(historical_values)
    n = len(historical_values)

    # Convert to Decimal for deterministic arithmetic
    d_slope = Decimal(str(slope))
    d_intercept = Decimal(str(intercept))
    d_base_confidence = Decimal(str(base_confidence))
    d_widening = Decimal(str(widening_per_week))

    forecasts = []
    for week_offset in range(1, horizon_weeks + 1):
        # Calculate the Monday of this forecast week
        period_start = last_date + timedelta(weeks=week_offset)

        # Project the trend forward using Decimal arithmetic
        d_week_index = Decimal(n - 1 + week_offset)
        d_raw_predicted = d_slope * d_week_index + d_intercept

        # Ensure non-negative predicted values
        d_predicted = max(Decimal("0"), d_raw_predicted)

        # Calculate widening confidence interval (T036) using Decimal.
        # Use |raw| for half-width so intervals don't collapse to [0,0,0]
        # when the trend crosses zero (predicted clamped to 0 but raw < 0).
        d_confidence = d_base_confidence + (Decimal(week_offset) * d_widening)
        d_half_width = abs(d_raw_predicted) * d_confidence
        d_lower_bound = max(Decimal("0"), d_predicted - d_half_width)
        d_upper_bound = d_predicted + d_half_width

        # Round all values to 3 decimals for canonical output
        forecasts.append(
            {
                "period_start": period_start,
                "predicted": round_float(float(d_predicted)),
                "lower_bound": round_float(float(d_lower_bound)),
                "upper_bound": round_float(float(d_upper_bound)),
            }
        )

    return forecasts


# =============================================================================
# Metric Forecast Generation (T033-T035)
# =============================================================================


def generate_pr_throughput_forecast(rollups: list[WeeklyMetrics]) -> dict[str, object]:
    """Generate pr_throughput forecast (T033)."""
    # Get last 8 weeks of PR counts
    recent = rollups[-TREND_LOOKBACK_WEEKS:]
    historical_values = [float(r.pr_count) for r in recent]
    last_date = recent[-1].start_date

    return {
        "metric": "pr_throughput",
        "unit": "count",
        "horizon_weeks": FORECAST_HORIZON_WEEKS,
        "values": generate_forecast(
            historical_values, last_date, FORECAST_HORIZON_WEEKS
        ),
    }


def generate_cycle_time_forecast(rollups: list[WeeklyMetrics]) -> dict[str, object]:
    """Generate cycle_time_minutes forecast (T034)."""
    # Get last 8 weeks of cycle time P50
    recent = rollups[-TREND_LOOKBACK_WEEKS:]
    historical_values = [r.cycle_time_p50 for r in recent]
    last_date = recent[-1].start_date

    return {
        "metric": "cycle_time_minutes",
        "unit": "minutes",
        "horizon_weeks": FORECAST_HORIZON_WEEKS,
        "values": generate_forecast(
            historical_values, last_date, FORECAST_HORIZON_WEEKS
        ),
    }


def generate_review_time_forecast(rollups: list[WeeklyMetrics]) -> dict[str, object]:
    """
    Generate review_time_minutes forecast (T035).

    Note: Since we don't have explicit review_time data in rollups,
    we derive it as approximately 40% of cycle time (typical review portion).
    """
    # Get last 8 weeks of cycle time P50 and derive review time
    recent = rollups[-TREND_LOOKBACK_WEEKS:]
    historical_values = [r.cycle_time_p50 * REVIEW_TIME_FRACTION for r in recent]
    last_date = recent[-1].start_date

    return {
        "metric": "review_time_minutes",
        "unit": "minutes",
        "horizon_weeks": FORECAST_HORIZON_WEEKS,
        "values": generate_forecast(
            historical_values, last_date, FORECAST_HORIZON_WEEKS
        ),
    }


# =============================================================================
# Main Generation
# =============================================================================


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Generate deterministic demo predictions"
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help="Root demo dataset directory containing aggregates/",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Generate predictions data."""
    args = parse_args(argv)
    data_dir = args.output_root.resolve()
    require_demo_generation_baseline_for_output(GENERATOR_SCRIPT, data_dir)
    rollups_dir = data_dir / "aggregates" / "weekly_rollups"
    predictions_dir = data_dir / "predictions"
    output_file = predictions_dir / "trends.json"
    manifest_file = data_dir / "dataset-manifest.json"

    print("Generating demo predictions...")
    print(f"Output: {predictions_dir}")

    # Verify rollups exist
    if not rollups_dir.exists():
        print(f"ERROR: Weekly rollups not found at {rollups_dir}")
        print("Please run generate-demo-data.py first.")
        return 1

    # Load rollups
    print("\n[1/4] Loading weekly rollups...")
    rollups = load_weekly_rollups(rollups_dir)
    print(f"  Loaded {len(rollups)} weekly rollups")

    if len(rollups) < TREND_LOOKBACK_WEEKS:
        print(f"ERROR: Need at least {TREND_LOOKBACK_WEEKS} weeks of data")
        return 1

    # Generate forecasts (T033-T035)
    print("\n[2/4] Generating forecasts...")
    forecasts = [
        generate_pr_throughput_forecast(rollups),
        generate_cycle_time_forecast(rollups),
        generate_review_time_forecast(rollups),
    ]
    print(f"  Generated {len(forecasts)} metric forecasts")
    for f in forecasts:
        print(f"    - {f['metric']}: {f['horizon_weeks']} weeks")

    # Build predictions document (T037)
    print("\n[3/3] Writing predictions/trends.json...")
    predictions = {
        "schema_version": PREDICTIONS_SCHEMA_VERSION,
        "generated_at": FIXED_GENERATED_AT,
        "generated_by": "generate-demo-predictions.py",
        "is_stub": False,
        "forecasts": forecasts,
    }

    write_json_file(output_file, predictions)
    print(f"  Written: {output_file}")

    print("  Refreshing dataset-manifest feature flags...")
    refresh_demo_manifest_features(manifest_file, data_dir)

    print("\nPredictions generation complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
