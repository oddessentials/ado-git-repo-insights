/**
 * FR-010 / SC-001 — period-scoped PR list rendered DOM order is
 * `cycle_time desc, id asc` across the cross-rollup union (#363).
 *
 * The producer guarantees per-rollup sort within each `prs[]` slice.
 * The consumer's re-sort is what makes the cross-rollup union
 * monotonically ordered for the rendered list. This test exercises
 * BOTH the cycle-time descending sort AND the id-ascending tiebreak
 * by seeding a multi-week fixture where the union is NOT already in
 * the target order.
 */

import { installSparklineNavigator } from "../../../ui/modules/drilldown/sparkline-navigator";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
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

function makePr(id: number, cycleMinutes: number): PrRecord {
  return {
    id,
    title: `PR ${id}`,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function makeRollup(week: string, prs: readonly PrRecord[]): Rollup {
  return {
    week,
    start_date: "2025-03-17",
    end_date: "2025-03-23",
    pr_count: prs.length,
    cycle_time_p50: 60,
    cycle_time_p90: 120,
    authors_count: 1,
    reviewers_count: 0,
    by_repository: null,
    by_team: null,
    prs,
    _prs_truncated: false,
    _prs_cap: 500,
  };
}

function mountSummaryCardsWithThroughput(): HTMLElement {
  const container = document.createElement("div");
  container.className = "summary-cards";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sparkline-trigger";
  button.setAttribute("data-drilldown-target-chart", "throughput");
  button.setAttribute("aria-label", "Open full throughput chart");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  button.appendChild(svg);
  container.appendChild(button);
  document.body.appendChild(container);
  return container;
}

function mountTargetChart(): void {
  const el = document.createElement("div");
  el.id = "throughput-chart";
  document.body.appendChild(el);
}

const FIXTURE_OPTIONS = {
  filters: { repos: [], teams: [], reviewers: [], authors: [] },
  repositoriesDimension: [
    {
      repository_id: "repo-1",
      repository_name: "web-app",
      project_name: "Frontend",
      organization_name: "acme",
    },
  ],
  webContext: { collectionUri: "https://dev.azure.com/acme/" },
  authorsDimension: [],
  commentsMetricsAvailable: false,
};

describe("period-scoped PR list rendered DOM order (FR-010 / SC-001)", () => {
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

  it("rendered <li> sequence is `cycle_time desc, id asc` across cross-rollup union (incl. id-tiebreak)", () => {
    // Week 1: id=5 cycle=300m (slow on idx 0); id=3 cycle=600m (fast on idx 1)
    // Week 2: id=7 cycle=200m; id=2 cycle=600m
    // Union order should be: id=2 (600), id=3 (600), id=5 (300), id=7 (200)
    // Tiebreak between id=2 and id=3 (both 600m) is id ascending → 2 before 3.
    const w1 = makeRollup("2025-W12", [makePr(5, 300), makePr(3, 600)]);
    const w2 = makeRollup("2025-W13", [makePr(7, 200), makePr(2, 600)]);

    const container = mountSummaryCardsWithThroughput();
    mountTargetChart();
    installSparklineNavigator(container, [w1, w2], FIXTURE_OPTIONS);

    const trigger = container.querySelector<HTMLElement>(
      "button.sparkline-trigger",
    );
    if (!trigger) throw new Error("trigger missing");
    click(trigger);

    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        "#pr-detail ol.detail-panel-pr-list li.detail-panel-pr-row a",
      ),
    );
    const rendered = links.map((a) => a.textContent ?? "");
    // Anchor text shape: "#${id} — ${title}" per renderPrListSection.
    expect(rendered).toEqual([
      "#2 — PR 2",
      "#3 — PR 3",
      "#5 — PR 5",
      "#7 — PR 7",
    ]);
  });
});
