/**
 * Filter Consistency Invariant Test (FR-028)
 *
 * Verifies that applying a dimension filter updates ALL dependent
 * summary card values consistently — no stale values from a prior
 * filter state survive a re-render.
 */

import {
  renderSummaryCards,
  type SummaryCardsContainers,
} from "../../ui/modules/charts/summary-cards";
import { applyFiltersToRollups } from "../../ui/modules/metrics";
import type { Rollup } from "../../ui/dataset-loader";

function makeContainersInCards(): SummaryCardsContainers {
  const make = (parent: HTMLElement) => {
    const el = document.createElement("span");
    parent.appendChild(el);
    return el;
  };

  // Each value element inside a .card so sample-size/sparkline-label injection works
  const cards: HTMLElement[] = [];
  const makeCard = () => {
    const card = document.createElement("div");
    card.className = "card";
    card.appendChild(document.createElement("h3"));
    document.body.appendChild(card);
    cards.push(card);
    return card;
  };

  return {
    totalPrs: make(makeCard()),
    cycleP50: make(makeCard()),
    cycleP90: make(makeCard()),
    reviewTimeP50: make(makeCard()),
    reviewTimeP90: make(makeCard()),
    authorsCount: make(makeCard()),
    reviewersCount: make(makeCard()),
    totalPrsSparkline: make(makeCard()),
    cycleP50Sparkline: make(makeCard()),
    cycleP90Sparkline: make(makeCard()),
    reviewTimeP50Sparkline: make(makeCard()),
    reviewTimeP90Sparkline: make(makeCard()),
    authorsSparkline: make(makeCard()),
    reviewersSparkline: make(makeCard()),
    totalPrsDelta: make(makeCard()),
    cycleP50Delta: make(makeCard()),
    cycleP90Delta: make(makeCard()),
    reviewTimeP50Delta: make(makeCard()),
    reviewTimeP90Delta: make(makeCard()),
    authorsDelta: make(makeCard()),
    reviewersDelta: make(makeCard()),
  };
}

describe("Filter consistency (FR-028)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("repo filter updates sample size and metric values — no stale unfiltered data", () => {
    const containers = makeContainersInCards();

    // Rollups with by_repository breakdown so filtering can slice
    const rollups: Rollup[] = [
      {
        week: "2025-W01",
        pr_count: 50,
        cycle_time_p50: 120,
        cycle_time_p90: 240,
        authors_count: 10,
        reviewers_count: 5,
        by_repository: {
          "repo-a": { pr_count: 20, cycle_time_p50: 80, cycle_time_p90: 160 },
          "repo-b": { pr_count: 30, cycle_time_p50: 150, cycle_time_p90: 300 },
        },
        by_team: null,
      },
      {
        week: "2025-W02",
        pr_count: 40,
        cycle_time_p50: 100,
        cycle_time_p90: 200,
        authors_count: 8,
        reviewers_count: 4,
        by_repository: {
          "repo-a": { pr_count: 15, cycle_time_p50: 70, cycle_time_p90: 140 },
          "repo-b": { pr_count: 25, cycle_time_p50: 120, cycle_time_p90: 240 },
        },
        by_team: null,
      },
    ];

    // Render unfiltered
    renderSummaryCards({ rollups, containers });
    const unfilteredTotalPrs = containers.totalPrs!.textContent;
    const unfilteredSample = document.querySelector(".metric-sample-size")?.textContent;

    // Total PRs should be 50 + 40 = 90
    expect(unfilteredTotalPrs).toBe("90");
    expect(unfilteredSample).toContain("90");

    // Apply repo-a filter and re-render
    const filtered = applyFiltersToRollups(rollups, {
      repos: ["repo-a"],
      teams: [],
    });
    renderSummaryCards({ rollups: filtered, containers });

    const filteredTotalPrs = containers.totalPrs!.textContent;
    const filteredSample = document.querySelector(".metric-sample-size")?.textContent;

    // After filter: repo-a has 20 + 15 = 35 PRs
    expect(filteredTotalPrs).toBe("35");
    expect(filteredSample).toContain("35");

    // Values must have changed — no stale "90" surviving
    expect(filteredTotalPrs).not.toBe(unfilteredTotalPrs);
  });
});

