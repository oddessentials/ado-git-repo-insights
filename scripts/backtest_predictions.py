"""Walk-forward backtest harness for the predictions feature.

For each Monday cutoff in [min-history, total_weeks - horizon] inclusive:
  - Truncate weekly history to weeks before the cutoff.
  - Run two forecasters in parallel:
      * `linear`      - the production FallbackForecaster (linear regression
                        with 3-sigma outlier clip + 1.96-sigma 95% bands)
      * `persistence` - naive baseline: predicted = last observed value
                        before the cutoff, replicated across the horizon;
                        emits NO confidence-band keys, so coverage_rate
                        is None (band semantics are deliberately omitted
                        rather than collapsing to predicted=lower=upper,
                        which would make `coverage` a near-zero
                        exact-match probability and mislead).
  - Compare each forecast value against the observed value for that week
    from the full dataset.

Reports per (forecaster, metric, horizon):
  n, MAE, RMSE, signed bias, MAPE%, in-band coverage rate (None for
  persistence - it carries no band).

Boundary-week handling: the most recent observed week is dropped from
the *scoring targets* only - never from training history. Data extracts
are typically truncated mid-week, so the final week's observed metrics
are not directly comparable to weekly forecasts. The exclusion is logged
with the dropped week's PR count and the trailing-12-week median so the
choice is auditable.

The harness is observational. It does not gate CI; it produces the
measurement record any future model variant must beat. The acceptance
question is sharp: does `linear` beat `persistence` per (metric,
horizon)? If not, predictions should be off by default until the
forecast contract improves.

Usage:
  .venv/Scripts/python.exe scripts/backtest_predictions.py \\
      --db samples/ado-insights-db/ado-insights.sqlite \\
      --output .tmp/predictions-backtest

Outputs:
  <output>/results.json                          machine-readable results
  <output>/runs/<cutoff>/predictions/trends.json per-cutoff linear forecast
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import statistics
import sys
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import NotRequired, TypedDict, cast
from unittest.mock import patch

import pandas as pd

from ado_git_repo_insights.ml import fallback_forecaster as fb_module
from ado_git_repo_insights.ml.fallback_forecaster import (
    HORIZON_WEEKS,
    MIN_WEEKS_REQUIRED,
    FallbackForecaster,
)
from ado_git_repo_insights.persistence.database import DatabaseManager


class HarnessForecastValue(TypedDict):
    """One forecast value (period + predicted [+ optional band]).

    Linear forecasts populate lower_bound/upper_bound (and possibly
    constraints_applied); persistence omits all band keys.
    """

    period_start: str
    predicted: float
    lower_bound: NotRequired[float]
    upper_bound: NotRequired[float]
    constraints_applied: NotRequired[list[str]]


class HarnessMetricForecast(TypedDict):
    """All forecast values for one metric at one cutoff."""

    metric: str
    values: list[HarnessForecastValue]


class LinearTrendsJson(TypedDict):
    """Shape of the trends.json file written by FallbackForecaster.

    Used for the cast at the json.loads boundary so downstream field
    access is type-checked.
    """

    schema_version: int
    generated_at: str
    is_stub: bool
    generated_by: str
    forecaster: str
    data_quality: str
    status: str
    reason_code: str | None
    forecasts: list[HarnessMetricForecast]


class CutoffResult(TypedDict):
    """One forecaster's output for one cutoff (in-memory shape)."""

    forecaster: str
    cutoff_week_start: str
    history_weeks: int
    data_quality: str | None
    status: str | None
    reason_code: str | None
    forecasts: list[HarnessMetricForecast]


class CutoffMeta(TypedDict):
    """Cutoff-level metadata captured for the results.json `cutoffs` array."""

    forecaster: str
    cutoff_week_start: str
    history_weeks: int
    data_quality: str | None
    status: str | None
    reason_code: str | None


class EvaluationRow(TypedDict):
    """One forecast value compared against its observed actual."""

    forecaster: str
    cutoff: str
    metric: str
    horizon: int
    period_start: str
    predicted: float
    lower_bound: float | None
    upper_bound: float | None
    data_quality: str | None
    actual: float | None
    signed_error: float | None
    abs_error: float | None
    pct_error: float | None
    in_band: bool | None


