/**
 * Cycle Time Charts Module
 *
 * Renders cycle time distribution buckets and P50/P90 trend charts.
 *
 * DOM-INJECTED: Container elements are passed as parameters.
 * This module works identically in both extension and local dashboard modes.
 */

import type { Rollup } from "../../dataset-loader";
import type { DistributionData } from "../../types";
import { addChartTooltips, clearChartTooltips } from "../charts";
import { formatDuration } from "../shared/format";
import {
  escapeHtml,
  NO_DATA_HINTS,
  renderNoData,
  renderTrustedHtml,
} from "../shared/render";

/** Maximum data points rendered in the cycle time trend chart (2 years of weekly data). */
export const MAX_CYCLE_TIME_POINTS = 104;

/**
 * Render cycle time distribution as horizontal bar chart.
 *
 * Shows distribution across time buckets (0-1h, 1-4h, etc.)
 *
 * @param container - Target container element (or null for no-op)
 * @param distributions - Array of distribution data
 */
export function renderCycleDistribution(
  container: HTMLElement | null,
  distributions: DistributionData[],
): void {
  if (!container) return;

  if (!distributions || !distributions.length) {
    renderNoData(
      container,
      "No data for selected range",
      NO_DATA_HINTS.WIDEN_FILTERS,
    );
    return;
  }

  const buckets: Record<string, number> = {
    "0-1h": 0,
    "1-4h": 0,
    "4-24h": 0,
    "1-3d": 0,
    "3-7d": 0,
    "7d+": 0,
  };
  distributions.forEach((d) => {
    Object.entries(d.cycle_time_buckets || {}).forEach(([key, val]) => {
      // eslint-disable-next-line security/detect-object-injection -- SECURITY: key is from Object.entries iteration over known bucket structure
      buckets[key] = (buckets[key] || 0) + (val as number);
    });
  });

  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0) {
    renderNoData(container, "No cycle time data", NO_DATA_HINTS.WIDEN_FILTERS);
    return;
  }

  const html = Object.entries(buckets)
    .map(([label, count]) => {
      const pct = ((count / total) * 100).toFixed(1);
      return `
            <div class="dist-row">
                <span class="dist-label">${label}</span>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: ${pct}%"></div>
                </div>
                <span class="dist-value">${count} (${pct}%)</span>
            </div>
        `;
    })
    .join("");

  // SECURITY: html contains only code constants (bucket labels) and computed numbers
  renderTrustedHtml(container, html);
}

/**
 * Render cycle time trend chart (line chart with P50 and P90).
 *
 * Shows P50/P90 cycle time trends over multiple weeks.
 *
 * @param container - Target container element (or null for no-op)
 * @param rollups - Array of weekly rollup data
 */
