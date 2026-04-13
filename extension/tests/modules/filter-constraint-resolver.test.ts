/**
 * Filter Constraint Resolver Tests
 *
 * Verifies all filter dimension combinations, constraint rules, and
 * the controlled mutation model. The resolver is the SOLE AUTHORITY
 * for filter constraints (FR-010).
 *
 * Rule evaluation order is a tested invariant:
 *   Rule 1: Author ↔ Reviewer (bidirectional, lastChanged)
 *   Rule 2: Author + Team (notice only, teams retained)
 *   Rule 3: Reviewer + Team (clear teams)
 *   Rule 4: Reviewer + Repo (notice only)
 */

import { resolveFilterConstraints } from "../../ui/modules/filter-constraint-resolver";
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
  // ────────────────────────────────────────────────────────────────────
  // No constraints
  // ────────────────────────────────────────────────────────────────────

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

    it("passes through repos+teams without constraint", () => {
      const result = resolveFilterConstraints(
        makeFilters({ repos: ["repo-a"], teams: ["team-x"] }),
      );
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
      expect(result.effectiveState.teams).toEqual(["team-x"]);
      expect(result.constraintsApplied).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Rule 1: Author ↔ Reviewer (bidirectional, lastChanged)
  // ────────────────────────────────────────────────────────────────────

  describe("Rule 1: Author ↔ Reviewer bidirectional", () => {
    it("clears reviewer when lastChanged='authors' (author wins)", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], reviewers: ["rev-1"] }),
        "authors",
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
      expect(result.effectiveState.reviewers).toEqual([]);
      expect(
        result.constraintsApplied.some((n) => n.type === "author_reviewer"),
      ).toBe(true);
    });

    it("clears author when lastChanged='reviewers' (reviewer wins)", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], reviewers: ["rev-1"] }),
        "reviewers",
      );
      expect(result.effectiveState.authors).toEqual([]);
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(
        result.constraintsApplied.some((n) => n.type === "author_reviewer"),
      ).toBe(true);
    });

    it("clears author when lastChanged=undefined (URL restore default)", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], reviewers: ["rev-1"] }),
      );
      expect(result.effectiveState.authors).toEqual([]);
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
    });

    it("clears author when lastChanged='repos' (non-person default)", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], reviewers: ["rev-1"] }),
        "repos",
      );
      expect(result.effectiveState.authors).toEqual([]);
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
    });

    it("clears author when lastChanged='teams' (non-person default)", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], reviewers: ["rev-1"] }),
        "teams",
      );
      expect(result.effectiveState.authors).toEqual([]);
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
    });

    it("preserves repos when author+reviewer constrained", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          repos: ["repo-a"],
        }),
      );
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Rule 2: Author + Team → notice only, teams retained
  // ────────────────────────────────────────────────────────────────────

  describe("Rule 2: Author + Team → notice only (teams retained)", () => {
    it("retains teams in state when author and team both active", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], teams: ["team-x"] }),
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
      expect(result.effectiveState.teams).toEqual(["team-x"]);
      expect(
        result.constraintsApplied.some((n) => n.type === "author_team"),
      ).toBe(true);
    });

    it("retains multiple teams in state with author", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], teams: ["team-x", "team-y"] }),
      );
      expect(result.effectiveState.teams).toEqual(["team-x", "team-y"]);
    });

    it("preserves repos alongside author + team", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          teams: ["team-x"],
          repos: ["repo-a"],
        }),
      );
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
      expect(result.effectiveState.teams).toEqual(["team-x"]);
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Rule 3: Reviewer + Team → clear teams
  // ────────────────────────────────────────────────────────────────────

  describe("Rule 3: Reviewer + Team → clear teams", () => {
    it("clears teams when reviewer and team both active", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"], teams: ["team-x"] }),
      );
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.teams).toEqual([]);
      expect(
        result.constraintsApplied.some((n) => n.type === "reviewer_team"),
      ).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Rule 4: Reviewer + Repo → notice only
  // ────────────────────────────────────────────────────────────────────

  describe("Rule 4: Reviewer + Repo → notice only", () => {
    it("retains both reviewer and repo in state", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"], repos: ["repo-a"] }),
      );
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
      expect(
        result.constraintsApplied.some((n) => n.type === "reviewer_repo"),
      ).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Three-way interactions (exhaustive)
  // ────────────────────────────────────────────────────────────────────

  describe("Three-way: Author + Reviewer + Team", () => {
    it("lastChanged='authors': reviewer cleared, teams retained (Rule 3 does NOT fire)", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
        }),
        "authors",
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
      expect(result.effectiveState.reviewers).toEqual([]); // Rule 1: reviewer cleared
      expect(result.effectiveState.teams).toEqual(["team-x"]); // Rule 2: notice only
      // Rule 3 must NOT fire (reviewer was cleared by Rule 1)
      expect(
        result.constraintsApplied.some((n) => n.type === "reviewer_team"),
      ).toBe(false);
      expect(
        result.constraintsApplied.some((n) => n.type === "author_reviewer"),
      ).toBe(true);
      expect(
        result.constraintsApplied.some((n) => n.type === "author_team"),
      ).toBe(true);
    });

    it("lastChanged='reviewers': author cleared, teams cleared (Rule 3 fires)", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
        }),
        "reviewers",
      );
      expect(result.effectiveState.authors).toEqual([]); // Rule 1: author cleared
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.teams).toEqual([]); // Rule 3: teams cleared
      // Rule 2 must NOT fire (author was cleared by Rule 1)
      expect(
        result.constraintsApplied.some((n) => n.type === "author_team"),
      ).toBe(false);
      expect(
        result.constraintsApplied.some((n) => n.type === "reviewer_team"),
      ).toBe(true);
    });

    it("lastChanged='teams': author cleared (default), teams cleared (Rule 3)", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
        }),
        "teams",
      );
      expect(result.effectiveState.authors).toEqual([]); // Rule 1: default → author cleared
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.teams).toEqual([]); // Rule 3: teams cleared
    });

    it("lastChanged=undefined (URL restore): author cleared, teams cleared", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
        }),
      );
      expect(result.effectiveState.authors).toEqual([]);
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.teams).toEqual([]);
    });
  });

  describe("Three-way: Author + Reviewer + Repo", () => {
    it("lastChanged='authors': reviewer cleared, repo retained", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          repos: ["repo-a"],
        }),
        "authors",
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
      expect(result.effectiveState.reviewers).toEqual([]);
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
      // Rule 4 must NOT fire (reviewer was cleared)
      expect(
        result.constraintsApplied.some((n) => n.type === "reviewer_repo"),
      ).toBe(false);
    });

    it("lastChanged=undefined: author cleared, reviewer+repo both retained with notice", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          repos: ["repo-a"],
        }),
      );
      expect(result.effectiveState.authors).toEqual([]);
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
      expect(
        result.constraintsApplied.some((n) => n.type === "reviewer_repo"),
      ).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Single-select enforcement
  // ────────────────────────────────────────────────────────────────────

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

    it("truncates reviewers to empty when first element is falsy", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["", "rev-2"] }),
      );
      expect(result.effectiveState.reviewers).toEqual([]);
    });

    it("truncates authors to empty when first element is falsy", () => {
      const result = resolveFilterConstraints(
        makeFilters({ authors: ["", "auth-2"] }),
      );
      expect(result.effectiveState.authors).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Controlled mutation model
  // ────────────────────────────────────────────────────────────────────

  describe("Controlled mutation model", () => {
    it("does not modify input state (clone verified)", () => {
      const input = makeFilters({
        authors: ["auth-1"],
        reviewers: ["rev-1"],
        teams: ["team-x"],
      });
      const authorsBefore = [...input.authors];
      const reviewersBefore = [...input.reviewers];
      const teamsBefore = [...input.teams];

      resolveFilterConstraints(input);

      expect(input.authors).toEqual(authorsBefore);
      expect(input.reviewers).toEqual(reviewersBefore);
      expect(input.teams).toEqual(teamsBefore);
    });

    it("produces identical output for identical input (determinism)", () => {
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

  // ────────────────────────────────────────────────────────────────────
  // Evaluation order invariant
  // ────────────────────────────────────────────────────────────────────

  describe("Evaluation order invariant", () => {
    it("Rule 1 output affects Rule 3 input (sequential proof)", () => {
      // With lastChanged='authors': Rule 1 clears reviewer.
      // Rule 3 (reviewer+team) must NOT fire because reviewer is now empty.
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
        }),
        "authors",
      );
      // If rules were parallel (not sequential), Rule 3 would see the
      // original reviewer and clear teams. Sequential execution prevents this.
      expect(result.effectiveState.teams).toEqual(["team-x"]);
      expect(
        result.constraintsApplied.some((n) => n.type === "reviewer_team"),
      ).toBe(false);
    });

    it("constraintsApplied order matches rule execution order", () => {
      // Author+Reviewer+Team with lastChanged=undefined:
      // Rule 1 fires (author cleared), Rule 3 fires (teams cleared)
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
        }),
      );
      const types = result.constraintsApplied.map((n) => n.type);
      const r1idx = types.indexOf("author_reviewer");
      const r3idx = types.indexOf("reviewer_team");
      expect(r1idx).toBeGreaterThanOrEqual(0);
      expect(r3idx).toBeGreaterThanOrEqual(0);
      expect(r1idx).toBeLessThan(r3idx); // Rule 1 before Rule 3
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // UI vs URL parity
  // ────────────────────────────────────────────────────────────────────

  describe("UI vs URL parity", () => {
    it("author+team produces same effectiveState regardless of lastChanged", () => {
      // UI path: user selects author then team
      const uiResult = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], teams: ["team-x"] }),
        "teams",
      );
      // URL path: restore from URL (no lastChanged)
      const urlResult = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], teams: ["team-x"] }),
      );
      expect(uiResult.effectiveState).toEqual(urlResult.effectiveState);
    });

    it("reviewer+team produces same effectiveState regardless of lastChanged", () => {
      const uiResult = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"], teams: ["team-x"] }),
        "teams",
      );
      const urlResult = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"], teams: ["team-x"] }),
      );
      expect(uiResult.effectiveState).toEqual(urlResult.effectiveState);
    });

    it("author+reviewer URL restore matches reviewer-last-changed UI path", () => {
      // URL restore: no lastChanged → reviewer wins (default)
      const urlResult = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], reviewers: ["rev-1"] }),
      );
      // UI: user selects reviewer last
      const uiResult = resolveFilterConstraints(
        makeFilters({ authors: ["auth-1"], reviewers: ["rev-1"] }),
        "reviewers",
      );
      expect(urlResult.effectiveState).toEqual(uiResult.effectiveState);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("lastChanged='authors' with empty authors array does nothing", () => {
      const result = resolveFilterConstraints(
        makeFilters({ reviewers: ["rev-1"] }),
        "authors",
      );
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.constraintsApplied).toHaveLength(0);
    });

    it("all four dimensions active, lastChanged='authors'", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
          repos: ["repo-a"],
        }),
        "authors",
      );
      expect(result.effectiveState.authors).toEqual(["auth-1"]);
      expect(result.effectiveState.reviewers).toEqual([]); // Rule 1
      expect(result.effectiveState.teams).toEqual(["team-x"]); // Rule 2: retained
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
    });

    it("all four dimensions active, lastChanged=undefined", () => {
      const result = resolveFilterConstraints(
        makeFilters({
          authors: ["auth-1"],
          reviewers: ["rev-1"],
          teams: ["team-x"],
          repos: ["repo-a"],
        }),
      );
      expect(result.effectiveState.authors).toEqual([]); // Rule 1: default
      expect(result.effectiveState.reviewers).toEqual(["rev-1"]);
      expect(result.effectiveState.teams).toEqual([]); // Rule 3
      expect(result.effectiveState.repos).toEqual(["repo-a"]);
    });
  });
});