class SummaryRow(TypedDict):
    """One aggregated summary row.

    `horizon` is `int` for per-horizon summaries and the literal string
    `"all"` for the across-horizons summary.
    """

    forecaster: str
    metric: str
    horizon: int | str
    n: int
    mae: float
    rmse: float
    bias: float
    mape_pct: float | None
    coverage_rate: float | None


class BoundaryDescription(TypedDict):
    """Auditable description of the boundary week excluded from scoring."""

    boundary_week_start: str
    boundary_pr_count: int
    trailing_n: int
    trailing_median_pr_count: float | None


def load_full_weekly(db_path: Path) -> pd.DataFrame:
    """Run the production weekly aggregation against the full DB once.

    Reuses FallbackForecaster._get_weekly_metrics so the harness sees
    exactly the same weekly shape the production forecaster would,
    avoiding a drift surface between the harness SQL and production SQL.
    """
    db = DatabaseManager(db_path)
    db.connect()
    try:
        forecaster = FallbackForecaster(db=db, output_dir=Path("."))
        return forecaster._get_weekly_metrics()
    finally:
        db.close()


class HistorySlicedForecaster(FallbackForecaster):
    """FallbackForecaster that returns a pre-set weekly DataFrame.

    Bypasses only the SQL fetch so each cutoff can replay a prefix of
    the same observed weekly series without round-tripping a 400 MB
    SQLite per cutoff. Every other production code path (data-quality
    assessment, outlier clipping, regression, status codes, file
    writing) runs unchanged.
    """

    def __init__(self, history: pd.DataFrame, output_dir: Path) -> None:
        # Parent stores db on self but only _get_weekly_metrics reads it,
        # and we override that. Casting None lets us skip the DB round-trip.
        super().__init__(db=cast(DatabaseManager, None), output_dir=output_dir)
        self._history = history.copy()

    def _get_weekly_metrics(self) -> pd.DataFrame:
        return self._history


def _coerce_week_start(value: object) -> date:
    """Normalize a week_start cell to a Python date regardless of pandas dtype.

    The production aggregation produces ``date`` objects via
    ``date.fromisocalendar`` (see FallbackForecaster._get_weekly_metrics).
    The Timestamp/datetime branches are defensive: if a future pandas
    upgrade widens the column dtype, this surfaces a clear TypeError
    rather than a silent cast.
    """
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, pd.Timestamp):
        return value.date()
    raise TypeError(f"unexpected week_start cell type: {type(value).__name__}")


def _last_finite(series: pd.Series) -> float | None:
    """Return the last finite (non-NaN, non-inf) value in `series`, or None.

    Walks the series in reverse so the most recent finite observation
    wins. Used by persistence_forecast to anchor forecasts on a value
    that is actually a number — propagating NaN would corrupt downstream
    MAE/RMSE/MAPE and write non-standard `NaN` tokens to results.json.
    """
    for raw in reversed(series.tolist()):
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value):
            return value
    return None


def persistence_forecast(
    history: pd.DataFrame,
    cutoff_week_start: date,
    horizon: int,
) -> list[HarnessMetricForecast]:
    """Naive baseline: predicted_h = last finite observed value, for all horizons.

    Emits NO band keys. Persistence has no inherent confidence interval,
    so coverage is reported as None rather than collapsing the band to
    predicted=lower=upper (which would be a near-zero exact-match
    probability and mislead). Downstream aggregation treats missing
    band keys as "no coverage data."

    The anchor for each metric is the LAST FINITE value in that metric's
    column across `history`. Trailing NaN/inf values (possible when every
    PR in a week has a NULL `cycle_time_minutes`, so its `cycle_time_p50`
    aggregates to NaN) are walked past so persistence never emits NaN
    forecasts. NaN forecasts would propagate into MAE/RMSE/MAPE through
    compare_to_actuals/_summarize_group and would write non-standard
    `NaN` tokens to results.json. If no finite anchor exists in history
    for a given metric, that metric is skipped for this cutoff — the
    (forecaster=persistence, metric, h) summary buckets simply have no
    rows for this cutoff.

    Args:
        history: weekly DataFrame strictly before the cutoff (must
            contain at least one row).
        cutoff_week_start: Monday of the cutoff week (forecasts start here).
        horizon: number of weeks to forecast.

    Returns:
        List of {metric, values: [{period_start, predicted}, ...]} dicts.
        Shape matches the linear forecaster's `forecasts` array minus the
        two band keys; metrics with no finite anchor are omitted.
    """
    metric_columns = {
        "pr_throughput": "pr_count",
        "cycle_time_minutes": "cycle_time_p50",
    }
    forecasts: list[HarnessMetricForecast] = []
    for metric, column in metric_columns.items():
        anchor = _last_finite(history[column])
        if anchor is None:
            continue
        values: list[HarnessForecastValue] = []
        for h_idx in range(horizon):
            period_start = cutoff_week_start + timedelta(weeks=h_idx)
            values.append(
                {
                    "period_start": period_start.isoformat(),
                    "predicted": anchor,
                    # No lower_bound / upper_bound: persistence has no band.
                }
            )
        forecasts.append({"metric": metric, "values": values})
    return forecasts


