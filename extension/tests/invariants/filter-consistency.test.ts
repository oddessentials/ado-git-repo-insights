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
