/**
 * Manifest Schema Tests
 *
 * Tests for dataset-manifest.json schema validation.
 * Manifest uses STRICT mode - unknown fields cause errors.
 *
 * @module tests/schema/manifest.test.ts
 */

import { validateManifest } from "../../ui/schemas/manifest.schema";
import type { ValidationResult } from "../../ui/schemas/types";

// Load the actual fixture for valid data tests
import validManifest from "../fixtures/dataset-manifest.json";

describe("Manifest Schema Validator", () => {
  describe("valid data", () => {
    it("should pass validation for the fixture file", () => {
      const result: ValidationResult = validateManifest(validManifest, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation with minimal required fields", () => {
      const minimal = {
        manifest_schema_version: 1,
        dataset_schema_version: 1,
        aggregates_schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        run_id: "test-123",
        aggregate_index: {
          weekly_rollups: [],
          distributions: [],
        },
      };
      const result = validateManifest(minimal, true);
      expect(result.valid).toBe(true);
    });
  });

  describe("missing required fields", () => {
    it("should fail when manifest_schema_version is missing", () => {
      const invalid = { ...validManifest };
      delete (invalid as Record<string, unknown>).manifest_schema_version;
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toContain("manifest_schema_version");
    });

    it("should fail when generated_at is missing", () => {
      const invalid = { ...validManifest };
      delete (invalid as Record<string, unknown>).generated_at;
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("generated_at"))).toBe(
        true,
      );
    });

    it("should fail when run_id is missing", () => {
      const invalid = { ...validManifest };
      delete (invalid as Record<string, unknown>).run_id;
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("run_id"))).toBe(true);
    });

    it("should fail when aggregate_index is missing", () => {
      const invalid = { ...validManifest };
      delete (invalid as Record<string, unknown>).aggregate_index;
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("aggregate_index")),
      ).toBe(true);
    });
  });

  describe("invalid types", () => {
    it("should fail when manifest_schema_version is not a number", () => {
      const invalid = { ...validManifest, manifest_schema_version: "1" };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors[0].expected).toContain("number");
    });

    it("should fail when generated_at is not a valid ISO datetime", () => {
      const invalid = { ...validManifest, generated_at: "not-a-date" };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("generated_at"))).toBe(
        true,
      );
    });

    it("should fail when run_id is not a string", () => {
      const invalid = { ...validManifest, run_id: 12345 };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
    });
  });

  describe("invalid date formats", () => {
    it("should fail when coverage.date_range.min is not ISO date", () => {
      const invalid = {
        ...validManifest,
        coverage: {
          ...validManifest.coverage,
          date_range: {
            min: "01-01-2025", // wrong format
            max: "2026-01-14",
          },
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("date"))).toBe(true);
    });

    it("should fail when coverage.date_range.max is not ISO date", () => {
      const invalid = {
        ...validManifest,
        coverage: {
          ...validManifest.coverage,
          date_range: {
            min: "2025-01-01",
            max: "January 14, 2026", // wrong format
          },
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
    });
  });

  describe("strict mode (unknown fields)", () => {
    it("should FAIL in strict mode when unknown fields are present", () => {
      const withUnknown = {
        ...validManifest,
        unknown_field: "should cause error",
        another_unknown: 123,
      };
      const result = validateManifest(withUnknown, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("unknown_field"))).toBe(
        true,
      );
    });

    it("should WARN in permissive mode when unknown fields are present", () => {
      const withUnknown = {
        ...validManifest,
        unknown_field: "should warn only",
      };
      const result = validateManifest(withUnknown, false);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((w) => w.field.includes("unknown_field")),
      ).toBe(true);
    });
  });

  describe("aggregate_index validation", () => {
    it("should fail when weekly_rollups item is missing week", () => {
      const invalid = {
        ...validManifest,
        aggregate_index: {
          ...validManifest.aggregate_index,
          weekly_rollups: [{ path: "some/path.json", pr_count: 10 }],
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("week"))).toBe(true);
    });

    it("should fail when weekly_rollups item has invalid week format", () => {
      const invalid = {
        ...validManifest,
        aggregate_index: {
          ...validManifest.aggregate_index,
          weekly_rollups: [
            {
              week: "2026-01",
              path: "some/path.json",
              pr_count: 10,
              size_bytes: 100,
            },
          ],
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("week"))).toBe(true);
    });

    it("should fail when distributions item is missing year", () => {
      const invalid = {
        ...validManifest,
        aggregate_index: {
          ...validManifest.aggregate_index,
          distributions: [{ path: "some/path.json", total_prs: 10 }],
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("year"))).toBe(true);
    });

    it("should fail when distributions item has invalid year format", () => {
      const invalid = {
        ...validManifest,
        aggregate_index: {
          ...validManifest.aggregate_index,
          distributions: [
            {
              year: "25",
              path: "some/path.json",
              total_prs: 10,
              size_bytes: 100,
            },
          ],
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
    });
  });

  describe("empty JSON handling", () => {
    it("should fail with missing required field error for empty object", () => {
      const result = validateManifest({}, true);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("required");
    });

    it("should fail for null input", () => {
      const result = validateManifest(null, true);
      expect(result.valid).toBe(false);
    });

    it("should fail for non-object input", () => {
      const result = validateManifest("not an object", true);
      expect(result.valid).toBe(false);
    });
  });
});
