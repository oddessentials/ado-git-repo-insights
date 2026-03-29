/**
 * Summary Cards Chart Module
 *
 * Renders the summary metric cards showing PR count, cycle times,
 * authors, and reviewers with sparklines and delta indicators.
 *
 * DOM-INJECTED: All container elements are passed as parameters.
 * This module works identically in both extension and local dashboard modes.
 */

import type { Rollup } from "../../dataset-loader";
import {
  calculateMetrics,
  calculatePercentChange,
  extractSparklineData,
  type CalculatedMetrics,
} from "../metrics";
import {
  renderDelta,
  renderSparkline,
  SPARKLINE_LOOKBACK_WEEKS,
} from "../charts";
import { formatDuration } from "../shared/format";
import { LOW_SAMPLE_THRESHOLD } from "../shared/constants";
import { clearElement } from "../shared/render";
import { showInfoTooltip, dismissAllTooltips } from "../tooltip-manager";

/**
 * Metric explanations for info icons (FR-017, FR-018).
 * Plain-English descriptions of what each summary card metric represents.
 */
export const METRIC_EXPLANATIONS = new Map<string, string>([
  [
    "totalPrs",
    "Total merged pull requests in the selected period and filters.",
  ],
  [
    "cycleP50",
    "Median time from PR creation to merge. Half of all PRs completed faster than this.",
  ],
  [
    "cycleP90",
    "90th percentile cycle time. 90% of PRs completed faster. High values may indicate bottlenecks.",
  ],
  [
    "authorsCount",
    "Average number of unique PR authors per week in this period.",
  ],
  [
    "reviewersCount",
    "Average number of unique reviewers per week in this period.",
  ],
  [
    "reviewTimeP50",
    "Median time from first review request to review completion. Half of all reviews completed faster than this.",
  ],
  [
    "reviewTimeP90",
    "90th percentile review time. 90% of reviews completed faster. High values may indicate review bottlenecks.",
  ],
]);

/**
 * Container elements for summary cards.
 * All elements are optional - missing elements are safely skipped.
 */
export interface SummaryCardsContainers {
  // Value display elements
  totalPrs: HTMLElement | null;
  cycleP50: HTMLElement | null;
  cycleP90: HTMLElement | null;
  reviewTimeP50: HTMLElement | null;
  reviewTimeP90: HTMLElement | null;
  authorsCount: HTMLElement | null;
  reviewersCount: HTMLElement | null;

  // Sparkline container elements
  totalPrsSparkline: HTMLElement | null;
  cycleP50Sparkline: HTMLElement | null;
  cycleP90Sparkline: HTMLElement | null;
  reviewTimeP50Sparkline: HTMLElement | null;
  reviewTimeP90Sparkline: HTMLElement | null;
  authorsSparkline: HTMLElement | null;
  reviewersSparkline: HTMLElement | null;

  // Delta indicator elements
  totalPrsDelta: HTMLElement | null;
  cycleP50Delta: HTMLElement | null;
  cycleP90Delta: HTMLElement | null;
  reviewTimeP50Delta: HTMLElement | null;
  reviewTimeP90Delta: HTMLElement | null;
  authorsDelta: HTMLElement | null;
  reviewersDelta: HTMLElement | null;
}

/**
 * Optional performance metrics collector interface.
 * Matches the dashboard's metricsCollector pattern.
 */
export interface PerformanceCollector {
  mark(name: string): void;
  measure(name: string, startMark: string, endMark: string): void;
}

/**
 * Options for rendering summary cards.
 */
export interface RenderSummaryCardsOptions {
  /** Current period rollups */
  rollups: Rollup[];
  /** Previous period rollups for delta calculation */
  prevRollups?: Rollup[];
  /** DOM container elements */
  containers: SummaryCardsContainers;
  /** Optional performance metrics collector */
  metricsCollector?: PerformanceCollector | null;
}

/**
 * Render summary metric cards.
 *
 * Calculates metrics from rollups and renders values, sparklines,
 * and delta indicators into the provided container elements.
 *
 * @param options - Render options including rollups and container elements
 */