def run_one_cutoff(
    full_weekly: pd.DataFrame,
    cutoff_idx: int,
    output_dir: Path,
) -> list[CutoffResult] | None:
    """Run all forecasters as if today were the cutoff Monday.

    Persistence is run with the same horizon linear actually emitted at
    this cutoff (4 for `normal` data quality, 2 for `low_confidence`),
    so every (metric, horizon) row in the side-by-side comparison has
    matched linear+persistence pairs. If linear emits no forecasts at
    all (e.g., insufficient_data), persistence is skipped — there is
    nothing to compare against and a persistence-only row would mislead
    the aggregate table.

    Returns:
        List of per-forecaster result dicts. None when the cutoff has
        insufficient history. Empty linear forecasts (status =
        insufficient_data) are recorded for diagnostic completeness;
        persistence is omitted in that case.
    """
    history = full_weekly.iloc[:cutoff_idx]
    if len(history) < MIN_WEEKS_REQUIRED:
        return None

    cutoff_week_start = _coerce_week_start(full_weekly.iloc[cutoff_idx]["week_start"])
    cutoff_dir = output_dir / cutoff_week_start.isoformat()
    cutoff_dir.mkdir(parents=True, exist_ok=True)

    results: list[CutoffResult] = []

    # Linear: production FallbackForecaster path. Pin date.today() to the
    # cutoff so period_start values land on the weeks we want to compare.
    linear = HistorySlicedForecaster(history=history, output_dir=cutoff_dir)
    with patch.object(fb_module, "date") as mocked_date:
        mocked_date.today.return_value = cutoff_week_start
        mocked_date.fromisocalendar = date.fromisocalendar
        wrote = linear.generate()

    linear_emitted_horizon = 0
    if wrote:
        trends_path = cutoff_dir / "predictions" / "trends.json"
        if trends_path.exists():
            trends = cast(
                LinearTrendsJson,
                json.loads(trends_path.read_text(encoding="utf-8")),
            )
            linear_forecasts = trends["forecasts"]
            results.append(
                {
                    "forecaster": "linear",
                    "cutoff_week_start": cutoff_week_start.isoformat(),
                    "history_weeks": len(history),
                    "data_quality": trends["data_quality"],
                    "status": trends["status"],
                    "reason_code": trends["reason_code"],
                    "forecasts": linear_forecasts,
                }
            )
            if linear_forecasts:
                # All metrics emit the same horizon (FallbackForecaster
                # uses one _calculate_horizon() call per cutoff), so the
                # first metric's count is authoritative.
                linear_emitted_horizon = len(linear_forecasts[0]["values"])

    # Persistence: only run when linear emitted forecasts, and align to
    # linear's actual emitted horizon so every (metric, horizon) bucket
    # has paired linear+persistence rows.
    if linear_emitted_horizon > 0:
        results.append(
            {
                "forecaster": "persistence",
                "cutoff_week_start": cutoff_week_start.isoformat(),
                "history_weeks": len(history),
                "data_quality": None,
                "status": "ok",
                "reason_code": None,
                "forecasts": persistence_forecast(
                    history, cutoff_week_start, linear_emitted_horizon
                ),
            }
        )

    return results if results else None


