#!/usr/bin/env npx ts-node
/**
 * Update Performance Baselines
 *
 * USAGE: npm run perf:update-baseline
 *
 * WARNING: Only run this from the main branch after confirming
 * all performance tests pass with current baselines.
 *
 * This script:
 * 1. Runs performance tests in trend mode
 * 2. Extracts actual timings from console output
 * 3. Updates perf-baselines.json with new values
 * 4. Requires manual commit
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface PerfTimings {
  [key: string]: number;
}

interface PerfBaselines {
  metrics: PerfTimings;
  updated?: string;
  updatedBy?: string;
  [key: string]: unknown;
}

interface TestLogData {
  test?: string;
  duration_ms?: number;
}

const baselinesPath = path.join(
  __dirname,
  "..",
  "tests",
  "fixtures",
  "perf-baselines.json",
);

console.log("[PERF] Updating performance baselines...");
console.log("[PERF] Running performance tests to collect actual timings...\n");

// Run performance tests in trend mode and capture output. The pattern
// list covers every Jest file that emits a `{"test": "...", "duration_ms": ...}`
// JSON log via the shared helper at `tests/helpers/perf-measure.ts` —
// extend this list (and the mapping table below) when a new perf test
// is added.
//
// Shell quoting: the `--testPathPatterns=<regex>` value is wrapped in
// double quotes inside the command string so the regex's `|` is
// preserved as a regex-alternation char, not interpreted as a shell
// pipe. Both `/bin/sh` (POSIX) and `cmd.exe` (Windows) treat double
// quotes as a literal-preserving wrapper for `|`, so this is the
// cross-OS form. (Without quoting, the shell would parse the line as
// three piped commands and the test runner would never see the args.)
let testOutput: string;
try {
  testOutput = execSync(
    'npm test -- "--testPathPatterns=performance|chart-scalability|throughput-drilldown-perf" --verbose',
    {
      cwd: path.join(__dirname, ".."),
      encoding: "utf-8",
      env: { ...process.env, PERF_MODE: "trend" },
    },
  );
} catch (error: unknown) {
  console.error(
    "[ERROR] Performance tests failed. Fix failures before updating baselines.",
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Extract timing data from JSON logs
const timings: PerfTimings = {};
const jsonLogs = testOutput.match(/\{[^}]*"test"[^}]*\}/g) || [];

jsonLogs.forEach((log) => {
  try {
    const data: TestLogData = JSON.parse(log);
    if (data.test && data.duration_ms) {
      // Map test names to baseline metrics. The mapping variable is
      // named `metricName` (not `key`) so that gitleaks's
      // `generic-api-key` rule does not classify the high-entropy
      // metric-name literals (e.g. "156wk_throughput_render_ms") as
      // suspected secrets — issue #348 push surfaced one such false
      // positive before this rename.
      const testName = data.test;
      let metricName: string | undefined;

      if (testName.includes("fixture_generation_1000pr"))
        metricName = "1000pr_fixture_gen_ms";
      else if (testName.includes("fixture_generation_5000pr"))
        metricName = "5000pr_fixture_gen_ms";
      else if (testName.includes("fixture_generation_10000pr"))
        metricName = "10000pr_fixture_gen_ms";
      // Issue #348 — chart-scalability + throughput-drilldown perf tests
      // emit logs under these `test:` field values via the shared
      // `tests/helpers/perf-measure.ts` helper.
      else if (testName.includes("156wk_throughput_render"))
        metricName = "156wk_throughput_render_ms";
      else if (testName.includes("156wk_cycle_time_render"))
        metricName = "156wk_cycle_time_render_ms";
      else if (testName.includes("drilldown_500pr_open"))
        metricName = "drilldown_500pr_open_ms";
      // Add more mappings as needed

      if (metricName) {
        timings[metricName] = Math.round(data.duration_ms);
      }
    }
  } catch (_e) {
    // Skip malformed JSON
  }
});

if (Object.keys(timings).length === 0) {
  console.error("[ERROR] No timing data extracted from test output.");
  console.error("[ERROR] Make sure tests are outputting JSON logs.");
  process.exit(1);
}

// Load current baselines
let baselines: PerfBaselines;
try {
  baselines = JSON.parse(fs.readFileSync(baselinesPath, "utf-8"));
} catch (error: unknown) {
  console.error("[ERROR] Failed to read baselines file");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Update with new timings
console.log("\n[PERF] Updating baselines:\n");
Object.entries(timings).forEach(([key, value]) => {
  const old = baselines.metrics[key];
  baselines.metrics[key] = value;
  const change = old ? (((value - old) / old) * 100).toFixed(1) : "N/A";
  const sign = old && value > old ? "+" : "";
  console.log(`  ${key}: ${old} → ${value} (${sign}${change}%)`);
});

// Update metadata
baselines.updated = new Date().toISOString();
baselines.updatedBy = "baseline-update";

// Write updated baselines
fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + "\n");

console.log(`\n[PERF] ✅ Baselines updated successfully`);
console.log(`[PERF] File: ${baselinesPath}`);
console.log(`[PERF] Remember to commit this change!`);
