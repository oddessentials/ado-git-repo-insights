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
        "repo-a": {
          pr_count: 30,
          cycle_time_p50: 50,
          cycle_time_p90: 100,
          authors_count: 4,
          reviewers_count: 2,
        },
        "repo-b": {
          pr_count: 70,
          cycle_time_p50: 65,
          cycle_time_p90: 130,
          authors_count: 6,
          reviewers_count: 3,
        },
      },
      by_team: {
        "team-x": {
          pr_count: 40,
          cycle_time_p50: 55,
          cycle_time_p90: 110,
          authors_count: 4,
          reviewers_count: 2,
        },
        "team-y": {
          pr_count: 60,
          cycle_time_p50: 63,
          cycle_time_p90: 127,
          authors_count: 6,
          reviewers_count: 3,
        },
      },
    } as Rollup;

    it("returns original data when no filters active", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: [],
        teams: [],
      });
      expect(result).toEqual([baseRollup]);
    });

    it("filters by repository - pr_count", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: ["repo-a"],
        teams: [],
      });

      expect(result[0].pr_count).toBe(30);
    });

    it("filters by repository - single repo cycle time", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: ["repo-a"],
        teams: [],
      });

      expect(result[0].cycle_time_p50).toBe(50);
      expect(result[0].cycle_time_p90).toBe(100);
      expect(result[0].authors_count).toBe(4);
      expect(result[0].reviewers_count).toBe(2);
    });

    it("filters by repository - multi-repo weighted average cycle time", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: ["repo-a", "repo-b"],
        teams: [],
      });

      // Weighted avg: (50*30 + 65*70) / (30+70) = (1500+4550)/100 = 60.5
      expect(result[0].pr_count).toBe(100);
      expect(result[0].cycle_time_p50).toBeCloseTo(60.5);
      // Weighted avg: (100*30 + 130*70) / 100 = (3000+9100)/100 = 121
      expect(result[0].cycle_time_p90).toBeCloseTo(121);
      expect(result[0].authors_count).toBe(10);
      expect(result[0].reviewers_count).toBe(5);
    });

    it("filters by repository - legacy data with pr_count only", () => {
      const legacyRollup = {
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
      } as unknown as Rollup;

      const result = applyFiltersToRollups([legacyRollup], {
        repos: ["repo-a"],
        teams: [],
      });

      // Legacy: only pr_count available, cycle time preserved from rollup
      expect(result[0].pr_count).toBe(30);
      // No per-repo cycle time -> hasPerRepoCycleTime is false -> original values preserved
      expect(result[0].cycle_time_p50).toBe(60);
      expect(result[0].cycle_time_p90).toBe(120);
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

    it("applies both repo and team filters with proportional intersection", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: ["repo-a"],
        teams: ["team-x"],
      });

      // repo-a = 30/100 = 30%, team-x = 40/100 = 40%
      // Combined: 100 * 0.3 * 0.4 = 12
      expect(result[0].pr_count).toBe(12);
      // authors: round(10 * 0.12) = 1, reviewers: round(5 * 0.12) = 1
      expect(result[0].authors_count).toBe(1);
      expect(result[0].reviewers_count).toBe(1);
      // Cycle time: average of repo-a (50) and team-x (55) = 52.5
      expect(result[0].cycle_time_p50).toBeCloseTo(52.5);
      expect(result[0].cycle_time_p90).toBeCloseTo(105);
    });

    it("returns zeros when both filters active and one matches nothing", () => {
      const result = applyFiltersToRollups([baseRollup], {
        repos: ["unknown-repo"],
        teams: ["team-x"],
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
        "repo-a": { pr_count: 30, authors_count: 4, reviewers_count: 2 },
        "repo-b": { pr_count: 70, authors_count: 6, reviewers_count: 3 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a", "repo-b"],
      teams: [],
    });

    expect(result[0].pr_count).toBe(100);
    expect(result[0].authors_count).toBe(10);
    expect(result[0].reviewers_count).toBe(5);
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

/**
 * Coverage gap tests for applyFiltersToRollups edge cases.
 *
 * Targets uncovered lines/branches identified by Codecov patch coverage:
 * - metrics.ts:296 (team filter zeroed rollup when no entries match)
 * - metrics.ts:351 (passthrough when rollup lacks breakdown objects)
 * - Combined filter partial branches (zero counts, missing cycle times)
 */
describe("applyFiltersToRollups coverage: uncovered paths", () => {
  it("returns zeroed rollup when team filter matches no entries", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 60,
      cycle_time_p90: 120,
      authors_count: 10,
      reviewers_count: 5,
      by_team: {
        "team-x": { pr_count: 40, cycle_time_p50: 55, cycle_time_p90: 110, authors_count: 4, reviewers_count: 2 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: [],
      teams: ["unknown-team"],
    });

    expect(result[0].pr_count).toBe(0);
    expect(result[0].cycle_time_p50).toBeNull();
    expect(result[0].cycle_time_p90).toBeNull();
    expect(result[0].authors_count).toBe(0);
    expect(result[0].reviewers_count).toBe(0);
  });

  it("passes through rollup when filters active but breakdown objects missing", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 50,
      cycle_time_p50: 30,
      cycle_time_p90: 70,
      authors_count: 3,
      reviewers_count: 2,
      by_repository: null,
      by_team: null,
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // No breakdown data available — rollup passes through unchanged
    expect(result[0].pr_count).toBe(50);
    expect(result[0].cycle_time_p50).toBe(30);
  });

  it("combined filter handles rollup with pr_count = 0", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 0,
      cycle_time_p50: null,
      cycle_time_p90: null,
      authors_count: 0,
      reviewers_count: 0,
      by_repository: {
        "repo-a": { pr_count: 0, authors_count: 0, reviewers_count: 0 },
      },
      by_team: {
        "team-x": { pr_count: 0, authors_count: 0, reviewers_count: 0 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    expect(result[0].pr_count).toBe(0);
  });

  it("combined filter handles missing authors and reviewers counts", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: 50 },
      },
      by_team: {
        "team-x": { pr_count: 40 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // Proportional intersection: 50/100 * 40/100 = 0.2 → 100 * 0.2 = 20
    expect(result[0].pr_count).toBe(20);
    // No cycle times in breakdown entries → no cycle time in result
    expect(result[0].cycle_time_p50).toBeUndefined();
  });

  it("combined filter with no cycle time data in either slice", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 30, authors_count: 3, reviewers_count: 1 },
      },
      by_team: {
        "team-x": { pr_count: 40, authors_count: 4, reviewers_count: 2 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // 30/100 * 40/100 = 0.12 → pr_count = round(100 * 0.12) = 12
    expect(result[0].pr_count).toBe(12);
    // No cycle_time in breakdown entries → p50s empty → no cycle time spread
    expect(result[0]).not.toHaveProperty("cycle_time_p50");
    // authors: round(10 * 0.12) = 1, reviewers: round(5 * 0.12) = 1
    expect(result[0].authors_count).toBe(1);
    expect(result[0].reviewers_count).toBe(1);
  });

  it("combined filter where proportional ratio rounds authors and reviewers to zero", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 1000,
      authors_count: 2,
      reviewers_count: 1,
      by_repository: {
        "repo-a": { pr_count: 10, authors_count: 1, reviewers_count: 1 },
      },
      by_team: {
        "team-x": { pr_count: 10, authors_count: 1, reviewers_count: 1 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // 10/1000 * 10/1000 = 0.0001
    // authors: round(2 * 0.0001) = 0, reviewers: round(1 * 0.0001) = 0
    expect(result[0].pr_count).toBe(0);
    // When combinedAuthors/combinedReviewers round to 0, the conditional spread
    // is {}, so the original rollup values are preserved from ...rollup
    expect(result[0].authors_count).toBe(2);
    expect(result[0].reviewers_count).toBe(1);
  });
});
