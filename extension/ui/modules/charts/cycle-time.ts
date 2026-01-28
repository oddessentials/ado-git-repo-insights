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
import { addChartTooltips } from "../charts";
import { formatDuration } from "../shared/format";
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";

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
    renderNoData(container, "No data for selected range");
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
    renderNoData(container, "No cycle time data");
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

  if (!rollups || rollups.length < 2) {
    renderNoData(container, "Not enough data for trend");
    return;
  }

  const p50Data = rollups
    .map((r) => ({ week: r.week, value: r.cycle_time_p50 }))
    .filter((d): d is { week: string; value: number } => d.value !== null);
  const p90Data = rollups
    .map((r) => ({ week: r.week, value: r.cycle_time_p90 }))
    .filter((d): d is { week: string; value: number } => d.value !== null);

  if (p50Data.length < 2 && p90Data.length < 2) {
    renderNoData(container, "No cycle time data available");
    return;
  }

  const allValues = [
    ...p50Data.map((d) => d.value),
    ...p90Data.map((d) => d.value),
  ];
  const maxVal = Math.max(...allValues);
  const minVal = Math.min(...allValues);
  const range = maxVal - minVal || 1;

  const width = 100;
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 25, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Generate paths
  const generatePath = (data: { week: string; value: number }[]) => {
    const points = data.map((d) => {
      const dataIndex = rollups.findIndex((r) => r.week === d.week);
      const x = padding.left + (dataIndex / (rollups.length - 1)) * chartWidth;
      const y =
        padding.top + chartHeight - ((d.value - minVal) / range) * chartHeight;
      return { x, y, week: d.week, value: d.value };
    });
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
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
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
            ${p90Path ? p90Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--warning)" data-week="${escapeHtml(p.week)}" data-value="${p.value}" data-metric="P90"/>`).join("") : ""}
            ${p50Path ? p50Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--primary)" data-week="${escapeHtml(p.week)}" data-value="${p.value}" data-metric="P50"/>`).join("") : ""}
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

  // SECURITY: Content is SVG from computed coordinates + escapeHtml'd week values
  renderTrustedHtml(
    container,
    `<div class="line-chart">${svgContent}</div>${legendHtml}`,
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
