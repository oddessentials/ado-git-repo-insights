"use strict";
/**
 * Summary Cards Chart Module
 *
 * Renders the summary metric cards showing PR count, cycle times,
 * authors, and reviewers with sparklines and delta indicators.
 *
 * DOM-INJECTED: All container elements are passed as parameters.
 * This module works identically in both extension and local dashboard modes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSummaryCards = renderSummaryCards;
const metrics_1 = require("../metrics");
const charts_1 = require("../charts");
const format_1 = require("../shared/format");
/**
 * Render summary metric cards.
 *
 * Calculates metrics from rollups and renders values, sparklines,
 * and delta indicators into the provided container elements.
 *
 * @param options - Render options including rollups and container elements
 */
function renderSummaryCards(options) {
    const { rollups, prevRollups = [], containers, metricsCollector } = options;
    if (metricsCollector)
        metricsCollector.mark("render-summary-cards-start");
    const current = (0, metrics_1.calculateMetrics)(rollups);
    const previous = (0, metrics_1.calculateMetrics)(prevRollups);
    // Render metric values
    renderMetricValues(containers, current);
    // Render sparklines
    const sparklineData = (0, metrics_1.extractSparklineData)(rollups);
    renderSparklines(containers, sparklineData);
    // Render deltas (only if we have previous period data)
    if (prevRollups && prevRollups.length > 0) {
        renderDeltas(containers, current, previous);
    }
    else {
        clearDeltas(containers);
    }
    if (metricsCollector) {
        metricsCollector.mark("render-summary-cards-end");
        metricsCollector.mark("first-meaningful-paint");
        metricsCollector.measure("init-to-fmp", "dashboard-init", "first-meaningful-paint");
    }
}
/**
 * Render metric values into container elements.
 */
function renderMetricValues(containers, metrics) {
    if (containers.totalPrs) {
        containers.totalPrs.textContent = metrics.totalPrs.toLocaleString();
    }
    if (containers.cycleP50) {
        containers.cycleP50.textContent =
            metrics.cycleP50 !== null ? (0, format_1.formatDuration)(metrics.cycleP50) : "-";
    }
    if (containers.cycleP90) {
        containers.cycleP90.textContent =
            metrics.cycleP90 !== null ? (0, format_1.formatDuration)(metrics.cycleP90) : "-";
    }
    if (containers.authorsCount) {
        containers.authorsCount.textContent = metrics.avgAuthors.toLocaleString();
    }
    if (containers.reviewersCount) {
        containers.reviewersCount.textContent = metrics.avgReviewers.toLocaleString();
    }
}
/**
 * Render sparklines into container elements.
 */
function renderSparklines(containers, data) {
    (0, charts_1.renderSparkline)(containers.totalPrsSparkline, data.prCounts);
    (0, charts_1.renderSparkline)(containers.cycleP50Sparkline, data.p50s);
    (0, charts_1.renderSparkline)(containers.cycleP90Sparkline, data.p90s);
    (0, charts_1.renderSparkline)(containers.authorsSparkline, data.authors);
    (0, charts_1.renderSparkline)(containers.reviewersSparkline, data.reviewers);
}
/**
 * Render delta indicators with period-over-period comparison.
 */
function renderDeltas(containers, current, previous) {
    (0, charts_1.renderDelta)(containers.totalPrsDelta, (0, metrics_1.calculatePercentChange)(current.totalPrs, previous.totalPrs), false);
    (0, charts_1.renderDelta)(containers.cycleP50Delta, (0, metrics_1.calculatePercentChange)(current.cycleP50, previous.cycleP50), true);
    (0, charts_1.renderDelta)(containers.cycleP90Delta, (0, metrics_1.calculatePercentChange)(current.cycleP90, previous.cycleP90), true);
    (0, charts_1.renderDelta)(containers.authorsDelta, (0, metrics_1.calculatePercentChange)(current.avgAuthors, previous.avgAuthors), false);
    (0, charts_1.renderDelta)(containers.reviewersDelta, (0, metrics_1.calculatePercentChange)(current.avgReviewers, previous.avgReviewers), false);
}
/**
 * Clear delta indicators when no previous period data exists.
 */
function clearDeltas(containers) {
    const deltaElements = [
        containers.totalPrsDelta,
        containers.cycleP50Delta,
        containers.cycleP90Delta,
        containers.authorsDelta,
        containers.reviewersDelta,
    ];
    deltaElements.forEach((el) => {
        if (el) {
            el.innerHTML = "";
            el.className = "metric-delta";
        }
    });
}
//# sourceMappingURL=summary-cards.js.map