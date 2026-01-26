/**
 * Export utilities for dashboard.
 *
 * Pure functions for generating export data formats.
 * DOM interactions (download triggers, toasts) remain in dashboard.ts.
 */

import type { Rollup } from "../dataset-loader";

/**
 * CSV headers for rollup export.
 */
export const CSV_HEADERS = [
  "Week",
  "Start Date",
  "End Date",
  "PR Count",
  "Cycle Time P50 (min)",
  "Cycle Time P90 (min)",
  "Authors",
  "Reviewers",
] as const;

/**
 * Convert rollups to CSV content string.
 * @param rollups - Array of rollup records
 * @returns CSV-formatted string
 */
export function rollupsToCsv(rollups: Rollup[]): string {
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

  const headerRow = CSV_HEADERS.map((h) => h as string);
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
export function generateExportFilename(
  prefix: string,
  extension: string,
): string {
  const dateStr = new Date().toISOString().split("T")[0];
  return `${prefix}-${dateStr}.${extension}`;
}

/**
 * Trigger a file download in the browser.
 * @param content - File content (string or Blob)
 * @param filename - Download filename
 * @param mimeType - MIME type for string content
 */
export function triggerDownload(
  content: string | Blob,
  filename: string,
  mimeType = "text/csv;charset=utf-8;",
): void {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });
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
export function showToast(
  message: string,
  type: "success" | "error" = "success",
  durationMs = 3000,
): void {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, durationMs);
}
