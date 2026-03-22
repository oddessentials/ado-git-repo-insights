/**
 * Dimensions Schema Tests
 *
 * Tests for dimensions.json schema validation.
 * Dimensions uses STRICT mode - unknown fields cause errors.
 * Supports both production format (snake_case) and legacy format (camelCase).
 *
 * @module tests/schema/dimensions.test.ts
 */

import {
  normalizeDimensions,
  validateDimensions,
} from "../../ui/schemas/dimensions.schema";
import type { ValidationResult } from "../../ui/schemas/types";

// Load the actual fixture for valid data tests (production format)
import validDimensions from "../fixtures/aggregates/dimensions.json";

describe("Dimensions Schema Validator", () => {
  describe("valid data - production format", () => {
    it("should pass validation for the fixture file", () => {
      const result: ValidationResult = validateDimensions(
        validDimensions,
        true,
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation with minimal required fields", () => {
      const minimal = {
        repositories: [],
        users: [],
        projects: [],
      };
      const result = validateDimensions(minimal, true);
      expect(result.valid).toBe(true);
    });

    it("should pass with production format entities", () => {
      const productionFormat = {
        repositories: [
          {
            repository_id: "repo-1",
            repository_name: "main-repo",
            organization_name: "test-org",
            project_name: "test-project",
          },
        ],
        users: [{ user_id: "user-1", display_name: "Alice Developer" }],
        reviewers: [
          { reviewer_id: "reviewer-1", reviewer_name: "Rita Reviewer" },
        ],
        projects: [
          { organization_name: "test-org", project_name: "test-project" },
        ],
        teams: [],
        date_range: {
          min: "2025-01-01",
          max: "2026-01-14",
        },
      };
      const result = validateDimensions(productionFormat, true);
      expect(result.valid).toBe(true);
    });

    it("should pass with valid author entries", () => {
      const withAuthors = {
        repositories: [],
        users: [],
        authors: [{ author_id: "author-1", author_name: "Alice Author" }],
        projects: [],
      };
      const result = validateDimensions(withAuthors, true);
      expect(result.valid).toBe(true);
    });

    it("should fail when author item is missing author_name", () => {
      const invalid = {
        repositories: [],
        users: [],
        authors: [{ author_id: "author-1" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("author_name"))).toBe(
        true,
      );
    });

    it("should fail when author item is not an object", () => {
      const invalid = {
        repositories: [],
        users: [],
        authors: ["author-1"],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "authors[0]")).toBe(true);
    });

    it("should fail when author item contains unknown fields in strict mode", () => {
      const invalid = {
        repositories: [],
        users: [],
        authors: [
          {
            author_id: "author-1",
            author_name: "Alice Author",
            extra_field: true,
          },
        ],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("extra_field"))).toBe(
        true,
      );
    });

    it("should fail when reviewer item is missing reviewer_name", () => {
      const invalid = {
        repositories: [],
        users: [],
        reviewers: [{ reviewer_id: "reviewer-1" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("reviewer_name"))).toBe(
        true,
      );
    });

    it("should fail when reviewer item is missing reviewer_id", () => {
      const invalid = {
        repositories: [],
        users: [],
        reviewers: [{ reviewer_name: "Rita Reviewer" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("reviewer_id"))).toBe(
        true,
      );
    });

    it("should fail when reviewers is not an array", () => {
      const invalid = {
        repositories: [],
        users: [],
        reviewers: { reviewer_id: "reviewer-1", reviewer_name: "Rita Reviewer" },
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "reviewers")).toBe(true);
    });

    it("should fail when reviewer item contains unknown fields in strict mode", () => {
      const invalid = {
        repositories: [],
        users: [],
        reviewers: [
          {
            reviewer_id: "reviewer-1",
            reviewer_name: "Rita Reviewer",
            extra_field: true,
          },
        ],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("extra_field"))).toBe(
        true,
      );
    });

    it("should fail when reviewer item is not an object", () => {
      const invalid = {
        repositories: [],
        users: [],
        reviewers: ["reviewer-1"],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "reviewers[0]")).toBe(true);
    });
  });

  describe("valid data - legacy format", () => {
    it("should pass with legacy format repositories", () => {
      const legacyFormat = {
        repositories: [
          { id: "repo-1", name: "main-repo", project: "test-project" },
        ],
        users: [
          { id: "user-1", displayName: "Alice", uniqueName: "alice@test.com" },
        ],
        projects: [{ id: "proj-1", name: "test-project" }],
        teams: [{ id: "team-1", name: "Backend" }],
        date_range: {
          min: "2025-01-01",
          max: "2026-01-14",
        },
      };
      const result = validateDimensions(legacyFormat, true);
      expect(result.valid).toBe(true);
    });
  });

  describe("missing required fields", () => {
    it("should fail when repositories is missing", () => {
      const invalid = { users: [], projects: [] };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("repositories"))).toBe(
        true,
      );
    });

    it("should fail when users is missing", () => {
      const invalid = { repositories: [], projects: [] };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("users"))).toBe(true);
    });

    it("should fail when projects is missing", () => {
      const invalid = { repositories: [], users: [] };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("projects"))).toBe(
        true,
      );
    });
  });

  describe("array item validation - repositories (production format)", () => {
    it("should fail when repository item is missing repository_id", () => {
      const invalid = {
        repositories: [
          {
            repository_name: "repo",
            organization_name: "org",
            project_name: "proj",
          },
        ],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("repository_id"))).toBe(
        true,
      );
    });

    it("should fail when repository item is missing repository_name", () => {
      const invalid = {
        repositories: [
          {
            repository_id: "repo-1",
            organization_name: "org",
            project_name: "proj",
          },
        ],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("repository_name")),
      ).toBe(true);
    });

    it("should fail when repository_id is not a string", () => {
      const invalid = {
        repositories: [
          {
            repository_id: 123,
            repository_name: "repo",
            organization_name: "org",
            project_name: "proj",
          },
        ],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
    });
  });

  describe("array item validation - repositories (legacy format)", () => {
    it("should fail when repository item is missing id (legacy)", () => {
      const invalid = {
        repositories: [{ name: "repo-without-id" }],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("id"))).toBe(true);
    });

    it("should fail when repository item is missing name (legacy)", () => {
      const invalid = {
        repositories: [{ id: "repo-without-name" }],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("name"))).toBe(true);
    });

    it("should fail when repository item is an empty object", () => {
      const invalid = {
        repositories: [{}],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "repositories[0]")).toBe(
        true,
      );
    });
  });

  describe("array item validation - users (production format)", () => {
    it("should fail when user item is missing user_id", () => {
      const invalid = {
        repositories: [],
        users: [{ display_name: "No ID User" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("user_id"))).toBe(true);
    });

    it("should fail when user item is missing display_name", () => {
      const invalid = {
        repositories: [],
        users: [{ user_id: "user-1" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("display_name"))).toBe(
        true,
      );
    });
  });

  describe("array item validation - users (legacy format)", () => {
    it("should fail when user item is missing id (legacy)", () => {
      const invalid = {
        repositories: [],
        users: [{ displayName: "No ID User", uniqueName: "noid@test.com" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("id"))).toBe(true);
    });

    it("should fail when user item is missing displayName (legacy)", () => {
      const invalid = {
        repositories: [],
        users: [{ id: "user-1", uniqueName: "user@test.com" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("displayName"))).toBe(
        true,
      );
    });

    it("should fail when user item is missing uniqueName (legacy)", () => {
      const invalid = {
        repositories: [],
        users: [{ id: "user-1", displayName: "User One" }],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("uniqueName"))).toBe(
        true,
      );
    });

    it("should fail when user item is an empty object", () => {
      const invalid = {
        repositories: [],
        users: [{}],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "users[0]")).toBe(true);
    });
  });

  describe("array item validation - projects (production format)", () => {
    it("should fail when project item is missing organization_name", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [{ project_name: "project-without-org" }],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field.includes("organization_name")),
      ).toBe(true);
    });

    it("should fail when project item is missing project_name", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [{ organization_name: "org-without-project" }],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("project_name"))).toBe(
        true,
      );
    });
  });

  describe("array item validation - projects (legacy format)", () => {
    it("should fail when project item is missing id (legacy)", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [{ name: "project-without-id" }],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("id"))).toBe(true);
    });

    it("should fail when project item is missing name (legacy)", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [{ id: "proj-without-name" }],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("name"))).toBe(true);
    });

    it("should fail when project item is an empty object", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [{}],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "projects[0]")).toBe(true);
    });
  });

  describe("array item validation - teams (optional)", () => {
    it("should pass when teams is not present", () => {
      const withoutTeams = {
        repositories: [],
        users: [],
        projects: [],
      };
      const result = validateDimensions(withoutTeams, true);
      expect(result.valid).toBe(true);
    });

    it("should pass when teams is empty array", () => {
      const emptyTeams = {
        repositories: [],
        users: [],
        projects: [],
        teams: [],
      };
      const result = validateDimensions(emptyTeams, true);
      expect(result.valid).toBe(true);
    });

    it("should pass with valid team entry", () => {
      const withTeam = {
        repositories: [],
        users: [],
        projects: [],
        teams: [{ id: "team-1", name: "Backend Team" }],
      };
      const result = validateDimensions(withTeam, true);
      expect(result.valid).toBe(true);
    });

    it("should fail when teams is not an array", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [],
        teams: { id: "team-1" },
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "teams")).toBe(true);
    });

    it("should fail when team entry is not an object", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [],
        teams: ["team-1"],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "teams[0]")).toBe(true);
    });
  });

  describe("date_range validation", () => {
    it("should pass when date_range is not present", () => {
      const withoutDateRange = {
        repositories: [],
        users: [],
        projects: [],
      };
      const result = validateDimensions(withoutDateRange, true);
      expect(result.valid).toBe(true);
    });

    it("should fail when date_range.min is not ISO date format", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [],
        date_range: {
          min: "01-01-2025",
          max: "2026-01-14",
        },
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("min"))).toBe(true);
    });

    it("should fail when date_range.max is not ISO date format", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [],
        date_range: {
          min: "2025-01-01",
          max: "January 14, 2026",
        },
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
    });

    it("should fail when date_range is not an object", () => {
      const invalid = {
        repositories: [],
        users: [],
        projects: [],
        date_range: "2025-01-01",
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "date_range")).toBe(true);
    });
  });

  describe("strict mode (unknown fields)", () => {
    it("should FAIL in strict mode when unknown fields are present at root", () => {
      const withUnknown = {
        repositories: [],
        users: [],
        projects: [],
        unknown_field: "should cause error",
      };
      const result = validateDimensions(withUnknown, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("unknown_field"))).toBe(
        true,
      );
    });

    it("should WARN in permissive mode when unknown fields are present", () => {
      const withUnknown = {
        repositories: [],
        users: [],
        projects: [],
        unknown_field: "should warn only",
      };
      const result = validateDimensions(withUnknown, false);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should fail in strict mode when unknown field in repository item", () => {
      const invalid = {
        repositories: [
          {
            repository_id: "repo-1",
            repository_name: "repo",
            organization_name: "org",
            project_name: "proj",
            extra_field: "not allowed",
          },
        ],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("extra_field"))).toBe(
        true,
      );
    });
  });

  describe("empty JSON handling", () => {
    it("should fail with missing required field error for empty object", () => {
      const result = validateDimensions({}, true);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("required");
    });

    it("should fail for null input", () => {
      const result = validateDimensions(null, true);
      expect(result.valid).toBe(false);
    });

    it("should fail for array input (not object)", () => {
      const result = validateDimensions([], true);
      expect(result.valid).toBe(false);
    });
  });

  describe("recursive nested validation", () => {
    it("should validate all items in repositories array (production format)", () => {
      const invalid = {
        repositories: [
          {
            repository_id: "repo-1",
            repository_name: "valid",
            organization_name: "org",
            project_name: "proj",
          },
          {
            repository_id: "repo-2",
            organization_name: "org",
            project_name: "proj",
          }, // missing repository_name
          {
            repository_name: "also-invalid",
            organization_name: "org",
            project_name: "proj",
          }, // missing repository_id
        ],
        users: [],
        projects: [],
      };
      const result = validateDimensions(invalid, true);
      expect(result.valid).toBe(false);
      // Should have errors for both invalid items
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("normalization", () => {
    it("defaults optional reviewer and team arrays when absent", () => {
      const normalized = normalizeDimensions({
        repositories: [],
        users: [],
        projects: [],
      });

      expect(normalized.reviewers).toEqual([]);
      expect(normalized.authors).toEqual([]);
      expect(normalized.teams).toEqual([]);
      expect(normalized.date_range).toBeUndefined();
    });
  });
});
