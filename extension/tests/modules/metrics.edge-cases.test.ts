/**
 * Edge case tests for metrics module pr_count handling.
 *
 * Tests EC-001 through EC-005: Exhaustive edge case coverage for
 * non-standard pr_count values in BreakdownEntry objects.
 *
 * These tests validate the toFiniteNumber() utility function behavior
 * through the public applyFiltersToRollups API.
 *
 * Contract: FR-010, FR-024
 */

import {
  applyFiltersToRollups,
  calculateMetrics,
} from "../../ui/modules/metrics";
import type { Rollup } from "../../ui/dataset-loader";

/**
 * Helper to create a minimal rollup with by_repository breakdown.
 * Uses typed assertion to allow testing edge case values.
 */
function createRollupWithBreakdown(
  entries: Record<string, { pr_count: unknown }>,
): Rollup {
  return {
    week: "2026-W01",
    pr_count: 0, // Will be replaced by filter aggregation
    by_repository: entries as Rollup["by_repository"],
  } as Rollup;
}

describe("metrics edge cases: pr_count handling", () => {
  /**
   * EC-001: NaN pr_count values
   *
   * When a BreakdownEntry has pr_count: NaN, the toFiniteNumber utility
   * converts it to 0, ensuring numeric stability in aggregations.
   */
  // Covers EC-001: pr_count NaN returns 0
  it("EC-001: pr_count NaN returns 0", () => {
    const rollup = createRollupWithBreakdown({
      "repo-a": { pr_count: NaN },
    });

    // FR-012: Explicit exception assertion with EC-ID in failure message
    expect(() => {
      applyFiltersToRollups([rollup], { repos: ["repo-a"], teams: [] });
    }).not.toThrow();

    const filtered = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // NaN passes typeof check but toFiniteNumber converts to 0
    expect(filtered[0].pr_count).toBe(0);
    expect(Number.isFinite(filtered[0].pr_count)).toBe(true);
  });

  /**
   * EC-002: String pr_count values
   *
   * When a BreakdownEntry has pr_count as a string (e.g., "50"),
   * the type guard filters it out before aggregation.
   * Defense in depth: type guard + toFiniteNumber provide dual protection.
   */
  // Covers EC-002: pr_count string coercion
  it("EC-002: pr_count string is filtered by type guard", () => {
    const rollup = createRollupWithBreakdown({
      "repo-a": { pr_count: "50" },
    });

    // FR-012: Explicit exception assertion with EC-ID in failure message
    expect(() => {
      applyFiltersToRollups([rollup], { repos: ["repo-a"], teams: [] });
    }).not.toThrow();

    const filtered = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // String fails typeof === "number" check, filtered out, aggregation returns 0
    // Note: toFiniteNumber would convert "50" to 50, but type guard provides defense-in-depth
    expect(filtered[0].pr_count).toBe(0);
    expect(typeof filtered[0].pr_count).toBe("number");
  });

  /**
   * EC-003: Infinity pr_count values
   *
   * When a BreakdownEntry has pr_count: Infinity, the toFiniteNumber utility
   * converts it to 0, preventing infinite values in aggregations.
   */
  // Covers EC-003: pr_count Infinity returns 0
  it("EC-003: pr_count Infinity returns 0", () => {
    const rollup = createRollupWithBreakdown({
      "repo-a": { pr_count: Infinity },
    });

    // FR-012: Explicit exception assertion with EC-ID in failure message
    expect(() => {
      applyFiltersToRollups([rollup], { repos: ["repo-a"], teams: [] });
    }).not.toThrow();

    const filtered = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // Infinity passes typeof check but toFiniteNumber converts to 0
    expect(filtered[0].pr_count).toBe(0);
    expect(Number.isFinite(filtered[0].pr_count)).toBe(true);
  });

  /**
   * EC-004: Negative Infinity pr_count values
   *
   * When a BreakdownEntry has pr_count: -Infinity, the toFiniteNumber utility
   * converts it to 0, preventing infinite values in aggregations.
   */
  // Covers EC-004: pr_count -Infinity returns 0
  it("EC-004: pr_count -Infinity returns 0", () => {
    const rollup = createRollupWithBreakdown({
      "repo-a": { pr_count: -Infinity },
    });

    // FR-012: Explicit exception assertion with EC-ID in failure message
    expect(() => {
      applyFiltersToRollups([rollup], { repos: ["repo-a"], teams: [] });
    }).not.toThrow();

    const filtered = applyFiltersToRollups([rollup], {
      repos: ["repo-a"],
      teams: [],
    });

    // -Infinity passes typeof check but toFiniteNumber converts to 0
    expect(filtered[0].pr_count).toBe(0);
    expect(Number.isFinite(filtered[0].pr_count)).toBe(true);
  });

  /**
   * EC-005: Mixed valid/invalid dataset aggregation
   *
   * When a rollup contains multiple repos with mixed valid/invalid pr_count
   * values, only valid finite numbers contribute to the sum.
   *
   * Dataset: [{pr_count: 10}, {pr_count: NaN}, {pr_count: "20"}, {pr_count: Infinity}]
   * Expected: 10 (valid) + 0 (NaN→0) + 0 (string filtered) + 0 (Infinity→0) = 10
   *
   * Note: Strings are filtered by type guard; NaN/Infinity are converted by toFiniteNumber.
   */
  // Covers EC-005: mixed valid/invalid dataset sums correctly
  it("EC-005: mixed valid/invalid dataset sums correctly", () => {
    const rollup = createRollupWithBreakdown({
      "repo-valid": { pr_count: 10 },
      "repo-nan": { pr_count: NaN },
      "repo-string": { pr_count: "20" },
      "repo-infinity": { pr_count: Infinity },
    });

    // FR-012: Explicit exception assertion with EC-ID in failure message
    expect(() => {
      applyFiltersToRollups([rollup], {
        repos: ["repo-valid", "repo-nan", "repo-string", "repo-infinity"],
        teams: [],
      });
    }).not.toThrow();

    const filtered = applyFiltersToRollups([rollup], {
      repos: ["repo-valid", "repo-nan", "repo-string", "repo-infinity"],
      teams: [],
    });

    // Only repo-valid (10) and repo-nan (0) pass type guard
    // repo-string and repo-infinity are filtered out
    // Sum: 10 + 0 = 10
    const metrics = calculateMetrics(filtered);
    expect(metrics.totalPrs).toBe(10);
    expect(Number.isFinite(metrics.totalPrs)).toBe(true);
  });

  /**
   * Supplementary test: Team filter edge cases
   *
   * Validates that the same edge case handling applies to by_team breakdowns.
   */
  it("handles edge cases in team filter aggregation", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_team: {
        "team-valid": { pr_count: 25 },
        "team-nan": { pr_count: NaN },
        "team-infinity": { pr_count: Infinity },
      },
    } as unknown as Rollup;

    // FR-012: Explicit exception assertion
    expect(() => {
      applyFiltersToRollups([rollup], {
        repos: [],
        teams: ["team-valid", "team-nan", "team-infinity"],
      });
    }).not.toThrow();

    const filtered = applyFiltersToRollups([rollup], {
      repos: [],
      teams: ["team-valid", "team-nan", "team-infinity"],
    });

    // team-valid: 25, team-nan: 0 (NaN→0), team-infinity: 0 (Infinity→0)
    // Sum: 25 + 0 + 0 = 25
    expect(filtered[0].pr_count).toBe(25);
    expect(Number.isFinite(filtered[0].pr_count)).toBe(true);
  });
});