export function renderSummaryCards(options: RenderSummaryCardsOptions): void {
  const { rollups, prevRollups = [], containers, metricsCollector } = options;

  if (metricsCollector) metricsCollector.mark("render-summary-cards-start");

  const current = calculateMetrics(rollups);
  const previous = calculateMetrics(prevRollups);

  // Hide review-time cards when dataset has no review_time data at all,
  // so users don't see permanently blank KPIs on older datasets.
  const hasReviewTimeData = rollups.some(
    (r) => r.review_time_p50 != null || r.review_time_p90 != null,
  );
  toggleReviewTimeCards(containers, hasReviewTimeData);

  // Render metric values
  renderMetricValues(containers, current);

  // Render sample size subtitle on each card (FR-006, FR-007)
  // - Total PRs: "Based on N PRs" (metric IS the PR count)
  // - Weekly aggregate cards: "From N weeks" (metrics derived from rollups, not individual PRs)
  // - Review-time cards: "From N weeks" where N is weeks with non-null review_time data
  const weekCount = rollups.length;
  const rtP50WeekCount = rollups.filter((r) => r.review_time_p50 != null).length;
  const rtP90WeekCount = rollups.filter((r) => r.review_time_p90 != null).length;
  renderSampleSize(containers, current.totalPrs, weekCount, rtP50WeekCount, rtP90WeekCount);

  // Attach info icons to summary card titles
  attachInfoIcons(containers);

  // Render sparklines
  const sparklineData = extractSparklineData(rollups);
  renderSparklines(containers, sparklineData);

  // Render sparkline time period labels (FR-010, FR-011)
  // Labels derived from plotted data (after null filtering + lookback truncation),
  // not raw rollup count, so they accurately reflect what the sparkline shows.
  renderSparklineLabels(containers, sparklineData);

  // Render deltas (only if we have previous period data)
  if (prevRollups && prevRollups.length > 0) {
    renderDeltas(containers, current, previous);
  } else {
    clearDeltas(containers);
  }

  if (metricsCollector) {
    metricsCollector.mark("render-summary-cards-end");
    metricsCollector.mark("first-meaningful-paint");
    metricsCollector.measure(
      "init-to-fmp",
      "dashboard-init",
      "first-meaningful-paint",
    );
  }
}

/**
 * Format a week-count label with singular/plural handling.
 */
function formatWeekLabel(count: number): string {
  return `From ${count.toLocaleString()} ${count === 1 ? "week" : "weeks"}`;
}

/**
 * Render sample size subtitle on each visible metric card.
 *
 * Labels are metric-specific to accurately describe the data source:
 * - Total PRs: "Based on N PRs" (the metric IS the PR count)
 * - Weekly aggregate cards (cycle time, authors, reviewers): "From N weeks"
 *   (metrics derived from weekly rollup aggregates, not individual PRs)
 * - Review-time cards: "From N weeks" where N is weeks with non-null data
 *
 * Applies .low-sample class when count is below LOW_SAMPLE_THRESHOLD (FR-009).
 */
function renderSampleSize(
  containers: SummaryCardsContainers,
  totalPrs: number,
  weekCount: number,
  rtP50WeekCount: number,
  rtP90WeekCount: number,
): void {
  const prLabel = `Based on ${totalPrs.toLocaleString()} ${totalPrs === 1 ? "PR" : "PRs"}`;
  const weekLabel = formatWeekLabel(weekCount);

  // Map each container to its metric-specific source label and threshold count
  const entries: [HTMLElement | null, number, string][] = [
    [containers.totalPrs, totalPrs, prLabel],
    [containers.cycleP50, weekCount, weekLabel],
    [containers.cycleP90, weekCount, weekLabel],
    [containers.reviewTimeP50, rtP50WeekCount, formatWeekLabel(rtP50WeekCount)],
    [containers.reviewTimeP90, rtP90WeekCount, formatWeekLabel(rtP90WeekCount)],
    [containers.authorsCount, weekCount, weekLabel],
    [containers.reviewersCount, weekCount, weekLabel],
  ];

  for (const [el, count, label] of entries) {
    const card = el?.closest(".card") as HTMLElement | null;
    if (!card) continue;

    // Remove old sample-size element on re-render
    const existing = card.querySelector(".metric-sample-size");
    if (existing) existing.remove();

    const isLow = count < LOW_SAMPLE_THRESHOLD;
    const subtitle = document.createElement("p");
    subtitle.className = isLow ? "metric-sample-size low-sample" : "metric-sample-size";
    subtitle.textContent = label;
    // Insert after the h3 title
    const title = card.querySelector("h3");
    if (title?.nextSibling) {
      card.insertBefore(subtitle, title.nextSibling);
    } else {
      card.appendChild(subtitle);
    }
  }
}

