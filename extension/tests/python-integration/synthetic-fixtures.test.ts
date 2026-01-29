/**
 * Consumer-side validation tests for synthetic fixtures.
 *
 * Ensures generated datasets can be loaded by the extension UI.
 */

import { DatasetLoader } from "../../ui/dataset-loader";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { resolveInside } from "../../tasks/_shared/safe-path";

describe("Synthetic Fixture Consumer Validation", () => {
  let fixtureDir: string;

  beforeAll(() => {
    // Create temp directory for fixtures
    fixtureDir = path.join(__dirname, "..", "..", "..", "tmp", "test-fixtures");
    ensureDir(fixtureDir);
  });

  beforeEach(() => {
    // Configure fetch mock to read file:// URLs from disk
    (global as any).fetch.mockImplementation(async (url: string) => {
      if (url.startsWith("file://")) {
        const filePath = url.replace("file://", "");
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
      }
      // Non-file URLs return 404 by default
      return { ok: false, status: 404, statusText: "Not Found" };
    });
  });

  /**
   * Generate a synthetic fixture on-demand.
   * SECURITY: Uses safe path resolution and validated numeric inputs.
   */
  function generateFixture(prCount: number, seed = 42): string {
    // SECURITY: Validate numeric inputs before passing to command
    if (!Number.isSafeInteger(prCount) || prCount < 1 || prCount > 1000000) {
      throw new Error(`Invalid prCount: ${prCount}`);
    }
    if (
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(`Invalid seed: ${seed}`);
    }

    // SECURITY: Use resolveInside to prevent path traversal
    const outputDir = resolveInside(fixtureDir, `${prCount}pr-seed${seed}`);

    // Skip if already generated
    if (fs.existsSync(resolveInside(outputDir, "dataset-manifest.json"))) {
      return outputDir;
    }

    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "scripts",
      "generate-synthetic-dataset.py",
    );

    try {
      // SECURITY: Use args array pattern with validated inputs
      execSync(
        `python "${scriptPath}" --pr-count ${String(prCount)} --seed ${String(seed)} --output "${outputDir}"`,
        { stdio: "pipe" },
      );
    } catch (error: any) {
      throw new Error(`Failed to generate fixture: ${error.message}`);
    }

    return outputDir;
  }

  function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  test("1000 PR fixture passes loadManifest validation", async () => {
    const fixturePath = generateFixture(1000, 42);
    const baseUrl = `file://${fixturePath}`;

    const loader = new DatasetLoader(baseUrl);

    // Should not throw
    await expect(loader.loadManifest()).resolves.toBeDefined();
  });

  test("generated manifest has correct schema versions", async () => {
    const fixturePath = generateFixture(1000, 42);
    const manifestPath = path.join(fixturePath, "dataset-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.manifest_schema_version).toBe(1);
    expect(manifest.dataset_schema_version).toBe(1);
    expect(manifest.aggregates_schema_version).toBe(1);
  });

  test("generated rollups load successfully", async () => {
    const fixturePath = generateFixture(1000, 42);
    const baseUrl = `file://${fixturePath}`;

    const loader = new DatasetLoader(baseUrl);
    await loader.loadManifest();

    // Get first rollup entry
    const manifest = (loader as any).manifest;
    expect(manifest.aggregate_index.weekly_rollups.length).toBeGreaterThan(0);

    const rollupEntry = manifest.aggregate_index.weekly_rollups[0];
    const rollupPath = path.join(fixturePath, rollupEntry.path);

    expect(fs.existsSync(rollupPath)).toBe(true);

    const rollupData = JSON.parse(fs.readFileSync(rollupPath, "utf-8"));

    // Validate structure
    expect(rollupData).toHaveProperty("week");
    expect(rollupData).toHaveProperty("pr_count");
    expect(rollupData).toHaveProperty("cycle_time_p50");
  });

  test("generated dimensions load successfully", async () => {
    const fixturePath = generateFixture(1000, 42);
    const baseUrl = `file://${fixturePath}`;

    const loader = new DatasetLoader(baseUrl);
    await loader.loadManifest();

    const dimensions = await loader.loadDimensions();

    expect(dimensions).toHaveProperty("repositories");
    expect(dimensions).toHaveProperty("users");
    expect(dimensions).toHaveProperty("projects");
    expect(dimensions).toHaveProperty("date_range");

    expect(Array.isArray(dimensions.repositories)).toBe(true);
    expect(Array.isArray(dimensions.users)).toBe(true);
  });

  test("5k PR fixture generates successfully", async () => {
    const fixturePath = generateFixture(5000, 42);
    const manifestPath = path.join(fixturePath, "dataset-manifest.json");

    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.coverage.total_prs).toBe(5000);
  });

  test("10k PR fixture generates successfully", async () => {
    const fixturePath = generateFixture(10000, 42);
    const manifestPath = path.join(fixturePath, "dataset-manifest.json");

    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.coverage.total_prs).toBe(10000);
  });

  test("deterministic generation: same seed produces identical manifest structure", async () => {
    const fixture1 = generateFixture(1000, 999);
    const fixture2 = generateFixture(1000, 999);

    const manifest1 = JSON.parse(
      fs.readFileSync(path.join(fixture1, "dataset-manifest.json"), "utf-8"),
    );
    const manifest2 = JSON.parse(
      fs.readFileSync(path.join(fixture2, "dataset-manifest.json"), "utf-8"),
    );

    // Exclude generated_at timestamp
    delete manifest1.generated_at;
    delete manifest2.generated_at;

    expect(manifest1).toEqual(manifest2);
  });
});