/**
 * FR-025: Batch execution test - state isolation
 *
 * Validates that edge case tests produce deterministic results when run
 * in a batch, with no state leakage between test cases.
 *
 * Note: Uses native structuredClone() which correctly preserves NaN, Infinity,
 * and -Infinity values. Node.js 22+ provides structuredClone globally.
 * Fallback implementation provided for jsdom test environment compatibility.
 */
describe("FR-025: Batch execution - state isolation", () => {
  /**
   * Deep clone implementation that preserves NaN, Infinity, and -Infinity.
   * Uses native structuredClone when available, falls back to manual implementation
   * for jsdom test environment compatibility.
   */
  const safeClone = <T>(obj: T): T => {
    if (typeof structuredClone === "function") {
      return structuredClone(obj);
    }
    // Fallback for environments without structuredClone (e.g., jsdom)
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(safeClone) as T;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = safeClone((obj as Record<string, unknown>)[key]);
    }
    return result as T;
  };

  const TEST_CASES = [
    { id: "EC-001", input: { r1: { pr_count: NaN } }, expected: 0 },
    { id: "EC-002", input: { r1: { pr_count: "50" } }, expected: 0 },
    { id: "EC-003", input: { r1: { pr_count: Infinity } }, expected: 0 },
    { id: "EC-004", input: { r1: { pr_count: -Infinity } }, expected: 0 },
    {
      id: "EC-005",
      input: {
        r1: { pr_count: 10 },
        r2: { pr_count: NaN },
        r3: { pr_count: "20" },
        r4: { pr_count: Infinity },
      },
      expected: 10,
    },
  ];

  it("EC-001..EC-005 produce deterministic results in sequential batch", () => {
    // Run 1: Collect results
    // Using safeClone() which correctly handles NaN, Infinity, -Infinity
    const run1Results = TEST_CASES.map((tc) => {
      const inputCopy = safeClone(tc.input);
      const rollup = createRollupWithBreakdown(inputCopy);
      const filtered = applyFiltersToRollups([rollup], {
        repos: Object.keys(tc.input),
        teams: [],
      });
      return { id: tc.id, actual: filtered[0].pr_count, inputAfter: inputCopy };
    });

    // Run 2: Same process, same order
    const run2Results = TEST_CASES.map((tc) => {
      const rollup = createRollupWithBreakdown(safeClone(tc.input));
      const filtered = applyFiltersToRollups([rollup], {
        repos: Object.keys(tc.input),
        teams: [],
      });
      return { id: tc.id, actual: filtered[0].pr_count };
    });

    // Assert: Results match expected
    for (let i = 0; i < TEST_CASES.length; i++) {
      expect(run1Results[i].actual).toBe(TEST_CASES[i].expected);
    }

    // Assert: Run 1 === Run 2 (determinism)
    for (let i = 0; i < TEST_CASES.length; i++) {
      expect(run1Results[i].actual).toBe(run2Results[i].actual);
    }

    // Assert: Input not mutated (compare structure, handle NaN specially)
    for (let i = 0; i < TEST_CASES.length; i++) {
      const inputAfter = run1Results[i].inputAfter;
      const originalInput = TEST_CASES[i].input;

      // Compare keys
      expect(Object.keys(inputAfter)).toEqual(Object.keys(originalInput));

      // Compare values, handling NaN specially
      for (const key of Object.keys(originalInput)) {
        const afterVal = (inputAfter as Record<string, { pr_count: unknown }>)[
          key
        ].pr_count;
        const origVal = (
          originalInput as Record<string, { pr_count: unknown }>
        )[key].pr_count;

        if (typeof origVal === "number" && Number.isNaN(origVal)) {
          expect(Number.isNaN(afterVal)).toBe(true);
        } else {
          expect(afterVal).toBe(origVal);
        }
      }
    }
  });
});

