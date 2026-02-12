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

  it("combined filter returns null cycle_time_p90 when p90s array is empty", () => {
    // aggregateEntries now correctly excludes null cycle times from the
    // weighted average, so entries with null p90 produce null (not 0).
    // The downstream p90s.filter(v => v !== null) guard produces an empty
    // array, and the p90s.length > 0 check prevents NaN from 0/0.
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 60,
      cycle_time_p90: 120,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 50, cycle_time_p50: 55, cycle_time_p90: null, authors_count: 5, reviewers_count: 3 },
      },
      by_team: {
        "team-x": { pr_count: 40, cycle_time_p50: 58, cycle_time_p90: null, authors_count: 4, reviewers_count: 2 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // p50s has values from both slices → averaged
    expect(result[0].cycle_time_p50).toBeCloseTo((55 + 58) / 2);
    // null p90 entries are excluded → aggregateEntries returns null p90
    // → p90s filter produces empty array → guard returns null
    expect(result[0].cycle_time_p90).toBeNull();
  });

  it("clamps teamShare to 1 when overlapping team members inflate team slice", () => {
    // Simulate overlapping teams: team-x and team-y each have 60 PRs
    // due to shared author, but rollup total is only 100
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 60,
      cycle_time_p90: 120,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 50, cycle_time_p50: 55, cycle_time_p90: 110, authors_count: 5, reviewers_count: 3 },
      },
      by_team: {
        "team-x": { pr_count: 60, cycle_time_p50: 58, cycle_time_p90: 115, authors_count: 6, reviewers_count: 3 },
        "team-y": { pr_count: 60, cycle_time_p50: 62, cycle_time_p90: 125, authors_count: 6, reviewers_count: 3 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: ["team-x", "team-y"],
    });

    // Without clamping: teamShare = 120/100 = 1.2, combinedRatio = 0.5 * 1.2 = 0.6
    //   → combinedPrCount = round(100 * 0.6) = 60 (exceeds repo's 50!)
    // With clamping:    teamShare = min(1, 1.2) = 1.0, combinedRatio = 0.5 * 1.0 = 0.5
    //   → combinedPrCount = round(100 * 0.5) = 50 (correct: repo-a has 50)
    expect(result[0].pr_count).toBeLessThanOrEqual(100);
    expect(result[0].pr_count).toBe(50);
    expect(result[0].authors_count).toBeLessThanOrEqual(10);
    expect(result[0].reviewers_count).toBeLessThanOrEqual(5);
  });

  it("mixed cycle-time: entries without cycle data do not dilute weighted average", () => {
    // service-a has cycle-time, service-b does not.
    // The weighted average should use only service-a's PR count as denominator.
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 80,
      cycle_time_p90: 160,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "service-a": { pr_count: 50, cycle_time_p50: 120, cycle_time_p90: 200, authors_count: 5, reviewers_count: 3 },
        "service-b": { pr_count: 50, authors_count: 5, reviewers_count: 2 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["service-a", "service-b"],
      teams: [],
    });

    // Only service-a has cycle-time data, so the average should equal service-a's values
    // (not diluted by service-b's 50 PRs)
    expect(result[0].cycle_time_p50).toBe(120);
    expect(result[0].cycle_time_p90).toBe(200);
    expect(result[0].pr_count).toBe(100);
  });

  it("all-null cycle-time entries return null (not 0)", () => {
    // When breakdown entries have null cycle times, aggregateEntries returns
    // null (not 0). buildFilteredRollup then falls back to the rollup-level
    // values via ...rollup spread (backward compat). To verify aggregateEntries
    // produces null, set rollup-level cycle times to null too.
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: null,
      cycle_time_p90: null,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 60, cycle_time_p50: null, cycle_time_p90: null, authors_count: 6, reviewers_count: 3 },
        "repo-b": { pr_count: 40, cycle_time_p50: null, cycle_time_p90: null, authors_count: 4, reviewers_count: 2 },
      },
    } as unknown as Rollup;

    const result = applyFiltersToRollups([rollup], {
      repos: ["repo-a", "repo-b"],
      teams: [],
    });

    // Both entries have null cycle times → aggregateEntries returns null →
    // buildFilteredRollup falls back to rollup's null → result is null
    expect(result[0].cycle_time_p50).toBeNull();
    expect(result[0].cycle_time_p90).toBeNull();
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