/**
 * Compute the calendar span (in weeks) of the data actually plotted by
 * renderSparkline(). Mirrors its logic: filter nulls, take last
 * SPARKLINE_LOOKBACK_WEEKS, then measure from the first retained week
 * index to the last retained week index.
 *
 * Returns 0 when fewer than 2 non-null points exist (sparkline won't render).
 */
function plottedWeekSpan(values: (number | null)[]): number {
  // Collect indices of non-null values (matching renderSparkline's filter)
  const nonNullIndices: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values.at(i);
    if (v !== null && v !== undefined) nonNullIndices.push(i);
  }
  if (nonNullIndices.length < 2) return 0;

  // Take last SPARKLINE_LOOKBACK_WEEKS indices (matching renderSparkline's slice)
  const retained = nonNullIndices.slice(-SPARKLINE_LOOKBACK_WEEKS);
  const firstIdx = retained.at(0);
  const lastIdx = retained.at(-1);
  if (firstIdx === undefined || lastIdx === undefined) return 0;

  // Calendar span = distance between first and last retained week + 1
  return lastIdx - firstIdx + 1;
}

/**
 * Render sparkline time period labels (e.g., "Last 8 weeks") on each card.
 * Labels show the actual calendar span of the plotted data, not the count
 * of non-null points. This prevents sparse series (e.g., 3 points drawn
 * from an 8-week range) from understating the time span.
 */
function renderSparklineLabels(
  containers: SummaryCardsContainers,
  sparklineData: SparklineData,
): void {
  // Each sparkline element paired with its data series
  const entries: [HTMLElement | null, (number | null)[]][] = [
    [containers.totalPrsSparkline, sparklineData.prCounts],
    [containers.cycleP50Sparkline, sparklineData.p50s],
    [containers.cycleP90Sparkline, sparklineData.p90s],
    [containers.reviewTimeP50Sparkline, sparklineData.reviewTimeP50s],
    [containers.reviewTimeP90Sparkline, sparklineData.reviewTimeP90s],
    [containers.authorsSparkline, sparklineData.authors],
    [containers.reviewersSparkline, sparklineData.reviewers],
  ];

  for (const [el, series] of entries) {
    if (!el) continue;
    const card = el.closest(".card") as HTMLElement | null;
    if (!card) continue;

    // Remove old label on re-render
    const existing = card.querySelector(".sparkline-label");
    if (existing) existing.remove();

    const span = plottedWeekSpan(series);
    if (span < 2) continue; // renderSparkline requires >= 2 points; no label for empty sparklines

    const text = `Last ${span} ${span === 1 ? "week" : "weeks"}`;
    const label = document.createElement("p");
    label.className = "sparkline-label";
    label.textContent = text;
    // Insert after the .metric-row that contains the sparkline.
    // The sparkline is inside .metric-row (not a direct child of .card),
    // so we walk up to .metric-row and insert after it.
    const metricRow = el.closest(".metric-row") as HTMLElement | null;
    const insertTarget = metricRow ?? el;
    if (insertTarget.nextSibling) {
      card.insertBefore(label, insertTarget.nextSibling);
    } else {
      card.appendChild(label);
    }
  }
}

/**
 * Show or hide review-time summary cards based on data availability.
 * Walks from the value element up to its parent .card and toggles display.
 */
