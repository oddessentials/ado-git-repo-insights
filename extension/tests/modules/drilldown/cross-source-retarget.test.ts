/**
 * Cross-source panel retarget regression-lock (Codex stop-time review
 * on #363 post-commit 4682bd53).
 *
 * The four drill-down installs (`throughput-drilldown`,
 * `cycle-time-drilldown`, `reviewer-drilldown`, `sparkline-navigator`)
 * each keep a private `activeTrigger` reference and a
 * `MutationObserver` that fires only on `is-open` class removal
 * (panel close), not on retarget-in-place content swap. That means
 * one install cannot directly clear another install's active-trigger
 * state on a cross-source retarget. The shared `openDetailPanel`
 * module is the single authority that sees both contexts (via
 * `activeContext`), so the dispel-on-supersession lives there and is
 * pinned by the unit test in `tests/modules/shared/detail-panel.test.ts`.
 *
 * This integration test mounts both a real throughput chart drill-down
 * and a real sparkline-navigator install, drives a cross-source click
 * sequence (throughput chart bar → sparkline trigger), and asserts the
 * end-to-end DOM state is coherent — proving the installed surfaces
 * actually use the shared panel-side cleanup, not just the primitive.
 */

import { renderThroughputChart } from "../../../ui/modules/charts/throughput";
import { installThroughputDrilldown } from "../../../ui/modules/drilldown/throughput-drilldown";
import { installSparklineNavigator } from "../../../ui/modules/drilldown/sparkline-navigator";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type { PrRecord } from "../../../ui/schemas/rollup.schema";

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

function makePr(id: number, cycleMinutes: number, title: string): PrRecord {
  return {
    id,
    title,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function makeRollup(
  week: string,
  start_date: string,
  end_date: string,
  prs: readonly PrRecord[],
): Rollup {
  return {
    week,
    start_date,
    end_date,
    pr_count: prs.length,
    cycle_time_p50: 60 * 4,
    cycle_time_p90: 60 * 18,
    authors_count: 1,
    reviewers_count: 0,
    by_repository: {
      "repo-1": {
        pr_count: prs.length,
        cycle_time_p50: 60 * 4,
        cycle_time_p90: 60 * 18,
      },
    },
    by_team: null,
    prs,
    _prs_truncated: false,
    _prs_cap: 500,
  };
}

const FIXTURE_REPOS = [
  {
    repository_id: "repo-1",
    repository_name: "web-app",
    project_name: "Frontend",
    organization_name: "acme",
  },
];

function mountThroughputChart(rollups: readonly Rollup[]): HTMLElement {
  const container = document.createElement("div");
  container.id = "throughput-chart";
  document.body.appendChild(container);
  renderThroughputChart(container, [...rollups]);
  return container;
}

function mountSparklineCards(): HTMLElement {
  const container = document.createElement("div");
  container.className = "summary-cards";
  // throughput sparkline trigger
  const throughputBtn = document.createElement("button");
  throughputBtn.type = "button";
  throughputBtn.className = "sparkline-trigger";
  throughputBtn.setAttribute("data-drilldown-target-chart", "throughput");
  throughputBtn.setAttribute("aria-label", "Open full throughput chart");
  const tSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  throughputBtn.appendChild(tSvg);
  container.appendChild(throughputBtn);
  document.body.appendChild(container);
  return container;
}

function throughputBarFor(chart: HTMLElement, weekIso: string): HTMLElement {
  const bar = chart.querySelector<HTMLElement>(
    `[data-drilldown-week="${weekIso}"]`,
  );
  if (!bar) throw new Error(`bar for ${weekIso} not rendered`);
  return bar;
}

function sparklineTrigger(container: HTMLElement): HTMLElement {
  const btn = container.querySelector<HTMLElement>(
    'button.sparkline-trigger[data-drilldown-target-chart="throughput"]',
  );
  if (!btn) throw new Error("sparkline trigger not rendered");
  return btn;
}

describe("cross-source panel retarget", () => {
  beforeEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  it("throughput chart bar → sparkline trigger clears the chart bar's is-drilldown-active state", () => {
    const rollups = [
      makeRollup("2025-W12", "2025-03-17", "2025-03-23", [
        makePr(101, 800, "feat: oauth"),
        makePr(102, 500, "refactor: hooks"),
      ]),
      makeRollup("2025-W13", "2025-03-24", "2025-03-30", [
        makePr(201, 900, "fix: race"),
      ]),
    ];

    const chart = mountThroughputChart(rollups);
    const sparklineCards = mountSparklineCards();

    installThroughputDrilldown(chart, rollups, {
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      repositoriesDimension: FIXTURE_REPOS,
      webContext: { collectionUri: "https://dev.azure.com/acme/" },
      authorsDimension: [],
      commentsMetricsAvailable: false,
    });
    installSparklineNavigator(sparklineCards, rollups, {
      filters: {
        repos: [] as string[],
        teams: [] as string[],
        reviewers: [] as string[],
        authors: [] as string[],
      },
      repositoriesDimension: FIXTURE_REPOS,
      webContext: { collectionUri: "https://dev.azure.com/acme/" },
      authorsDimension: [],
      commentsMetricsAvailable: false,
    });

    // Open via throughput chart bar — chart-source is now active.
    const bar = throughputBarFor(chart, "2025-W12");
    click(bar);

    expect(isDetailPanelOpen()).toBe(true);
    expect(bar.classList.contains("is-drilldown-active")).toBe(true);
    expect(bar.getAttribute("aria-expanded")).toBe("true");

    // Retarget across sources: clicking the sparkline trigger swaps
    // the panel content to the sparkline source.
    const sparkBtn = sparklineTrigger(sparklineCards);
    click(sparkBtn);

    // Panel still open (retarget-in-place, no close/reopen).
    expect(isDetailPanelOpen()).toBe(true);

    // Previous chart bar lost its active state.
    expect(bar.classList.contains("is-drilldown-active")).toBe(false);
    expect(bar.getAttribute("aria-expanded")).toBe("false");

    // Sparkline trigger picked up the active state.
    expect(sparkBtn.classList.contains("is-drilldown-active")).toBe(true);
    expect(sparkBtn.getAttribute("aria-expanded")).toBe("true");
  });
});
