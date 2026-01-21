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

// Run performance tests in trend mode and capture output
let testOutput: string;
try {
  testOutput = execSync("npm test -- performance.test.ts --verbose", {
    cwd: path.join(__dirname, ".."),
    encoding: "utf-8",
    env: { ...process.env, PERF_MODE: "trend" },
  });
} catch (error: any) {
  console.error(
    "[ERROR] Performance tests failed. Fix failures before updating baselines.",
  );
  console.error(error.message);
  process.exit(1);
}

// Extract timing data from JSON logs
const timings: PerfTimings = {};
const jsonLogs = testOutput.match(/\{[^}]*"test"[^}]*\}/g) || [];

jsonLogs.forEach((log) => {
  try {
    const data: TestLogData = JSON.parse(log);
    if (data.test && data.duration_ms) {
      // Map test names to baseline keys
      const testName = data.test;
      let key: string | undefined;

      if (testName.includes("fixture_generation_1000pr"))
        key = "1000pr_fixture_gen_ms";
      else if (testName.includes("fixture_generation_5000pr"))
        key = "5000pr_fixture_gen_ms";
      else if (testName.includes("fixture_generation_10000pr"))
        key = "10000pr_fixture_gen_ms";
      // Add more mappings as needed

      if (key) {
        timings[key] = Math.round(data.duration_ms);
      }
    }
  } catch (e) {
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
} catch (error: any) {
  console.error("[ERROR] Failed to read baselines file");
  console.error(error.message);
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
baselines.updatedBy = process.env.USER || process.env.USERNAME || "manual";

// Write updated baselines
fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + "\n");

console.log(`\n[PERF] ✅ Baselines updated successfully`);
console.log(`[PERF] File: ${baselinesPath}`);
console.log(`[PERF] Remember to commit this change!`);
