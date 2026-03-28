/**
 * Tooltip Manager — Cross-System Tooltip Coordinator
 *
 * Enforces mutual exclusivity between chart tooltips and info tooltips.
 * Only one tooltip of any kind may exist in the DOM at any time.
 *
 * Lifecycle invariant: dismiss -> create -> position -> append
 * This sequence is enforced as a tested invariant per FR-004.
 */

import { renderTrustedHtml } from "./shared/render";

/** Controller for the scroll/resize dismiss listener. */
let scrollDismissController: AbortController | null = null;

/** Attach scroll/resize listeners that dismiss tooltips on viewport change. */
function ensureScrollDismissListener(): void {
  if (scrollDismissController) return;
  scrollDismissController = new AbortController();
  const { signal } = scrollDismissController;

  const dismiss = () => dismissAllTooltips();
  window.addEventListener("scroll", dismiss, { signal, passive: true });
  window.addEventListener("resize", dismiss, { signal, passive: true });
}

/** Remove scroll/resize listeners when no tooltip is visible. */
function releaseScrollDismissListener(): void {
  scrollDismissController?.abort();
  scrollDismissController = null;
}

/** Dismiss all tooltips from both chart and info systems. */
export function dismissAllTooltips(): void {
  const chartTooltip = document.querySelector(".chart-tooltip");
  if (chartTooltip) chartTooltip.remove();
  const infoTooltip = document.querySelector(".info-tooltip");
  if (infoTooltip) infoTooltip.remove();
  releaseScrollDismissListener();
}

/**
 * Position a tooltip within viewport bounds using position: fixed.
 *
 * Default: centered horizontally above the target with 8px gap.
 * Flips below if overflow top; clamps left/right if overflow edges.
 */
function positionTooltip(
  tooltip: HTMLElement,
  targetRect: DOMRect,
): void {
  // Append temporarily to measure dimensions
  tooltip.style.visibility = "hidden";
  tooltip.style.position = "fixed";
  document.body.appendChild(tooltip);

  const tooltipRect = tooltip.getBoundingClientRect();
  const gap = 8;

  // Vertical: prefer above, flip below if overflow top
  let top = targetRect.top - tooltipRect.height - gap;
  if (top < 0) {
    top = targetRect.bottom + gap;
  }
  // Clamp to viewport bottom
  if (top + tooltipRect.height > window.innerHeight) {
    top = window.innerHeight - tooltipRect.height - 4;
  }

  // Horizontal: center on target, clamp to viewport edges
  let left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
  if (left < 4) {
    left = 4;
  }
  if (left + tooltipRect.width > window.innerWidth - 4) {
    left = window.innerWidth - tooltipRect.width - 4;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.style.visibility = "";
}

/**
 * Show a chart tooltip anchored to a data element.
 *
 * @param target - The data element to anchor to (must have [data-tooltip])
 * @param content - Trusted HTML content for the tooltip
 */
export function showChartTooltip(target: HTMLElement, content: string): void {
  // Step 1: Dismiss all existing tooltips
  dismissAllTooltips();

  // Step 2: Create tooltip element
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  renderTrustedHtml(tooltip, content);
  tooltip.style.position = "fixed";

  // Step 3: Position within viewport bounds
  const rect = target.getBoundingClientRect();
  positionTooltip(tooltip, rect);

  // Step 4: Dismiss on scroll/resize (tooltip stays at old fixed coords otherwise)
  ensureScrollDismissListener();
}

/**
 * Show an info tooltip anchored to an info icon.
 *
 * @param target - The info icon element
 * @param content - Plain text explanation
 */
export function showInfoTooltip(target: HTMLElement, content: string): void {
  // Step 1: Dismiss all existing tooltips
  dismissAllTooltips();

  // Step 2: Create tooltip element
  const tooltip = document.createElement("div");
  tooltip.className = "info-tooltip";
  tooltip.textContent = content;
  tooltip.style.position = "fixed";

  // Step 3: Position within viewport bounds
  const rect = target.getBoundingClientRect();
  positionTooltip(tooltip, rect);

  // Step 4: Dismiss on scroll/resize
  ensureScrollDismissListener();
}

/**
 * Structural assertion: verify no intermediate positioned ancestors
 * exist between document.body and chart containers that would break
 * position: fixed tooltip placement.
 *
 * Call once during dashboard initialization. Logs a warning if violated.
 */
export function assertTooltipStructure(): void {
  const mainContent = document.getElementById("main-content");
  if (!mainContent) return;

  let el: HTMLElement | null = mainContent;
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const position = style.getPropertyValue("position");
    if (
      position === "relative" ||
      position === "absolute" ||
      position === "fixed" ||
      position === "sticky"
    ) {
      const transform = style.getPropertyValue("transform");
      if (transform && transform !== "none") {
        console.warn(
          `[tooltip-manager] Positioned ancestor with transform detected: ` +
            `<${el.tagName.toLowerCase()} id="${el.id}"> has position: ${position}, ` +
            `transform: ${transform}. This may break tooltip positioning.`,
        );
      }
    }
    el = el.parentElement;
  }
}
