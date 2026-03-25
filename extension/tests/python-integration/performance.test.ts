/**
 * Baseline Performance Tests (Simplified)
 *
 * Focuses on fixture generation timing and basic metrics.
 * Full DatasetLoader integration tests deferred due to fetch mocking complexity.
 *
 * TODO(phase4-gap): Add full DatasetLoader mocked fetch tests when Jest environment stabilizes
 */

import * as os from "os";
import * as path from "path";
import {
  ensureDir,
  makeTempDir,
  pathExists,
  readJsonFile,
  removeDir,
  removeDirSafe,
  writeTextFile,
} from "../helpers/fs-test-utils";
import {
  assertPythonSubprocessSupport,
  probePythonSubprocessSupport,
  runPythonScript,
} from "./python-subprocess";

type MockGcGlobal = typeof globalThis & { gc?: () => void };
type AggregateIndex = { weekly_rollups: Array<{ path: string }> };
type PerfManifest = {
  manifest_schema_version: number;
  aggregate_index: AggregateIndex;
};
type PerfRollup = { week: string; pr_count?: number };
type PerfBaselines = {
  metrics?: Record<string, number>;
};

const gcGlobal = global as MockGcGlobal;
const performanceTempRoot = makeTempDir(
  path.join(
    process.env["GRI_EXTENSION_TEST_TMPDIR"] ?? os.tmpdir(),
    "gri-extension-perf-",
  ),
);
const performanceFixturesDir = path.join(performanceTempRoot, "perf-fixtures");
const performanceSummaryPath = path.join(
  performanceTempRoot,
  "perf-summary.json",
);
const pythonSubprocessSupport = probePythonSubprocessSupport();
const performanceTest = pythonSubprocessSupport.supported ? test : test.skip;

function runSyntheticDatasetGenerator(outputDir: string, prCount: number) {
  const scriptPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "scripts",
    "generate-synthetic-dataset.py",
  );

  runPythonScript(scriptPath, [
    "--pr-count",
    String(prCount),
    "--seed",
    "42",
    "--output",
    outputDir,
  ]);
}

function getMetricBaseline(
  baselines: PerfBaselines,
  key: string,
): number | undefined {
  return Object.entries(baselines.metrics ?? {}).find(
    ([candidateKey]) => candidateKey === key,
  )?.[1];
}

