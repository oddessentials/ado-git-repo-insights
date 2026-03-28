/**
 * Empty State Classifier
 *
 * Centralized classification of why a chart has no data to display.
 * Implements strict short-circuit evaluation hierarchy per FR-014:
 *   1. not_extracted — data was never captured
 *   2. filter_caused — active filters excluded all data
 *   3. minimum_data — filtered data exists but below chart minimum
 *   4. date_range_empty — no data at all for this period
 *
 * First matching condition terminates evaluation. Later conditions
 * are NOT evaluated even if they would also be true.
 */

import type { Rollup } from "../dataset-loader";
import type { DataAvailabilitySignal } from "../types";
import type { FilterState } from "./filters";

/** Classification result for empty state messaging. */
export interface EmptyStateClassification {
  reason:
    | "not_extracted"
    | "filter_caused"
    | "minimum_data"
    | "date_range_empty";
  message: string;
  hint: string;
}

/** Chart types that can be classified. */
export type ClassifiableChart =
  | "throughput"
  | "cycle_time_trend"
  | "cycle_time_distribution"
  | "reviewer_activity";

/** Context required for empty state classification. */
export interface EmptyStateContext {
  chartType: ClassifiableChart;
  filters: FilterState;
  unfilteredRollups: Rollup[];
  filteredRollups: Rollup[];
  availability: DataAvailabilitySignal;
  minimumDataPoints: number;
}

/** Message constants for consistency and testability. */
export const EMPTY_STATE_MESSAGES = {
  NOT_EXTRACTED: "This data is not yet available.",
  FILTER_CAUSED: "No data matches your current filters.",
  MINIMUM_DATA_TREND: "Not enough data for trend analysis.",
  MINIMUM_DATA_GENERIC: "Insufficient data for this view.",
  DATE_RANGE_EMPTY: "No data in this period.",
} as const;

/** Hint constants for consistency and testability. */
export const EMPTY_STATE_HINTS = {
  NOT_EXTRACTED_REVIEWER:
    "Ensure the data pipeline is configured to capture reviewer information.",
  NOT_EXTRACTED_CYCLE_TIME:
    "Cycle time data requires PR completion timestamps in the extraction pipeline.",
  FILTER_CAUSED:
    "Try removing some filters or widening the date range.",
  MINIMUM_TREND:
    "At least 2 weeks of data are needed to show trends.",
  MINIMUM_GENERIC: "Try widening the date range.",
  DATE_RANGE: "Try widening the date range or selecting a different period.",
} as const;

/**
 * Check if any filters are active.
 */
function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.repos.length > 0 ||
    filters.teams.length > 0 ||
    filters.reviewers.length > 0 ||
    filters.authors.length > 0
  );
}

/**
 * Step 1: Check if data was not extracted for this chart type.
 */
function checkNotExtracted(
  ctx: EmptyStateContext,
): EmptyStateClassification | null {
  const { chartType, availability } = ctx;

  if (chartType === "reviewer_activity" && !availability.reviewerDataPresent) {
    return {
      reason: "not_extracted",
      message: EMPTY_STATE_MESSAGES.NOT_EXTRACTED,
      hint: EMPTY_STATE_HINTS.NOT_EXTRACTED_REVIEWER,
    };
  }

  if (
    (chartType === "cycle_time_trend" ||
      chartType === "cycle_time_distribution") &&
    !availability.cycleTimePresent
  ) {
    return {
      reason: "not_extracted",
      message: EMPTY_STATE_MESSAGES.NOT_EXTRACTED,
      hint: EMPTY_STATE_HINTS.NOT_EXTRACTED_CYCLE_TIME,
    };
  }

  // Throughput (pr_count) is always available — never "not extracted"
  return null;
}

/**
 * Check whether all rollups have zeroed-out metric content.
 *
 * applyFiltersToRollups uses .map() (not .filter()), so filtered rollups
 * preserve array length but zero metric fields via ZEROED_ROLLUP_FIELDS.
 * An empty result is signaled by all pr_count values being 0, not by
 * an empty array.
 */
function allMetricsZeroed(rollups: Rollup[]): boolean {
  if (rollups.length === 0) return true;
  return rollups.every((r) => r.pr_count === 0);
}

/**
 * Step 2: Check if active filters caused the empty state.
 *
 * Detects filter-caused empties by comparing metric content, not array
 * length. The filtering pipeline keeps week rows and zeroes metric fields,
 * so filteredRollups.length stays non-zero even when filters exclude all
 * usable data.
 */
function checkFilterCaused(
  ctx: EmptyStateContext,
): EmptyStateClassification | null {
  if (
    hasActiveFilters(ctx.filters) &&
    ctx.unfilteredRollups.length > 0 &&
    !allMetricsZeroed(ctx.unfilteredRollups) &&
    (ctx.filteredRollups.length === 0 || allMetricsZeroed(ctx.filteredRollups))
  ) {
    return {
      reason: "filter_caused",
      message: EMPTY_STATE_MESSAGES.FILTER_CAUSED,
      hint: EMPTY_STATE_HINTS.FILTER_CAUSED,
    };
  }
  return null;
}

/**
 * Step 3: Check if filtered data exists but below minimum threshold.
 */
function checkMinimumData(
  ctx: EmptyStateContext,
): EmptyStateClassification | null {
  if (
    ctx.filteredRollups.length > 0 &&
    ctx.filteredRollups.length < ctx.minimumDataPoints
  ) {
    const isTrend = ctx.chartType === "cycle_time_trend";
    return {
      reason: "minimum_data",
      message: isTrend
        ? EMPTY_STATE_MESSAGES.MINIMUM_DATA_TREND
        : EMPTY_STATE_MESSAGES.MINIMUM_DATA_GENERIC,
      hint: isTrend
        ? EMPTY_STATE_HINTS.MINIMUM_TREND
        : EMPTY_STATE_HINTS.MINIMUM_GENERIC,
    };
  }
  return null;
}

/**
 * Step 4: No rollups at all — date range is empty.
 */
function checkDateRangeEmpty(
  ctx: EmptyStateContext,
): EmptyStateClassification | null {
  if (ctx.unfilteredRollups.length === 0) {
    return {
      reason: "date_range_empty",
      message: EMPTY_STATE_MESSAGES.DATE_RANGE_EMPTY,
      hint: EMPTY_STATE_HINTS.DATE_RANGE,
    };
  }
  return null;
}

/**
 * Classify why a chart has no data to display.
 *
 * Evaluates conditions in strict short-circuit order.
 * Returns null if the chart has sufficient data to render normally.
 *
 * @param ctx - Classification context
 * @returns Classification result, or null if chart should render normally
 */
export function classifyEmptyState(
  ctx: EmptyStateContext,
): EmptyStateClassification | null {
  // Strict short-circuit: first match terminates
  return (
    checkNotExtracted(ctx) ??
    checkFilterCaused(ctx) ??
    checkMinimumData(ctx) ??
    checkDateRangeEmpty(ctx)
  );
}
