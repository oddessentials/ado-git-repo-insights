"use strict";
/**
 * Comparison mode utilities for dashboard.
 *
 * Pure functions for comparison mode state management.
 * DOM-dependent operations remain in dashboard.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatComparisonDate = formatComparisonDate;
exports.formatDateRangeDisplay = formatDateRangeDisplay;
exports.serializeComparisonToUrl = serializeComparisonToUrl;
exports.parseComparisonFromUrl = parseComparisonFromUrl;
exports.getComparisonBannerData = getComparisonBannerData;
/**
 * Format a date for display in comparison banner.
 */
function formatComparisonDate(date) {
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}
/**
 * Format a date range for display.
 * @param start - Start date
 * @param end - End date
 * @returns Formatted string like "Jan 1, 2026 - Jan 7, 2026"
 */
function formatDateRangeDisplay(start, end) {
    return `${formatComparisonDate(start)} - ${formatComparisonDate(end)}`;
}
/**
 * Serialize comparison mode to URL params.
 * @param isEnabled - Whether comparison mode is active
 * @param params - URL search params to update
 */
function serializeComparisonToUrl(isEnabled, params) {
    if (isEnabled) {
        params.set("compare", "1");
    }
    else {
        params.delete("compare");
    }
}
/**
 * Parse comparison mode from URL params.
 * @param params - URL search params
 * @returns Whether comparison mode should be enabled
 */
function parseComparisonFromUrl(params) {
    return params.get("compare") === "1";
}
/**
 * Get comparison banner data.
 * @param currentRange - Current date range
 * @param previousRange - Previous period date range
 * @returns Object with formatted date strings for display
 */
function getComparisonBannerData(currentRange, previousRange) {
    if (!currentRange.start || !currentRange.end) {
        return null;
    }
    return {
        currentPeriod: formatDateRangeDisplay(currentRange.start, currentRange.end),
        previousPeriod: formatDateRangeDisplay(previousRange.start, previousRange.end),
    };
}
//# sourceMappingURL=comparison.js.map