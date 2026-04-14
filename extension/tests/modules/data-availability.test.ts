/**
 * Data Availability Signal Tests
 *
 * Tests deriveAvailabilitySignal for all possible reviewer and cycle-time states:
 * - by_reviewer: null (not extracted), {} (empty), {entries} (present)
 * - cycle_time_p50: null vs non-null
 * - Default capabilities when null passed
 * - Manifest capability passthrough
 */

import { deriveAvailabilitySignal } from "../../ui/modules/data-availability";
import type { Rollup } from "../../ui/dataset-loader";
import type {
  DataAvailabilitySignal,
  DatasetCapabilityState,
} from "../../ui/types";

/**
 * Create a minimal Rollup for testing, with overrideable fields.
 */
function makeRollup(overrides: Partial<Rollup> = {}): Rollup {
  return {
    week: "2025-W01",
    pr_count: 10,
    cycle_time_p50: 60,
    cycle_time_p90: 120,
    authors_count: 5,
    reviewers_count: 3,
    by_repository: null,
    by_team: null,
    ...overrides,
  };
}

describe("deriveAvailabilitySignal", () => {
  describe("reviewer data detection", () => {
    it("by_reviewer: null -> reviewerDataPresent: false", () => {
      const rollups = [
        makeRollup({ by_reviewer: null }),
        makeRollup({ by_reviewer: null }),
      ];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.reviewerDataPresent).toBe(false);
      expect(signal.reviewerDataEmpty).toBe(false);
    });

    it("by_reviewer: undefined -> reviewerDataPresent: false", () => {
      const rollups = [makeRollup({ by_reviewer: undefined })];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.reviewerDataPresent).toBe(false);
      expect(signal.reviewerDataEmpty).toBe(false);
    });

    it("by_reviewer: {} -> reviewerDataPresent: true, reviewerDataEmpty: true", () => {
      const rollups = [
        makeRollup({ by_reviewer: {} }),
        makeRollup({ by_reviewer: {} }),
      ];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.reviewerDataPresent).toBe(true);
      expect(signal.reviewerDataEmpty).toBe(true);
    });

    it("by_reviewer with entries -> reviewerDataPresent: true, reviewerDataEmpty: false", () => {
      const rollups = [
        makeRollup({
          by_reviewer: {
            "user-1": {
              reviewed_prs: 5,
              reviews_count: 8,
              repositories_count: 2,
            },
          },
        }),
      ];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.reviewerDataPresent).toBe(true);
      expect(signal.reviewerDataEmpty).toBe(false);
    });

    it("mixed: some null, some empty -> reviewerDataPresent: true, reviewerDataEmpty: true", () => {
      const rollups = [
        makeRollup({ by_reviewer: null }),
        makeRollup({ by_reviewer: {} }),
      ];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.reviewerDataPresent).toBe(true);
      // All non-null by_reviewer fields are empty, and null ones are treated as empty
      expect(signal.reviewerDataEmpty).toBe(true);
    });

    it("mixed: some null, some with entries -> reviewerDataPresent: true, reviewerDataEmpty: false", () => {
      const rollups = [
        makeRollup({ by_reviewer: null }),
        makeRollup({
          by_reviewer: {
            "user-1": {
              reviewed_prs: 3,
              reviews_count: 5,
              repositories_count: 1,
            },
          },
        }),
      ];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.reviewerDataPresent).toBe(true);
      expect(signal.reviewerDataEmpty).toBe(false);
    });
  });

  describe("cycle time detection", () => {
    it("cycleTimePresent: true when at least one rollup has non-null cycle_time_p50", () => {
      const rollups = [
        makeRollup({ cycle_time_p50: null }),
        makeRollup({ cycle_time_p50: 45 }),
        makeRollup({ cycle_time_p50: null }),
      ];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.cycleTimePresent).toBe(true);
    });

    it("cycleTimePresent: false when all rollups have null cycle_time_p50", () => {
      const rollups = [
        makeRollup({ cycle_time_p50: null }),
        makeRollup({ cycle_time_p50: null }),
      ];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.cycleTimePresent).toBe(false);
    });

    it("cycleTimePresent: false for empty rollups array", () => {
      const signal: DataAvailabilitySignal = deriveAvailabilitySignal([]);

      expect(signal.cycleTimePresent).toBe(false);
    });
  });

  describe("capabilities passthrough", () => {
    it("uses default capabilities when null passed", () => {
      const rollups = [makeRollup()];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(
        rollups,
        null,
      );

      expect(signal.reviewerRepoMode).toBe("constrained");
      expect(signal.commentsStatus).toBe("disabled");
    });

    it("uses default capabilities when undefined passed", () => {
      const rollups = [makeRollup()];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(
        rollups,
        undefined,
      );

      expect(signal.reviewerRepoMode).toBe("constrained");
      expect(signal.commentsStatus).toBe("disabled");
    });

    it("uses default capabilities when no second argument provided", () => {
      const rollups = [makeRollup()];

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(rollups);

      expect(signal.reviewerRepoMode).toBe("constrained");
      expect(signal.commentsStatus).toBe("disabled");
    });

    it("passes through manifest capability flags correctly", () => {
      const rollups = [makeRollup()];
      const capabilities: DatasetCapabilityState = {
        authorFiltersAvailable: true,
        authorRepoExactAvailable: true,
        commentsMetricsAvailable: true,
        commentsCoverageStatus: "full",
        reviewerRepositoryMode: "exact",
        reviewerTeamMode: "exact",
        crossDimensionalAvailable: true,
      };

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(
        rollups,
        capabilities,
      );

      expect(signal.reviewerRepoMode).toBe("exact");
      expect(signal.commentsStatus).toBe("full");
    });

    it("passes through partial capability flags", () => {
      const rollups = [makeRollup()];
      const capabilities: DatasetCapabilityState = {
        authorFiltersAvailable: false,
        authorRepoExactAvailable: false,
        commentsMetricsAvailable: false,
        commentsCoverageStatus: "partial",
        reviewerRepositoryMode: "disallowed",
        reviewerTeamMode: "disallowed",
        crossDimensionalAvailable: false,
      };

      const signal: DataAvailabilitySignal = deriveAvailabilitySignal(
        rollups,
        capabilities,
      );

      expect(signal.reviewerRepoMode).toBe("disallowed");
      expect(signal.commentsStatus).toBe("partial");
    });
  });
});
