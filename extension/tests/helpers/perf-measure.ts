/**
 * Shared performance-measurement helper.
 *
 * Lifts the warmup + median + baseline pattern that
 * `tests/python-integration/performance.test.ts` uses inline so that
 * timing-budget tests outside the python-integration suite (e.g.
 * `chart-scalability.test.ts`, `throughput-drilldown-perf.test.ts`) can
 * adopt the same statistically-robust pattern without duplicating it.
 *
 * Single-shot wall-clock checks (`expect(performance.now() - start).toBeLessThan(BUDGET)`)
 * are flake-prone on shared CI runners and on local machines under preflight load:
 * a single JIT-cold render or GC pause can overshoot the budget by an order of
 * magnitude even when the typical render is well within it (issue #348).
 *
 * The mitigation pattern, mirrored here:
 *   1. Run `warmupRuns` discarded iterations to warm the JIT and module caches.
 *   2. Run `measureRuns` timed iterations.
 *   3. Take the median to absorb any single-shot outliers.
 *   4. Optionally compare against a committed baseline and warn / fail on
 *      regression (gated by the `PERF_MODE` env var; default `trend` only logs).
 *
 * The test still asserts an absolute outer ceiling on the median —
 * the spec ceilings (`< 1000ms` for chart-render, `< 250ms` for the
 * throughput drill-down) are preserved verbatim, just applied to the
 * median rather than a single sample.
 */

import * as path from "path";
import { pathExists, readJsonFile } from "./fs-test-utils";

/** Shape of the committed `extension/tests/fixtures/perf-baselines.json`. */
export interface PerfBaselines {
  metrics?: Record<string, number>;
  [key: string]: unknown;
}

/** Optional iteration hooks for `measureWithWarmup`. */
export interface MeasureWithWarmupOptions {
  /** Discarded JIT-warm-up iterations before timing starts. Default: 2. */
  warmupRuns?: number;
  /** Timed iterations whose median is returned. Default: 3. */
  measureRuns?: number;
  /** Runs before each iteration (warmup AND measured). */
  beforeEach?: () => void;
  /** Runs after each iteration (warmup AND measured). */
  afterEach?: () => void;
}

type GcGlobal = typeof globalThis & { gc?: () => void };

/**
 * Resolve the canonical baselines path relative to this helper. Centralised
 * so callers do not duplicate `path.join(__dirname, "..", "fixtures", ...)`
 * boilerplate and accidentally diverge.
 */
export const PERF_BASELINES_PATH = path.join(
  __dirname,
  "..",
  "fixtures",
  "perf-baselines.json",
);

/**
 * Run `operation` `warmupRuns` times to warm the JIT and module caches,
 * then `measureRuns` more times capturing wall-clock per iteration, and
 * return the median elapsed milliseconds.
 *
 * `beforeEach` / `afterEach` run for both warmup and measured iterations
 * — pass them when each iteration must start from a clean DOM / closed
 * panel / etc. so subsequent iterations measure the same shape of work.
 *
 * If `--expose-gc` is in effect (`node --expose-gc`), an explicit GC
 * runs between warmup and the first measured iteration, and after each
 * measured iteration, so heap pressure from previous iterations does
 * not bleed into the next sample.
 */
