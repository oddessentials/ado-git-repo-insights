/**
 * Cycle Time Charts Module
 *
 * Renders cycle time distribution buckets and P50/P90 trend charts.
 *
 * DOM-INJECTED: Container elements are passed as parameters.
 * This module works identically in both extension and local dashboard modes.
 */

import type { Rollup } from "../../dataset-loader";
import type { DataAvailabilitySignal, DistributionData } from "../../types";
import type { FilterState } from "../filters";
import { addChartTooltips, clearChartTooltips } from "../charts";
import { classifyEmptyState } from "../empty-state-classifier";
import { formatDuration } from "../shared/format";
import { renderTruncationIndicator } from "../shared/chart-layout";
import { buildLinePath } from "../shared/svg-path";
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";

/** Maximum data points rendered in the cycle time trend chart (2 years of weekly data). */
export const MAX_CYCLE_TIME_POINTS = 104;

/**
 * Speed category for cycle time distribution buckets (FR-012).
 * Maps bucket label → color category for deterministic, testable CSS class assignment.
 * Boundaries: fast = [0, 4h), moderate = [4h, 3d), slow = [3d, +∞).
 */
export type BucketCategory = "fast" | "moderate" | "slow";

export const BUCKET_COLOR_MAP = new Map<string, BucketCategory>([
  ["0-1h", "fast"],
  ["1-4h", "fast"],
  ["4-24h", "moderate"],
  ["1-3d", "moderate"],
  ["3-7d", "slow"],
  ["7d+", "slow"],
]);

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
  options?: {
    filters?: FilterState;
    unfilteredRollups?: Rollup[];
    availability?: DataAvailabilitySignal;
  },
): void {
  if (!container) return;

  if (!distributions || !distributions.length) {
    const classification = options
      ? classifyEmptyState({
          chartType: "cycle_time_distribution",
          filters: options.filters ?? {
            repos: [],
            teams: [],
            reviewers: [],
            authors: [],
          },
          unfilteredRollups: options.unfilteredRollups ?? [],
          filteredRollups: options.unfilteredRollups ?? [], // Use unfiltered as proxy — distribution data is not dimension-filtered
          availability: options.availability ?? {
            reviewerDataPresent: false,
            reviewerDataEmpty: false,
            cycleTimePresent: false,
            reviewerRepoMode: "constrained",
            commentsStatus: "disabled",
          },
          minimumDataPoints: 1, // Requires at least 1 distribution to render
        })
      : null;
    renderNoData(
      container,
      classification?.message ?? "No data for selected range",
      classification?.hint ??
        "Try widening the date range or adjusting repository/team filters.",
    );
    return;
  }

  const buckets = new Map<string, number>([
    ["0-1h", 0],
    ["1-4h", 0],
    ["4-24h", 0],
    ["1-3d", 0],
    ["3-7d", 0],
    ["7d+", 0],
  ]);
  distributions.forEach((d) => {
    Object.entries(d.cycle_time_buckets || {}).forEach(([key, val]) => {
      buckets.set(key, (buckets.get(key) ?? 0) + (val as number));
    });
  });

  const total = Array.from(buckets.values()).reduce((a, b) => a + b, 0);
  if (total === 0) {
    renderNoData(
      container,
      "No cycle time data",
      "Try widening the date range or adjusting repository/team filters.",
    );
    return;
  }

  const html = Array.from(buckets.entries())
    .map(([label, count]) => {
      const pct = ((count / total) * 100).toFixed(1);
      const category = BUCKET_COLOR_MAP.get(label);
      const categoryClass = category ? ` bucket-${category}` : "";
      return `
            <div class="dist-row${categoryClass}">
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
  options?: {
    filters?: FilterState;
    unfilteredRollups?: Rollup[];
    availability?: DataAvailabilitySignal;
  },
): void {
  if (!container) return;
  clearChartTooltips(container);

  if (!rollups || rollups.length < 2) {
    const classification = options
      ? classifyEmptyState({
          chartType: "cycle_time_trend",
          filters: options.filters ?? {
            repos: [],
            teams: [],
            reviewers: [],
            authors: [],
          },
          unfilteredRollups: options.unfilteredRollups ?? [],
          filteredRollups: rollups ?? [],
          availability: options.availability ?? {
            reviewerDataPresent: false,
            reviewerDataEmpty: false,
            cycleTimePresent: false,
            reviewerRepoMode: "constrained",
            commentsStatus: "disabled",
          },
          minimumDataPoints: 2,
        })
      : null;
    renderNoData(
      container,
      classification?.message ?? "Not enough data for trend",
      classification?.hint ??
        "At least 2 weeks of data are needed to show trends.",
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
      "Try widening the date range or adjusting repository/team filters.",
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

  // Generate paths. Callers only reach this block when both rollups.length >= 2
  // and p50/p90 have >= 2 non-null entries, so displayRollups.length >= 2 and
  // every d.week in `data` was just derived from displayRollups — findIndex
  // cannot return -1 here.
  const generatePath = (data: { week: string; value: number }[]) => {
    const points = data.map((d) => {
      const dataIndex = displayRollups.findIndex((r) => r.week === d.week);
      const x =
        padding.left + (dataIndex / (displayRollups.length - 1)) * chartWidth;
      const y =
        padding.top + chartHeight - ((d.value - minVal) / range) * chartHeight;
      return { x, y, week: d.week, value: d.value };
    });
    const pathD = buildLinePath(points);
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

            <!-- Dots. data-tooltip="true" is required so addChartTooltips()
                 in charts.ts can attach hover/tap listeners — without it the
                 tooltip callback below is never invoked. -->
            ${p90Path ? p90Path.points.map((p) => `<circle class="line-chart-dot" data-tooltip="true" cx="${p.x}" cy="${p.y}" r="${dotRadius}" fill="var(--warning)" data-week="${escapeHtml(p.week)}" data-value="${escapeHtml(String(p.value))}" data-metric="P90"/>`).join("") : ""}
            ${p50Path ? p50Path.points.map((p) => `<circle class="line-chart-dot" data-tooltip="true" cx="${p.x}" cy="${p.y}" r="${dotRadius}" fill="var(--primary)" data-week="${escapeHtml(p.week)}" data-value="${escapeHtml(String(p.value))}" data-metric="P50"/>`).join("") : ""}
        </svg>
    `;

  // Dynamic legend: only show entries for metrics that actually rendered,
  // and mark metrics with some data but insufficient points for a trend line.
  const legendItems: string[] = [];
  if (p50Path) {
    legendItems.push(
      `<div class="legend-item"><span class="chart-tooltip-dot legend-p50"></span><span>P50 (Median)</span></div>`,
    );
  } else if (p50Data.length > 0) {
    legendItems.push(
      `<div class="legend-item legend-insufficient"><span class="chart-tooltip-dot legend-p50 dimmed"></span><span>P50 (Median) — insufficient points</span></div>`,
    );
  }
  if (p90Path) {
    legendItems.push(
      `<div class="legend-item"><span class="chart-tooltip-dot legend-p90"></span><span>P90</span></div>`,
    );
  } else if (p90Data.length > 0) {
    legendItems.push(
      `<div class="legend-item legend-insufficient"><span class="chart-tooltip-dot legend-p90 dimmed"></span><span>P90 — insufficient points</span></div>`,
    );
  }
  const legendHtml = `<div class="chart-legend">${legendItems.join("")}</div>`;

  // Truncation indicator
  const truncationHtml = renderTruncationIndicator(
    truncated,
    MAX_CYCLE_TIME_POINTS,
  );

  // SECURITY: Content is SVG from computed coordinates + escapeHtml'd week values
  renderTrustedHtml(
    container,
    `${truncationHtml}<div class="line-chart">${svgContent}</div>${legendHtml}`,
  );

  // Attach hover/tap tooltips to every .line-chart-dot. Each circle carries
  // data-tooltip="true" plus data-week/data-value/data-metric, so the
  // contentFn can read them directly via `as string` narrowing — we emit
  // those attributes ourselves a few lines above, so the narrowing is
  // guaranteed at runtime.
  addChartTooltips(container, (dot: HTMLElement) => {
    const week = dot.dataset["week"] as string;
    const value = parseFloat(dot.dataset["value"] as string);
    const metric = dot.dataset["metric"] as string;
    const legendClass = metric === "P50" ? "legend-p50" : "legend-p90";
    return `<div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
              <span class="chart-tooltip-label">
                <span class="chart-tooltip-dot ${legendClass}"></span>
                ${escapeHtml(metric)}
              </span>
              <span>${formatDuration(value)}</span>
            </div>`;
  });
}
