/**
 * PR #207 Regression Tests
 *
 * These tests prevent recurrence of three specific regressions
 * identified during code review of PR #207:
 *
 * 1. Author param comma-split: author names with commas were truncated
 * 2. filter_caused unreachable: classifier checked array length instead
 *    of metric content (applyFiltersToRollups uses .map, not .filter)
 * 3. Patch coverage gaps in new modules
 *
 * Each test documents the exact regression and verifies the fix.
 */

import {
  parseFiltersFromUrl,
  serializeFiltersToUrl,
} from "../../ui/modules/filters";
import {
  resolveFilterConstraints,
} from "../../ui/modules/filter-constraint-resolver";
import type { FilterState } from "../../ui/modules/filters";
import {
  classifyEmptyState,
  EMPTY_STATE_MESSAGES,
  EMPTY_STATE_HINTS,
} from "../../ui/modules/empty-state-classifier";
import type { DataAvailabilitySignal } from "../../ui/types";
import type { Rollup } from "../../ui/dataset-loader";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

function makeZeroedRollup(week: string): Rollup {
  return makeRollup({
    week,
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 0,
    reviewers_count: 0,
  });
}

const defaultAvailability: DataAvailabilitySignal = {
  reviewerDataPresent: true,
  reviewerDataEmpty: false,
  cycleTimePresent: true,
  reviewerRepoMode: "constrained",
  commentsStatus: "disabled",
};

// ---------------------------------------------------------------------------
// Regression 1: Author param comma-split
// ---------------------------------------------------------------------------