describe("Performance Baseline Tests (Simplified)", () => {
  beforeAll(() => {
    assertPythonSubprocessSupport("Performance Baseline Tests");
  });

  /**
   * Measure operation timing
   */
  function measureTiming(operation: () => void) {
    const start = performance.now();
    operation();
    const end = performance.now();
    return end - start;
  }

  /**
   * Measure memory delta
   */
  function measureMemoryDelta(operation: () => void) {
    if (gcGlobal.gc) {
      gcGlobal.gc();
    }

    const startMem = process.memoryUsage().heapUsed;
    operation();
    const endMem = process.memoryUsage().heapUsed;

    return endMem - startMem;
  }

  performanceTest("1k PR fixture generation completes within budget", () => {
    const outputDir = path.join(performanceFixturesDir, "1000pr");

    // Clean previous run
    if (pathExists(outputDir)) {
      removeDir(outputDir);
    }

    // Baseline: 5s, Budget: 10s (2x tolerance)
    const duration = measureTiming(() => {
      runSyntheticDatasetGenerator(outputDir, 1000);
    });

    expect(duration).toBeLessThan(10000);
    expect(pathExists(path.join(outputDir, "dataset-manifest.json"))).toBe(
      true,
    );

    console.log(
      JSON.stringify({
        test: "fixture_generation_1k",
        duration_ms: duration,
        budget_ms: 10000,
        baseline_ms: 5000,
      }),
    );
  });

  performanceTest("manifest parsing completes within budget", () => {
    const manifestPath = path.join(
      performanceFixturesDir,
      "1000pr",
      "dataset-manifest.json",
    );

    if (!pathExists(manifestPath)) {
      const outputDir = path.join(performanceFixturesDir, "1000pr");
      runSyntheticDatasetGenerator(outputDir, 1000);
    }

    // Baseline: 10ms, Budget: 50ms (generous for file I/O)
    const duration = measureTiming(() => {
      const manifest = readJsonFile<PerfManifest>(manifestPath);

      // Validate basic structure
      expect(manifest.manifest_schema_version).toBe(1);
      expect(manifest.aggregate_index).toBeDefined();
    });

    expect(duration).toBeLessThan(50);

    console.log(
      JSON.stringify({
        test: "manifest_parse",
        duration_ms: duration,
        budget_ms: 50,
        baseline_ms: 10,
      }),
    );
  });

  performanceTest(
    "bulk JSON parsing (all rollups) completes within budget",
    () => {
      const fixtureDir = path.join(performanceFixturesDir, "1000pr");
      const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

      if (!pathExists(manifestPath)) {
        runSyntheticDatasetGenerator(fixtureDir, 1000);
      }

      const manifest = readJsonFile<PerfManifest>(manifestPath);

      // Baseline: 100ms, Budget: 500ms (2x tolerance + file I/O)
      const duration = measureTiming(() => {
        for (const entry of manifest.aggregate_index.weekly_rollups) {
          const rollupPath = path.join(fixtureDir, entry.path);
          const rollupData = readJsonFile<PerfRollup>(rollupPath);

          // Simulate processing
          expect(rollupData.week).toBeDefined();
          expect(rollupData.pr_count).toBeGreaterThan(0);
        }
      });

      expect(duration).toBeLessThan(500);

      console.log(
        JSON.stringify({
          test: "bulk_json_parse",
          duration_ms: duration,
          budget_ms: 500,
          baseline_ms: 100,
          files_parsed: manifest.aggregate_index.weekly_rollups.length,
        }),
      );
    },
  );

  performanceTest(
    "memory footprint for 1k dataset remains within ceiling",
    () => {
      const fixtureDir = path.join(performanceFixturesDir, "1000pr");
      const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

      if (!pathExists(manifestPath)) {
        runSyntheticDatasetGenerator(fixtureDir, 1000);
      }

      // Budget: 20MB delta (conservative for file I/O + parsing)
      const memoryDelta = measureMemoryDelta(() => {
        const manifest = readJsonFile<PerfManifest>(manifestPath);
        const dimensions = readJsonFile<unknown>(
          path.join(fixtureDir, "aggregates", "dimensions.json"),
        );

        // Load some rollups
        const rollups: PerfRollup[] = [];
        for (const entry of manifest.aggregate_index.weekly_rollups.slice(0, 5)) {
          const rollupPath = path.join(fixtureDir, entry.path);
          rollups.push(readJsonFile<PerfRollup>(rollupPath));
        }

        // Keep references
        return { manifest, dimensions, rollups };
      });

      const memoryDeltaMB = memoryDelta / (1024 * 1024);
      expect(memoryDeltaMB).toBeLessThan(20);

      console.log(
        JSON.stringify({
          test: "memory_footprint",
          memory_delta_mb: memoryDeltaMB,
          budget_mb: 20,
          baseline_mb: 10,
        }),
      );
    },
  );

  afterAll(() => {
    // Write summary for CI artifacts
    const summary = {
      timestamp: new Date().toISOString(),
      fixture_size: "1000 PRs",
      tests_run: 4,
      note: "Simplified tests - full DatasetLoader integration deferred",
      gap: "TODO: Add DatasetLoader mocked fetch tests (phase4-gap)",
    };

    ensureDir(path.dirname(performanceSummaryPath));
    writeTextFile(performanceSummaryPath, JSON.stringify(summary, null, 2));

    // Best-effort cleanup of unique temp dir to prevent accumulation
    removeDirSafe(performanceTempRoot);
  });
});

/**
 * Phase 4: Automated Scaling Gates
 *
 * Parameterized performance tests at 1k/5k/10k PRs with regression detection.
 * Mode: 'trend' (warn) or 'absolute' (fail) based on PERF_MODE env var.
 */
