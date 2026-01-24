"use strict";
/**
 * Export utilities for dashboard.
 *
 * Pure functions for generating export data formats.
 * DOM interactions (download triggers, toasts) remain in dashboard.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSV_HEADERS = void 0;
exports.rollupsToCsv = rollupsToCsv;
exports.generateExportFilename = generateExportFilename;
exports.triggerDownload = triggerDownload;
exports.showToast = showToast;
/**
 * CSV headers for rollup export.
 */
exports.CSV_HEADERS = [
    "Week",
    "Start Date",
    "End Date",
    "PR Count",
    "Cycle Time P50 (min)",
    "Cycle Time P90 (min)",
    "Authors",
    "Reviewers",
];
/**
 * Convert rollups to CSV content string.
 * @param rollups - Array of rollup records
 * @returns CSV-formatted string
 */
function rollupsToCsv(rollups) {
    if (!rollups || rollups.length === 0) {
        return "";
    }
    const rows = rollups.map((r) => [
        r.week,
        r.start_date || "",
        r.end_date || "",
        r.pr_count || 0,
        r.cycle_time_p50 != null ? r.cycle_time_p50.toFixed(1) : "",
        r.cycle_time_p90 != null ? r.cycle_time_p90.toFixed(1) : "",
        r.authors_count || 0,
        r.reviewers_count || 0,
    ]);
    const headerRow = exports.CSV_HEADERS.map((h) => h);
    return [headerRow, ...rows]
        .map((row) => row.map((cell) => `"${cell}"`).join(","))
        .join("\n");
}
/**
 * Generate a date-stamped filename for exports.
 * @param prefix - Filename prefix (e.g., "pr-insights")
 * @param extension - File extension (e.g., "csv", "zip")
 * @returns Formatted filename
 */
function generateExportFilename(prefix, extension) {
    const dateStr = new Date().toISOString().split("T")[0];
    return `${prefix}-${dateStr}.${extension}`;
}
/**
 * Trigger a file download in the browser.
 * @param content - File content (string or Blob)
 * @param filename - Download filename
 * @param mimeType - MIME type for string content
 */
function triggerDownload(content, filename, mimeType = "text/csv;charset=utf-8;") {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
/**
 * Show a toast notification.
 * @param message - Toast message
 * @param type - Toast type (success or error)
 * @param durationMs - Duration before auto-remove (default 3000ms)
 */
function showToast(message, type = "success", durationMs = 3000) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, durationMs);
}
//# sourceMappingURL=export.js.map