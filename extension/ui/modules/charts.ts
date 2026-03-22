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

/** Pixel movement threshold to cancel a tap-to-tooltip gesture (scroll detection). */
export const SCROLL_CANCEL_THRESHOLD = 10;

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

  let cssClass = "metric-delta ";
  let arrow = "";

  if (isNeutral) {
    cssClass += "delta-neutral";
    arrow = "~";
  } else if (isPositive) {
    cssClass += inverse ? "delta-negative-inverse" : "delta-positive";
    arrow = "&#9650;"; // Up arrow
  } else {
    cssClass += inverse ? "delta-positive-inverse" : "delta-negative";
    arrow = "&#9660;"; // Down arrow
  }

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

  const data = nonNull.slice(-8);
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

/** Monotonic counter for unique tooltip IDs (avoids Date.now() collisions). */
let tooltipIdCounter = 0;

/** AbortController for the document-level tooltip dismiss listener. */
let tooltipDismissController: AbortController | null = null;

/**
 * Dismiss any active chart tooltip and clean up the document listener.
 */
function dismissActiveTooltip(): void {
  const existing = document.querySelector(".chart-tooltip");
  if (existing) existing.remove();
}

/**
 * Add tooltip interactions to a chart container.
 * Supports both hover (mouse) and tap/click (touch) with scroll-cancellation.
 *
 * Safe to call repeatedly on re-renders: the previous document-level dismiss
 * listener is aborted before attaching a new one, preventing accumulation.
 *
 * @param container - Chart container element
 * @param contentFn - Function to generate tooltip content from data element
 */
export function addChartTooltips(
  container: HTMLElement,
  contentFn: (dot: HTMLElement) => string,
): void {
  const dots = container.querySelectorAll("[data-tooltip]");

  // Abort any previous document-level dismiss listener to prevent accumulation
  if (tooltipDismissController) {
    tooltipDismissController.abort();
  }
  tooltipDismissController = new AbortController();

  function showTooltip(dot: HTMLElement): void {
    dismissActiveTooltip();
    const content = contentFn(dot);
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    renderTrustedHtml(tooltip, content);
    tooltip.style.position = "absolute";

    const rect = dot.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 8}px`;
    tooltip.style.transform = "translateX(-50%) translateY(-100%)";

    tooltip.id = `tooltip-${++tooltipIdCounter}`;
    document.body.appendChild(tooltip);
  }

  dots.forEach((dot) => {
    const el = dot as HTMLElement;
    let pointerOrigin: { x: number; y: number } | null = null;

    // Hover support (mouse)
    el.addEventListener("mouseenter", () => showTooltip(el));
    el.addEventListener("mouseleave", () => dismissActiveTooltip());

    // Tap/click support with scroll-cancellation
    el.addEventListener("pointerdown", (e: PointerEvent) => {
      pointerOrigin = { x: e.clientX, y: e.clientY };
    });

    el.addEventListener("pointerup", (e: PointerEvent) => {
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
    });
  });

  // Dismiss tooltip when clicking outside (with AbortController for cleanup)
  document.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (!document.querySelector(".chart-tooltip")) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tooltip]") && !target.closest(".chart-tooltip")) {
        dismissActiveTooltip();
      }
    },
    { signal: tooltipDismissController.signal },
  );
}
