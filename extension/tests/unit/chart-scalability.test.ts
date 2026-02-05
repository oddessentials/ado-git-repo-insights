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
import type { Rollup } from "../../ui/dataset-loader";

/** Create N synthetic rollups for testing. */
function createRollups(count: number): Rollup[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2024-W${((i % 52) + 1).toString().padStart(2, "0")}`,
    pr_count: 10 + (i % 20),
    cycle_time_p50: 60 + (i % 30),
    cycle_time_p90: 120 + (i % 50),
    authors_count: 5,
    reviewers_count: 3,
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
    expect(indicator!.textContent).toContain("Showing last 2 years");
    expect(indicator!.textContent).toContain("104 weeks");
  });

  it("T033: no truncation indicator for exactly 104 weeks", () => {
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
    expect(indicator!.textContent).toContain("Showing last 2 years");
    expect(indicator!.textContent).toContain("104 weeks");
  });

  it("T033: no truncation indicator for exactly 104 weeks", () => {
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
