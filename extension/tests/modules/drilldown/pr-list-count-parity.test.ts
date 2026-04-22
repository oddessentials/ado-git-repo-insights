/**
 * PR-list count-parity tests (feature 060, FR-008 / FR-021 / SC-002 / SC-011).
 *
 * For every supported filter combination (unfiltered, author-only, repo-only,
 * author+repo) AND both truncation regimes (`_prs_truncated=false`, `true`),
 * assert:
 *
 *   1. `rollup.prs.length` after `applyFiltersToRollups` equals the filter-
 *      predicate's matches — the same predicate that rebuilds the aggregate
 *      `pr_count` against the same input rollup object (FR-021).
 *   2. The truncation-indicator visibility predicate — `rendered_count <
 *      actual_filtered_count` — matches when it should and is hidden when it
 *      shouldn't (FR-008).
 *
 * These are pure-function tests against `applyFiltersToRollups`; no DOM, no
 * rendering. UI rendering is covered by the throughput-drilldown tests.
 */

import { applyFiltersToRollups } from "../../../ui/modules/metrics";
import type { Rollup } from "../../../ui/dataset-loader";
import type { PrRecord } from "../../../ui/schemas/rollup.schema";

const REPO_A = "repo-a";
const REPO_B = "repo-b";
const ALICE = "alice";
const BOB = "bob";

function makePr(
  id: number,
  authorId: string,
  repoId: string,
  cycleMinutes: number,
): PrRecord {
  return {
    id,
    title: `PR ${id}`,
    author_id: authorId,
    repository_id: repoId,
    cycle_time: cycleMinutes,
  };
}

function makeBaseRollup(overrides: Partial<Rollup> = {}): Rollup {
  return {
    week: "2025-W20",
    pr_count: 4,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 2,
    reviewers_count: 1,
    // Aggregates keep the chart-side pr_count consistent with the PR
    // predicate's scope: 2 PRs per repo, 2 per author, 1 per (author,repo).
    by_repository: {
      [REPO_A]: { pr_count: 2 },
      [REPO_B]: { pr_count: 2 },
    },
    by_author: {
      [ALICE]: { pr_count: 2 },
      [BOB]: { pr_count: 2 },
    },
    by_author_and_repo: {
      [ALICE]: {
        [REPO_A]: { pr_count: 1 },
        [REPO_B]: { pr_count: 1 },
      },
      [BOB]: {
        [REPO_A]: { pr_count: 1 },
        [REPO_B]: { pr_count: 1 },
      },
    },
    by_team: null,
    prs: [
      makePr(1, ALICE, REPO_A, 500),
      makePr(2, BOB, REPO_A, 400),
      makePr(3, ALICE, REPO_B, 300),
      makePr(4, BOB, REPO_B, 200),
    ],
    _prs_truncated: false,
    _prs_cap: 500,
    ...overrides,
  };
}

/**
 * Truncated-week fixture: aggregate says 12 total (2 per repo per author +
 * overflow) but `prs` holds only the top-4 by cycle time. This lets us
 * exercise the `rendered < actual` truncation-indicator math.
 */
function makeTruncatedRollup(overrides: Partial<Rollup> = {}): Rollup {
  return makeBaseRollup({
    pr_count: 12,
    by_repository: {
      [REPO_A]: { pr_count: 6 },
      [REPO_B]: { pr_count: 6 },
    },
    by_author: {
      [ALICE]: { pr_count: 6 },
      [BOB]: { pr_count: 6 },
    },
    by_author_and_repo: {
      [ALICE]: {
        [REPO_A]: { pr_count: 3 },
        [REPO_B]: { pr_count: 3 },
      },
      [BOB]: {
        [REPO_A]: { pr_count: 3 },
        [REPO_B]: { pr_count: 3 },
      },
    },
    _prs_truncated: true,
    ...overrides,
  });
}

