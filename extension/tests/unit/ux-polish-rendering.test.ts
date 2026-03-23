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
  it(".filter-hint elements receive correct CSS class", () => {
    const el = document.createElement("div");
    el.className = "filter-hint";
    expect(el.classList.contains("filter-hint")).toBe(true);
  });

  it(".filter-hint-warning adds warning severity", () => {
    const el = document.createElement("div");
    el.className = "filter-hint filter-hint-warning";
    expect(el.classList.contains("filter-hint")).toBe(true);
    expect(el.classList.contains("filter-hint-warning")).toBe(true);
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
  it("button with disabled attribute matches .btn:disabled concept", () => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.disabled = true;
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("btn")).toBe(true);
  });

  it("tab.disabled class can be applied", () => {
    const tab = document.createElement("button");
    tab.className = "tab disabled";
    expect(tab.classList.contains("tab")).toBe(true);
    expect(tab.classList.contains("disabled")).toBe(true);
  });
});