def _actuals_index(
    full_weekly: pd.DataFrame,
    exclude_boundary_week: bool = True,
) -> dict[date, dict[str, float]]:
    """Build a {week_start: {metric: observed}} lookup.

    Args:
        full_weekly: full observed weekly aggregation (must be sorted by
            week_start).
        exclude_boundary_week: when True (default), drop the LAST observed
            week from the lookup so any forecast pointing to it gets
            actual=None and is excluded from scoring. Boundary weeks are
            typically partial (extraction cut mid-week) and not directly
            comparable to weekly forecasts.

    Note:
        This affects scoring targets only. Training history slicing is
        unchanged - boundary weeks remain available to forecasters that
        run cutoffs late enough to include them.
    """
    rows = full_weekly.iloc[:-1] if exclude_boundary_week else full_weekly
    index: dict[date, dict[str, float]] = {}
    for _, row in rows.iterrows():
        week = _coerce_week_start(row["week_start"])
        index[week] = {
            "pr_throughput": float(row["pr_count"]),
            "cycle_time_minutes": float(row["cycle_time_p50"]),
        }
    return index


def _describe_boundary_week(
    full_weekly: pd.DataFrame,
    trailing_n: int = 12,
) -> BoundaryDescription:
    """Capture the boundary week's PR count + trailing median for audit."""
    boundary_row = full_weekly.iloc[-1]
    boundary_week = _coerce_week_start(boundary_row["week_start"])
    boundary_count = int(boundary_row["pr_count"])
    trailing = full_weekly.iloc[-(trailing_n + 1) : -1]  # exclude boundary itself
    trailing_counts = [int(c) for c in trailing["pr_count"].tolist()]
    median_trailing: float | None = (
        float(statistics.median(trailing_counts)) if trailing_counts else None
    )
    return {
        "boundary_week_start": boundary_week.isoformat(),
        "boundary_pr_count": boundary_count,
        "trailing_n": trailing_n,
        "trailing_median_pr_count": median_trailing,
    }


def compare_to_actuals(
    cutoff_result: CutoffResult,
    actuals: dict[date, dict[str, float]],
) -> list[EvaluationRow]:
    """Compute per-horizon error rows for one cutoff result."""
    forecaster_label = cutoff_result["forecaster"]
    rows: list[EvaluationRow] = []
    for forecast in cutoff_result["forecasts"]:
        metric = forecast["metric"]
        for h_idx, value in enumerate(forecast["values"]):
            week = date.fromisoformat(value["period_start"])
            actual = actuals.get(week, {}).get(metric)
            lower = value.get("lower_bound")
            upper = value.get("upper_bound")
            row: EvaluationRow = {
                "forecaster": forecaster_label,
                "cutoff": cutoff_result["cutoff_week_start"],
                "metric": metric,
                "horizon": h_idx + 1,
                "period_start": value["period_start"],
                "predicted": float(value["predicted"]),
                "lower_bound": lower,
                "upper_bound": upper,
                "data_quality": cutoff_result["data_quality"],
                "actual": None,
                "signed_error": None,
                "abs_error": None,
                "pct_error": None,
                "in_band": None,
            }
            if actual is None or math.isnan(actual):
                rows.append(row)
                continue
            predicted = row["predicted"]
            abs_err = abs(predicted - actual)
            row["actual"] = actual
            row["signed_error"] = predicted - actual
            row["abs_error"] = abs_err
            row["pct_error"] = abs_err / actual * 100.0 if actual != 0 else None
            if lower is not None and upper is not None:
                row["in_band"] = lower <= actual <= upper
            rows.append(row)
    return rows


def aggregate_metrics(
    rows: list[EvaluationRow],
) -> list[SummaryRow]:
    """Compute per-(forecaster, metric, horizon) error summary."""
    grouped: dict[tuple[str, str, int], list[EvaluationRow]] = defaultdict(list)
    for row in rows:
        if row["actual"] is None:
            continue
        grouped[(row["forecaster"], row["metric"], row["horizon"])].append(row)

    summary: list[SummaryRow] = []
    for (forecaster, metric, horizon), group in sorted(grouped.items()):
        summary.append(_summarize_group(forecaster, metric, horizon, group))
    return summary


