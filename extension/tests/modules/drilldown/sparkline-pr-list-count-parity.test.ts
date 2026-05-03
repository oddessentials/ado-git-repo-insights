/**
 * FR-007 / FR-008 / FR-009 / SC-003 — period-scoped PR list count
 * parity (#363).
 *
 * Mirrors `cycle-time-pr-list-count-parity.test.ts` for the sparkline-
 * driven panel. Three contracts:
 *
 *   1. Un-truncated multi-week window: rendered row count equals
 *      `sum(per-rollup prs.length)` (== `collected.length`); truncation
 *      cue is NOT rendered.
 *   2. At least one truncated rollup (`_prs_truncated: true`): rendered
 *      row count equals `collected.length`; truncation cue text IS
 *      rendered; cue mentions both the rendered count and the period
 *      total `pr_count` sum (= `actualFilteredCount` per LD-1 step 8).
 *   3. Defensive clause — collected count strictly less than period
 *      total `pr_count` sum without `anyTruncated` set: cue still
 *      rendered (producer contract violation safety net, mirrors
 *      reviewer-drilldown contract § 6 second clause).
 *
 * Per #367, the cue parenthetical for the period-scoped union is
 * `(top {capValue} per week by cycle time)` — the loose-substring
 * assertions below check the count tokens without pinning the full
 * literal so a future copy revision does not require a test update
 * (the byte-pin lives in pr-list-comments-columns.test.ts).
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

function makeRollup(
  week: string,
  prs: readonly PrRecord[],
  overrides: { pr_count?: number; truncated?: boolean; cap?: number } = {},
): Rollup {
  return {
    week,
    start_date: "2025-03-17",
    end_date: "2025-03-23",
    pr_count: overrides.pr_count ?? prs.length,
    cycle_time_p50: 60,
    cycle_time_p90: 120,
    authors_count: 1,
    reviewers_count: 0,
    by_repository: null,
    by_team: null,
    prs,
    _prs_truncated: overrides.truncated ?? false,
    _prs_cap: overrides.cap ?? 500,
  };
}

function mountSummaryCards(): HTMLElement {
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

function renderedRowCount(): number {
  return document.querySelectorAll(
    "#pr-detail ol.detail-panel-pr-list li.detail-panel-pr-row",
  ).length;
}

function truncationCueText(): string | null {
  const el = document.querySelector<HTMLElement>(
    "#pr-detail .truncation-indicator",
  );
  return el ? (el.textContent ?? "") : null;
}

describe("period-scoped PR list count parity (FR-007 / FR-008 / FR-009)", () => {
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

  it("un-truncated multi-week window: rendered rows == sum(prs.length); no truncation cue", () => {
    const w12 = makeRollup("2025-W12", [makePr(1, 100), makePr(2, 200)]);
    const w13 = makeRollup("2025-W13", [
      makePr(11, 150),
      makePr(12, 250),
      makePr(13, 350),
    ]);
    const w14 = makeRollup("2025-W14", [makePr(21, 50)]);

    const container = mountSummaryCards();
    mountTargetChart();
    installSparklineNavigator(container, [w12, w13, w14], FIXTURE_OPTIONS);
    click(container.querySelector<HTMLElement>("button.sparkline-trigger")!);

    expect(renderedRowCount()).toBe(2 + 3 + 1);
    expect(truncationCueText()).toBeNull();
  });

  it("at least one truncated rollup: cue rendered, count tokens present", () => {
    // W13 reports pr_count=700 with prs.length=500 (clipped) — truncated
    // contract. The other weeks are un-truncated. Total rendered should
    // equal sum of prs.length (502); cue mentions both 502 and the
    // period total (705).
    const w12 = makeRollup("2025-W12", [makePr(1, 100), makePr(2, 200)]);
    const w13Truncated: PrRecord[] = [];
    for (let i = 0; i < 500; i += 1) {
      w13Truncated.push(makePr(1000 + i, 1500 - i));
    }
    const w13 = makeRollup("2025-W13", w13Truncated, {
      pr_count: 700,
      truncated: true,
      cap: 500,
    });
    const w14 = makeRollup("2025-W14", []);

    const container = mountSummaryCards();
    mountTargetChart();
    installSparklineNavigator(container, [w12, w13, w14], FIXTURE_OPTIONS);
    click(container.querySelector<HTMLElement>("button.sparkline-trigger")!);

    expect(renderedRowCount()).toBe(2 + 500 + 0);
    const text = truncationCueText();
    expect(text).not.toBeNull();
    // Rendered count (502) + period total (702) appear in the cue.
    expect(text).toContain("502");
    expect(text).toContain("702");
  });

  it("defensive: cue surfaces when collected count < sum(pr_count) even with truncated:false", () => {
    // W12 reports pr_count=5 but emits only 3 PRs in `prs` and
    // `_prs_truncated: false`. This is a producer contract violation;
    // the consumer's defensive clause MUST still surface the cue so
    // the user is not misled into thinking 3 rows is the complete set.
    const w12 = makeRollup(
      "2025-W12",
      [makePr(1, 100), makePr(2, 200), makePr(3, 300)],
      { pr_count: 5, truncated: false, cap: 500 },
    );

    const container = mountSummaryCards();
    mountTargetChart();
    installSparklineNavigator(container, [w12], FIXTURE_OPTIONS);
    click(container.querySelector<HTMLElement>("button.sparkline-trigger")!);

    expect(renderedRowCount()).toBe(3);
    const text = truncationCueText();
    expect(text).not.toBeNull();
    expect(text).toContain("3");
    expect(text).toContain("5");
  });
});
