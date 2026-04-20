/**
 * UI invariant gate (issue #308): no GUID-shaped string may appear in
 * any text a user reads or a screen-reader announces.
 *
 * Scope:
 *   - textContent of visible elements
 *   - `aria-label` attribute (SR-facing)
 *   - `title` attribute (hover tooltip)
 *
 * Explicitly NOT in scope: `data-*` attributes, `id`, `class`, any other
 * non-user-visible attribute. GUIDs remain valid carriers for
 * drill-down dispatch and debugging in those attributes.
 *
 * Each surface below is mounted with GUID-shaped source ids so a
 * resolution regression would leak a visible GUID; the helper fails
 * loudly with the matched substring and the offending element.
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
import { UNKNOWN_USER_LABEL } from "../../ui/modules/shared/identity-fallback";
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

function openThroughputPanel(options: {
  authorsDimension?: readonly { author_id: string; author_name: string }[];
}): HTMLElement {
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
    authorsDimension: options.authorsDimension,
  });
  container
    .querySelector<HTMLElement>(".bar-container")!
    .dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  return container;
}

function openReviewerPanel(options: {
  reviewersDimension?: readonly {
    reviewer_id: string;
    reviewer_name: string;
  }[];
}): HTMLElement {
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
  });
  installReviewerDrilldown(container, rollups, {
    reviewersDimension: options.reviewersDimension,
  });
  container
    .querySelector<HTMLElement>(".h-bar-row")!
    .dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  return container;
}

function openCycleTimePanel(): HTMLElement {
  // renderCycleTimeTrend requires >= 2 weeks to render the line chart
  // (per its empty-state guard at rollups.length < 2); supplying two
  // weeks produces the .line-chart-dot trigger surface.
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
  return container;
}

describe("UI invariant: no GUID in visible text (#308)", () => {
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

  describe("throughput drill-down", () => {
    it("with authorsDimension supplied → resolved names, no GUID in panel", () => {
      openThroughputPanel({
        authorsDimension: [
          { author_id: AUTHOR_GUID_A, author_name: AUTHOR_NAME_A },
          { author_id: AUTHOR_GUID_B, author_name: AUTHOR_NAME_B },
        ],
      });
      assertNoGuidInVisibleText(document.body);
      const body = document.body.textContent ?? "";
      expect(body).toContain(AUTHOR_NAME_A);
      expect(body).toContain(AUTHOR_NAME_B);
    });

    it("with authorsDimension missing → fallback fires, no GUID in panel", () => {
      openThroughputPanel({});
      assertNoGuidInVisibleText(document.body);
    });
  });

  describe("reviewer drill-down", () => {
    it("with reviewersDimension supplied → resolved name, no GUID in panel", () => {
      openReviewerPanel({
        reviewersDimension: [
          { reviewer_id: REVIEWER_GUID, reviewer_name: REVIEWER_NAME },
        ],
      });
      assertNoGuidInVisibleText(document.body);
      expect(document.body.textContent ?? "").toContain(REVIEWER_NAME);
    });

    it("with reviewersDimension missing → fallback fires, no GUID in panel or chart aria-label", () => {
      openReviewerPanel({});
      assertNoGuidInVisibleText(document.body);
    });
  });

  describe("reviewer-activity chart (aria-label leak guard)", () => {
    it("with filterReviewerName supplied → aria-label uses name", () => {
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
      assertNoGuidInVisibleText(document.body);
    });

    it("with filterReviewerName missing → UNKNOWN_USER_LABEL in aria-label, no GUID", () => {
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
      document.body.appendChild(container);
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: {
          repos: [],
          teams: [],
          reviewers: [REVIEWER_GUID],
          authors: [],
        },
      });
      assertNoGuidInVisibleText(document.body);
    });
  });

  describe("cycle-time drill-down (forward-looking — keys are repo names today, guard against future id-keying)", () => {
    it("no GUID in By-repository panel", () => {
      openCycleTimePanel();
      assertNoGuidInVisibleText(document.body);
    });
  });

  describe("summary cards (forward-looking — no known GUID surfaces today)", () => {
    it("no GUID in rendered summary cards", () => {
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

  describe("fallback consistency (#308)", () => {
    it("UNKNOWN_USER_LABEL is 'Unknown user' and fires across all three remediated surfaces", () => {
      // Throughput By-author fallback
      openThroughputPanel({});
      expect(document.body.textContent ?? "").toContain(UNKNOWN_USER_LABEL);
      dismissDetailPanel("explicit-close-button");
      document.body.innerHTML = "";

      // Reviewer panel title fallback
      openReviewerPanel({});
      expect(document.body.textContent ?? "").toContain(UNKNOWN_USER_LABEL);
      dismissDetailPanel("explicit-close-button");
      document.body.innerHTML = "";

      // Reviewer-activity aria-label fallback (SR-visible, not in textContent)
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
      document.body.appendChild(container);
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: {
          repos: [],
          teams: [],
          reviewers: [REVIEWER_GUID],
          authors: [],
        },
      });
      const row = container.querySelector<HTMLElement>(".h-bar-row");
      expect(row).not.toBeNull();
      expect(row!.getAttribute("aria-label") ?? "").toContain(
        UNKNOWN_USER_LABEL,
      );

      // Literal copy lock — every fallback site must use the exact same
      // string. Catches divergence like "Unknown" / "—" / "(n/a)".
      expect(UNKNOWN_USER_LABEL).toBe("Unknown user");
    });
  });
});
