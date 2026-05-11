/**
 * Predictions Chart Edge-Case Tests (P2 guardrail)
 *
 * Tests production edge cases: undefined bounds (NaN bug), empty forecasts,
 * single values, and the forecast table with missing data.
 */

import {
  extractHistoricalData,
  renderDataQualityBanner,
  renderForecastChart,
  renderForecasterIndicator,
  renderForecastTable,
  renderPredictionsWithCharts,
  type RollupForChart,
} from "../../../ui/modules/charts/predictions";
import type {
  Forecast,
  ForecastValue,
  PredictionsRenderData,
} from "../../../ui/types";

function makeForecast(
  values: ForecastValue[],
  overrides: Partial<Forecast> = {},
): Forecast {
  return {
    metric: "pr_throughput",
    unit: "count",
    values,
    ...overrides,
  };
}

describe("renderForecastChart edge cases", () => {
  it("renders without NaN when bounds are undefined", () => {
    const forecast = makeForecast([
      { period_start: "2025-01-06", predicted: 50 },
      { period_start: "2025-01-13", predicted: 55 },
      { period_start: "2025-01-20", predicted: 60 },
    ]);

    const html = renderForecastChart(forecast);

    expect(html).not.toContain("NaN");
    expect(html).not.toBe("");
    expect(html).toContain("forecast-chart");
  });

  it("does not render confidence band when bounds are missing", () => {
    const forecast = makeForecast([
      { period_start: "2025-01-06", predicted: 50 },
      { period_start: "2025-01-13", predicted: 55 },
    ]);

    const html = renderForecastChart(forecast);

    // Confidence band path should be empty or absent (no band points = no path)
    expect(html).not.toContain("NaN");
  });

  it("renders confidence band when bounds are present", () => {
    const forecast = makeForecast([
      {
        period_start: "2025-01-06",
        predicted: 50,
        lower_bound: 40,
        upper_bound: 60,
      },
      {
        period_start: "2025-01-13",
        predicted: 55,
        lower_bound: 45,
        upper_bound: 65,
      },
    ]);

    const html = renderForecastChart(forecast);

    expect(html).not.toContain("NaN");
    expect(html).toContain("confidence-band");
  });

  it("handles mixed bounds (some values with, some without)", () => {
    const forecast = makeForecast([
      {
        period_start: "2025-01-06",
        predicted: 50,
        lower_bound: 40,
        upper_bound: 60,
      },
      { period_start: "2025-01-13", predicted: 55 },
      {
        period_start: "2025-01-20",
        predicted: 60,
        lower_bound: 50,
        upper_bound: 70,
      },
    ]);

    const html = renderForecastChart(forecast);

    expect(html).not.toContain("NaN");
    expect(html).toContain("forecast-chart");
  });

  it("returns empty message for empty forecasts array", () => {
    const forecast = makeForecast([]);
    const html = renderForecastChart(forecast);

    expect(html).toContain("No forecast data available");
  });

  it("renders single forecast value without crash", () => {
    const forecast = makeForecast([
      {
        period_start: "2025-01-06",
        predicted: 50,
        lower_bound: 40,
        upper_bound: 60,
      },
    ]);

    expect(() => renderForecastChart(forecast)).not.toThrow();
    const html = renderForecastChart(forecast);
    expect(html).not.toContain("NaN");
  });
});

