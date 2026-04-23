/**
 * PR-record comments-metrics field validator (Feature 310).
 *
 * Covers the permissive warning paths added to validatePrRecordArray for the
 * three comments-metrics fields: thread_count / comment_count /
 * active_thread_count.  All violations surface as warnings with path +
 * message; the validator NEVER rejects a PR element (load path stays
 * permissive per FR-3-06 / INV-01).
 *
 * Runtime enforcement of the same invariants on production builds is in
 * tests/unit/test_aggregators_pr_records_comments.py (producer) — the tests
 * below are the consumer-side parity (INV-07) surface.
 *
 * Authoritative shape: specs/310-comments-visualization/contracts/pr-record-comments-fields.md §1.
 *
 * @module tests/schema/pr-record-comments-fields.test.ts
 */

import { validateRollup } from "../../ui/schemas/rollup.schema";

const BASE_ROLLUP = {
  week: "2025-W20",
  start_date: "2025-05-12",
  end_date: "2025-05-18",
  pr_count: 1,
};

const BASE_PR = {
  id: 1,
  title: "feat: landed",
  author_id: "alice",
  repository_id: "web-app",
  cycle_time: 120.0,
};

function prWarnings(
  result: ReturnType<typeof validateRollup>,
): ReturnType<typeof validateRollup>["warnings"] {
  return result.warnings.filter((w) => w.field.startsWith("prs"));
}

describe("PrRecord comments-metrics validator (feature 310)", () => {
  describe("valid shapes — no comments-metrics warnings", () => {
    it("capability-off shape (three fields absent) passes without warnings", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [BASE_PR],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(prWarnings(result)).toEqual([]);
    });

    it("capability-on shape with all three numeric passes without warnings", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 5,
              comment_count: 17,
              active_thread_count: 2,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(prWarnings(result)).toEqual([]);
    });

    it("capability-on shape with coverage-partial triplet (all three null) passes without warnings", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: null,
              comment_count: null,
              active_thread_count: null,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(prWarnings(result)).toEqual([]);
    });

    it("capability-on shape with all-zero triplet (explicit zeros) passes without warnings", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 0,
              comment_count: 0,
              active_thread_count: 0,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(prWarnings(result)).toEqual([]);
    });

    it("active_thread_count == thread_count (boundary equal) passes without warnings (INV-09 is <=, not <)", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 3,
              comment_count: 8,
              active_thread_count: 3,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(prWarnings(result)).toEqual([]);
    });
  });

  describe("per-field type checks (warn, not error)", () => {
    it("warns when thread_count is a string", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: "five",
              comment_count: 17,
              active_thread_count: 2,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) =>
        w.field.endsWith("thread_count"),
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("number or null");
      expect(warning!.message).toContain("string");
    });

    it("warns when comment_count is a boolean", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 5,
              comment_count: true,
              active_thread_count: 2,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) =>
        w.field.endsWith("comment_count"),
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("number or null");
      expect(warning!.message).toContain("boolean");
    });

    it("warns when active_thread_count is an object", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 5,
              comment_count: 17,
              active_thread_count: { value: 2 },
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) =>
        w.field.endsWith("active_thread_count"),
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("number or null");
    });
  });

  describe("INV-08 atomicity — all three present or all absent", () => {
    it("warns when only thread_count is present (1 of 3)", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [{ ...BASE_PR, thread_count: 5 }],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) => w.message.includes("INV-08"));
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("1 of 3 present");
    });

    it("warns when only thread_count and comment_count are present (2 of 3)", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [{ ...BASE_PR, thread_count: 5, comment_count: 17 }],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) => w.message.includes("INV-08"));
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("2 of 3 present");
    });
  });

  describe("INV-10 coverage-partial consistency — all null or all numeric within the triplet", () => {
    it("warns when triplet is mixed (2 numeric, 1 null)", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 5,
              comment_count: null,
              active_thread_count: 2,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) => w.message.includes("INV-10"));
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("1 of 3 null");
    });

    it("warns when triplet is mixed (1 numeric, 2 null)", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: null,
              comment_count: 17,
              active_thread_count: null,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) => w.message.includes("INV-10"));
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("2 of 3 null");
    });
  });

  describe("INV-09 ordering — active_thread_count <= thread_count when both numeric", () => {
    it("warns when active_thread_count exceeds thread_count", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 3,
              comment_count: 8,
              active_thread_count: 5,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((w) => w.message.includes("INV-09"));
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("MUST NOT exceed");
      expect(warning!.message).toContain("(5)");
      expect(warning!.message).toContain("(3)");
    });

    it("does not warn when active_thread_count equals thread_count (boundary)", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: 3,
              comment_count: 8,
              active_thread_count: 3,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("INV-09"))).toBe(
        false,
      );
    });
  });

  describe("permissive contract — violations NEVER fail the load", () => {
    it("type-bad, atomicity-bad, ordering-bad record still validates with result.valid = true", () => {
      const result = validateRollup(
        {
          ...BASE_ROLLUP,
          prs: [
            {
              ...BASE_PR,
              thread_count: "bogus",
              // comment_count intentionally missing
              active_thread_count: 99,
            },
          ],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      // Warnings fire, but load never errors on comments-metrics violations.
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