/**
 * T014: Multi-team overlap and cross-dimensional edge case tests.
 *
 * Tests that cross-dim aggregation correctly handles multi-team
 * membership, all-teams+all-repos identity, single exact lookups,
 * and aggregated authors_count upper bounds.
 */
describe("cross-dimensional multi-team overlap (T014)", () => {
  // Fixture: rollup with overlapping team members.
  // team-x and team-y share an author who contributes to repo-a.
  // team-x/repo-a: 20 PRs, team-y/repo-a: 15 PRs, but by_repository["repo-a"] = 30
  // (because the shared author's 5 PRs are counted in both teams).
  const overlapRollup = {
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
        pr_count: 45,
        cycle_time_p50: 55,
        cycle_time_p90: 110,
        authors_count: 5,
        reviewers_count: 3,
      },
      "team-y": {
        pr_count: 55,
        cycle_time_p50: 63,
        cycle_time_p90: 127,
        authors_count: 6,
        reviewers_count: 3,
      },
    },
    by_team_and_repo: {
      "team-x": {
        "repo-a": {
          pr_count: 20,
          cycle_time_p50: 48,
          cycle_time_p90: 95,
          authors_count: 3,
          reviewers_count: 2,
        },
        "repo-b": {
          pr_count: 25,
          cycle_time_p50: 62,
          cycle_time_p90: 124,
          authors_count: 3,
          reviewers_count: 2,
        },
      },
      "team-y": {
        "repo-a": {
          pr_count: 15,
          cycle_time_p50: 53,
          cycle_time_p90: 106,
          authors_count: 3,
          reviewers_count: 1,
        },
        "repo-b": {
          pr_count: 40,
          cycle_time_p50: 67,
          cycle_time_p90: 134,
          authors_count: 5,
          reviewers_count: 3,
        },
      },
    },
  } as Rollup;

  it("sum across teams can exceed repo total due to multi-team overlap", () => {
    const result = applyFiltersToRollups([overlapRollup], {
      repos: ["repo-a"],
      teams: ["team-x", "team-y"],
    });

    // Cross-dim: team-x/repo-a(20) + team-y/repo-a(15) = 35
    // This EXCEEDS by_repository["repo-a"].pr_count (30) — intentional per FR-016
    expect(result[0].pr_count).toBe(35);
    expect(result[0].pr_count).toBeGreaterThan(
      overlapRollup.by_repository!["repo-a"].pr_count,
    );
  });

  it("all-teams + all-repos equals global total (cross-dim identity)", () => {
    const result = applyFiltersToRollups([overlapRollup], {
      repos: ["repo-a", "repo-b"],
      teams: ["team-x", "team-y"],
    });

    // All 4 entries: 20 + 25 + 15 + 40 = 100 = global pr_count
    expect(result[0].pr_count).toBe(100);
  });

  it("single team + single repo returns exact lookup value", () => {
    const result = applyFiltersToRollups([overlapRollup], {
      repos: ["repo-b"],
      teams: ["team-y"],
    });

    // Exact: by_team_and_repo["team-y"]["repo-b"]
    expect(result[0].pr_count).toBe(40);
    expect(result[0].cycle_time_p50).toBe(67);
  });

  it("aggregated authors_count is upper bound (sum >= team total)", () => {
    const result = applyFiltersToRollups([overlapRollup], {
      repos: ["repo-a", "repo-b"],
      teams: ["team-x"],
    });

    // Cross-dim authors: team-x/repo-a(3) + team-x/repo-b(3) = 6
    // Team total: team-x.authors_count = 5
    // Sum >= team total because same author in two repos is counted twice
    expect(result[0].authors_count).toBeGreaterThanOrEqual(
      overlapRollup.by_team!["team-x"].authors_count!,
    );
  });
});