describe("renderForecastTable edge cases", () => {
  it("shows N/A for missing bounds", () => {
    const forecast = makeForecast([
      { period_start: "2025-01-06", predicted: 50 },
      { period_start: "2025-01-13", predicted: 55 },
    ]);

    const html = renderForecastTable(forecast);

    expect(html).toContain("N/A");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("shows range for present bounds", () => {
    const forecast = makeForecast([
      {
        period_start: "2025-01-06",
        predicted: 50,
        lower_bound: 40,
        upper_bound: 60,
      },
    ]);

    const html = renderForecastTable(forecast);

    expect(html).toContain("40.0 - 60.0");
    expect(html).not.toContain("N/A");
  });

  it("returns empty message for empty values", () => {
    const forecast = makeForecast([]);
    const html = renderForecastTable(forecast);

    expect(html).toContain("forecast-table-empty");
  });
});

// ────────────────────────────────────────────────────────────────────
// Branch coverage completeness: exercise every remaining partial branch
// so predictions.ts can join LOCKED_ZERO_FILES. Each test targets a
// specific `||`/`??`/ternary that existing tests leave uncovered.
// ────────────────────────────────────────────────────────────────────

describe("renderForecasterIndicator branch coverage", () => {
  it("returns Linear Forecast label when forecaster is undefined", () => {
    // forecaster falsy → `forecaster || "linear"` right side → label = "Linear Forecast"
    const html = renderForecasterIndicator(undefined);
    expect(html).toContain("forecaster-linear");
    expect(html).toContain("Linear Forecast");
  });

  it("returns Prophet Forecast label with prophet-specific css class", () => {
    // forecaster === "prophet" → ternary truthy side at line 91
    const html = renderForecasterIndicator("prophet");
    expect(html).toContain("forecaster-prophet");
    expect(html).toContain("Prophet Forecast");
  });

  it("falls back to generic Forecast label for unknown forecaster keys", () => {
    // Cast around the "linear" | "prophet" | undefined type so we can feed
    // a value that FORECASTER_LABELS does not contain — the `|| "Forecast"`
    // right side on line 89 fires, and the ternary on line 91 takes its
    // non-prophet branch.
    const html = renderForecasterIndicator(
      "bogus" as unknown as "linear" | "prophet",
    );
    expect(html).toContain("forecaster-linear");
    expect(html).toContain(">Forecast<");
  });
});

describe("renderDataQualityBanner branch coverage", () => {
  it("returns empty string for undefined dataQuality", () => {
    // !dataQuality truthy → early return at line 101
    expect(renderDataQualityBanner(undefined)).toBe("");
  });

  it("returns empty string for normal dataQuality", () => {
    // dataQuality === "normal" → early return
    expect(renderDataQualityBanner("normal")).toBe("");
  });

  it("renders low-confidence banner with appropriate class", () => {
    // Non-normal value → falls through past the early return, looks up the
    // message map, and renders. Covers line 103-112.
    const html = renderDataQualityBanner("low_confidence");
    expect(html).toContain("data-quality-banner");
    expect(html).toContain("quality-low");
    expect(html).toContain("Low Confidence");
  });

  it("renders insufficient-data banner with appropriate class", () => {
    const html = renderDataQualityBanner("insufficient");
    expect(html).toContain("data-quality-banner");
    expect(html).toContain("quality-insufficient");
    expect(html).toContain("Insufficient Data");
  });

  it("returns empty string for unknown dataQuality value (safety net)", () => {
    // Unknown value: not normal → passes line 101 → map lookup returns
    // undefined → !quality truthy on line 104 → return "". Cast around
    // the bounded type so we can feed it something the map does not know.
    const html = renderDataQualityBanner(
      "maybe_confident" as unknown as "low_confidence",
    );
    expect(html).toBe("");
  });
});

describe("renderForecastChart branch coverage", () => {
  it("handles identical predicted/bound values without NaN", () => {
    // Regression guard: when every forecast value and bound collapses to
    // the same number, the chart math must still produce finite SVG
    // coordinates. The Math.max(..., 1) / Math.min(..., 0) baselines keep
    // `range` >= 1 even in this degenerate case.
    const forecast = makeForecast([
      {
        period_start: "2025-01-06",
        predicted: 50,
        lower_bound: 50,
        upper_bound: 50,
      },
      {
        period_start: "2025-01-13",
        predicted: 50,
        lower_bound: 50,
        upper_bound: 50,
      },
      {
        period_start: "2025-01-20",
        predicted: 50,
        lower_bound: 50,
        upper_bound: 50,
      },
    ]);

    const html = renderForecastChart(forecast);
    expect(html).not.toContain("NaN");
    expect(html).toContain("forecast-chart");
    expect(html).toContain("confidence-band");
  });

  it("emits an inline truncation badge when wasTruncated is true", () => {
    const forecast = makeForecast([
      { period_start: "2025-01-06", predicted: 50 },
      { period_start: "2025-01-13", predicted: 55 },
    ]);
    const html = renderForecastChart(forecast, undefined, 200, true);
    expect(html).toContain("truncation-badge");
    expect(html).toContain("Partial history");
  });

  it("omits the truncation badge by default", () => {
    const forecast = makeForecast([
      { period_start: "2025-01-06", predicted: 50 },
      { period_start: "2025-01-13", predicted: 55 },
    ]);
    const html = renderForecastChart(forecast);
    expect(html).not.toContain("truncation-badge");
  });
});

describe("extractHistoricalData branch coverage", () => {
  const makeRollup = (week: string, pr_count = 10): RollupForChart => ({
    week,
    pr_count,
    cycle_time_p50: null,
  });

  it("passes non-ISO-week date strings through isoWeekToDate unchanged", () => {
    // r.week does not match the ISO-week regex → isoWeekToDate's `!match`
    // branch fires and the string is returned as-is. This is reachable now
    // that extractHistoricalDataResult always funnels every rollup through
    // isoWeekToDate (the includes("-W") filter was removed).
    const rollups = [
      makeRollup("2025-01-06"),
      makeRollup("2025-01-13"),
      makeRollup("bogus-week"),
    ];
    const data = extractHistoricalData(rollups, "pr_throughput");
    expect(data.map((d) => d.week)).toEqual([
      "2025-01-06",
      "2025-01-13",
      "bogus-week",
    ]);
  });

  it("converts ISO-week strings whose Jan 4 lands on Sunday via the dayOfWeek fallback", () => {
    // Jan 4, 2015 was a Sunday → jan4.getDay() === 0 (falsy) → `|| 7`
    // right side fires inside isoWeekToDate. Use a week far enough into
    // the year that the conversion arithmetic returns a definite Monday.
    const rollups = [makeRollup("2015-W05")];
    const data = extractHistoricalData(rollups, "pr_throughput");
    expect(data).toHaveLength(1);
    // 2015-W05 Monday is 2015-01-26
    expect(data[0]?.week).toBe("2015-01-26");
  });

  it("returns empty array for unknown metric (getter map miss)", () => {
    const rollups = [makeRollup("2025-W01")];
    const data = extractHistoricalData(rollups, "totally_unknown_metric");
    expect(data).toEqual([]);
  });
});

describe("renderPredictionsWithCharts branch coverage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("filters pr_throughput out of the rendered set while keeping cycle_time_minutes (PR #389 acceptance gate)", () => {
    // Per PR #389 walk-forward backtest, the linear forecaster loses to a
    // persistence baseline for pr_throughput at h=1, h=4, and the
    // all-horizon aggregate. The renderer at predictions.ts:537 must filter
    // pr_throughput before forEach so misleading throughput forecasts never
    // reach the user-facing tab. cycle_time_minutes must still render.
    const predictions: PredictionsRenderData = {
      generated_at: "2026-05-11T00:00:00Z",
      forecaster: "linear",
      forecasts: [
        {
          metric: "pr_throughput",
          unit: "count",
          values: [
            {
              period_start: "2026-05-11",
              predicted: 50,
              lower_bound: 40,
              upper_bound: 60,
            },
            {
              period_start: "2026-05-18",
              predicted: 55,
              lower_bound: 45,
              upper_bound: 65,
            },
          ],
        },
        {
          metric: "cycle_time_minutes",
          unit: "minutes",
          values: [
            {
              period_start: "2026-05-11",
              predicted: 4320,
              lower_bound: 3600,
              upper_bound: 5040,
            },
            {
              period_start: "2026-05-18",
              predicted: 4400,
              lower_bound: 3700,
              upper_bound: 5100,
            },
          ],
        },
      ],
    };

    renderPredictionsWithCharts(container, predictions);

    // Exactly one forecast chart renders — pr_throughput is suppressed.
    const charts = container.querySelectorAll(".forecast-chart");
    expect(charts).toHaveLength(1);

    // The surviving chart is cycle_time_minutes; its sanitized id is the
    // metric string verbatim (sanitizeForId leaves _ and a-z alone).
    expect(container.querySelector("#chart-cycle_time_minutes")).not.toBeNull();
    expect(container.querySelector("#chart-pr_throughput")).toBeNull();

    // Title-cased label visible to users.
    expect(container.textContent).toContain("Cycle Time Minutes");
    expect(container.textContent).not.toContain("Pr Throughput");
  });

  it("suppresses the review-time unavailable message when a review_time_minutes forecast is present", () => {
    // `hasReviewTime` true → `!hasReviewTime && predictions.forecasts.length > 0`
    // evaluates false at the AND and the metric-unavailable notice is not
    // emitted. This is the missing left-hand branch on line 555.
    const predictions: PredictionsRenderData = {
      generated_at: "2026-01-28T12:00:00Z",
      forecaster: "linear",
      forecasts: [
        {
          metric: "review_time_minutes",
          unit: "minutes",
          values: [
            { period_start: "2025-01-06", predicted: 30 },
            { period_start: "2025-01-13", predicted: 35 },
          ],
        },
      ],
    };

    renderPredictionsWithCharts(container, predictions);

    expect(container.querySelector(".forecast-chart")).not.toBeNull();
    expect(container.querySelector(".metric-unavailable")).toBeNull();
  });
});
