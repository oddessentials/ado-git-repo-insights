/**
 * Reviewer Activity Chart Module
 *
 * Renders reviewer activity as a horizontal bar chart showing
 * weekly reviewer counts for the last 8 weeks.
 *
 * DOM-INJECTED: Container element is passed as parameter.
 * This module works identically in both extension and local dashboard modes.
 */

import type { Rollup } from "../../dataset-loader";
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";

/** Maximum weeks displayed in the reviewer activity panel. */
export const MAX_REVIEWER_WEEKS = 8;

/**
 * Render reviewer activity chart (horizontal bar chart).
 *
 * Shows reviewer counts for the last 8 weeks as horizontal bars.
 * The panel is inherently capped at {@link MAX_REVIEWER_WEEKS} weeks,
 * so DOM element count is bounded regardless of input size.
 * Tested with reviewer counts up to 200+ per week (enterprise scale).
 *
 * @param container - Target container element (or null for no-op)
 * @param rollups - Array of weekly rollup data
 */
export function renderReviewerActivity(
  container: HTMLElement | null,
  rollups: Rollup[],
): void {
  if (!container) return;

  if (!rollups || !rollups.length) {
    renderNoData(container, "No reviewer data available");
    return;
  }

  // Take last MAX_REVIEWER_WEEKS weeks for display
  const recentRollups = rollups.slice(-MAX_REVIEWER_WEEKS);
  const maxReviewers = Math.max(
    ...recentRollups.map((r) => r.reviewers_count || 0),
  );

  if (maxReviewers === 0) {
    renderNoData(container, "No reviewer data available");
    return;
  }

  const barsHtml = recentRollups
    .map((r) => {
      const count = r.reviewers_count || 0;
      const pct = (count / maxReviewers) * 100;
      const wParts = r.week.split("-W");
      const weekLabel = wParts[1] ?? r.week;
      // SECURITY: Escape data-controlled values to prevent XSS
      return `
            <div class="h-bar-row" title="${escapeHtml(r.week)}: ${count} reviewers">
                <span class="h-bar-label">W${escapeHtml(weekLabel)}</span>
                <div class="h-bar-container">
                    <div class="h-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-bar-value">${count}</span>
            </div>
        `;
    })
    .join("");

  // Add a subtitle so users understand the panel shows weekly aggregate
  // counts, not individual reviewer identities.
  const subtitle = `<p class="chart-subtitle">Active reviewers per week (last ${recentRollups.length} weeks)</p>`;

  // SECURITY: barsHtml uses escapeHtml for week values, count is numeric
  renderTrustedHtml(
    container,
    `${subtitle}<div class="horizontal-bar-chart">${barsHtml}</div>`,
  );
}
