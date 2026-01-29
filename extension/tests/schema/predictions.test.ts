/**
 * Predictions Schema Tests
 *
 * Tests for predictions/trends.json schema validation.
 * Predictions uses PERMISSIVE mode - unknown fields cause warnings, not errors.
 * Also handles absent file as valid (predictions are optional).
 *
 * @module tests/schema/predictions.test.ts
 */

import { validatePredictions } from "../../ui/schemas/predictions.schema";
import type { ValidationResult } from "../../ui/schemas/types";

// Load the actual fixture for valid data tests
import validPredictions from "../fixtures/predictions/trends.json";

describe("Predictions Schema Validator", () => {
  describe("valid data", () => {
    it("should pass validation for the fixture file", () => {
      const result: ValidationResult = validatePredictions(
        validPredictions,
        false,
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation with minimal required fields", () => {
      const minimal = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [],
      };
      const result = validatePredictions(minimal, false);
      expect(result.valid).toBe(true);
    });

    it("should pass with optional generated_by and is_stub fields", () => {
      const withOptional = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        generated_by: "test-generator",
        is_stub: true,
        forecasts: [],
      };
      const result = validatePredictions(withOptional, false);
      expect(result.valid).toBe(true);
    });
  });

  describe("absent file handling", () => {
    it("should return valid for null (absent file)", () => {
      const result = validatePredictions(null, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid for undefined (absent file)", () => {
      const result = validatePredictions(undefined, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("missing required fields", () => {
    it("should fail when schema_version is missing", () => {
      const invalid = { ...validPredictions };
      delete (invalid as Record<string, unknown>).schema_version;
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("schema_version")),
      ).toBe(true);
    });

    it("should fail when generated_at is missing", () => {
      const invalid = { ...validPredictions };
      delete (invalid as Record<string, unknown>).generated_at;
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("generated_at"))).toBe(
        true,
      );
    });

    it("should fail when forecasts is missing", () => {
      const invalid = { ...validPredictions };
      delete (invalid as Record<string, unknown>).forecasts;
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("forecasts"))).toBe(
        true,
      );
    });
  });

  describe("invalid types", () => {
    it("should fail when schema_version is not a number", () => {
      const invalid = { ...validPredictions, schema_version: "1" };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when generated_at is not a valid ISO datetime", () => {
      const invalid = { ...validPredictions, generated_at: "not-a-date" };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when forecasts is not an array", () => {
      const invalid = { ...validPredictions, forecasts: {} };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when is_stub is not a boolean", () => {
      const invalid = { ...validPredictions, is_stub: "true" };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
    });
  });

  describe("forecast item validation", () => {
    it("should fail when forecast item is missing metric", () => {
      const invalid = {
        ...validPredictions,
        forecasts: [{ unit: "count", horizon_weeks: 4, values: [] }],
      };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("metric"))).toBe(true);
    });

    it("should fail when forecast item is missing unit", () => {
      const invalid = {
        ...validPredictions,
        forecasts: [{ metric: "pr_throughput", horizon_weeks: 4, values: [] }],
      };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("unit"))).toBe(true);
    });

    it("should fail when forecast item is missing horizon_weeks", () => {
      const invalid = {
        ...validPredictions,
        forecasts: [{ metric: "pr_throughput", unit: "count", values: [] }],
      };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("horizon_weeks"))).toBe(
        true,
      );
    });

    it("should fail when forecast item is missing values", () => {
      const invalid = {
        ...validPredictions,
        forecasts: [
          { metric: "pr_throughput", unit: "count", horizon_weeks: 4 },
        ],
      };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("values"))).toBe(true);
    });
  });

  describe("forecast value validation", () => {
    it("should fail when value is missing period_start", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            horizon_weeks: 4,
            values: [{ predicted: 28, lower_bound: 22, upper_bound: 34 }],
          },
        ],
      };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("period_start"))).toBe(
        true,
      );
    });

    it("should fail when value is missing predicted", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            horizon_weeks: 4,
            values: [
              { period_start: "2026-01-13", lower_bound: 22, upper_bound: 34 },
            ],
          },
        ],
      };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("predicted"))).toBe(
        true,
      );
    });

    it("should fail when period_start is not ISO date format", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            horizon_weeks: 4,
            values: [{ period_start: "01-13-2026", predicted: 28 }],
          },
        ],
      };
      const result = validatePredictions(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should pass when optional bounds are missing", () => {
      const valid = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            horizon_weeks: 4,
            values: [{ period_start: "2026-01-13", predicted: 28 }],
          },
        ],
      };
      const result = validatePredictions(valid, false);
      expect(result.valid).toBe(true);
    });
  });

  describe("permissive mode (unknown fields)", () => {
    it("should PASS with warning in permissive mode when unknown fields present", () => {
      const withUnknown = {
        ...validPredictions,
        unknown_field: "should warn only",
        extra_metadata: { foo: "bar" },
      };
      const result = validatePredictions(withUnknown, false);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((w) => w.field.includes("unknown_field")),
      ).toBe(true);
    });

    it("should FAIL in strict mode when unknown fields present", () => {
      const withUnknown = {
        ...validPredictions,
        unknown_field: "should fail",
      };
      const result = validatePredictions(withUnknown, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("unknown_field"))).toBe(
        true,
      );
    });

    it("should warn for unknown fields in forecast items in permissive mode", () => {
      const withUnknown = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            horizon_weeks: 4,
            values: [],
            extra_field: "unknown",
          },
        ],
      };
      const result = validatePredictions(withUnknown, false);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field.includes("extra_field"))).toBe(
        true,
      );
    });
  });

  describe("empty JSON handling", () => {
    it("should fail with missing required field error for empty object", () => {
      const result = validatePredictions({}, false);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("required");
    });

    // Note: null/undefined are valid for predictions (absent file handling)
    // This is different from other schemas
  });

  describe("state enum validation (if present)", () => {
    it("should pass with valid state values", () => {
      const withState = {
        ...validPredictions,
        state: "ready",
      };
      const result = validatePredictions(withState, false);
      // If state field is supported, it should validate enum values
      // This test documents expected behavior if state is added
      expect(result.valid).toBe(true);
    });
  });

  describe("schema version validation for state machine", () => {
    it("should pass validation with schema_version 1 (supported)", () => {
      const data = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        forecasts: [],
      };
      const result = validatePredictions(data, false);
      expect(result.valid).toBe(true);
    });

    it("should pass validation with unsupported schema_version (validator does not enforce range)", () => {
      // Note: The schema validator validates structure, not version range.
      // Version range enforcement happens in the state machine.
      const data = {
        schema_version: 99,
        generated_at: "2026-01-28T12:00:00Z",
        forecasts: [],
      };
      const result = validatePredictions(data, false);
      // Schema validation passes - it's the state machine that checks version range
      expect(result.valid).toBe(true);
    });

    it("should fail validation when schema_version is not a number", () => {
      const data = {
        schema_version: "1",
        generated_at: "2026-01-28T12:00:00Z",
        forecasts: [],
      };
      const result = validatePredictions(data, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "schema_version")).toBe(
        true,
      );
    });

    it("should fail validation when schema_version is missing", () => {
      const data = {
        generated_at: "2026-01-28T12:00:00Z",
        forecasts: [],
      };
      const result = validatePredictions(data, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "schema_version")).toBe(
        true,
      );
    });
  });
});