describe("pr-list count parity (FR-008 / FR-021 / SC-002 / SC-011)", () => {
  describe("non-truncated week — rendered === aggregate pr_count", () => {
    it("unfiltered: all prs pass through, count matches rollup.pr_count", () => {
      const [out] = applyFiltersToRollups([makeBaseRollup()], {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs!.length).toBe(4);
      expect(out!.pr_count).toBe(4);
      // No filter active — indicator hidden.
      expect(out!.prs!.length < out!.pr_count).toBe(false);
    });

    it("author-only: filtered prs match the author_id predicate", () => {
      const [out] = applyFiltersToRollups([makeBaseRollup()], {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [ALICE],
      });
      expect(out!.prs!.map((p) => p.id).sort()).toEqual([1, 3]);
      expect(out!.pr_count).toBe(2);
      expect(out!.prs!.length).toBe(out!.pr_count);
    });

    it("repo-only: filtered prs match the repository_id predicate", () => {
      const [out] = applyFiltersToRollups([makeBaseRollup()], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs!.map((p) => p.id).sort()).toEqual([1, 2]);
      expect(out!.pr_count).toBe(2);
      expect(out!.prs!.length).toBe(out!.pr_count);
    });

    it("author+repo: filtered prs match both predicates", () => {
      const [out] = applyFiltersToRollups([makeBaseRollup()], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [ALICE],
      });
      expect(out!.prs!.map((p) => p.id)).toEqual([1]);
      expect(out!.pr_count).toBe(1);
      expect(out!.prs!.length).toBe(out!.pr_count);
    });

    it("truncation indicator is hidden when rendered === actual", () => {
      const [out] = applyFiltersToRollups([makeBaseRollup()], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [ALICE],
      });
      // rendered=1, actual=1; indicator visibility predicate is false.
      expect(out!.prs!.length < out!.pr_count).toBe(false);
    });
  });

  describe("truncated week — rendered can be < aggregate pr_count", () => {
    it("unfiltered: passes through the truncated top-cap prs plus markers", () => {
      const [out] = applyFiltersToRollups([makeTruncatedRollup()], {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs!.length).toBe(4);
      expect(out!.pr_count).toBe(12);
      expect(out!._prs_truncated).toBe(true);
      // FR-008 predicate: rendered < actual -> indicator visible.
      expect(out!.prs!.length < out!.pr_count).toBe(true);
    });

    it("repo-only: filtered prs is subset-or-equal of aggregate repo pr_count", () => {
      const [out] = applyFiltersToRollups([makeTruncatedRollup()], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      // Aggregate for repo-A is 6 (by_repository); prs holds only 2 that
      // match repo-A (ids 1 and 2 per the fixture).
      expect(out!.prs!.map((p) => p.id).sort()).toEqual([1, 2]);
      expect(out!.pr_count).toBe(6);
      expect(out!.prs!.length <= out!.pr_count).toBe(true);
      expect(out!.prs!.length < out!.pr_count).toBe(true);
    });

    it("author-only: filtered prs is subset-or-equal of aggregate author pr_count", () => {
      const [out] = applyFiltersToRollups([makeTruncatedRollup()], {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [ALICE],
      });
      expect(out!.prs!.map((p) => p.id).sort()).toEqual([1, 3]);
      expect(out!.pr_count).toBe(6);
      expect(out!.prs!.length < out!.pr_count).toBe(true);
    });

    it("author+repo on truncated week: subset semantics hold end-to-end", () => {
      const [out] = applyFiltersToRollups([makeTruncatedRollup()], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [ALICE],
      });
      // Aggregate for ALICE x REPO_A is 3; prs has only id=1.
      expect(out!.prs!.map((p) => p.id)).toEqual([1]);
      expect(out!.pr_count).toBe(3);
      expect(out!.prs!.length < out!.pr_count).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("rollup without prs field passes through unchanged (old-dataset compat)", () => {
      const legacy = makeBaseRollup();
      delete (legacy as { prs?: unknown }).prs;
      delete (legacy as { _prs_truncated?: unknown })._prs_truncated;
      delete (legacy as { _prs_cap?: unknown })._prs_cap;
      const [out] = applyFiltersToRollups([legacy], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs).toBeUndefined();
      expect(out!._prs_truncated).toBeUndefined();
      expect(out!._prs_cap).toBeUndefined();
    });

    it("empty prs array with filter remains empty (no phantom matches)", () => {
      const empty = makeBaseRollup({ prs: [], pr_count: 0 });
      const [out] = applyFiltersToRollups([empty], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Codex-bot P1: malformed prs payloads must degrade gracefully (issue #317
  // PR review). The rollup schema validator is permissive (warns, does not
  // reject), so applyFiltersToRollups MUST also tolerate malformed shapes
  // without crashing the dashboard refresh path.
  // -------------------------------------------------------------------------
  describe("malformed prs degrades gracefully (validator-parity)", () => {
    it("non-array prs is treated as absent under an active filter (no .filter() crash)", () => {
      const broken = makeBaseRollup();
      (broken as { prs: unknown }).prs = "not-an-array";
      // No throw. With a supported filter active, the map callback runs and
      // takes the !Array.isArray early-return; the aggregate-only filtered
      // rollup is returned with the original (malformed) prs preserved.
      const [out] = applyFiltersToRollups([broken], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out).toBeDefined();
      // The pass-through preserves the original (validator-warned) value;
      // the contract is "do not crash", not "rewrite to a canonical shape".
      expect((out as { prs?: unknown }).prs).toBe("not-an-array");
    });

    it("array containing entries with wrong-typed author_id / repository_id skips them", () => {
      const partial = makeBaseRollup({
        prs: [
          {
            id: 50,
            title: "x",
            author_id: 42,
            repository_id: REPO_A,
            cycle_time: 10,
          } as unknown as PrRecord,
          {
            id: 51,
            title: "y",
            author_id: ALICE,
            repository_id: false,
            cycle_time: 10,
          } as unknown as PrRecord,
          makePr(99, ALICE, REPO_A, 50),
        ],
      });
      // Apply a supported filter so the map callback's defensive shape
      // checks run; the no-filter path early-returns rollups unchanged
      // upstream and intentionally never invokes the per-element predicate.
      const [out] = applyFiltersToRollups([partial], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs!.map((p) => p.id)).toEqual([99]);
    });

    it("array containing null entries is also tolerated when a supported filter is active", () => {
      const partial = makeBaseRollup({
        prs: [
          null as unknown as PrRecord,
          makePr(99, ALICE, REPO_A, 50),
          undefined as unknown as PrRecord,
        ],
      });
      const [out] = applyFiltersToRollups([partial], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs!.map((p) => p.id)).toEqual([99]);
    });
  });

  describe("feature 310 comments-metrics fields survive filter pass-through", () => {
    // The three optional fields added by Feature 310 (thread_count,
    // comment_count, active_thread_count) MUST pass through
    // ``applyFiltersToRollups`` untouched so the downstream renderer can
    // attach them to the PrListRow (INV-08 atomic consumer emission).
    // The filter predicate operates on author/repo only; these tests
    // protect the pass-through from accidental field stripping in
    // future refactors.
    function makePrWithComments(
      id: number,
      authorId: string,
      repoId: string,
      cycleMinutes: number,
      triplet: readonly [number | null, number | null, number | null],
    ): PrRecord {
      return {
        ...makePr(id, authorId, repoId, cycleMinutes),
        thread_count: triplet[0],
        comment_count: triplet[1],
        active_thread_count: triplet[2],
      };
    }

    it("unfiltered: the comments-metrics triplet is preserved on every surviving PR", () => {
      const rollup = makeBaseRollup({
        prs: [
          makePrWithComments(1, ALICE, REPO_A, 500, [5, 17, 2]),
          makePrWithComments(2, BOB, REPO_A, 400, [0, 0, 0]),
          makePrWithComments(3, ALICE, REPO_B, 300, [null, null, null]),
          makePrWithComments(4, BOB, REPO_B, 200, [3, 12, 1]),
        ],
      });
      const [out] = applyFiltersToRollups([rollup], {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [],
      });
      expect(out!.prs!.length).toBe(4);
      for (const pr of out!.prs!) {
        expect(pr).toHaveProperty("thread_count");
        expect(pr).toHaveProperty("comment_count");
        expect(pr).toHaveProperty("active_thread_count");
      }
      // rendered vs actual counts unchanged by adding the three fields.
      expect(out!.prs!.length).toBe(out!.pr_count);
    });

    it("author-filtered: surviving PRs retain their comments triplet untouched", () => {
      const rollup = makeBaseRollup({
        prs: [
          makePrWithComments(1, ALICE, REPO_A, 500, [7, 22, 3]),
          makePrWithComments(2, BOB, REPO_A, 400, [0, 0, 0]),
          makePrWithComments(3, ALICE, REPO_B, 300, [null, null, null]),
          makePrWithComments(4, BOB, REPO_B, 200, [1, 1, 1]),
        ],
      });
      const [out] = applyFiltersToRollups([rollup], {
        repos: [],
        teams: [],
        reviewers: [],
        authors: [ALICE],
      });
      const byId = new Map(out!.prs!.map((pr) => [pr.id, pr]));
      expect(byId.get(1)?.thread_count).toBe(7);
      expect(byId.get(1)?.comment_count).toBe(22);
      expect(byId.get(1)?.active_thread_count).toBe(3);
      expect(byId.get(3)?.thread_count).toBeNull();
      expect(byId.get(3)?.comment_count).toBeNull();
      expect(byId.get(3)?.active_thread_count).toBeNull();
    });

    it("capability-off rollup (no triplet fields) passes through without inventing them", () => {
      const rollup = makeBaseRollup();
      // Base fixture uses makePr which emits only the five 060 fields.
      const [out] = applyFiltersToRollups([rollup], {
        repos: [REPO_A],
        teams: [],
        reviewers: [],
        authors: [],
      });
      for (const pr of out!.prs!) {
        expect(pr.thread_count).toBeUndefined();
        expect(pr.comment_count).toBeUndefined();
        expect(pr.active_thread_count).toBeUndefined();
      }
    });
  });
});
