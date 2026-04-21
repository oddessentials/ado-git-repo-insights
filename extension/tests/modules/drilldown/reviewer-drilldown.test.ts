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

import { renderReviewerActivity } from "../../../ui/modules/charts/reviewer-activity";
import { installReviewerDrilldown } from "../../../ui/modules/drilldown/reviewer-drilldown";
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

  it("panel title uses the non-UUID reviewer_id verbatim when reviewersDimension is missing (Codex catch)", () => {
    // REVIEWER_ID is "alice@example.com" — an email, not a UUID. With
    // no dimension supplied the panel title shows the id verbatim
    // rather than masking it as "Unknown user".
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups);

    click(rowFor(container, "2025-W10"));

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      REVIEWER_ID,
    );
  });

  it("panel title uses the non-UUID reviewer_id verbatim when it is not present in the dimension (Codex catch)", () => {
    const rollups = makeDefaultRollups();
    const container = mountChart(rollups);
    installReviewerDrilldown(container, rollups, {
      // Dimension present but for a different reviewer; REVIEWER_ID
      // from the trigger is not in the map and is not UUID-shaped, so
      // it surfaces verbatim.
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

  it("panel title falls back to 'Unknown user' when the reviewer_id IS UUID-shaped and missing from the dimension", () => {
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
      "Unknown user",
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
});