describe("Compare mode with filters", () => {
  const currentRollup = {
    week: "2026-W03",
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

  const previousRollup = {
    week: "2026-W02",
    pr_count: 80,
    cycle_time_p50: 55,
    cycle_time_p90: 110,
    authors_count: 8,
    reviewers_count: 4,
    by_repository: {
      "repo-a": {
        pr_count: 50,
        cycle_time_p50: 45,
        cycle_time_p90: 90,
        authors_count: 5,
        reviewers_count: 3,
      },
      "repo-b": {
        pr_count: 30,
        cycle_time_p50: 70,
        cycle_time_p90: 140,
        authors_count: 3,
        reviewers_count: 1,
      },
    },
    by_team: {
      "team-x": {
        pr_count: 60,
        cycle_time_p50: 50,
        cycle_time_p90: 100,
        authors_count: 6,
        reviewers_count: 3,
      },
      "team-y": {
        pr_count: 20,
        cycle_time_p50: 70,
        cycle_time_p90: 140,
        authors_count: 2,
        reviewers_count: 1,
      },
    },
  } as Rollup;

  it("same filter applied to both periods produces consistent proportional results", () => {
    const filter = { repos: ["repo-a"], teams: [] };
    const currentFiltered = applyFiltersToRollups([currentRollup], filter);
    const previousFiltered = applyFiltersToRollups([previousRollup], filter);

    // Current: repo-a has 30 of 100 PRs
    expect(currentFiltered[0].pr_count).toBe(30);
    // Previous: repo-a has 50 of 80 PRs
    expect(previousFiltered[0].pr_count).toBe(50);

    // Cycle times should come from repo-a directly
    expect(currentFiltered[0].cycle_time_p50).toBe(50);
    expect(previousFiltered[0].cycle_time_p50).toBe(45);
  });

  it("filter zeroes out one period when repo missing from previous", () => {
    const prevWithoutRepoC = {
      ...previousRollup,
      by_repository: {
        "repo-a": previousRollup.by_repository!["repo-a"],
      },
    } as Rollup;

    const filter = { repos: ["repo-b"], teams: [] };
    const currentFiltered = applyFiltersToRollups([currentRollup], filter);
    const previousFiltered = applyFiltersToRollups([prevWithoutRepoC], filter);

    // Current: repo-b exists, should get its PRs
    expect(currentFiltered[0].pr_count).toBe(70);
    // Previous: repo-b doesn't exist, should get 0
    expect(previousFiltered[0].pr_count).toBe(0);
  });

  it("combined repo+team filter in both periods applies proportional intersection", () => {
    const filter = { repos: ["repo-a"], teams: ["team-x"] };
    const currentFiltered = applyFiltersToRollups([currentRollup], filter);
    const previousFiltered = applyFiltersToRollups([previousRollup], filter);

    // Current: repo-a share = 30/100 = 0.3, team-x share = 40/100 = 0.4
    // Combined pr_count = round(100 * 0.3 * 0.4) = round(12) = 12
    expect(currentFiltered[0].pr_count).toBe(12);

    // Previous: repo-a share = 50/80 = 0.625, team-x share = 60/80 = 0.75
    // Combined pr_count = round(80 * 0.625 * 0.75) = round(37.5) = 38
    expect(previousFiltered[0].pr_count).toBe(38);
  });

  it("getPreviousPeriod with non-midnight boundary returns end exactly 1 day before start", () => {
    const start = new Date("2026-01-15T14:30:00Z");
    const end = new Date("2026-01-22T14:30:00Z");

    const result = getPreviousPeriod(start, end);

    // Previous period end should be exactly 1 day (86,400,000ms) before start
    expect(result.end.getTime()).toBe(start.getTime() - 86_400_000);
    // The end should be Jan 14 at 14:30 UTC
    expect(result.end.toISOString()).toBe("2026-01-14T14:30:00.000Z");
    // Duration should be preserved
    const originalDuration = end.getTime() - start.getTime();
    const prevDuration = result.end.getTime() - result.start.getTime();
    expect(prevDuration).toBe(originalDuration);
  });
});

/**
 * T013: Cross-dimensional exact lookup tests.
 *
 * Validates that when by_team_and_repo is present in a rollup, the filter
 * resolution uses exact cross-dimensional lookup instead of proportional
 * estimation. When by_team_and_repo is absent, falls back to proportional.
 *
 * Consistency check holds: team-x: 20+20=40, team-y: 10+50=60.
 */
describe("cross-dimensional exact lookup (T013)", () => {
  // Shared test rollup with consistent cross-dim data
  const crossDimRollup = {
    week: "2026-W01",
    pr_count: 100,
    cycle_time_p50: 60,
    cycle_time_p90: 120,
    authors_count: 10,
    reviewers_count: 5,
    by_repository: {
      "repo-a": { pr_count: 30, cycle_time_p50: 50, cycle_time_p90: 100, authors_count: 4, reviewers_count: 2 },
      "repo-b": { pr_count: 70, cycle_time_p50: 65, cycle_time_p90: 130, authors_count: 6, reviewers_count: 3 },
    },
    by_team: {
      "team-x": { pr_count: 40, cycle_time_p50: 55, cycle_time_p90: 110, authors_count: 4, reviewers_count: 2 },
      "team-y": { pr_count: 60, cycle_time_p50: 63, cycle_time_p90: 127, authors_count: 6, reviewers_count: 3 },
    },
    by_team_and_repo: {
      "team-x": {
        "repo-a": { pr_count: 20, cycle_time_p50: 45, cycle_time_p90: 95, authors_count: 3, reviewers_count: 2 },
        "repo-b": { pr_count: 20, cycle_time_p50: 65, cycle_time_p90: 125, authors_count: 3, reviewers_count: 2 },
      },
      "team-y": {
        "repo-a": { pr_count: 10, cycle_time_p50: 55, cycle_time_p90: 105, authors_count: 2, reviewers_count: 1 },
        "repo-b": { pr_count: 50, cycle_time_p50: 65, cycle_time_p90: 130, authors_count: 5, reviewers_count: 3 },
      },
    },
  } as Rollup;

  // Validates exact cross-dim lookup returns precise values from the
  // by_team_and_repo intersection rather than proportional estimation.
  it("exact cross-dim lookup returns correct values when by_team_and_repo present", () => {
    const result = applyFiltersToRollups([crossDimRollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // Exact lookup: by_team_and_repo["team-x"]["repo-a"]
    expect(result[0].pr_count).toBe(20);
    expect(result[0].cycle_time_p50).toBe(45);
    expect(result[0].cycle_time_p90).toBe(95);
    expect(result[0].authors_count).toBe(3);
    expect(result[0].reviewers_count).toBe(2);
  });

  // Validates that selecting a team-repo pair with no intersection entry
  // returns zeroed metrics when the cross-dim lookup misses.
  it("zeroed result when selected team has no entries in selected repo", () => {
    const rollupWithGap = {
      ...crossDimRollup,
      by_team: {
        ...crossDimRollup.by_team,
        "team-z": { pr_count: 10, cycle_time_p50: 50, cycle_time_p90: 100, authors_count: 2, reviewers_count: 1 },
      },
      by_team_and_repo: {
        ...crossDimRollup.by_team_and_repo,
        // team-z has no repo-a entry in cross-dim data
        "team-z": {
          "repo-b": { pr_count: 10, cycle_time_p50: 65, cycle_time_p90: 130, authors_count: 2, reviewers_count: 1 },
        },
      },
    } as Rollup;

    const result = applyFiltersToRollups([rollupWithGap], {
      repos: ["repo-a"],
      teams: ["team-z"],
    });

    // No matching cross-dim entry for team-z + repo-a -> zeroed result
    expect(result[0].pr_count).toBe(0);
    expect(result[0].cycle_time_p50).toBeNull();
    expect(result[0].cycle_time_p90).toBeNull();
    expect(result[0].authors_count).toBe(0);
    expect(result[0].reviewers_count).toBe(0);
  });

  // Validates that selecting 2 teams and 2 repos aggregates (sums) pr_count
  // across all matching cross-dim entries correctly.
  it("cross-dim lookup with multiple teams and repos aggregates correctly", () => {
    const result = applyFiltersToRollups([crossDimRollup], {
      repos: ["repo-a", "repo-b"],
      teams: ["team-x", "team-y"],
    });

    // Aggregation across all 4 cross-dim entries:
    // team-x/repo-a: 20, team-x/repo-b: 20, team-y/repo-a: 10, team-y/repo-b: 50
    // Total: 20 + 20 + 10 + 50 = 100
    expect(result[0].pr_count).toBe(100);
    // authors: 3 + 3 + 2 + 5 = 13
    expect(result[0].authors_count).toBe(13);
    // reviewers: 2 + 2 + 1 + 3 = 8
    expect(result[0].reviewers_count).toBe(8);
  });

  // Validates that without by_team_and_repo, the function falls through to
  // proportional estimation (existing v1 behavior).
  it("falls through to proportional when by_team_and_repo absent", () => {
    const v1Rollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 60,
      cycle_time_p90: 120,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 30, cycle_time_p50: 50, cycle_time_p90: 100, authors_count: 4, reviewers_count: 2 },
        "repo-b": { pr_count: 70, cycle_time_p50: 65, cycle_time_p90: 130, authors_count: 6, reviewers_count: 3 },
      },
      by_team: {
        "team-x": { pr_count: 40, cycle_time_p50: 55, cycle_time_p90: 110, authors_count: 4, reviewers_count: 2 },
        "team-y": { pr_count: 60, cycle_time_p50: 63, cycle_time_p90: 127, authors_count: 6, reviewers_count: 3 },
      },
      // No by_team_and_repo field
    } as Rollup;

    const result = applyFiltersToRollups([v1Rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // Proportional estimation: repoShare = 30/100 = 0.3, teamShare = 40/100 = 0.4
    // combinedPrCount = round(100 * 0.3 * 0.4) = 12
    expect(result[0].pr_count).toBe(12);
    // Cycle time: average of repo-a p50 (50) and team-x p50 (55) = 52.5
    expect(result[0].cycle_time_p50).toBeCloseTo(52.5);
  });
});

/**
 * T018: Legacy rollup fallback tests.
 *
 * Validates backward compatibility with v1 rollups that lack the
 * by_team_and_repo cross-dimensional field. These rollups must continue
 * to use proportional estimation when both team and repo filters are active.
 */
describe("legacy rollup fallback (T018)", () => {
  // Validates that proportional fallback produces expected results when
  // by_team_and_repo is absent from the rollup.
  it("proportional fallback when by_team_and_repo absent produces expected results", () => {
    const legacyRollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 60,
      cycle_time_p90: 120,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 30, cycle_time_p50: 50, cycle_time_p90: 100, authors_count: 4, reviewers_count: 2 },
        "repo-b": { pr_count: 70, cycle_time_p50: 65, cycle_time_p90: 130, authors_count: 6, reviewers_count: 3 },
      },
      by_team: {
        "team-x": { pr_count: 40, cycle_time_p50: 55, cycle_time_p90: 110, authors_count: 4, reviewers_count: 2 },
        "team-y": { pr_count: 60, cycle_time_p50: 63, cycle_time_p90: 127, authors_count: 6, reviewers_count: 3 },
      },
      // No by_team_and_repo field
    } as Rollup;

    const result = applyFiltersToRollups([legacyRollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // Proportional: repoShare = 30/100 = 0.3, teamShare = 40/100 = 0.4
    // Combined ratio = 0.12
    // pr_count = round(100 * 0.12) = 12
    expect(result[0].pr_count).toBe(12);
    // authors: round(10 * 0.12) = 1
    expect(result[0].authors_count).toBe(1);
    // reviewers: round(5 * 0.12) = 1
    expect(result[0].reviewers_count).toBe(1);
    // Cycle time p50: avg(50, 55) = 52.5
    expect(result[0].cycle_time_p50).toBeCloseTo(52.5);
    // Cycle time p90: avg(100, 110) = 105
    expect(result[0].cycle_time_p90).toBeCloseTo(105);
  });

  // Validates that a v1 rollup without by_team_and_repo field still works
  // correctly when both team and repo filters are applied.
  it("v1 rollup loads and applies filters without errors", () => {
    const v1Rollup = {
      week: "2026-W01",
      pr_count: 200,
      cycle_time_p50: 80,
      cycle_time_p90: 160,
      authors_count: 15,
      reviewers_count: 8,
      by_repository: {
        "service-api": { pr_count: 120, cycle_time_p50: 70, cycle_time_p90: 140, authors_count: 9, reviewers_count: 5 },
        "service-web": { pr_count: 80, cycle_time_p50: 95, cycle_time_p90: 190, authors_count: 6, reviewers_count: 3 },
      },
      by_team: {
        "backend": { pr_count: 130, cycle_time_p50: 75, cycle_time_p90: 150, authors_count: 10, reviewers_count: 6 },
        "frontend": { pr_count: 70, cycle_time_p50: 90, cycle_time_p90: 180, authors_count: 5, reviewers_count: 2 },
      },
    } as Rollup;

    // Should not throw when by_team_and_repo is absent
    expect(() => {
      applyFiltersToRollups([v1Rollup], {
        repos: ["service-api"],
        teams: ["backend"],
      });
    }).not.toThrow();

    const result = applyFiltersToRollups([v1Rollup], {
      repos: ["service-api"],
      teams: ["backend"],
    });

    // Result should be a valid rollup with finite numbers
    expect(typeof result[0].pr_count).toBe("number");
    expect(Number.isFinite(result[0].pr_count)).toBe(true);
    expect(result[0].pr_count).toBeGreaterThan(0);
    expect(result[0].week).toBe("2026-W01");
  });
});

/**
 * T019: Mixed-week blend tests.
 *
 * Validates that when processing an array of rollups where some weeks have
 * by_team_and_repo (v2) and some do not (v1), each rollup independently
 * uses the correct resolution strategy: exact lookup for v2, proportional
 * estimation for v1.
 */
describe("mixed-week blend (T019)", () => {
  // Validates that in a mixed array, the v2 rollup uses exact lookup while
  // the v1 rollup uses proportional estimation.
  it("exact weeks use lookup, estimated weeks use proportional", () => {
    // Week 1: v2 rollup with by_team_and_repo (exact lookup)
    const v2Rollup = {
      week: "2026-W01",
      pr_count: 100,
      cycle_time_p50: 60,
      cycle_time_p90: 120,
      authors_count: 10,
      reviewers_count: 5,
      by_repository: {
        "repo-a": { pr_count: 30, cycle_time_p50: 50, cycle_time_p90: 100, authors_count: 4, reviewers_count: 2 },
        "repo-b": { pr_count: 70, cycle_time_p50: 65, cycle_time_p90: 130, authors_count: 6, reviewers_count: 3 },
      },
      by_team: {
        "team-x": { pr_count: 40, cycle_time_p50: 55, cycle_time_p90: 110, authors_count: 4, reviewers_count: 2 },
        "team-y": { pr_count: 60, cycle_time_p50: 63, cycle_time_p90: 127, authors_count: 6, reviewers_count: 3 },
      },
      by_team_and_repo: {
        "team-x": {
          "repo-a": { pr_count: 20, cycle_time_p50: 45, cycle_time_p90: 95, authors_count: 3, reviewers_count: 2 },
          "repo-b": { pr_count: 20, cycle_time_p50: 65, cycle_time_p90: 125, authors_count: 3, reviewers_count: 2 },
        },
        "team-y": {
          "repo-a": { pr_count: 10, cycle_time_p50: 55, cycle_time_p90: 105, authors_count: 2, reviewers_count: 1 },
          "repo-b": { pr_count: 50, cycle_time_p50: 65, cycle_time_p90: 130, authors_count: 5, reviewers_count: 3 },
        },
      },
    } as Rollup;

    // Week 2: v1 rollup without by_team_and_repo (proportional fallback)
    const v1Rollup = {
      week: "2026-W02",
      pr_count: 80,
      cycle_time_p50: 55,
      cycle_time_p90: 110,
      authors_count: 8,
      reviewers_count: 4,
      by_repository: {
        "repo-a": { pr_count: 40, cycle_time_p50: 48, cycle_time_p90: 96, authors_count: 4, reviewers_count: 2 },
        "repo-b": { pr_count: 40, cycle_time_p50: 62, cycle_time_p90: 124, authors_count: 4, reviewers_count: 2 },
      },
      by_team: {
        "team-x": { pr_count: 48, cycle_time_p50: 52, cycle_time_p90: 104, authors_count: 5, reviewers_count: 2 },
        "team-y": { pr_count: 32, cycle_time_p50: 60, cycle_time_p90: 120, authors_count: 3, reviewers_count: 2 },
      },
    } as Rollup;

    const result = applyFiltersToRollups([v2Rollup, v1Rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // Week 1 (v2): exact lookup team-x + repo-a = 20
    expect(result[0].pr_count).toBe(20);
    expect(result[0].cycle_time_p50).toBe(45);

    // Week 2 (v1): proportional = round(80 * (40/80) * (48/80)) = round(80 * 0.5 * 0.6) = round(24) = 24
    expect(result[1].pr_count).toBe(24);
    // Cycle time: avg(48, 52) = 50
    expect(result[1].cycle_time_p50).toBeCloseTo(50);
  });

  // Validates that by_team_and_repo !== undefined correctly distinguishes
  // exact from estimated resolution on a per-rollup basis.
  it("per-week accuracy derivable from field presence", () => {
    const v2Rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: { "repo-a": { pr_count: 50 } },
      by_team: { "team-x": { pr_count: 60 } },
      by_team_and_repo: {
        "team-x": { "repo-a": { pr_count: 35 } },
      },
    } as unknown as Rollup;

    const v1Rollup = {
      week: "2026-W02",
      pr_count: 100,
      by_repository: { "repo-a": { pr_count: 50 } },
      by_team: { "team-x": { pr_count: 60 } },
    } as unknown as Rollup;

    // by_team_and_repo presence correctly distinguishes resolution strategy
    expect(v2Rollup.by_team_and_repo !== undefined).toBe(true);
    expect(v1Rollup.by_team_and_repo !== undefined).toBe(false);

    const results = applyFiltersToRollups([v2Rollup, v1Rollup], {
      repos: ["repo-a"],
      teams: ["team-x"],
    });

    // v2 uses exact: 35 (from cross-dim lookup)
    expect(results[0].pr_count).toBe(35);

    // v1 uses proportional: round(100 * 0.5 * 0.6) = 30
    expect(results[1].pr_count).toBe(30);

    // The two values differ, confirming different resolution paths
    expect(results[0].pr_count).not.toBe(results[1].pr_count);
  });
});