describe.each([1000, 5000, 10000])(
  "Scaling Performance at %d PRs",
  (prCount) => {
    const baselinesPath = path.join(
      __dirname,
      "..",
      "fixtures",
      "perf-baselines.json",
    );
    const warmupRuns = 2;
    const measureRuns = 3;
    const regressionThreshold = 0.2;
    const mode = process.env["PERF_MODE"] || "trend";

    let baselines: PerfBaselines = {};

    beforeAll(() => {
      assertPythonSubprocessSupport(`Scaling Performance at ${prCount} PRs`);

      // Load committed baselines
      if (pathExists(baselinesPath)) {
        baselines = readJsonFile<PerfBaselines>(baselinesPath);
      }
    });

    /**
     * Measure with warm-up and averaging
     */
    function measureWithWarmup(operation: () => void) {
      const times: number[] = [];

      // Warmup
      for (let i = 0; i < warmupRuns; i++) {
        operation();
      }

      // GC between runs if available
      if (gcGlobal.gc) gcGlobal.gc();

      // Measure
      for (let i = 0; i < measureRuns; i++) {
        const start = performance.now();
        operation();
        const end = performance.now();
        times.push(end - start);
        if (gcGlobal.gc) gcGlobal.gc();
      }

      // Return median
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)]!;
    }

    /**
     * Check regression against baseline
     */
    function checkRegression(
      testName: string,
      actual: number,
      baseline?: number,
    ) {
      if (!baseline) {
        console.warn(
          `[PERF] No baseline for ${testName}, recording: ${actual.toFixed(2)}ms`,
        );
        return;
      }

      const regression = (actual - baseline) / baseline;
      const message = `[PERF] ${testName}: ${actual.toFixed(2)}ms vs baseline ${baseline.toFixed(2)}ms (${(regression * 100).toFixed(1)}% change)`;

      if (regression > regressionThreshold) {
        if (mode === "absolute") {
          throw new Error(`${message} - REGRESSION DETECTED`);
        } else {
          console.warn(`${message} - WARNING`);
        }
      } else {
        console.log(message);
      }
    }

    performanceTest(
      `${prCount} PR fixture generation within budget`,
      () => {
        const fixtureDir = path.join(performanceFixturesDir, `${prCount}pr`);

        // Clean previous run
        if (pathExists(fixtureDir)) {
          removeDir(fixtureDir);
        }

        const duration = measureWithWarmup(() => {
          runSyntheticDatasetGenerator(fixtureDir, prCount);
        });

        // Budget scales linearly with PR count
        const budget = 5000 * (prCount / 1000) * 2; // 2x tolerance
        expect(duration).toBeLessThan(budget);

        // Check regression
        const baselineKey = `${prCount}pr_fixture_gen_ms`;
        const baseline = getMetricBaseline(baselines, baselineKey);
        checkRegression(`${prCount}pr-fixture-gen`, duration, baseline);

        console.log(
          JSON.stringify({
            test: `fixture_generation_${prCount}pr`,
            duration_ms: duration,
            budget_ms: budget,
            baseline_ms: baseline || "N/A",
          }),
        );
      },
      60000,
    ); // 60s timeout for large fixtures

    performanceTest(`${prCount} PR manifest parse within budget`, () => {
      const fixtureDir = path.join(performanceFixturesDir, `${prCount}pr`);
      const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

      // Generate if not exists
      if (!pathExists(manifestPath)) {
        runSyntheticDatasetGenerator(fixtureDir, prCount);
      }

      const duration = measureWithWarmup(() => {
        const manifest = readJsonFile<PerfManifest>(manifestPath);
        expect(manifest.manifest_schema_version).toBe(1);
      });

      // Manifest parse should be constant time
      const budget = 50;
      expect(duration).toBeLessThan(budget);

      const baselineKey = `${prCount}pr_manifest_parse_ms`;
      const baseline = getMetricBaseline(baselines, baselineKey);
      checkRegression(`${prCount}pr-manifest-parse`, duration, baseline);
    });

    performanceTest(`${prCount} PR bulk JSON parse scales sub-linearly`, () => {
      const fixtureDir = path.join(performanceFixturesDir, `${prCount}pr`);
      const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

      if (!pathExists(manifestPath)) {
        runSyntheticDatasetGenerator(fixtureDir, prCount);
      }

      const manifest = readJsonFile<PerfManifest>(manifestPath);

      const duration = measureWithWarmup(() => {
        for (const entry of manifest.aggregate_index.weekly_rollups) {
          const rollupPath = path.join(fixtureDir, entry.path);
          const rollupData = readJsonFile<PerfRollup>(rollupPath);
          expect(rollupData.week).toBeDefined();
        }
      });

      // Budget scales sub-linearly: O(sqrt(n))
      const budget = 500 * Math.sqrt(prCount / 1000);
      expect(duration).toBeLessThan(budget);

      const baselineKey = `${prCount}pr_bulk_parse_ms`;
      const baseline = getMetricBaseline(baselines, baselineKey);
      checkRegression(`${prCount}pr-bulk-parse`, duration, baseline);
    });
  },
);
