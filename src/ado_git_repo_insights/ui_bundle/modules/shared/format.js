"use strict";
/**
 * Shared formatting utilities for dashboard modules.
 *
 * DOM-FREE: This module has zero DOM access for deterministic testing.
 * Used by metrics.ts and ml/*.ts without coupling to document/window.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDuration = formatDuration;
exports.formatPercentChange = formatPercentChange;
exports.formatDate = formatDate;
exports.formatDateRange = formatDateRange;
exports.formatWeekLabel = formatWeekLabel;
exports.median = median;
/**
 * Format a duration in minutes to a human-readable string.
 */
function formatDuration(minutes) {
    if (minutes < 60) {
        return `${Math.round(minutes)}m`;
    }
    const hours = minutes / 60;
    if (hours < 24) {
        return `${hours.toFixed(1)}h`;
    }
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
}
/**
 * Format a percentage change with sign and symbol.
 */
function formatPercentChange(percent) {
    if (percent === null || !isFinite(percent)) {
        return "—";
    }
    const sign = percent >= 0 ? "+" : "";
    return `${sign}${percent.toFixed(0)}%`;
}
/**
 * Format a date to a short locale string.
 */
function formatDate(date) {
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
}
/**
 * Format a date range to a readable string.
 */
function formatDateRange(start, end) {
    return `${formatDate(start)} – ${formatDate(end)}`;
}
/**
 * Format a week identifier (e.g., "2024-W23") to readable format.
 */
function formatWeekLabel(week) {
    // Extract week number from format "YYYY-Www"
    const match = week.match(/(\d{4})-W(\d{2})/);
    if (!match)
        return week;
    return `W${match[2]}`;
}
/**
 * Calculate median of a numeric array.
 */
function median(arr) {
    if (!Array.isArray(arr) || arr.length === 0)
        return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? (sorted[mid] ?? 0)
        : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
//# sourceMappingURL=format.js.map