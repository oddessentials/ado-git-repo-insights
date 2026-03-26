/**
 * Predictions Chart Edge-Case Tests (P2 guardrail)
 *
 * Tests production edge cases: undefined bounds (NaN bug), empty forecasts,
 * single values, and the forecast table with missing data.
 */

import {
  renderForecastChart,
  renderForecastTable,
} from "../../../ui/modules/charts/predictions";
import type { Forecast, ForecastValue } from "../../../ui/types";

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
