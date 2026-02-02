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
