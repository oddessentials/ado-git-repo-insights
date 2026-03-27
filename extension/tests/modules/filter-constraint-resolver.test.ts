/**
 * Filter Constraint Resolver Tests
 *
 * Verifies all filter dimension combinations and constraint rules.
 * The resolver is the SOLE AUTHORITY for filter constraints (FR-010).
 */

import {
  resolveFilterConstraints,
  type FilterConstraintResult,
} from "../../ui/modules/filter-constraint-resolver";
import type { FilterState } from "../../ui/modules/filters";

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    repos: [],
    teams: [],
    reviewers: [],
    authors: [],
    ...overrides,
  };
}

describe("Filter Constraint Resolver", () => {
  describe("No constraints (single-dimension filters)", () => {
    it("passes through repos-only unchanged", () => {
      const result = resolveFilterConstraints(
        makeFilters({ repos: ["repo-a", "repo-b"] }),
      );
      expect(result.effectiveState.repos).toEqual(["repo-a", "repo-b"]);
      expect(result.constraintsApplied).toHaveLength(0);
    });

    it("passes through teams-only unchanged", () => {
      const result = resolveFilterConstraints(
        makeFilters({ teams: ["team-x"] }),
      );
      expect(result.effectiveState.teams).toEqual(["team-x"]);
      expect(result.constraintsApplied).toHaveLength(0);
    });

    it("passes through reviewer-only unchanged", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"] }),
      );
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.constraintsApplied).toHaveLength(0);
    });

    it("passes through author-only unchanged", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"] }),
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
      expect(result.constraintsApplied).toHaveLength(0);
    });

    it("passes through empty filters unchanged", () => {
      const result = resolveFilterConstraints(makeFilters());
      expect(result.effectiveState).toEqual(makeFilters());
      expect(result.constraintsApplied).toHaveLength(0);
    });
  });

  describe("Rule 1: Author + Team -> clear teams", () => {
    it("clears teams when author and team both active", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], teams: ["team-x"] }),
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
      expect(result.effectiveState.teams).toEqual([]);
      expect(result.constraintsApplied).toHaveLength(1);
      expect(result.constraintsApplied[0].type).toBe("author_team");
    });

    it("preserves repos when author + team constrained", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          teams: ["team-x"],
          repos: ["repo-a"],
        }),
      );
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
    });
  });

  describe("Rule 2: Reviewer + Team -> clear teams", () => {
    it("clears teams when reviewer and team both active", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"], teams: ["team-x"] }),
      );
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.teams).toEqual([]);
      expect(result.constraintsApplied.some((n) => n.type === "reviewer_team")).toBe(true);
    });
  });

  describe("Rule 3: Reviewer + Repo -> notice only", () => {
    it("retains both reviewer and repo in state", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"], repos: ["repo-a"] }),
      );
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
      expect(result.constraintsApplied.some((n) => n.type === "reviewer_repo")).toBe(true);
    });
  });

  describe("Single-select enforcement", () => {
    it("truncates multiple reviewers to first only", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1", "rev-2", "rev-3"] }),
      );
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
    });

    it("truncates multiple authors to first only", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1", "auth-2"] }),
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
    });
  });

  describe("Determinism", () => {
    it("produces identical output for identical input", () => {
      const input = makeFilters({
        authors: ["auth-1"],
        teams: ["team-x"],
        repos: ["repo-a"],
      });
      const result1 = resolveFilterConstraints(input);
      const result2 = resolveFilterConstraints(input);
      expect(result1.effectiveState).toEqual(result2.effectiveState);
      expect(result1.constraintsApplied).toEqual(result2.constraintsApplied);
    });
  });
});
