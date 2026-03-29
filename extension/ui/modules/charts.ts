/**
 * Chart rendering utilities for dashboard.
 *
 * These functions receive DOM elements from dashboard.ts and render
 * visual components. They follow the chart render contract:
 * - Container cleared/created
 * - Expected series counts/labels
 * - Graceful handling of empty/edge datasets
 */

import { clearElement, renderTrustedHtml } from "./shared/render";
import {
  dismissAllTooltips,
  showChartTooltip,
} from "./tooltip-manager";

/** Pixel movement threshold to cancel a tap-to-tooltip gesture (scroll detection). */
export const SCROLL_CANCEL_THRESHOLD = 10;

/** Number of recent non-null weeks to display in sparklines. */
export const SPARKLINE_LOOKBACK_WEEKS = 8;

/**
 * Return the actual number of sparkline weeks available, capped at SPARKLINE_LOOKBACK_WEEKS.
 * Single source of truth for sparkline time labels — all cards MUST use this.
 */
export function getLookbackWeekCount(rollupCount: number): number {
  return Math.min(rollupCount, SPARKLINE_LOOKBACK_WEEKS);
}

/**
 * Render a delta indicator element.
 * @param element - Target element (or null for no-op)
 * @param percentChange - Percentage change value (null clears indicator)
 * @param inverse - If true, positive change is bad (e.g., cycle time increase)
 */
export function renderDelta(
  element: HTMLElement | null,
  percentChange: number | null,
  inverse = false,
): void {
  if (!element) return;

  if (percentChange === null) {
    clearElement(element);
    element.className = "metric-delta";
    return;
  }

  const isNeutral = Math.abs(percentChange) < 2; // Within 2% is neutral
  const isPositive = percentChange > 0;
  const absChange = Math.abs(percentChange);

  const cssClass = isNeutral
    ? "metric-delta delta-neutral"
    : isPositive
      ? `metric-delta ${inverse ? "delta-negative-inverse" : "delta-positive"}`
      : `metric-delta ${inverse ? "delta-positive-inverse" : "delta-negative"}`;
  const arrow = isNeutral ? "~" : isPositive ? "&#9650;" : "&#9660;";

  const sign = isPositive ? "+" : "";
  element.className = cssClass;
  // SECURITY: All values are computed from numbers and code constants
  renderTrustedHtml(
    element,
    `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">vs prev</span>`,
  );
}

/**
 * Render a sparkline SVG from data points.
 * @param element - Target element (or null for no-op)
 * @param values - Array of numeric values (requires >= 2 non-null points)
 */
export function renderSparkline(
  element: HTMLElement | null,
  values: (number | null)[],
): void {
  if (!element || !values) {
    if (element) clearElement(element);
    return;
  }

  // Filter out null values (e.g. weeks with insufficient data for cycle times)
  // then take the last 8 non-null values for the sparkline
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length < 2) {
    clearElement(element);
    return;
  }

  const data = nonNull.slice(-SPARKLINE_LOOKBACK_WEEKS);
  const width = 60;
  const height = 24;
  const padding = 2;

  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);
  const range = maxVal - minVal || 1;

  // Calculate points
  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y =
      height - padding - ((val - minVal) / range) * (height - padding * 2);
    return { x, y };
  });

  // Create path
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  // Points array is guaranteed non-empty (values.length >= 2 checked above)
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return; // TypeScript guard - never reached at runtime

  // Create area path (closed)
  const areaD =
    pathD +
    ` L ${lastPoint.x.toFixed(1)} ${height - padding} L ${firstPoint.x.toFixed(1)} ${height - padding} Z`;

  // SECURITY: All SVG content is computed from numeric values
  renderTrustedHtml(
    element,
    `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <path class="sparkline-area" d="${areaD}"/>
            <path class="sparkline-line" d="${pathD}"/>
            <circle class="sparkline-dot" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="2"/>
        </svg>
    `,
  );
}