describe("Cross-component parity: sparkline labels, delta labels, and sample size derive from same filtered dataset", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // NOTE: These components intentionally use different scopes of the same filtered dataset:
  // - Sparkline labels: capped at SPARKLINE_LOOKBACK_WEEKS (8) — describes the chart visual
  // - Sample size: full filtered set — describes the metric derivation evidence
  // - Delta labels: full prev period — describes the comparison window
  // When rollups.length <= 8, all three agree. When > 8, sparkline caps but others don't.
  // This is by design — each label describes its own component's data scope.

  it("all labels agree when rollups fit within sparkline lookback window", () => {
    const containers = makeContainersInCards();

    const rollups: Rollup[] = Array.from({ length: 6 }, (_, i) => ({
      week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
      pr_count: 10,
      cycle_time_p50: 60 + i * 5,
      cycle_time_p90: 120 + i * 10,
      authors_count: 5,
      reviewers_count: 3,
      by_repository: null,
      by_team: null,
    }));
    const prevRollups: Rollup[] = Array.from({ length: 6 }, (_, i) => ({
      week: `2024-W${(i + 45).toString().padStart(2, "0")}`,
      pr_count: 8,
      cycle_time_p50: 55 + i * 5,
      cycle_time_p90: 110 + i * 10,
      authors_count: 4,
      reviewers_count: 2,
      by_repository: null,
      by_team: null,
    }));

    renderSummaryCards({ rollups, prevRollups, containers });

    // Sparkline label: "Last 6 weeks" (6 < 8, not capped)
    const sparklineLabel = document.querySelector(".sparkline-label");
    expect(sparklineLabel).not.toBeNull();
    expect(sparklineLabel!.textContent).toBe("Last 6 weeks");

    // Delta label: "vs prior 6 weeks" (aligned: 6 === 6)
    const deltaLabel = document.querySelector(".delta-label");
    expect(deltaLabel).not.toBeNull();
    expect(deltaLabel!.textContent).toBe("vs prior 6 weeks");

    // Sample size on totalPrs card: sum of pr_count from same 6 rollups (6 × 10 = 60)
    const prCard = containers.totalPrs!.closest(".card");
    const sampleEl = prCard?.querySelector(".metric-sample-size");
    expect(sampleEl).not.toBeNull();
    expect(sampleEl!.textContent).toBe("Based on 60 PRs");

    // Cycle card: week-based, uses cycleWeekCount from same 6 rollups
    const cycleCard = containers.cycleP50!.closest(".card");
    const cycleSample = cycleCard?.querySelector(".metric-sample-size");
    expect(cycleSample).not.toBeNull();
    expect(cycleSample!.textContent).toBe("From 6 weeks of data");
  });

  it("with > 8 rollups, sparkline caps but sample size and delta use full set", () => {
    const containers = makeContainersInCards();

    const rollups: Rollup[] = Array.from({ length: 12 }, (_, i) => ({
      week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
      pr_count: 5,
      cycle_time_p50: 60 + i * 3,
      cycle_time_p90: 120 + i * 6,
      authors_count: 4,
      reviewers_count: 2,
      by_repository: null,
      by_team: null,
    }));
    const prevRollups: Rollup[] = Array.from({ length: 12 }, (_, i) => ({
      week: `2024-W${(i + 40).toString().padStart(2, "0")}`,
      pr_count: 4,
      cycle_time_p50: 50 + i * 3,
      cycle_time_p90: 100 + i * 6,
      authors_count: 3,
      reviewers_count: 2,
      by_repository: null,
      by_team: null,
    }));

    renderSummaryCards({ rollups, prevRollups, containers });

    // Sparkline label: capped at 8
    const sparklineLabel = document.querySelector(".sparkline-label");
    expect(sparklineLabel!.textContent).toBe("Last 8 weeks");

    // Delta label: uses full prev period (12 weeks, aligned with current 12)
    const deltaLabel = document.querySelector(".delta-label");
    expect(deltaLabel!.textContent).toBe("vs prior 12 weeks");

    // Sample size on totalPrs card: full 12 rollups (12 × 5 = 60)
    const prCard = containers.totalPrs!.closest(".card");
    const sampleEl = prCard?.querySelector(".metric-sample-size");
    expect(sampleEl!.textContent).toBe("Based on 60 PRs");

    // Cycle card: full 12 weeks (all have non-null cycle_time_p50)
    const cycleCard = containers.cycleP50!.closest(".card");
    const cycleSample = cycleCard?.querySelector(".metric-sample-size");
    expect(cycleSample!.textContent).toBe("From 12 weeks of data");
  });
});
