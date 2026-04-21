/**
 * UI invariant gate (#308 — reshape).
 *
 * Two promises, narrower than the original aggressive form:
 *
 *   1. **Happy-path resolution** — when dimensions are threaded
 *      through and contain the id, no GUID-shaped string appears in
 *      textContent / aria-label / title of visible elements. This is
 *      the real fix for #308.
 *
 *   2. **Graceful partial-dimension rendering** — when the dimension
 *      is missing or partial (early-render race, user left the org
 *      mid-window, etc.) the panel MUST still render, rows MUST stay
 *      distinguishable, and nothing MUST throw. GUIDs may surface as
 *      a rare cosmetic leak; that is intentionally tolerated.
 *
 * Explicitly NOT in scope: `data-*` attributes, `id`, `class`, any
 * other non-user-visible attribute. Construction-time UUID rejection
 * was also removed from this PR — it turned cosmetic leaks into hard
 * panel crashes.
 */

import { renderThroughputChart } from "../../ui/modules/charts/throughput";
import { renderCycleTimeTrend } from "../../ui/modules/charts/cycle-time";
import { renderReviewerActivity } from "../../ui/modules/charts/reviewer-activity";
import {
  renderSummaryCards,
  type SummaryCardsContainers,
} from "../../ui/modules/charts/summary-cards";
import { installThroughputDrilldown } from "../../ui/modules/drilldown/throughput-drilldown";
import { installReviewerDrilldown } from "../../ui/modules/drilldown/reviewer-drilldown";
import { installCycleTimeDrilldown } from "../../ui/modules/drilldown/cycle-time-drilldown";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../ui/modules/shared/detail-panel";
import { publishComparisonToggled } from "../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../ui/modules/drilldown/comparison-advisory";
import type { Rollup } from "../../ui/dataset-loader";
import { assertNoGuidInVisibleText } from "./_helpers";

const AUTHOR_GUID_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const AUTHOR_GUID_B = "12345678-1234-1234-1234-123456789abc";
const REVIEWER_GUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const AUTHOR_NAME_A = "Alice Anderson";
const AUTHOR_NAME_B = "Bob Bennett";
const REVIEWER_NAME = "Carol Carter";

describe("UI invariant: happy-path resolution surfaces no GUIDs (#308)", () => {
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

  it("throughput drill-down: authorsDimension threaded → friendly names, no GUID in panel", () => {
    const rollups: Rollup[] = [
      {
        week: "2025-W12",
        pr_count: 40,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 2,
        reviewers_count: 1,
        by_repository: {
          "backend-api": { pr_count: 20 },
          frontend: { pr_count: 20 },
        },
        by_author: {
          [AUTHOR_GUID_A]: { pr_count: 25 },
          [AUTHOR_GUID_B]: { pr_count: 15 },
        },
        by_team: null,
      },
    ];
    const container = document.createElement("div");
    container.id = "throughput-chart";
    document.body.appendChild(container);
    renderThroughputChart(container, rollups);
    installThroughputDrilldown(container, rollups, {
      authorsDimension: [
        { author_id: AUTHOR_GUID_A, author_name: AUTHOR_NAME_A },
        { author_id: AUTHOR_GUID_B, author_name: AUTHOR_NAME_B },
      ],
    });
    container
      .querySelector<HTMLElement>(".bar-container")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

    assertNoGuidInVisibleText(document.body);
    const body = document.body.textContent ?? "";
    expect(body).toContain(AUTHOR_NAME_A);
    expect(body).toContain(AUTHOR_NAME_B);
  });

  it("reviewer drill-down: reviewersDimension threaded → friendly name, no GUID in panel", () => {
    const rollups: Rollup[] = [
      {
        week: "2025-W12",
        pr_count: 10,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 3,
        reviewers_count: 1,
        by_repository: null,
        by_team: null,
        by_reviewer: {
          [REVIEWER_GUID]: {
            reviews_count: 8,
            reviewed_prs: 5,
            approval_rate: 0.8,
            repositories_count: 2,
          },
        },
      },
    ];
    const container = document.createElement("div");
    container.id = "reviewer-activity";
    document.body.appendChild(container);
    renderReviewerActivity(container, rollups, {
      reviewerFilterActive: true,
      filters: {
        repos: [],
        teams: [],
        reviewers: [REVIEWER_GUID],
        authors: [],
      },
      filterReviewerName: REVIEWER_NAME,
    });
    installReviewerDrilldown(container, rollups, {
      reviewersDimension: [
        { reviewer_id: REVIEWER_GUID, reviewer_name: REVIEWER_NAME },
      ],
    });
    container
      .querySelector<HTMLElement>(".h-bar-row")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

    assertNoGuidInVisibleText(document.body);
    expect(document.body.textContent ?? "").toContain(REVIEWER_NAME);
  });

  it("cycle-time drill-down: By-repository keys are names, no GUID in panel", () => {
    // Forward-looking — keys are repo names today, guards against
    // a future schema change that id-keys the breakdown.
    const rollups: Rollup[] = [
      {
        week: "2025-W11",
        pr_count: 30,
        cycle_time_p50: 110,
        cycle_time_p90: 330,
        authors_count: 2,
        reviewers_count: 1,
        by_repository: {
          "backend-api": {
            pr_count: 15,
            cycle_time_p50: 90,
            cycle_time_p90: 280,
          },
          frontend: { pr_count: 15, cycle_time_p50: 130, cycle_time_p90: 380 },
        },
        by_team: null,
      },
      {
        week: "2025-W12",
        pr_count: 40,
        cycle_time_p50: 120,
        cycle_time_p90: 360,
        authors_count: 2,
        reviewers_count: 1,
        by_repository: {
          "backend-api": {
            pr_count: 20,
            cycle_time_p50: 100,
            cycle_time_p90: 300,
          },
          frontend: { pr_count: 20, cycle_time_p50: 140, cycle_time_p90: 400 },
        },
        by_team: null,
      },
    ];
    const container = document.createElement("div");
    container.id = "cycle-time-trend";
    document.body.appendChild(container);
    renderCycleTimeTrend(container, rollups);
    installCycleTimeDrilldown(container, rollups);
    const dot = container.querySelector<HTMLElement>(".line-chart-dot");
    if (dot === null) throw new Error("cycle-time dot not rendered");
    dot.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    assertNoGuidInVisibleText(document.body);
  });

  it("summary cards: no identity surfaces — assertion is forward-looking", () => {
    const rollups: Rollup[] = [
      {
        week: "2025-W12",
        pr_count: 40,
        cycle_time_p50: 120,
        cycle_time_p90: 360,
        authors_count: 2,
        reviewers_count: 1,
        by_repository: null,
        by_team: null,
      },
    ];
    const make = () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      return el;
    };
    const containers: SummaryCardsContainers = {
      totalPrs: make(),
      cycleP50: make(),
      cycleP90: make(),
      reviewTimeP50: make(),
      reviewTimeP90: make(),
      authorsCount: make(),
      reviewersCount: make(),
      totalPrsSparkline: make(),
      cycleP50Sparkline: make(),
      cycleP90Sparkline: make(),
      reviewTimeP50Sparkline: make(),
      reviewTimeP90Sparkline: make(),
      authorsSparkline: make(),
      reviewersSparkline: make(),
      totalPrsDelta: make(),
      cycleP50Delta: make(),
      cycleP90Delta: make(),
      reviewTimeP50Delta: make(),
      reviewTimeP90Delta: make(),
      authorsDelta: make(),
      reviewersDelta: make(),
    };
    renderSummaryCards({ rollups, containers });
    assertNoGuidInVisibleText(document.body);
  });
});

