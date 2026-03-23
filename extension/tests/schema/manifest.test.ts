/**
 * Manifest Schema Tests
 *
 * Tests for dataset-manifest.json schema validation.
 * Manifest uses STRICT mode - unknown fields cause errors.
 *
 * @module tests/schema/manifest.test.ts
 */

import {
  normalizeManifest,
  validateManifest,
} from "../../ui/schemas/manifest.schema";
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

    it("should accept comments coverage objects with capped metadata", () => {
      const withComments = {
        ...validManifest,
        coverage: {
          ...validManifest.coverage,
          comments: {
            status: "partial",
            threads_fetched: 8,
            comments_fetched: 15,
            prs_with_threads: 4,
            capped: true,
          },
        },
        capabilities: {
          author_filters: true,
          author_repo_exact: true,
          comments_metrics: true,
          reviewer_repository_mode: "constrained",
          reviewer_team_mode: "disallowed",
          cross_dimensional_available: true,
        },
      };
      const result = validateManifest(withComments, true);
      expect(result.valid).toBe(true);
    });

    it("should accept demo profile and published files metadata", () => {
      const withMetadata = {
        ...validManifest,
        demo_profile: {
          name: "enterprise-demo",
          version: "2.0.0",
          seed: 42,
          canonical_output_root: "artifacts/demo-enterprise",
        },
        published_files: {
          direct: ["dataset-manifest.json"],
          globs: ["aggregates/comments/comments-batch-*.json"],
        },
      };
      const result = validateManifest(withMetadata, true);
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

    it("should fail when comments coverage status is invalid", () => {
      const invalid = {
        ...validManifest,
        coverage: {
          ...validManifest.coverage,
          comments: {
            status: "unknown",
          },
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
    });

    it("should fail when comments coverage numeric metadata is invalid", () => {
      const invalid = {
        ...validManifest,
        coverage: {
          ...validManifest.coverage,
          comments: {
            status: "partial",
            threads_fetched: -1,
            comments_fetched: "bad",
            prs_with_threads: -3,
            capped: "true",
            extra_field: true,
          },
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("threads_fetched")),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.field.includes("comments_fetched")),
      ).toBe(true);
      expect(result.errors.some((e) => e.field.includes("capped"))).toBe(true);
      expect(result.errors.some((e) => e.field.includes("extra_field"))).toBe(
        true,
      );
    });

    it("should fail when capabilities values are invalid", () => {
      const invalid = {
        ...validManifest,
        capabilities: {
          author_filters: "yes",
          author_repo_exact: true,
          comments_metrics: true,
          reviewer_repository_mode: "approximate",
          reviewer_team_mode: 5,
          cross_dimensional_available: "sometimes",
          extra_field: true,
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("author_filters")),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.field.includes("reviewer_repository_mode")),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.field.includes("reviewer_team_mode")),
      ).toBe(true);
      expect(
        result.errors.some((e) =>
          e.field.includes("cross_dimensional_available"),
        ),
      ).toBe(true);
      expect(result.errors.some((e) => e.field.includes("extra_field"))).toBe(
        true,
      );
    });

    it("should fail when demo_profile values are invalid", () => {
      const invalid = {
        ...validManifest,
        demo_profile: {
          version: 2,
          seed: -1,
          canonical_output_root: 5,
          extra_field: true,
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("demo_profile.name")),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.field.includes("demo_profile.version")),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.field.includes("demo_profile.seed")),
      ).toBe(true);
      expect(
        result.errors.some((e) =>
          e.field.includes("demo_profile.canonical_output_root"),
        ),
      ).toBe(true);
      expect(result.errors.some((e) => e.field.includes("extra_field"))).toBe(
        true,
      );
    });

    it("should fail when published_files arrays contain non-string entries", () => {
      const invalid = {
        ...validManifest,
        published_files: {
          direct: ["dataset-manifest.json", 7],
          globs: "aggregates/*.json",
          extra_field: true,
        },
      };
      const result = validateManifest(invalid, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("published_files.direct")),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.field.includes("published_files.globs")),
      ).toBe(true);
      expect(result.errors.some((e) => e.field.includes("extra_field"))).toBe(
        true,
      );
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

  describe("normalization", () => {
    it("normalizes capabilities metadata to an object default", () => {
      const normalized = normalizeManifest({
        manifest_schema_version: 1,
        dataset_schema_version: 1,
        aggregates_schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        run_id: "test-123",
        aggregate_index: {
          weekly_rollups: [],
          distributions: [],
        },
      });

      expect(normalized.capabilities).toEqual({});
      expect(normalized.demo_profile).toBeUndefined();
      expect(normalized.published_files).toBeUndefined();
    });
  });
});