def aggregate_overall(
    rows: list[EvaluationRow],
) -> list[SummaryRow]:
    """Per-(forecaster, metric) summary across all horizons combined."""
    grouped: dict[tuple[str, str], list[EvaluationRow]] = defaultdict(list)
    for row in rows:
        if row["actual"] is None:
            continue
        grouped[(row["forecaster"], row["metric"])].append(row)

    summary: list[SummaryRow] = []
    for (forecaster, metric), group in sorted(grouped.items()):
        summary.append(_summarize_group(forecaster, metric, "all", group))
    return summary


def _summarize_group(
    forecaster: str,
    metric: str,
    horizon: int | str,
    group: list[EvaluationRow],
) -> SummaryRow:
    """Compute MAE/RMSE/bias/MAPE/coverage for one group of evaluation rows.

    Caller filters out rows with actual=None before grouping, so abs_error
    and signed_error are always populated here.
    """
    abs_errs = [g["abs_error"] for g in group if g["abs_error"] is not None]
    sq_errs = [e * e for e in abs_errs]
    signed = [g["signed_error"] for g in group if g["signed_error"] is not None]
    pct = [g["pct_error"] for g in group if g["pct_error"] is not None]
    in_band_vals = [g["in_band"] for g in group if g["in_band"] is not None]
    coverage_rate: float | None = (
        sum(in_band_vals) / len(in_band_vals) if in_band_vals else None
    )
    return {
        "forecaster": forecaster,
        "metric": metric,
        "horizon": horizon,
        "n": len(group),
        "mae": statistics.mean(abs_errs),
        "rmse": math.sqrt(statistics.mean(sq_errs)),
        "bias": statistics.mean(signed),
        "mape_pct": statistics.mean(pct) if pct else None,
        "coverage_rate": coverage_rate,
    }


