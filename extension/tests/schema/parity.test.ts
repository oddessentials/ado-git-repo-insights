/**
 * Parity Tests
 *
 * Tests that verify schema parity between local fixtures and extension-mode artifacts.
 * Both sources should validate successfully and have matching normalized shapes.
 *
 * @module tests/schema/parity.test.ts
 */

import {
  validateManifest,
  normalizeManifest,
} from "../../ui/schemas/manifest.schema";
import {
  validateRollup,
  normalizeRollup,
} from "../../ui/schemas/rollup.schema";
import {
  validateDimensions,
  normalizeDimensions,
} from "../../ui/schemas/dimensions.schema";
import {
  validatePredictions,
  normalizePredictions,
} from "../../ui/schemas/predictions.schema";

// Local fixtures (from test/fixtures/)
import localManifest from "../fixtures/dataset-manifest.json";
import localDimensions from "../fixtures/aggregates/dimensions.json";
import localRollup from "../fixtures/aggregates/weekly_rollups/2026-W02.json";
import localPredictions from "../fixtures/predictions/trends.json";

// Extension-mode artifacts loaded from extension-artifacts/
// These are captured from actual extension runtime
// Placeholder files have "_placeholder": true and should be treated as null
import extensionManifestRaw from "../fixtures/extension-artifacts/dataset-manifest.json";
import extensionDimensionsRaw from "../fixtures/extension-artifacts/dimensions.json";
import extensionRollupRaw from "../fixtures/extension-artifacts/2026-W03.json";
import extensionPredictionsRaw from "../fixtures/extension-artifacts/predictions.json";

/**
 * Check if artifact is a placeholder (not yet captured).
 */
function isPlaceholder(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === "object" &&
    "_placeholder" in data &&
    (data as Record<string, unknown>)._placeholder === true
  );
}

// Convert placeholders to null for test logic
const extensionManifest = isPlaceholder(extensionManifestRaw)
  ? null
  : extensionManifestRaw;
const extensionDimensions = isPlaceholder(extensionDimensionsRaw)
  ? null
  : extensionDimensionsRaw;
const extensionRollup = isPlaceholder(extensionRollupRaw)
  ? null
  : extensionRollupRaw;
const extensionPredictions = isPlaceholder(extensionPredictionsRaw)
  ? null
  : extensionPredictionsRaw;

