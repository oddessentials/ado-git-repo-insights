/**
 * Summary Cards Info Icons Tests
 *
 * Tests the attachInfoIcons function and related tooltip behavior.
 * Covers: info icon rendering, pointerenter/pointerleave tooltip show/hide,
 * click toggle, re-render cleanup, and missing card graceful handling.
 */

// jsdom lacks PointerEvent — polyfill for tests
if (typeof PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
    }
  };
}

import {
  renderSummaryCards,
  METRIC_EXPLANATIONS,
  type SummaryCardsContainers,
} from "../../../ui/modules/charts/summary-cards";
import type { Rollup } from "../../../ui/dataset-loader";

/**
 * Build a .metric-card > h3 + value-el DOM structure for a given metric key.
 * Returns the value element (to place in the containers object).
 */
function buildCardDOM(metricKey: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "metric-card";

  const title = document.createElement("h3");
  title.textContent = metricKey;
  card.appendChild(title);

  const value = document.createElement("span");
  value.className = "metric-value";
  card.appendChild(value);

  document.body.appendChild(card);
  return value;
}

/**
 * Create containers with real card DOM structure (metric-card > h3 + value).
 */
function createContainersWithCards(): SummaryCardsContainers {
  return {
    totalPrs: buildCardDOM("Total PRs"),
    cycleP50: buildCardDOM("Cycle P50"),
    cycleP90: buildCardDOM("Cycle P90"),
    authorsCount: buildCardDOM("Authors"),
    reviewersCount: buildCardDOM("Reviewers"),
    totalPrsSparkline: document.createElement("div"),
    cycleP50Sparkline: document.createElement("div"),
    cycleP90Sparkline: document.createElement("div"),
    authorsSparkline: document.createElement("div"),
    reviewersSparkline: document.createElement("div"),
    totalPrsDelta: document.createElement("div"),
    cycleP50Delta: document.createElement("div"),
    cycleP90Delta: document.createElement("div"),
    authorsDelta: document.createElement("div"),
    reviewersDelta: document.createElement("div"),
  };
}

function createSampleRollups(): Rollup[] {
  return Array.from({ length: 4 }, (_, i) => ({
    week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
    pr_count: 10 + i * 5,
    cycle_time_p50: 60 + i * 10,
    cycle_time_p90: 120 + i * 20,
    authors_count: 5 + i,
    reviewers_count: 3 + i,
    by_repository: null,
    by_team: null,
  }));
}

