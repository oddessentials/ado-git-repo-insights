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
 * @param values - Array of numeric values (requires >= 2 points)
 */
export function renderSparkline(
  element: HTMLElement | null,
  values: number[],
): void {
  if (!element || !values || values.length < 2) {
    if (element) clearElement(element);
    return;
  }

  // Take last 8 values for sparkline
  const data = values.slice(-8);
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
 * Add tooltip interactions to a chart container.
 * @param container - Chart container element
 * @param contentFn - Function to generate tooltip content from data element
 */
export function addChartTooltips(
  container: HTMLElement,
  contentFn: (dot: HTMLElement) => string,
): void {
  const dots = container.querySelectorAll("[data-tooltip]");

  dots.forEach((dot) => {
    dot.addEventListener("mouseenter", () => {
      const content = contentFn(dot as HTMLElement);
      const tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip";
      // SECURITY: contentFn callers must use escapeHtml for user data
      renderTrustedHtml(tooltip, content);
      tooltip.style.position = "absolute";

      const rect = (dot as HTMLElement).getBoundingClientRect();
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top - 8}px`;
      tooltip.style.transform = "translateX(-50%) translateY(-100%)";

      document.body.appendChild(tooltip);
      (dot as HTMLElement).dataset.tooltipId =
        tooltip.id = `tooltip-${Date.now()}`;
    });

    dot.addEventListener("mouseleave", () => {
      const tooltipId = (dot as HTMLElement).dataset.tooltipId;
      if (tooltipId) {
        document.getElementById(tooltipId)?.remove();
      }
    });
  });
}