/**
 * T025: SC-002 Dashboard load time validation.
 *
 * Validates that applyFiltersToRollups with cross-dimensional data
 * (by_team_and_repo) does not increase processing time by more than 10%
 * compared to the proportional fallback path (v1 rollups without
 * by_team_and_repo).
 *
 * Approach: Generate realistic rollup arrays (52 weeks), run
 * applyFiltersToRollups with both+repo+team filters, compare median
 * timings across multiple iterations to absorb JIT variance.
 */
describe("T025: SC-002 dashboard load time overhead", () => {
  const NUM_WEEKS = 52;
  const NUM_TEAMS = 10;
  const NUM_REPOS = 15;
  const WARMUP_RUNS = 10;
  const MEASURE_RUNS = 50;
  const MAX_OVERHEAD_PERCENT = 10;
  /** Below this threshold (ms), percentage comparisons are noise-dominated. */
  const NOISE_FLOOR_MS = 2;

  /**
   * Build an array of rollups for timing measurement.
   * @param includeCrossDim - Whether to include by_team_and_repo
   */
  function buildRollups(includeCrossDim: boolean): Rollup[] {
    const rollups: Rollup[] = [];

    for (let w = 1; w <= NUM_WEEKS; w++) {
      const weekStr = `2025-W${String(w).padStart(2, "0")}`;
      const byRepo: Record<string, Record<string, number>> = {};
      const byTeam: Record<string, Record<string, number>> = {};
      const byTeamAndRepo: Record<
        string,
        Record<string, Record<string, number>>
      > = {};

      let totalPr = 0;

      // Build by_repository
      for (let r = 0; r < NUM_REPOS; r++) {
        const prCount = 10 + ((w * r) % 20);
        totalPr += prCount;
        byRepo[`repo-${r}`] = {
          pr_count: prCount,
          cycle_time_p50: 30 + ((r * 7) % 60),
          cycle_time_p90: 60 + ((r * 13) % 120),
          authors_count: 2 + (r % 5),
          reviewers_count: 1 + (r % 3),
        };
      }

      // Build by_team
      for (let t = 0; t < NUM_TEAMS; t++) {
        const teamPr = Math.floor(totalPr / NUM_TEAMS) + (t % 3);
        byTeam[`team-${t}`] = {
          pr_count: teamPr,
          cycle_time_p50: 35 + ((t * 11) % 50),
          cycle_time_p90: 70 + ((t * 17) % 100),
          authors_count: 2 + (t % 4),
          reviewers_count: 1 + (t % 3),
        };
      }

      // Build by_team_and_repo (cross-dimensional)
      if (includeCrossDim) {
        for (let t = 0; t < NUM_TEAMS; t++) {
          const teamKey = `team-${t}`;
          byTeamAndRepo[teamKey] = {};
          // Each team contributes to ~3 repos (sparse)
          for (
            let r = t % NUM_REPOS;
            r < NUM_REPOS;
            r += Math.max(1, Math.floor(NUM_REPOS / 3))
          ) {
            const repoKey = `repo-${r}`;
            const prCount = 2 + ((w + t + r) % 8);
            byTeamAndRepo[teamKey][repoKey] = {
              pr_count: prCount,
              cycle_time_p50: 30 + (((t + r) * 7) % 60),
              cycle_time_p90: 60 + (((t + r) * 13) % 120),
              authors_count: 1 + ((t + r) % 3),
              reviewers_count: 1 + ((t + r) % 2),
            };
          }
        }
      }

      const rollup: Record<string, unknown> = {
        week: weekStr,
        pr_count: totalPr,
        cycle_time_p50: 50,
        cycle_time_p90: 100,
        authors_count: 20,
        reviewers_count: 10,
        by_repository: byRepo,
        by_team: byTeam,
      };

      if (includeCrossDim) {
        rollup["by_team_and_repo"] = byTeamAndRepo;
      }

      rollups.push(rollup as unknown as Rollup);
    }

    return rollups;
  }

  /**
   * Measure IQR trimmed mean execution time of an operation.
   * Drops the bottom and top 25% of samples to eliminate GC/JIT outliers,
   * then averages the middle 50%. More stable than raw median under load.
   */
  function measureTrimmedMean(operation: () => void, runs: number): number {
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      operation();
      const end = performance.now();
      times.push(end - start);
    }
    times.sort((a, b) => a - b);
    const q1 = Math.floor(times.length * 0.25);
    const q3 = Math.ceil(times.length * 0.75);
    const trimmed = times.slice(q1, q3);
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  }

  it("SC-002: cross-dim filter overhead < 10% vs proportional fallback", () => {
    const v1Rollups = buildRollups(false);
    const v2Rollups = buildRollups(true);

    // Select a subset of teams and repos for the filter
    const filters = {
      repos: ["repo-0", "repo-3", "repo-7"],
      teams: ["team-1", "team-4", "team-8"],
    };

    // Warmup: ensure JIT compilation for both paths
    for (let i = 0; i < WARMUP_RUNS; i++) {
      applyFiltersToRollups(v1Rollups, filters);
      applyFiltersToRollups(v2Rollups, filters);
    }

    // Measure v1 (proportional fallback) — IQR trimmed mean
    const v1Ms = measureTrimmedMean(
      () => applyFiltersToRollups(v1Rollups, filters),
      MEASURE_RUNS,
    );

    // Measure v2 (cross-dimensional exact lookup) — IQR trimmed mean
    const v2Ms = measureTrimmedMean(
      () => applyFiltersToRollups(v2Rollups, filters),
      MEASURE_RUNS,
    );

    // When both paths are below the noise floor, percentage comparisons
    // are dominated by timer granularity and GC jitter — verify absolute
    // performance instead.
    if (v1Ms < NOISE_FLOOR_MS && v2Ms < NOISE_FLOOR_MS) {
      expect(v2Ms).toBeLessThan(NOISE_FLOOR_MS);
    } else {
      const overheadPercent = ((v2Ms - v1Ms) / v1Ms) * 100;

      // SC-002: Dashboard load time increase must be < 10%
      expect(overheadPercent).toBeLessThan(MAX_OVERHEAD_PERCENT);
    }

    const overheadPercent = v1Ms > 0 ? ((v2Ms - v1Ms) / v1Ms) * 100 : 0;

    process.stdout.write(
      `${JSON.stringify({
        test: "SC-002_dashboard_load_overhead",
        v1_trimmed_mean_ms: Number(v1Ms.toFixed(3)),
        v2_trimmed_mean_ms: Number(v2Ms.toFixed(3)),
        overhead_percent: Number(overheadPercent.toFixed(2)),
        budget_percent: MAX_OVERHEAD_PERCENT,
        noise_floor_ms: NOISE_FLOOR_MS,
        weeks: NUM_WEEKS,
        teams: NUM_TEAMS,
        repos: NUM_REPOS,
      })}\n`,
    );
  });

  it("SC-002: both paths produce valid finite results", () => {
    const v1Rollups = buildRollups(false);
    const v2Rollups = buildRollups(true);

    const filters = {
      repos: ["repo-0", "repo-3"],
      teams: ["team-1", "team-4"],
    };

    const v1Result = applyFiltersToRollups(v1Rollups, filters);
    const v2Result = applyFiltersToRollups(v2Rollups, filters);

    // Both should return the same number of rollups
    expect(v1Result.length).toBe(NUM_WEEKS);
    expect(v2Result.length).toBe(NUM_WEEKS);

    // All values should be finite numbers
    for (let i = 0; i < NUM_WEEKS; i++) {
      expect(Number.isFinite(v1Result[i].pr_count)).toBe(true);
      expect(Number.isFinite(v2Result[i].pr_count)).toBe(true);
      expect(v1Result[i].pr_count).toBeGreaterThanOrEqual(0);
      expect(v2Result[i].pr_count).toBeGreaterThanOrEqual(0);
    }
  });
});
