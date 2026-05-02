/**
 * FR-008 / FR-010 — Reviewer PR list rendered-count parity (Feature 362).
 *
 * Mirrors `cycle-time-pr-list-count-parity.test.ts` (#361) and the
 * cross-cutting count-parity contract from feature 060.  Two assertions
 * per the consumer contract
 * (`specs/362-reviewer-pr-drilldown/contracts/reviewer-pr-list.md` § 12):
 *
 *   - Non-truncation: rendered row count equals `sum(K_i)` across the
 *     reviewer's participating weeks where `K_i` is each week's
 *     `prs.length` (under non-truncation `K_i == reviewed_prs`).
 *   - Truncation in any week: rendered row count equals
 *     `sum(min(K_i, _prs_cap))` and the truncation cue is rendered.
 *
 * The truncation cue is owned by the shared renderer and fires when
 * `renderedCount < actualFilteredCount`; with `actualFilteredCount =
 * sum(reviewed_prs)`, any truncated week (where `reviewed_prs > prs.length`)
 * produces the cue automatically.
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

function makeRollup(
  week: string,
  prs: readonly PrRecord[],
  options: { reviewedPrs?: number; truncated?: boolean; cap?: number } = {},
): Rollup {
  const entry: ReviewerBreakdownEntry = {
    reviewed_prs: options.reviewedPrs ?? prs.length,
    reviews_count: options.reviewedPrs ?? prs.length,
    approval_rate: 1.0,
    repositories_count: 1,
    prs,
    _prs_truncated: options.truncated ?? false,
    _prs_cap: options.cap ?? 500,
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

function filtersWithReviewer(): FilterState {
  return {
    repos: [],
    teams: [],
    reviewers: [REVIEWER_ID],
    authors: [],
  };
}

function fullOptions(): ReviewerDrilldownOptions {
  return {
    reviewersDimension: REVIEWERS_DIM,
    filters: filtersWithReviewer(),
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
    filters: filtersWithReviewer(),
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

function renderedRowCount(): number {
  return document.querySelectorAll("#pr-detail ol li").length;
}

describe("reviewer PR list rendered-count parity (FR-008 / FR-010)", () => {
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

  it("non-truncated: rendered row count equals sum(K_i) across participating weeks", () => {
    // Reviewer participates in 3 weeks with K_1=2, K_2=3, K_3=4.  No
    // truncation, no overlay → rendered count == 2 + 3 + 4 == 9.
    const w10 = makeRollup("2025-W10", [makePr(1, 100), makePr(2, 200)]);
    const w11 = makeRollup("2025-W11", [
      makePr(11, 110),
      makePr(12, 220),
      makePr(13, 330),
    ]);
    const w12 = makeRollup("2025-W12", [
      makePr(21, 105),
      makePr(22, 205),
      makePr(23, 305),
      makePr(24, 405),
    ]);
    const rollups = [w10, w11, w12];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    expect(renderedRowCount()).toBe(9);
    // No truncation cue under non-truncation.
    expect(
      document.querySelector("#pr-detail .truncation-indicator"),
    ).toBeNull();
  });

  it("truncated: rendered count equals sum(min(K_i, _prs_cap)) and truncation cue surfaces", () => {
    // W11 is truncated: 500 visible records, but reviewed_prs=700 (the
    // producer dropped 200).  W10 / W12 untruncated.  Rendered row count
    // should equal sum(2 + 500 + 4) = 506.  The shared renderer's cue
    // fires because `renderedCount < actualFilteredCount`
    // (actualFilteredCount = sum(reviewed_prs) = 2 + 700 + 4 = 706).
    const w10 = makeRollup("2025-W10", [makePr(1, 100), makePr(2, 200)]);
    const truncatedPrs: PrRecord[] = [];
    for (let i = 0; i < 500; i += 1) {
      // ids 1000..1499; cycle-times spaced from 1500 down to 1001 so the
      // sort order is deterministic and well-separated from W10 / W12.
      truncatedPrs.push(makePr(1000 + i, 1500 - i));
    }
    const w11 = makeRollup("2025-W11", truncatedPrs, {
      reviewedPrs: 700,
      truncated: true,
      cap: 500,
    });
    const w12 = makeRollup("2025-W12", [
      makePr(2001, 90),
      makePr(2002, 80),
      makePr(2003, 70),
      makePr(2004, 60),
    ]);
    const rollups = [w10, w11, w12];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    expect(renderedRowCount()).toBe(2 + 500 + 4);
    const indicator = document.querySelector(
      "#pr-detail .truncation-indicator",
    );
    expect(indicator).not.toBeNull();
    const indicatorText = indicator!.textContent ?? "";
    // The cue mentions both the rendered count (506) and the
    // pre-truncation total (706).
    expect(indicatorText).toContain("506");
    expect(indicatorText).toContain("706");
  });
});