export function renderCycleTimeTrend(
  container: HTMLElement | null,
  rollups: Rollup[],
): void {
  if (!container) return;
  clearChartTooltips(container);

  if (!rollups || rollups.length < 2) {
    renderNoData(
      container,
      "Not enough data for trend",
      NO_DATA_HINTS.TREND_MINIMUM,
    );
    return;
  }

  // Truncate to most recent data points if over the cap
  const truncated = rollups.length > MAX_CYCLE_TIME_POINTS;
  const displayRollups = truncated
    ? rollups.slice(-MAX_CYCLE_TIME_POINTS)
    : rollups;

  const p50Data = displayRollups
    .map((r) => ({ week: r.week, value: r.cycle_time_p50 }))
    .filter((d): d is { week: string; value: number } => d.value !== null);
  const p90Data = displayRollups
    .map((r) => ({ week: r.week, value: r.cycle_time_p90 }))
    .filter((d): d is { week: string; value: number } => d.value !== null);

  if (p50Data.length < 2 && p90Data.length < 2) {
    renderNoData(
      container,
      "No cycle time data available",
      NO_DATA_HINTS.WIDEN_FILTERS,
    );
    return;
  }

  const allValues = [
    ...p50Data.map((d) => d.value),
    ...p90Data.map((d) => d.value),
  ];
  const maxVal = Math.max(...allValues);
  const minVal = Math.min(...allValues);
  const range = maxVal - minVal || 1;

  // Scale viewBox width to the number of data points so the SVG's aspect
  // ratio naturally matches a wide dashboard panel.  Each point gets ~6
  // units of horizontal space; minimum 500 keeps small datasets legible.
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 25, left: 40 };
  const width = Math.max(
    500,
    padding.left + padding.right + displayRollups.length * 6,
  );
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Dot radius scales inversely with density: bigger when few points,
  // smaller when many, so they remain visible and clickable.
  const dotRadius = Math.max(1.5, Math.min(4, 200 / displayRollups.length));

  // Generate paths
  const generatePath = (data: { week: string; value: number }[]) => {
    if (displayRollups.length < 2) return { pathD: "", points: [] };
    const points = data
      .map((d) => {
        const dataIndex = displayRollups.findIndex((r) => r.week === d.week);
        if (dataIndex === -1) return null;
        const x =
          padding.left + (dataIndex / (displayRollups.length - 1)) * chartWidth;
        const y =
          padding.top +
          chartHeight -
          ((d.value - minVal) / range) * chartHeight;
        return { x, y, week: d.week, value: d.value };
      })
      .filter(
        (p): p is { x: number; y: number; week: string; value: number } =>
          p !== null,
      );
    const pathD = points
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
      )
      .join(" ");
    return { pathD, points };
  };

  const p50Path = p50Data.length >= 2 ? generatePath(p50Data) : null;
  const p90Path = p90Data.length >= 2 ? generatePath(p90Data) : null;

  // Y-axis labels
  const yLabels = [minVal, (minVal + maxVal) / 2, maxVal];

  const svgContent = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet">
            <!-- Grid lines -->
            ${yLabels
              .map((_, i) => {
                const y =
                  padding.top +
                  chartHeight -
                  (i / (yLabels.length - 1)) * chartHeight;
                return `<line class="line-chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>`;
              })
              .join("")}

            <!-- Y-axis labels -->
            ${yLabels
              .map((val, i) => {
                const y =
                  padding.top +
                  chartHeight -
                  (i / (yLabels.length - 1)) * chartHeight;
                return `<text class="line-chart-axis" x="${padding.left - 4}" y="${y + 3}" text-anchor="end">${formatDuration(val)}</text>`;
              })
              .join("")}

            <!-- Lines -->
            ${p90Path ? `<path class="line-chart-p90" d="${p90Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}
            ${p50Path ? `<path class="line-chart-p50" d="${p50Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}

            <!-- Dots -->
            ${p90Path ? p90Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="${dotRadius}" fill="var(--warning)" data-week="${escapeHtml(p.week)}" data-value="${escapeHtml(String(p.value))}" data-metric="P90"/>`).join("") : ""}
            ${p50Path ? p50Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="${dotRadius}" fill="var(--primary)" data-week="${escapeHtml(p.week)}" data-value="${escapeHtml(String(p.value))}" data-metric="P50"/>`).join("") : ""}
        </svg>
    `;

  const legendHtml = `
        <div class="chart-legend">
            <div class="legend-item">
                <span class="chart-tooltip-dot legend-p50"></span>
                <span>P50 (Median)</span>
            </div>
            <div class="legend-item">
                <span class="chart-tooltip-dot legend-p90"></span>
                <span>P90</span>
            </div>
        </div>
    `;

  // Truncation indicator
  const truncationHtml = truncated
    ? `<div class="truncation-indicator">Showing last ${MAX_CYCLE_TIME_POINTS} weeks</div>`
    : "";

  // SECURITY: Content is SVG from computed coordinates + escapeHtml'd week values
  renderTrustedHtml(
    container,
    `${truncationHtml}<div class="line-chart">${svgContent}</div>${legendHtml}`,
  );

  // Add tooltip interactions
  addChartTooltips(container, (dot: HTMLElement) => {
    const week = dot.dataset["week"] || "";
    const value = parseFloat(dot.dataset["value"] || "0");
    const metric = dot.dataset["metric"] || "";
    // SECURITY: Escape data attribute values to prevent XSS
    return `
            <div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">
                    <span class="chart-tooltip-dot ${metric === "P50" ? "legend-p50" : "legend-p90"}"></span>
                    ${escapeHtml(metric)}
                </span>
                <span>${formatDuration(value)}</span>
            </div>
        `;
  });
}
