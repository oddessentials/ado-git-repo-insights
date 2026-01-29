/**
 * Shared formatting utilities for dashboard modules.
 *
 * DOM-FREE: This module has zero DOM access for deterministic testing.
 * Used by metrics.ts and ml/*.ts without coupling to document/window.
 */

/**
 * Format a duration in minutes to a human-readable string.
 */
export function formatDuration(minutes: number): string {
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
export function formatPercentChange(percent: number | null): string {
  if (percent === null || !isFinite(percent)) {
    return "—";
  }
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(0)}%`;
}

/**
 * Format a date to a short locale string.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a date range to a readable string.
 */
export function formatDateRange(start: Date, end: Date): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Format a week identifier (e.g., "2024-W23") to readable format.
 */
export function formatWeekLabel(week: string): string {
  // Extract week number from format "YYYY-Www"
  const match = week.match(/(\d{4})-W(\d{2})/);
  if (!match) return week;
  return `W${match[2]}`;
}

/**
 * Calculate median of a numeric array.
 */
export function median(arr: number[]): number {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? // eslint-disable-next-line security/detect-object-injection -- SECURITY: mid is computed from array length, always valid index
      (sorted[mid] ?? 0)
    : // eslint-disable-next-line security/detect-object-injection -- SECURITY: mid/mid-1 are computed from array length, always valid indices
      ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
