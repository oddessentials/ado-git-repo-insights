/**
 * Insights Schema Tests
 *
 * Tests for ai_insights/summary.json schema validation.
 * Insights uses PERMISSIVE mode - unknown fields cause warnings, not errors.
 * Also handles absent file as valid (insights are optional).
 *
 * @module tests/schema/insights.test.ts
 */

import { validateInsights } from "../../ui/schemas/insights.schema";
import type { ValidationResult } from "../../ui/schemas/types";

// Load the actual fixture for valid data tests
import validInsights from "../fixtures/insights-valid.json";

describe("Insights Schema Validator", () => {
  describe("valid data", () => {
    it("should pass validation for the fixture file", () => {
      const result: ValidationResult = validateInsights(validInsights, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation with minimal required fields", () => {
      const minimal = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [],
      };
      const result = validateInsights(minimal, false);
      expect(result.valid).toBe(true);
    });

    it("should pass with optional is_stub field", () => {
      const withOptional = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        is_stub: true,
        insights: [],
      };
      const result = validateInsights(withOptional, false);
      expect(result.valid).toBe(true);
    });
  });

  describe("absent file handling", () => {
    it("should return valid for null (absent file)", () => {
      const result = validateInsights(null, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid for undefined (absent file)", () => {
      const result = validateInsights(undefined, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("missing required fields", () => {
    it("should fail when schema_version is missing", () => {
      const invalid = {
        generated_at: "2026-01-28T12:00:00Z",
        insights: [],
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "schema_version")).toBe(
        true,
      );
    });

    it("should fail when generated_at is missing", () => {
      const invalid = {
        schema_version: 1,
        insights: [],
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "generated_at")).toBe(true);
    });

    it("should fail when insights is missing", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "insights")).toBe(true);
    });
  });

  describe("invalid types", () => {
    it("should fail when schema_version is not a number", () => {
      const invalid = {
        schema_version: "1",
        generated_at: "2026-01-28T12:00:00Z",
        insights: [],
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when generated_at is not a valid ISO datetime", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "not-a-date",
        insights: [],
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when insights is not an array", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: {},
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should fail when is_stub is not a boolean", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        is_stub: "true",
        insights: [],
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
    });
  });

  describe("insight item validation", () => {
    const baseInsight = {
      id: 1,
      category: "velocity",
      severity: "warning",
      title: "Test",
      description: "Test description",
    };

    it("should fail when insight item is missing id", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, id: undefined }],
      };
      delete (invalid.insights[0] as Record<string, unknown>).id;
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("id"))).toBe(true);
    });

    it("should fail when insight item is missing category", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, category: undefined }],
      };
      delete (invalid.insights[0] as Record<string, unknown>).category;
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("category"))).toBe(
        true,
      );
    });

    it("should fail when insight item is missing severity", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, severity: undefined }],
      };
      delete (invalid.insights[0] as Record<string, unknown>).severity;
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("severity"))).toBe(
        true,
      );
    });

    it("should fail when severity is not a valid enum value", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, severity: "invalid" }],
      };
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
    });

    it("should accept all valid severity values", () => {
      for (const severity of ["critical", "warning", "info"]) {
        const valid = {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          insights: [{ ...baseInsight, severity }],
        };
        const result = validateInsights(valid, false);
        expect(result.valid).toBe(true);
      }
    });

    it("should fail when insight item is missing title", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, title: undefined }],
      };
      delete (invalid.insights[0] as Record<string, unknown>).title;
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("title"))).toBe(true);
    });

    it("should fail when insight item is missing description", () => {
      const invalid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, description: undefined }],
      };
      delete (invalid.insights[0] as Record<string, unknown>).description;
      const result = validateInsights(invalid, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("description"))).toBe(
        true,
      );
    });

    it("should accept string id", () => {
      const valid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, id: "insight-001" }],
      };
      const result = validateInsights(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should accept numeric id", () => {
      const valid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [{ ...baseInsight, id: 42 }],
      };
      const result = validateInsights(valid, false);
      expect(result.valid).toBe(true);
    });
  });

  describe("optional insight fields", () => {
    const baseInsight = {
      id: 1,
      category: "velocity",
      severity: "warning" as const,
      title: "Test",
      description: "Test description",
    };

    it("should pass with optional data field", () => {
      const valid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [
          {
            ...baseInsight,
            data: {
              metric_name: "cycle_time",
              current_value: 48.5,
              previous_value: 38.8,
              change_percent: 25.0,
              trend: "up",
            },
          },
        ],
      };
      const result = validateInsights(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should pass with optional affected_entities field", () => {
      const valid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [
          {
            ...baseInsight,
            affected_entities: [
              { type: "repository", id: "repo-1", name: "main-api" },
              { type: "team", id: "team-1", name: "Backend Team" },
            ],
          },
        ],
      };
      const result = validateInsights(valid, false);
      expect(result.valid).toBe(true);
    });

    it("should pass with optional recommendation field", () => {
      const valid = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [
          {
            ...baseInsight,
            recommendation: {
              action: "Review PR size guidelines",
              effort: "low",
              priority: "high",
            },
          },
        ],
      };
      const result = validateInsights(valid, false);
      expect(result.valid).toBe(true);
    });
  });

  describe("permissive mode (unknown fields)", () => {
    it("should PASS with warning in permissive mode when unknown fields present", () => {
      const withUnknown = {
        ...validInsights,
        unknown_field: "should warn only",
      };
      const result = validateInsights(withUnknown, false);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((w) => w.field.includes("unknown_field")),
      ).toBe(true);
    });

    it("should FAIL in strict mode when unknown fields present", () => {
      const withUnknown = {
        ...validInsights,
        unknown_field: "should fail",
      };
      const result = validateInsights(withUnknown, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("unknown_field"))).toBe(
        true,
      );
    });
  });

  describe("schema version validation for state machine", () => {
    it("should pass validation with schema_version 1 (supported)", () => {
      const data = {
        schema_version: 1,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [],
      };
      const result = validateInsights(data, false);
      expect(result.valid).toBe(true);
    });

    it("should pass validation with unsupported schema_version (validator does not enforce range)", () => {
      // Note: The schema validator validates structure, not version range.
      // Version range enforcement happens in the state machine.
      const data = {
        schema_version: 99,
        generated_at: "2026-01-28T12:00:00Z",
        insights: [],
      };
      const result = validateInsights(data, false);
      // Schema validation passes - it's the state machine that checks version range
      expect(result.valid).toBe(true);
    });

    it("should fail validation when schema_version is not a number", () => {
      const data = {
        schema_version: "1",
        generated_at: "2026-01-28T12:00:00Z",
        insights: [],
      };
      const result = validateInsights(data, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "schema_version")).toBe(
        true,
      );
    });

    it("should fail validation when schema_version is missing", () => {
      const data = {
        generated_at: "2026-01-28T12:00:00Z",
        insights: [],
      };
      const result = validateInsights(data, false);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "schema_version")).toBe(
        true,
      );
    });
  });

  describe("empty JSON handling", () => {
    it("should fail with missing required field error for empty object", () => {
      const result = validateInsights({}, false);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("required");
    });
  });
});
