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
import type { DataAvailabilitySignal } from "../../types";
import type { FilterState } from "../filters";
import { classifyEmptyState } from "../empty-state-classifier";
import { renderTruncationIndicator } from "../shared/chart-layout";
import {
  escapeHtml,
  renderNoData,
  renderTrustedHtml,
} from "../shared/render";

import type { ReviewerBreakdownEntry } from "../../schemas/rollup.schema";

/** Maximum weeks displayed in the reviewer activity panel. */
export const MAX_REVIEWER_WEEKS = 8;

/**
 * Compute PR-weighted average approval rate from by_reviewer breakdowns
 * across all rollups for the selected reviewer(s).
 * Returns null when no reviewer has a finite approval_rate.
 */
function computeApprovalRate(
  rollups: Rollup[],
  reviewerIds: string[],
): number | null {
  let weightedSum = 0;
  let totalPrs = 0;

  for (const rollup of rollups) {
    if (!rollup.by_reviewer || typeof rollup.by_reviewer !== "object") continue;
    const reviewerMap = new Map(Object.entries(rollup.by_reviewer as Record<string, ReviewerBreakdownEntry>));
    for (const id of reviewerIds) {
      const entry = reviewerMap.get(id);
      if (!entry) continue;
      const rate = entry.approval_rate;
      if (typeof rate !== "number" || !Number.isFinite(rate)) continue;
      const prs = entry.reviewed_prs ?? 0;
      weightedSum += rate * prs;
      totalPrs += prs;
    }
  }

  return totalPrs > 0 ? weightedSum / totalPrs : null;
}

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
 * @param options - Optional rendering mode and classifier inputs
 */
export function renderReviewerActivity(
  container: HTMLElement | null,
  rollups: Rollup[],
  options: {
    reviewerFilterActive?: boolean;
    filters?: FilterState;
    unfilteredRollups?: Rollup[];
    availability?: DataAvailabilitySignal;
  } = {},
): void {
  if (!container) return;

  const { reviewerFilterActive = false } = options;
  const noun = reviewerFilterActive ? "reviews" : "reviewers";
  const subtitle = reviewerFilterActive
    ? `Review activity per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)`
    : `Active reviewers per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)`;

  if (!rollups || !rollups.length) {
    const classification = options.availability
      ? classifyEmptyState({
          chartType: "reviewer_activity",
          filters: options.filters ?? { repos: [], teams: [], reviewers: [], authors: [] },
          unfilteredRollups: options.unfilteredRollups ?? [],
          filteredRollups: rollups ?? [],
          availability: options.availability,
          minimumDataPoints: 0,
        })
      : null;
    const fallbackHint = reviewerFilterActive
      ? "Try widening the date range or adjusting reviewer filters."
      : "Try widening the date range or adjusting repository/team filters.";
    renderNoData(
      container,
      classification?.message ??
        (reviewerFilterActive
          ? "No review activity available"
          : "No reviewer data available"),
      classification?.hint ?? fallbackHint,
    );
    return;
  }

  // Take last MAX_REVIEWER_WEEKS weeks for display
  const truncated = rollups.length > MAX_REVIEWER_WEEKS;
  const recentRollups = rollups.slice(-MAX_REVIEWER_WEEKS);
  const maxReviewers = Math.max(
    ...recentRollups.map((r) => r.reviewers_count || 0),
  );

  if (maxReviewers === 0) {
    const classification = options.availability
      ? classifyEmptyState({
          chartType: "reviewer_activity",
          filters: options.filters ?? { repos: [], teams: [], reviewers: [], authors: [] },
          unfilteredRollups: options.unfilteredRollups ?? [],
          filteredRollups: rollups,
          availability: options.availability,
          minimumDataPoints: 1, // Requires at least 1 reviewer to render
        })
      : null;
    const fallbackHint = reviewerFilterActive
      ? "Try widening the date range or adjusting reviewer filters."
      : "Reviewer data requires the extraction pipeline to capture reviewer details.";
    renderNoData(
      container,
      classification?.message ??
        (reviewerFilterActive
          ? "No review activity available"
          : "No reviewer data available"),
      classification?.hint ?? fallbackHint,
    );
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
            <div class="h-bar-row" title="${escapeHtml(r.week)}: ${count} ${noun}">
                <span class="h-bar-label">W${escapeHtml(weekLabel)}</span>
                <div class="h-bar-container">
                    <div class="h-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-bar-value">${count}</span>
            </div>
        `;
    })
    .join("");

  // Truncation indicator
  const truncationHtml = renderTruncationIndicator(truncated, MAX_REVIEWER_WEEKS);

  // Approval rate (shown only when reviewer filter is active and data is available)
  let approvalHtml = "";
  if (reviewerFilterActive) {
    const reviewerIds = options.filters?.reviewers ?? [];
    const sourceRollups = options.unfilteredRollups ?? rollups;
    const approvalRate = computeApprovalRate(sourceRollups, reviewerIds);
    if (approvalRate !== null) {
      const pct = Math.round(approvalRate * 100);
      approvalHtml = `<p class="approval-rate">Approval Rate: ${pct}%</p>`;
    }
  }

  // SECURITY: barsHtml uses escapeHtml for week values, count and pct are numeric
  renderTrustedHtml(
    container,
    `${truncationHtml}<p class="chart-subtitle">${escapeHtml(subtitle)}</p><div class="horizontal-bar-chart">${barsHtml}</div>${approvalHtml}`,
  );
}