function toggleReviewTimeCards(
  containers: SummaryCardsContainers,
  visible: boolean,
): void {
  const reviewTimeElements = [
    containers.reviewTimeP50,
    containers.reviewTimeP90,
  ];
  for (const el of reviewTimeElements) {
    const card = el?.closest(".card") as HTMLElement | null;
    if (card) {
      card.style.display = visible ? "" : "none";
    }
  }
}

/**
 * Render metric values into container elements.
 */
function renderMetricValues(
  containers: SummaryCardsContainers,
  metrics: CalculatedMetrics,
): void {
  if (containers.totalPrs) {
    containers.totalPrs.textContent = metrics.totalPrs.toLocaleString();
  }
  if (containers.cycleP50) {
    containers.cycleP50.textContent =
      metrics.cycleP50 !== null ? formatDuration(metrics.cycleP50) : "-";
  }
  if (containers.cycleP90) {
    containers.cycleP90.textContent =
      metrics.cycleP90 !== null ? formatDuration(metrics.cycleP90) : "-";
  }
  if (containers.reviewTimeP50) {
    containers.reviewTimeP50.textContent =
      metrics.reviewTimeP50 !== null
        ? formatDuration(metrics.reviewTimeP50)
        : "-";
  }
  if (containers.reviewTimeP90) {
    containers.reviewTimeP90.textContent =
      metrics.reviewTimeP90 !== null
        ? formatDuration(metrics.reviewTimeP90)
        : "-";
  }
  if (containers.authorsCount) {
    containers.authorsCount.textContent = metrics.avgAuthors.toLocaleString();
  }
  if (containers.reviewersCount) {
    containers.reviewersCount.textContent =
      metrics.avgReviewers.toLocaleString();
  }
}

/**
 * Sparkline data structure from extractSparklineData.
 */
interface SparklineData {
  prCounts: number[];
  p50s: (number | null)[];
  p90s: (number | null)[];
  reviewTimeP50s: (number | null)[];
  reviewTimeP90s: (number | null)[];
  authors: number[];
  reviewers: number[];
}

/**
 * Render sparklines into container elements.
 */
function renderSparklines(
  containers: SummaryCardsContainers,
  data: SparklineData,
): void {
  renderSparkline(containers.totalPrsSparkline, data.prCounts);
  renderSparkline(containers.cycleP50Sparkline, data.p50s);
  renderSparkline(containers.cycleP90Sparkline, data.p90s);
  renderSparkline(containers.reviewTimeP50Sparkline, data.reviewTimeP50s);
  renderSparkline(containers.reviewTimeP90Sparkline, data.reviewTimeP90s);
  renderSparkline(containers.authorsSparkline, data.authors);
  renderSparkline(containers.reviewersSparkline, data.reviewers);
}

/**
 * Render delta indicators with period-over-period comparison.
 */
function renderDeltas(
  containers: SummaryCardsContainers,
  current: CalculatedMetrics,
  previous: CalculatedMetrics,
): void {
  renderDelta(
    containers.totalPrsDelta,
    calculatePercentChange(current.totalPrs, previous.totalPrs),
    false,
  );
  renderDelta(
    containers.cycleP50Delta,
    calculatePercentChange(current.cycleP50, previous.cycleP50),
    true, // Inverse: lower is better
  );
  renderDelta(
    containers.cycleP90Delta,
    calculatePercentChange(current.cycleP90, previous.cycleP90),
    true, // Inverse: lower is better
  );
  renderDelta(
    containers.reviewTimeP50Delta,
    calculatePercentChange(current.reviewTimeP50, previous.reviewTimeP50),
    true, // Inverse: lower review time is better
  );
  renderDelta(
    containers.reviewTimeP90Delta,
    calculatePercentChange(current.reviewTimeP90, previous.reviewTimeP90),
    true, // Inverse: lower review time is better
  );
  renderDelta(
    containers.authorsDelta,
    calculatePercentChange(current.avgAuthors, previous.avgAuthors),
    false,
  );
  renderDelta(
    containers.reviewersDelta,
    calculatePercentChange(current.avgReviewers, previous.avgReviewers),
    false,
  );
}

