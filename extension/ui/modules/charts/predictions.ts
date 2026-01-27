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
 * Forecaster display names.
 */
const FORECASTER_LABELS: Record<string, string> = {
  linear: "Linear Forecast",
  prophet: "Prophet Forecast",
};

/**
 * Data quality display messages.
 */
const DATA_QUALITY_MESSAGES: Record<string, { label: string; cssClass: string }> = {
  normal: { label: "High Confidence", cssClass: "quality-normal" },
  low_confidence: {
    label: "Low Confidence - More data recommended",
    cssClass: "quality-low",
  },
  insufficient: {
    label: "Insufficient Data",
    cssClass: "quality-insufficient",
  },
};

/**
 * Render the forecaster type indicator badge.
 */
export function renderForecasterIndicator(
  forecaster: "linear" | "prophet" | undefined,
): string {
  const label = FORECASTER_LABELS[forecaster || "linear"] || "Forecast";
  const cssClass = forecaster === "prophet" ? "forecaster-prophet" : "forecaster-linear";
  return `<span class="forecaster-badge ${cssClass}">${escapeHtml(label)}</span>`;
}

/**
 * Render data quality warning banner.
 */
export function renderDataQualityBanner(
  dataQuality: "normal" | "low_confidence" | "insufficient" | undefined,
): string {
  if (!dataQuality || dataQuality === "normal") return "";

  const quality = DATA_QUALITY_MESSAGES[dataQuality];
  if (!quality) return "";

  return `
    <div class="data-quality-banner ${quality.cssClass}">
      <span class="quality-icon">&#x26A0;</span>
      <span class="quality-label">${escapeHtml(quality.label)}</span>
    </div>
  `;
}

/**
 * Calculate SVG path for a line chart.
 * @param values - Array of { x, y } points where x and y are percentages (0-100)
 * @returns SVG path d attribute string
 */
function calculateLinePath(values: Array<{ x: number; y: number }>): string {
  if (values.length === 0) return "";
  return values
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
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
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
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
): string {
  const values = forecast.values;
  if (!values || values.length === 0) {
    return `<div class="forecast-chart-empty">No forecast data available</div>`;
  }

  // Combine historical and forecast data for scale calculation
  const allValues: number[] = [];
  if (historicalData) {
    historicalData.forEach((h) => allValues.push(h.value));
  }
  values.forEach((v) => {
    allValues.push(v.predicted);
    allValues.push(v.lower_bound);
    allValues.push(v.upper_bound);
  });

  const maxValue = Math.max(...allValues, 1);
  const minValue = Math.min(...allValues, 0);
  const range = maxValue - minValue || 1;

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
    upperPoints.push({ x, y: getY(v.upper_bound) });
    lowerPoints.push({ x, y: getY(v.lower_bound) });
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

  return `
    <div class="forecast-chart">
      <div class="chart-header">
        <h4>${escapeHtml(metricLabel)}</h4>
        <span class="chart-unit">(${escapeHtml(forecast.unit)})</span>
      </div>
      <div class="chart-svg-container">
        <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none" class="forecast-svg">
          <!-- Confidence band fill -->
          ${bandPath ? `<path class="confidence-band" d="${bandPath}" />` : ""}
          <!-- Historical data line (solid) -->
          ${historicalPath ? `<path class="historical-line" d="${historicalPath}" vector-effect="non-scaling-stroke" />` : ""}
          <!-- Forecast line (dashed) -->
          ${forecastPath ? `<path class="forecast-line" d="${forecastPath}" vector-effect="non-scaling-stroke" />` : ""}
        </svg>
        <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="xMidYMax meet" class="axis-svg">
          ${xAxisLabels}
        </svg>
      </div>
      <div class="chart-legend">
        <div class="legend-item">
          <span class="legend-line historical"></span>
          <span>Historical</span>
        </div>
        <div class="legend-item">
          <span class="legend-line forecast"></span>
          <span>Forecast</span>
        </div>
        <div class="legend-item">
          <span class="legend-band"></span>
          <span>Confidence</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Format week string to short label (e.g., "2026-01-06" -> "Jan 6").
 */
function formatWeekLabel(weekStr: string): string {
  try {
    const date = new Date(weekStr);
    if (isNaN(date.getTime())) return weekStr;
    const month = date.toLocaleString("en-US", { month: "short" });
    const day = date.getDate();
    return `${month} ${day}`;
  } catch {
    return weekStr;
  }
}

/**
 * Render forecast values as a data table.
 * Used as fallback or detailed view.
 */
export function renderForecastTable(forecast: Forecast): string {
  const values = forecast.values;
  if (!values || values.length === 0) {
    return `<div class="forecast-table-empty">No forecast data</div>`;
  }

  const metricLabel = forecast.metric
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const rows = values
    .map(
      (v: ForecastValue) => `
      <tr>
        <td>${escapeHtml(v.period_start)}</td>
        <td class="number">${v.predicted.toFixed(1)}</td>
        <td class="number range">${v.lower_bound.toFixed(1)} - ${v.upper_bound.toFixed(1)}</td>
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
 */
export function renderPredictionsWithCharts(
  container: HTMLElement | null,
  predictions: PredictionsRenderData | null,
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

  // Render stub warning if applicable
  if (predictions.is_stub) {
    appendTrustedHtml(
      content,
      `<div class="stub-warning">&#x26A0; Demo data - for preview only</div>`,
    );
  }

  // Check for empty forecasts
  if (!predictions.forecasts || predictions.forecasts.length === 0) {
    appendTrustedHtml(
      content,
      `<div class="predictions-empty-message">
        <p>No forecast data available.</p>
        <p>Run the analytics pipeline with predictions enabled to generate forecasts.</p>
      </div>`,
    );
    container.appendChild(content);
    return;
  }

  // Render each forecast as a chart
  predictions.forecasts.forEach((forecast: Forecast) => {
    // For now, render without historical data (could be enhanced later)
    const chartHtml = renderForecastChart(forecast);
    appendTrustedHtml(content, chartHtml);
  });

  // Hide unavailable message if present
  const unavailable = container.querySelector(".feature-unavailable");
  if (unavailable) unavailable.classList.add("hidden");

  container.appendChild(content);
}
