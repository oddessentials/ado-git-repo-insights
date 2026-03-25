/**
 * Consumer-side validation tests for synthetic fixtures.
 *
 * Ensures generated datasets can be loaded by the extension UI.
 */

import { DatasetLoader } from "../../ui/dataset-loader";
import * as path from "path";
import { resolveInside } from "../../tasks/_shared/safe-path";
import {
  ensureDir,
  pathExists,
  readDir,
  readJsonFile,
  readTextFile,
} from "../helpers/fs-test-utils";
import {
  assertPythonSubprocessSupport,
  probePythonSubprocessSupport,
  runPythonScript,
} from "./python-subprocess";

type FixtureAggregateIndex = {
  weekly_rollups: Array<{ path: string }>;
};

type FixtureManifest = {
  manifest_schema_version: number;
  dataset_schema_version: number;
  aggregates_schema_version: number;
  aggregate_index: FixtureAggregateIndex;
  coverage: { total_prs: number };
  generated_at?: string;
};

type RollupEntry = {
  pr_count: number;
};

type FixtureRollup = {
  week: string;
  pr_count: number;
  cycle_time_p50: number | null;
  cycle_time_p90: number | null;
  authors_count: number;
  reviewers_count: number;
  by_repository: Record<string, RollupEntry> | null;
  by_team?: Record<string, RollupEntry> | null;
  by_team_and_repo?: Record<string, Record<string, RollupEntry>>;
};

class TestDatasetLoader extends DatasetLoader {
  public getManifestForTest(): unknown {
    return this.manifest;
  }
}

const testGlobal = global as typeof globalThis & {
  fetch: { mockImplementation: (impl: (url: string) => Promise<Response>) => void };
};

const pythonSubprocessSupport = probePythonSubprocessSupport();
const syntheticFixtureTest = pythonSubprocessSupport.supported
  ? test
  : test.skip;
const syntheticFixtureIt = pythonSubprocessSupport.supported ? it : it.skip;