describe("Regression: author param must preserve commas in names", () => {
  it("parses author with comma in name as single value", () => {
    const params = new URLSearchParams("author=Doe%2C%20Jane");
    const state = parseFiltersFromUrl(params);
    expect(state.authors).toEqual(["Doe, Jane"]);
  });

  it("parses author with literal comma as single value", () => {
    const params = new URLSearchParams();
    params.set("author", "Doe, Jane");
    const state = parseFiltersFromUrl(params);
    expect(state.authors).toEqual(["Doe, Jane"]);
  });

  it("round-trips author with comma through serialize/deserialize", () => {
    const original: FilterState = {
      repos: [],
      teams: [],
      reviewers: [],
      authors: ["Doe, Jane"],
    };
    const params = new URLSearchParams();
    serializeFiltersToUrl(original, params);
    const restored = parseFiltersFromUrl(params);
    expect(restored.authors).toEqual(["Doe, Jane"]);
  });

  it("parses reviewer with comma in ID as single value", () => {
    const params = new URLSearchParams("reviewers=org%5Cuser%2Cteam");
    const state = parseFiltersFromUrl(params);
    expect(state.reviewers).toHaveLength(1);
  });

  it("still splits repos on commas (multi-select)", () => {
    const params = new URLSearchParams("repos=alpha,beta,gamma");
    const state = parseFiltersFromUrl(params);
    expect(state.repos).toEqual(["alpha", "beta", "gamma"]);
  });

  it("still splits teams on commas (multi-select)", () => {
    const params = new URLSearchParams("teams=team-a,team-b");
    const state = parseFiltersFromUrl(params);
    expect(state.teams).toEqual(["team-a", "team-b"]);
  });

  it("handles empty author param gracefully", () => {
    const params = new URLSearchParams("author=");
    const state = parseFiltersFromUrl(params);
    expect(state.authors).toEqual([]);
  });

  it("handles whitespace-only author param gracefully", () => {
    const params = new URLSearchParams("author=   ");
    const state = parseFiltersFromUrl(params);
    expect(state.authors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regression 2: filter_caused must detect zeroed metrics, not empty array
// ---------------------------------------------------------------------------

describe("Regression: filter_caused detects zeroed metrics from applyFiltersToRollups", () => {
  it("classifies as filter_caused when filtered rollups have all-zero pr_count", () => {
    const unfilteredRollups = [
      makeRollup({ week: "2025-W01", pr_count: 10 }),
      makeRollup({ week: "2025-W02", pr_count: 15 }),
    ];
    const filteredRollups = [
      makeZeroedRollup("2025-W01"),
      makeZeroedRollup("2025-W02"),
    ];

    const result = classifyEmptyState({
      chartType: "throughput",
      filters: { repos: ["nonexistent-repo"], teams: [], reviewers: [], authors: [] },
      unfilteredRollups,
      filteredRollups,
      availability: defaultAvailability,
      minimumDataPoints: 0,
    });

    expect(result).not.toBeNull();
    expect(result!.reason).toBe("filter_caused");
    expect(result!.message).toBe(EMPTY_STATE_MESSAGES.FILTER_CAUSED);
    expect(result!.hint).toBe(EMPTY_STATE_HINTS.FILTER_CAUSED);
  });

  it("classifies as filter_caused even when filteredRollups.length > 0 but all zeroed", () => {
    // This is the exact scenario that was unreachable before the fix:
    // applyFiltersToRollups returns same-length array with zeroed fields
    const unfilteredRollups = [
      makeRollup({ week: "2025-W01", pr_count: 42 }),
    ];
    const filteredRollups = [
      makeZeroedRollup("2025-W01"),
    ];

    expect(filteredRollups).toHaveLength(1); // Same length — NOT empty

    const result = classifyEmptyState({
      chartType: "throughput",
      filters: { repos: ["filtered-repo"], teams: [], reviewers: [], authors: [] },
      unfilteredRollups,
      filteredRollups,
      availability: defaultAvailability,
      minimumDataPoints: 0,
    });

    expect(result!.reason).toBe("filter_caused");
  });

  it("does NOT classify as filter_caused when no filters are active", () => {
    const result = classifyEmptyState({
      chartType: "throughput",
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      unfilteredRollups: [makeRollup()],
      filteredRollups: [makeZeroedRollup("2025-W01")],
      availability: defaultAvailability,
      minimumDataPoints: 0,
    });

    // No filters active → not filter_caused
    expect(result?.reason).not.toBe("filter_caused");
  });

  it("does NOT classify as filter_caused when unfiltered data is also zeroed", () => {
    const result = classifyEmptyState({
      chartType: "throughput",
      filters: { repos: ["repo-a"], teams: [], reviewers: [], authors: [] },
      unfilteredRollups: [makeZeroedRollup("2025-W01")],
      filteredRollups: [makeZeroedRollup("2025-W01")],
      availability: defaultAvailability,
      minimumDataPoints: 0,
    });

    // Unfiltered is also zeroed → not filter_caused (data doesn't exist at all)
    expect(result?.reason).not.toBe("filter_caused");
  });

  it("classifies as filter_caused for reviewer_activity with zeroed reviewers_count", () => {
    const unfilteredRollups = [
      makeRollup({ week: "2025-W01", pr_count: 20, reviewers_count: 5 }),
    ];
    const filteredRollups = [
      makeZeroedRollup("2025-W01"),
    ];

    const result = classifyEmptyState({
      chartType: "reviewer_activity",
      filters: { repos: [], teams: [], reviewers: ["unknown-reviewer"], authors: [] },
      unfilteredRollups,
      filteredRollups,
      availability: defaultAvailability,
      minimumDataPoints: 0,
    });

    expect(result!.reason).toBe("filter_caused");
  });
});

// ---------------------------------------------------------------------------
// Regression 3: allMetricsZeroed edge cases
// ---------------------------------------------------------------------------

describe("Regression: allMetricsZeroed boundary conditions", () => {
  it("classifies empty filteredRollups array as filter_caused", () => {
    const result = classifyEmptyState({
      chartType: "throughput",
      filters: { repos: ["repo-a"], teams: [], reviewers: [], authors: [] },
      unfilteredRollups: [makeRollup()],
      filteredRollups: [],
      availability: defaultAvailability,
      minimumDataPoints: 0,
    });

    expect(result!.reason).toBe("filter_caused");
  });

  it("does NOT classify as filter_caused when some rollups have non-zero pr_count", () => {
    const filteredRollups = [
      makeZeroedRollup("2025-W01"),
      makeRollup({ week: "2025-W02", pr_count: 5 }),
    ];

    const result = classifyEmptyState({
      chartType: "throughput",
      filters: { repos: ["repo-a"], teams: [], reviewers: [], authors: [] },
      unfilteredRollups: [makeRollup(), makeRollup()],
      filteredRollups,
      availability: defaultAvailability,
      minimumDataPoints: 0,
    });

    // Some data remains after filter — not empty
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression 4: Author+Reviewer must use "last interaction wins"
// ---------------------------------------------------------------------------

describe("Regression: author selection replaces reviewer when author is last touched", () => {
  it("selecting author clears reviewer (lastChanged='authors')", () => {
    const result = resolveFilterConstraints(
      { repos: [], teams: [], reviewers: ["rev-1"], authors: ["auth-1"] },
      "authors",
    );
    expect(result.effectiveState.authors).toEqual(["auth-1"]);
    expect(result.effectiveState.reviewers).toEqual([]);
  });

  it("selecting reviewer clears author (lastChanged='reviewers')", () => {
    const result = resolveFilterConstraints(
      { repos: [], teams: [], reviewers: ["rev-1"], authors: ["auth-1"] },
      "reviewers",
    );
    expect(result.effectiveState.authors).toEqual([]);
    expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
  });

  it("URL restore defaults to reviewer precedence (no lastChanged)", () => {
    const result = resolveFilterConstraints(
      { repos: [], teams: [], reviewers: ["rev-1"], authors: ["auth-1"] },
    );
    expect(result.effectiveState.authors).toEqual([]);
    expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
  });
});

// ---------------------------------------------------------------------------
// Regression 5: Author+Team must retain team state
// ---------------------------------------------------------------------------

describe("Regression: team chips preserved when author filter is applied", () => {
  it("teams remain in effectiveState with author active", () => {
    const result = resolveFilterConstraints(
      { repos: [], teams: ["team-x", "team-y"], reviewers: [], authors: ["auth-1"] },
    );
    expect(result.effectiveState.teams).toEqual(["team-x", "team-y"]);
    expect(result.effectiveState.authors).toEqual(["auth-1"]);
    expect(result.constraintsApplied.some((n) => n.type === "author_team")).toBe(true);
  });

  it("teams in URL are preserved on restore with author", () => {
    const result = resolveFilterConstraints(
      { repos: [], teams: ["backend"], reviewers: [], authors: ["alice"] },
    );
    expect(result.effectiveState.teams).toEqual(["backend"]);
    expect(result.effectiveState.authors).toEqual(["alice"]);
  });
});

// ---------------------------------------------------------------------------
// Regression 6: Chip removal must clear stale constraint notices
// ---------------------------------------------------------------------------

describe("Regression: chip removal clears stale reviewer notice via resolver", () => {
  it("removing repo from reviewer+repo state clears reviewer_repo notice", () => {
    // State: reviewer + repo → resolver emits reviewer_repo notice
    const withRepo = resolveFilterConstraints(
      { repos: ["api"], teams: [], reviewers: ["bob"], authors: [] },
    );
    expect(
      withRepo.constraintsApplied.some((n) => n.type === "reviewer_repo"),
    ).toBe(true);

    // Simulate chip removal: remove repo, re-resolve
    const withoutRepo = resolveFilterConstraints(
      { repos: [], teams: [], reviewers: ["bob"], authors: [] },
    );
    // reviewer_repo notice should be gone — no conflict remains
    expect(
      withoutRepo.constraintsApplied.some((n) => n.type === "reviewer_repo"),
    ).toBe(false);
    expect(withoutRepo.constraintsApplied).toHaveLength(0);
  });

  it("removing reviewer from reviewer+team state clears reviewer_team notice", () => {
    const withReviewer = resolveFilterConstraints(
      { repos: [], teams: ["platform"], reviewers: ["bob"], authors: [] },
    );
    expect(
      withReviewer.constraintsApplied.some((n) => n.type === "reviewer_team"),
    ).toBe(true);

    const withoutReviewer = resolveFilterConstraints(
      { repos: [], teams: ["platform"], reviewers: [], authors: [] },
    );
    expect(withoutReviewer.constraintsApplied).toHaveLength(0);
  });

  it("clearing all filters produces zero notices", () => {
    const result = resolveFilterConstraints(
      { repos: [], teams: [], reviewers: [], authors: [] },
    );
    expect(result.constraintsApplied).toHaveLength(0);
  });
});
