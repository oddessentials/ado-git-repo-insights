/**
 * FR-019 — Rendered DOM order for the reviewer PR list (Feature 362).
 *
 * The reviewer drill-down's per-(reviewer, week) `prs[]` slice is sorted
 * `cycle_time desc, id asc` BY THE PRODUCER WITHIN EACH WEEK, but the
 * cross-week union must be re-sorted at the consumer because per-week
 * slices are independent (data-model.md § 6).  This test seeds a multi-
 * week fixture where the cross-week union has a non-trivial order and
 * asserts the rendered `<ol>` row sequence inside `#pr-detail` matches
 * `cycle_time desc, id asc`, with `id` ascending as the tiebreak.
 *
 * The assertion inspects the rendered DOM, not the input array, so the
 * contract holds whether the consumer re-sorts explicitly or relies on
 * stable cross-week merge.  Failure modes covered:
 *
 *   - Cross-week order drift (rows from a later week appear before rows
 *     from an earlier week even though the latter's cycle-times are
 *     higher).
 *   - Tied-cycle-time tiebreak failure (id-ascending order not preserved
 *     when two rows have identical cycle-times).
 *   - Row drops or duplications (cardinality assertion).
 *
 * The single source of truth for sort semantics is the PR-list contract
 * (`specs/362-reviewer-pr-drilldown/contracts/reviewer-pr-list.md` § 8)
 * and the producer contract (`per-reviewer-week-prs.md` § 3).
 */

import { renderReviewerActivity } from "../../../ui/modules/charts/reviewer-activity";
import {
  installReviewerDrilldown,
  type ReviewerDrilldownOptions,
} from "../../../ui/modules/drilldown/reviewer-drilldown";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type {
  PrRecord,
  ReviewerBreakdownEntry,
} from "../../../ui/schemas/rollup.schema";
import type { FilterState } from "../../../ui/modules/filters";

const REVIEWER_ID = "alice@example.com";
const REVIEWERS_DIM = [
  { reviewer_id: REVIEWER_ID, reviewer_name: "Alice Anderson" },
];

const FIXTURE_WEB_CTX = { collectionUri: "https://dev.azure.com/acme/" };
const FIXTURE_REPOS = [
  {
    repository_id: "repo-1",
    repository_name: "web-app",
    project_name: "Frontend",
    organization_name: "acme",
  },
];

function makePr(id: number, cycleMinutes: number): PrRecord {
  return {
    id,
    title: `PR ${id}`,
    author_id: "author-default",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function makeRollup(week: string, prs: readonly PrRecord[]): Rollup {
  const entry: ReviewerBreakdownEntry = {
    reviewed_prs: prs.length,
    reviews_count: prs.length,
    approval_rate: 1.0,
    repositories_count: 1,
    prs,
    _prs_truncated: false,
    _prs_cap: 500,
  };
  return {
    week,
    pr_count: prs.length,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 1,
    reviewers_count: 1,
    by_repository: null,
    by_team: null,
    by_reviewer: { [REVIEWER_ID]: entry },
  };
}

function filtersWithReviewer(reviewerId: string): FilterState {
  return {
    repos: [],
    teams: [],
    reviewers: [reviewerId],
    authors: [],
  };
}

function fullOptions(): ReviewerDrilldownOptions {
  return {
    reviewersDimension: REVIEWERS_DIM,
    filters: filtersWithReviewer(REVIEWER_ID),
    repositoriesDimension: FIXTURE_REPOS,
    webContext: FIXTURE_WEB_CTX,
    authorsDimension: [],
    commentsMetricsAvailable: false,
  };
}

function mountChart(rollups: Rollup[]): HTMLElement {
  const container = document.createElement("div");
  container.id = "reviewer-activity";
  document.body.appendChild(container);
  renderReviewerActivity(container, rollups, {
    reviewerFilterActive: true,
    filters: filtersWithReviewer(REVIEWER_ID),
  });
  return container;
}

function rowFor(container: HTMLElement, week: string): HTMLElement {
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>(".h-bar-row"),
  );
  const match = rows.find((r) =>
    (r.getAttribute("title") ?? "").startsWith(week),
  );
  if (!match) throw new Error(`h-bar-row for week ${week} not rendered`);
  return match;
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
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

describe("reviewer PR list rendered DOM order (FR-019)", () => {
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

  it("preserves cross-week sort: slowest cycle-time first, regardless of source week", () => {
    // W10 cycle-times [60, 30] and W11 [45, 25] → cross-week union sorted
    // by cycle_time desc → [60(W10), 45(W11), 30(W10), 25(W11)].
    const w10 = makeRollup("2025-W10", [makePr(101, 60), makePr(102, 30)]);
    const w11 = makeRollup("2025-W11", [makePr(201, 45), makePr(202, 25)]);
    const rollups = [w10, w11];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    expect(renderedRowIds()).toEqual([101, 201, 102, 202]);
  });

  it("preserves id-ascending tiebreak when cross-week PRs share cycle-time", () => {
    // Three rows tie at cycle_time=300 across two weeks; ids 200 < 201 < 202
    // → sorted union is [200, 201, 202] regardless of source week.
    const w10 = makeRollup("2025-W10", [makePr(202, 300)]);
    const w11 = makeRollup("2025-W11", [makePr(200, 300), makePr(201, 300)]);
    const rollups = [w10, w11];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    expect(renderedRowIds()).toEqual([200, 201, 202]);
  });

  it("renders every input row exactly once across the cross-week union — no drops, no duplicates", () => {
    // Mixed: ties + distinct values across two weeks.  Total 6 rows; the
    // rendered union must preserve cardinality and sort.  Producer-emitted
    // order within each week is `cycle_time desc, id asc`.
    const w10 = makeRollup("2025-W10", [
      makePr(10, 900),
      makePr(20, 600),
      makePr(30, 400),
    ]);
    const w11 = makeRollup("2025-W11", [
      makePr(21, 600),
      makePr(31, 400),
      makePr(40, 100),
    ]);
    const rollups = [w10, w11];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W11"));

    expect(renderedRowIds()).toEqual([10, 20, 21, 30, 31, 40]);
  });
});