describe("UI invariant: partial-dimension graceful rendering (#308 reshape)", () => {
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

  /**
   * The explicit regression test per reviewer directive: when the
   * dimension covers some but not all ids (user left the org
   * mid-window, partial hydration race, etc.), the panel MUST render,
   * rows MUST remain distinguishable, and nothing MUST throw.
   *
   * A TypeError here — from builder UUID rejection, filter guards, or
   * anywhere else in the render path — would turn a cosmetic leak
   * into a blank-panel break. That is the failure this test guards.
   */
  it("throughput drill-down with a partial authorsDimension: renders, rows distinguishable, no TypeError", () => {
    const resolvedId = "alice";
    const unresolvedUuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const rollups: Rollup[] = [
      {
        week: "2025-W12",
        pr_count: 30,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 2,
        reviewers_count: 1,
        by_repository: null,
        by_author: {
          [resolvedId]: { pr_count: 20 },
          [unresolvedUuid]: { pr_count: 10 },
        },
        by_team: null,
      },
    ];
    const container = document.createElement("div");
    container.id = "throughput-chart";
    document.body.appendChild(container);
    renderThroughputChart(container, rollups);

    expect(() => {
      installThroughputDrilldown(container, rollups, {
        // Dimension covers `alice` only; `unresolvedUuid` is in the
        // rollup but absent from the dimension (partial case).
        authorsDimension: [
          { author_id: resolvedId, author_name: "Alice Smith" },
        ],
      });
      container
        .querySelector<HTMLElement>(".bar-container")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    }).not.toThrow();

    expect(isDetailPanelOpen()).toBe(true);

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    // Resolved id → friendly name; unresolved UUID → raw id.
    expect(rowLabels).toEqual(["Alice Smith", unresolvedUuid]);
    // Rows remain distinguishable despite the partial dimension.
    expect(new Set(rowLabels).size).toBe(rowLabels.length);
  });

  it("reviewer drill-down with missing reviewersDimension + UUID reviewer_id: renders, no TypeError", () => {
    const uuidReviewerId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const rollups: Rollup[] = [
      {
        week: "2025-W12",
        pr_count: 10,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 3,
        reviewers_count: 1,
        by_repository: null,
        by_team: null,
        by_reviewer: {
          [uuidReviewerId]: {
            reviews_count: 5,
            reviewed_prs: 3,
            approval_rate: 0.8,
            repositories_count: 2,
          },
        },
      },
    ];
    const container = document.createElement("div");
    container.id = "reviewer-activity";
    document.body.appendChild(container);
    renderReviewerActivity(container, rollups, {
      reviewerFilterActive: true,
      filters: {
        repos: [],
        teams: [],
        reviewers: [uuidReviewerId],
        authors: [],
      },
    });

    expect(() => {
      installReviewerDrilldown(container, rollups);
      container
        .querySelector<HTMLElement>(".h-bar-row")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    }).not.toThrow();

    expect(isDetailPanelOpen()).toBe(true);
    // Panel title surfaces the raw UUID — cosmetic leak, not a crash.
    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      uuidReviewerId,
    );
  });
});
