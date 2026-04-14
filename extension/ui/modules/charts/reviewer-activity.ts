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
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";

import type { ReviewerBreakdownEntry } from "../../schemas/rollup.schema";

/** Maximum weeks displayed in the reviewer activity panel. */
export const MAX_REVIEWER_WEEKS = 8;

/**
 * Compute PR-weighted average approval rate from by_reviewer breakdowns
 * across all rollups for the selected reviewer(s).
 *
 * DESIGN: Weighted by reviewed_prs (distinct PRs reviewed), not reviews_count
 * (review events). approval_rate is a per-PR metric, so weighting by events
 * would skew toward PRs with multiple review rounds. The same weighting is
 * used in aggregateReviewerEntries() in metrics.ts — both must stay aligned.
 *
 * Returns null when no reviewer has a finite approval_rate or reviewed_prs > 0.
 */
function computeApprovalRate(
  rollups: Rollup[],
  reviewerIds: string[],
): { rate: number | null; weeksWithData: number } {
  let weightedSum = 0;
  let totalPrs = 0;
  let weeksWithData = 0;

  for (const rollup of rollups) {
    if (!rollup.by_reviewer || typeof rollup.by_reviewer !== "object") continue;
    const reviewerMap = new Map(
      Object.entries(
        rollup.by_reviewer as Record<string, ReviewerBreakdownEntry>,
      ),
    );
    let weekContributed = false;
    for (const id of reviewerIds) {
      const entry = reviewerMap.get(id);
      if (!entry) continue;
      const rate = entry.approval_rate;
      if (typeof rate !== "number" || !Number.isFinite(rate)) continue;
      // Weight by reviewed_prs (distinct PRs reviewed), not reviews_count (review events).
      // approval_rate is a per-PR metric, so the denominator must match.
      const prs = entry.reviewed_prs ?? 0;
      if (prs <= 0) continue;
      weightedSum += rate * prs;
      totalPrs += prs;
      weekContributed = true;
    }
    if (weekContributed) weeksWithData++;
  }

  return {
    rate: totalPrs > 0 ? weightedSum / totalPrs : null,
    weeksWithData,
  };
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

  // Handle the empty/nullish rollups case before computing any subtitle
  // string — otherwise `rollups.length` access on null crashes the render.
  if (!rollups || !rollups.length) {
    const classification = options.availability
      ? classifyEmptyState({
          chartType: "reviewer_activity",
          filters: options.filters ?? {
            repos: [],
            teams: [],
            reviewers: [],
            authors: [],
          },
          unfilteredRollups: options.unfilteredRollups ?? [],
          filteredRollups: [],
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

  const noun = reviewerFilterActive ? "reviews" : "reviewers";
  const subtitle = reviewerFilterActive
    ? `Review activity per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)`
    : `Active reviewers per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)`;

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
          filters: options.filters ?? {
            repos: [],
            teams: [],
            reviewers: [],
            authors: [],
          },
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
  const truncationHtml = renderTruncationIndicator(
    truncated,
    MAX_REVIEWER_WEEKS,
  );

  // Approval rate: always rendered when reviewer filter is active.
  // Uses recentRollups (the truncated 8-week window) so the badge reflects the
  // same time range as the chart bars, not the full selected date range.
  // When data is missing (null), renders an explicit no-data indicator rather
  // than silently omitting the element.
  let approvalHtml = "";
  if (reviewerFilterActive) {
    // DESIGN: Reviewer filter is effectively single-select end-to-end.
    // Scoped to first reviewer only — matches applyFiltersToRollups() in metrics.ts
    // which uses filters.reviewers[0]. If multi-reviewer aggregation is implemented,
    // both this site and applyFiltersToRollups must move together.
    const firstReviewer = options.filters?.reviewers?.[0];
    const reviewerIds = firstReviewer ? [firstReviewer] : [];
    const { rate: approvalRate, weeksWithData } = computeApprovalRate(
      recentRollups,
      reviewerIds,
    );
    // Badge label uses metric-specific coverage (weeks that actually contributed
    // to the approval rate), not the visual chart window — consistent with the
    // sample-size convention on summary cards.
    const coverageLabel =
      weeksWithData > 0
        ? `(from ${weeksWithData} ${weeksWithData === 1 ? "week" : "weeks"} of data)`
        : "";
    if (approvalRate !== null) {
      const pct = Math.round(approvalRate * 100);
      approvalHtml = `<p class="approval-rate" data-weeks="${weeksWithData}">Approval Rate: ${pct}% ${escapeHtml(coverageLabel)}</p>`;
    } else {
      approvalHtml = `<p class="approval-rate approval-rate-no-data" data-weeks="${weeksWithData}">Approval Rate: No data</p>`;
    }
  }

  // SECURITY: barsHtml uses escapeHtml for week values, count and pct are numeric
  renderTrustedHtml(
    container,
    `${truncationHtml}<p class="chart-subtitle">${escapeHtml(subtitle)}</p><div class="horizontal-bar-chart">${barsHtml}</div>${approvalHtml}`,
  );
}
