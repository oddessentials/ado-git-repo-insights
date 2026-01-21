/**
 * Golden Fixtures Tests (Phase 4)
 *
 * Tests that golden fixtures load through same code paths as production.
 */

import { DatasetLoader } from "../ui/dataset-loader";
import * as fs from "fs";
import * as path from "path";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

describe("Golden Fixtures", () => {
  describe("Fixture files exist", () => {
    it("has dataset-manifest.json", () => {
      const manifestPath = path.join(FIXTURES_DIR, "dataset-manifest.json");
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it("has dimensions.json", () => {
      const dimPath = path.join(FIXTURES_DIR, "aggregates", "dimensions.json");
      expect(fs.existsSync(dimPath)).toBe(true);
    });

    it("has weekly rollup fixture", () => {
      const rollupPath = path.join(
        FIXTURES_DIR,
        "aggregates",
        "weekly_rollups",
        "2026-W02.json",
      );
      expect(fs.existsSync(rollupPath)).toBe(true);
    });

    it("has predictions fixture", () => {
      const predPath = path.join(FIXTURES_DIR, "predictions", "trends.json");
      expect(fs.existsSync(predPath)).toBe(true);
    });

    it("has insights fixture", () => {
      const insightsPath = path.join(FIXTURES_DIR, "insights", "summary.json");
      expect(fs.existsSync(insightsPath)).toBe(true);
    });
  });

  describe("Fixture schema validation", () => {
    let loader: DatasetLoader;

    beforeEach(() => {
      loader = new DatasetLoader("");
    });

    it("manifest has required schema versions", () => {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES_DIR, "dataset-manifest.json"),
          "utf8",
        ),
      );

      expect(manifest.manifest_schema_version).toBe(1);
      expect(manifest.dataset_schema_version).toBe(1);
      expect(manifest.aggregates_schema_version).toBe(1);
    });

    it("manifest has required feature flags", () => {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES_DIR, "dataset-manifest.json"),
          "utf8",
        ),
      );

      expect(manifest.features).toBeDefined();
      expect(typeof manifest.features.predictions).toBe("boolean");
      expect(typeof manifest.features.ai_insights).toBe("boolean");
    });

    it("predictions fixture passes schema validation", () => {
      const predictions = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES_DIR, "predictions", "trends.json"),
          "utf8",
        ),
      );

      const result = (loader as any).validatePredictionsSchema(predictions);
      expect(result.valid).toBe(true);
    });

    it("insights fixture passes schema validation", () => {
      const insights = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES_DIR, "insights", "summary.json"),
          "utf8",
        ),
      );

      const result = (loader as any).validateInsightsSchema(insights);
      expect(result.valid).toBe(true);
    });
  });

  describe("Fixture content validation", () => {
    it("weekly rollup has expected structure", () => {
      const rollup = JSON.parse(
        fs.readFileSync(
          path.join(
            FIXTURES_DIR,
            "aggregates",
            "weekly_rollups",
            "2026-W02.json",
          ),
          "utf8",
        ),
      );

      expect(rollup.week).toBe("2026-W02");
      expect(rollup.pr_count).toBeGreaterThan(0);
      expect(rollup.cycle_time_p50).toBeDefined();
      expect(rollup.cycle_time_p90).toBeDefined();
    });

    it("dimensions has filter values", () => {
      const dimensions = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES_DIR, "aggregates", "dimensions.json"),
          "utf8",
        ),
      );

      expect(dimensions.repositories).toBeDefined();
      expect(Array.isArray(dimensions.repositories)).toBe(true);
      expect(dimensions.users).toBeDefined();
      expect(dimensions.teams).toBeDefined();
    });

    it("predictions has forecasts array", () => {
      const predictions = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES_DIR, "predictions", "trends.json"),
          "utf8",
        ),
      );

      expect(Array.isArray(predictions.forecasts)).toBe(true);
      expect(predictions.forecasts.length).toBeGreaterThan(0);
      expect(predictions.is_stub).toBe(true);
    });

    it("insights has all severity levels", () => {
      const insights = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES_DIR, "insights", "summary.json"),
          "utf8",
        ),
      );

      const severities = insights.insights.map((i: any) => i.severity);
      expect(severities).toContain("info");
      expect(severities).toContain("warning");
      expect(severities).toContain("critical");
    });
  });
});
