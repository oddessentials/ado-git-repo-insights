"""Fallback linear regression forecaster for zero-config predictions.

This module provides predictions when Prophet is not installed, enabling
zero-config functionality (FR-001). Uses numpy-only linear regression
for forecasting with confidence bands.

Key features:
- No external dependencies beyond numpy (already via pandas)
- Identical output schema to ProphetForecaster
- Data quality assessment (insufficient/low_confidence/normal)
- Outlier clipping (3 standard deviations) per FR-012
- Minimum data requirements (4+ weeks) per FR-011
- Edge case hardening for constant series, NaN-heavy data, extreme values
- Structured status codes with reason codes for transparency
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

from .date_utils import align_to_monday

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager

logger = logging.getLogger(__name__)

# Schema version (locked, matches ProphetForecaster)
PREDICTIONS_SCHEMA_VERSION = 1
GENERATOR_ID = "linear-v1.0"
HORIZON_WEEKS = 4
MAX_HORIZON_WEEKS = 12  # Maximum for large datasets per FR-013

# Data quality thresholds per FR-011
MIN_WEEKS_REQUIRED = 4
LOW_CONFIDENCE_THRESHOLD = 8

# Outlier clipping threshold per FR-012
OUTLIER_STD_THRESHOLD = 3.0

# Metric definitions (same as ProphetForecaster)
# Note: review_time_minutes removed - it used cycle_time as misleading proxy
METRICS = [
    ("pr_throughput", "count"),
    ("cycle_time_minutes", "minutes"),
]

# Status enum values for forecast results
STATUS_OK = "ok"
STATUS_INSUFFICIENT_DATA = "insufficient_data"
STATUS_DEGRADED = "degraded"

# Reason codes for detailed status explanations
REASON_TOO_FEW_WEEKS = "too_few_weeks"
REASON_ALL_NAN = "all_nan"
REASON_CONSTANT_SERIES = "constant_series"
REASON_STATS_UNDEFINED = "stats_undefined"
REASON_OUTLIERS_CLIPPED = "outliers_clipped"
REASON_FLOOR_APPLIED = "floor_applied"
REASON_NEGATIVE_VALUES_FILTERED = "negative_values_filtered"

# Constraint tracking constants
CONSTRAINT_FLOOR_ZERO = "floor_zero"
CONSTRAINT_OUTLIER_CLIPPED = "outlier_clipped"

# Fallback margin for upper bound when prediction is zero or near-zero
DEFAULT_UPPER_BOUND_MARGIN = 100.0


@dataclass
class DataQualityAssessment:
    """Assessment of data quality for forecasting."""

    status: str  # "normal", "low_confidence", "insufficient"
    weeks_available: int
    message: str


def assess_data_quality(weeks_available: int) -> DataQualityAssessment:
    """Assess data quality based on available weeks.

    Args:
        weeks_available: Number of weeks of historical data.

    Returns:
        DataQualityAssessment with status and message.
    """
    if weeks_available < MIN_WEEKS_REQUIRED:
        return DataQualityAssessment(
            status="insufficient",
            weeks_available=weeks_available,
            message=f"Insufficient data: {weeks_available} weeks available, "
            f"minimum {MIN_WEEKS_REQUIRED} weeks required for forecasting.",
        )
    elif weeks_available < LOW_CONFIDENCE_THRESHOLD:
        return DataQualityAssessment(
            status="low_confidence",
            weeks_available=weeks_available,
            message=f"Low confidence: {weeks_available} weeks available. "
            f"Recommend {LOW_CONFIDENCE_THRESHOLD}+ weeks for reliable forecasts.",
        )
    else:
        return DataQualityAssessment(
            status="normal",
            weeks_available=weeks_available,
            message=f"Normal: {weeks_available} weeks of data available.",
        )


def detect_constant_series(values: np.ndarray) -> bool:
    """Detect if all values in the series are identical (zero variance).

    Uses np.ptp (peak-to-peak range) which is numerically stable and
    returns 0.0 exactly for constant series without floating-point tolerance issues.

    Args:
        values: Array of values to check.

    Returns:
        True if all values are identical (constant series), False otherwise.
    """
    if len(values) == 0:
        return False
    # Filter to finite values first
    finite_values = values[np.isfinite(values)]
    if len(finite_values) == 0:
        return False
    # np.ptp returns the range (max - min); 0 means all values identical
    return float(np.ptp(finite_values)) == 0.0


def safe_clip_outliers(
    values: np.ndarray,
    std_threshold: float = OUTLIER_STD_THRESHOLD,
    min_n: int = MIN_WEEKS_REQUIRED,
) -> tuple[np.ndarray, str | None, bool]:
    """Clip outliers with safety checks for edge cases.

    Filters to finite values first, requires N≥min_n for stats computation,
    and falls back to no clipping when stats are undefined.

    Args:
        values: Array of values to clip.
        std_threshold: Number of standard deviations for clipping threshold.
        min_n: Minimum number of finite values required for stats computation.

    Returns:
        Tuple of (clipped_values, reason_code or None, was_clipped bool).
        reason_code is "stats_undefined" when clipping couldn't be performed,
        "outliers_clipped" when values were modified, or None when no action taken.
    """
    if len(values) == 0:
        return values, None, False

    # Filter to finite values only for stats computation
    finite_mask = np.isfinite(values)
    finite_values = values[finite_mask]

    if len(finite_values) < min_n:
        # Not enough finite values for stats - return original with degraded status
        return values, REASON_STATS_UNDEFINED, False

    # Check for zero variance (constant series) - no clipping needed
    if detect_constant_series(finite_values):
        return values, None, False

    # Compute stats on finite values only
    mean = float(np.nanmean(finite_values))
    std = float(np.nanstd(finite_values))

    # Safety check for undefined stats
    if not np.isfinite(mean) or not np.isfinite(std) or std == 0:
        return values, REASON_STATS_UNDEFINED, False

    lower_bound = mean - std_threshold * std
    upper_bound = mean + std_threshold * std

    clipped = np.clip(values, lower_bound, upper_bound)

    # Check if any clipping occurred
    was_clipped = not np.array_equal(values, clipped)
    reason = REASON_OUTLIERS_CLIPPED if was_clipped else None

    return clipped, reason, was_clipped


def clip_outliers(
    values: np.ndarray, std_threshold: float = OUTLIER_STD_THRESHOLD
) -> np.ndarray:
    """Clip outliers beyond N standard deviations from mean.

    Legacy wrapper for backward compatibility. Use safe_clip_outliers
    for new code that needs status tracking.

    Args:
        values: Array of values to clip.
        std_threshold: Number of standard deviations for clipping.

    Returns:
        Array with outliers clipped to threshold bounds.
    """
    if len(values) < 2:
        return values

    mean = np.nanmean(values)
    std = np.nanstd(values)

    if std == 0:
        return values

    lower_bound = mean - std_threshold * std
    upper_bound = mean + std_threshold * std

    result: np.ndarray = np.clip(values, lower_bound, upper_bound)
    return result


class FallbackForecaster:
    """Generate linear regression-based trend forecasts.

    Zero-config fallback when Prophet is not installed (FR-001).
    Reads weekly rollup data from SQLite and produces forecasts for:
    - PR throughput (count per week)
    - Cycle time (p50 in minutes)

    Edge case handling:
    - Constant series (zero variance): Returns baseline as predicted with zero confidence band
    - NaN-heavy data: Filters to finite values, requires N≥4
    - Extreme values: Safe outlier clipping with stats on finite values only
    - Negative predictions: Floored to zero with constraint tracking
    """

    def __init__(
        self,
        db: DatabaseManager,
        output_dir: Path,
    ) -> None:
        """Initialize the fallback forecaster.

        Args:
            db: Database manager with PR data.
            output_dir: Directory for output files.
        """
        self.db = db
        self.output_dir = output_dir
        self._data_quality: DataQualityAssessment | None = None
        self._status: str = STATUS_OK
        self._reason_code: str | None = None

    @property
    def data_quality(self) -> DataQualityAssessment | None:
        """Get the data quality assessment from the last generate() call."""
        return self._data_quality

    @property
    def status(self) -> str:
        """Get the forecast generation status from the last generate() call."""
        return self._status

    @property
    def reason_code(self) -> str | None:
        """Get the reason code from the last generate() call."""
        return self._reason_code

    def generate(self) -> bool:
        """Generate predictions and write to trends.json.

        Returns:
            True if file was written successfully, False otherwise.

        Behavior:
        - No data available → status: insufficient_data, reason: too_few_weeks
        - Insufficient data (<4 weeks) → status: insufficient_data, reason: too_few_weeks
        - All NaN data → status: insufficient_data, reason: all_nan
        - Constant series → status: ok, reason: constant_series
        - Low data (4-7 weeks) → write forecasts with low_confidence quality
        - Normal data (8+ weeks) → write forecasts with normal quality
        """
        start_time = time.perf_counter()

        # Reset status for this run
        self._status = STATUS_OK
        self._reason_code = None

        # Get weekly metrics from database
        df = self._get_weekly_metrics()

        # Assess data quality
        weeks_available = len(df) if not df.empty else 0
        self._data_quality = assess_data_quality(weeks_available)

        if df.empty or self._data_quality.status == "insufficient":
            logger.info(
                f"Insufficient data for predictions - {self._data_quality.message}"
            )
            self._status = STATUS_INSUFFICIENT_DATA
            self._reason_code = REASON_TOO_FEW_WEEKS
            return self._write_predictions(
                forecasts=[],
                data_quality=self._data_quality.status,
                status=self._status,
                reason_code=self._reason_code,
            )

        forecasts: list[dict[str, Any]] = []
        metric_reason_codes: list[str] = []

        for metric, unit in METRICS:
            try:
                forecast_data, metric_reason = self._forecast_metric(df, metric, unit)
                if forecast_data:
                    forecasts.append(forecast_data)
                    if metric_reason:
                        metric_reason_codes.append(metric_reason)
            except Exception as e:
                logger.warning(f"Failed to forecast {metric}: {type(e).__name__}: {e}")
                # Continue with other metrics

        if not forecasts:
            # All metrics failed - still write file with empty forecasts
            logger.warning("All metric forecasts failed - writing empty forecasts")
            self._status = STATUS_INSUFFICIENT_DATA
            self._reason_code = REASON_ALL_NAN
            return self._write_predictions(
                forecasts=[],
                data_quality=self._data_quality.status,
                status=self._status,
                reason_code=self._reason_code,
            )

        # Determine overall status based on metric results
        if metric_reason_codes:
            # Take the first reason code as representative
            self._reason_code = metric_reason_codes[0]
            # Constant series is still "ok", other reasons are degraded
            if self._reason_code not in (REASON_CONSTANT_SERIES,):
                self._status = STATUS_DEGRADED

        elapsed = time.perf_counter() - start_time
        logger.info(
            f"Linear forecasting completed in {elapsed:.2f}s "
            f"(data quality: {self._data_quality.status}, status: {self._status})"
        )

        return self._write_predictions(
            forecasts=forecasts,
            data_quality=self._data_quality.status,
            status=self._status,
            reason_code=self._reason_code,
        )

    def _get_weekly_metrics(self) -> pd.DataFrame:
        """Get weekly metrics from database.

        Returns:
            DataFrame with columns: week_start, pr_count, cycle_time_p50
        """
        query = """
            SELECT
                closed_date,
                cycle_time_minutes
            FROM pull_requests
            WHERE closed_date IS NOT NULL AND status = 'completed'
            ORDER BY closed_date
        """
        df = pd.read_sql_query(query, self.db.connection)

        if df.empty:
            return pd.DataFrame()

        # Convert to datetime and group by ISO week
        df["closed_dt"] = pd.to_datetime(df["closed_date"])
        df["iso_year"] = df["closed_dt"].dt.isocalendar().year
        df["iso_week"] = df["closed_dt"].dt.isocalendar().week

        # Aggregate by week
        weekly = (
            df.groupby(["iso_year", "iso_week"])
            .agg(
                pr_count=("closed_date", "count"),
                cycle_time_p50=("cycle_time_minutes", lambda x: x.quantile(0.5)),
            )
            .reset_index()
        )

        # Calculate week start date (Monday) using dedicated utility
        weekly["week_start"] = weekly.apply(
            lambda row: align_to_monday(
                date.fromisocalendar(int(row["iso_year"]), int(row["iso_week"]), 1)
            ),
            axis=1,
        )

        return weekly.sort_values("week_start").reset_index(drop=True)

    def _forecast_metric(
        self,
        df: pd.DataFrame,
        metric: str,
        unit: str,
    ) -> tuple[dict[str, Any] | None, str | None]:
        """Forecast a single metric using linear regression.

        Handles edge cases including constant series, NaN-heavy data,
        and tracks constraints applied to predictions.

        Args:
            df: Weekly metrics DataFrame.
            metric: Metric name (pr_throughput, cycle_time_minutes, etc.)
            unit: Unit for the metric.

        Returns:
            Tuple of (forecast dict or None, reason_code or None).
        """
        # Map metric to column
        column_map = {
            "pr_throughput": "pr_count",
            "cycle_time_minutes": "cycle_time_p50",
        }

        column = column_map.get(metric)
        if column not in df.columns:
            return None, None

        # Get raw values
        y_values = df[column].values.astype(float)

        # Filter to finite values first
        finite_mask = np.isfinite(y_values)
        finite_count = int(np.sum(finite_mask))

        if finite_count < MIN_WEEKS_REQUIRED:
            logger.warning(
                f"Insufficient finite data for {metric} forecast "
                f"(need >= {MIN_WEEKS_REQUIRED} weeks, have {finite_count})"
            )
            return None, REASON_ALL_NAN if finite_count == 0 else REASON_TOO_FEW_WEEKS

        # Check for constant series before regression
        # Uses np.ptp (peak-to-peak range) - returns 0 for constant series
        finite_values: np.ndarray = np.asarray(y_values[finite_mask])
        if detect_constant_series(finite_values):
            # Return constant forecast with zero confidence band
            constant_value = round(float(finite_values[0]), 2)
            return self._build_constant_forecast(
                metric, unit, constant_value
            ), REASON_CONSTANT_SERIES

        # Apply safe outlier clipping with status tracking
        # Ensure y_values is a plain ndarray for safe_clip_outliers
        reason_code: str | None = None
        y_values_arr: np.ndarray = np.asarray(y_values)
        y_values_arr, clip_reason, was_clipped = safe_clip_outliers(y_values_arr)
        if clip_reason == REASON_STATS_UNDEFINED:
            # Log but continue - we'll try regression anyway
            logger.info(f"Stats undefined for {metric} outlier clipping, skipping clip")
            reason_code = REASON_STATS_UNDEFINED

        # Filter to finite values after clipping
        valid_mask = np.isfinite(y_values_arr)
        y_final: np.ndarray = np.asarray(y_values_arr[valid_mask])

        if len(y_final) < MIN_WEEKS_REQUIRED:
            logger.warning(
                f"Insufficient data for {metric} forecast after filtering "
                f"(need >= {MIN_WEEKS_REQUIRED} weeks, have {len(y_final)})"
            )
            return None, REASON_TOO_FEW_WEEKS

        # Perform linear regression
        x_values = np.arange(len(y_final))
        coeffs = np.polyfit(x_values, y_final, 1)  # slope, intercept

        # Calculate residual standard error for confidence bands
        predicted_historical = np.polyval(coeffs, x_values)
        residuals = y_final - predicted_historical
        residual_se = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else 0.0

        # Widen confidence bands for low_confidence data
        confidence_multiplier = 1.96  # 95% confidence
        if self._data_quality and self._data_quality.status == "low_confidence":
            confidence_multiplier = 2.58  # ~99% confidence for low data

        # Generate future predictions
        horizon = self._calculate_horizon()
        today = date.today()
        next_monday = today + timedelta(days=(7 - today.weekday()) % 7)
        if today.weekday() == 0:
            next_monday = today

        values: list[dict[str, Any]] = []
        any_floor_applied = False

        for i in range(horizon):
            future_x = len(y_final) + i
            predicted = float(np.polyval(coeffs, future_x))
            margin = confidence_multiplier * residual_se

            period_start = next_monday + timedelta(weeks=i)
            period_start = align_to_monday(period_start)

            # Track constraints applied to this prediction
            constraints_applied: list[str] = []

            # Floor negative predictions to zero and track constraint
            final_predicted = predicted
            final_lower = predicted - margin
            final_upper = predicted + margin

            if final_predicted < 0:
                final_predicted = 0.0
                constraints_applied.append(CONSTRAINT_FLOOR_ZERO)
                any_floor_applied = True

            if final_lower < 0:
                final_lower = 0.0
                if CONSTRAINT_FLOOR_ZERO not in constraints_applied:
                    constraints_applied.append(CONSTRAINT_FLOOR_ZERO)
                    any_floor_applied = True

            # Ensure upper bound is finite and reasonable
            if not np.isfinite(final_upper):
                final_upper = max(
                    final_predicted * 2, final_predicted + DEFAULT_UPPER_BOUND_MARGIN
                )
            # Cap upper bound to prevent unreasonable values (max 10x predicted or +1000)
            max_reasonable_upper = max(final_predicted * 10, final_predicted + 1000)
            final_upper = min(final_upper, max_reasonable_upper)

            values.append(
                {
                    "period_start": period_start.isoformat(),
                    "predicted": round(final_predicted, 2),
                    "lower_bound": round(final_lower, 2),
                    "upper_bound": round(final_upper, 2),
                    "constraints_applied": constraints_applied,
                }
            )

        # Update reason code if floor was applied and no other reason set
        if any_floor_applied and reason_code is None:
            reason_code = REASON_FLOOR_APPLIED

        return {
            "metric": metric,
            "unit": unit,
            "horizon_weeks": horizon,
            "values": values,
        }, reason_code

    def _build_constant_forecast(
        self, metric: str, unit: str, constant_value: float
    ) -> dict[str, Any]:
        """Build a forecast for constant (zero-variance) series.

        For constant series, predicted = lower_bound = upper_bound = constant value.
        No confidence band needed since there's no variance.

        Args:
            metric: Metric name.
            unit: Unit for the metric.
            constant_value: The constant value to forecast.

        Returns:
            Forecast dict with identical predicted/lower/upper values.
        """
        horizon = self._calculate_horizon()
        today = date.today()
        next_monday = today + timedelta(days=(7 - today.weekday()) % 7)
        if today.weekday() == 0:
            next_monday = today

        values: list[dict[str, Any]] = []
        for i in range(horizon):
            period_start = next_monday + timedelta(weeks=i)
            period_start = align_to_monday(period_start)

            values.append(
                {
                    "period_start": period_start.isoformat(),
                    "predicted": constant_value,
                    "lower_bound": constant_value,
                    "upper_bound": constant_value,
                    "constraints_applied": [],
                }
            )

        return {
            "metric": metric,
            "unit": unit,
            "horizon_weeks": horizon,
            "values": values,
        }

    def _calculate_horizon(self) -> int:
        """Calculate appropriate forecast horizon based on data quality.

        Returns:
            Number of weeks to forecast.
        """
        if self._data_quality is None:
            return HORIZON_WEEKS

        if self._data_quality.status == "low_confidence":
            # Shorter horizon for low confidence
            return min(HORIZON_WEEKS, 2)

        return HORIZON_WEEKS

    def _write_predictions(
        self,
        forecasts: list[dict[str, Any]],
        data_quality: str = "normal",
        status: str = STATUS_OK,
        reason_code: str | None = None,
    ) -> bool:
        """Write predictions to trends.json with deterministic formatting.

        Output is fully deterministic for golden-file testing:
        - Forecasts sorted alphabetically by metric name
        - All floats rounded to 2 decimal places
        - JSON keys sorted alphabetically

        Args:
            forecasts: List of forecast dicts.
            data_quality: Data quality status for manifest.
            status: Forecast generation status (ok, insufficient_data, etc.)
            reason_code: Machine-readable reason code or None.

        Returns:
            True if written successfully.
        """
        predictions_dir = self.output_dir / "predictions"
        predictions_dir.mkdir(parents=True, exist_ok=True)

        # Sort forecasts alphabetically by metric name for deterministic output
        sorted_forecasts = sorted(forecasts, key=lambda f: f.get("metric", ""))

        # Ensure all floats are rounded to 2 decimal places
        for forecast in sorted_forecasts:
            if "values" in forecast:
                for value in forecast["values"]:
                    for key in ("predicted", "lower_bound", "upper_bound"):
                        if key in value and isinstance(value[key], (int, float)):
                            value[key] = round(float(value[key]), 2)

        predictions = {
            "schema_version": PREDICTIONS_SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "is_stub": False,
            "generated_by": GENERATOR_ID,
            "forecaster": "linear",
            "data_quality": data_quality,
            "status": status,
            "reason_code": reason_code,
            "forecasts": sorted_forecasts,
        }

        file_path = predictions_dir / "trends.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(predictions, f, indent=2, sort_keys=True, ensure_ascii=False)

        logger.info(
            f"Generated predictions/trends.json with {len(forecasts)} metrics "
            f"(forecaster: linear, quality: {data_quality}, status: {status})"
        )
        return True
