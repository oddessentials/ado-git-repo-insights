/**
 * Tests for `classifyFilterState` — FR-024 / FR-026 precedence matrix
 * (feature 060). Covers the 8 non-trivial comparison × team × reviewer
 * combinations plus multi-element teams / reviewers and the author+repo
 * supported case. Pure-function tests — no DOM, no fixtures, no mocks.
 */

import {
  classifyFilterState,
  type FilterClassification,
} from "../../../ui/modules/drilldown/filter-support";
import type { FilterState } from "../../../ui/modules/filters";

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    repos: [],
    teams: [],
    reviewers: [],
    authors: [],
    ...overrides,
  };
}

describe("classifyFilterState (FR-024 / FR-026)", () => {
  describe("comparison precedence (highest)", () => {
    it("returns 'comparison' with empty filters and comparisonActive=true", () => {
      const expected: FilterClassification = { classification: "comparison" };
      expect(classifyFilterState(makeFilters(), true)).toEqual(expected);
    });

    it("returns 'comparison' over team when comparisonActive=true", () => {
      expect(classifyFilterState(makeFilters({ teams: ["t1"] }), true)).toEqual(
        { classification: "comparison" },
      );
    });

    it("returns 'comparison' over reviewer when comparisonActive=true", () => {
      expect(
        classifyFilterState(makeFilters({ reviewers: ["r1"] }), true),
      ).toEqual({ classification: "comparison" });
    });

    it("returns 'comparison' over both team and reviewer when comparisonActive=true", () => {
      expect(
        classifyFilterState(
          makeFilters({ teams: ["t1"], reviewers: ["r1"] }),
          true,
        ),
      ).toEqual({ classification: "comparison" });
    });
  });

  describe("team precedence over reviewer (no comparison)", () => {
    it("returns 'team' with team filter only", () => {
      expect(
        classifyFilterState(makeFilters({ teams: ["t1"] }), false),
      ).toEqual({ classification: "team" });
    });

    it("returns 'team' when both team and reviewer filters are active", () => {
      expect(
        classifyFilterState(
          makeFilters({ teams: ["t1"], reviewers: ["r1"] }),
          false,
        ),
      ).toEqual({ classification: "team" });
    });

    it("returns 'team' with multiple teams", () => {
      expect(
        classifyFilterState(makeFilters({ teams: ["t1", "t2"] }), false),
      ).toEqual({ classification: "team" });
    });
  });

  describe("reviewer precedence (no comparison, no team)", () => {
    it("returns 'reviewer' with reviewer filter only", () => {
      expect(
        classifyFilterState(makeFilters({ reviewers: ["r1"] }), false),
      ).toEqual({ classification: "reviewer" });
    });

    it("returns 'reviewer' with multiple reviewers", () => {
      expect(
        classifyFilterState(makeFilters({ reviewers: ["r1", "r2"] }), false),
      ).toEqual({ classification: "reviewer" });
    });
  });

  describe("supported (no comparison, no team, no reviewer)", () => {
    it("returns 'supported' with empty filters and comparisonActive=false", () => {
      expect(classifyFilterState(makeFilters(), false)).toEqual({
        classification: "supported",
      });
    });

    it("returns 'supported' with only author and repo filters active", () => {
      expect(
        classifyFilterState(
          makeFilters({ authors: ["a1"], repos: ["repo-1"] }),
          false,
        ),
      ).toEqual({ classification: "supported" });
    });
  });
});
