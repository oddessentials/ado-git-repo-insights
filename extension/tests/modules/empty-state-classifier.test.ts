/**
 * Empty State Classifier Tests
 *
 * Verifies strict short-circuit evaluation hierarchy:
 * not_extracted -> filter_caused -> minimum_data -> date_range_empty
 */

import {
  classifyEmptyState,
  EMPTY_STATE_MESSAGES,
  EMPTY_STATE_HINTS,
  type EmptyStateContext,
} from "../../ui/modules/empty-state-classifier";
import type { DataAvailabilitySignal } from "../../ui/types";
import type { FilterState } from "../../ui/modules/filters";
import type { Rollup } from "../../ui/dataset-loader";

function makeRollup(overrides: Partial<Rollup> = {}): Rollup {
  return {
    week: "2025-W01",
    pr_count: 10,
    cycle_time_p50: 3600000,
    cycle_time_p90: 7200000,
    authors_count: 3,
    reviewers_count: 2,
    by_repository: null,
    by_author: null,
    by_team: null,
    by_reviewer: null,
    ...overrides,
  };
}

const emptyFilters: FilterState = {
  repos: [],
  teams: [],
  reviewers: [],
  authors: [],
};

const activeFilters: FilterState = {
  repos: ["repo-a"],
  teams: [],
  reviewers: [],
  authors: [],
};

const defaultAvailability: DataAvailabilitySignal = {
  reviewerDataPresent: true,
  reviewerDataEmpty: false,
  cycleTimePresent: true,
  reviewerRepoMode: "constrained",
  commentsStatus: "disabled",
};

describe("Empty State Classifier", () => {
  describe("Step 1: not_extracted", () => {
    it("returns not_extracted when reviewer data not present for reviewer_activity", () => {
      const result = classifyEmptyState({
        chartType: "reviewer_activity",
        filters: emptyFilters,
        unfilteredRollups: [makeRollup()],
        filteredRollups: [],
        availability: { ...defaultAvailability, reviewerDataPresent: false },
        minimumDataPoints: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.reason).toBe("not_extracted");
      expect(result!.message).toBe(EMPTY_STATE_MESSAGES.NOT_EXTRACTED);
      expect(result!.hint).toBe(EMPTY_STATE_HINTS.NOT_EXTRACTED_REVIEWER);
    });

    it("returns not_extracted when cycle time not present for cycle_time_trend", () => {
      const result = classifyEmptyState({
        chartType: "cycle_time_trend",
        filters: emptyFilters,
        unfilteredRollups: [makeRollup()],
        filteredRollups: [],
        availability: { ...defaultAvailability, cycleTimePresent: false },
        minimumDataPoints: 2,
      });
      expect(result).not.toBeNull();
      expect(result!.reason).toBe("not_extracted");
    });

    it("never returns not_extracted for throughput (pr_count always available)", () => {
      const result = classifyEmptyState({
        chartType: "throughput",
        filters: emptyFilters,
        unfilteredRollups: [],
        filteredRollups: [],
        availability: { ...defaultAvailability, cycleTimePresent: false },
        minimumDataPoints: 0,
      });
      // Should fall through to date_range_empty, not not_extracted
      expect(result?.reason).not.toBe("not_extracted");
    });
  });

  describe("Step 2: filter_caused", () => {
    it("returns filter_caused when filters active and unfiltered data exists but filtered is empty", () => {
      const result = classifyEmptyState({
        chartType: "throughput",
        filters: activeFilters,
        unfilteredRollups: [makeRollup(), makeRollup()],
        filteredRollups: [],
        availability: defaultAvailability,
        minimumDataPoints: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.reason).toBe("filter_caused");
      expect(result!.message).toBe(EMPTY_STATE_MESSAGES.FILTER_CAUSED);
      expect(result!.hint).toBe(EMPTY_STATE_HINTS.FILTER_CAUSED);
    });

    it("does NOT return filter_caused when no filters active", () => {
      const result = classifyEmptyState({
        chartType: "throughput",
        filters: emptyFilters,
        unfilteredRollups: [makeRollup()],
        filteredRollups: [],
        availability: defaultAvailability,
        minimumDataPoints: 0,
      });
      expect(result?.reason).not.toBe("filter_caused");
    });
  });

  describe("Step 3: minimum_data", () => {
    it("returns minimum_data when filtered data exists but below threshold", () => {
      const result = classifyEmptyState({
        chartType: "cycle_time_trend",
        filters: emptyFilters,
        unfilteredRollups: [makeRollup()],
        filteredRollups: [makeRollup()],
        availability: defaultAvailability,
        minimumDataPoints: 2,
      });
      expect(result).not.toBeNull();
      expect(result!.reason).toBe("minimum_data");
      expect(result!.message).toBe(EMPTY_STATE_MESSAGES.MINIMUM_DATA_TREND);
    });
  });

  describe("Step 4: date_range_empty", () => {
    it("returns date_range_empty when no rollups at all", () => {
      const result = classifyEmptyState({
        chartType: "throughput",
        filters: emptyFilters,
        unfilteredRollups: [],
        filteredRollups: [],
        availability: defaultAvailability,
        minimumDataPoints: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.reason).toBe("date_range_empty");
      expect(result!.message).toBe(EMPTY_STATE_MESSAGES.DATE_RANGE_EMPTY);
    });
  });

  describe("Short-circuit behavior", () => {
    it("not_extracted takes priority over filter_caused", () => {
      const result = classifyEmptyState({
        chartType: "reviewer_activity",
        filters: activeFilters,
        unfilteredRollups: [makeRollup()],
        filteredRollups: [],
        availability: { ...defaultAvailability, reviewerDataPresent: false },
        minimumDataPoints: 0,
      });
      // Both not_extracted and filter_caused conditions are true,
      // but not_extracted must win (short-circuit)
      expect(result!.reason).toBe("not_extracted");
    });

    it("filter_caused takes priority over date_range_empty when filters hide all data", () => {
      const result = classifyEmptyState({
        chartType: "throughput",
        filters: activeFilters,
        unfilteredRollups: [makeRollup()],
        filteredRollups: [],
        availability: defaultAvailability,
        minimumDataPoints: 0,
      });
      expect(result!.reason).toBe("filter_caused");
    });
  });

  describe("Normal rendering (no empty state)", () => {
    it("returns null when sufficient data exists", () => {
      const result = classifyEmptyState({
        chartType: "throughput",
        filters: emptyFilters,
        unfilteredRollups: [makeRollup(), makeRollup()],
        filteredRollups: [makeRollup(), makeRollup()],
        availability: defaultAvailability,
        minimumDataPoints: 0,
      });
      expect(result).toBeNull();
    });
  });
});
