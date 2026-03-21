/**
 * Unit tests for filters module.
 *
 * Pure function tests - no JSDOM required.
 */

import {
  createEmptyFilterState,
  hasActiveFilters,
  parseFiltersFromUrl,
  serializeFiltersToUrl,
  createFilterChipHtml,
  renderFilterChipsHtml,
  type FilterState,
} from "../../ui/modules/filters";

describe("filters module", () => {
  describe("createEmptyFilterState", () => {
    it("returns empty arrays", () => {
      const state = createEmptyFilterState();
      expect(state).toEqual({ repos: [], teams: [], reviewers: [] });
    });
  });

  describe("hasActiveFilters", () => {
    it("returns false for empty state", () => {
      expect(hasActiveFilters({ repos: [], teams: [], reviewers: [] })).toBe(false);
    });

    it("returns true when repos has values", () => {
      expect(
        hasActiveFilters({ repos: ["repo-a"], teams: [], reviewers: [] }),
      ).toBe(true);
    });

    it("returns true when teams has values", () => {
      expect(
        hasActiveFilters({ repos: [], teams: ["team-x"], reviewers: [] }),
      ).toBe(true);
    });

    it("returns true when reviewers has values", () => {
      expect(
        hasActiveFilters({ repos: [], teams: [], reviewers: ["reviewer-1"] }),
      ).toBe(true);
    });

    it("returns true when both have values", () => {
      expect(
        hasActiveFilters({
          repos: ["repo-a"],
          teams: ["team-x"],
          reviewers: [],
        }),
      ).toBe(true);
    });
  });

  describe("parseFiltersFromUrl", () => {
    it("returns empty state for no params", () => {
      const params = new URLSearchParams("");
      const result = parseFiltersFromUrl(params);
      expect(result).toEqual({ repos: [], teams: [], reviewers: [] });
    });

    it("parses repos param", () => {
      const params = new URLSearchParams("repos=repo-a,repo-b");
      const result = parseFiltersFromUrl(params);
      expect(result.repos).toEqual(["repo-a", "repo-b"]);
    });

    it("parses teams param", () => {
      const params = new URLSearchParams("teams=team-x,team-y");
      const result = parseFiltersFromUrl(params);
      expect(result.teams).toEqual(["team-x", "team-y"]);
    });

    it("filters empty values", () => {
      const params = new URLSearchParams("repos=repo-a,,repo-b");
      const result = parseFiltersFromUrl(params);
      expect(result.repos).toEqual(["repo-a", "repo-b"]);
    });

    it("parses reviewers param", () => {
      const params = new URLSearchParams("reviewers=user-1,user-2");
      const result = parseFiltersFromUrl(params);
      expect(result.reviewers).toEqual(["user-1", "user-2"]);
    });
  });

  describe("serializeFiltersToUrl", () => {
    it("sets repos and teams params", () => {
      const params = new URLSearchParams();
      const state: FilterState = {
        repos: ["repo-a", "repo-b"],
        teams: ["team-x"],
        reviewers: ["reviewer-1"],
      };

      serializeFiltersToUrl(state, params);

      expect(params.get("repos")).toBe("repo-a,repo-b");
      expect(params.get("teams")).toBe("team-x");
      expect(params.get("reviewers")).toBe("reviewer-1");
    });

    it("deletes empty params", () => {
      const params = new URLSearchParams("repos=old&teams=old");
      const state: FilterState = { repos: [], teams: [], reviewers: [] };

      serializeFiltersToUrl(state, params);

      expect(params.has("repos")).toBe(false);
      expect(params.has("teams")).toBe(false);
      expect(params.has("reviewers")).toBe(false);
    });
  });

  describe("createFilterChipHtml", () => {
    it("creates repo chip with escaped content", () => {
      const html = createFilterChipHtml("repo", "my-repo", "My Repository");

      expect(html).toContain("repo: My Repository");
      expect(html).toContain('data-type="repo"');
      expect(html).toContain('data-value="my-repo"');
      expect(html).toContain("filter-chip-remove");
    });

    it("creates team chip", () => {
      const html = createFilterChipHtml("team", "team-1", "Team One");

      expect(html).toContain("team: Team One");
      expect(html).toContain('data-type="team"');
    });

    it("creates reviewer chip", () => {
      const html = createFilterChipHtml("reviewer", "user-1", "User One");

      expect(html).toContain("reviewer: User One");
      expect(html).toContain('data-type="reviewer"');
    });

    it("escapes HTML in label", () => {
      const html = createFilterChipHtml(
        "repo",
        "test",
        "<script>alert(1)</script>",
      );

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("renderFilterChipsHtml", () => {
    it("returns empty string for empty state", () => {
      const result = renderFilterChipsHtml(
        { repos: [], teams: [], reviewers: [] },
        () => "",
      );
      expect(result).toBe("");
    });

    it("renders chips for all filters", () => {
      const state: FilterState = {
        repos: ["repo-a"],
        teams: ["team-x"],
        reviewers: ["user-1"],
      };
      const labelFn = (type: "repo" | "team" | "reviewer", value: string) =>
        type === "repo"
          ? `Repo: ${value}`
          : type === "team"
            ? `Team: ${value}`
            : `Reviewer: ${value}`;

      const result = renderFilterChipsHtml(state, labelFn);

      expect(result).toContain("repo-a");
      expect(result).toContain("team-x");
      expect(result).toContain("user-1");
    });
  });
});