/**
 * Clear delta indicators when no previous period data exists.
 */
function clearDeltas(containers: SummaryCardsContainers): void {
  const deltaElements = [
    containers.totalPrsDelta,
    containers.cycleP50Delta,
    containers.cycleP90Delta,
    containers.reviewTimeP50Delta,
    containers.reviewTimeP90Delta,
    containers.authorsDelta,
    containers.reviewersDelta,
  ];

  deltaElements.forEach((el) => {
    if (el) {
      clearElement(el);
      el.className = "metric-delta";
    }
  });
}

/**
 * Metric ID to container value element mapping.
 * Used to locate the card title element for info icon injection.
 */
const METRIC_TO_CONTAINER_KEY: Array<{
  metricId: string;
  containerKey: keyof SummaryCardsContainers;
}> = [
  { metricId: "totalPrs", containerKey: "totalPrs" },
  { metricId: "cycleP50", containerKey: "cycleP50" },
  { metricId: "cycleP90", containerKey: "cycleP90" },
  { metricId: "reviewTimeP50", containerKey: "reviewTimeP50" },
  { metricId: "reviewTimeP90", containerKey: "reviewTimeP90" },
  { metricId: "authorsCount", containerKey: "authorsCount" },
  { metricId: "reviewersCount", containerKey: "reviewersCount" },
];

/** Per-button AbortControllers to prevent listener accumulation on re-render. */
const infoIconControllers = new WeakMap<HTMLElement, AbortController>();

/**
 * Attach info icons to summary card titles.
 *
 * Finds the card title element (h3) for each metric container
 * and appends an info icon button that shows the metric explanation
 * on hover or click.
 *
 * Safe to call on re-render: removes old icons and their listeners
 * before creating new ones, preventing memory leaks.
 */
function attachInfoIcons(containers: SummaryCardsContainers): void {
  const containerMap = new Map<string, HTMLElement | null>(
    Object.entries(containers),
  );
  for (const { metricId, containerKey } of METRIC_TO_CONTAINER_KEY) {
    const valueEl = containerMap.get(containerKey) ?? null;
    if (!valueEl) continue;

    // Find the parent card element, then locate the h3 title
    const card = valueEl.closest(".card");
    if (!card) continue;

    const title = card.querySelector("h3");
    if (!title) continue;

    // Remove old info icon and its listeners on re-render
    const existing = title.querySelector(".info-icon-btn") as HTMLElement | null;
    if (existing) {
      infoIconControllers.get(existing)?.abort();
      infoIconControllers.delete(existing);
      existing.remove();
    }

    const explanation = METRIC_EXPLANATIONS.get(metricId) ?? "";
    if (!explanation) continue;

    const controller = new AbortController();
    const { signal } = controller;

    const btn = document.createElement("button");
    btn.className = "info-icon-btn";
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", `About this metric`);
    btn.setAttribute("data-info-tooltip", metricId);
    btn.textContent = "\u2139"; // Unicode info symbol ⓘ

    // Use pointer events for cross-device support (mouse, touch, pen)
    btn.addEventListener("pointerenter", () => {
      showInfoTooltip(btn, explanation);
    }, { signal });
    btn.addEventListener("pointerleave", () => {
      dismissAllTooltips();
    }, { signal });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Toggle: if info tooltip already showing for this button, dismiss it;
      // otherwise show it. This handles touch devices where pointerleave
      // doesn't fire after a tap.
      const existing = document.querySelector(".info-tooltip");
      if (existing) {
        dismissAllTooltips();
      } else {
        showInfoTooltip(btn, explanation);
        // Add one-time document click listener to dismiss on tap-elsewhere.
        // Deferred to next frame so this click doesn't immediately trigger it.
        requestAnimationFrame(() => {
          const dismissOnce = () => {
            dismissAllTooltips();
            document.removeEventListener("click", dismissOnce);
          };
          document.addEventListener("click", dismissOnce);
        });
      }
    }, { signal });

    infoIconControllers.set(btn, controller);
    title.appendChild(btn);
  }
}
