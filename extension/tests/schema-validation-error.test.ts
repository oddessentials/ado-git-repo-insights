/**
 * SchemaValidationError Tests
 *
 * Tests for SchemaValidationError class verifying error message format
 * includes field path and expected/actual information.
 *
 * @module tests/schema-validation-error.test.ts
 */

import { SchemaValidationError } from "../ui/schemas/errors";
import type { ValidationError, ArtifactType } from "../ui/schemas/types";

describe("SchemaValidationError", () => {
  describe("constructor", () => {
    it("should create error with correct name", () => {
      const errors: ValidationError[] = [
        {
          field: "manifest_schema_version",
          expected: "number",
          actual: "undefined",
          message: "Missing required field 'manifest_schema_version'",
        },
      ];

      const error = new SchemaValidationError(errors, "manifest");

      expect(error.name).toBe("SchemaValidationError");
    });

    it("should store errors array", () => {
      const errors: ValidationError[] = [
        {
          field: "week",
          expected: "string (ISO week format)",
          actual: "number",
          message: "Expected string at 'week', got number",
        },
        {
          field: "pr_count",
          expected: "number",
          actual: "string",
          message: "Expected number at 'pr_count', got string",
        },
      ];

      const error = new SchemaValidationError(errors, "rollup");

      expect(error.errors).toBe(errors);
      expect(error.errors).toHaveLength(2);
    });

    it("should store artifact type", () => {
      const errors: ValidationError[] = [
        {
          field: "users[0].user_id",
          expected: "string",
          actual: "undefined",
          message: "Missing required field 'user_id'",
        },
      ];

      const error = new SchemaValidationError(errors, "dimensions");

      expect(error.artifactType).toBe("dimensions");
    });

    it("should be instance of Error", () => {
      const errors: ValidationError[] = [
        {
          field: "forecasts",
          expected: "array",
          actual: "undefined",
          message: "Missing required field 'forecasts'",
        },
      ];

      const error = new SchemaValidationError(errors, "predictions");

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SchemaValidationError);
    });
  });

  describe("error message format", () => {
    it("should include artifact type in message", () => {
      const errors: ValidationError[] = [
        {
          field: "manifest_schema_version",
          expected: "number",
          actual: "undefined",
          message: "Missing required field 'manifest_schema_version'",
        },
      ];

      const error = new SchemaValidationError(errors, "manifest");

      expect(error.message).toContain("manifest");
    });

    it("should include field path in message", () => {
      const errors: ValidationError[] = [
        {
          field: "aggregate_index.weekly_rollups[0].week",
          expected: "string",
          actual: "undefined",
          message: "Missing required field 'week'",
        },
      ];

      const error = new SchemaValidationError(errors, "manifest");

      expect(error.message).toContain("aggregate_index.weekly_rollups[0].week");
    });

    it("should include error message in summary", () => {
      const errors: ValidationError[] = [
        {
          field: "users",
          expected: "array",
          actual: "object",
          message: "Expected array at 'users', got object",
        },
      ];

      const error = new SchemaValidationError(errors, "dimensions");

      expect(error.message).toContain("Expected array at 'users', got object");
    });

    it("should show up to 3 errors in message", () => {
      const errors: ValidationError[] = [
        {
          field: "field1",
          expected: "string",
          actual: "number",
          message: "Error 1",
        },
        {
          field: "field2",
          expected: "number",
          actual: "string",
          message: "Error 2",
        },
        {
          field: "field3",
          expected: "array",
          actual: "object",
          message: "Error 3",
        },
      ];

      const error = new SchemaValidationError(errors, "manifest");

      expect(error.message).toContain("Error 1");
      expect(error.message).toContain("Error 2");
      expect(error.message).toContain("Error 3");
    });

    it("should indicate when more than 3 errors exist", () => {
      const errors: ValidationError[] = [
        {
          field: "field1",
          expected: "string",
          actual: "number",
          message: "Error 1",
        },
        {
          field: "field2",
          expected: "number",
          actual: "string",
          message: "Error 2",
        },
        {
          field: "field3",
          expected: "array",
          actual: "object",
          message: "Error 3",
        },
        {
          field: "field4",
          expected: "boolean",
          actual: "null",
          message: "Error 4",
        },
        {
          field: "field5",
          expected: "object",
          actual: "array",
          message: "Error 5",
        },
      ];

      const error = new SchemaValidationError(errors, "rollup");

      expect(error.message).toContain("+2 more");
    });
  });

  describe("getDetailedMessage", () => {
    it("should include all errors with field, expected, and actual", () => {
      const errors: ValidationError[] = [
        {
          field: "manifest_schema_version",
          expected: "number",
          actual: "undefined",
          message: "Missing required field 'manifest_schema_version'",
        },
        {
          field: "aggregate_index",
          expected: "object",
          actual: "null",
          message: "Expected object at 'aggregate_index', got null",
        },
      ];

      const error = new SchemaValidationError(errors, "manifest");
      const detailed = error.getDetailedMessage();

      // Should include header
      expect(detailed).toContain("Schema validation failed for manifest:");

      // Should include first error details
      expect(detailed).toContain("manifest_schema_version");
      expect(detailed).toContain("Expected: number");
      expect(detailed).toContain("Actual: undefined");

      // Should include second error details
      expect(detailed).toContain("aggregate_index");
      expect(detailed).toContain("Expected: object");
      expect(detailed).toContain("Actual: null");
    });

    it("should format each error on separate lines", () => {
      const errors: ValidationError[] = [
        {
          field: "repositories[0].repository_id",
          expected: "string",
          actual: "number",
          message:
            "Expected string at 'repositories[0].repository_id', got number",
        },
      ];

      const error = new SchemaValidationError(errors, "dimensions");
      const detailed = error.getDetailedMessage();

      const lines = detailed.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(
        lines.some((line) => line.includes("repositories[0].repository_id")),
      ).toBe(true);
    });
  });

  describe("artifact types", () => {
    const artifactTypes: ArtifactType[] = [
      "manifest",
      "rollup",
      "dimensions",
      "predictions",
    ];

    it.each(artifactTypes)("should accept artifact type: %s", (type) => {
      const errors: ValidationError[] = [
        {
          field: "test_field",
          expected: "string",
          actual: "number",
          message: "Test error",
        },
      ];

      const error = new SchemaValidationError(errors, type);

      expect(error.artifactType).toBe(type);
      expect(error.message).toContain(type);
    });
  });

  describe("empty errors array", () => {
    it("should handle empty errors array gracefully", () => {
      const errors: ValidationError[] = [];

      const error = new SchemaValidationError(errors, "manifest");

      expect(error.errors).toHaveLength(0);
      expect(error.message).toContain("manifest");
    });
  });

  describe("stack trace", () => {
    it("should have a stack trace", () => {
      const errors: ValidationError[] = [
        {
          field: "test",
          expected: "string",
          actual: "number",
          message: "Test error",
        },
      ];

      const error = new SchemaValidationError(errors, "manifest");

      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe("string");
    });
  });
});