/**
 * Per-container AbortControllers so re-rendering one chart doesn't kill
 * listeners on other charts. WeakMap avoids leaking removed containers.
 */
const containerControllers = new WeakMap<HTMLElement, AbortController>();

/** Containers that currently own active tooltip listeners. */
const activeTooltipContainers = new WeakSet<HTMLElement>();

/** Shared document-level dismiss listener controller. */
let dismissListenerController: AbortController | null = null;

/** Count of containers with active tooltip listeners. */
let activeTooltipContainerCount = 0;

/**
 * Dismiss any active chart tooltip.
 * Delegates to the shared tooltip manager to also dismiss info tooltips.
 */
function dismissActiveTooltip(): void {
  dismissAllTooltips();
}

function ensureDismissListener(): void {
  if (dismissListenerController) return;
  dismissListenerController = new AbortController();
  const { signal } = dismissListenerController;
  document.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (!document.querySelector(".chart-tooltip")) return;
      const target = e.target as HTMLElement;
      if (
        !target.closest("[data-tooltip]") &&
        !target.closest(".chart-tooltip")
      ) {
        dismissActiveTooltip();
      }
    },
    { signal },
  );
}

function releaseDismissListenerIfUnused(): void {
  if (activeTooltipContainerCount > 0) return;
  dismissListenerController?.abort();
  dismissListenerController = null;
}

/**
 * Remove tooltip listeners associated with a specific chart container.
 * Safe to call even if the container has no active tooltip listeners.
 *
 * @param container - Chart container to clean up
 */
export function clearChartTooltips(container: HTMLElement | null): void {
  if (!container) return;
  containerControllers.get(container)?.abort();
  containerControllers.delete(container);
  if (activeTooltipContainers.delete(container)) {
    activeTooltipContainerCount = Math.max(0, activeTooltipContainerCount - 1);
  }
  dismissActiveTooltip();
  releaseDismissListenerIfUnused();
}

/**
 * Add tooltip interactions to a chart container.
 * Supports both hover (mouse) and tap/click (touch) with scroll-cancellation.
 *
 * Safe to call repeatedly on re-renders: only the listeners for *this*
 * container are aborted — other charts keep their tooltips intact.
 *
 * @param container - Chart container element
 * @param contentFn - Function to generate tooltip content from data element
 */
export function addChartTooltips(
  container: HTMLElement,
  contentFn: (dot: HTMLElement) => string,
): void {
  clearChartTooltips(container);
  const dots = container.querySelectorAll("[data-tooltip]");
  const controller = new AbortController();
  containerControllers.set(container, controller);
  activeTooltipContainers.add(container);
  activeTooltipContainerCount += 1;
  ensureDismissListener();
  const { signal } = controller;

  function showTooltip(dot: HTMLElement): void {
    const content = contentFn(dot);
    showChartTooltip(dot, content);
  }

  dots.forEach((dot) => {
    const el = dot as HTMLElement;
    let pointerOrigin: { x: number; y: number } | null = null;

    // Hover support (mouse)
    el.addEventListener("mouseenter", () => showTooltip(el), { signal });
    el.addEventListener("mouseleave", () => dismissActiveTooltip(), { signal });

    // Tap/click support with scroll-cancellation
    el.addEventListener(
      "pointerdown",
      (e: PointerEvent) => {
        pointerOrigin = { x: e.clientX, y: e.clientY };
      },
      { signal },
    );

    el.addEventListener(
      "pointerup",
      (e: PointerEvent) => {
        if (!pointerOrigin) return;
        const dx = e.clientX - pointerOrigin.x;
        const dy = e.clientY - pointerOrigin.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        pointerOrigin = null;

        if (distance < SCROLL_CANCEL_THRESHOLD) {
          // Prevent the synthesized click from immediately dismissing the
          // tooltip. This also suppresses native click handlers on the same
          // element after a tap, so avoid relying on click for tooltip dots.
          e.preventDefault();
          showTooltip(el);
        }
      },
      { signal },
    );
  });
}
