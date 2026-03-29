/**
 * Throughput Chart Module
 *
 * Renders the PR throughput bar chart with 4-week moving average trend line.
 *
 * DOM-INJECTED: Container element is passed as parameter.
 * This module works identically in both extension and local dashboard modes.
 */

import type { Rollup } from "../../dataset-loader";
import type { DataAvailabilitySignal } from "../../types";
import type { FilterState } from "../filters";
import { calculateMovingAverage } from "../metrics";
import {
  escapeHtml,
  renderNoData,
  renderTrustedHtml,
} from "../shared/render";
import { renderTruncationIndicator } from "../shared/chart-layout";
import { addChartTooltips, clearChartTooltips } from "../charts";
import { classifyEmptyState } from "../empty-state-classifier";

/** Maximum data points rendered in the throughput chart (2 years of weekly data). */
export const MAX_THROUGHPUT_POINTS = 104;

/** Maximum visible week labels before thinning kicks in. */
export const MAX_VISIBLE_LABELS = 16;

/**
 * Render throughput chart with trend line overlay.
 *
 * Creates a bar chart showing weekly PR counts with a 4-week moving average
 * trend line overlay for visualizing throughput patterns.
 *
 * @param container - Target container element (or null for no-op)
 * @param rollups - Array of weekly rollup data
 */
export function renderThroughputChart(
  container: HTMLElement | null,
  rollups: Rollup[],
  options?: {
    filters?: FilterState;
    unfilteredRollups?: Rollup[];
    availability?: DataAvailabilitySignal;
  },
): void {
  if (!container) return;
  clearChartTooltips(container);

  if (!rollups || !rollups.length) {
    const classification = options
      ? classifyEmptyState({
          chartType: "throughput",
          filters: options.filters ?? { repos: [], teams: [], reviewers: [], authors: [] },
          unfilteredRollups: options.unfilteredRollups ?? [],
          filteredRollups: rollups ?? [],
          availability: options.availability ?? {
            reviewerDataPresent: false,
            reviewerDataEmpty: false,
            cycleTimePresent: false,
            reviewerRepoMode: "constrained",
            commentsStatus: "disabled",
          },
          minimumDataPoints: 0,
        })
      : null;
    renderNoData(
      container,
      classification?.message ?? "No data for selected range",
      classification?.hint ?? "Try widening the date range or adjusting repository/team filters.",
    );
    return;
  }

  // Truncate to most recent data points if over the cap
  const truncated = rollups.length > MAX_THROUGHPUT_POINTS;
  const displayRollups = truncated
    ? rollups.slice(-MAX_THROUGHPUT_POINTS)
    : rollups;

  const prCounts = displayRollups.map((r) => r.pr_count || 0);
  const maxCount = Math.max(...prCounts);
  const movingAvg = calculateMovingAverage(prCounts, 4);

  // Render bar chart
  const labelStep = Math.ceil(displayRollups.length / MAX_VISIBLE_LABELS);
  const barsHtml = displayRollups
    .map((r, index) => {
      const height = maxCount > 0 ? ((r.pr_count || 0) / maxCount) * 100 : 0;
      const wParts = r.week.split("-W");
      const weekLabel = wParts[1] ?? r.week;
      const showLabel = index % labelStep === 0;
      // SECURITY: Escape data-controlled values to prevent XSS
      return `
            <div class="bar-container" data-tooltip="true" data-week="${escapeHtml(r.week)}" data-count="${r.pr_count || 0}">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${showLabel ? escapeHtml(weekLabel) : ""}</div>
            </div>
        `;
    })
    .join("");

  // Render trend line SVG overlay
  const trendResult = renderTrendLine(displayRollups, movingAvg, maxCount);

  // Truncation indicator
  const truncationHtml = renderTruncationIndicator(truncated, MAX_THROUGHPUT_POINTS);

  // Legend — trend line entry is conditional on whether the trend actually rendered
  const trendLegendItem = trendResult.rendered
    ? `<div class="legend-item"><span class="legend-line"></span><span>4-week avg</span></div>`
    : `<div class="legend-item legend-insufficient"><span class="legend-line dimmed"></span><span>4-week avg — needs 4+ weeks</span></div>`;
  const legendHtml = `
        <div class="chart-legend">
            <div class="legend-item">
                <span class="legend-bar"></span>
                <span>Weekly PRs</span>
            </div>
            ${trendLegendItem}
        </div>
    `;

  // SECURITY: Content uses escapeHtml for week values, all other values are numeric
  renderTrustedHtml(
    container,
    `
        ${truncationHtml}
        <div class="chart-with-trend" style="--chart-surface: var(--bg-primary);">
            <div class="bar-chart">${barsHtml}</div>
            ${trendResult.html}
        </div>
        ${legendHtml}
    `,
  );

  // Add tap/click tooltip support for throughput bars
  addChartTooltips(container, (bar: HTMLElement) => {
    const week = bar.dataset.week ?? "";
    const count = bar.dataset.count ?? "0";
    return `<div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
              <span class="chart-tooltip-label">PRs</span>
              <span>${escapeHtml(count)}</span>
            </div>`;
  });
}

/**
 * Render the moving average trend line SVG overlay.
 */
function renderTrendLine(
  rollups: Rollup[],
  movingAvg: (number | null)[],
  maxCount: number,
): { html: string; rendered: boolean } {
  if (rollups.length < 4) return { html: "", rendered: false };

  const validPoints = movingAvg
    .map((val, i) => ({ val, i }))
    .filter((p): p is { val: number; i: number } => p.val !== null);

  if (validPoints.length < 2) return { html: "", rendered: false };

  const chartHeight = 200;
  const chartPadding = 8;

  // Calculate SVG path points
  const points = validPoints.map((p) => {
    const x = (p.i / (rollups.length - 1)) * 100;
    const y =
      maxCount > 0
        ? chartHeight -
          chartPadding -
          (p.val / maxCount) * (chartHeight - chartPadding * 2)
        : chartHeight / 2;
    return { x, y };
  });

  const pathD = points
    .map(
      (pt, i) =>
        `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)}% ${pt.y.toFixed(1)}`,
    )
    .join(" ");

  return {
    html: `<div class="trend-line-overlay"><svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none"><path class="trend-line" d="${pathD}" vector-effect="non-scaling-stroke"/></svg></div>`,
    rendered: true,
  };
}
