/**
 * Predictions Chart Module
 *
 * Renders forecast charts with:
 * - Historical data (solid line)
 * - Forecast data (dashed line)
 * - Confidence bands (filled area)
 * - Forecaster type indicator ("Linear Forecast" / "Prophet Forecast")
 * - Data quality warning banner for low_confidence state
 *
 * DOM-INJECTED: Container element is passed as parameter.
 * This module works identically in both extension and local dashboard modes.
 */

import type {
  Forecast,
  ForecastValue,
  PredictionsRenderData,
} from "../../types";
import { escapeHtml, appendTrustedHtml } from "../shared/render";

/**
 * Historical data point for chart rendering.
 */
export interface HistoricalDataPoint {
  week: string;
  value: number;
}

interface HistoricalDataResult {
  data: HistoricalDataPoint[];
  wasTruncated: boolean;
}

/**
 * Rollup data structure (subset of fields needed for historical data).
 */
export interface RollupForChart {
  week: string;
  pr_count: number;
  cycle_time_p50: number | null;
}

/**
 * Maximum data points to render in charts to prevent memory pressure.
 * Uses "take last N" strategy to preserve most recent/relevant data.
 * 200 points covers ~4 years of weekly data (more than typical use).
 */
const MAX_CHART_POINTS = 200;

/**
 * Forecaster display names.
 */
const FORECASTER_LABELS: Record<string, string> = {
  linear: "Linear Forecast",
  prophet: "Prophet Forecast",
};

/**
 * Data quality display messages.
 */
const DATA_QUALITY_MESSAGES = new Map<
  string,
  { label: string; cssClass: string }
>([
  ["normal", { label: "High Confidence", cssClass: "quality-normal" }],
  [
    "low_confidence",
    {
      label: "Low Confidence - More data recommended",
      cssClass: "quality-low",
    },
  ],
  [
    "insufficient",
    {
      label: "Insufficient Data",
      cssClass: "quality-insufficient",
    },
  ],
]);

/**
 * Render the forecaster type indicator badge.
 */
export function renderForecasterIndicator(
  forecaster: "linear" | "prophet" | undefined,
): string {
  const label = FORECASTER_LABELS[forecaster || "linear"] || "Forecast";
  const cssClass =
    forecaster === "prophet" ? "forecaster-prophet" : "forecaster-linear";
  return `<span class="forecaster-badge ${cssClass}">${escapeHtml(label)}</span>`;
}

/**
 * Render data quality warning banner.
 */
export function renderDataQualityBanner(
  dataQuality: "normal" | "low_confidence" | "insufficient" | undefined,
): string {
  if (!dataQuality || dataQuality === "normal") return "";

  const quality = DATA_QUALITY_MESSAGES.get(dataQuality);
  if (!quality) return "";

  return `
    <div class="data-quality-banner ${quality.cssClass}">
      <span class="quality-icon">&#x26A0;</span>
      <span class="quality-label">${escapeHtml(quality.label)}</span>
    </div>
  `;
}

/**
 * Sanitize a string to be safe for use in HTML id/class attributes.
 * Removes any non-alphanumeric characters except hyphens and underscores.
 * @param str - String to sanitize
 * @returns Safe string for use in HTML attributes
 */
