/**
 * FR-008 / FR-010 — Reviewer PR list rendered-count parity (Feature 362).
 *
 * Mirrors `cycle-time-pr-list-count-parity.test.ts` (#361) and the
 * cross-cutting count-parity contract from feature 060.  Two assertions
 * per the consumer contract:
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

  it("author overlay reducing rows does NOT fire the truncation cue when no week is truncated", () => {
    // Regression: previously, ``actualFilteredCount`` was
    // sum(reviewed_prs) regardless of overlay state, so the renderer's
    // ``renderedCount < actualFilteredCount`` cue gate would fire
    // whenever an author/repo overlay reduced visible rows -- even
    // though the gap was the user's filter, not the per-(reviewer,
    // week) 500-cap.  The cue text "Showing X of Y matching PRs
    // (top 500 by cycle time)" was misleading in that case because
    // the cap was not the gating factor.  This test locks the fixed
    // behavior: when the overlay reduces rows but no week is truncated,
    // ``actualFilteredCount === renderedCount`` and the cue does NOT
    // fire.
    // Build a per-(reviewer, week) entry inline (without spreading from
    // the helper-built rollup) so the test does not need a bracket-
    // indexed lookup on `by_reviewer` -- the same construction shape
    // `makeRollup` uses, just with mixed author_ids on the PR records.
    const reviewerEntry: ReviewerBreakdownEntry = {
      reviewed_prs: 3,
      reviews_count: 3,
      approval_rate: 1.0,
      repositories_count: 1,
      prs: [
        {
          id: 101,
          title: "PR 101",
          author_id: "author-a",
          repository_id: "repo-1",
          cycle_time: 800,
        },
        {
          id: 102,
          title: "PR 102",
          author_id: "author-b",
          repository_id: "repo-1",
          cycle_time: 600,
        },
        {
          id: 103,
          title: "PR 103",
          author_id: "author-a",
          repository_id: "repo-1",
          cycle_time: 400,
        },
      ],
      _prs_truncated: false,
      _prs_cap: 500,
    };
    const w10Modified: Rollup = {
      week: "2025-W10",
      pr_count: 3,
      cycle_time_p50: null,
      cycle_time_p90: null,
      authors_count: 2,
      reviewers_count: 1,
      by_repository: null,
      by_team: null,
      by_reviewer: { [REVIEWER_ID]: reviewerEntry },
    };
    const rollups = [w10Modified];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, {
      reviewersDimension: REVIEWERS_DIM,
      filters: {
        repos: [],
        teams: [],
        reviewers: [REVIEWER_ID],
        authors: ["author-a"],
      },
      repositoriesDimension: FIXTURE_REPOS,
      webContext: FIXTURE_WEB_CTX,
      authorsDimension: [],
      commentsMetricsAvailable: false,
    });

    click(rowFor(container, "2025-W10"));

    // Only the 2 author-a PRs render; author-b is filtered out by the
    // overlay.  Cue MUST stay silent because no week was truncated.
    expect(renderedRowCount()).toBe(2);
    expect(
      document.querySelector("#pr-detail .truncation-indicator"),
    ).toBeNull();
  });

  it("defensive: truncation cue surfaces when producer emits a clipped slice without setting _prs_truncated (contract § 6 safety net)", () => {
    // Contract § 6 second clause: "the rendered count is strictly less
    // than the sum of ``reviewed_prs`` across participating weeks
    // (defensive -- would only fire if the producer drops to truncation
    // after emission, which is a contract violation)".  This locks the
    // safety net: even if the producer emits ``_prs_truncated: false``
    // while ``prs.length < reviewed_prs`` (e.g., a future producer
    // change drops PRs with non-finite cycle_time without flagging the
    // slice), the consumer MUST surface the cue -- otherwise the user
    // would see ``rows.length`` rendered rows believing they are the
    // complete set, when in fact the producer silently dropped some.
    const reviewerEntry: ReviewerBreakdownEntry = {
      reviewed_prs: 5, // producer reports 5 reviewed PRs
      reviews_count: 5,
      approval_rate: 1.0,
      repositories_count: 1,
      // ...but only emits 3.  No author/repo overlay; no _prs_truncated
      // flag.  This is a contract violation that the defensive clause
      // catches.
      prs: [
        {
          id: 301,
          title: "PR 301",
          author_id: "author-default",
          repository_id: "repo-1",
          cycle_time: 800,
        },
        {
          id: 302,
          title: "PR 302",
          author_id: "author-default",
          repository_id: "repo-1",
          cycle_time: 600,
        },
        {
          id: 303,
          title: "PR 303",
          author_id: "author-default",
          repository_id: "repo-1",
          cycle_time: 400,
        },
      ],
      _prs_truncated: false,
      _prs_cap: 500,
    };
    const w10Violation: Rollup = {
      week: "2025-W10",
      pr_count: 5,
      cycle_time_p50: null,
      cycle_time_p90: null,
      authors_count: 1,
      reviewers_count: 1,
      by_repository: null,
      by_team: null,
      by_reviewer: { [REVIEWER_ID]: reviewerEntry },
    };
    const rollups = [w10Violation];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    // 3 visible PRs rendered; cue fires because collected.length (3)
    // < totalReviewedPrs (5).  Cue text mentions the clipped count
    // (3) and the reviewer-reported total (5).
    expect(renderedRowCount()).toBe(3);
    const indicator = document.querySelector(
      "#pr-detail .truncation-indicator",
    );
    expect(indicator).not.toBeNull();
    const indicatorText = indicator!.textContent ?? "";
    expect(indicatorText).toContain("3");
    expect(indicatorText).toContain("5");
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
