/**
 * Version Adapter Integration Tests
 *
 * Tests that legacy datasets load correctly through DatasetLoader.
 * Per guardrails: never call normalizeRollup() directly - only via loader.
 */

import { DatasetLoader } from "../ui/dataset-loader";
import * as fs from "fs";
import * as path from "path";

describe("Version Adapter Integration", () => {
  const fixtureDir = path.join(__dirname, "fixtures", "legacy-datasets");

  beforeEach(() => {
    jest.resetModules();
    (global as any).fetch.mockReset();

    // Configure fetch mock to read fixture files from disk
    // DatasetLoader calls: fetch(baseUrl + '/' + relativePath)
    (global as any).fetch.mockImplementation(async (url: string) => {
      // URL format: fixtureDir/dataset-manifest.json or fixtureDir/v1.0-rollup.json
      // We need to extract the filename from the URL
      let filePath: string;

      // Handle Windows paths with backslashes converted to forward slashes
      const normalizedUrl = url.replace(/\\/g, "/");

      // Get the last path segment(s) - could be just filename or aggregates/dimensions.json
      const fixtureDirNormalized = fixtureDir.replace(/\\/g, "/");

      if (normalizedUrl.startsWith(fixtureDirNormalized)) {
        // Direct fixture path
        filePath = url;
      } else {
        // Try to extract just the filename
        const parts = normalizedUrl.split("/");
        const filename = parts[parts.length - 1];
        filePath = path.join(fixtureDir, filename);
      }

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(content),
        };
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return { ok: false, status: 404, statusText: "Not Found" };
        }
        throw err;
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getWeeklyRollups (synchronous loading)", () => {
    it("normalizes v1.0 rollup (minimal fields)", async () => {
      const loader = new DatasetLoader(fixtureDir);
      await loader.loadManifest();

      const rollups = await loader.getWeeklyRollups(
        new Date("2024-01-01"),
        new Date("2024-01-07"),
      );

      expect(rollups.length).toBe(1);
      const rollup = rollups[0];

      // User-visible behavior: all expected fields exist
      expect(rollup.week).toBe("2024-W01");
      expect(rollup.pr_count).toBe(15);

      // Fields normalized with defaults (not present in v1.0)
      expect(rollup.authors_count).toBe(0);
      expect(rollup.reviewers_count).toBe(0);
      expect(rollup.cycle_time_p50).toBe(null);
      expect(rollup.cycle_time_p90).toBe(null);
      expect(rollup.by_repository).toBe(null);
      expect(rollup.by_team).toBe(null);
    });

    it("normalizes v1.1 rollup (with cycle times)", async () => {
      const loader = new DatasetLoader(fixtureDir);
      await loader.loadManifest();

      const rollups = await loader.getWeeklyRollups(
        new Date("2025-01-01"),
        new Date("2025-01-07"),
      );

      expect(rollups.length).toBe(1);
      const rollup = rollups[0];

      // Preserved fields
      expect(rollup.week).toBe("2025-W01");
      expect(rollup.pr_count).toBe(25);
      expect(rollup.cycle_time_p50).toBe(90);
      expect(rollup.cycle_time_p90).toBe(360);

      // Normalized defaults (not in v1.1)
      expect(rollup.authors_count).toBe(0);
      expect(rollup.reviewers_count).toBe(0);
      expect(rollup.by_repository).toBe(null);
      expect(rollup.by_team).toBe(null);
    });

    it("normalizes v1.2 rollup (with contributors)", async () => {
      const loader = new DatasetLoader(fixtureDir);
      await loader.loadManifest();

      const rollups = await loader.getWeeklyRollups(
        new Date("2025-05-12"),
        new Date("2025-05-18"),
      );

      expect(rollups.length).toBe(1);
      const rollup = rollups[0];

      // All v1.2 fields preserved
      expect(rollup.week).toBe("2025-W20");
      expect(rollup.pr_count).toBe(35);
      expect(rollup.cycle_time_p50).toBe(100);
      expect(rollup.cycle_time_p90).toBe(400);
      expect(rollup.authors_count).toBe(10);
      expect(rollup.reviewers_count).toBe(8);

      // Slices still normalized to null
      expect(rollup.by_repository).toBe(null);
      expect(rollup.by_team).toBe(null);
    });

    it("preserves current schema without data loss", async () => {
      // Mock a current-schema rollup with all fields
      const currentRollup = {
        week: "2026-W01",
        pr_count: 50,
        cycle_time_p50: 120,
        cycle_time_p90: 480,
        authors_count: 12,
        reviewers_count: 9,
        by_repository: { main: { pr_count: 30 } },
        by_team: { Core: { pr_count: 35 } },
      };

      // Override manifest to include current rollup
      (global as any).fetch.mockImplementation(async (url: string) => {
        if (url.includes("manifest")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              manifest_schema_version: 1,
              dataset_schema_version: 1,
              aggregates_schema_version: 1,
              generated_at: "2026-01-14T12:00:00Z",
              run_id: "test-run-123",
              coverage: {
                total_prs: 50,
                date_range: { min: "2026-01-01", max: "2026-01-07" },
              },
              features: {},
              aggregate_index: {
                weekly_rollups: [{ week: "2026-W01", path: "current.json" }],
                distributions: [],
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => currentRollup,
        };
      });

      const loader = new DatasetLoader(fixtureDir);
      await loader.loadManifest();

      const rollups = await loader.getWeeklyRollups(
        new Date("2026-01-01"),
        new Date("2026-01-07"),
      );

      expect(rollups.length).toBe(1);
      const rollup = rollups[0];

      // All fields preserved exactly
      expect(rollup).toEqual(currentRollup);
    });
  });

  describe("getWeeklyRollupsWithProgress (concurrent loading)", () => {
    it("normalizes rollups in concurrent path", async () => {
      const loader = new DatasetLoader(fixtureDir);
      await loader.loadManifest();

      const result = await loader.getWeeklyRollupsWithProgress(
        new Date("2024-01-01"),
        new Date("2024-01-07"),
        { week: "2024-W01", org: "test", project: "test", repo: "test" } as any,
      );

      expect(result.data.length).toBe(1);
      const rollup = result.data[0];

      // Verify normalization happened via concurrent path
      expect(rollup.authors_count).toBe(0);
      expect(rollup.by_team).toBe(null);
    });
  });

  describe("Graceful degradation", () => {
    it("throws SchemaValidationError for malformed rollup data", async () => {
      // Mock a completely malformed rollup - now with schema validation, this throws
      (global as any).fetch.mockImplementation(async (url: string) => {
        if (url.includes("manifest")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              manifest_schema_version: 1,
              dataset_schema_version: 1,
              aggregates_schema_version: 1,
              generated_at: "2024-01-14T12:00:00Z",
              run_id: "test-run-123",
              coverage: {
                total_prs: 1,
                date_range: { min: "2024-01-01", max: "2024-01-07" },
              },
              features: {},
              aggregate_index: {
                weekly_rollups: [{ week: "2024-W01", path: "malformed.json" }],
                distributions: [],
              },
            }),
          };
        }
        // Return malformed data - missing required fields
        return {
          ok: true,
          status: 200,
          json: async () => ({ invalid: true }),
        };
      });

      const loader = new DatasetLoader(fixtureDir);
      await loader.loadManifest();

      // Schema validation now throws for malformed rollups
      await expect(
        loader.getWeeklyRollups(new Date("2024-01-01"), new Date("2024-01-07")),
      ).rejects.toThrow(/Schema validation failed/);
    });
  });
});
