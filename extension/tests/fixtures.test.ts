/**
 * Golden Fixtures Tests (Phase 4)
 *
 * Tests that golden fixtures load through same code paths as production.
 */

import { DatasetLoader } from "../ui/dataset-loader";
import * as path from "path";
import { pathExists, readJsonFile } from "./helpers/fs-test-utils";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

class TestDatasetLoader extends DatasetLoader {
  public validatePredictionsSchemaForTest(predictions: unknown) {
    return this.validatePredictionsSchema(predictions);
  }

  public validateInsightsSchemaForTest(insights: unknown) {
    return this.validateInsightsSchema(insights);
  }
}

describe("Golden Fixtures", () => {
  describe("Fixture files exist", () => {
    it("has dataset-manifest.json", () => {
      const manifestPath = path.join(FIXTURES_DIR, "dataset-manifest.json");
      expect(pathExists(manifestPath)).toBe(true);
    });

    it("has dimensions.json", () => {
      const dimPath = path.join(FIXTURES_DIR, "aggregates", "dimensions.json");
      expect(pathExists(dimPath)).toBe(true);
    });

    it("has weekly rollup fixture", () => {
      const rollupPath = path.join(
        FIXTURES_DIR,
        "aggregates",
        "weekly_rollups",
        "2026-W02.json",
      );
      expect(pathExists(rollupPath)).toBe(true);
    });

    it("has predictions fixture", () => {
      const predPath = path.join(FIXTURES_DIR, "predictions", "trends.json");
      expect(pathExists(predPath)).toBe(true);
    });

    it("has insights fixture", () => {
      const insightsPath = path.join(FIXTURES_DIR, "insights", "summary.json");
      expect(pathExists(insightsPath)).toBe(true);
    });
  });

  describe("Fixture schema validation", () => {
    let loader: TestDatasetLoader;

    beforeEach(() => {
      loader = new TestDatasetLoader("");
    });

    it("manifest has required schema versions", () => {
      const manifest = readJsonFile<{
        manifest_schema_version: number;
        dataset_schema_version: number;
        aggregates_schema_version: number;
      }>(path.join(FIXTURES_DIR, "dataset-manifest.json"));

      expect(manifest.manifest_schema_version).toBe(1);
      expect(manifest.dataset_schema_version).toBe(1);
      expect(manifest.aggregates_schema_version).toBe(1);
    });

    it("manifest has required feature flags", () => {
      const manifest = readJsonFile<{
        features: { predictions: boolean; ai_insights: boolean };
      }>(path.join(FIXTURES_DIR, "dataset-manifest.json"));

      expect(manifest.features).toBeDefined();
      expect(typeof manifest.features.predictions).toBe("boolean");
      expect(typeof manifest.features.ai_insights).toBe("boolean");
    });

    it("predictions fixture passes schema validation", () => {
      const predictions = readJsonFile<unknown>(
        path.join(FIXTURES_DIR, "predictions", "trends.json"),
      );

      const result = loader.validatePredictionsSchemaForTest(predictions);
      expect(result.valid).toBe(true);
    });

    it("insights fixture passes schema validation", () => {
      const insights = readJsonFile<unknown>(
        path.join(FIXTURES_DIR, "insights", "summary.json"),
      );

      const result = loader.validateInsightsSchemaForTest(insights);
      expect(result.valid).toBe(true);
    });
  });

  describe("Fixture content validation", () => {
    it("weekly rollup has expected structure", () => {
      const rollup = readJsonFile<{
        week: string;
        pr_count: number;
        cycle_time_p50: number | null;
        cycle_time_p90: number | null;
      }>(
        path.join(
          FIXTURES_DIR,
          "aggregates",
          "weekly_rollups",
          "2026-W02.json",
        ),
      );

      expect(rollup.week).toBe("2026-W02");
      expect(rollup.pr_count).toBeGreaterThan(0);
      expect(rollup.cycle_time_p50).toBeDefined();
      expect(rollup.cycle_time_p90).toBeDefined();
    });

    it("dimensions has filter values", () => {
      const dimensions = readJsonFile<{
        repositories: unknown[];
        users: unknown[];
        teams: unknown[];
      }>(path.join(FIXTURES_DIR, "aggregates", "dimensions.json"));

      expect(dimensions.repositories).toBeDefined();
      expect(Array.isArray(dimensions.repositories)).toBe(true);
      expect(dimensions.users).toBeDefined();
      expect(dimensions.teams).toBeDefined();
    });

    it("predictions has forecasts array", () => {
      const predictions = readJsonFile<{
        forecasts: unknown[];
        is_stub: boolean;
      }>(path.join(FIXTURES_DIR, "predictions", "trends.json"));

      expect(Array.isArray(predictions.forecasts)).toBe(true);
      expect(predictions.forecasts.length).toBeGreaterThan(0);
      expect(predictions.is_stub).toBe(true);
    });

    it("insights has all severity levels", () => {
      const insights = readJsonFile<{
        insights: Array<{ severity: string }>;
      }>(path.join(FIXTURES_DIR, "insights", "summary.json"));

      const severities = insights.insights.map((insight) => insight.severity);
      expect(severities).toContain("info");
      expect(severities).toContain("warning");
      expect(severities).toContain("critical");
    });
  });
});
