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


def clip_outliers(
    values: np.ndarray, std_threshold: float = OUTLIER_STD_THRESHOLD
) -> np.ndarray:
    """Clip outliers beyond N standard deviations from mean.

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

    return np.clip(values, lower_bound, upper_bound)


class FallbackForecaster:
    """Generate linear regression-based trend forecasts.

    Zero-config fallback when Prophet is not installed (FR-001).
    Reads weekly rollup data from SQLite and produces forecasts for:
    - PR throughput (count per week)
    - Cycle time (p50 in minutes)
    - Review time (p50 in minutes, if available)
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

    @property
    def data_quality(self) -> DataQualityAssessment | None:
        """Get the data quality assessment from the last generate() call."""
        return self._data_quality

    def generate(self) -> bool:
        """Generate predictions and write to trends.json.

        Returns:
            True if file was written successfully, False otherwise.

        Behavior:
        - No data available → write empty forecasts with insufficient status
        - Insufficient data (<4 weeks) → write empty forecasts with status
        - Low data (4-7 weeks) → write forecasts with low_confidence status
        - Normal data (8+ weeks) → write forecasts with normal status
        """
        start_time = time.perf_counter()

        # Get weekly metrics from database
        df = self._get_weekly_metrics()

        # Assess data quality
        weeks_available = len(df) if not df.empty else 0
        self._data_quality = assess_data_quality(weeks_available)

        if df.empty or self._data_quality.status == "insufficient":
            logger.info(
                f"Insufficient data for predictions - {self._data_quality.message}"
            )
            return self._write_predictions(
                forecasts=[],
                data_quality=self._data_quality.status,
            )

        forecasts: list[dict[str, Any]] = []

        for metric, unit in METRICS:
            try:
                forecast_data = self._forecast_metric(df, metric, unit)
                if forecast_data:
                    forecasts.append(forecast_data)
            except Exception as e:
                logger.warning(f"Failed to forecast {metric}: {type(e).__name__}: {e}")
                # Continue with other metrics

        if not forecasts:
            # All metrics failed - still write file with empty forecasts
            logger.warning("All metric forecasts failed - writing empty forecasts")
            return self._write_predictions(
                forecasts=[],
                data_quality=self._data_quality.status,
            )

        elapsed = time.perf_counter() - start_time
        logger.info(
            f"Linear forecasting completed in {elapsed:.2f}s "
            f"(data quality: {self._data_quality.status})"
        )

        return self._write_predictions(
            forecasts=forecasts,
            data_quality=self._data_quality.status,
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
    ) -> dict[str, Any] | None:
        """Forecast a single metric using linear regression.

        Args:
            df: Weekly metrics DataFrame.
            metric: Metric name (pr_throughput, cycle_time_minutes, etc.)
            unit: Unit for the metric.

        Returns:
            Forecast dict or None if failed.
        """
        # Map metric to column
        column_map = {
            "pr_throughput": "pr_count",
            "cycle_time_minutes": "cycle_time_p50",
        }

        column = column_map.get(metric)
        if column not in df.columns:
            return None

        # Get values and apply outlier clipping
        y_values = df[column].values.astype(float)
        y_values = clip_outliers(y_values)

        # Remove NaN values
        valid_mask = ~np.isnan(y_values)
        y_values = y_values[valid_mask]

        if len(y_values) < MIN_WEEKS_REQUIRED:
            logger.warning(
                f"Insufficient data for {metric} forecast "
                f"(need >= {MIN_WEEKS_REQUIRED} weeks, have {len(y_values)})"
            )
            return None

        # Perform linear regression
        x_values = np.arange(len(y_values))
        coeffs = np.polyfit(x_values, y_values, 1)  # slope, intercept

        # Calculate residual standard error for confidence bands
        predicted_historical = np.polyval(coeffs, x_values)
        residuals = y_values - predicted_historical
        residual_se = np.std(residuals, ddof=1) if len(residuals) > 1 else 0

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
        for i in range(horizon):
            future_x = len(y_values) + i
            predicted = float(np.polyval(coeffs, future_x))
            margin = confidence_multiplier * residual_se

            period_start = next_monday + timedelta(weeks=i)
            period_start = align_to_monday(period_start)

            values.append(
                {
                    "period_start": period_start.isoformat(),
                    "predicted": round(max(0, predicted), 2),
                    "lower_bound": round(max(0, predicted - margin), 2),
                    "upper_bound": round(predicted + margin, 2),
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
    ) -> bool:
        """Write predictions to trends.json.

        Args:
            forecasts: List of forecast dicts.
            data_quality: Data quality status for manifest.

        Returns:
            True if written successfully.
        """
        predictions_dir = self.output_dir / "predictions"
        predictions_dir.mkdir(parents=True, exist_ok=True)

        predictions = {
            "schema_version": PREDICTIONS_SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "is_stub": False,
            "generated_by": GENERATOR_ID,
            "forecaster": "linear",
            "data_quality": data_quality,
            "forecasts": forecasts,
        }

        file_path = predictions_dir / "trends.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(predictions, f, indent=2, sort_keys=True)

        logger.info(
            f"Generated predictions/trends.json with {len(forecasts)} metrics "
            f"(forecaster: linear, quality: {data_quality})"
        )
        return True
