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
 */
describe("FR-025: Batch execution - state isolation", () => {
  /**
   * Deep clone function that preserves NaN, Infinity, and -Infinity values.
   * JSON.stringify/parse doesn't handle these special numeric values.
   */
  function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(deepClone) as T;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
    return result as T;
  }

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
    const run1Results = TEST_CASES.map((tc) => {
      const inputCopy = deepClone(tc.input);
      const rollup = createRollupWithBreakdown(inputCopy);
      const filtered = applyFiltersToRollups([rollup], {
        repos: Object.keys(tc.input),
        teams: [],
      });
      return { id: tc.id, actual: filtered[0].pr_count, inputAfter: inputCopy };
    });

    // Run 2: Same process, same order
    const run2Results = TEST_CASES.map((tc) => {
      const rollup = createRollupWithBreakdown(deepClone(tc.input));
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
        const origVal = (originalInput as Record<string, { pr_count: unknown }>)[
          key
        ].pr_count;

        if (typeof origVal === "number" && Number.isNaN(origVal)) {
          expect(Number.isNaN(afterVal)).toBe(true);
        } else {
          expect(afterVal).toBe(origVal);
        }
      }
    }
  });
});
