/**
 * Data Availability Signal Derivation
 *
 * Derives availability signals from rollup data and manifest capabilities.
 * Used by the empty state classifier to distinguish "not extracted" from
 * "extracted but empty" data.
 *
 * The DataAvailabilitySignal interface lives in types.ts alongside
 * DatasetCapabilityState. This module provides the derivation function.
 */

import type { Rollup } from "../dataset-loader";
import type {
  DataAvailabilitySignal,
  DatasetCapabilityState,
} from "../types";

/** Default capability state when manifest is unavailable. */
const DEFAULT_CAPABILITIES: DatasetCapabilityState = {
  authorFiltersAvailable: false,
  authorRepoExactAvailable: false,
  commentsMetricsAvailable: false,
  commentsCoverageStatus: "disabled",
  reviewerRepositoryMode: "constrained",
  reviewerTeamMode: "disallowed",
  crossDimensionalAvailable: false,
};

/**
 * Derive data availability signal from rollups and manifest capabilities.
 *
 * Inspects rollup breakdown fields (null vs empty object) and manifest
 * capability flags to determine what data was extracted.
 *
 * @param rollups - Normalized rollup data
 * @param capabilities - Manifest capability state (null-safe)
 * @returns Data availability signal for empty state classification
 */
export function deriveAvailabilitySignal(
  rollups: Rollup[],
  capabilities?: DatasetCapabilityState | null,
): DataAvailabilitySignal {
  const caps = capabilities ?? DEFAULT_CAPABILITIES;

  // Check reviewer data across all rollups
  const hasAnyReviewerField = rollups.some((r) => r.by_reviewer !== null);
  const allReviewerFieldsEmpty =
    hasAnyReviewerField &&
    rollups.every(
      (r) =>
        r.by_reviewer === null ||
        Object.keys(r.by_reviewer).length === 0,
    );

  // Check cycle time data across all rollups
  const hasAnyCycleTime = rollups.some((r) => r.cycle_time_p50 !== null);

  return {
    reviewerDataPresent: hasAnyReviewerField,
    reviewerDataEmpty: hasAnyReviewerField && allReviewerFieldsEmpty,
    cycleTimePresent: hasAnyCycleTime,
    reviewerRepoMode: caps.reviewerRepositoryMode,
    commentsStatus: caps.commentsCoverageStatus,
  };
}