describe("Schema Parity Tests", () => {
  describe("Capability Contract", () => {
    it("manifest with roadmap additive capabilities passes strict validation", () => {
      const manifestWithCapabilities = {
        ...localManifest,
        capabilities: {
          author_filters: true,
          author_repo_exact: false,
          comments_metrics: true,
          reviewer_repository_mode: "constrained",
          reviewer_team_mode: "disallowed",
          cross_dimensional_available: false,
        },
      };

      const result = validateManifest(manifestWithCapabilities, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("normalizes capabilities without dropping additive metadata", () => {
      const manifestWithCapabilities = {
        ...localManifest,
        capabilities: {
          author_filters: true,
          author_repo_exact: true,
          comments_metrics: false,
          reviewer_repository_mode: "constrained",
          reviewer_team_mode: "disallowed",
          cross_dimensional_available: true,
        },
      };

      const normalized = normalizeManifest(manifestWithCapabilities);

      expect(normalized.capabilities).toEqual(
        manifestWithCapabilities.capabilities,
      );
    });
  });

  describe("Local Fixtures Validation", () => {
    it("local manifest passes validation", () => {
      const result = validateManifest(localManifest, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("local dimensions passes validation", () => {
      const result = validateDimensions(localDimensions, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("local rollup passes validation", () => {
      const result = validateRollup(localRollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("local predictions passes validation", () => {
      const result = validatePredictions(localPredictions, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Extension Artifacts Validation", () => {
    it("extension manifest passes validation", () => {
      expect(extensionManifest).not.toBeNull();
      const result = validateManifest(extensionManifest, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("extension dimensions passes validation", () => {
      expect(extensionDimensions).not.toBeNull();
      const result = validateDimensions(extensionDimensions, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("extension rollup passes validation", () => {
      expect(extensionRollup).not.toBeNull();
      const result = validateRollup(extensionRollup, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("extension predictions passes validation", () => {
      expect(extensionPredictions).not.toBeNull();
      const result = validatePredictions(extensionPredictions, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Normalized Shape Parity", () => {
    it("normalized manifest has consistent shape between sources", () => {
      expect(extensionManifest).not.toBeNull();
      const localNormalized = normalizeManifest(localManifest);
      const extensionNormalized = normalizeManifest(extensionManifest!);

      // Check that both have the same top-level keys
      const localKeys = Object.keys(localNormalized).sort();
      const extensionKeys = Object.keys(extensionNormalized).sort();
      expect(localKeys).toEqual(extensionKeys);

      // Check that required fields are present in both
      expect(localNormalized).toHaveProperty("manifest_schema_version");
      expect(extensionNormalized).toHaveProperty("manifest_schema_version");
      expect(localNormalized).toHaveProperty("generated_at");
      expect(extensionNormalized).toHaveProperty("generated_at");
    });

    it("normalized dimensions has consistent shape between sources", () => {
      expect(extensionDimensions).not.toBeNull();
      const localNormalized = normalizeDimensions(localDimensions);
      const extensionNormalized = normalizeDimensions(extensionDimensions!);

      // Check that both have the same top-level keys
      const localKeys = Object.keys(localNormalized).sort();
      const extensionKeys = Object.keys(extensionNormalized).sort();
      expect(localKeys).toEqual(extensionKeys);

      // Check array structure consistency
      expect(Array.isArray(localNormalized.repositories)).toBe(true);
      expect(Array.isArray(extensionNormalized.repositories)).toBe(true);
      expect(Array.isArray(localNormalized.users)).toBe(true);
      expect(Array.isArray(extensionNormalized.users)).toBe(true);
    });

    it("normalized rollup has consistent shape between sources", () => {
      expect(extensionRollup).not.toBeNull();
      const localNormalized = normalizeRollup(localRollup);
      const extensionNormalized = normalizeRollup(extensionRollup!);

      // Check that both have required fields
      expect(localNormalized).toHaveProperty("week");
      expect(extensionNormalized).toHaveProperty("week");
      expect(localNormalized).toHaveProperty("pr_count");
      expect(extensionNormalized).toHaveProperty("pr_count");

      // Normalized rollup should have defaults applied
      expect(typeof localNormalized.cycle_time_p50).toBe("number");
      expect(typeof extensionNormalized.cycle_time_p50).toBe("number");
    });

    it("normalized predictions has consistent shape between sources", () => {
      expect(extensionPredictions).not.toBeNull();
      const localNormalized = normalizePredictions(localPredictions);
      const extensionNormalized = normalizePredictions(extensionPredictions!);

      // Check that both have required fields
      expect(localNormalized).toHaveProperty("schema_version");
      expect(extensionNormalized).toHaveProperty("schema_version");
      expect(Array.isArray(localNormalized.forecasts)).toBe(true);
      expect(Array.isArray(extensionNormalized.forecasts)).toBe(true);
    });
  });

  describe("Cross-Source Data Consistency", () => {
    it("manifest schema versions are compatible", () => {
      expect(extensionManifest).not.toBeNull();
      const localNormalized = normalizeManifest(localManifest);
      const extensionNormalized = normalizeManifest(extensionManifest!);

      // Schema versions should match or be compatible
      expect(localNormalized.manifest_schema_version).toBe(
        extensionNormalized.manifest_schema_version,
      );
    });

    it("dimensions entity types are consistent", () => {
      expect(extensionDimensions).not.toBeNull();
      const localNormalized = normalizeDimensions(localDimensions);
      const extensionNormalized = normalizeDimensions(extensionDimensions!);

      // If both have repositories, check structure
      if (
        localNormalized.repositories.length > 0 &&
        extensionNormalized.repositories.length > 0
      ) {
        const localRepoKeys = Object.keys(
          localNormalized.repositories[0],
        ).sort();
        const extensionRepoKeys = Object.keys(
          extensionNormalized.repositories[0],
        ).sort();
        expect(localRepoKeys).toEqual(extensionRepoKeys);
      }
    });
  });

  describe("Fixture Provenance Lock", () => {
    it("extension-artifacts/predictions.json matches canonical generator output", () => {
      // Provenance guard: the extension-artifacts predictions fixture must be
      // derived from the canonical demo generator output. If someone hand-edits
      // the fixture or the generator output changes, this test catches the drift.
      const canonicalPredictions = require("../../../docs/data/predictions/trends.json");

      // Compare by serializing with sorted keys to ignore formatting differences
      const normalize = (obj: unknown) =>
        JSON.stringify(obj, Object.keys(obj as object).sort());
      expect(normalize(extensionPredictionsRaw)).toEqual(
        normalize(canonicalPredictions),
      );
    });
  });
});
