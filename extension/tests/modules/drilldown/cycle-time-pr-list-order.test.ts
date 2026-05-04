/**
 * FR-019 — Rendered DOM order assertion for the cycle-time PR list.
 *
 * The cycle-time drill-down's `prs` array is sorted `cycle_time desc, id asc`
 * by the producer. The cycle-time consumer trusts that order and does NOT
 * re-sort.
 *
 * This test does not seed unsorted input; order correctness is
 * producer-owned, and this consumer test verifies preservation of the
 * producer-provided order. The assertion inspects the rendered DOM
 * (the `<ol>` row sequence inside `#pr-detail`), not the input array,
 * so the contract holds whether the implementation trusts the producer
 * or sorts in the consumer.
 *
 * The test fails if the consumer reorders, drops, or duplicates rows;
 * it also fires immediately if a future producer change ever drifts the
 * array order.
 */

import { renderCycleTimeTrend } from "../../../ui/modules/charts/cycle-time";
import { installCycleTimeDrilldown } from "../../../ui/modules/drilldown/cycle-time-drilldown";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type { PrRecord } from "../../../ui/schemas/rollup.schema";

const BASE_WEB_CTX = { collectionUri: "https://dev.azure.com/acme/" };
const BASE_REPOS = [
  {
    repository_id: "repo-1",
    repository_name: "web-app",
    project_name: "Frontend",
    organization_name: "acme",
  },
];

function supportedOptions(): {
  filters: {
    repos: string[];
    teams: string[];
    reviewers: string[];
    authors: string[];
  };
  repositoriesDimension: typeof BASE_REPOS;
  webContext: typeof BASE_WEB_CTX;
  authorsDimension: never[];
  commentsMetricsAvailable: boolean;
} {
  return {
    filters: { repos: [], teams: [], reviewers: [], authors: [] },
    repositoriesDimension: BASE_REPOS,
    webContext: BASE_WEB_CTX,
    authorsDimension: [],
    commentsMetricsAvailable: false,
  };
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

function makePr(id: number, cycleMinutes: number): PrRecord {
  return {
    id,
    title: `PR ${id}`,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function makeRollup(week: string, prs: PrRecord[]): Rollup {
  return {
    week,
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

function mountChart(rollups: Rollup[]): HTMLElement {
  const container = document.createElement("div");
  container.id = "cycle-time-trend";
  document.body.appendChild(container);
  renderCycleTimeTrend(container, rollups);
  return container;
}

function dotFor(
  container: HTMLElement,
  week: string,
  metric: "p50" | "p90",
): HTMLElement {
  const dot = container.querySelector<HTMLElement>(
    `g[data-drilldown-week="${week}"][data-drilldown-metric="${metric}"]`,
  );
  if (!dot) throw new Error(`dot for ${week}/${metric} not rendered`);
  return dot;
}

function renderedRowIds(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLLIElement>("#pr-detail ol li"),
  ).map((li) => {
    const text = li.querySelector("a")!.textContent ?? "";
    const match = text.match(/^#(\d+)/);
    if (!match) throw new Error(`row link missing #id prefix: "${text}"`);
    return Number.parseInt(match[1]!, 10);
  });
}

describe("cycle-time PR list rendered DOM order (FR-019)", () => {
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

  it("preserves producer order when rows have distinct cycle times — slowest first", () => {
    // Producer-emitted order: cycle_time desc, id asc.
    // 800 → 500 → 200, ids 101 → 103 → 102.
    const prs = [makePr(101, 800), makePr(103, 500), makePr(102, 200)];
    const rollups = [
      makeRollup("2025-W10", [makePr(1, 60)]),
      makeRollup("2025-W11", prs),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups, supportedOptions());

    click(dotFor(container, "2025-W11", "p90"));

    expect(renderedRowIds()).toEqual([101, 103, 102]);
  });

  it("preserves producer order when rows tie on cycle time — id ascending tiebreak", () => {
    // Producer-emitted order: cycle_time desc, id asc. Three rows tie at 300
    // → producer emits ids 200 < 201 < 202 in id-ascending order.
    const prs = [makePr(200, 300), makePr(201, 300), makePr(202, 300)];
    const rollups = [
      makeRollup("2025-W10", [makePr(1, 60)]),
      makeRollup("2025-W11", prs),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups, supportedOptions());

    click(dotFor(container, "2025-W11", "p90"));

    expect(renderedRowIds()).toEqual([200, 201, 202]);
  });

  it("renders every input row exactly once — no drops, no duplicates", () => {
    // Mixed: ties + distinct values. Producer emits in cycle_time desc,
    // id asc — duplicating, dropping, or shuffling any row breaks the
    // contract.
    const prs = [
      makePr(10, 900),
      makePr(20, 600),
      makePr(21, 600),
      makePr(30, 400),
      makePr(31, 400),
      makePr(40, 100),
    ];
    const rollups = [
      makeRollup("2025-W10", [makePr(1, 60)]),
      makeRollup("2025-W11", prs),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups, supportedOptions());

    click(dotFor(container, "2025-W11", "p90"));

    expect(renderedRowIds()).toEqual([10, 20, 21, 30, 31, 40]);
  });
});
