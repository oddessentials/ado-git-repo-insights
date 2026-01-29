/**
 * Rollup Schema Tests
 *
 * Tests for weekly rollup JSON schema validation.
 * Rollup uses PERMISSIVE mode - unknown fields cause warnings, not errors.
 *
 * @module tests/schema/rollup.test.ts
 */

import { validateRollup } from "../../ui/schemas/rollup.schema";
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
      expect(result.errors[0].field).toContain("week");
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
  });

  describe("empty JSON handling", () => {
    it("should fail with missing required field error for empty object", () => {
      const result = validateRollup({}, false);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("required");
    });

    it("should fail for null input", () => {
      const result = validateRollup(null, false);
      expect(result.valid).toBe(false);
    });
  });
});
