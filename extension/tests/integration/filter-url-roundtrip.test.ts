/**
 * Filter URL Serialization Round-Trip Tests
 *
 * Verifies FR-009: serialize -> deserialize -> serialize produces identical output.
 * Canonical format: comma delimiter, encodeURIComponent, sorted multi-select, empty = delete.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import path from "path";
import {
  parseFiltersFromUrl,
  serializeFiltersToUrl,
  type FilterState,
} from "../../ui/modules/filters";

function roundTrip(state: FilterState): FilterState {
  const params = new URLSearchParams();
  serializeFiltersToUrl(state, params);
  return parseFiltersFromUrl(params);
}

function serializeToString(state: FilterState): string {
  const params = new URLSearchParams();
  serializeFiltersToUrl(state, params);
  return params.toString();
}

describe("Filter URL Serialization Round-Trip", () => {
  describe("Empty state", () => {
    it("empty filters produce empty URL params", () => {
      const state: FilterState = {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [],
      };
      const params = new URLSearchParams();
      serializeFiltersToUrl(state, params);
      expect(params.toString()).toBe("");
    });

    it("round-trips empty state", () => {
      const state: FilterState = {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [],
      };
      expect(roundTrip(state)).toEqual(state);
    });
  });

  describe("Single-select dimensions", () => {
    it("round-trips single reviewer", () => {
      const state: FilterState = {
        repos: [],
        teams: [],
        reviewers: ["reviewer-123"],
        authors: [],
      };
      expect(roundTrip(state)).toEqual(state);
    });

    it("round-trips single author", () => {
      const state: FilterState = {
        repos: [],
        teams: [],
        reviewers: [],
        authors: ["john.doe"],
      };
      expect(roundTrip(state)).toEqual(state);
    });
  });

  describe("Multi-select dimensions", () => {
    it("round-trips multiple repos", () => {
      const state: FilterState = {
        repos: ["backend-api", "frontend-app"],
        teams: [],
        reviewers: [],
        authors: [],
      };
      const result = roundTrip(state);
      // Values may be reordered (sorted), but set equality holds
      expect(result.repos.sort()).toEqual(state.repos.sort());
    });

    it("serializes repos in sorted order", () => {
      const state: FilterState = {
        repos: ["zebra", "alpha", "middle"],
        teams: [],
        reviewers: [],
        authors: [],
      };
      const serialized = serializeToString(state);
      expect(serialized).toContain("repos=alpha");
      // Verify order: alpha before middle before zebra
      const reposValue = new URLSearchParams(serialized).get("repos") ?? "";
      const parts = reposValue.split(",");
      expect(parts).toEqual(["alpha", "middle", "zebra"]);
    });
  });

  describe("URI encoding", () => {
    it("handles values with spaces via URLSearchParams built-in encoding", () => {
      const state: FilterState = {
        repos: ["Project With Spaces"],
        teams: [],
        reviewers: [],
        authors: [],
      };
      const params = new URLSearchParams();
      serializeFiltersToUrl(state, params);

      // URLSearchParams.get() returns decoded value
      const raw = params.get("repos") ?? "";
      expect(raw).toBe("Project With Spaces");

      // URL string contains encoded form (+ or %20)
      const urlStr = params.toString();
      expect(urlStr).toMatch(/Project[+%].*Spaces/);

      // Round-trip preserves the original value
      const restored = parseFiltersFromUrl(params);
      expect(restored.repos).toEqual(["Project With Spaces"]);
    });

    it("round-trips values with special characters", () => {
      const state: FilterState = {
        repos: ["foo&bar", "alpha/beta"],
        teams: [],
        reviewers: [],
        authors: [],
      };
      const result = roundTrip(state);
      expect(result.repos.sort()).toEqual(["alpha/beta", "foo&bar"]);
    });
  });

  describe("Idempotency", () => {
    it("serialize(deserialize(serialize(state))) === serialize(state)", () => {
      const state: FilterState = {
        repos: ["repo-b", "repo-a"],
        teams: ["team-1"],
        reviewers: ["rev-1"],
        authors: ["author-x"],
      };

      const first = serializeToString(state);
      const deserialized = parseFiltersFromUrl(new URLSearchParams(first));
      const second = serializeToString(deserialized);

      expect(second).toBe(first);
    });
  });

  describe("Backward compatibility", () => {
    it("deserializes unsorted repos from legacy URLs", () => {
      const params = new URLSearchParams("repos=zebra,alpha");
      const state = parseFiltersFromUrl(params);
      expect(state.repos.sort()).toEqual(["alpha", "zebra"]);
    });

    it("strips empty values", () => {
      const params = new URLSearchParams("repos=a,,b,");
      const state = parseFiltersFromUrl(params);
      expect(state.repos).toEqual(["a", "b"]);
    });

    it("strips whitespace-only values", () => {
      const params = new URLSearchParams("repos=a, ,b");
      const state = parseFiltersFromUrl(params);
      expect(state.repos.sort()).toEqual(["a", "b"]);
    });

    it("handles missing params gracefully", () => {
      const params = new URLSearchParams("");
      const state = parseFiltersFromUrl(params);
      expect(state).toEqual({
        repos: [],
        teams: [],
        reviewers: [],
        authors: [],
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Bug 3: Canonical sort order enforcement
  // ────────────────────────────────────────────────────────────────────

  describe("Canonical sort order (Bug 3)", () => {
    it("sorts repos lexicographically in serialized URL", () => {
      const state: FilterState = {
        repos: ["Z-Repo", "A-Repo", "M-Repo"],
        teams: [],
        reviewers: [],
        authors: [],
      };
      const params = new URLSearchParams();
      serializeFiltersToUrl(state, params);
      const reposValue = params.get("repos") ?? "";
      expect(reposValue).toBe("A-Repo,M-Repo,Z-Repo");
    });

    it("sorts teams lexicographically in serialized URL", () => {
      const state: FilterState = {
        repos: [],
        teams: ["zebra-team", "alpha-team"],
        reviewers: [],
        authors: [],
      };
      const params = new URLSearchParams();
      serializeFiltersToUrl(state, params);
      const teamsValue = params.get("teams") ?? "";
      expect(teamsValue).toBe("alpha-team,zebra-team");
    });

    it("produces identical URL regardless of selection order", () => {
      const orderA: FilterState = {
        repos: ["Z-Repo", "A-Repo", "M-Repo"],
        teams: ["beta", "alpha"],
        reviewers: [],
        authors: [],
      };
      const orderB: FilterState = {
        repos: ["A-Repo", "M-Repo", "Z-Repo"],
        teams: ["alpha", "beta"],
        reviewers: [],
        authors: [],
      };

      const paramsA = new URLSearchParams();
      serializeFiltersToUrl(orderA, paramsA);
      const paramsB = new URLSearchParams();
      serializeFiltersToUrl(orderB, paramsB);

      expect(paramsA.toString()).toBe(paramsB.toString());
    });

    it("deletes filter params when empty (not repos=)", () => {
      const params = new URLSearchParams();
      params.set("repos", "old-value");
      params.set("teams", "old-team");

      const emptyState: FilterState = {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [],
      };
      serializeFiltersToUrl(emptyState, params);

      expect(params.has("repos")).toBe(false);
      expect(params.has("teams")).toBe(false);
    });

    it("dashboard.ts must not contain inline filter serialization", () => {
      // Grep-based guard: no .set("repos", or .set("teams", in dashboard.ts
      // outside of comments. This prevents reintroduction of inline serialization.
      const dashboardPath = path.resolve(__dirname, "../../ui/dashboard.ts");
      const content = _fs.readFileSync(dashboardPath, "utf-8");

      // Remove comments before scanning
      const noComments = content
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      // These patterns indicate inline filter serialization bypassing serializeFiltersToUrl
      const inlineReposWrite = /newParams\.set\(\s*["']repos["']\s*,/;
      const inlineTeamsWrite = /newParams\.set\(\s*["']teams["']\s*,/;

      expect(noComments).not.toMatch(inlineReposWrite);
      expect(noComments).not.toMatch(inlineTeamsWrite);
    });
  });
});
