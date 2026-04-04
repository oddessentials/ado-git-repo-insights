/**
 * FR-020: Contract activation test for review_time card visibility.
 *
 * Verifies that review_time_p50/p90 data flows correctly through
 * calculateMetrics() and extractSparklineData(), and that the schema
 * validator accepts rollups with review_time fields after the
 * forward-compat allowlist was cleared.
 */

import {
  calculateMetrics,
  extractSparklineData,
} from "../../ui/modules/metrics";
import {
  validateRollup,
  normalizeRollup,
} from "../../ui/schemas/rollup.schema";
import type { Rollup } from "../../ui/dataset-loader";

function makeRollup(overrides: Partial<Rollup> & { week: string }): Rollup {
  return {
    pr_count: 10,
    cycle_time_p50: 300,
    cycle_time_p90: 600,
    review_time_p50: null,
    review_time_p90: null,
    authors_count: 5,
    reviewers_count: 3,
    by_repository: {},
    by_team: {},
    ...overrides,
  } as Rollup;
}

describe("review-time contract activation (FR-020)", () => {
  describe("calculateMetrics with review_time data", () => {
    it("reports reviewTimeP50WeekCount > 0 when data is present", () => {
      const rollups: Rollup[] = [
        makeRollup({
          week: "2026-W01",
          review_time_p50: 150,
          review_time_p90: 300,
        }),
        makeRollup({
          week: "2026-W02",
          pr_count: 12,
          cycle_time_p50: 240,
          cycle_time_p90: 480,
          review_time_p50: 120,
          review_time_p90: 240,
        }),
      ];

      const metrics = calculateMetrics(rollups);

      expect(metrics.reviewTimeP50WeekCount).toBe(2);
      expect(metrics.reviewTimeP90WeekCount).toBe(2);
      expect(metrics.reviewTimeP50).not.toBeNull();
      expect(metrics.reviewTimeP90).not.toBeNull();
    });

    it("reports reviewTimeP50WeekCount === 0 when data is null", () => {
      const rollups: Rollup[] = [
        makeRollup({
          week: "2026-W01",
          review_time_p50: null,
          review_time_p90: null,
        }),
      ];

      const metrics = calculateMetrics(rollups);

      expect(metrics.reviewTimeP50WeekCount).toBe(0);
      expect(metrics.reviewTimeP90WeekCount).toBe(0);
      expect(metrics.reviewTimeP50).toBeNull();
      expect(metrics.reviewTimeP90).toBeNull();
    });

    it("handles per-percentile independence (P50 present, P90 null)", () => {
      const rollups: Rollup[] = [
        makeRollup({
          week: "2026-W01",
          review_time_p50: 150,
          review_time_p90: null,
        }),
      ];

      const metrics = calculateMetrics(rollups);

      expect(metrics.reviewTimeP50WeekCount).toBe(1);
      expect(metrics.reviewTimeP90WeekCount).toBe(0);
      expect(metrics.reviewTimeP50).not.toBeNull();
      expect(metrics.reviewTimeP90).toBeNull();
    });
  });

  describe("extractSparklineData with review_time", () => {
    it("extracts reviewTimeP50s and reviewTimeP90s arrays", () => {
      const rollups: Rollup[] = [
        makeRollup({
          week: "2026-W01",
          review_time_p50: 150,
          review_time_p90: 300,
        }),
        makeRollup({
          week: "2026-W02",
          review_time_p50: null,
          review_time_p90: 240,
        }),
      ];

      const sparkline = extractSparklineData(rollups);

      expect(sparkline.reviewTimeP50s).toEqual([150, null]);
      expect(sparkline.reviewTimeP90s).toEqual([300, 240]);
    });
  });

  describe("schema validation with review_time fields", () => {
    it("validates a rollup with review_time_p50/p90 fields", () => {
      const rollupData = {
        week: "2026-W01",
        start_date: "2026-01-05",
        end_date: "2026-01-11",
        pr_count: 10,
        cycle_time_p50: 300,
        cycle_time_p90: 600,
        review_time_p50: 150,
        review_time_p90: 300,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: {},
      };

      const result = validateRollup(rollupData, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validates a rollup with null review_time values", () => {
      const rollupData = {
        week: "2026-W01",
        start_date: "2026-01-05",
        end_date: "2026-01-11",
        pr_count: 10,
        cycle_time_p50: 300,
        cycle_time_p90: 600,
        review_time_p50: null,
        review_time_p90: null,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: {},
      };

      const result = validateRollup(rollupData, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("normalizes a rollup with review_time fields", () => {
      const rollupData = {
        week: "2026-W01",
        pr_count: 10,
        cycle_time_p50: 300,
        review_time_p50: 150,
        review_time_p90: null,
      };

      const normalized = normalizeRollup(rollupData);
      expect(normalized.review_time_p50).toBe(150);
      expect(normalized.review_time_p90).toBeNull();
    });
  });
});