export function measureWithWarmup(
  operation: () => void,
  options: MeasureWithWarmupOptions = {},
): number {
  const warmupRuns = options.warmupRuns ?? 2;
  const measureRuns = options.measureRuns ?? 3;

  // Reject configurations that would return `undefined` through the
  // `: number` return type. `measureRuns < 1` produces an empty samples
  // array; `warmupRuns < 0` is nonsensical. Integer-only — fractional
  // counts are silent footguns.
  if (!Number.isInteger(measureRuns) || measureRuns < 1) {
    throw new Error(
      `measureWithWarmup: measureRuns must be a positive integer, got ${measureRuns}`,
    );
  }
  if (!Number.isInteger(warmupRuns) || warmupRuns < 0) {
    throw new Error(
      `measureWithWarmup: warmupRuns must be a non-negative integer, got ${warmupRuns}`,
    );
  }

  for (let i = 0; i < warmupRuns; i++) {
    options.beforeEach?.();
    operation();
    options.afterEach?.();
  }

  const gcGlobal = globalThis as GcGlobal;
  if (gcGlobal.gc) gcGlobal.gc();

  const samples: number[] = [];
  for (let i = 0; i < measureRuns; i++) {
    options.beforeEach?.();
    const start = performance.now();
    operation();
    const end = performance.now();
    samples.push(end - start);
    options.afterEach?.();
    if (gcGlobal.gc) gcGlobal.gc();
  }

  samples.sort((a, b) => a - b);
  // Median: for measureRuns=3, this returns samples[1] (the middle value).
  // The non-null assertion is safe because measureRuns >= 1 by construction.
  return samples[Math.floor(samples.length / 2)]!;
}

/**
 * Compare an actual measurement against a committed baseline and log /
 * throw based on the `PERF_MODE` env var.
 *
 * Modes:
 *   - `trend` (default): only logs. Used in CI by default so flake fixes
 *     can land before the canonical baseline is recorded.
 *   - `absolute`: throws when the regression exceeds 20% over baseline.
 *     Promote to `absolute` once a stable baseline has been seeded via
 *     `pnpm run perf:update-baseline` and committed under the approved
 *     `chore(perf): update baselines [baseline-update]` path.
 *
 * If `baselineMs` is undefined (no committed baseline yet), this just
 * logs a "recording" line so the next baseline-update run can capture
 * the value — it never trips the test.
 */
export function checkRegression(
  testName: string,
  actualMs: number,
  baselineMs: number | undefined,
): void {
  const regressionThreshold = 0.2;
  const mode = process.env["PERF_MODE"] ?? "trend";

  // `baselineMs <= 0` is treated as missing too: the regression ratio
  // `(actual - baseline) / baseline` would divide by zero (or invert
  // sign on a negative baseline), producing `Infinity` / nonsense
  // comparisons. A zero is plausible — a freshly-recorded baseline
  // rounded to 0 ms by the update script for a sub-millisecond
  // operation — so guard rather than assume positive.
  if (baselineMs === undefined || baselineMs <= 0) {
    console.warn(
      `[PERF] No usable baseline for ${testName}, recording: ${actualMs.toFixed(2)}ms`,
    );
    return;
  }

  const regression = (actualMs - baselineMs) / baselineMs;
  const message = `[PERF] ${testName}: ${actualMs.toFixed(2)}ms vs baseline ${baselineMs.toFixed(2)}ms (${(regression * 100).toFixed(1)}% change)`;

  if (regression > regressionThreshold) {
    if (mode === "absolute") {
      throw new Error(`${message} - REGRESSION DETECTED`);
    }
    console.warn(`${message} - WARNING`);
    return;
  }
  console.log(message);
}

/**
 * Load the committed baselines file, returning `{}` when it does not
 * exist yet — the helper stays usable in trend-mode bootstrap before
 * baselines are first seeded.
 */
export function loadPerfBaselines(
  baselinesPath: string = PERF_BASELINES_PATH,
): PerfBaselines {
  if (!pathExists(baselinesPath)) return {};
  return readJsonFile<PerfBaselines>(baselinesPath);
}

/**
 * Look up a single baseline metric by key.
 *
 * Uses `Object.entries` + `find` rather than direct bracket access to keep
 * eslint-plugin-security's `detect-object-injection` rule satisfied —
 * matches the `getMetricBaseline` shape in
 * `tests/python-integration/performance.test.ts`.
 */
export function getMetricBaseline(
  baselines: PerfBaselines,
  key: string,
): number | undefined {
  return Object.entries(baselines.metrics ?? {}).find(
    ([candidateKey]) => candidateKey === key,
  )?.[1];
}
