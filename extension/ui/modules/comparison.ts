/**
 * Comparison mode utilities for dashboard.
 *
 * Pure functions for comparison mode state management.
 * DOM-dependent operations remain in dashboard.ts.
 */

import type { DateRange } from "./metrics";

/**
 * Format a date for display in comparison banner.
 */
export function formatComparisonDate(date: Date): string {
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
export function formatDateRangeDisplay(start: Date, end: Date): string {
  return `${formatComparisonDate(start)} - ${formatComparisonDate(end)}`;
}

/**
 * Serialize comparison mode to URL params.
 * @param isEnabled - Whether comparison mode is active
 * @param params - URL search params to update
 */
export function serializeComparisonToUrl(
  isEnabled: boolean,
  params: URLSearchParams,
): void {
  if (isEnabled) {
    params.set("compare", "1");
  } else {
    params.delete("compare");
  }
}

/**
 * Parse comparison mode from URL params.
 * @param params - URL search params
 * @returns Whether comparison mode should be enabled
 */
export function parseComparisonFromUrl(params: URLSearchParams): boolean {
  return params.get("compare") === "1";
}

/**
 * Get comparison banner data.
 * @param currentRange - Current date range
 * @param previousRange - Previous period date range
 * @returns Object with formatted date strings for display
 */
export function getComparisonBannerData(
  currentRange: DateRange,
  previousRange: DateRange,
): {
  currentPeriod: string;
  previousPeriod: string;
} | null {
  if (!currentRange.start || !currentRange.end) {
    return null;
  }

  return {
    currentPeriod: formatDateRangeDisplay(currentRange.start, currentRange.end),
    previousPeriod: formatDateRangeDisplay(
      previousRange.start,
      previousRange.end,
    ),
  };
}
