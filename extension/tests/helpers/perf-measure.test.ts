/**
 * Unit tests for the shared perf-measurement helper (issue #348).
 *
 * Locks the Codex stop-time review catches:
 *   1. `measureRuns < 1` and non-integer counts must throw, not silently
 *      return `undefined` cast to `number`.
 *   2. `baselineMs <= 0` must be treated as missing/invalid, not divided
 *      into the regression ratio.
 *
 * Plus a smoke test for the happy path and a coverage check on the
 * absolute-mode regression-throw branch (the load-bearing behavior the
 * helper enables for production gating once baselines are seeded).
 */

import { checkRegression, measureWithWarmup } from "./perf-measure";

describe("measureWithWarmup", () => {
  it("returns a finite non-negative median and invokes operation warmup+measure times", () => {
    let calls = 0;
    const median = measureWithWarmup(
      () => {
        calls += 1;
      },
      { warmupRuns: 1, measureRuns: 3 },
    );

    // 1 warmup + 3 measured iterations.
    expect(calls).toBe(4);
    expect(typeof median).toBe("number");
    expect(Number.isFinite(median)).toBe(true);
    expect(median).toBeGreaterThanOrEqual(0);
  });

  it("throws when measureRuns is 0 (would produce empty samples + undefined median)", () => {
    expect(() =>
      measureWithWarmup(() => undefined, { measureRuns: 0 }),
    ).toThrow(/measureRuns must be a positive integer/);
  });

  it("throws when measureRuns is non-integer (silent footgun)", () => {
    expect(() =>
      measureWithWarmup(() => undefined, { measureRuns: 2.5 }),
    ).toThrow(/measureRuns must be a positive integer/);
  });
});

describe("checkRegression", () => {
  let warnSpy: jest.SpyInstance;
  let originalMode: string | undefined;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    originalMode = process.env["PERF_MODE"];
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalMode === undefined) {
      delete process.env["PERF_MODE"];
    } else {
      process.env["PERF_MODE"] = originalMode;
    }
  });

  it("warns and returns when baselineMs is undefined (no baseline yet)", () => {
    expect(() => checkRegression("test-x", 100, undefined)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/No usable baseline for test-x/),
    );
  });

  it("warns and returns when baselineMs is 0 (would divide by zero)", () => {
    expect(() => checkRegression("test-x", 100, 0)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/No usable baseline for test-x/),
    );
  });

  it("throws when regression exceeds threshold in absolute mode", () => {
    process.env["PERF_MODE"] = "absolute";
    // 100ms vs 50ms baseline → +100% regression, well beyond the 20% bar.
    expect(() => checkRegression("test-x", 100, 50)).toThrow(
      /REGRESSION DETECTED/,
    );
  });
});
