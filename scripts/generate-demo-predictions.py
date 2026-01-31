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
    - Python 3.11+ (pinned for cross-platform reproducibility)
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

# =============================================================================
# Configuration Constants
# =============================================================================

# Forecast parameters (per data-model.md and tasks.md)
FORECAST_HORIZON_WEEKS = 12
TREND_LOOKBACK_WEEKS = 8
BASE_CONFIDENCE_INTERVAL = 0.15  # ±15%
CONFIDENCE_WIDENING_PER_WEEK = 0.01  # +1% per week

# Paths
DATA_DIR = Path(__file__).parent.parent / "docs" / "data"
ROLLUPS_DIR = DATA_DIR / "aggregates" / "weekly_rollups"
PREDICTIONS_DIR = DATA_DIR / "predictions"
OUTPUT_FILE = PREDICTIONS_DIR / "trends.json"
MANIFEST_FILE = DATA_DIR / "dataset-manifest.json"

# Schema version
PREDICTIONS_SCHEMA_VERSION = 1


# =============================================================================
# Canonical JSON Utilities (matching generate-demo-data.py)
# =============================================================================


def round_float(value: float, decimals: int = 3) -> float:
    """Round float to specified decimal places using HALF_UP rounding."""
    d = Decimal(str(value)).quantize(Decimal(10) ** -decimals, rounding=ROUND_HALF_UP)
    return float(d)


def canonical_json(data: Any, indent: int = 2) -> str:
    """
    Generate canonical JSON with:
    - Sorted keys
    - 3-decimal floats
    - LF newlines only
    - Trailing newline
    """

    def default_serializer(obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
        if isinstance(obj, date):
            return obj.isoformat()
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

    # Pre-process floats to 3 decimal places
    def process_floats(obj: Any) -> Any:
        if isinstance(obj, float):
            return round_float(obj)
        if isinstance(obj, dict):
            return {k: process_floats(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [process_floats(item) for item in obj]
        return obj

    processed = process_floats(data)
    json_str = json.dumps(
        processed, sort_keys=True, indent=indent, default=default_serializer
    )
    # Ensure LF line endings and trailing newline
    json_str = json_str.replace("\r\n", "\n")
    if not json_str.endswith("\n"):
        json_str += "\n"
    return json_str


def write_json_file(path: Path, data: Any) -> None:
    """Write data to JSON file with canonical formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    content = canonical_json(data)
    path.write_text(content, encoding="utf-8", newline="\n")


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


def load_weekly_rollups() -> list[WeeklyMetrics]:
    """Load all weekly rollups and extract relevant metrics."""
    rollups = []

    for rollup_file in sorted(ROLLUPS_DIR.glob("*.json")):
        with open(rollup_file, encoding="utf-8") as f:
            data = json.load(f)

        rollups.append(
            WeeklyMetrics(
                week=data["week"],
                start_date=date.fromisoformat(data["start_date"]),
                pr_count=data["pr_count"],
                cycle_time_p50=data["cycle_time_p50"],
            )
        )

    return sorted(rollups, key=lambda r: r.week)


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
        (Decimal(i) - d_x_mean) * (y - d_y_mean) for i, y in enumerate(d_values)
    )
    d_denominator = sum((Decimal(i) - d_x_mean) ** 2 for i in range(n))

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
) -> list[dict[str, Any]]:
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
        d_predicted = d_slope * d_week_index + d_intercept

        # Ensure non-negative values
        d_predicted = max(Decimal("0"), d_predicted)

        # Calculate widening confidence interval (T036) using Decimal
        d_confidence = d_base_confidence + (Decimal(week_offset) * d_widening)
        d_lower_bound = max(Decimal("0"), d_predicted * (Decimal("1") - d_confidence))
        d_upper_bound = d_predicted * (Decimal("1") + d_confidence)

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


def generate_pr_throughput_forecast(rollups: list[WeeklyMetrics]) -> dict[str, Any]:
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


def generate_cycle_time_forecast(rollups: list[WeeklyMetrics]) -> dict[str, Any]:
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


def generate_review_time_forecast(rollups: list[WeeklyMetrics]) -> dict[str, Any]:
    """
    Generate review_time_minutes forecast (T035).

    Note: Since we don't have explicit review_time data in rollups,
    we derive it as approximately 40% of cycle time (typical review portion).
    """
    # Get last 8 weeks of cycle time P50 and derive review time
    recent = rollups[-TREND_LOOKBACK_WEEKS:]
    # Review time is typically ~40% of total cycle time
    historical_values = [r.cycle_time_p50 * 0.4 for r in recent]
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
# Manifest Update (T038)
# =============================================================================


def update_manifest_predictions_flag() -> None:
    """Update dataset-manifest.json to set features.predictions=true."""
    with open(MANIFEST_FILE, encoding="utf-8") as f:
        manifest = json.load(f)

    manifest["features"]["predictions"] = True

    write_json_file(MANIFEST_FILE, manifest)
    print(f"  Updated: {MANIFEST_FILE}")


# =============================================================================
# Main Generation
# =============================================================================


def main() -> int:
    """Generate predictions data."""
    print("Generating demo predictions...")
    print(f"Output: {PREDICTIONS_DIR}")

    # Verify rollups exist
    if not ROLLUPS_DIR.exists():
        print(f"ERROR: Weekly rollups not found at {ROLLUPS_DIR}")
        print("Please run generate-demo-data.py first.")
        return 1

    # Load rollups
    print("\n[1/4] Loading weekly rollups...")
    rollups = load_weekly_rollups()
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
    print("\n[3/4] Writing predictions/trends.json...")
    predictions = {
        "schema_version": PREDICTIONS_SCHEMA_VERSION,
        "generated_at": datetime(2026, 1, 30, 12, 0, 0, tzinfo=timezone.utc),
        "generated_by": "generate-demo-predictions.py",
        "is_stub": False,
        "forecasts": forecasts,
    }

    write_json_file(OUTPUT_FILE, predictions)
    print(f"  Written: {OUTPUT_FILE}")

    # Update manifest (T038)
    print("\n[4/4] Updating dataset-manifest.json...")
    update_manifest_predictions_flag()

    print("\nPredictions generation complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
