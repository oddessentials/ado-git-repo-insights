/**
 * Reviewer drill-down unit tests (US3).
 *
 * Covers `extension/ui/modules/drilldown/reviewer-drilldown.ts` per
 * `specs/059-chart-drill-down/contracts/drilldown-integration.md` and
 * spec.md FR-040 / FR-041 / FR-042 / FR-043: delegated click + keyboard
 * activation on `.h-bar-row` targets, total reviews / PRs reviewed,
 * weighted approval rate with empty-state variant, peak repository
 * breadth with qualifying week label, per-week activity table, and
 * MutationObserver-backed `is-drilldown-active` lifecycle.
 */

import * as path from "node:path";

import { readJsonFile } from "../../helpers/fs-test-utils";
import { renderReviewerActivity } from "../../../ui/modules/charts/reviewer-activity";
import {
  installReviewerDrilldown,
  type ReviewerDrilldownOptions,
} from "../../../ui/modules/drilldown/reviewer-drilldown";
import {
  publishComparisonToggled,
  publishFiltersChanged,
} from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type { FilterState } from "../../../ui/modules/filters";
import type {
  PrRecord,
  ReviewerBreakdownEntry,
} from "../../../ui/schemas/rollup.schema";

if (typeof PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent =
    class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVIEWER_ID = "alice@example.com";
const REVIEWER_NAME = "Alice Anderson";
const REVIEWERS_DIM = [
  { reviewer_id: REVIEWER_ID, reviewer_name: REVIEWER_NAME },
];

interface ReviewerWeek {
  week: string;
  reviewers_count: number;
  reviewsCount: number;
  reviewedPrs: number;
  approvalRate: number | null;
  repositoriesCount?: number;
}

function makeRollup(weekData: ReviewerWeek, reviewerId = REVIEWER_ID): Rollup {
  return {
    week: weekData.week,
    pr_count: weekData.reviewedPrs * 2,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 5,
    reviewers_count: weekData.reviewers_count,
    by_repository: null,
    by_team: null,
    by_reviewer: {
      [reviewerId]: {
        reviews_count: weekData.reviewsCount,
        reviewed_prs: weekData.reviewedPrs,
        approval_rate: weekData.approvalRate,
        repositories_count: weekData.repositoriesCount,
      },
    },
  };
}

function makeDefaultRollups(): Rollup[] {
  return [
    makeRollup({
      week: "2025-W10",
      reviewers_count: 3,
      reviewsCount: 12,
      reviewedPrs: 8,
      approvalRate: 0.75,
      repositoriesCount: 3,
    }),
    makeRollup({
      week: "2025-W11",
      reviewers_count: 4,
      reviewsCount: 20,
      reviewedPrs: 10,
      approvalRate: 0.8,
      repositoriesCount: 5,
    }),
    makeRollup({
      week: "2025-W12",
      reviewers_count: 2,
      reviewsCount: 6,
      reviewedPrs: 4,
      approvalRate: 0.5,
      repositoriesCount: 2,
    }),
  ];
}

function filtersWith(reviewerId: string | null): FilterState {
  return {
    repos: [],
    teams: [],
    reviewers: reviewerId ? [reviewerId] : [],
    authors: [],
  };
}

function mountChart(
  rollups: Rollup[],
  reviewerFilterActive = true,
  reviewerId: string | null = REVIEWER_ID,
): HTMLElement {
  const container = document.createElement("div");
  container.id = "reviewer-activity";
  document.body.appendChild(container);
  renderReviewerActivity(container, rollups, {
    reviewerFilterActive,
    filters: filtersWith(reviewerId),
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("reviewer-drilldown", () => {
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

  // -------------------------------------------------------------------------
  // Activation + panel shape
  // -------------------------------------------------------------------------

  it("click on a reviewer row opens the panel with the resolved reviewer name as title", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, {
      reviewersDimension: REVIEWERS_DIM,
    });

    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(true);
    // #308: the title is the friendly name, not the reviewer_id GUID.
    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      REVIEWER_NAME,
    );
  });

  it("panel title uses the reviewer_id verbatim when reviewersDimension is missing", () => {
    // REVIEWER_ID is "alice@example.com" — an email. With no
    // dimension the title shows the id verbatim.
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      REVIEWER_ID,
    );
  });

  it("panel title uses the reviewer_id verbatim when it is not present in the dimension", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, {
      reviewersDimension: [
        { reviewer_id: "someone-else", reviewer_name: "Other Person" },
      ],
    });

    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      REVIEWER_ID,
    );
  });

  it("panel title renders a UUID-shaped reviewer_id verbatim when missing from the dimension (rare-exception path)", () => {
    // Reshape: GUIDs surface as a cosmetic leak in partial-dimension
    // cases rather than crashing the panel. Title is ugly but the
    // panel renders and the id correlates with upstream data.
    const uuidReviewerId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const rollups = [
      makeRollup(
        {
          week: "2025-W10",
          reviewers_count: 3,
          reviewsCount: 5,
          reviewedPrs: 3,
          approvalRate: 0.8,
        },
        uuidReviewerId,
      ),
    ];
    const container = mountChart(rollups, true, uuidReviewerId);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      uuidReviewerId,
    );
  });

  it("subtitle reports total PRs reviewed across the active period", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    // 8 + 10 + 4 = 22 PRs reviewed
    expect(document.querySelector(".detail-panel-subtitle")!.textContent).toBe(
      "22 PRs reviewed",
    );
  });

  it("stat row contains total reviews, PRs reviewed, approval rate, peak repositories", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    const labels = Array.from(document.querySelectorAll("dl dt")).map(
      (dt) => dt.textContent,
    );
    const values = Array.from(document.querySelectorAll("dl dd")).map(
      (dd) => dd.textContent,
    );
    expect(labels).toEqual([
      "Total reviews",
      "PRs reviewed",
      "Approval rate",
      "Peak repositories",
    ]);
    // Totals: reviews = 12+20+6 = 38; PRs = 22; approval weighted:
    // (0.75*8 + 0.8*10 + 0.5*4) / (8+10+4) = 16/22 = 0.727 -> 73%
    // Peak repos: 5 in W11
    expect(values).toEqual(["38", "22", "73%", "5 (W11)"]);
  });

  it("approval rate renders 'No data' when not computable (e.g. all null rates)", () => {
    const rollups = [
      makeRollup({
        week: "2025-W10",
        reviewers_count: 3,
        reviewsCount: 5,
        reviewedPrs: 0, // 0 PRs => weighted denominator 0 => null rate
        approvalRate: null,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    const labels = Array.from(document.querySelectorAll("dl dt")).map(
      (dt) => dt.textContent,
    );
    const values = Array.from(document.querySelectorAll("dl dd")).map(
      (dd) => dd.textContent,
    );
    expect(labels[2]).toBe("Approval rate (no data)");
    expect(values[2]).toBe("—");
  });

  it("peak repositories stat falls back to '0' when no rollups carry repositories_count", () => {
    const rollups = [
      makeRollup({
        week: "2025-W10",
        reviewers_count: 3,
        reviewsCount: 5,
        reviewedPrs: 4,
        approvalRate: 0.5,
        repositoriesCount: undefined,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    const values = Array.from(document.querySelectorAll("dl dd")).map(
      (dd) => dd.textContent,
    );
    expect(values[3]).toBe("0");
  });

  it("weekly activity table renders one row per week with reviewer data", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    const section = document.querySelector(
      ".detail-panel-section--breakdown-table",
    )!;
    expect(section.querySelector("h3")!.textContent).toBe("Weekly activity");
    const headers = Array.from(section.querySelectorAll("thead th")).map(
      (th) => th.textContent,
    );
    expect(headers).toEqual([
      "Week",
      "Reviews",
      "PRs reviewed",
      "Approval rate",
    ]);
    const rowCells = Array.from(section.querySelectorAll("tbody tr")).map(
      (tr) =>
        Array.from(tr.querySelectorAll("th, td")).map((c) => c.textContent),
    );
    expect(rowCells).toEqual([
      ["W10", "12", "8", "75%"],
      ["W11", "20", "10", "80%"],
      ["W12", "6", "4", "50%"],
    ]);
  });

  it("weekly table skips weeks where the reviewer had no activity", () => {
    const rollups: Rollup[] = [
      // First week: entry present.
      makeRollup({
        week: "2025-W10",
        reviewers_count: 3,
        reviewsCount: 5,
        reviewedPrs: 3,
        approvalRate: 0.6,
      }),
      // Second week: by_reviewer is empty (no entry for REVIEWER_ID).
      {
        week: "2025-W11",
        pr_count: 8,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 4,
        reviewers_count: 5,
        by_repository: null,
        by_team: null,
        by_reviewer: {},
      },
      makeRollup({
        week: "2025-W12",
        reviewers_count: 2,
        reviewsCount: 4,
        reviewedPrs: 2,
        approvalRate: 0.75,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    const rowLabels = Array.from(
      document.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["W10", "W12"]);
  });

  it("weekly table renders empty cell when per-week approval_rate is null", () => {
    const rollups = [
      makeRollup({
        week: "2025-W10",
        reviewers_count: 3,
        reviewsCount: 5,
        reviewedPrs: 3,
        approvalRate: null,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    const cells = Array.from(document.querySelectorAll("tbody tr td")).map(
      (td) => td.textContent,
    );
    // reviews_count, reviewed_prs, approval_rate (empty)
    expect(cells).toEqual(["5", "3", ""]);
  });

  // -------------------------------------------------------------------------
  // Class lifecycle / MutationObserver
  // -------------------------------------------------------------------------

  it("adds is-drilldown-active to the clicked row and clears it on dismiss", async () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);
    const row = rowFor(container, "2025-W10");

    click(row);
    expect(row.classList.contains("is-drilldown-active")).toBe(true);

    dismissDetailPanel("explicit-close-button");
    await Promise.resolve();

    expect(row.classList.contains("is-drilldown-active")).toBe(false);
  });

  it("dispose() mid-open clears is-drilldown-active and disconnects the observer", async () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    const handle = installReviewerDrilldown(container, rollups);
    const row = rowFor(container, "2025-W10");

    click(row);
    expect(row.classList.contains("is-drilldown-active")).toBe(true);

    handle.dispose();

    expect(row.classList.contains("is-drilldown-active")).toBe(false);
    dismissDetailPanel("explicit-close-button");
    await Promise.resolve();
    expect(row.classList.contains("is-drilldown-active")).toBe(false);
  });

  it("panel class mutation that keeps is-open leaves is-drilldown-active intact", async () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);
    const row = rowFor(container, "2025-W10");

    click(row);
    const panel = document.querySelector<HTMLElement>("aside.detail-panel")!;
    panel.classList.add("a-non-open-class");
    await Promise.resolve();

    expect(row.classList.contains("is-drilldown-active")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  it("dispose() detaches listeners — subsequent click does not open panel", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    const handle = installReviewerDrilldown(container, rollups);

    handle.dispose();
    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Comparison advisory routing + tooltip dismissal
  // -------------------------------------------------------------------------

  it("routes to comparison advisory toast when comparison mode is active", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Keyboard activation
  // -------------------------------------------------------------------------

  it("keyboard Enter on a focused row opens the panel", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    rowFor(container, "2025-W10").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(true);
  });

  it("keyboard Space opens the panel and calls preventDefault on the event", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    rowFor(container, "2025-W10").dispatchEvent(event);

    expect(isDetailPanelOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  // -------------------------------------------------------------------------
  // A11y attribute surface
  // -------------------------------------------------------------------------

  it("rows carry data-drilldown-reviewer-id + tabindex=0 + role=button when filter is active", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    const row = rowFor(container, "2025-W10");

    expect(row.getAttribute("data-drilldown-reviewer-id")).toBe(REVIEWER_ID);
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("role")).toBe("button");
    // The existing title attribute stays as a hover fallback.
    expect(row.getAttribute("title")).toContain("2025-W10");
  });

  it("rows omit drill-down attributes when no reviewer filter is active (click is a no-op)", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups, false, null);
    installReviewerDrilldown(container, rollups);
    const row = rowFor(container, "2025-W10");

    expect(row.getAttribute("data-drilldown-reviewer-id")).toBeNull();
    click(row);
    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Rerender sequence
  // -------------------------------------------------------------------------

  it("after dispose→reinstall across a rerender only the newly-clicked row is active", async () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    let handle = installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));
    expect(
      rowFor(container, "2025-W10").classList.contains("is-drilldown-active"),
    ).toBe(true);

    publishFiltersChanged({ reason: "user-change" });
    await Promise.resolve();
    handle.dispose();

    handle = installReviewerDrilldown(container, rollups);
    click(rowFor(container, "2025-W11"));

    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    const active = Array.from(
      document.querySelectorAll<HTMLElement>(".is-drilldown-active"),
    );
    expect(active.length).toBe(1);
    expect(active[0]).toBe(rowFor(container, "2025-W11"));

    handle.dispose();
  });

  // -------------------------------------------------------------------------
  // Coverage hardening — early-return branches
  // -------------------------------------------------------------------------

  it("skips rollups whose by_reviewer map is null outright", () => {
    const rollups: Rollup[] = [
      {
        week: "2025-W10",
        pr_count: 8,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 4,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
        by_reviewer: null,
      },
      makeRollup({
        week: "2025-W11",
        reviewers_count: 4,
        reviewsCount: 7,
        reviewedPrs: 3,
        approvalRate: 0.9,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W11"));

    const rowLabels = Array.from(
      document.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["W11"]);
  });

  it("keydown Enter on the container outside any row is ignored", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("click on the container outside any row is ignored", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(container);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("keydown with an unrelated key on a row is ignored", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    rowFor(container, "2025-W10").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("empty data-drilldown-reviewer-id attribute is a no-op", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);
    const row = rowFor(container, "2025-W10");
    row.setAttribute("data-drilldown-reviewer-id", "");

    click(row);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("opens the panel even when the reviewer has no by_reviewer entries in the current rollups", () => {
    // Reviewer id that exists nowhere in the rollups' by_reviewer maps.
    const rollups = [
      makeRollup({
        week: "2025-W10",
        reviewers_count: 3,
        reviewsCount: 5,
        reviewedPrs: 3,
        approvalRate: 0.5,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);
    const row = rowFor(container, "2025-W10");
    row.setAttribute("data-drilldown-reviewer-id", "bob@example.com");

    click(row);

    // Panel opens with zeros + no rows — reviewer-not-found scenario
    // surfaces the null-result UX instead of silently doing nothing.
    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector(".detail-panel-subtitle")!.textContent).toBe(
      "0 PRs reviewed",
    );
  });

  // PR #302 P1.G — reviewer empty-week table must emit an EmptyStateSection
  // rather than rendering a header-only breakdown table (FR-071 symmetry
  // with throughput-drilldown + cycle-time-drilldown).
  it("weekly activity renders an EmptyStateSection (not an empty table) when the reviewer has no entries across any rollup", () => {
    const rollups = [
      makeRollup({
        week: "2025-W10",
        reviewers_count: 3,
        reviewsCount: 5,
        reviewedPrs: 3,
        approvalRate: 0.5,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);
    const row = rowFor(container, "2025-W10");
    row.setAttribute("data-drilldown-reviewer-id", "bob@example.com");

    click(row);

    const panel = document.querySelector<HTMLElement>("aside.detail-panel")!;
    // Empty-state section carries the h3 title in place of the table.
    const emptyStates = panel.querySelectorAll(
      ".detail-panel-section--empty-state",
    );
    expect(emptyStates.length).toBe(1);
    expect(emptyStates[0]!.querySelector("h3")!.textContent).toBe(
      "Weekly activity",
    );
    expect(emptyStates[0]!.querySelector("p")!.textContent).toBe(
      "No review activity recorded for this reviewer in this period.",
    );
    // No <table> must render for the empty branch (the bug was a
    // header-only breakdown table).
    expect(panel.querySelector("table")).toBeNull();
    // Heading hierarchy stays single-h2 (the panel title) so SR
    // landmark navigation is unchanged.
    expect(panel.querySelectorAll("h2").length).toBe(1);
  });

  it("subtitle uses singular 'PR reviewed' when totalPrs === 1", () => {
    const rollups = [
      makeRollup({
        week: "2025-W10",
        reviewers_count: 1,
        reviewsCount: 1,
        reviewedPrs: 1,
        approvalRate: 1.0,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    expect(document.querySelector(".detail-panel-subtitle")!.textContent).toBe(
      "1 PR reviewed",
    );
  });

  // -------------------------------------------------------------------------
  // Comparison-mode keyboard guard (PR #302 P1.E checklist)
  // -------------------------------------------------------------------------

  it("keyboard Enter in comparison mode opens the advisory toast, NOT the panel", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    rowFor(container, "2025-W10").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // aria-expanded toggle (PR #302 P1.E sentinel)
  // -------------------------------------------------------------------------

  describe("aria-expanded toggle", () => {
    it("renders aria-expanded='false' on every row when filter is active", () => {
      const rollups = makeDefaultRollups();
      const container = mountChart(rollups);
      installReviewerDrilldown(container, rollups);

      const rows = container.querySelectorAll<HTMLElement>(
        ".h-bar-row[data-drilldown-reviewer-id]",
      );
      expect(rows.length).toBe(3);
      for (const row of Array.from(rows)) {
        expect(row.getAttribute("aria-expanded")).toBe("false");
      }
    });

    it("flips aria-expanded='true' on the activated row when the panel opens", () => {
      const rollups = makeDefaultRollups();
      const container = mountChart(rollups);
      installReviewerDrilldown(container, rollups);
      const row = rowFor(container, "2025-W10");

      click(row);

      expect(isDetailPanelOpen()).toBe(true);
      expect(row.getAttribute("aria-expanded")).toBe("true");
    });

    it("resets aria-expanded='false' on the trigger via every dismiss path through clearActive", async () => {
      const rollups = makeDefaultRollups();
      const container = mountChart(rollups);
      installReviewerDrilldown(container, rollups);
      const row = rowFor(container, "2025-W10");

      click(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");

      dismissDetailPanel("explicit-close-button");
      // MutationObserver on panel.is-open is async — let the microtask
      // run so clearActive fires and resets aria-expanded.
      await Promise.resolve();
      expect(row.getAttribute("aria-expanded")).toBe("false");
    });

    it("rows have NO aria-expanded attribute when reviewer filter is inactive", () => {
      const rollups = makeDefaultRollups();
      const container = mountChart(rollups, false, null);
      installReviewerDrilldown(container, rollups);

      const rows = container.querySelectorAll<HTMLElement>(".h-bar-row");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of Array.from(rows)) {
        expect(row.hasAttribute("aria-expanded")).toBe(false);
        expect(row.hasAttribute("data-drilldown-reviewer-id")).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Feature 362: PR list section
  // -------------------------------------------------------------------------

  const FIXTURE_WEB_CTX = { collectionUri: "https://dev.azure.com/acme/" };
  const FIXTURE_REPOS = [
    {
      repository_id: "repo-1",
      repository_name: "web-app",
      project_name: "Frontend",
      organization_name: "acme",
    },
    {
      repository_id: "repo-2",
      repository_name: "api",
      project_name: "Backend",
      organization_name: "acme",
    },
  ];

  function makePr(
    id: number,
    cycleMinutes: number,
    overrides: Partial<PrRecord> = {},
  ): PrRecord {
    return {
      id,
      title: overrides.title ?? `PR ${id}`,
      author_id: overrides.author_id ?? "author-default",
      repository_id: overrides.repository_id ?? "repo-1",
      cycle_time: cycleMinutes,
      ...overrides,
    };
  }

  function rollupWithPrs(
    weekData: ReviewerWeek,
    prs: readonly PrRecord[],
    overrides: {
      reviewerId?: string;
      prsTruncated?: boolean;
      prsCap?: number | undefined;
      includePrsTrio?: boolean;
    } = {},
  ): Rollup {
    const reviewerId = overrides.reviewerId ?? REVIEWER_ID;
    const base = makeRollup(weekData, reviewerId);
    const includeTrio = overrides.includePrsTrio ?? true;
    const reviewerEntry: ReviewerBreakdownEntry = includeTrio
      ? {
          reviews_count: weekData.reviewsCount,
          reviewed_prs: weekData.reviewedPrs,
          approval_rate: weekData.approvalRate,
          repositories_count: weekData.repositoriesCount,
          prs,
          _prs_truncated: overrides.prsTruncated ?? false,
          _prs_cap: overrides.prsCap ?? 500,
        }
      : {
          reviews_count: weekData.reviewsCount,
          reviewed_prs: weekData.reviewedPrs,
          approval_rate: weekData.approvalRate,
          repositories_count: weekData.repositoriesCount,
        };
    return {
      ...base,
      by_reviewer: {
        [reviewerId]: reviewerEntry,
      },
    };
  }

  function fullOptions(
    overrides: Partial<ReviewerDrilldownOptions> = {},
  ): ReviewerDrilldownOptions {
    return {
      reviewersDimension: REVIEWERS_DIM,
      filters: overrides.filters ?? {
        repos: [],
        teams: [],
        reviewers: [REVIEWER_ID],
        authors: [],
      },
      repositoriesDimension: overrides.repositoriesDimension ?? FIXTURE_REPOS,
      webContext:
        overrides.webContext === undefined && !("webContext" in overrides)
          ? FIXTURE_WEB_CTX
          : overrides.webContext,
      authorsDimension: overrides.authorsDimension ?? [],
      commentsMetricsAvailable: overrides.commentsMetricsAvailable ?? false,
    };
  }

  function defaultPrListWeek(week: string): ReviewerWeek {
    return {
      week,
      reviewers_count: 1,
      reviewsCount: 3,
      reviewedPrs: 3,
      approvalRate: 1.0,
      repositoriesCount: 1,
    };
  }

  function prListSection(): HTMLElement | null {
    return document.querySelector<HTMLElement>("#pr-detail");
  }

  function prListContentState(): string | null {
    return prListSection()?.getAttribute("data-content-state") ?? null;
  }

  function prListRowIds(): number[] {
    return Array.from(
      document.querySelectorAll<HTMLLIElement>("#pr-detail ol li"),
    ).map((li) => {
      const link = li.querySelector("a");
      const text = link?.textContent ?? "";
      const match = text.match(/^#(\d+)/);
      if (!match) throw new Error(`row missing #id prefix: "${text}"`);
      return Number.parseInt(match[1]!, 10);
    });
  }

  // T015 — supported-state PR list under reviewer-only filter.
  it("renders a PR list section under the supported filter classification with reviewer-only filter active", () => {
    const prs = [makePr(101, 800), makePr(102, 500), makePr(103, 200)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(true);
    const section = prListSection();
    expect(section).not.toBeNull();
    expect(prListContentState()).toBe("pr-list");
    expect(
      section!.querySelectorAll<HTMLLIElement>("ol li").length,
    ).toBeGreaterThan(0);
  });

  // T016 — section ordering: stat-row → weekly-table → pr-list.
  it("renders panel sections in stat-row → weekly-table → pr-list order", () => {
    const prs = [makePr(201, 600), makePr(202, 400)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(
        "aside.detail-panel .detail-panel-sections > *",
      ),
    );
    // Stat row, weekly table, PR list — three sections in this order.
    expect(sections.length).toBe(3);
    // Stat row is the first section (it carries `.detail-panel-stat-row`
    // or the four labelled stat values). Heuristic: contains "Total reviews".
    expect(sections[0]!.textContent ?? "").toContain("Total reviews");
    // Weekly activity table is the second section.
    expect(sections[1]!.textContent ?? "").toContain("Weekly activity");
    // The PR list is the LAST section, identified by the stable id.
    expect(sections[2]!.id).toBe("pr-detail");
    expect(sections[2]!.getAttribute("data-content-state")).toBe("pr-list");
  });

  // T018 — clicking a PR row opens the URL in a new tab without
  // disturbing the panel's open state.
  it("PR row click opens the URL in a new browser tab and does not disturb panel state", () => {
    const prs = [makePr(301, 700), makePr(302, 350)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());
    click(rowFor(container, "2025-W10"));

    const firstRow =
      document.querySelector<HTMLAnchorElement>("#pr-detail ol li a");
    expect(firstRow).not.toBeNull();
    expect(firstRow!.target).toBe("_blank");
    expect(firstRow!.getAttribute("rel") ?? "").toContain("noopener");
    expect(firstRow!.href).toContain("dev.azure.com/acme");

    // Click the PR link — assert the panel stays open.
    firstRow!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(isDetailPanelOpen()).toBe(true);
  });

  // T021 — team filter overlay → team-inline message; PR list does NOT render.
  it("team-filter overlay renders the team-inline message and not the PR list", () => {
    const prs = [makePr(401, 700), makePr(402, 350)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: [],
          teams: ["t1"],
          reviewers: [REVIEWER_ID],
          authors: [],
        },
      }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("team-inline");
    expect(prListSection()!.querySelectorAll("ol li").length).toBe(0);
  });

  // T022 — reviewer-only filter (no team overlay) renders the PR list.
  // Locks the FR-008 reviewer-stripping wrapper: without the wrapper the
  // classifier would return "reviewer" and the PR list would be hidden.
  it("reviewer-only filter (no team overlay) renders the PR list — reviewer-stripping wrapper exercise", () => {
    const prs = [makePr(501, 600)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: [],
          teams: [],
          reviewers: [REVIEWER_ID],
          authors: [],
        },
      }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    expect(prListRowIds()).toEqual([501]);
  });

  // T023 — reviewer + author overlay → intersection.
  it("reviewer + author overlay renders the PR list with author intersection", () => {
    const prs = [
      makePr(601, 800, { author_id: "author-a" }),
      makePr(602, 700, { author_id: "author-b" }),
      makePr(603, 600, { author_id: "author-a" }),
    ];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: [],
          teams: [],
          reviewers: [REVIEWER_ID],
          authors: ["author-a"],
        },
      }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    // Sort: cycle_time desc → 800 (601) > 600 (603); author-b's 700 (602)
    // is filtered out by the overlay.
    expect(prListRowIds()).toEqual([601, 603]);
  });

  // T024 — reviewer + repo overlay → intersection.
  // `filters.repos` carries `repository_name` values (chip text), not the
  // GUID; `FIXTURE_REPOS` maps name "web-app" to id "repo-1".
  it("reviewer + repo overlay renders the PR list with repo intersection", () => {
    const prs = [
      makePr(701, 800, { repository_id: "repo-1" }),
      makePr(702, 700, { repository_id: "repo-2" }),
      makePr(703, 600, { repository_id: "repo-1" }),
    ];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: ["web-app"],
          teams: [],
          reviewers: [REVIEWER_ID],
          authors: [],
        },
      }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    expect(prListRowIds()).toEqual([701, 703]);
  });

  // T025 — three-way intersection: reviewer + author + repo.
  // `filters.repos` carries `repository_name`; "web-app" → "repo-1".
  it("reviewer + author + repo overlay renders the PR list with three-way intersection", () => {
    const prs = [
      makePr(801, 900, { author_id: "author-a", repository_id: "repo-1" }),
      makePr(802, 800, { author_id: "author-b", repository_id: "repo-1" }),
      makePr(803, 700, { author_id: "author-a", repository_id: "repo-2" }),
      makePr(804, 600, { author_id: "author-a", repository_id: "repo-1" }),
    ];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: ["web-app"],
          teams: [],
          reviewers: [REVIEWER_ID],
          authors: ["author-a"],
        },
      }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    // Only 801 and 804 match all three constraints.  Sort: 801 (900) > 804 (600).
    expect(prListRowIds()).toEqual([801, 804]);
  });

  // T025a — repo overlay translates repository_name → repository_id.
  //
  // Production-shaped scenario: the dashboard filter chip carries the
  // repository_name string while the producer emits PrRecord.repository_id
  // as the GUID.  Without the namespace mapping, every repo-filtered
  // reviewer drilldown on production data falls through to supported-empty
  // because the comparison crosses namespaces.
  it("repo overlay maps repository_name to repository_id via repositoriesDimension", () => {
    const prs = [
      makePr(901, 900, { repository_id: "guid-web" }),
      makePr(902, 800, { repository_id: "guid-api" }),
      makePr(903, 700, { repository_id: "guid-web" }),
    ];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: ["Web App"],
          teams: [],
          reviewers: [REVIEWER_ID],
          authors: [],
        },
        repositoriesDimension: [
          {
            repository_id: "guid-web",
            repository_name: "Web App",
            project_name: "Frontend",
            organization_name: "acme",
          },
          {
            repository_id: "guid-api",
            repository_name: "API",
            project_name: "Backend",
            organization_name: "acme",
          },
        ],
      }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    expect(prListRowIds()).toEqual([901, 903]);
  });

  // T025b — dimension absent + repo filter active fails closed.
  //
  // Without `repositoriesDimension` the consumer cannot resolve the
  // selected names to ids.  Rather than degrade to a cross-namespace
  // comparison (the bug we are fixing), the overlay drops every row
  // and the section renders supported-empty.
  it("repo overlay with missing repositoriesDimension renders supported-empty when filter is active", () => {
    const prs = [
      makePr(951, 900, { repository_id: "guid-web" }),
      makePr(952, 700, { repository_id: "guid-api" }),
    ];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    const options: ReviewerDrilldownOptions = {
      reviewersDimension: REVIEWERS_DIM,
      filters: {
        repos: ["Web App"],
        teams: [],
        reviewers: [REVIEWER_ID],
        authors: [],
      },
      // repositoriesDimension intentionally omitted (undefined)
      webContext: FIXTURE_WEB_CTX,
      authorsDimension: [],
      commentsMetricsAvailable: false,
    };
    installReviewerDrilldown(container, rollups, options);
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("supported-empty");
  });

  // T026 — comparison mode short-circuits the panel; PR list NOT rendered.
  // Regression-locks that the new PR list section does not bypass the
  // existing comparison short-circuit.
  it("comparison mode active denies the panel and fires the existing toast on reviewer-row click; PR list section is NOT rendered", () => {
    const prs = [makePr(901, 800), makePr(902, 600)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    publishComparisonToggled({ enabled: true });
    click(rowFor(container, "2025-W10"));

    // No panel + toast (existing behavior).
    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
    // PR list section NOT rendered (because the panel never opened).
    expect(prListSection()).toBeNull();
  });

  // T030 — truncation cue surfaces when ANY participating week is truncated.
  it("truncation cue renders when any participating week is truncated", () => {
    // W10: 30 PRs, untruncated.  W11: 500 PRs, _prs_truncated=true,
    // reviewed_prs=700.  W12: 20 PRs, untruncated.  Cue MUST surface
    // because the per-week ratio renderedCount < actualFilteredCount fires
    // (sum of prs[].length = 550; sum of reviewed_prs = 750).
    const w10Prs: PrRecord[] = [];
    for (let i = 0; i < 30; i += 1) w10Prs.push(makePr(1100 + i, 100 + i));
    const w11Prs: PrRecord[] = [];
    for (let i = 0; i < 500; i += 1) w11Prs.push(makePr(2000 + i, 1500 - i));
    const w12Prs: PrRecord[] = [];
    for (let i = 0; i < 20; i += 1) w12Prs.push(makePr(3000 + i, 90 - i));
    const rollups = [
      rollupWithPrs(
        { ...defaultPrListWeek("2025-W10"), reviewedPrs: 30, reviewsCount: 30 },
        w10Prs,
        { reviewerId: REVIEWER_ID },
      ),
      rollupWithPrs(
        {
          ...defaultPrListWeek("2025-W11"),
          reviewedPrs: 700,
          reviewsCount: 700,
        },
        w11Prs,
        { reviewerId: REVIEWER_ID, prsTruncated: true, prsCap: 500 },
      ),
      rollupWithPrs(
        { ...defaultPrListWeek("2025-W12"), reviewedPrs: 20, reviewsCount: 20 },
        w12Prs,
        { reviewerId: REVIEWER_ID },
      ),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    const cue = prListSection()!.querySelector(".truncation-indicator");
    expect(cue).not.toBeNull();
    const cueText = cue!.textContent ?? "";
    // Rendered count = 550, actualFilteredCount = 750, capValue = 500.
    expect(cueText).toContain("550");
    expect(cueText).toContain("750");
    expect(cueText).toContain("500");
  });

  // T031 — supported-empty for a reviewer with zero qualifying PRs.
  it("supported-empty renders for a reviewer with zero qualifying PRs in the period", () => {
    // The default fixture rollups carry reviewer_id = REVIEWER_ID with a
    // by_reviewer entry; a different reviewer (not present anywhere) has
    // an empty cross-week prs[] union and falls through to supported-empty.
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: [],
          teams: [],
          reviewers: [REVIEWER_ID],
          authors: [],
        },
      }),
    );
    click(rowFor(container, "2025-W10"));

    // No prs trio on the by_reviewer entries (default rollups don't carry
    // it) so the consumer falls through to supported-empty.
    expect(prListContentState()).toBe("supported-empty");
  });

  // T032 — supported-empty when webContext is undefined.
  it("supported-empty renders when webContext is absent", () => {
    const prs = [makePr(1101, 600)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({ webContext: undefined }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("supported-empty");
    expect(prListSection()!.querySelectorAll("ol li").length).toBe(0);
  });

  // T033 — supported-empty when any participating week's _prs_cap is missing.
  it("supported-empty renders when any participating week's _prs_cap is missing", () => {
    const prs = [makePr(1201, 700)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
        // includePrsTrio: false strips the trio from the by_reviewer entry,
        // simulating a malformed rollup the validator warns on but does
        // not reject.  Per contract § 3 this triggers supported-empty.
        includePrsTrio: false,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("supported-empty");
  });

  // T034 — public demo dataset renders supported-empty for the reviewer
  // drill-down PR list (FR-022 + FR-028 strip enforcement at the
  // by_reviewer[*] depth-2 emission site).
  it("current published demo dataset renders supported-empty for the reviewer drill-down PR list", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
    const demoRollupPath = path.join(
      repoRoot,
      "docs",
      "data",
      "aggregates",
      "weekly_rollups",
      "2025-W28.json",
    );
    const demoRollup = readJsonFile<Rollup>(demoRollupPath);
    expect(demoRollup.by_reviewer).toBeDefined();
    const reviewerKeys = Object.keys(demoRollup.by_reviewer ?? {});
    expect(reviewerKeys.length).toBeGreaterThan(0);
    const focusReviewerId = reviewerKeys[0]!;

    const container = document.createElement("div");
    container.id = "reviewer-activity";
    document.body.appendChild(container);
    renderReviewerActivity(container, [demoRollup], {
      reviewerFilterActive: true,
      filters: filtersWith(focusReviewerId),
    });
    installReviewerDrilldown(container, [demoRollup], {
      reviewersDimension: [
        { reviewer_id: focusReviewerId, reviewer_name: "Demo Reviewer" },
      ],
      filters: filtersWith(focusReviewerId),
      repositoriesDimension: FIXTURE_REPOS,
      webContext: FIXTURE_WEB_CTX,
      authorsDimension: [],
      commentsMetricsAvailable: false,
    });
    click(rowFor(container, demoRollup.week));

    // FR-022 + FR-028: the public demo's by_reviewer[*] entries do NOT
    // carry the per-(reviewer, week) trio, so the consumer falls through
    // to supported-empty.  This locks the privacy posture at the
    // by_reviewer[*] depth-2 emission site.
    expect(prListContentState()).toBe("supported-empty");
  });

  // T036 — accessible name stability across the three reachable content
  // states.  The PR list section's stable section shell carries
  // `aria-labelledby="pr-detail-heading"` referencing an `<h3>` whose
  // text MUST be identical across pr-list / supported-empty / team-inline.
  it("PR list section accessible name is identical across pr-list, supported-empty, team-inline", () => {
    function nameForCurrentSection(): string {
      const section = prListSection();
      if (section === null) return "";
      const labelledBy = section.getAttribute("aria-labelledby");
      if (labelledBy === null) {
        return section.getAttribute("aria-label") ?? "";
      }
      const labelEl = document.getElementById(labelledBy);
      return labelEl?.textContent ?? "";
    }

    // 1. pr-list state.
    {
      const prs = [makePr(1301, 600)];
      const rollups = [
        rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
          reviewerId: REVIEWER_ID,
        }),
      ];
      const container = mountChart(rollups);
      installReviewerDrilldown(container, rollups, fullOptions());
      click(rowFor(container, "2025-W10"));
      expect(prListContentState()).toBe("pr-list");
      const prListName = nameForCurrentSection();
      expect(prListName).not.toBe("");

      dismissDetailPanel("explicit-close-button");
      document.body.innerHTML = "";

      // 2. supported-empty state.
      const emptyRollups = makeDefaultRollups();
      const emptyContainer = mountChart(emptyRollups);
      installReviewerDrilldown(
        emptyContainer,
        emptyRollups,
        fullOptions({
          filters: {
            repos: [],
            teams: [],
            reviewers: [REVIEWER_ID],
            authors: [],
          },
        }),
      );
      click(rowFor(emptyContainer, "2025-W10"));
      expect(prListContentState()).toBe("supported-empty");
      const supportedEmptyName = nameForCurrentSection();
      expect(supportedEmptyName).toBe(prListName);

      dismissDetailPanel("explicit-close-button");
      document.body.innerHTML = "";

      // 3. team-inline state.
      const teamRollups = [
        rollupWithPrs(defaultPrListWeek("2025-W10"), [makePr(1302, 800)], {
          reviewerId: REVIEWER_ID,
        }),
      ];
      const teamContainer = mountChart(teamRollups);
      installReviewerDrilldown(
        teamContainer,
        teamRollups,
        fullOptions({
          filters: {
            repos: [],
            teams: ["t1"],
            reviewers: [REVIEWER_ID],
            authors: [],
          },
        }),
      );
      click(rowFor(teamContainer, "2025-W10"));
      expect(prListContentState()).toBe("team-inline");
      const teamInlineName = nameForCurrentSection();
      expect(teamInlineName).toBe(prListName);
    }
  });

  // T037 — keyboard Enter on a focused reviewer row opens the panel WITH
  // the PR list section rendered (not just the panel — extends the
  // existing keyboard activation test).
  it("keyboard Enter on a focused reviewer row opens the panel with the PR list", () => {
    const prs = [makePr(1401, 700), makePr(1402, 500)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    const target = rowFor(container, "2025-W10");
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(true);
    expect(prListContentState()).toBe("pr-list");
  });

  it("keyboard Space on a focused reviewer row opens the PR list and prevents default", () => {
    const prs = [makePr(1501, 600)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());

    const target = rowFor(container, "2025-W10");
    target.focus();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    target.dispatchEvent(event);

    expect(isDetailPanelOpen()).toBe(true);
    expect(prListContentState()).toBe("pr-list");
    expect(event.defaultPrevented).toBe(true);
  });

  it("renders the PR list with capability-on rows when commentsMetricsAvailable is true", () => {
    // Capability-on path: each row carries the comments-metrics triplet.
    // Locks the partial branch in `buildPrListSection` for the
    // capability-on row construction.
    const prs = [
      {
        id: 1701,
        title: "feat: oauth",
        author_id: "alice",
        repository_id: "repo-1",
        cycle_time: 700,
        thread_count: 4,
        comment_count: 12,
        active_thread_count: 1,
      },
    ];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({ commentsMetricsAvailable: true }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    const list = prListSection()!.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    // Capability-on path emits the --with-comments modifier and the
    // per-row metric spans.
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(true);
    expect(prListSection()!.querySelectorAll(".comments-metric").length).toBe(
      3,
    );
  });

  it("renders supported-empty when an author overlay filters out every collected row", () => {
    // Locks the `if (sorted.length === 0)` branch in
    // `buildPrListSection` — collected has rows BEFORE overlay, but the
    // overlay matches nothing.  The contract says supported-empty under
    // this condition (consumer's contract § 3 — author/repo overlay
    // collapsing to no matches).
    const prs = [
      makePr(1801, 600, { author_id: "author-a" }),
      makePr(1802, 400, { author_id: "author-a" }),
    ];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(
      container,
      rollups,
      fullOptions({
        filters: {
          repos: [],
          teams: [],
          reviewers: [REVIEWER_ID],
          authors: ["author-no-match"],
        },
      }),
    );
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("supported-empty");
  });

  it("defaults commentsMetricsAvailable to false when the option is omitted", () => {
    // Locks the `?? false` branch in `buildPrListSection` (capability
    // option absent on the install-options bag).  The render path mirrors
    // the explicit `commentsMetricsAvailable: false` case.  Constructing
    // the options bag inline (without the helper's own `?? false`)
    // ensures the `undefined` value reaches `buildPrListSection` so the
    // nullish-coalescing branch on the consumer side gets exercised.
    const prs = [makePr(1901, 500)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, {
      reviewersDimension: REVIEWERS_DIM,
      filters: {
        repos: [],
        teams: [],
        reviewers: [REVIEWER_ID],
        authors: [],
      },
      repositoriesDimension: FIXTURE_REPOS,
      webContext: FIXTURE_WEB_CTX,
      authorsDimension: [],
      // commentsMetricsAvailable intentionally omitted — exercises the
      // consumer's `?? false` default.
    });
    click(rowFor(container, "2025-W10"));

    expect(prListContentState()).toBe("pr-list");
    const list = prListSection()!.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    // Default capability-off shape: no --with-comments modifier.
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(false);
  });

  // T038 — Tab reachability: every PR row is focusable in DOM order.
  it("PR list rows are reachable via focus traversal in DOM order inside the reviewer panel", () => {
    const prs = [makePr(1601, 900), makePr(1602, 700), makePr(1603, 500)];
    const rollups = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), prs, {
        reviewerId: REVIEWER_ID,
      }),
    ];
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, fullOptions());
    click(rowFor(container, "2025-W10"));

    const rowAnchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("#pr-detail ol li a"),
    );
    expect(rowAnchors.length).toBe(3);
    // Each anchor is natively focusable (`<a href>` with non-empty href);
    // assert focus advances through them in document order.
    for (const anchor of rowAnchors) {
      anchor.focus();
      expect(document.activeElement).toBe(anchor);
    }
    // DOM order matches the rendered cycle_time desc, id asc sort.
    const ids = rowAnchors.map((a) => {
      const text = a.textContent ?? "";
      const match = text.match(/^#(\d+)/);
      return match ? Number.parseInt(match[1]!, 10) : -1;
    });
    expect(ids).toEqual([1601, 1602, 1603]);
  });

  // T019 — reviewer filter change between two reviewers reloads the PR list
  // for the new reviewer (no stale rows from the prior reviewer).
  it("reviewer-filter change between two reviewers re-opens the panel with the new reviewer's PR list", async () => {
    const REVIEWER_X_PRS = [makePr(801, 500), makePr(802, 300)];
    const REVIEWER_Y_PRS = [
      makePr(901, 700),
      makePr(902, 400),
      makePr(903, 100),
    ];
    const rollupsX = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), REVIEWER_X_PRS, {
        reviewerId: "reviewer-x",
      }),
    ];
    const rollupsY = [
      rollupWithPrs(defaultPrListWeek("2025-W10"), REVIEWER_Y_PRS, {
        reviewerId: "reviewer-y",
      }),
    ];

    const container = document.createElement("div");
    container.id = "reviewer-activity";
    document.body.appendChild(container);
    renderReviewerActivity(container, rollupsX, {
      reviewerFilterActive: true,
      filters: filtersWith("reviewer-x"),
    });
    let handle = installReviewerDrilldown(
      container,
      rollupsX,
      fullOptions({
        filters: {
          repos: [],
          teams: [],
          reviewers: ["reviewer-x"],
          authors: [],
        },
      }),
    );

    click(rowFor(container, "2025-W10"));
    const xIds = prListRowIds().sort((a, b) => a - b);
    expect(xIds).toEqual([801, 802]);
    expect(prListContentState()).toBe("pr-list");

    // Simulate a reviewer-filter change to reviewer-y: dispose the
    // existing install, re-render the chart, re-install for the new
    // reviewer, then click the row again.
    publishFiltersChanged({ reason: "user-change" });
    await Promise.resolve();
    handle.dispose();
    if (isDetailPanelOpen()) dismissDetailPanel("filters-changed");

    document.body.innerHTML = "";
    const containerY = document.createElement("div");
    containerY.id = "reviewer-activity";
    document.body.appendChild(containerY);
    renderReviewerActivity(containerY, rollupsY, {
      reviewerFilterActive: true,
      filters: filtersWith("reviewer-y"),
    });
    handle = installReviewerDrilldown(
      containerY,
      rollupsY,
      fullOptions({
        filters: {
          repos: [],
          teams: [],
          reviewers: ["reviewer-y"],
          authors: [],
        },
      }),
    );
    click(rowFor(containerY, "2025-W10"));
    const yIds = prListRowIds().sort((a, b) => a - b);
    expect(yIds).toEqual([901, 902, 903]);
    handle.dispose();
  });
});
