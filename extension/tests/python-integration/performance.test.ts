/**
 * Baseline Performance Tests (Simplified)
 *
 * Focuses on fixture generation timing and basic metrics.
 * Full DatasetLoader integration tests deferred due to fetch mocking complexity.
 *
 * TODO(phase4-gap): Add full DatasetLoader mocked fetch tests when Jest environment stabilizes
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

describe("Performance Baseline Tests (Simplified)", () => {
  const perfFixturesDir = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "tmp",
    "perf-fixtures",
  );

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
    if ((global as any).gc) {
      (global as any).gc();
    }

    const startMem = process.memoryUsage().heapUsed;
    operation();
    const endMem = process.memoryUsage().heapUsed;

    return endMem - startMem;
  }

  test("1k PR fixture generation completes within budget", () => {
    const outputDir = path.join(perfFixturesDir, "1000pr");
    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "scripts",
      "generate-synthetic-dataset.py",
    );

    // Clean previous run
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }

    // Baseline: 5s, Budget: 10s (2x tolerance)
    const duration = measureTiming(() => {
      execSync(
        `python "${scriptPath}" --pr-count 1000 --seed 42 --output "${outputDir}"`,
        { stdio: "pipe" },
      );
    });

    expect(duration).toBeLessThan(10000);
    expect(fs.existsSync(path.join(outputDir, "dataset-manifest.json"))).toBe(
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

  test("manifest parsing completes within budget", () => {
    const manifestPath = path.join(
      perfFixturesDir,
      "1000pr",
      "dataset-manifest.json",
    );

    if (!fs.existsSync(manifestPath)) {
      // Generate if not exists
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "scripts",
        "generate-synthetic-dataset.py",
      );
      const outputDir = path.join(perfFixturesDir, "1000pr");
      execSync(
        `python "${scriptPath}" --pr-count 1000 --seed 42 --output "${outputDir}"`,
        { stdio: "pipe" },
      );
    }

    // Baseline: 10ms, Budget: 50ms (generous for file I/O)
    const duration = measureTiming(() => {
      const content = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(content);

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

  test("bulk JSON parsing (all rollups) completes within budget", () => {
    const fixtureDir = path.join(perfFixturesDir, "1000pr");
    const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

    if (!fs.existsSync(manifestPath)) {
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "scripts",
        "generate-synthetic-dataset.py",
      );
      execSync(
        `python "${scriptPath}" --pr-count 1000 --seed 42 --output "${fixtureDir}"`,
        { stdio: "pipe" },
      );
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    // Baseline: 100ms, Budget: 500ms (2x tolerance + file I/O)
    const duration = measureTiming(() => {
      for (const entry of manifest.aggregate_index.weekly_rollups) {
        const rollupPath = path.join(fixtureDir, entry.path);
        const rollupData = JSON.parse(fs.readFileSync(rollupPath, "utf-8"));

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
  });

  test("memory footprint for 1k dataset remains within ceiling", () => {
    const fixtureDir = path.join(perfFixturesDir, "1000pr");
    const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

    if (!fs.existsSync(manifestPath)) {
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "scripts",
        "generate-synthetic-dataset.py",
      );
      execSync(
        `python "${scriptPath}" --pr-count 1000 --seed 42 --output "${fixtureDir}"`,
        { stdio: "pipe" },
      );
    }

    // Budget: 20MB delta (conservative for file I/O + parsing)
    const memoryDelta = measureMemoryDelta(() => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const dimensions = JSON.parse(
        fs.readFileSync(
          path.join(fixtureDir, "aggregates", "dimensions.json"),
          "utf-8",
        ),
      );

      // Load some rollups
      const rollups = [];
      for (
        let i = 0;
        i < 5 && i < manifest.aggregate_index.weekly_rollups.length;
        i++
      ) {
        const entry = manifest.aggregate_index.weekly_rollups[i];
        const rollupPath = path.join(fixtureDir, entry.path);
        rollups.push(JSON.parse(fs.readFileSync(rollupPath, "utf-8")));
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
  });

  afterAll(() => {
    // Write summary for CI artifacts
    const summaryPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "tmp",
      "perf-summary.json",
    );
    const summary = {
      timestamp: new Date().toISOString(),
      fixture_size: "1000 PRs",
      tests_run: 4,
      note: "Simplified tests - full DatasetLoader integration deferred",
      gap: "TODO: Add DatasetLoader mocked fetch tests (phase4-gap)",
    };

    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
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
    const perfFixturesDir = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "tmp",
      "perf-fixtures",
    );
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

    let baselines: any = {};

    beforeAll(() => {
      // Load committed baselines
      if (fs.existsSync(baselinesPath)) {
        baselines = JSON.parse(fs.readFileSync(baselinesPath, "utf-8"));
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
      if ((global as any).gc) (global as any).gc();

      // Measure
      for (let i = 0; i < measureRuns; i++) {
        const start = performance.now();
        operation();
        const end = performance.now();
        times.push(end - start);
        if ((global as any).gc) (global as any).gc();
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

    test(`${prCount} PR fixture generation within budget`, () => {
      const fixtureDir = path.join(perfFixturesDir, `${prCount}pr`);
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "scripts",
        "generate-synthetic-dataset.py",
      );

      // Clean previous run
      if (fs.existsSync(fixtureDir)) {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }

      const duration = measureWithWarmup(() => {
        execSync(
          `python "${scriptPath}" --pr-count ${prCount} --seed 42 --output "${fixtureDir}"`,
          { stdio: "pipe" },
        );
      });

      // Budget scales linearly with PR count
      const budget = 5000 * (prCount / 1000) * 2; // 2x tolerance
      expect(duration).toBeLessThan(budget);

      // Check regression
      const baselineKey = `${prCount}pr_fixture_gen_ms`;
      const baseline = baselines.metrics?.[baselineKey];
      checkRegression(`${prCount}pr-fixture-gen`, duration, baseline);

      console.log(
        JSON.stringify({
          test: `fixture_generation_${prCount}pr`,
          duration_ms: duration,
          budget_ms: budget,
          baseline_ms: baseline || "N/A",
        }),
      );
    }, 60000); // 60s timeout for large fixtures

    test(`${prCount} PR manifest parse within budget`, () => {
      const fixtureDir = path.join(perfFixturesDir, `${prCount}pr`);
      const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

      // Generate if not exists
      if (!fs.existsSync(manifestPath)) {
        const scriptPath = path.join(
          __dirname,
          "..",
          "..",
          "..",
          "scripts",
          "generate-synthetic-dataset.py",
        );
        execSync(
          `python "${scriptPath}" --pr-count ${prCount} --seed 42 --output "${fixtureDir}"`,
          { stdio: "pipe" },
        );
      }

      const duration = measureWithWarmup(() => {
        const content = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(content);
        expect(manifest.manifest_schema_version).toBe(1);
      });

      // Manifest parse should be constant time
      const budget = 50;
      expect(duration).toBeLessThan(budget);

      const baselineKey = `${prCount}pr_manifest_parse_ms`;
      const baseline = baselines.metrics?.[baselineKey];
      checkRegression(`${prCount}pr-manifest-parse`, duration, baseline);
    });

    test(`${prCount} PR bulk JSON parse scales sub-linearly`, () => {
      const fixtureDir = path.join(perfFixturesDir, `${prCount}pr`);
      const manifestPath = path.join(fixtureDir, "dataset-manifest.json");

      if (!fs.existsSync(manifestPath)) {
        const scriptPath = path.join(
          __dirname,
          "..",
          "..",
          "..",
          "scripts",
          "generate-synthetic-dataset.py",
        );
        execSync(
          `python "${scriptPath}" --pr-count ${prCount} --seed 42 --output "${fixtureDir}"`,
          { stdio: "pipe" },
        );
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      const duration = measureWithWarmup(() => {
        for (const entry of manifest.aggregate_index.weekly_rollups) {
          const rollupPath = path.join(fixtureDir, entry.path);
          const rollupData = JSON.parse(fs.readFileSync(rollupPath, "utf-8"));
          expect(rollupData.week).toBeDefined();
        }
      });

      // Budget scales sub-linearly: O(sqrt(n))
      const budget = 500 * Math.sqrt(prCount / 1000);
      expect(duration).toBeLessThan(budget);

      const baselineKey = `${prCount}pr_bulk_parse_ms`;
      const baseline = baselines.metrics?.[baselineKey];
      checkRegression(`${prCount}pr-bulk-parse`, duration, baseline);
    });
  },
);
