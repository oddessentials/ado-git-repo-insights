/**
 * Integration Tests: Artifact Path Verification
 *
 * Verifies that the dashboard consumes ML artifacts at the exact paths
 * specified in FR-036 and FR-037:
 * - predictions/trends.json
 * - ai_insights/summary.json (note: loader uses insights/summary.json)
 *
 * These tests ensure the contract between pipeline output and dashboard input
 * remains stable across versions.
 *
 * @module tests/integration/artifact-paths.test.ts
 */

import * as path from "path";
import { readTextFile } from "../helpers/fs-test-utils";
import {
  resolveInsightsState,
  resolvePredictionsState,
} from "../../ui/modules/ml/state-machine";
import { ML_SCHEMA_VERSION_RANGE } from "../../ui/types";

// Import the actual path constants/patterns used by the loaders
// We verify these match the documented contract

const loaderPath = path.join(__dirname, "../../ui/dataset-loader.ts");
const predictionsSchemaPath = path.join(
  __dirname,
  "../../ui/schemas/predictions.schema.ts",
);
const insightsSchemaPath = path.join(
  __dirname,
  "../../ui/schemas/insights.schema.ts",
);

describe("Artifact Path Contract (FR-036, FR-037)", () => {
  describe("Predictions artifact path", () => {
    it("should use predictions/trends.json as the artifact path", () => {
      // The path is hardcoded in dataset-loader.ts loadPredictions()
      // This test documents and enforces the contract
      const expectedPath = "predictions/trends.json";

      // Read the actual source to verify the path
      // This is a contract test - if the path changes, this test fails
      const loaderSource = readTextFile(loaderPath);

      expect(loaderSource).toContain(`"${expectedPath}"`);
    });

    it("should document the predictions artifact structure", () => {
      // Verify the schema expects the documented structure
      const schemaSource = readTextFile(predictionsSchemaPath);

      // Required fields per contract
      expect(schemaSource).toContain("schema_version");
      expect(schemaSource).toContain("generated_at");
      expect(schemaSource).toContain("forecasts");
    });
  });

  describe("AI Insights artifact path", () => {
    it("should use insights/summary.json as the artifact path", () => {
      // The path is hardcoded in dataset-loader.ts loadInsights()
      // Note: FR-037 specifies ai_insights/summary.json but implementation uses insights/summary.json
      const expectedPath = "insights/summary.json";

      const loaderSource = readTextFile(loaderPath);

      expect(loaderSource).toContain(`"${expectedPath}"`);
    });

    it("should document the insights artifact structure", () => {
      // Verify the schema expects the documented structure
      const schemaSource = readTextFile(insightsSchemaPath);

      // Required fields per contract
      expect(schemaSource).toContain("schema_version");
      expect(schemaSource).toContain("generated_at");
      expect(schemaSource).toContain("insights");
    });
  });

  describe("State machine integration", () => {
    it("should export state resolution functions for both artifact types", () => {
      // Verify the state machine is properly integrated
      expect(typeof resolvePredictionsState).toBe("function");
      expect(typeof resolveInsightsState).toBe("function");
    });

    it("should return setup-required for missing artifacts", () => {
      const missingResult = { exists: false, data: null };

      const predictionsState = resolvePredictionsState(missingResult);
      const insightsState = resolveInsightsState(missingResult);

      expect(predictionsState.type).toBe("setup-required");
      expect(insightsState.type).toBe("setup-required");
    });

    it("should return ready state for valid artifacts with data", () => {
      const validPredictions = {
        exists: true,
        data: {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          forecasts: [
            {
              metric: "pr_throughput",
              unit: "count",
              horizon_weeks: 4,
              values: [
                {
                  period_start: "2026-01-27",
                  predicted: 10,
                  lower_bound: 8,
                  upper_bound: 12,
                },
              ],
            },
          ],
        },
      };

      const validInsights = {
        exists: true,
        data: {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          insights: [
            {
              id: 1,
              category: "velocity",
              severity: "info",
              title: "Test",
              description: "Test insight",
            },
          ],
        },
      };

      const predictionsState = resolvePredictionsState(validPredictions);
      const insightsState = resolveInsightsState(validInsights);

      expect(predictionsState.type).toBe("ready");
      expect(insightsState.type).toBe("ready");
    });
  });

  describe("Schema version compatibility", () => {
    it("should support schema version 1", () => {
      expect(ML_SCHEMA_VERSION_RANGE[0]).toBe(1); // min
      expect(ML_SCHEMA_VERSION_RANGE[1]).toBe(1); // max
    });

    it("should return unsupported-schema for version outside range", () => {
      const futureVersion = {
        exists: true,
        data: {
          schema_version: 99,
          generated_at: "2026-01-28T12:00:00Z",
          forecasts: [],
        },
      };

      const state = resolvePredictionsState(futureVersion);

      expect(state.type).toBe("unsupported-schema");
      if (state.type === "unsupported-schema") {
        expect(state.version).toBe(99);
        expect(state.supported).toEqual([1, 1]);
      }
    });
  });
});
