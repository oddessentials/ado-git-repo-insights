/**
 * Prod-Shape Edge Case Tests (P4 Guardrail)
 *
 * Tests production data shapes that synthetic data never produces:
 * - Zero-PR weeks, null cycle times, empty breakdowns
 * - Single-metric rollups, large history truncation
 * - Synthetic vs degraded-prod mismatch detection
 *
 * Ensures the rendering pipeline surfaces differences rather than
 * silently swallowing them.
 */

import { renderThroughputChart } from "../../ui/modules/charts/throughput";
import { renderCycleTimeTrend } from "../../ui/modules/charts/cycle-time";
import {
  renderReviewerActivity,
  MAX_REVIEWER_WEEKS,
} from "../../ui/modules/charts/reviewer-activity";
import { normalizeRollup } from "../../ui/dataset-loader";
import type { Rollup } from "../../ui/dataset-loader";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestRollups(count: number): Rollup[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2025-W${String(i + 1).padStart(2, "0")}`,
    pr_count: 10 + i * 5,
    cycle_time_p50: 60 + i * 10,
    cycle_time_p90: 120 + i * 20,
    authors_count: 5 + i,
    reviewers_count: 3 + i,
    by_repository: null,
    by_team: null,
  }));
}

/** Degraded prod-like rollups with characteristics synthetic data never produces. */
function makeDegradedProdRollups(): Rollup[] {
  return [
    // Zero-PR week (synthetic min is 1)
    {
      week: "2025-W01",
      pr_count: 0,
      cycle_time_p50: null,
      cycle_time_p90: null,
      authors_count: 0,
      reviewers_count: 0,
      by_repository: null,
      by_team: {},
    },
    // Normal week with empty breakdowns
    {
      week: "2025-W02",
      pr_count: 15,
      cycle_time_p50: 45,
      cycle_time_p90: 90,
      authors_count: 3,
      reviewers_count: 2,
      by_repository: {},
      by_team: {},
    },
    // Week with only P50, no P90
    {
      week: "2025-W03",
      pr_count: 8,
      cycle_time_p50: 30,
      cycle_time_p90: null,
      authors_count: 2,
      reviewers_count: 1,
      by_repository: null,
      by_team: null,
    },
    // Week with only P90, no P50
    {
      week: "2025-W04",
      pr_count: 12,
      cycle_time_p50: null,
      cycle_time_p90: 100,
      authors_count: 4,
      reviewers_count: 3,
      by_repository: null,
      by_team: null,
    },
    // Another normal week for trend line minimum
    {
      week: "2025-W05",
      pr_count: 20,
      cycle_time_p50: 55,
      cycle_time_p90: 110,
      authors_count: 6,
      reviewers_count: 4,
      by_repository: null,
      by_team: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Zero-PR weeks
// ---------------------------------------------------------------------------

describe("Zero-PR weeks", () => {
  it("throughput renders bar with height 0% for zero-PR week", () => {
    const rollups: Rollup[] = [
      {
        week: "2025-W01",
        pr_count: 0,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 0,
        reviewers_count: 0,
        by_repository: null,
        by_team: null,
      },
      {
        week: "2025-W02",
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      },
    ];
    const container = document.createElement("div");
    renderThroughputChart(container, rollups);

    const bars = container.querySelectorAll(".bar-container");
    expect(bars.length).toBe(2);
    // First bar should have 0% height
    expect(container.innerHTML).toContain("height: 0%");
  });

  it("cycle-time trend handles weeks with null p50/p90 gracefully", () => {
    const rollups: Rollup[] = [
      {
        week: "2025-W01",
        pr_count: 0,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 0,
        reviewers_count: 0,
        by_repository: null,
        by_team: null,
      },
      ...makeTestRollups(4),
    ];
    const container = document.createElement("div");
    renderCycleTimeTrend(container, rollups);

    // Should render without throwing — null values filtered out
    expect(container.innerHTML).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Empty breakdowns
// ---------------------------------------------------------------------------

describe("Empty breakdowns", () => {
  it("null vs empty object breakdowns normalize through normalizeRollup", () => {
    const withNull = normalizeRollup({
      week: "2025-W01",
      pr_count: 5,
    });
    const withEmpty = normalizeRollup({
      week: "2025-W01",
      pr_count: 5,
      by_team: {},
      by_repository: {},
    });

    // Both should be valid rollups
    expect(withNull.week).toBe("2025-W01");
    expect(withEmpty.week).toBe("2025-W01");
    // null = feature not available, {} = feature available but empty
    expect(withNull.by_team).toBeNull();
    expect(withEmpty.by_team).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Single-metric rollups
// ---------------------------------------------------------------------------

describe("Single-metric rollups", () => {
  it("cycle-time trend renders without crash when P90 is all null", () => {
    const rollups: Rollup[] = Array.from({ length: 4 }, (_, i) => ({
      week: `2025-W${String(i + 1).padStart(2, "0")}`,
      pr_count: 10,
      cycle_time_p50: 60 + i * 10,
      cycle_time_p90: null,
      authors_count: 5,
      reviewers_count: 3,
      by_repository: null,
      by_team: null,
    }));
    const container = document.createElement("div");

    expect(() => renderCycleTimeTrend(container, rollups)).not.toThrow();
    // Should render something (either chart or no-data message)
    expect(container.innerHTML).not.toBe("");
  });

  it("cycle-time trend renders without crash when P50 is all null", () => {
    const rollups: Rollup[] = Array.from({ length: 4 }, (_, i) => ({
      week: `2025-W${String(i + 1).padStart(2, "0")}`,
      pr_count: 10,
      cycle_time_p50: null,
      cycle_time_p90: 120 + i * 20,
      authors_count: 5,
      reviewers_count: 3,
      by_repository: null,
      by_team: null,
    }));
    const container = document.createElement("div");

    expect(() => renderCycleTimeTrend(container, rollups)).not.toThrow();
    expect(container.innerHTML).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Large history truncation visibility
// ---------------------------------------------------------------------------

describe("Large history truncation visibility", () => {
  it("reviewer-activity shows .truncation-indicator when rollups exceed MAX_REVIEWER_WEEKS", () => {
    const rollups = makeTestRollups(20);
    const container = document.createElement("div");
    renderReviewerActivity(container, rollups);

    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain("Showing last");
    expect(indicator!.textContent).toContain(
      String(MAX_REVIEWER_WEEKS),
    );
  });

  it("reviewer-activity does NOT show .truncation-indicator when within limit", () => {
    const rollups = makeTestRollups(6);
    const container = document.createElement("div");
    renderReviewerActivity(container, rollups);

    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).toBeNull();
  });

  it("reviewer-activity shows exactly MAX_REVIEWER_WEEKS bars when truncated", () => {
    const rollups = makeTestRollups(20);
    const container = document.createElement("div");
    renderReviewerActivity(container, rollups);

    const bars = container.querySelectorAll(".h-bar-row");
    expect(bars.length).toBe(MAX_REVIEWER_WEEKS);
  });
});

// ---------------------------------------------------------------------------
// Synthetic vs degraded-prod mismatch detection
// ---------------------------------------------------------------------------

describe("Synthetic vs degraded-prod mismatch detection", () => {
  it("degraded prod dataset renders all charts without silent empty containers", () => {
    const degradedRollups = makeDegradedProdRollups();

    // Throughput chart
    const throughputContainer = document.createElement("div");
    renderThroughputChart(throughputContainer, degradedRollups);
    expect(throughputContainer.innerHTML).not.toBe("");
    // Must have EITHER bars OR a no-data message — never silently empty
    const hasBars =
      throughputContainer.querySelectorAll(".bar-container").length > 0;
    const hasNoData =
      throughputContainer.querySelectorAll(".no-data").length > 0;
    expect(hasBars || hasNoData).toBe(true);

    // Cycle-time trend
    const cycleContainer = document.createElement("div");
    renderCycleTimeTrend(cycleContainer, degradedRollups);
    expect(cycleContainer.innerHTML).not.toBe("");

    // Reviewer activity
    const reviewerContainer = document.createElement("div");
    renderReviewerActivity(reviewerContainer, degradedRollups);
    expect(reviewerContainer.innerHTML).not.toBe("");
    const hasReviewerBars =
      reviewerContainer.querySelectorAll(".h-bar-row").length > 0;
    const hasReviewerNoData =
      reviewerContainer.querySelectorAll(".no-data").length > 0;
    expect(hasReviewerBars || hasReviewerNoData).toBe(true);
  });

  it("synthetic and degraded-prod datasets produce different but valid outputs", () => {
    const syntheticRollups = makeTestRollups(8);
    const degradedRollups = makeDegradedProdRollups();

    // Render throughput with both
    const syntheticContainer = document.createElement("div");
    const degradedContainer = document.createElement("div");
    renderThroughputChart(syntheticContainer, syntheticRollups);
    renderThroughputChart(degradedContainer, degradedRollups);

    // Outputs must differ (proving the test isn't vacuous)
    expect(syntheticContainer.innerHTML).not.toBe(
      degradedContainer.innerHTML,
    );

    // Both must contain valid chart structure
    expect(
      syntheticContainer.querySelectorAll(".bar-container").length,
    ).toBeGreaterThan(0);
    expect(
      degradedContainer.querySelectorAll(".bar-container").length,
    ).toBeGreaterThan(0);
  });
});
