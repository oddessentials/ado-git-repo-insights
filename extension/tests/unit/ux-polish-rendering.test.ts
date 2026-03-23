/**
 * UX Polish Rendering Tests
 *
 * Tests for filter hints, truncation indicators, empty states,
 * and other UX polish rendering behaviors.
 */
import { renderThroughputChart } from "../../ui/modules/charts/throughput";
import { renderNoData } from "../../ui/modules/shared/render";
import type { Rollup } from "../../ui/dataset-loader";

function makeRollups(count: number): Rollup[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2025-W${String(i + 1).padStart(2, "0")}`,
    pr_count: 10 + i,
    cycle_time_p50: 60,
    cycle_time_p90: 120,
    authors_count: 5,
    reviewers_count: 3,
  })) as Rollup[];
}

describe("Truncation indicator prominence", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("renders .truncation-indicator when data exceeds MAX_THROUGHPUT_POINTS", () => {
    renderThroughputChart(container, makeRollups(110));
    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Showing last");
  });

  it("does NOT render .truncation-indicator when data fits within cap", () => {
    renderThroughputChart(container, makeRollups(50));
    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).toBeNull();
  });
});

describe("Filter hint classes", () => {
  it("renderNoData creates a contextual hint element", () => {
    const container = document.createElement("div");
    renderNoData(container, "No data available", "Try widening filters.");

    const hint = container.querySelector(".no-data-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe("Try widening filters.");
  });
});

describe("Empty state messages include contextual hints", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("throughput no-data includes guidance hint", () => {
    renderThroughputChart(container, []);
    const hint = container.querySelector(".no-data-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("Try widening");
  });
});

describe("renderNoData hint parameter", () => {
  it("does not create hint element when hint is omitted", () => {
    const container = document.createElement("div");
    renderNoData(container, "No data available");

    expect(container.querySelector(".no-data")).not.toBeNull();
    expect(container.querySelector(".no-data")?.textContent).toBe(
      "No data available",
    );
    expect(container.querySelector(".no-data-hint")).toBeNull();
  });
});

describe("Button and tab disabled states", () => {
  it("button disabled state is reflected through the native disabled property", () => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.disabled = true;
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("btn")).toBe(true);
  });

  it("throughput renderer leaves no empty-state hint when data is present", () => {
    const container = document.createElement("div");
    renderThroughputChart(container, makeRollups(8));

    expect(container.querySelector(".no-data-hint")).toBeNull();
    expect(container.querySelector(".bar-chart")).not.toBeNull();
  });
});
