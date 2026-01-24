"use strict";
/**
 * DOM element caching and typed accessor.
 *
 * This module contains the SINGLE DOCUMENTED 'any' exception for the DOM cache.
 * The cache stores HTMLElements and NodeLists; use getElement<T>() for typed access.
 *
 * INVARIANT: No other module may use 'any' types. This is enforced by ESLint/tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getElement = getElement;
exports.getNodeList = getNodeList;
exports.cacheElement = cacheElement;
exports.cacheElements = cacheElements;
exports.clearElementCache = clearElementCache;
const elements = {};
/**
 * Typed DOM element accessor.
 * Provides type-safe access to cached DOM elements.
 * @param id - Element ID from cache
 * @returns Typed element or null
 */
function getElement(id) {
    const el = elements[id];
    if (el instanceof HTMLElement) {
        return el;
    }
    return null;
}
/**
 * Get a NodeList from the cache.
 */
function getNodeList(id) {
    const el = elements[id];
    if (el instanceof NodeList) {
        return el;
    }
    return null;
}
/**
 * Cache a single element by ID.
 */
function cacheElement(id) {
    elements[id] = document.getElementById(id);
}
/**
 * Cache DOM elements for performance.
 * Must be called during dashboard initialization.
 */
function cacheElements() {
    const ids = [
        "app",
        "loading-state",
        "error-state",
        "main-content",
        "error-title",
        "error-message",
        "run-info",
        "date-range",
        "custom-dates",
        "start-date",
        "end-date",
        "retry-btn",
        "total-prs",
        "cycle-p50",
        "cycle-p90",
        "authors-count",
        "reviewers-count",
        "throughput-chart",
        "cycle-distribution",
        "total-prs-delta",
        "cycle-p50-delta",
        "cycle-p90-delta",
        "authors-delta",
        "reviewers-delta",
        "repo-filter",
        "team-filter",
        "repo-filter-group",
        "team-filter-group",
        "clear-filters",
        "active-filters",
        "filter-chips",
        "total-prs-sparkline",
        "cycle-p50-sparkline",
        "cycle-p90-sparkline",
        "authors-sparkline",
        "reviewers-sparkline",
        "cycle-time-trend",
        "reviewer-activity",
        "compare-toggle",
        "comparison-banner",
        "current-period-dates",
        "previous-period-dates",
        "exit-compare",
        "export-btn",
        "export-menu",
        "export-csv",
        "export-link",
        "export-raw-zip",
    ];
    ids.forEach((id) => {
        elements[id] = document.getElementById(id);
    });
    elements.tabs = document.querySelectorAll(".tab");
}
/**
 * Clear the element cache (useful for testing).
 */
function clearElementCache() {
    Object.keys(elements).forEach((key) => {
        delete elements[key];
    });
}
//# sourceMappingURL=dom.js.map