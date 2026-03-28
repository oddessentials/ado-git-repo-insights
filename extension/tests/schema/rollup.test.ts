/**
 * Rollup Schema Tests
 *
 * Tests for weekly rollup JSON schema validation.
 * Rollup uses PERMISSIVE mode - unknown fields cause warnings, not errors.
 *
 * @module tests/schema/rollup.test.ts
 */

import {
  validateRollup,
  normalizeRollup,
} from "../../ui/schemas/rollup.schema";
import type { ValidationResult } from "../../ui/schemas/types";

// Load the actual fixture for valid data tests
import validRollup from "../fixtures/aggregates/weekly_rollups/2026-W02.json";

describe("Rollup Schema Validator", () => {
  describe("valid data", () => {
    it("should pass validation for the fixture file", () => {
      const result: ValidationResult = validateRollup(validRollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation with minimal required fields", () => {
      const minimal = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
      };
      const result = validateRollup(minimal, false);
      expect(result.valid).toBe(true);
    });

    it("should pass with optional breakdown fields", () => {
      const withBreakdowns = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
        cycle_time_p50: 240.5,
        cycle_time_p90: 720.0,
        review_time_p50: 60.0,
        review_time_p90: 180.0,
        authors_count: 5,
        reviewers_count: 8,
        by_repository: {},
        by_team: {},
      };
      const result = validateRollup(withBreakdowns, false);
      expect(result.valid).toBe(true);
    });
  });

  describe("missing required fields", () => {
    it("should fail when week is missing", () => {
      const invalid = { ...validRollup };
      delete (invalid as Record<string, unknown>).week;
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.field).toContain("week");
    });

    it("should pass when start_date is missing (optional for legacy datasets)", () => {
      const valid = { ...validRollup };
      delete (valid as Record<string, unknown>).start_date;
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should pass when end_date is missing (optional for legacy datasets)", () => {
      const valid = { ...validRollup };
      delete (valid as Record<string, unknown>).end_date;
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should fail when pr_count is missing", () => {
      const invalid = { ...validRollup };
      delete (invalid as Record<string, unknown>).pr_count;
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("pr_count"))).toBe(
        true,
      );
    });
  });

  describe("invalid types", () => {
    it("should fail when week is not a string", () => {
      const invalid = { ...validRollup, week: 202602 };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when pr_count is not a number", () => {
      const invalid = { ...validRollup, pr_count: "30" };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when cycle_time_p50 is not a number", () => {
      const invalid = { ...validRollup, cycle_time_p50: "240.5" };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
    });
  });

  describe("invalid week format", () => {
    it("should fail when week is not ISO week format (YYYY-Www)", () => {
      const invalid = { ...validRollup, week: "2026-02" };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("week"))).toBe(true);
    });

    it("should fail when week uses wrong separator", () => {
      const invalid = { ...validRollup, week: "2026W02" };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when week has lowercase w", () => {
      const invalid = { ...validRollup, week: "2026-w02" };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
    });
  });

  describe("invalid date formats", () => {
    it("should fail when start_date is not ISO date format", () => {
      const invalid = { ...validRollup, start_date: "01-06-2026" };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("start_date"))).toBe(
        true,
      );
    });

    it("should fail when end_date is not ISO date format", () => {
      const invalid = { ...validRollup, end_date: "January 12, 2026" };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
    });
  });

  describe("permissive mode (unknown fields)", () => {
    it("should PASS with warning in permissive mode when unknown fields present", () => {
      const withUnknown = {
        ...validRollup,
        unknown_field: "should warn only",
        extra_data: { foo: "bar" },
      };
      const result = validateRollup(withUnknown, false);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((w) => w.field.includes("unknown_field")),
      ).toBe(true);
    });

    it("should FAIL in strict mode when unknown fields present", () => {
      const withUnknown = {
        ...validRollup,
        unknown_field: "should fail",
      };
      const result = validateRollup(withUnknown, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("unknown_field"))).toBe(
        true,
      );
    });
  });

  describe("nested object validation", () => {
    it("should pass when by_repository has valid structure", () => {
      const valid = {
        ...validRollup,
        by_repository: {
          "repo-1": { pr_count: 10, cycle_time_p50: 100 },
          "repo-2": { pr_count: 5 },
        },
      };
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should pass when by_team has valid structure", () => {
      const valid = {
        ...validRollup,
        by_team: {
          "Team A": { pr_count: 15, cycle_time_p50: 200 },
        },
      };
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should pass when by_author has valid structure", () => {
      const valid = {
        ...validRollup,
        by_author: {
          "user-1": {
            pr_count: 12,
            cycle_time_p50: 180,
            cycle_time_p90: 420,
            authors_count: 1,
            reviewers_count: 4,
          },
        },
      };
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should pass when by_author_and_repo has valid nested structure", () => {
      const valid = {
        ...validRollup,
        by_author_and_repo: {
          "user-1": {
            "repo-a": {
              pr_count: 7,
              cycle_time_p50: 160,
              cycle_time_p90: 390,
              authors_count: 1,
              reviewers_count: 3,
            },
          },
          _truncated: true,
        },
      };
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should fail when by_repository is not an object", () => {
      const invalid = {
        ...validRollup,
        by_repository: "not-an-object",
      };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "by_repository")).toBe(true);
    });

    it("should pass when by_reviewer has valid structure", () => {
      const valid = {
        ...validRollup,
        by_reviewer: {
          reviewer1: {
            reviewed_prs: 12,
            reviews_count: 14,
            approval_rate: 0.75,
            authors_count: 6,
            repositories_count: 3,
          },
        },
      };
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should fail when by_reviewer approval_rate is outside [0, 1]", () => {
      const invalid = {
        ...validRollup,
        by_reviewer: {
          reviewer1: {
            reviewed_prs: 12,
            reviews_count: 14,
            approval_rate: 1.5,
          },
        },
      };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("approval_rate"))).toBe(
        true,
      );
    });

    it("should pass when by_reviewer approval_rate is null", () => {
      const valid = {
        ...validRollup,
        by_reviewer: {
          reviewer1: {
            reviewed_prs: 12,
            reviews_count: 14,
            approval_rate: null,
            authors_count: 6,
            repositories_count: 3,
          },
        },
      };
      const result = validateRollup(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should fail when by_reviewer is not an object", () => {
      const invalid = {
        ...validRollup,
        by_reviewer: "not-an-object",
      };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "by_reviewer")).toBe(true);
    });

    it("should fail when by_reviewer entry is not an object", () => {
      const invalid = {
        ...validRollup,
        by_reviewer: {
          reviewer1: "not-an-object",
        },
      };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("by_reviewer.reviewer1")),
      ).toBe(true);
    });

    it("should fail when by_reviewer approval_rate is not numeric", () => {
      const invalid = {
        ...validRollup,
        by_reviewer: {
          reviewer1: {
            reviewed_prs: 12,
            reviews_count: 14,
            approval_rate: "high",
          },
        },
      };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("approval_rate"))).toBe(
        true,
      );
    });

    it("should fail when by_reviewer counts are negative", () => {
      const invalid = {
        ...validRollup,
        by_reviewer: {
          reviewer1: {
            reviewed_prs: -1,
            reviews_count: -2,
            authors_count: -3,
            repositories_count: -4,
          },
        },
      };
      const result = validateRollup(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("reviewed_prs"))).toBe(
        true,
      );
      expect(result.errors.some((e) => e.field.includes("reviews_count"))).toBe(
        true,
      );
      expect(result.errors.some((e) => e.field.includes("authors_count"))).toBe(
        true,
      );
      expect(
        result.errors.some((e) => e.field.includes("repositories_count")),
      ).toBe(true);
    });
  });

  describe("empty JSON handling", () => {
    it("should fail with missing required field error for empty object", () => {
      const result = validateRollup({}, false);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.message).toContain("required");
    });

    it("should fail for null input", () => {
      const result = validateRollup(null, false);
      expect(result.valid).toBe(false);
    });
  });

  describe("v2 rollup with by_team_and_repo (T015)", () => {
    const v2Rollup = {
      week: "2026-W02",
      start_date: "2026-01-06",
      end_date: "2026-01-12",
      pr_count: 30,
      cycle_time_p50: 240.5,
      cycle_time_p90: 720.0,
      authors_count: 8,
      reviewers_count: 12,
      by_repository: {
        "main-repo": { pr_count: 22, cycle_time_p50: 200.0 },
        "secondary-repo": { pr_count: 8, cycle_time_p50: 360.0 },
      },
      by_team: {
        "Backend Team": { pr_count: 18, cycle_time_p50: 180.0 },
        "Frontend Team": { pr_count: 12, cycle_time_p50: 300.0 },
      },
      by_team_and_repo: {
        "Backend Team": {
          "main-repo": {
            pr_count: 15,
            cycle_time_p50: 170.0,
            cycle_time_p90: 400.0,
            authors_count: 3,
            reviewers_count: 5,
          },
          "secondary-repo": {
            pr_count: 3,
            // cycle_time_p50/p90 omitted: < 5 PRs, min sample size (FR-019)
            authors_count: 2,
            reviewers_count: 2,
          },
        },
        "Frontend Team": {
          "main-repo": {
            pr_count: 7,
            cycle_time_p50: 280.0,
            cycle_time_p90: 600.0,
            authors_count: 4,
            reviewers_count: 6,
          },
          "secondary-repo": {
            pr_count: 5,
            cycle_time_p50: 320.0,
            cycle_time_p90: 500.0,
            authors_count: 3,
            reviewers_count: 4,
          },
        },
      },
    };

    it("should validate v2 rollup with by_team_and_repo successfully", () => {
      const result = validateRollup(v2Rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate v2 rollup with empty by_team_and_repo", () => {
      const rollupWithEmpty = { ...v2Rollup, by_team_and_repo: {} };
      const result = validateRollup(rollupWithEmpty, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when by_team_and_repo is not an object", () => {
      const malformed = {
        ...v2Rollup,
        by_team_and_repo: "not-an-object",
      };
      const result = validateRollup(malformed, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "by_team_and_repo")).toBe(
        true,
      );
    });

    it("should catch malformed outer value in by_team_and_repo (not an object)", () => {
      const malformed = {
        ...v2Rollup,
        by_team_and_repo: {
          "Backend Team": "not-an-object",
        },
      };
      const result = validateRollup(malformed, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_team_and_repo") &&
            e.field.includes("Backend Team"),
        ),
      ).toBe(true);
    });

    it("should catch malformed inner entry in by_team_and_repo (not an object)", () => {
      const malformed = {
        ...v2Rollup,
        by_team_and_repo: {
          "Backend Team": {
            "main-repo": "not-an-object",
          },
        },
      };
      const result = validateRollup(malformed, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_team_and_repo") &&
            e.field.includes("main-repo"),
        ),
      ).toBe(true);
    });

    it("should catch invalid pr_count type in nested breakdown entry", () => {
      const malformed = {
        ...v2Rollup,
        by_team_and_repo: {
          "Backend Team": {
            "main-repo": { pr_count: "fifteen" },
          },
        },
      };
      const result = validateRollup(malformed, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("pr_count"))).toBe(
        true,
      );
    });

    it("should produce warnings for unknown fields in nested breakdown (permissive mode)", () => {
      const withUnknown = {
        ...v2Rollup,
        by_team_and_repo: {
          "Backend Team": {
            "main-repo": {
              pr_count: 15,
              cycle_time_p50: 170.0,
              unknown_nested_field: "should warn",
            },
          },
        },
      };
      const result = validateRollup(withUnknown, false);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((w) => w.field.includes("unknown_nested_field")),
      ).toBe(true);
    });

    it("should FAIL in strict mode for unknown fields in nested breakdown", () => {
      const withUnknown = {
        ...v2Rollup,
        by_team_and_repo: {
          "Backend Team": {
            "main-repo": {
              pr_count: 15,
              unknown_strict_field: true,
            },
          },
        },
      };
      const result = validateRollup(withUnknown, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("unknown_strict_field")),
      ).toBe(true);
    });

    it("should validate v2 rollup with _truncated metadata key (F1 regression)", () => {
      const truncatedRollup = {
        ...v2Rollup,
        by_team_and_repo: {
          ...v2Rollup.by_team_and_repo,
          _truncated: true,
        },
      };
      const result = validateRollup(truncatedRollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("normalizeRollup preserves by_team_and_repo (T015 gated test)", () => {
    it("GATED: normalizeRollup must preserve by_team_and_repo field in output", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 30,
        by_team_and_repo: {
          "Backend Team": {
            "main-repo": {
              pr_count: 15,
              cycle_time_p50: 170.0,
              cycle_time_p90: 400.0,
              authors_count: 3,
              reviewers_count: 5,
            },
          },
          "Frontend Team": {
            "secondary-repo": {
              pr_count: 5,
              cycle_time_p50: 320.0,
              cycle_time_p90: 500.0,
              authors_count: 3,
              reviewers_count: 4,
            },
          },
        },
      };

      const normalized = normalizeRollup(input);

      expect(normalized.by_team_and_repo).toBeDefined();
      expect(normalized.by_team_and_repo).not.toBeUndefined();
      expect(normalized.by_team_and_repo!["Backend Team"]).toBeDefined();
      expect(
        normalized.by_team_and_repo!["Backend Team"]!["main-repo"]!.pr_count,
      ).toBe(15);
      expect(
        normalized.by_team_and_repo!["Frontend Team"]!["secondary-repo"]!
          .pr_count,
      ).toBe(5);
    });

    it("normalizeRollup must not include by_team_and_repo when absent from input", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
      };

      const normalized = normalizeRollup(input);

      expect(normalized.by_team_and_repo).toBeUndefined();
      expect("by_team_and_repo" in normalized).toBe(false);
    });

    it("normalizeRollup preserves all standard fields alongside by_team_and_repo", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 30,
        cycle_time_p50: 240.5,
        authors_count: 8,
        by_repository: { "main-repo": { pr_count: 22 } },
        by_team: { "Backend Team": { pr_count: 18 } },
        by_team_and_repo: {
          "Backend Team": {
            "main-repo": { pr_count: 15 },
          },
        },
      };

      const normalized = normalizeRollup(input);

      expect(normalized.week).toBe("2026-W02");
      expect(normalized.pr_count).toBe(30);
      expect(normalized.cycle_time_p50).toBe(240.5);
      expect(normalized.authors_count).toBe(8);
      expect(normalized.by_repository).toEqual({
        "main-repo": { pr_count: 22 },
      });
      expect(normalized.by_team).toEqual({
        "Backend Team": { pr_count: 18 },
      });
      expect(normalized.by_team_and_repo).toEqual({
        "Backend Team": {
          "main-repo": { pr_count: 15 },
        },
      });
    });

    it("normalizeRollup preserves by_reviewer when present", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
        by_reviewer: {
          reviewer1: {
            reviewed_prs: 4,
            reviews_count: 5,
            approval_rate: 0.5,
          },
        },
      };

      const normalized = normalizeRollup(input);

      expect(normalized.by_reviewer).toEqual({
        reviewer1: {
          reviewed_prs: 4,
          reviews_count: 5,
          approval_rate: 0.5,
        },
      });
    });

    it("normalizeRollup preserves by_author and by_author_and_repo when present", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
        by_author: {
          "user-1": {
            pr_count: 6,
            authors_count: 1,
            reviewers_count: 3,
          },
        },
        by_author_and_repo: {
          "user-1": {
            "repo-a": {
              pr_count: 4,
              authors_count: 1,
              reviewers_count: 2,
            },
          },
        },
      };

      const normalized = normalizeRollup(input);

      expect(normalized.by_author).toEqual(input.by_author);
      expect(normalized.by_author_and_repo).toEqual(input.by_author_and_repo);
    });

    it("normalizes null cycle_time to null (not 0)", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 5,
        cycle_time_p50: null,
        cycle_time_p90: null,
      };

      const normalized = normalizeRollup(input);

      expect(normalized.cycle_time_p50).toBeNull();
      expect(normalized.cycle_time_p90).toBeNull();
    });

    it("normalizes missing cycle_time to null default", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 5,
      };

      const normalized = normalizeRollup(input);

      expect(normalized.cycle_time_p50).toBeNull();
      expect(normalized.cycle_time_p90).toBeNull();
    });

    it("omits by_team_and_repo when undefined in input", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 5,
      };

      const normalized = normalizeRollup(input);

      expect(normalized).not.toHaveProperty("by_team_and_repo");
    });
  });

  describe("nullable cycle-time fields", () => {
    it("should pass validation when root-level cycle-time fields are null", () => {
      const rollup = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 3,
        cycle_time_p50: null,
        cycle_time_p90: null,
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation when breakdown entry cycle-time fields are null", () => {
      const rollup = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 5,
        by_repository: {
          "small-repo": {
            pr_count: 1,
            cycle_time_p50: null,
            cycle_time_p90: null,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation with mixed null and numeric cycle-time in same rollup", () => {
      const rollup = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
        cycle_time_p50: null,
        cycle_time_p90: 720.0,
        review_time_p50: 60.0,
        review_time_p90: null,
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("validateNestedBreakdown via validateRollup", () => {
    it("skips _truncated metadata key without validation errors", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
        by_team_and_repo: {
          _truncated: true,
          TeamA: {
            Repo1: { pr_count: 5 },
          },
        },
      };

      const result: ValidationResult = validateRollup(input, false);

      expect(result.errors).toHaveLength(0);
    });

    it("reports error for non-object inner value in nested breakdown", () => {
      const input = {
        week: "2026-W02",
        start_date: "2026-01-06",
        end_date: "2026-01-12",
        pr_count: 10,
        by_team_and_repo: {
          TeamA: "not-an-object",
        },
      };

      const result: ValidationResult = validateRollup(input, false);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.field.includes("TeamA"))).toBe(true);
    });
  });
});
