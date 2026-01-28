from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pandas as pd

from .date_utils import align_to_monday

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager

logger = logging.getLogger(__name__)

# Schema version (locked)
PREDICTIONS_SCHEMA_VERSION = 1
GENERATOR_ID = "prophet-v1.0"
HORIZON_WEEKS = 4

# Metric definitions
# Note: review_time_minutes removed - it used cycle_time as misleading proxy
METRICS = [
    ("pr_throughput", "count"),
    ("cycle_time_minutes", "minutes"),
]


@dataclass
class ForecastValue:
    """Single forecast value for a period."""

    period_start: str  # YYYY-MM-DD (Monday-aligned)
    predicted: float
    lower_bound: float
    upper_bound: float


@dataclass
class MetricForecast:
    """Forecast for a single metric."""

    metric: str
    unit: str
    horizon_weeks: int
    values: list[dict[str, Any]]


class ProphetForecaster:
    """Generate Prophet-based trend forecasts.

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
        """Initialize the forecaster.

        Args:
            db: Database manager with PR data.
            output_dir: Directory for output files.
        """
        self.db = db
        self.output_dir = output_dir

    def generate(self) -> bool:
        """Generate predictions and write to trends.json.

        Returns:
            True if file was written successfully, False otherwise.

        Behavior:
        - No data available → write empty forecasts (valid schema, tab shows "empty state")
        - Prophet fit error → don't write file (tab stays disabled)
        """
        start_time = time.perf_counter()

        # Get weekly metrics from database
        df = self._get_weekly_metrics()

        if df.empty:
            # No data - write empty forecasts
            logger.info(
                "No PR data available for predictions - writing empty forecasts"
            )
            return self._write_predictions(forecasts=[])

        # Try to import prophet
        try:
            from prophet import Prophet
        except ImportError:
            logger.warning(
                "Predictions skipped: Prophet not installed. "
                "Install with: pip install -e '.[ml]' "
                "and ensure cmdstan/prophet prerequisites are met. "
                "See https://facebook.github.io/prophet/docs/installation.html"
            )
            return False

        forecasts: list[dict[str, Any]] = []

        for metric, unit in METRICS:
            try:
                forecast_data = self._forecast_metric(df, metric, unit, Prophet)
                if forecast_data:
                    forecasts.append(forecast_data)
            except Exception as e:
                logger.warning(f"Failed to forecast {metric}: {type(e).__name__}")
                # Continue with other metrics

        if not forecasts:
            # All metrics failed - don't write file
            logger.warning("All metric forecasts failed - not writing predictions file")
            return False

        elapsed = time.perf_counter() - start_time
        logger.info(f"Prophet forecasting completed in {elapsed:.2f}s")

        return self._write_predictions(forecasts)

    def _get_weekly_metrics(self) -> pd.DataFrame:
        """Get weekly metrics from database.

        Returns:
            DataFrame with columns: week_start, pr_count, cycle_time_p50, review_time_p50
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

        # Rename for Prophet (ds = date, y = value)
        weekly["ds"] = pd.to_datetime(weekly["week_start"])

        return weekly

    def _forecast_metric(
        self,
        df: pd.DataFrame,
        metric: str,
        unit: str,
        prophet_cls: type,
    ) -> dict[str, Any] | None:
        """Forecast a single metric using Prophet.

        Args:
            df: Weekly metrics DataFrame.
            metric: Metric name (pr_throughput, cycle_time_minutes, etc.)
            unit: Unit for the metric.
            prophet_cls: Prophet class (passed to avoid re-importing).

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

        # Prepare Prophet DataFrame
        prophet_df = df[["ds", column]].copy()
        prophet_df = prophet_df.rename(columns={column: "y"})
        prophet_df = prophet_df.dropna()

        if len(prophet_df) < 2:
            logger.warning(f"Insufficient data for {metric} forecast (need >= 2 weeks)")
            return None

        # Fit Prophet model
        model = prophet_cls(
            yearly_seasonality=False,
            weekly_seasonality=False,
            daily_seasonality=False,
        )
        model.fit(prophet_df)

        # Generate future dataframe (next HORIZON_WEEKS weeks, Monday-aligned)
        today = date.today()
        next_monday = today + timedelta(days=(7 - today.weekday()) % 7)
        if next_monday == today and today.weekday() != 0:
            next_monday = today + timedelta(days=7)
        # If today is Monday, start from today
        if today.weekday() == 0:
            next_monday = today

        future_dates = [next_monday + timedelta(weeks=i) for i in range(HORIZON_WEEKS)]
        future_df = pd.DataFrame({"ds": pd.to_datetime(future_dates)})

        # Predict
        forecast = model.predict(future_df)

        # Build values
        values: list[dict[str, Any]] = []
        for _, row in forecast.iterrows():
            period_start = pd.Timestamp(row["ds"]).date()

            # Ensure Monday-aligned using utility
            period_start = align_to_monday(period_start)

            values.append(
                {
                    "period_start": period_start.isoformat(),
                    "predicted": round(float(row["yhat"]), 2),
                    "lower_bound": max(0, round(float(row["yhat_lower"]), 2)),
                    "upper_bound": round(float(row["yhat_upper"]), 2),
                }
            )

        return {
            "metric": metric,
            "unit": unit,
            "horizon_weeks": HORIZON_WEEKS,
            "values": values,
        }

    def _write_predictions(self, forecasts: list[dict[str, Any]]) -> bool:
        """Write predictions to trends.json.

        Args:
            forecasts: List of forecast dicts.

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
            "forecasts": forecasts,
        }

        file_path = predictions_dir / "trends.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(predictions, f, indent=2, sort_keys=True)

        logger.info(f"Generated predictions/trends.json with {len(forecasts)} metrics")
        return True