describe("Synthetic Fixture Consumer Validation", () => {
  let fixtureDir: string;

  beforeAll(() => {
    assertPythonSubprocessSupport("Synthetic Fixture Consumer Validation");

    // Create temp directory for fixtures
    fixtureDir = path.join(__dirname, "..", "..", "..", "tmp", "test-fixtures");
    ensureDir(fixtureDir);
  });

  beforeEach(() => {
    // Configure fetch mock to read file:// URLs from disk
    testGlobal.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith("file://")) {
        const filePath = url.replace("file://", "");
        try {
          const content = readTextFile(filePath);
          return {
            ok: true,
            status: 200,
            json: async () => JSON.parse(content),
          } as Response;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { ok: false, status: 404, statusText: "Not Found" } as Response;
          }
          throw error;
        }
      }
      // Non-file URLs return 404 by default
      return { ok: false, status: 404, statusText: "Not Found" } as Response;
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
    if (pathExists(resolveInside(outputDir, "dataset-manifest.json"))) {
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
      // SECURITY: Use direct process execution with args array to prevent command injection.
      // Inputs are already validated above (isSafeInteger guards).
      runPythonScript(scriptPath, [
        "--pr-count",
        String(prCount),
        "--seed",
        String(seed),
        "--output",
        outputDir,
      ]);
    } catch (error) {
      const wrappedError = new Error(
        `Failed to generate fixture: ${error instanceof Error ? error.message : String(error)}`,
      );
      (wrappedError as Error & { cause?: unknown }).cause = error;
      throw wrappedError;
    }

    return outputDir;
  }

  syntheticFixtureTest(
    "every generated fixture rollup contains all required Rollup-compatible fields",
    () => {
      // Prove the FixtureRollup type contract against actual data, not generator source.
      // If the Python generator ever drops a field, this fails with a clear message —
      // not a cryptic TS2739 deep in a filter function.
      const requiredFields = [
        "week",
        "pr_count",
        "cycle_time_p50",
        "cycle_time_p90",
        "authors_count",
        "reviewers_count",
        "by_repository",
      ];
      const outputDir = generateFixture(100, 42);
      const manifestPath = path.join(outputDir, "dataset-manifest.json");
      const manifest = readJsonFile<FixtureManifest>(manifestPath);
      const rollupEntries = manifest.aggregate_index.weekly_rollups;
      expect(rollupEntries.length).toBeGreaterThan(0);

      for (const entry of rollupEntries) {
        const rollupPath = path.join(outputDir, entry.path);
        const rollup = readJsonFile<Record<string, unknown>>(rollupPath);
        for (const field of requiredFields) {
          expect(rollup).toHaveProperty(field);
        }
      }
    },
  );

  syntheticFixtureTest(
    "1000 PR fixture passes loadManifest validation",
    async () => {
      const fixturePath = generateFixture(1000, 42);
      const baseUrl = `file://${fixturePath}`;

      const loader = new TestDatasetLoader(baseUrl);

      // Should not throw
      const manifest = await loader.loadManifest();
      expect(manifest).toBeDefined();
      expect(manifest.manifest_schema_version).toBe(1);
      expect(manifest.aggregates_schema_version).toBe(2);
      expect(manifest.aggregate_index.weekly_rollups).toBeInstanceOf(Array);
      expect(manifest.aggregate_index.weekly_rollups.length).toBeGreaterThan(0);
    },
  );

  syntheticFixtureTest(
    "generated manifest has correct schema versions",
    async () => {
      const fixturePath = generateFixture(1000, 42);
      const manifestPath = path.join(fixturePath, "dataset-manifest.json");
      const manifest = readJsonFile<FixtureManifest>(manifestPath);

      expect(manifest.manifest_schema_version).toBe(1);
      expect(manifest.dataset_schema_version).toBe(1);
      expect(manifest.aggregates_schema_version).toBe(2);
    },
  );

  syntheticFixtureTest("generated rollups load successfully", async () => {
    const fixturePath = generateFixture(1000, 42);
    const baseUrl = `file://${fixturePath}`;

    const loader = new TestDatasetLoader(baseUrl);
    await loader.loadManifest();

    // Get first rollup entry
    const manifest = loader.getManifestForTest() as FixtureManifest;
    expect(manifest.aggregate_index.weekly_rollups.length).toBeGreaterThan(0);

    const rollupEntry = manifest.aggregate_index.weekly_rollups[0];
    const rollupPath = path.join(fixturePath, rollupEntry.path);

    expect(pathExists(rollupPath)).toBe(true);

    const rollupData = readJsonFile<FixtureRollup>(rollupPath);

    // Validate structure
    expect(rollupData).toHaveProperty("week");
    expect(rollupData).toHaveProperty("pr_count");
    expect(rollupData).toHaveProperty("cycle_time_p50");
  });

  syntheticFixtureTest("generated dimensions load successfully", async () => {
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

  syntheticFixtureTest("5k PR fixture generates successfully", async () => {
    const fixturePath = generateFixture(5000, 42);
    const manifestPath = path.join(fixturePath, "dataset-manifest.json");

    expect(pathExists(manifestPath)).toBe(true);

    const manifest = readJsonFile<FixtureManifest>(manifestPath);
    expect(manifest.coverage.total_prs).toBe(5000);
  });

  syntheticFixtureTest("10k PR fixture generates successfully", async () => {
    const fixturePath = generateFixture(10000, 42);
    const manifestPath = path.join(fixturePath, "dataset-manifest.json");

    expect(pathExists(manifestPath)).toBe(true);

    const manifest = readJsonFile<FixtureManifest>(manifestPath);
    expect(manifest.coverage.total_prs).toBe(10000);
  });

  syntheticFixtureTest(
    "deterministic generation: same seed produces identical manifest structure",
    async () => {
      const fixture1 = generateFixture(1000, 999);
      const fixture2 = generateFixture(1000, 999);

      const manifest1 = readJsonFile<FixtureManifest>(
        path.join(fixture1, "dataset-manifest.json"),
      );
      const manifest2 = readJsonFile<FixtureManifest>(
        path.join(fixture2, "dataset-manifest.json"),
      );

      // Exclude generated_at timestamp
      delete manifest1.generated_at;
      delete manifest2.generated_at;

      expect(manifest1).toEqual(manifest2);
    },
  );

  describe("cross-dimensional round-trip (T016)", () => {
    syntheticFixtureIt(
      "Python-generated by_team_and_repo survives load and produces exact filter results",
      async () => {
        // Generate fixture with enough PRs for cross-dim data
        const outputDir = generateFixture(100, 42);

        // Load manifest
        const manifestPath = path.join(outputDir, "dataset-manifest.json");
        const manifest = readJsonFile<FixtureManifest>(manifestPath);

        // Find a rollup that has by_team_and_repo
        let targetRollup: FixtureRollup | null = null;
        for (const entry of manifest.aggregate_index.weekly_rollups) {
          const rollupPath = path.join(outputDir, entry.path);
          const rollupData = readJsonFile<FixtureRollup>(rollupPath);
          if (rollupData.by_team_and_repo) {
            targetRollup = rollupData;
            break;
          }
        }

        expect(targetRollup).not.toBeNull();
        expect(targetRollup.by_team_and_repo).toBeDefined();

        // Get known exact values from the fixture
        const teamNames = Object.keys(targetRollup.by_team_and_repo).filter(
          (k) => !k.startsWith("_"),
        );
        expect(teamNames.length).toBeGreaterThan(0);

        const firstTeam = teamNames[0];
        const teamRepoEntries = Object.entries(targetRollup.by_team_and_repo)
          .filter(([teamName]) => teamName === firstTeam);
        expect(teamRepoEntries.length).toBe(1);

        const [, teamRepos] = teamRepoEntries[0];
        const repoEntries = Object.entries(teamRepos);
        expect(repoEntries.length).toBeGreaterThan(0);

        const [firstRepo, expectedEntry] = repoEntries[0];
        const expectedPrCount = expectedEntry.pr_count;

        // Now run through TypeScript's applyFiltersToRollups
        const { applyFiltersToRollups } =
          await import("../../ui/modules/metrics");

        const filtered = applyFiltersToRollups([targetRollup], {
          teams: [firstTeam],
          repos: [firstRepo],
        });

        // The filtered result should match the exact cross-dim value
        expect(filtered[0].pr_count).toBe(expectedPrCount);
      },
    );

    syntheticFixtureIt(
      "cross-dim consistency: sum of team-repo pr_counts equals team total",
      () => {
        const outputDir = generateFixture(100, 42);
        const manifestPath = path.join(outputDir, "dataset-manifest.json");
        const manifest = readJsonFile<FixtureManifest>(manifestPath);

        let validWeeks = 0;
        for (const entry of manifest.aggregate_index.weekly_rollups) {
          const rollupPath = path.join(outputDir, entry.path);
          const rollupData = readJsonFile<FixtureRollup>(rollupPath);

          if (!rollupData.by_team_and_repo || !rollupData.by_team) continue;
          validWeeks++;

          for (const [teamName, repoEntries] of Object.entries(
            rollupData.by_team_and_repo,
          )) {
            if (teamName.startsWith("_")) continue;

            const crossDimSum = Object.values(
              repoEntries,
            ).reduce((sum, entry) => sum + (entry.pr_count || 0), 0);
            const teamEntry = Object.entries(rollupData.by_team).find(
              ([candidateTeamName]) => candidateTeamName === teamName,
            );
            const teamTotal = teamEntry?.[1].pr_count;

            expect(crossDimSum).toBe(teamTotal);
          }
        }
        // T1: Ensure at least one week had cross-dim data to validate
        expect(validWeeks).toBeGreaterThan(0);
      },
    );

    syntheticFixtureIt(
      "filter with non-existent team/repo returns zero pr_count",
      async () => {
        const outputDir = generateFixture(100, 42);
        const manifestPath = path.join(outputDir, "dataset-manifest.json");
        const manifest = readJsonFile<FixtureManifest>(manifestPath);

        // Find a rollup with cross-dim data
        let targetRollup: FixtureRollup | null = null;
        for (const entry of manifest.aggregate_index.weekly_rollups) {
          const rollupPath = path.join(outputDir, entry.path);
          const rollupData = readJsonFile<FixtureRollup>(rollupPath);
          if (rollupData.by_team_and_repo && rollupData.by_team) {
            targetRollup = rollupData;
            break;
          }
        }
        expect(targetRollup).not.toBeNull();

        const { applyFiltersToRollups } =
          await import("../../ui/modules/metrics");

        // Non-existent team
        const filteredTeam = applyFiltersToRollups([targetRollup], {
          teams: ["NonExistentTeam_XYZ"],
          repos: [],
        });
        expect(filteredTeam[0].pr_count).toBe(0);

        // Non-existent repo
        const filteredRepo = applyFiltersToRollups([targetRollup], {
          teams: [],
          repos: ["NonExistentRepo_XYZ"],
        });
        expect(filteredRepo[0].pr_count).toBe(0);
      },
    );
  });
});
