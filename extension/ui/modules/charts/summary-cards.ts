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
  getLookbackWeekCount,
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
  /** Unfiltered rollups for dataset capability checks (defaults to rollups) */
  unfilteredRollups?: Rollup[];
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

  // Hide review-time cards when the underlying dataset has no review_time data,
  // so users don't see permanently blank KPIs on older datasets.
  // Uses unfiltered rollups for capability check: some filter paths (e.g. reviewer)
  // intentionally null review_time fields, which doesn't mean the feature is absent.
  const capabilityRollups = options.unfilteredRollups ?? rollups;
  const hasReviewTimeData = capabilityRollups.some(
    (r) => r.review_time_p50 != null || r.review_time_p90 != null,
  );
  toggleReviewTimeCards(containers, hasReviewTimeData);

  // Render metric values
  renderMetricValues(containers, current);

  // Render sample size subtitle on each card (FR-006, FR-007)
  // All cards show the filtered PR count as the sample size — this is the
  // evidence backing every KPI regardless of how the metric is derived.
  renderSampleSize(containers, current.totalPrs);

  // Attach info icons to summary card titles
  attachInfoIcons(containers);

  // Render sparklines
  const sparklineData = extractSparklineData(rollups);
  renderSparklines(containers, sparklineData);

  // Render sparkline time period labels (FR-010, FR-011)
  // Single shared label from filtered rollup count, capped by lookback window.
  renderSparklineLabels(containers, rollups.length);

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
 * Render sample size subtitle on each visible metric card.
 *
 * Every card shows the total filtered PR count — this is the evidence
 * backing the KPI regardless of how the metric is derived internally.
 * Applies .low-sample class when count is below LOW_SAMPLE_THRESHOLD (FR-009).
 */
function renderSampleSize(
  containers: SummaryCardsContainers,
  totalPrs: number,
): void {
  const label = `Based on ${totalPrs.toLocaleString()} ${totalPrs === 1 ? "PR" : "PRs"}`;

  const elements: (HTMLElement | null)[] = [
    containers.totalPrs,
    containers.cycleP50,
    containers.cycleP90,
    containers.reviewTimeP50,
    containers.reviewTimeP90,
    containers.authorsCount,
    containers.reviewersCount,
  ];

  const isLow = totalPrs < LOW_SAMPLE_THRESHOLD;

  for (const el of elements) {
    const card = el?.closest(".card") as HTMLElement | null;
    if (!card) continue;

    // Remove old sample-size element on re-render
    const existing = card.querySelector(".metric-sample-size");
    if (existing) existing.remove();

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
 * Render sparkline time period labels (e.g., "Last 8 weeks") on each card.
 * Uses a single shared label derived from the filtered rollup count,
 * capped by the sparkline lookback window, so all cards agree on the
 * displayed time range.
 */
function renderSparklineLabels(
  containers: SummaryCardsContainers,
  rollupCount: number,
): void {
  const sparklineElements: (HTMLElement | null)[] = [
    containers.totalPrsSparkline,
    containers.cycleP50Sparkline,
    containers.cycleP90Sparkline,
    containers.reviewTimeP50Sparkline,
    containers.reviewTimeP90Sparkline,
    containers.authorsSparkline,
    containers.reviewersSparkline,
  ];

  // Always clean up old labels first — prevents stale "Last N weeks"
  // from surviving when a re-render produces zero rollups.
  for (const el of sparklineElements) {
    if (!el) continue;
    const card = el.closest(".card") as HTMLElement | null;
    if (!card) continue;
    const existing = card.querySelector(".sparkline-label");
    if (existing) existing.remove();
  }

  const sharedSpan = getLookbackWeekCount(rollupCount);
  if (sharedSpan < 1) return;

  const text = `Last ${sharedSpan} ${sharedSpan === 1 ? "week" : "weeks"}`;

  for (const el of sparklineElements) {
    if (!el) continue;
    const card = el.closest(".card") as HTMLElement | null;
    if (!card) continue;

    const label = document.createElement("p");
    label.className = "sparkline-label";
    label.textContent = text;
    // Insert after the .metric-row that contains the sparkline.
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