describe("Summary Cards Info Icons (attachInfoIcons)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    // Clean up any tooltips
    document.querySelectorAll(".info-tooltip, .chart-tooltip").forEach(
      (el) => el.remove(),
    );
  });

  it("renders info icon for each of 5 summary cards", () => {
    const containers = createContainersWithCards();
    renderSummaryCards({ rollups: createSampleRollups(), containers });

    const infoIcons = document.querySelectorAll(".info-icon-btn");
    expect(infoIcons.length).toBe(5);
  });

  it("info icon has correct aria-label and data attribute", () => {
    const containers = createContainersWithCards();
    renderSummaryCards({ rollups: createSampleRollups(), containers });

    const icons = document.querySelectorAll(".info-icon-btn");
    icons.forEach((icon) => {
      expect(icon.getAttribute("aria-label")).toBe("About this metric");
      expect(icon.getAttribute("data-info-tooltip")).toBeTruthy();
    });
  });

  it("info icon shows tooltip on pointerenter", () => {
    const containers = createContainersWithCards();
    renderSummaryCards({ rollups: createSampleRollups(), containers });

    const firstIcon = document.querySelector(".info-icon-btn") as HTMLElement;
    // Mock getBoundingClientRect for positioning
    firstIcon.getBoundingClientRect = () => ({
      top: 100, left: 100, bottom: 120, right: 120,
      width: 20, height: 20, x: 100, y: 100,
      toJSON: () => ({}),
    });

    firstIcon.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));

    const tooltip = document.querySelector(".info-tooltip");
    expect(tooltip).not.toBeNull();
    // Tooltip should contain one of the metric explanations
    const metricId = firstIcon.getAttribute("data-info-tooltip");
    expect(metricId).toBeTruthy();
    const expectedText = METRIC_EXPLANATIONS[metricId!];
    expect(tooltip?.textContent).toBe(expectedText);
  });

  it("info icon hides tooltip on pointerleave", () => {
    const containers = createContainersWithCards();
    renderSummaryCards({ rollups: createSampleRollups(), containers });

    const firstIcon = document.querySelector(".info-icon-btn") as HTMLElement;
    firstIcon.getBoundingClientRect = () => ({
      top: 100, left: 100, bottom: 120, right: 120,
      width: 20, height: 20, x: 100, y: 100,
      toJSON: () => ({}),
    });

    // Show tooltip
    firstIcon.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).not.toBeNull();

    // Hide tooltip
    firstIcon.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("re-render removes old icon and creates new one (no duplicates)", () => {
    const containers = createContainersWithCards();
    const rollups = createSampleRollups();

    // First render
    renderSummaryCards({ rollups, containers });
    expect(document.querySelectorAll(".info-icon-btn").length).toBe(5);

    // Second render (re-render)
    renderSummaryCards({ rollups, containers });

    // Still exactly 5 icons — old ones removed, new ones created
    expect(document.querySelectorAll(".info-icon-btn").length).toBe(5);
  });

  it("re-render aborts old icon AbortControllers (no listener leaks)", () => {
    const containers = createContainersWithCards();
    const rollups = createSampleRollups();

    // First render
    renderSummaryCards({ rollups, containers });

    // Capture the first icon from first render
    const firstRenderIcon = document.querySelector(".info-icon-btn") as HTMLElement;
    firstRenderIcon.getBoundingClientRect = () => ({
      top: 100, left: 100, bottom: 120, right: 120,
      width: 20, height: 20, x: 100, y: 100,
      toJSON: () => ({}),
    });

    // Re-render
    renderSummaryCards({ rollups, containers });

    // The old icon was removed from DOM, so pointer events on it
    // should not create tooltips (AbortController aborted its listeners)
    firstRenderIcon.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("click toggles tooltip (show then dismiss)", () => {
    const containers = createContainersWithCards();
    renderSummaryCards({ rollups: createSampleRollups(), containers });

    const firstIcon = document.querySelector(".info-icon-btn") as HTMLElement;
    firstIcon.getBoundingClientRect = () => ({
      top: 100, left: 100, bottom: 120, right: 120,
      width: 20, height: 20, x: 100, y: 100,
      toJSON: () => ({}),
    });

    // Click to show
    firstIcon.click();
    expect(document.querySelector(".info-tooltip")).not.toBeNull();

    // Click again to dismiss
    firstIcon.click();
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("missing card container gracefully skips (no errors)", () => {
    // Create containers without card DOM structure — just plain elements
    const containers: SummaryCardsContainers = {
      totalPrs: document.createElement("span"),
      cycleP50: document.createElement("span"),
      cycleP90: document.createElement("span"),
      authorsCount: document.createElement("span"),
      reviewersCount: document.createElement("span"),
      totalPrsSparkline: document.createElement("div"),
      cycleP50Sparkline: document.createElement("div"),
      cycleP90Sparkline: document.createElement("div"),
      authorsSparkline: document.createElement("div"),
      reviewersSparkline: document.createElement("div"),
      totalPrsDelta: document.createElement("div"),
      cycleP50Delta: document.createElement("div"),
      cycleP90Delta: document.createElement("div"),
      authorsDelta: document.createElement("div"),
      reviewersDelta: document.createElement("div"),
    };

    // No .metric-card ancestor, so attachInfoIcons should skip gracefully
    expect(() => {
      renderSummaryCards({ rollups: createSampleRollups(), containers });
    }).not.toThrow();

    // No info icons should have been rendered
    expect(document.querySelectorAll(".info-icon-btn").length).toBe(0);
  });

  it("click-dismiss rAF path registers and fires dismissOnce listener (lines 324-328)", () => {
    jest.useFakeTimers();

    const containers = createContainersWithCards();
    renderSummaryCards({ rollups: createSampleRollups(), containers });

    const firstIcon = document.querySelector(".info-icon-btn") as HTMLElement;
    firstIcon.getBoundingClientRect = () => ({
      top: 100, left: 100, bottom: 120, right: 120,
      width: 20, height: 20, x: 100, y: 100,
      toJSON: () => ({}),
    });

    // Ensure no tooltip exists
    const existing = document.querySelector(".info-tooltip");
    if (existing) existing.remove();

    // Click to show tooltip (no existing tooltip -> enters the else branch)
    firstIcon.click();
    expect(document.querySelector(".info-tooltip")).not.toBeNull();

    // Advance to flush the rAF callback that adds the dismissOnce listener
    jest.advanceTimersByTime(16);

    // Now click on document to trigger dismissOnce
    document.dispatchEvent(new Event("click", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();

    jest.useRealTimers();
  });

  it("missing h3 in metric card gracefully skips", () => {
    // Create a card without h3
    const card = document.createElement("div");
    card.className = "metric-card";
    const value = document.createElement("span");
    card.appendChild(value);
    document.body.appendChild(card);

    const containers: SummaryCardsContainers = {
      totalPrs: value,
      cycleP50: null,
      cycleP90: null,
      authorsCount: null,
      reviewersCount: null,
      totalPrsSparkline: null,
      cycleP50Sparkline: null,
      cycleP90Sparkline: null,
      authorsSparkline: null,
      reviewersSparkline: null,
      totalPrsDelta: null,
      cycleP50Delta: null,
      cycleP90Delta: null,
      authorsDelta: null,
      reviewersDelta: null,
    };

    expect(() => {
      renderSummaryCards({ rollups: createSampleRollups(), containers });
    }).not.toThrow();

    // No info icons on cards without h3
    expect(document.querySelectorAll(".info-icon-btn").length).toBe(0);
  });
});