def _format_summary_table(summary: list[SummaryRow]) -> str:
    fmt = "{:<12} {:<22} {:>5} {:>6} {:>10} {:>10} {:>10} {:>9} {:>10}"
    lines: list[str] = [
        fmt.format(
            "forecaster",
            "metric",
            "h",
            "n",
            "MAE",
            "RMSE",
            "bias",
            "MAPE%",
            "coverage",
        ),
        "-" * 102,
    ]
    # Sort by (metric, horizon, forecaster) so linear/persistence rows for
    # the same (metric, horizon) are adjacent for direct comparison.
    sorted_rows = sorted(
        summary,
        key=lambda r: (r["metric"], str(r["horizon"]), r["forecaster"]),
    )
    for row in sorted_rows:
        mape = f"{row['mape_pct']:.1f}" if row["mape_pct"] is not None else "-"
        cov_rate = row["coverage_rate"]
        cov = f"{cov_rate * 100:.1f}%" if cov_rate is not None else "-"
        lines.append(
            fmt.format(
                row["forecaster"],
                row["metric"],
                str(row["horizon"]),
                row["n"],
                f"{row['mae']:.2f}",
                f"{row['rmse']:.2f}",
                f"{row['bias']:+.2f}",
                mape,
                cov,
            )
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("samples/ado-insights-db/ado-insights.sqlite"),
        help="Source SQLite path.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".tmp/predictions-backtest"),
        help="Output directory.",
    )
    parser.add_argument(
        "--min-history",
        type=int,
        default=8,
        help=(
            "Skip cutoffs with fewer than this many history weeks. "
            "Default 8 = 'normal' data-quality threshold."
        ),
    )
    parser.add_argument(
        "--cutoff-stride",
        type=int,
        default=1,
        help="Evaluate every Nth cutoff (1 = every week).",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")

    args.output.mkdir(parents=True, exist_ok=True)

    print(f"Loading full weekly aggregation from {args.db}...", flush=True)
    full_weekly = load_full_weekly(args.db).reset_index(drop=True)
    n = len(full_weekly)
    if n == 0:
        print("No weekly data found in DB.", file=sys.stderr)
        return 1

    first_week = _coerce_week_start(full_weekly.iloc[0]["week_start"])
    last_week = _coerce_week_start(full_weekly.iloc[-1]["week_start"])
    print(f"  {n} weeks, range {first_week} -> {last_week}")

    boundary = _describe_boundary_week(full_weekly)
    median_value = boundary["trailing_median_pr_count"]
    median_str = f"{median_value:.1f}" if median_value is not None else "n/a"
    print(
        "Boundary week dropped from scoring targets: "
        f"{boundary['boundary_week_start']} "
        f"({boundary['boundary_pr_count']} PRs vs trailing-{boundary['trailing_n']} "
        f"median {median_str})."
    )
    print(
        "  History slicing is unchanged - boundary week excluded only from "
        "actuals lookup, not from training data."
    )

    first_cutoff = max(args.min_history, MIN_WEEKS_REQUIRED)
    # Use the production HORIZON_WEEKS so linear's longest possible
    # forecast still has actuals to compare against; persistence aligns
    # to linear's per-cutoff emitted horizon inside run_one_cutoff.
    last_cutoff = n - HORIZON_WEEKS
    if last_cutoff < first_cutoff:
        print(
            f"Insufficient data for backtesting: need first_cutoff "
            f"({first_cutoff}) <= last_cutoff ({last_cutoff}).",
            file=sys.stderr,
        )
        return 1

    cutoffs = list(range(first_cutoff, last_cutoff + 1, args.cutoff_stride))
    print(
        f"Running {len(cutoffs)} cutoffs (history = "
        f"{first_cutoff}..{last_cutoff} weeks, production horizon = "
        f"{HORIZON_WEEKS}) x 2 forecasters [linear, persistence]..."
    )

    runs_dir = args.output / "runs"
    actuals = _actuals_index(full_weekly, exclude_boundary_week=True)

    cutoff_meta: list[CutoffMeta] = []
    all_rows: list[EvaluationRow] = []
    skipped: list[int] = []

    for cutoff_idx in cutoffs:
        results = run_one_cutoff(full_weekly, cutoff_idx, runs_dir)
        if results is None:
            skipped.append(cutoff_idx)
            continue
        for result in results:
            cutoff_meta.append(
                {
                    "forecaster": result["forecaster"],
                    "cutoff_week_start": result["cutoff_week_start"],
                    "history_weeks": result["history_weeks"],
                    "data_quality": result["data_quality"],
                    "status": result["status"],
                    "reason_code": result["reason_code"],
                }
            )
            all_rows.extend(compare_to_actuals(result, actuals))

    summary = aggregate_metrics(all_rows) + aggregate_overall(all_rows)

    db_stat = args.db.stat()
    results_doc = {
        "run_metadata": {
            "db_path": str(args.db),
            "db_size_bytes": db_stat.st_size,
            "db_mtime": datetime.fromtimestamp(db_stat.st_mtime, UTC).isoformat(),
            "generated_at": datetime.now(UTC).isoformat(),
            "total_weeks": n,
            "first_observed_week": first_week.isoformat(),
            "last_observed_week": last_week.isoformat(),
            "min_history": args.min_history,
            "production_horizon_weeks": HORIZON_WEEKS,
            "cutoff_stride": args.cutoff_stride,
            "num_cutoffs_requested": len(cutoffs),
            "num_cutoffs_skipped": len(skipped),
            "forecasters": ["linear", "persistence"],
            "boundary_exclusion": boundary,
        },
        "summary": summary,
        "cutoffs": cutoff_meta,
        "per_evaluation": all_rows,
    }

    results_path = args.output / "results.json"
    results_path.write_text(
        json.dumps(results_doc, indent=2, sort_keys=True), encoding="utf-8"
    )

    cutoffs_per_forecaster = len(cutoff_meta) // 2 if cutoff_meta else 0
    print()
    print("=" * 102)
    print(
        f"Walk-forward backtest summary  ("
        f"{cutoffs_per_forecaster} cutoffs x 2 forecasters, "
        f"{len(skipped)} skipped)"
    )
    print("=" * 102)
    print(_format_summary_table(summary))
    print()
    print(f"Results written to {results_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
