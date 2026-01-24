"use strict";
/**
 * Chart rendering utilities for dashboard.
 *
 * These functions receive DOM elements from dashboard.ts and render
 * visual components. They follow the chart render contract:
 * - Container cleared/created
 * - Expected series counts/labels
 * - Graceful handling of empty/edge datasets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDelta = renderDelta;
exports.renderSparkline = renderSparkline;
exports.addChartTooltips = addChartTooltips;
/**
 * Render a delta indicator element.
 * @param element - Target element (or null for no-op)
 * @param percentChange - Percentage change value (null clears indicator)
 * @param inverse - If true, positive change is bad (e.g., cycle time increase)
 */
function renderDelta(element, percentChange, inverse = false) {
    if (!element)
        return;
    if (percentChange === null) {
        element.innerHTML = "";
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
    }
    else if (isPositive) {
        cssClass += inverse ? "delta-negative-inverse" : "delta-positive";
        arrow = "&#9650;"; // Up arrow
    }
    else {
        cssClass += inverse ? "delta-positive-inverse" : "delta-negative";
        arrow = "&#9660;"; // Down arrow
    }
    const sign = isPositive ? "+" : "";
    element.className = cssClass;
    element.innerHTML = `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">vs prev</span>`;
}
/**
 * Render a sparkline SVG from data points.
 * @param element - Target element (or null for no-op)
 * @param values - Array of numeric values (requires >= 2 points)
 */
function renderSparkline(element, values) {
    if (!element || !values || values.length < 2) {
        if (element)
            element.innerHTML = "";
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
        const y = height - padding - ((val - minVal) / range) * (height - padding * 2);
        return { x, y };
    });
    // Create path
    const pathD = points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(" ");
    // Create area path (closed)
    const areaD = pathD +
        ` L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`;
    // Last point for dot
    const lastPoint = points[points.length - 1];
    element.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <path class="sparkline-area" d="${areaD}"/>
            <path class="sparkline-line" d="${pathD}"/>
            <circle class="sparkline-dot" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="2"/>
        </svg>
    `;
}
/**
 * Add tooltip interactions to a chart container.
 * @param container - Chart container element
 * @param contentFn - Function to generate tooltip content from data element
 */
function addChartTooltips(container, contentFn) {
    const dots = container.querySelectorAll("[data-tooltip]");
    dots.forEach((dot) => {
        dot.addEventListener("mouseenter", () => {
            const content = contentFn(dot);
            const tooltip = document.createElement("div");
            tooltip.className = "chart-tooltip";
            tooltip.innerHTML = content;
            tooltip.style.position = "absolute";
            const rect = dot.getBoundingClientRect();
            tooltip.style.left = `${rect.left + rect.width / 2}px`;
            tooltip.style.top = `${rect.top - 8}px`;
            tooltip.style.transform = "translateX(-50%) translateY(-100%)";
            document.body.appendChild(tooltip);
            dot.dataset.tooltipId = tooltip.id =
                `tooltip-${Date.now()}`;
        });
        dot.addEventListener("mouseleave", () => {
            const tooltipId = dot.dataset.tooltipId;
            if (tooltipId) {
                document.getElementById(tooltipId)?.remove();
            }
        });
    });
}
//# sourceMappingURL=charts.js.map