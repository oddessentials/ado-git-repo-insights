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
import { renderDelta, renderSparkline } from "../charts";
import { formatDuration } from "../shared/format";
import { clearElement } from "../shared/render";
import { showInfoTooltip, dismissAllTooltips } from "../tooltip-manager";

/**
 * Metric explanations for info icons (FR-017, FR-018).
 * Plain-English descriptions of what each summary card metric represents.
 */
export const METRIC_EXPLANATIONS: Record<string, string> = {
  totalPrs:
    "Total merged pull requests in the selected period and filters.",
  cycleP50:
    "Median time from PR creation to merge. Half of all PRs completed faster than this.",
  cycleP90:
    "90th percentile cycle time. 90% of PRs completed faster. High values may indicate bottlenecks.",
  authorsCount:
    "Average number of unique PR authors per week in this period.",
  reviewersCount:
    "Average number of unique reviewers per week in this period.",
};

/**
 * Container elements for summary cards.
 * All elements are optional - missing elements are safely skipped.
 */
export interface SummaryCardsContainers {
  // Value display elements
  totalPrs: HTMLElement | null;
  cycleP50: HTMLElement | null;
  cycleP90: HTMLElement | null;
  authorsCount: HTMLElement | null;
  reviewersCount: HTMLElement | null;

  // Sparkline container elements
  totalPrsSparkline: HTMLElement | null;
  cycleP50Sparkline: HTMLElement | null;
  cycleP90Sparkline: HTMLElement | null;
  authorsSparkline: HTMLElement | null;
  reviewersSparkline: HTMLElement | null;

  // Delta indicator elements
  totalPrsDelta: HTMLElement | null;
  cycleP50Delta: HTMLElement | null;
  cycleP90Delta: HTMLElement | null;
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

  // Render metric values
  renderMetricValues(containers, current);

  // Attach info icons to summary card titles
  attachInfoIcons(containers);

  // Render sparklines
  const sparklineData = extractSparklineData(rollups);
  renderSparklines(containers, sparklineData);

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
  for (const { metricId, containerKey } of METRIC_TO_CONTAINER_KEY) {
    // eslint-disable-next-line security/detect-object-injection -- SECURITY: containerKey is from METRIC_TO_CONTAINER_KEY constant, not user input
    const valueEl = containers[containerKey];
    if (!valueEl) continue;

    // Find the parent card element, then locate the h3 title
    const card = valueEl.closest(".metric-card");
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

    // eslint-disable-next-line security/detect-object-injection -- SECURITY: metricId is from METRIC_TO_CONTAINER_KEY constant, not user input
    const explanation = METRIC_EXPLANATIONS[metricId] ?? "";
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
