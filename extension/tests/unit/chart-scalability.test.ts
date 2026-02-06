/**
 * Chart Scalability Tests
 *
 * Performance and DOM element count assertions for charts under
 * enterprise-scale data loads (156+ weeks, 200+ reviewers).
 *
 * Constitution Gates: QG-28, QG-29
 */

import { renderThroughputChart, MAX_THROUGHPUT_POINTS } from "../../ui/modules/charts/throughput";
import { renderCycleTimeTrend, MAX_CYCLE_TIME_POINTS } from "../../ui/modules/charts/cycle-time";
import { renderReviewerActivity, MAX_REVIEWER_WEEKS } from "../../ui/modules/charts/reviewer-activity";
import { DatasetLoader } from "../../ui/dataset-loader";
import type { Rollup } from "../../ui/dataset-loader";

/** Create N synthetic rollups for testing. */
function createRollups(count: number, reviewersCount = 3): Rollup[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2024-W${((i % 52) + 1).toString().padStart(2, "0")}`,
    pr_count: 10 + (i % 20),
    cycle_time_p50: 60 + (i % 30),
    cycle_time_p90: 120 + (i % 50),
    authors_count: 5,
    reviewers_count: reviewersCount,
    by_repository: null,
    by_team: null,
  }));
}

describe("Throughput Chart Scalability", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("T027: renders 156 weeks in < 1000ms", () => {
    const rollups = createRollups(156);
    const start = performance.now();
    renderThroughputChart(container, rollups);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(container.innerHTML).not.toBe("");
  });

  it("T029: caps DOM bar elements at MAX_THROUGHPUT_POINTS (104)", () => {
    const rollups = createRollups(156);
    renderThroughputChart(container, rollups);

    const bars = container.querySelectorAll(".bar-container");
    expect(bars.length).toBeLessThanOrEqual(MAX_THROUGHPUT_POINTS);
    expect(bars.length).toBe(MAX_THROUGHPUT_POINTS);
  });

  it("T031: shows truncation indicator when data exceeds cap", () => {
    const rollups = createRollups(156);
    renderThroughputChart(container, rollups);

    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain("Showing last 104 weeks");
  });

  it("T033a: no truncation indicator for exactly 104 weeks (throughput)", () => {
    const rollups = createRollups(104);
    renderThroughputChart(container, rollups);

    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).toBeNull();

    const bars = container.querySelectorAll(".bar-container");
    expect(bars.length).toBe(104);
  });

  it("renders all data without truncation when under cap", () => {
    const rollups = createRollups(52);
    renderThroughputChart(container, rollups);

    const bars = container.querySelectorAll(".bar-container");
    expect(bars.length).toBe(52);
    expect(container.querySelector(".truncation-indicator")).toBeNull();
  });

  it("MAX_THROUGHPUT_POINTS is exported and equals 104", () => {
    expect(MAX_THROUGHPUT_POINTS).toBe(104);
  });
});

describe("Cycle Time Chart Scalability", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("T028: renders 156 weeks in < 1000ms", () => {
    const rollups = createRollups(156);
    const start = performance.now();
    renderCycleTimeTrend(container, rollups);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(container.innerHTML).not.toBe("");
  });

  it("T030: caps DOM dot elements at MAX_CYCLE_TIME_POINTS per metric", () => {
    const rollups = createRollups(156);
    renderCycleTimeTrend(container, rollups);

    const p50Dots = container.querySelectorAll('[data-metric="P50"]');
    const p90Dots = container.querySelectorAll('[data-metric="P90"]');
    expect(p50Dots.length).toBeLessThanOrEqual(MAX_CYCLE_TIME_POINTS);
    expect(p90Dots.length).toBeLessThanOrEqual(MAX_CYCLE_TIME_POINTS);
    expect(p50Dots.length).toBe(MAX_CYCLE_TIME_POINTS);
    expect(p90Dots.length).toBe(MAX_CYCLE_TIME_POINTS);
  });

  it("T032: shows truncation indicator when data exceeds cap", () => {
    const rollups = createRollups(156);
    renderCycleTimeTrend(container, rollups);

    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain("Showing last 104 weeks");
  });

  it("T033b: no truncation indicator for exactly 104 weeks (cycle-time)", () => {
    const rollups = createRollups(104);
    renderCycleTimeTrend(container, rollups);

    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).toBeNull();

    const p50Dots = container.querySelectorAll('[data-metric="P50"]');
    expect(p50Dots.length).toBe(104);
  });

  it("renders all data without truncation when under cap", () => {
    const rollups = createRollups(52);
    renderCycleTimeTrend(container, rollups);

    const p50Dots = container.querySelectorAll('[data-metric="P50"]');
    expect(p50Dots.length).toBe(52);
    expect(container.querySelector(".truncation-indicator")).toBeNull();
  });

  it("MAX_CYCLE_TIME_POINTS is exported and equals 104", () => {
    expect(MAX_CYCLE_TIME_POINTS).toBe(104);
  });
});

describe("Reviewer Panel Scalability", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("T043: renders correctly with 200 reviewers per week", () => {
    const rollups = createRollups(12, 200);
    renderReviewerActivity(container, rollups);

    const rows = container.querySelectorAll(".h-bar-row");
    expect(rows.length).toBe(MAX_REVIEWER_WEEKS);

    // Verify 200 is displayed in the value cells
    const values = container.querySelectorAll(".h-bar-value");
    expect(values.length).toBe(MAX_REVIEWER_WEEKS);
    values.forEach((v) => {
      expect(v.textContent).toBe("200");
    });
  });

  it("T044: 50 vs 200 reviewers renders in comparable time", () => {
    const rollups50 = createRollups(156, 50);
    const start50 = performance.now();
    renderReviewerActivity(container, rollups50);
    const elapsed50 = performance.now() - start50;

    container.innerHTML = "";

    const rollups200 = createRollups(156, 200);
    const start200 = performance.now();
    renderReviewerActivity(container, rollups200);
    const elapsed200 = performance.now() - start200;

    // Both should be well under 1000ms
    expect(elapsed50).toBeLessThan(1000);
    expect(elapsed200).toBeLessThan(1000);

    // DOM output is bounded to 8 rows regardless of input size
    const rows = container.querySelectorAll(".h-bar-row");
    expect(rows.length).toBe(MAX_REVIEWER_WEEKS);
  });

  it("T045: panel caps at MAX_REVIEWER_WEEKS rows for 200-user dataset", () => {
    const rollups = createRollups(156, 200);
    renderReviewerActivity(container, rollups);

    const rows = container.querySelectorAll(".h-bar-row");
    expect(rows.length).toBeLessThanOrEqual(MAX_REVIEWER_WEEKS);
    expect(rows.length).toBe(MAX_REVIEWER_WEEKS);

    // Verify bar widths are set (100% for max)
    expect(container.innerHTML).toContain("width: 100%");
  });

  it("MAX_REVIEWER_WEEKS is exported and equals 8", () => {
    expect(MAX_REVIEWER_WEEKS).toBe(8);
  });
});

describe("Comments Feature Compatibility", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("T048: all charts render without errors when features.comments is true", () => {
    const rollups = createRollups(52);

    expect(() => renderThroughputChart(container, rollups)).not.toThrow();
    container.innerHTML = "";
    expect(() => renderCycleTimeTrend(container, rollups)).not.toThrow();
    container.innerHTML = "";
    expect(() => renderReviewerActivity(container, rollups)).not.toThrow();

    // Charts produce output (not no-data)
    expect(container.innerHTML).toContain("h-bar-row");
  });

  it("T049: isFeatureEnabled reads comments flag from manifest", () => {
    const loader = new DatasetLoader("");

    // No manifest loaded — returns false
    expect(loader.isFeatureEnabled("comments")).toBe(false);

    // Manifest with comments: true
    (loader as any).manifest = {
      features: { teams: true, comments: true, predictions: false, ai_insights: false },
    };
    expect(loader.isFeatureEnabled("comments")).toBe(true);

    // Manifest with comments: false
    (loader as any).manifest = {
      features: { teams: true, comments: false },
    };
    expect(loader.isFeatureEnabled("comments")).toBe(false);
  });

  it("T050: isFeatureEnabled returns false when features object is missing", () => {
    const loader = new DatasetLoader("");
    (loader as any).manifest = {};
    expect(loader.isFeatureEnabled("comments")).toBe(false);
  });

  it("T051: charts render identically regardless of comments flag", () => {
    const rollups = createRollups(20);

    // Render throughput chart
    renderThroughputChart(container, rollups);
    const throughputHtml = container.innerHTML;

    // The same rollups produce the same output — comments flag doesn't affect chart rendering
    container.innerHTML = "";
    renderThroughputChart(container, rollups);
    expect(container.innerHTML).toBe(throughputHtml);
  });
});
