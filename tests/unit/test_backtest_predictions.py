"""Unit tests for scripts/backtest_predictions.py.

Narrow coverage of the three measurement-infrastructure pieces added in
chore(predictions): add backtest persistence baseline:

1. Persistence prediction shape - the naive baseline returns last
   observed value for every horizon, with NO band keys (no
   lower_bound/upper_bound). This protects the documented invariant
   that persistence has no confidence interval and therefore reports
   coverage as None rather than collapsing the band.
2. Boundary-week exclusion - the most recent observed week is dropped
   from the actuals lookup, never from training history.
3. Summary aggregation by (forecaster, metric, horizon) - linear and
   persistence rows are tracked separately, and groups with no in_band
   data report coverage_rate = None.
"""

from __future__ import annotations

import importlib
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

# Load the harness via dotted package name, matching the runtime-import
# pattern used in test_check_ratchet_bump.py - keeps mypy from resolving
# the same module under both `backtest_predictions` (mypy_path) and
# `scripts.backtest_predictions` (dotted import).
harness = importlib.import_module("scripts.backtest_predictions")


def _make_weekly(rows: list[tuple[date, int, float]]) -> pd.DataFrame:
    """Build a weekly DataFrame matching FallbackForecaster._get_weekly_metrics."""
    return pd.DataFrame(
        [
            {
                "iso_year": d.isocalendar().year,
                "iso_week": d.isocalendar().week,
                "pr_count": count,
                "cycle_time_p50": cycle_p50,
                "week_start": d,
            }
            for d, count, cycle_p50 in rows
        ]
    )


class TestPersistenceForecast:
    """Concern 1: persistence prediction shape (and absence of band keys)."""

    def test_predicts_last_observed_value_with_no_band_keys(self) -> None:
        history = _make_weekly(
            [
                (date(2026, 1, 5), 100, 30.0),
                (date(2026, 1, 12), 120, 33.0),
                (date(2026, 1, 19), 150, 28.0),  # last observed
            ]
        )
        cutoff = date(2026, 1, 26)
        forecasts = harness.persistence_forecast(history, cutoff, horizon=4)

        # One forecast per metric.
        by_metric = {f["metric"]: f for f in forecasts}
        assert set(by_metric) == {"pr_throughput", "cycle_time_minutes"}

        throughput_values = by_metric["pr_throughput"]["values"]
        cycle_values = by_metric["cycle_time_minutes"]["values"]

        # Horizon length matches the request.
        assert len(throughput_values) == 4
        assert len(cycle_values) == 4

        # Every horizon predicts the LAST observed value (150 / 28.0).
        assert [v["predicted"] for v in throughput_values] == [150.0] * 4
        assert [v["predicted"] for v in cycle_values] == [28.0] * 4

        # Period_starts march forward by 1 week from the cutoff Monday.
        expected_periods = [
            "2026-01-26",
            "2026-02-02",
            "2026-02-09",
            "2026-02-16",
        ]
        assert [v["period_start"] for v in throughput_values] == expected_periods
        assert [v["period_start"] for v in cycle_values] == expected_periods

        # No band keys anywhere - persistence has no confidence interval,
        # so emitting predicted=lower=upper would mislead aggregation into
        # treating exact-match probability as "coverage."
        for forecast in forecasts:
            for value in forecast["values"]:
                assert "lower_bound" not in value
                assert "upper_bound" not in value


class TestActualsIndex:
    """Concern 2: boundary-week exclusion affects scoring targets only."""

    def test_excludes_boundary_week_by_default(self) -> None:
        weekly = _make_weekly(
            [
                (date(2026, 1, 5), 100, 30.0),
                (date(2026, 1, 12), 120, 33.0),
                (date(2026, 1, 19), 150, 28.0),
                (date(2026, 1, 26), 130, 31.0),
                (date(2026, 2, 2), 50, 25.0),  # boundary - typically partial
            ]
        )

        # Default exclude_boundary_week=True drops the last observed week.
        index_excl = harness._actuals_index(weekly)
        assert len(index_excl) == 4
        assert date(2026, 2, 2) not in index_excl
        assert date(2026, 1, 26) in index_excl  # second-to-last retained

        # Explicit False keeps the boundary week (escape hatch for
        # callers that have already trimmed partial weeks upstream).
        index_keep = harness._actuals_index(weekly, exclude_boundary_week=False)
        assert len(index_keep) == 5
        assert date(2026, 2, 2) in index_keep


