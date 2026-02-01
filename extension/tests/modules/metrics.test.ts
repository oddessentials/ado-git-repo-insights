/**
 * Unit tests for metrics module.
 *
 * Pure function tests - no JSDOM required.
 */

import {
  calculateMetrics,
  calculatePercentChange,
  getPreviousPeriod,
  applyFiltersToRollups,
  extractSparklineData,
  calculateMovingAverage,
} from "../../ui/modules/metrics";
import type { Rollup } from "../../ui/dataset-loader";

// Helper to create test rollups with required fields
const createRollup = (overrides: Partial<Rollup>): Rollup =>
  ({
    week: "test",
    ...overrides,
  }) as Rollup;

describe("metrics module", () => {
  describe("calculateMetrics", () => {
    it("returns zeros for empty rollups", () => {
      const result = calculateMetrics([]);
      expect(result).toEqual({
        totalPrs: 0,
        cycleP50: null,
        cycleP90: null,
        avgAuthors: 0,
        avgReviewers: 0,
      });
    });

    it("calculates totals from rollups", () => {
      const rollups = [
        {
          week: "2026-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
        } as Rollup,
        {
          week: "2026-W02",
          pr_count: 15,
          cycle_time_p50: 45,
          cycle_time_p90: 90,
          authors_count: 7,
          reviewers_count: 4,
        } as Rollup,
      ];

      const result = calculateMetrics(rollups);

      expect(result.totalPrs).toBe(25);
      expect(result.cycleP50).toBeCloseTo(52.5); // median of [60, 45]
      expect(result.cycleP90).toBeCloseTo(105); // median of [120, 90]
      expect(result.avgAuthors).toBe(6); // (5+7)/2 rounded
      expect(result.avgReviewers).toBe(4); // (3+4)/2 rounded
    });

    it("handles null cycle times", () => {
      const rollups = [
        {
          week: "2026-W01",
          pr_count: 10,
          authors_count: 5,
          reviewers_count: 3,
        } as Rollup,
      ];

      const result = calculateMetrics(rollups);

      expect(result.cycleP50).toBeNull();
      expect(result.cycleP90).toBeNull();
    });
  });

  describe("calculatePercentChange", () => {
    it("returns null for zero previous value", () => {
      expect(calculatePercentChange(100, 0)).toBeNull();
    });

    it("returns null for null previous value", () => {
      expect(calculatePercentChange(100, null)).toBeNull();
    });

    it("returns null for null current value", () => {
      expect(calculatePercentChange(null, 100)).toBeNull();
    });

    it("calculates positive change", () => {
      expect(calculatePercentChange(150, 100)).toBe(50);
    });

    it("calculates negative change", () => {
      expect(calculatePercentChange(50, 100)).toBe(-50);
    });

    it("calculates zero change", () => {
      expect(calculatePercentChange(100, 100)).toBe(0);
    });
  });

  describe("getPreviousPeriod", () => {
    it("calculates previous period for 7-day range", () => {
      const start = new Date("2026-01-08");
      const end = new Date("2026-01-14");

      const result = getPreviousPeriod(start, end);

      // Previous period should be 7 days before
      expect(result.end.getTime()).toBeLessThan(start.getTime());
    });

    it("maintains range duration", () => {
      const start = new Date("2026-01-15");
      const end = new Date("2026-01-21");

      const result = getPreviousPeriod(start, end);

      const originalDays = Math.ceil(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      );
      const previousDays = Math.ceil(
        (result.end.getTime() - result.start.getTime()) / (1000 * 60 * 60 * 24),
      );

      expect(previousDays).toBe(originalDays);
    });
  });

  describe("applyFiltersToRollups", () => {
    const baseRollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 60,
      cycle_time_p90: 120,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 30 },
        "repo-b": { pr_count: 70 },
      },
      by_team: {
        "team-x": { pr_count: 40 },
        "team-y": { pr_count: 60 },
      },
    } as Rollup;

    it("returns original data when no filters active", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: [],
        teams: [],
      });
      expect(result).toEqual([baseRollup]);
    });

    it("filters by repository", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: ["repo-a"],
        teams: [],
      });

      expect(result[0].pr_count).toBe(30);
    });

    it("filters by team", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: [],
        teams: ["team-x"],
      });

      expect(result[0].pr_count).toBe(40);
    });

    it("returns zero counts for unknown repo filter", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: ["unknown-repo"],
        teams: [],
      });

      expect(result[0].pr_count).toBe(0);
    });
  });

  describe("extractSparklineData", () => {
    it("extracts arrays from rollups", () => {
      const rollups = [
        {
          week: "W1",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
        } as Rollup,
        {
          week: "W2",
          pr_count: 15,
          cycle_time_p50: 45,
          cycle_time_p90: 90,
          authors_count: 7,
          reviewers_count: 4,
        } as Rollup,
      ];

      const result = extractSparklineData(rollups);

      expect(result.prCounts).toEqual([10, 15]);
      expect(result.p50s).toEqual([60, 45]);
      expect(result.p90s).toEqual([120, 90]);
      expect(result.authors).toEqual([5, 7]);
      expect(result.reviewers).toEqual([3, 4]);
    });

    it("handles null values as zero", () => {
      const rollups = [{ week: "W1" } as Rollup];

      const result = extractSparklineData(rollups);

      expect(result.prCounts).toEqual([0]);
      expect(result.p50s).toEqual([0]);
    });
  });

  describe("calculateMovingAverage", () => {
    it("returns nulls for insufficient data", () => {
      const values = [10, 20, 30];
      const result = calculateMovingAverage(values, 4);

      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeNull();
    });

    it("calculates 4-period moving average", () => {
      const values = [10, 20, 30, 40, 50];
      const result = calculateMovingAverage(values, 4);

      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeNull();
      expect(result[3]).toBe(25); // (10+20+30+40)/4
      expect(result[4]).toBe(35); // (20+30+40+50)/4
    });
  });
});

