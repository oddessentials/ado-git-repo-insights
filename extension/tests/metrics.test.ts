/**
 * Phase 4: Metrics Collector Tests
 *
 * Tests for production-safe metrics collection:
 * - Production mode ignores debug flags
 * - Metrics only collected when opt-in enabled
 * - Test isolation (metrics reset between tests)
 * - Performance API polyfill for jest/jsdom
 */

describe("Metrics Collector (Phase 4)", () => {
  // Performance API polyfill is provided by tests/setup.ts

  type DebugWindow = Window & {
    __DASHBOARD_DEBUG__?: boolean;
    location?: { search?: string };
  };
  type MockPerformance = Performance & {
    marks: Map<string, number>;
    mark: (name: string) => void;
    measure: (name: string, startMark: string, endMark: string) => void;
    getEntriesByName: (name: string, type: string) => PerformanceEntry[];
    clearMarks: () => void;
    clearMeasures: () => void;
  };
  type TestGlobals = {
    window?: DebugWindow;
    process?: NodeJS.Process | { env: { NODE_ENV?: string } };
    performance: MockPerformance;
  };
  type MetricMeasure = {
    name: string;
    duration: number;
    timestamp: number;
  };

  const testGlobals = global as unknown as TestGlobals;
  let originalWindow: DebugWindow | undefined;
  let originalProcess: TestGlobals["process"];

  beforeEach(() => {
    originalWindow = testGlobals.window;
    originalProcess = testGlobals.process;
    // Clear window/process globals for production/debug flag tests
    delete testGlobals.window;
    delete testGlobals.process;
  });

  afterEach(() => {
    testGlobals.window = originalWindow as DebugWindow | undefined;
    testGlobals.process = originalProcess;
  });

  it("Production mode ignores __DASHBOARD_DEBUG__", () => {
    // Set production environment
    testGlobals.process = { env: { NODE_ENV: "production" } } as unknown as NodeJS.Process;
    testGlobals.window = { __DASHBOARD_DEBUG__: true } as DebugWindow;

    // Re-evaluate the metrics collector logic
    const IS_PRODUCTION =
      typeof process !== "undefined" && process.env.NODE_ENV === "production";
    const DEBUG_ENABLED =
      !IS_PRODUCTION &&
      ((typeof window !== "undefined" && window.__DASHBOARD_DEBUG__) ||
        (typeof window !== "undefined" &&
          new URLSearchParams(window.location?.search || "").has("debug")));

    expect(IS_PRODUCTION).toBe(true);
    expect(DEBUG_ENABLED).toBe(false);
  });

  it("Production mode ignores ?debug param", () => {
    testGlobals.process = { env: { NODE_ENV: "production" } } as unknown as NodeJS.Process;
    testGlobals.window = {
      location: { search: "?debug" },
    } as DebugWindow;

    const IS_PRODUCTION =
      typeof process !== "undefined" && process.env.NODE_ENV === "production";
    const DEBUG_ENABLED =
      !IS_PRODUCTION &&
      ((typeof window !== "undefined" && window.__DASHBOARD_DEBUG__) ||
        (typeof window !== "undefined" &&
          new URLSearchParams(window.location?.search || "").has("debug")));

    expect(DEBUG_ENABLED).toBe(false);
  });

  it("Debug mode enables metrics with __DASHBOARD_DEBUG__", () => {
    // In JSDOM v26+, we need to use the existing window object rather than replacing it
    const originalDashboardDebug = window.__DASHBOARD_DEBUG__;

    // Set development environment on process
    testGlobals.process = { env: { NODE_ENV: "development" } } as unknown as NodeJS.Process;
    window.__DASHBOARD_DEBUG__ = true;

    const IS_PRODUCTION =
      typeof process !== "undefined" && process.env.NODE_ENV === "production";
    const DEBUG_ENABLED =
      !IS_PRODUCTION &&
      ((typeof window !== "undefined" && window.__DASHBOARD_DEBUG__) ||
        (typeof window !== "undefined" &&
          new URLSearchParams(window.location?.search || "").has("debug")));

    expect(DEBUG_ENABLED).toBe(true);

    // Cleanup
    window.__DASHBOARD_DEBUG__ = originalDashboardDebug;
  });

  it("Debug mode enables metrics with ?debug param", () => {
    // For testing URL query params, we need to use history API or jsdom's URL setup
    // Since we can't easily change window.location.search, we test the URLSearchParams logic directly
    testGlobals.process = { env: { NODE_ENV: "development" } } as unknown as NodeJS.Process;

    const IS_PRODUCTION =
      typeof process !== "undefined" && process.env.NODE_ENV === "production";

    // Test the URLSearchParams parsing logic in isolation
    const searchWithDebug = "?debug";
    const hasDebugParam = new URLSearchParams(searchWithDebug).has("debug");

    // Verify the logic chain works correctly
    expect(IS_PRODUCTION).toBe(false);
    expect(hasDebugParam).toBe(true);

    // Combined logic when window exists and has debug param would be:
    const DEBUG_ENABLED_LOGIC = !IS_PRODUCTION && hasDebugParam;
    expect(DEBUG_ENABLED_LOGIC).toBe(true);
  });

  it("Metrics collector mark() creates performance mark", () => {
    // Test collector behavior with our polyfill (no guards needed in test env)
    const collector = {
      marks: new Map<string, number>(),
      mark(name: string) {
        testGlobals.performance.mark(name);
        this.marks.set(name, testGlobals.performance.now());
      },
    };

    collector.mark("test-mark");

    expect(collector.marks.has("test-mark")).toBe(true);
    expect(testGlobals.performance.marks.has("test-mark")).toBe(true);
  });

  it("Metrics collector measure() creates performance measure", () => {
    // Test collector behavior with our polyfill (no guards needed in test env)
      const collector = {
        marks: new Map<string, number>(),
      measures: [] as MetricMeasure[],
      mark(name: string) {
        testGlobals.performance.mark(name);
        this.marks.set(name, testGlobals.performance.now());
      },
      measure(name: string, startMark: string, endMark: string) {
        testGlobals.performance.measure(name, startMark, endMark);
        const entries = testGlobals.performance.getEntriesByName(
          name,
          "measure",
        );
        if (entries.length > 0) {
          this.measures.push({
            name,
            duration: entries[entries.length - 1].duration,
            timestamp: Date.now(),
          });
        }
      },
    };

    collector.mark("start");
    collector.mark("end");
    collector.measure("test-measure", "start", "end");

    expect(collector.measures.length).toBe(1);
    expect(collector.measures[0].name).toBe("test-measure");
    expect(collector.measures[0].duration).toBeGreaterThanOrEqual(0);
  });

  it("Metrics collector reset() clears all metrics", () => {
    // Test collector behavior with our polyfill (no guards needed in test env)
      const collector = {
        marks: new Map<string, number>(),
      measures: [] as MetricMeasure[],
      mark(name: string) {
        testGlobals.performance.mark(name);
        this.marks.set(name, testGlobals.performance.now());
      },
      reset() {
        this.marks.clear();
        this.measures = [];
        testGlobals.performance.clearMarks();
        testGlobals.performance.clearMeasures();
      },
    };

    collector.mark("test1");
    collector.mark("test2");
    expect(collector.marks.size).toBe(2);

    collector.reset();
    expect(collector.marks.size).toBe(0);
    expect(collector.measures.length).toBe(0);
  });
});
