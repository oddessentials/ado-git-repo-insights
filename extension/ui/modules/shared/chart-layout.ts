/**
 * Shared chart layout utilities.
 *
 * Centralizes the truncation indicator pattern used identically across
 * throughput, cycle-time, and reviewer-activity charts.
 */

/**
 * Render a truncation indicator HTML string.
 *
 * @param truncated - Whether the data exceeds the display cap
 * @param maxPoints - Maximum data points shown (e.g., 104, 8)
 * @param noun - Unit label (default: "weeks")
 * @returns HTML string, or empty string when not truncated
 */
export function renderTruncationIndicator(
  truncated: boolean,
  maxPoints: number,
  noun = "weeks",
): string {
  if (!truncated) return "";
  return `<div class="truncation-indicator truncation-badge">Showing last ${maxPoints} ${noun}</div>`;
}