/**
 * Regression tests for applyFiltersToRollups object concatenation bug.
 *
 * Historical bug: by_repository and by_team values are BreakdownEntry objects
 * (e.g., { pr_count: 30 }), not primitive numbers. When the code incorrectly
 * treated them as numbers and summed them, JavaScript coerced the objects to
 * strings, resulting in "0[object Object][object Object]..." instead of a
 * numeric sum.
 *
 * These tests ensure the fix continues to work and prevent regression.
 */
describe("applyFiltersToRollups regression: object concatenation bug", () => {
  it("returns finite number, not [object Object] string, when filtering by repository", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: 30 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    expect(typeof result[0].pr_count).toBe("number");
    expect(Number.isFinite(result[0].pr_count)).toBe(true);
    expect(String(result[0].pr_count)).not.toContain("[object");
    expect(String(result[0].pr_count)).not.toContain("Object");
  });

  it("returns finite number, not [object Object] string, when filtering by team", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_team: {
        "team-x": { pr_count: 40 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: [],
      teams: ["team-x"],
    });

    expect(typeof result[0].pr_count).toBe("number");
    expect(Number.isFinite(result[0].pr_count)).toBe(true);
    expect(String(result[0].pr_count)).not.toContain("[object");
    expect(String(result[0].pr_count)).not.toContain("Object");
  });

  it("handles missing pr_count property gracefully (T013)", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": {},
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // Entry without pr_count should be filtered out, resulting in 0
    expect(result[0].pr_count).toBe(0);
  });

  it("handles null pr_count gracefully (T014)", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: null },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // Entry with null pr_count should be filtered out, resulting in 0
    expect(result[0].pr_count).toBe(0);
  });

  it("handles NaN pr_count gracefully (T015)", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: NaN },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // NaN is typeof 'number', so it passes the type guard but toFiniteNumber returns 0
    expect(typeof result[0].pr_count).toBe("number");
    expect(Number.isFinite(result[0].pr_count)).toBe(true);
    expect(result[0].pr_count).toBe(0);
  });

  it("filters out string pr_count values via type guard (T015b)", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: "50" },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // String "50" is filtered out by type guard (typeof "50" !== 'number')
    // Result is 0 since no valid entries remain after filtering
    expect(result[0].pr_count).toBe(0);
  });

  it("handles Infinity pr_count gracefully (T015c)", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: Infinity },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // Infinity is typeof 'number', so it passes the type guard but toFiniteNumber returns 0
    expect(typeof result[0].pr_count).toBe("number");
    expect(Number.isFinite(result[0].pr_count)).toBe(true);
    expect(result[0].pr_count).toBe(0);
  });

  it("sums multiple repositories correctly", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: 30 },
        "repo-b": { pr_count: 70 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a", "repo-b"],
      teams: [],
    });

    expect(result[0].pr_count).toBe(100);
  });

  it("sums multiple teams correctly", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_team: {
        "team-x": { pr_count: 40 },
        "team-y": { pr_count: 60 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: [],
      teams: ["team-x", "team-y"],
    });

    expect(result[0].pr_count).toBe(100);
  });
});
