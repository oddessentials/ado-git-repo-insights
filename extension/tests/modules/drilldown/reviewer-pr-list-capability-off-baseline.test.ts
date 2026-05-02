/**
 * FR-026 — Capability-off DOM byte-identity for the reviewer PR list (Feature 362).
 *
 * Mirrors the throughput equivalent at
 * `extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts`
 * and the cycle-time equivalent at
 * `extension/tests/modules/drilldown/cycle-time-pr-list-capability-off-baseline.test.ts`.
 * Renders `installReviewerDrilldown` against a deterministic synthetic
 * fixture with `commentsMetricsAvailable: false` and non-empty per-
 * (reviewer, week) `prs[]` arrays for the focused reviewer; compares the
 * resulting `<section id="pr-detail">` innerHTML byte-for-byte to the
 * committed golden at
 * `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html`.
 *
 * Fails on any drift — tag, attribute order, class set, whitespace, etc.
 * Regenerate the golden with:
 *
 *   REGENERATE_REVIEWER_CAPABILITY_OFF_BASELINE=1 \
 *     pnpm --dir extension test -- reviewer-pr-list-capability-off-baseline
 *
 * The shared renderer in `detail-panel.ts` owns the byte shape; this test
 * locks it for the reviewer consumer surface so a future change to either
 * renderer or consumer surfaces a deliberate baseline update.
 */

import * as path from "node:path";

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
import {
  ensureDir,
  readTextFile,
  writeTextFile,
} from "../../helpers/fs-test-utils";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GOLDEN_PATH = path.join(
  REPO_ROOT,
  "extension",
  "tests",
  "fixtures",
  "reviewer-drilldown-capability-off-baseline.html",
);

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

function makePr(id: number, cycleMinutes: number, title: string): PrRecord {
  return {
    id,
    title,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function fixtureRollup(): Rollup {
  const entry: ReviewerBreakdownEntry = {
    reviewed_prs: 3,
    reviews_count: 3,
    approval_rate: 1.0,
    repositories_count: 1,
    // Producer-emitted order: cycle_time desc, id asc.  Capability-off
    // means no thread/comment/active-thread fields on each PrRecord.
    prs: [
      makePr(101, 800, "feat: oauth"),
      makePr(102, 500, "refactor: hooks"),
      makePr(103, 200, "fix: null guard"),
    ],
    _prs_truncated: false,
    _prs_cap: 500,
  };
  return {
    week: "2025-W12",
    pr_count: 3,
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
    // Capability-off: the renderer omits the comments-metrics columns,
    // sort buttons, filter, and coverage notice.
    commentsMetricsAvailable: false,
  };
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

describe("reviewer PR list capability-off DOM byte-identity (FR-026)", () => {
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

  it('renders <section id="pr-detail"> byte-identically to the committed golden', () => {
    const rollup = fixtureRollup();
    const container = document.createElement("div");
    container.id = "reviewer-activity";
    document.body.appendChild(container);
    renderReviewerActivity(container, [rollup], {
      reviewerFilterActive: true,
      filters: filtersWithReviewer(),
    });
    installReviewerDrilldown(container, [rollup], fullOptions());

    click(rowFor(container, rollup.week));

    const prSection = document.getElementById("pr-detail");
    if (prSection === null) {
      throw new Error("pr-detail section missing after drill-down click");
    }
    const actual = prSection.innerHTML;

    if (process.env.REGENERATE_REVIEWER_CAPABILITY_OFF_BASELINE === "1") {
      ensureDir(path.dirname(GOLDEN_PATH));
      // Trailing newline keeps the pre-commit `end-of-file-fixer` hook
      // happy; the comparison normalizes trailing whitespace on both
      // sides so that normalization can never drift the test.
      writeTextFile(GOLDEN_PATH, `${actual}\n`);
      return;
    }

    const expected = readTextFile(GOLDEN_PATH).replace(/\s+$/, "");
    expect(actual.replace(/\s+$/, "")).toBe(expected);
  });

  it("contains no comments-metrics surface in the capability-off DOM", () => {
    const rollup = fixtureRollup();
    const container = document.createElement("div");
    container.id = "reviewer-activity";
    document.body.appendChild(container);
    renderReviewerActivity(container, [rollup], {
      reviewerFilterActive: true,
      filters: filtersWithReviewer(),
    });
    installReviewerDrilldown(container, [rollup], fullOptions());

    click(rowFor(container, rollup.week));

    const prSection = document.getElementById("pr-detail")!;
    // Belt-and-braces structural assertions — the byte-identity check
    // guards every drift, but these surface regressions about the
    // comments-metrics surface with a readable message.
    expect(prSection.querySelectorAll(".comments-metric").length).toBe(0);
    expect(prSection.querySelector(".detail-panel-pr-list-filter")).toBeNull();
    expect(
      prSection.querySelector(".detail-panel-pr-list-controls"),
    ).toBeNull();
    expect(
      prSection.querySelector(".detail-panel-pr-list-coverage-notice"),
    ).toBeNull();
    const list = prSection.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(false);
  });
});
