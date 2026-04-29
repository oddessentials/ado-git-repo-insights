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

  // =========================================================================
  // Feature 060 PR-level detail: prs / _prs_truncated / _prs_cap validation.
  // Covers the validatePrRecordArray helper + validateRollup tail branches.
  // All warnings, no errors — permissive per FR-001 load-path clause.
  // =========================================================================
  describe("PR-level detail validation (feature 060)", () => {
    const BASE = {
      week: "2025-W20",
      start_date: "2025-05-12",
      end_date: "2025-05-18",
      pr_count: 3,
    };
    const VALID_PR = {
      id: 1,
      title: "feat: landed",
      author_id: "alice",
      repository_id: "web-app",
      cycle_time: 120.0,
    };

    it("accepts a complete prs array with matching markers and emits no warnings about PR fields", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [VALID_PR],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const prWarnings = result.warnings.filter(
        (w) =>
          w.field.startsWith("prs") ||
          w.field === "_prs_truncated" ||
          w.field === "_prs_cap",
      );
      expect(prWarnings).toEqual([]);
    });

    it("warns when prs is present but _prs_truncated is absent", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [VALID_PR],
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === "_prs_truncated")).toBe(
        true,
      );
    });

    it("warns when prs is present but _prs_cap is absent", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [VALID_PR],
          _prs_truncated: false,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === "_prs_cap")).toBe(true);
    });

    it("warns when _prs_truncated has the wrong type", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [VALID_PR],
          _prs_truncated: "not-a-boolean",
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "_prs_truncated");
      expect(w).toBeDefined();
      expect(w!.message.toLowerCase()).toContain("boolean");
    });

    it("warns when _prs_cap has the wrong type", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [VALID_PR],
          _prs_truncated: false,
          _prs_cap: "lots",
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "_prs_cap");
      expect(w).toBeDefined();
      expect(w!.message.toLowerCase()).toContain("number");
    });

    it("warns and ignores _prs_truncated when prs is absent (orphan marker)", () => {
      const result = validateRollup(
        {
          ...BASE,
          _prs_truncated: true,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "_prs_truncated");
      expect(w).toBeDefined();
      expect(w!.message).toContain("ignored");
    });

    it("warns and ignores _prs_cap when prs is absent (orphan marker)", () => {
      const result = validateRollup(
        {
          ...BASE,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "_prs_cap");
      expect(w).toBeDefined();
      expect(w!.message).toContain("ignored");
    });

    it("warns when prs is present but not an array", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: "not-an-array",
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === "prs")).toBe(true);
    });

    it("warns when a prs element is not an object", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: ["not-a-record"],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field.startsWith("prs[0]"))).toBe(
        true,
      );
    });

    it("warns for each missing required field on a PR record", () => {
      const result = validateRollup(
        {
          ...BASE,
          // Empty object — all five required fields missing. Exercises the
          // `hasOwnProperty.call(...) ? ... : undefined` false branch for
          // every per-field type check, which the partial-branch ratchet
          // would otherwise flag as unreachable on the `id` check.
          prs: [{}],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const missingFieldWarnings = result.warnings.filter((w) =>
        w.message.includes("missing required PR field"),
      );
      expect(missingFieldWarnings.length).toBe(5);
    });

    it("warns when id is not a number", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [{ ...VALID_PR, id: "not-numeric" }],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "prs[0].id");
      expect(w).toBeDefined();
      expect(w!.message.toLowerCase()).toContain("number");
    });

    it("warns when title is not a string", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [{ ...VALID_PR, title: 42 }],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "prs[0].title");
      expect(w).toBeDefined();
      expect(w!.message.toLowerCase()).toContain("string");
    });

    it("warns when author_id is not a string", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [{ ...VALID_PR, author_id: 0 }],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "prs[0].author_id");
      expect(w).toBeDefined();
      expect(w!.message.toLowerCase()).toContain("string");
    });

    it("warns when repository_id is not a string", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [{ ...VALID_PR, repository_id: false }],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "prs[0].repository_id");
      expect(w).toBeDefined();
      expect(w!.message.toLowerCase()).toContain("string");
    });

    it("warns when cycle_time is not a number", () => {
      const result = validateRollup(
        {
          ...BASE,
          prs: [{ ...VALID_PR, cycle_time: "fast" }],
          _prs_truncated: false,
          _prs_cap: 500,
        },
        false,
      );
      expect(result.valid).toBe(true);
      const w = result.warnings.find((x) => x.field === "prs[0].cycle_time");
      expect(w).toBeDefined();
      expect(w!.message.toLowerCase()).toContain("number");
    });
  });

  // =========================================================================
  // Feature 333 weekly-comments-aggregate: rollup-root `comments` sub-object.
  // Contract: specs/333-comments-trend-chart/contracts/weekly-comments-aggregate.md §3
  //   - Atomic: all four fields (thread_count, comment_count, active_thread_count,
  //     coverage_partial) MUST be present together with non-null typed values.
  //   - Capability-off: the `comments` key is absent entirely (FR-3-03).
  //   - INV-1-08 atomicity posture (ADR T004): STRICT ERROR in BOTH strict and
  //     permissive modes. Validator pushes to `errors`, not `warnings`. This is
  //     ONE TIER STRICTER than the per-PR INV-08 validator at rollup.schema.ts:560-567
  //     (which warns in both modes for backward-compat with pre-310 emissions);
  //     INV-1-08 is a fresh contract with no legacy emissions to grandfather.
  //
  // T010 (TDD): these tests intentionally FAIL today — T013 will extend the
  // validator to satisfy them by adding `"comments"` to KNOWN_ROOT_FIELDS and
  // wiring an atomicity check that pushes to `errors` mode-independently.
  // =========================================================================
  describe("rollup-root comments sub-object (feature 333 INV-1-08)", () => {
    const BASE_333 = {
      week: "2026-W02",
      start_date: "2026-01-06",
      end_date: "2026-01-12",
      pr_count: 10,
    };

    it("passes validation with a complete comments sub-object (no errors, no warnings about 'comments')", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: 12,
          active_thread_count: 2,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // No "unknown field" warning about `comments` itself — the validator
      // (after T013) recognises the key as part of KNOWN_ROOT_FIELDS.
      expect(result.warnings.some((w) => w.field === "comments")).toBe(false);
    });

    it("passes validation with comments.coverage_partial=true (per-week partial coverage sentinel)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: 12,
          active_thread_count: 2,
          coverage_partial: true,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("FAILS in PERMISSIVE mode when comments is partial (missing coverage_partial) — INV-1-08 strict-in-both-modes", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: 12,
          active_thread_count: 2,
          // coverage_partial intentionally absent — atomicity violation.
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      // INV-1-08 ADR T004: pushes to `errors`, NOT `warnings`. This is the key
      // contrast with per-PR INV-08, which warns even in strict mode.
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("comments") &&
            e.message.toLowerCase().includes("coverage_partial"),
        ),
      ).toBe(true);
    });

    it("FAILS in STRICT mode when comments is partial (missing coverage_partial) — same posture as permissive", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: 12,
          active_thread_count: 2,
        },
      };
      const result = validateRollup(rollup, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("comments") &&
            e.message.toLowerCase().includes("coverage_partial"),
        ),
      ).toBe(true);
    });

    it("FAILS when comments is partial — missing thread_count (any of the four atomicity fields)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          comment_count: 12,
          active_thread_count: 2,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("comments") &&
            e.message.toLowerCase().includes("thread_count"),
        ),
      ).toBe(true);
    });

    it("FAILS when comments.thread_count is null (numeric fields MUST be non-null per INV-1-08)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: null,
          comment_count: 5,
          active_thread_count: 2,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("thread_count"))).toBe(
        true,
      );
    });

    it("FAILS when comments.comment_count is null (numeric fields MUST be non-null per INV-1-08)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: null,
          active_thread_count: 2,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("comment_count"))).toBe(
        true,
      );
    });

    it("FAILS when comments.active_thread_count is null (numeric fields MUST be non-null per INV-1-08)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: 12,
          active_thread_count: null,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("active_thread_count")),
      ).toBe(true);
    });

    it("passes validation when the comments key is absent entirely (capability-off path per FR-3-03)", () => {
      const rollup = { ...BASE_333 };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // No warning about a missing `comments` key — absence is the canonical
      // capability-off signal, not a violation.
      expect(result.warnings.some((w) => w.field === "comments")).toBe(false);
    });

    it("FAILS when comments.coverage_partial is a string instead of boolean", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: 12,
          active_thread_count: 2,
          coverage_partial: "true",
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("coverage_partial") &&
            e.message.toLowerCase().includes("boolean"),
        ),
      ).toBe(true);
    });

    it("FAILS when comments.thread_count is a string instead of number", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: "5",
          comment_count: 12,
          active_thread_count: 2,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("number"),
        ),
      ).toBe(true);
    });

    it("FAILS when comments is null (FR-3-03 failure mode (b))", () => {
      // FR-3-03 lists `comments: null` as one of the four omission failure
      // modes the byte-identity test must guard against. Even though the
      // capability-off path is "key absent," a regression that produces
      // `comments: null` (key present, null-valued) MUST be rejected by
      // the validator with an "expected object" error, so misuse on the
      // producer side is caught at the consumer-validator layer rather
      // than blowing up later in the renderer.
      const rollup = { ...BASE_333, comments: null };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "comments" &&
            e.message.toLowerCase().includes("object"),
        ),
      ).toBe(true);
    });

    // INV-1-06 ordering + sign + integer: producer-side SQL guarantees these
    // by construction, but the validator is the trust boundary. Without
    // these checks, a malformed rollup (golden fixture, third-party feed,
    // or future producer drift) would slip through to the renderer where
    // `resolved = thread - active` would yield negative bar heights.
    it("FAILS when comments.thread_count is negative (counts cannot be negative)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: -1,
          comment_count: 5,
          active_thread_count: 0,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("non-negative"),
        ),
      ).toBe(true);
    });

    it("FAILS when comments.comment_count is non-integer (counts must be whole numbers)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 5,
          comment_count: 1.5,
          active_thread_count: 2,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("comment_count") &&
            e.message.toLowerCase().includes("integer"),
        ),
      ).toBe(true);
    });

    it("FAILS when active_thread_count > thread_count (INV-1-06 ordering)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 4,
          comment_count: 12,
          active_thread_count: 5,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("active_thread_count") &&
            e.message.includes("INV-1-06"),
        ),
      ).toBe(true);
    });

    it("passes when all three numeric fields are 0 (zero is the valid sum over an empty extracted-subset)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 0,
          comment_count: 0,
          active_thread_count: 0,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("passes at the INV-1-06 boundary (active_thread_count == thread_count; subset == set)", () => {
      const rollup = {
        ...BASE_333,
        comments: {
          thread_count: 4,
          comment_count: 9,
          active_thread_count: 4,
          coverage_partial: false,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // =========================================================================
  // Feature 334 per-author comments-density: rollup-root `by_author_comments`
  // outer dict.  Each entry is atomic per INV-2-08 (mirrors 333's per-week
  // INV-1-08 at sub-object granularity).  ADR T003 atomicity posture is
  // STRICT ERROR in BOTH strict and permissive modes — same justification as
  // the 333 `comments` validator (no legacy emissions to grandfather).
  // Capability-off (FR-3-03 + INV-2-09) signals via the entire key being
  // absent.  The reserved sentinel literal `__former_or_unavailable_author__`
  // is a permitted bucket key.
  // =========================================================================
  describe("rollup-root by_author_comments outer dict (feature 334 INV-2-08)", () => {
    const BASE_334 = {
      week: "2026-W02",
      start_date: "2026-01-06",
      end_date: "2026-01-12",
      pr_count: 10,
    };
    const SENTINEL_LITERAL = "__former_or_unavailable_author__";

    it("(a) passes validation with a complete by_author_comments entry", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: 3,
            comment_count: 7,
            active_thread_count: 1,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(
        result.warnings.some((w) => w.field === "by_author_comments"),
      ).toBe(false);
    });

    it("(b) FAILS atomicity in BOTH strict and permissive modes when an entry is partial (ADR T003)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: 3,
            comment_count: 7,
            active_thread_count: 1,
            // coverage_partial intentionally absent — INV-2-08 violation.
          },
        },
      };
      for (const strict of [false, true] as const) {
        const result = validateRollup(rollup, strict);
        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) =>
              e.field.includes("by_author_comments") &&
              e.message.toLowerCase().includes("coverage_partial"),
          ),
        ).toBe(true);
      }
    });

    it("(c) FAILS when a numeric field is null (INV-2-08: zero is the empty-extracted-subset sum, null is not a sentinel)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: null,
            comment_count: 7,
            active_thread_count: 1,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_author_comments") &&
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("null"),
        ),
      ).toBe(true);
    });

    it("(d) passes validation when by_author_comments key is entirely absent (capability-off path)", () => {
      const rollup = { ...BASE_334 };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(
        result.warnings.some((w) => w.field === "by_author_comments"),
      ).toBe(false);
    });

    it("(e) FAILS with wrong-typed numeric field (e.g., thread_count is a string)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: "5" as unknown as number,
            comment_count: 7,
            active_thread_count: 1,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_author_comments") &&
            e.field.includes("thread_count"),
        ),
      ).toBe(true);
    });

    it("(f) FAILS when active_thread_count > thread_count per entry (INV-2-07 ordering)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: 3,
            comment_count: 7,
            active_thread_count: 4, // > thread_count, INV-2-07 violation
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_author_comments") &&
            e.field.includes("active_thread_count") &&
            e.message.toLowerCase().includes("inv-2-07"),
        ),
      ).toBe(true);
    });

    it("(g) accepts the reserved sentinel literal as a bucket key with an atomic entry", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          [SENTINEL_LITERAL]: {
            thread_count: 2,
            comment_count: 5,
            active_thread_count: 1,
            coverage_partial: true,
          },
          "alice-uid": {
            thread_count: 1,
            comment_count: 1,
            active_thread_count: 0,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("FAILS when by_author_comments is not an object (non-Record top-level type)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: "not-an-object" as unknown as Record<
          string,
          unknown
        >,
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "by_author_comments")).toBe(
        true,
      );
    });

    it("FAILS when by_author_comments is the empty object (capability-on must omit, not emit `{}`)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {},
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "by_author_comments" &&
            e.message.toLowerCase().includes("must be omitted"),
        ),
      ).toBe(true);
    });

    it("FAILS when an entry value is not an object", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": "not-an-entry" as unknown as Record<string, unknown>,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("by_author_comments")),
      ).toBe(true);
    });

    it("FAILS when a numeric field is negative", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: -1,
            comment_count: 4,
            active_thread_count: 0,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_author_comments") &&
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("non-negative"),
        ),
      ).toBe(true);
    });

    it("FAILS when a numeric field is a non-integer (counts must be whole numbers)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: 1.5,
            comment_count: 4,
            active_thread_count: 0,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_author_comments") &&
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("integer"),
        ),
      ).toBe(true);
    });

    it("FAILS when coverage_partial is not a boolean", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            thread_count: 1,
            comment_count: 1,
            active_thread_count: 0,
            coverage_partial: "yes" as unknown as boolean,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_author_comments") &&
            e.field.includes("coverage_partial"),
        ),
      ).toBe(true);
    });

    it("FAILS when one numeric field is missing (single-field omission, not full atomicity)", () => {
      const rollup = {
        ...BASE_334,
        by_author_comments: {
          "alice-uid": {
            // thread_count intentionally absent — atomicity violation that
            // must still fire on a single-field omission (case (b) covers
            // coverage_partial; this case covers a numeric-field omission).
            comment_count: 4,
            active_thread_count: 0,
            coverage_partial: false,
          } as unknown as Record<string, unknown>,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_author_comments") &&
            e.message.toLowerCase().includes("thread_count"),
        ),
      ).toBe(true);
    });
  });

  // =========================================================================
  // Feature 335 per-repo comments-density: rollup-root `by_repository_comments`
  // outer dict.  Each entry is atomic per INV-3-08 (mirrors 333's per-week
  // INV-1-08 and 334's per-author INV-2-08 at sub-object granularity).
  // STRICT-ERROR atomicity posture in BOTH strict and permissive modes —
  // same justification as the 334 / 333 validators (no legacy emissions to
  // grandfather).  Capability-off (FR-3-03 + INV-3-09) signals via the
  // entire key being absent.  NO sentinel concept (CL-03 / INV-3-12 —
  // repository_id is FK-protected at models.py:88), so bucket keys are
  // raw repository_id strings only — there is no reserved-literal case
  // to test (334 (g) intentionally absent).
  // =========================================================================
  describe("rollup-root by_repository_comments outer dict (feature 335 INV-3-08)", () => {
    const BASE_335 = {
      week: "2026-W02",
      start_date: "2026-01-06",
      end_date: "2026-01-12",
      pr_count: 10,
    };

    it("(a) passes validation with a complete by_repository_comments entry", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: 3,
            comment_count: 7,
            active_thread_count: 1,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(
        result.warnings.some((w) => w.field === "by_repository_comments"),
      ).toBe(false);
    });

    it("(b) FAILS atomicity in BOTH strict and permissive modes when an entry is partial (INV-3-08)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: 3,
            comment_count: 7,
            active_thread_count: 1,
            // coverage_partial intentionally absent — INV-3-08 violation.
          },
        },
      };
      for (const strict of [false, true] as const) {
        const result = validateRollup(rollup, strict);
        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) =>
              e.field.includes("by_repository_comments") &&
              e.message.toLowerCase().includes("coverage_partial"),
          ),
        ).toBe(true);
      }
    });

    it("(c) FAILS when a numeric field is null (INV-3-08: zero is the empty-extracted-subset sum, null is not a sentinel)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: null,
            comment_count: 7,
            active_thread_count: 1,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_repository_comments") &&
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("null"),
        ),
      ).toBe(true);
    });

    it("(d) passes validation when by_repository_comments key is entirely absent (capability-off path)", () => {
      const rollup = { ...BASE_335 };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(
        result.warnings.some((w) => w.field === "by_repository_comments"),
      ).toBe(false);
    });

    it("(e) FAILS with wrong-typed numeric field (e.g., thread_count is a string)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: "5" as unknown as number,
            comment_count: 7,
            active_thread_count: 1,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_repository_comments") &&
            e.field.includes("thread_count"),
        ),
      ).toBe(true);
    });

    it("(f) FAILS when active_thread_count > thread_count per entry (INV-3-07 ordering)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: 3,
            comment_count: 7,
            active_thread_count: 4, // > thread_count, INV-3-07 violation
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_repository_comments") &&
            e.field.includes("active_thread_count") &&
            e.message.toLowerCase().includes("inv-3-07"),
        ),
      ).toBe(true);
    });

    it("(g) FAILS when by_repository_comments is the empty object (FR-1-10: capability-on must omit, not emit `{}`)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {},
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "by_repository_comments" &&
            e.message.toLowerCase().includes("must be omitted"),
        ),
      ).toBe(true);
    });

    // ===========================================================================
    // Phase 7 partial-branch ratchet covering tests for the schema validator
    // (+6 in this block).  Mirror 334's existing defensive cases (lines 1625-
    // 1764 of this same file) but scoped to ``validateRepositoryCommentsDensity``.
    // ===========================================================================

    it("FAILS when by_repository_comments is not an object (non-Record top-level type)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: "not-an-object" as unknown as Record<
          string,
          unknown
        >,
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "by_repository_comments"),
      ).toBe(true);
    });

    it("FAILS when an entry value is not an object", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": "not-an-entry" as unknown as Record<string, unknown>,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("by_repository_comments")),
      ).toBe(true);
    });

    it("FAILS when a numeric field is negative", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: -1,
            comment_count: 4,
            active_thread_count: 0,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_repository_comments") &&
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("non-negative"),
        ),
      ).toBe(true);
    });

    it("FAILS when a numeric field is a non-integer (counts must be whole numbers)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: 1.5,
            comment_count: 4,
            active_thread_count: 0,
            coverage_partial: false,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_repository_comments") &&
            e.field.includes("thread_count") &&
            e.message.toLowerCase().includes("integer"),
        ),
      ).toBe(true);
    });

    it("FAILS when coverage_partial is not a boolean", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            thread_count: 1,
            comment_count: 1,
            active_thread_count: 0,
            coverage_partial: "yes" as unknown as boolean,
          },
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_repository_comments") &&
            e.field.includes("coverage_partial"),
        ),
      ).toBe(true);
    });

    it("FAILS when one numeric field is missing (single-field omission, not full atomicity)", () => {
      const rollup = {
        ...BASE_335,
        by_repository_comments: {
          "repo-alpha": {
            // thread_count intentionally absent — atomicity violation
            // that must still fire on a single-numeric-field omission
            // (case (b) covers coverage_partial; this covers a numeric
            // field).
            comment_count: 4,
            active_thread_count: 0,
            coverage_partial: false,
          } as unknown as Record<string, unknown>,
        },
      };
      const result = validateRollup(rollup, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("by_repository_comments") &&
            e.message.toLowerCase().includes("thread_count"),
        ),
      ).toBe(true);
    });
  });
});