class TestAggregateMetrics:
    """Concern 3: summary aggregation by (forecaster, metric, horizon)."""

    def test_groups_by_forecaster_metric_horizon(self) -> None:
        # Three distinct groups + one row with actual=None (must be skipped).
        # linear @ pr_throughput h=1: 3 rows, in_band T/T/F  -> coverage 2/3
        # linear @ pr_throughput h=2: 1 row, in_band T       -> coverage 1.0
        # persistence @ pr_throughput h=1: 2 rows, in_band None -> coverage None
        rows: list[dict[str, object]] = [
            {
                "forecaster": "linear",
                "metric": "pr_throughput",
                "horizon": 1,
                "actual": 100.0,
                "predicted": 110.0,
                "signed_error": 10.0,
                "abs_error": 10.0,
                "pct_error": 10.0,
                "in_band": True,
            },
            {
                "forecaster": "linear",
                "metric": "pr_throughput",
                "horizon": 1,
                "actual": 100.0,
                "predicted": 90.0,
                "signed_error": -10.0,
                "abs_error": 10.0,
                "pct_error": 10.0,
                "in_band": True,
            },
            {
                "forecaster": "linear",
                "metric": "pr_throughput",
                "horizon": 1,
                "actual": 100.0,
                "predicted": 200.0,
                "signed_error": 100.0,
                "abs_error": 100.0,
                "pct_error": 100.0,
                "in_band": False,
            },
            {
                "forecaster": "linear",
                "metric": "pr_throughput",
                "horizon": 2,
                "actual": 100.0,
                "predicted": 100.0,
                "signed_error": 0.0,
                "abs_error": 0.0,
                "pct_error": 0.0,
                "in_band": True,
            },
            {
                "forecaster": "persistence",
                "metric": "pr_throughput",
                "horizon": 1,
                "actual": 100.0,
                "predicted": 90.0,
                "signed_error": -10.0,
                "abs_error": 10.0,
                "pct_error": 10.0,
                "in_band": None,  # persistence carries no band semantics
            },
            {
                "forecaster": "persistence",
                "metric": "pr_throughput",
                "horizon": 1,
                "actual": 100.0,
                "predicted": 110.0,
                "signed_error": 10.0,
                "abs_error": 10.0,
                "pct_error": 10.0,
                "in_band": None,
            },
            # Skipped: actual=None means no scoring target.
            {
                "forecaster": "linear",
                "metric": "pr_throughput",
                "horizon": 1,
                "actual": None,
                "predicted": 100.0,
                "signed_error": None,
                "abs_error": None,
                "pct_error": None,
                "in_band": None,
            },
        ]

        summary = harness.aggregate_metrics(rows)
        assert len(summary) == 3, (
            "expected one summary row per (forecaster, metric, horizon) tuple "
            "with actual data"
        )
        keyed = {(s["forecaster"], s["metric"], s["horizon"]): s for s in summary}

        lin_h1 = keyed[("linear", "pr_throughput", 1)]
        assert lin_h1["n"] == 3
        assert lin_h1["coverage_rate"] == 2 / 3

        lin_h2 = keyed[("linear", "pr_throughput", 2)]
        assert lin_h2["n"] == 1
        assert lin_h2["coverage_rate"] == 1.0

        per_h1 = keyed[("persistence", "pr_throughput", 1)]
        assert per_h1["n"] == 2
        # No band keys -> coverage_rate is None, not zero or near-zero.
        assert per_h1["coverage_rate"] is None


class TestRunOneCutoffHorizonAlignment:
    """Persistence MUST emit the same horizon (and period_starts) as linear.

    Regression for: a configurable --horizon-weeks that diverged from
    FallbackForecaster's locked HORIZON_WEEKS would produce summary rows
    where one forecaster appears at a horizon the other did not, making
    the side-by-side comparison invalid.
    """

    def test_persistence_horizon_matches_linear_emitted_horizon(
        self, tmp_path: Path
    ) -> None:
        # 10 weeks of monotonically increasing data; cutoff_idx=8 leaves
        # an 8-week history (>= LOW_CONFIDENCE_THRESHOLD), so linear
        # produces a normal-quality forecast at the production
        # HORIZON_WEEKS.
        weekly = _make_weekly(
            [
                (date(2025, 12, 1) + timedelta(weeks=i), 100 + i, 30.0 + i * 0.5)
                for i in range(10)
            ]
        )

        results = harness.run_one_cutoff(weekly, cutoff_idx=8, output_dir=tmp_path)
        assert results is not None
        by_forecaster = {r["forecaster"]: r for r in results}
        assert set(by_forecaster) == {"linear", "persistence"}

        # Both forecasters emit the same metrics in the same order, and
        # within each forecaster every metric carries the same horizon.
        linear_horizons = {
            f["metric"]: len(f["values"]) for f in by_forecaster["linear"]["forecasts"]
        }
        persistence_horizons = {
            f["metric"]: len(f["values"])
            for f in by_forecaster["persistence"]["forecasts"]
        }
        assert linear_horizons == persistence_horizons, (
            "persistence horizon must mirror linear's emitted forecast count "
            "per metric, otherwise the side-by-side comparison is invalid"
        )

        # Period_starts must also align so each (metric, horizon) bucket
        # holds matched linear/persistence rows downstream.
        for metric in ("pr_throughput", "cycle_time_minutes"):
            linear_periods = next(
                f["values"]
                for f in by_forecaster["linear"]["forecasts"]
                if f["metric"] == metric
            )
            persistence_periods = next(
                f["values"]
                for f in by_forecaster["persistence"]["forecasts"]
                if f["metric"] == metric
            )
            assert [v["period_start"] for v in linear_periods] == [
                v["period_start"] for v in persistence_periods
            ]