function sanitizeForId(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Calculate SVG path for a line chart.
 * @param values - Array of { x, y } points where x and y are percentages (0-100)
 * @returns SVG path d attribute string
 */
function calculateLinePath(values: Array<{ x: number; y: number }>): string {
  if (values.length === 0) return "";
  return values
    .map(
      (pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`,
    )
    .join(" ");
}

/**
 * Calculate SVG path for confidence band fill.
 * Creates a closed path: upper line forward, lower line backward.
 * @param upperValues - Upper bound points
 * @param lowerValues - Lower bound points (same x coordinates)
 * @returns SVG path d attribute string
 */
function calculateBandPath(
  upperValues: Array<{ x: number; y: number }>,
  lowerValues: Array<{ x: number; y: number }>,
): string {
  if (upperValues.length === 0 || lowerValues.length === 0) return "";

  // Upper line forward
  const upperPath = upperValues
    .map(
      (pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`,
    )
    .join(" ");

  // Lower line backward (reverse order)
  const lowerReversed = [...lowerValues].reverse();
  const lowerPath = lowerReversed
    .map((pt) => `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
    .join(" ");

  return `${upperPath} ${lowerPath} Z`;
}

/**
 * Render a single forecast metric as a line chart with confidence bands.
 * @param forecast - Forecast data for one metric
 * @param historicalData - Optional historical data points for context
 * @param chartHeight - SVG viewBox height (default 200)
 */
export function renderForecastChart(
  forecast: Forecast,
  historicalData?: Array<{ week: string; value: number }>,
  chartHeight: number = 200,
  wasTruncated: boolean = false,
): string {
  const rawValues = forecast.values;
  if (!rawValues || rawValues.length === 0) {
    return `<div class="forecast-chart-empty">No forecast data available</div>`;
  }

  // T028: Sort forecast values chronologically by period_start for deterministic ordering
  const values = [...rawValues].sort((a, b) =>
    a.period_start.localeCompare(b.period_start),
  );

  // Combine historical and forecast data for scale calculation
  const allValues: number[] = [];
  if (historicalData) {
    historicalData.forEach((h) => allValues.push(h.value));
  }
  values.forEach((v) => {
    allValues.push(v.predicted);
    if (v.lower_bound != null) allValues.push(v.lower_bound);
    if (v.upper_bound != null) allValues.push(v.upper_bound);
  });

  // maxValue is >= 1 and minValue is <= 0 because the trailing `, 1` and
  // `, 0` baselines are always among the Math.max/Math.min arguments, so
  // `range` is always >= 1 and never needs a zero-range fallback.
  const maxValue = Math.max(...allValues, 1);
  const minValue = Math.min(...allValues, 0);
  const range = maxValue - minValue;

  // Padding for chart
  const padding = 10;
  const effectiveHeight = chartHeight - padding * 2;

  // Calculate y position (inverted: higher values at top)
  const getY = (val: number): number => {
    const normalized = (val - minValue) / range;
    return padding + (1 - normalized) * effectiveHeight;
  };

  // Calculate points for forecast line
  const forecastPoints: Array<{ x: number; y: number }> = [];
  const upperPoints: Array<{ x: number; y: number }> = [];
  const lowerPoints: Array<{ x: number; y: number }> = [];

  // Calculate x positions based on number of points
  // If historical data exists, offset forecast points
  const historicalCount = historicalData?.length || 0;
  const totalPoints = historicalCount + values.length;
  const getX = (index: number): number => {
    return ((index + 0.5) / totalPoints) * 100;
  };

  values.forEach((v, i) => {
    const x = getX(historicalCount + i);
    forecastPoints.push({ x, y: getY(v.predicted) });
    if (v.upper_bound != null) upperPoints.push({ x, y: getY(v.upper_bound) });
    if (v.lower_bound != null) lowerPoints.push({ x, y: getY(v.lower_bound) });
  });

  // Calculate historical line points
  const historicalPoints: Array<{ x: number; y: number }> = [];
  if (historicalData) {
    historicalData.forEach((h, i) => {
      historicalPoints.push({ x: getX(i), y: getY(h.value) });
    });
  }

  // Generate SVG paths
  const historicalPath = calculateLinePath(historicalPoints);
  const forecastPath = calculateLinePath(forecastPoints);
  const bandPath = calculateBandPath(upperPoints, lowerPoints);

  // Format metric label
  const metricLabel = forecast.metric
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Build X-axis labels (weeks)
  const allWeeks: string[] = [];
  if (historicalData) {
    historicalData.forEach((h) => allWeeks.push(h.week));
  }
  values.forEach((v) => allWeeks.push(v.period_start));

  // Only show a subset of labels to avoid crowding
  const labelStep = Math.ceil(allWeeks.length / 6);
  const xAxisLabels = allWeeks
    .filter((_, i) => i % labelStep === 0)
    .map((week, i) => {
      const x = getX(i * labelStep);
      // Format as "Jan 6" from "2026-01-06"
      const formatted = formatWeekLabel(week);
      return `<text x="${x}%" y="${chartHeight - 2}" class="axis-label">${escapeHtml(formatted)}</text>`;
    })
    .join("");

  // Generate accessible summary for screen readers. `values` is guaranteed
  // non-empty by the early return at the top of the function, so the last
  // element is always defined — narrow the indexed read via a typed cast.
  const latestValue = values[values.length - 1] as ForecastValue;
  const rangeClause =
    latestValue.lower_bound != null && latestValue.upper_bound != null
      ? ` (range ${latestValue.lower_bound.toFixed(1)} to ${latestValue.upper_bound.toFixed(1)})`
      : "";
  const accessibleSummary = `${metricLabel} forecast: ${latestValue.predicted.toFixed(1)} ${forecast.unit}${rangeClause}`;

  // Sanitize metric for use in HTML id attributes (prevents XSS in id/aria-* attributes)
  const safeMetricId = sanitizeForId(forecast.metric);

  return `
    <div class="forecast-chart" role="region" aria-label="${escapeHtml(metricLabel)} forecast">
      <div class="chart-header">
        <h4 id="chart-${safeMetricId}">${escapeHtml(metricLabel)}</h4>
        <span class="chart-unit">(${escapeHtml(forecast.unit)})</span>
        ${wasTruncated ? `<span class="truncation-badge" title="Showing last ${MAX_CHART_POINTS} data points">Partial history</span>` : ""}
      </div>
      <div class="chart-svg-container">
        <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none" class="forecast-svg"
             role="img" aria-labelledby="chart-${safeMetricId}"
             aria-describedby="chart-desc-${safeMetricId}">
          <desc id="chart-desc-${safeMetricId}">${escapeHtml(accessibleSummary)}</desc>
          <!-- Confidence band fill -->
          ${bandPath ? `<path class="confidence-band" d="${bandPath}" />` : ""}
          <!-- Historical data line (solid) -->
          ${historicalPath ? `<path class="historical-line" d="${historicalPath}" vector-effect="non-scaling-stroke" />` : ""}
          <!-- Forecast line (dashed). forecastPoints is non-empty whenever we reach
               this render (values.length >= 1 guaranteed by the early return above),
               so forecastPath is always truthy — no conditional needed. -->
          <path class="forecast-line" d="${forecastPath}" vector-effect="non-scaling-stroke" />
        </svg>
        <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="xMidYMax meet" class="axis-svg" aria-hidden="true">
          ${xAxisLabels}
        </svg>
      </div>
      <div class="chart-legend" role="list" aria-label="Chart legend">
        <div class="legend-item" role="listitem">
          <span class="legend-line historical" aria-hidden="true"></span>
          <span>Historical</span>
        </div>
        <div class="legend-item" role="listitem">
          <span class="legend-line forecast" aria-hidden="true"></span>
          <span>Forecast</span>
        </div>
        <div class="legend-item" role="listitem">
          <span class="legend-band" aria-hidden="true"></span>
          <span>Confidence</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Format week string to short label (e.g., "2026-01-06" -> "Jan 6").
 * Invalid date strings are returned as-is via the `isNaN(getTime())` guard;
 * `new Date`, `.getTime`, `.toLocaleString("en-US")`, and `.getDate` cannot
 * throw on any string input, so no try/catch is needed.
 */
function formatWeekLabel(weekStr: string): string {
  const date = new Date(weekStr);
  if (isNaN(date.getTime())) return weekStr;
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  return `${month} ${day}`;
}

/**
 * Convert ISO week string (e.g., "2026-W04") to ISO date string (Monday of that week).
 */
function isoWeekToDate(isoWeek: string): string {
  // Handle "YYYY-Www" format; non-matching inputs are returned unchanged so
  // callers can funnel every week string through this helper without a
  // preliminary format check.
  const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return isoWeek;
  // Capture groups 1 and 2 are always defined on a successful match against
  // an anchored regex with two required groups; narrow via typed cast so
  // downstream parseInt calls do not need redundant undefined guards.
  const year = parseInt(match[1] as string, 10);
  const week = parseInt(match[2] as string, 10);

  // Calculate the Monday of the given ISO week
  // Jan 4 is always in week 1 of the ISO year
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Convert Sunday (0) to 7
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - dayOfWeek + 1);

  // Add weeks
  const targetDate = new Date(firstMonday);
  targetDate.setDate(firstMonday.getDate() + (week - 1) * 7);

  // `toISOString()` always emits `YYYY-MM-DDTHH:mm:ss.sssZ`, so the first
  // ten characters are always the date portion — substring is safer than
  // split("T")[0] because it keeps the return type as `string`.
  return targetDate.toISOString().substring(0, 10);
}

/**
 * Extract historical data points from rollups for a specific metric.
 * @param rollups - Array of rollup data
 * @param metric - Metric name to extract (pr_throughput, cycle_time_minutes, etc.)
 * @returns Array of historical data points sorted by week
 */
export function extractHistoricalData(
  rollups: RollupForChart[],
  metric: string,
): HistoricalDataPoint[] {
  return extractHistoricalDataResult(rollups, metric).data;
}

function extractHistoricalDataResult(
  rollups: RollupForChart[],
  metric: string,
): HistoricalDataResult {
  if (!rollups || rollups.length === 0) {
    return { data: [], wasTruncated: false };
  }

  // Map metric names to rollup field getters
  // Note: review_time_minutes removed - it used cycle_time as misleading proxy
  const metricFieldMap = new Map<string, (r: RollupForChart) => number | null>([
    ["pr_throughput", (r) => r.pr_count],
    ["cycle_time_minutes", (r) => r.cycle_time_p50],
  ]);

  const getter = metricFieldMap.get(metric);
  if (!getter) {
    return { data: [], wasTruncated: false };
  }

  const data = rollups
    .filter((r) => getter(r) !== null && getter(r) !== undefined)
    .map((r) => ({
      // Convert ISO week format to date. isoWeekToDate handles non-ISO
      // inputs internally by returning them unchanged, so we can funnel
      // every week string through it without a preliminary format check.
      week: isoWeekToDate(r.week),
      value: Number(getter(r)),
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // Limit data points to prevent memory pressure - take last N (most recent)
  const wasTruncated = data.length > MAX_CHART_POINTS;

  return {
    data: wasTruncated ? data.slice(-MAX_CHART_POINTS) : data,
    wasTruncated,
  };
}

/**
 * Render forecast values as a data table.
 * Used as fallback or detailed view.
 */
export function renderForecastTable(forecast: Forecast): string {
  const rawValues = forecast.values;
  if (!rawValues || rawValues.length === 0) {
    return `<div class="forecast-table-empty">No forecast data</div>`;
  }

  // T028: Sort forecast values chronologically by period_start for deterministic ordering
  const values = [...rawValues].sort((a, b) =>
    a.period_start.localeCompare(b.period_start),
  );

  const metricLabel = forecast.metric
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const rows = values
    .map(
      (v: ForecastValue) => `
      <tr>
        <td>${escapeHtml(v.period_start)}</td>
        <td class="number">${v.predicted.toFixed(1)}</td>
        <td class="number range">${v.lower_bound != null && v.upper_bound != null ? `${v.lower_bound.toFixed(1)} - ${v.upper_bound.toFixed(1)}` : "N/A"}</td>
      </tr>
    `,
    )
    .join("");

  return `
    <div class="forecast-table-section">
      <h4>${escapeHtml(metricLabel)} (${escapeHtml(forecast.unit)})</h4>
      <table class="forecast-table">
        <thead>
          <tr>
            <th>Week</th>
            <th>Predicted</th>
            <th>Range</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/**
 * Render complete predictions section with charts.
 * @param container - Target container element
 * @param predictions - Predictions data to render
 * @param rollups - Optional historical rollup data for chart context
 */
export function renderPredictionsWithCharts(
  container: HTMLElement | null,
  predictions: PredictionsRenderData | null,
  rollups?: RollupForChart[],
): void {
  if (!container) return;
  if (!predictions) return;

  const content = document.createElement("div");
  content.className = "predictions-charts-content";

  // Render header with forecaster indicator and data quality banner
  const headerHtml = `
    <div class="predictions-header">
      ${renderForecasterIndicator(predictions.forecaster)}
      ${renderDataQualityBanner(predictions.data_quality)}
    </div>
  `;
  appendTrustedHtml(content, headerHtml);

  // Render prominent preview banner for synthetic/stub data (T056)
  if (predictions.is_stub) {
    appendTrustedHtml(
      content,
      `<div class="preview-banner">
        <span class="preview-icon">&#x26A0;</span>
        <div class="preview-text">
          <strong>PREVIEW - Demo Data</strong>
          <span>This is synthetic data for preview purposes only. Run the analytics pipeline to see real metrics.</span>
        </div>
      </div>`,
    );
  }

  // Render allowlist. trends.json may contain pr_throughput,
  // cycle_time_minutes, and review_time_minutes; the dashboard currently
  // renders cycle_time only. pr_throughput is excluded because PR #389's
  // walk-forward backtest showed the linear forecaster loses to a
  // persistence baseline; review_time_minutes is excluded because the
  // historical-data extractor has no mapping for it, so it would render
  // as a bare forecast band with no context. The model and the emitted
  // artifact are unchanged — this filter affects the user-facing tab only.
  const RENDERED_METRICS = new Set(["cycle_time_minutes"]);
  const visibleForecasts = predictions.forecasts.filter((f) =>
    RENDERED_METRICS.has(f.metric),
  );

  // Two distinct empty-state cases. `predictions.forecasts.length === 0`
  // means the producer emitted no forecasts at all (e.g. insufficient
  // data). `visibleForecasts.length === 0` with at least one emitted
  // forecast means the producer emitted forecasts but the dashboard
  // does not render any of those metrics.
  if (visibleForecasts.length === 0) {
    const sourceEmitted = predictions.forecasts.length > 0;
    const message = sourceEmitted
      ? `<p>No supported prediction metrics are available in this run.</p>`
      : `<p>No forecast data available.</p>
         <p>Run the analytics pipeline with predictions enabled to generate forecasts.</p>`;
    appendTrustedHtml(
      content,
      `<div class="predictions-empty-message">${message}</div>`,
    );
    container.appendChild(content);
    return;
  }

  // Render each supported forecast as a chart with historical data. The
  // truncation badge is emitted inline by renderForecastChart when
  // wasTruncated is true, so no post-append querySelector step is needed.
  visibleForecasts.forEach((forecast: Forecast) => {
    const historicalResult = rollups
      ? extractHistoricalDataResult(rollups, forecast.metric)
      : undefined;
    const historicalData = historicalResult?.data;
    const wasTruncated = historicalResult?.wasTruncated === true;
    const chartHtml = renderForecastChart(
      forecast,
      historicalData,
      200,
      wasTruncated,
    );
    appendTrustedHtml(content, chartHtml);
  });

  // Hide unavailable message if present
  const unavailable = container.querySelector(".feature-unavailable");
  if (unavailable) unavailable.classList.add("hidden");

  container.appendChild(content);
}
