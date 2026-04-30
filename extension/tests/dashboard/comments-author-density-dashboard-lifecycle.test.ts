/**
 * Comments-Author-Density Dashboard Lifecycle Tests (Feature 334, T027).
 *
 * Verifies the dashboard-layer container helpers
 * (``ensureCommentsAuthorDensityContainer`` /
 * ``removeCommentsAuthorDensityContainer``) and the on→on re-render
 * idempotency invariant under the four lifecycle paths called out by
 * FR-3-01 + FR-3-02 + SC-1-03:
 *
 *   (a) Initial capability-off — no chart row mounted; Metrics tab DOM
 *       byte-identical to the pre-feature baseline.
 *   (b) On→off transition — ``removeCommentsAuthorDensityContainer``
 *       cleans up the previously inserted row; DOM returns to the
 *       pre-feature baseline (FR-3-02).
 *   (c) Off→on transition — ``ensureCommentsAuthorDensityContainer``
 *       inserts the row exactly once (FR-3-02).
 *   (d) On→on re-render idempotency — calling the dashboard's
 *       per-refresh sequence (``ensureCommentsAuthorDensityContainer()`` +
 *       ``renderCommentsAuthorDensityChart()``) twice consecutively
 *       yields exactly ONE row, ONE chart leaf, and non-duplicated row /
 *       sort-toolbar content.
 *
 * Same source-parse contract pattern as the 333 lifecycle test
 * (``comments-trend-dashboard-lifecycle.test.ts``): test-side mirrors
 * of the dashboard helpers are locked to the production source via
 * ``dashboardSrc.indexOf`` assertions so the mirrors cannot silently
 * drift from the real ``dashboard.ts`` helpers.  Reading order: scroll
 * to the four-scenario describe block first; the source-parse contract
 * is the safety net.
 *
 * Why this file does not import dashboard.ts directly: ``init()`` runs
 * at module load (jsdom's ``DOMContentLoaded`` fires immediately) so
 * the entire dashboard bootstrap chain triggers — established pattern
 * is the test-side mirror with a source-parse lock (per 333 lifecycle
 * test header).
 */

import * as _fsOriginal from "fs";

function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}

const _fs = _loadFs();

import { resolve } from "path";

import { renderCommentsAuthorDensityChart } from "../../ui/modules/charts/comments-author-density";
import type { Rollup } from "../../ui/dataset-loader";
import type { FilterState } from "../../ui/modules/filters";

// ---------------------------------------------------------------------------
// Source under test (read once for the contract-lock describe block).
// ---------------------------------------------------------------------------

const dashboardSrcPath = resolve(__dirname, "../../ui/dashboard.ts");
const dashboardSrc = _fs.readFileSync(dashboardSrcPath, "utf-8");

// ---------------------------------------------------------------------------
// Test-side mirrors of the dashboard helpers in dashboard.ts.
//
// Mirrors ``ensureCommentsAuthorDensityContainer`` /
// ``removeCommentsAuthorDensityContainer``.  The source-parse contract
// describe block locks each mirror to its production counterpart so they
// cannot silently drift.
// ---------------------------------------------------------------------------

function ensureCommentsAuthorDensityContainerContract(): HTMLElement | null {
  const existing = document.getElementById("comments-author-density");
  if (existing) return existing;

  const commentsTrendRow = document.querySelector(
    '[data-comments-trend-row="true"]',
  );
  let anchorRow: Element | null = commentsTrendRow;
  if (!anchorRow) {
    const cycleDist = document.getElementById("cycle-distribution");
    anchorRow = cycleDist?.closest(".charts-row") ?? null;
  }
  if (!anchorRow || !anchorRow.parentElement) return null;

  const row = document.createElement("div");
  row.className = "charts-row";
  row.setAttribute("data-comments-author-density-row", "true");

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";

  const heading = document.createElement("h3");
  heading.textContent = "Comments by Author";
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-author-density";
  chart.className = "chart";

  containerCell.appendChild(chart);
  row.appendChild(containerCell);

  anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling);

  return chart;
}

function removeCommentsAuthorDensityContainerContract(): void {
  const row = document.querySelector(
    '[data-comments-author-density-row="true"]',
  );
  if (!row) return;
  row.parentElement?.removeChild(row);
}

// ---------------------------------------------------------------------------
// Pre-feature Metrics-tab baseline.
//
// Mirrors the pre-Feature-334 static markup: the four pre-existing charts
// (throughput, cycle-time-trend, reviewer-activity, cycle-distribution)
// plus the 333 ``comments-trend`` row that ships ahead of the per-author
// chart in any capability-on render order.  FR-3-01 / SC-1-03 byte-identity
// is verified against the no-comments-row baseline (i.e., the DOM state
// when ``capabilities.comments_metrics`` is off — the per-author row AND
// the 333 row are both absent).
// ---------------------------------------------------------------------------

const PRE_FEATURE_METRICS_HTML = `
  <section id="tab-metrics">
    <div class="charts-row" data-pre-feature-row="row-1">
      <div class="chart-container">
        <h3>PR Throughput Over Time</h3>
        <div id="throughput-chart" class="chart"></div>
      </div>
      <div class="chart-container">
        <h3>Cycle Time Trend</h3>
        <div id="cycle-time-trend" class="chart"></div>
      </div>
    </div>
    <div class="charts-row" data-pre-feature-row="row-2">
      <div class="chart-container">
        <h3 id="reviewer-activity-label">Reviewer Activity</h3>
        <div id="reviewer-activity" class="chart"></div>
      </div>
      <div class="chart-container">
        <h3>Cycle Time Distribution</h3>
        <div id="cycle-distribution" class="chart"></div>
      </div>
    </div>
  </section>
`;

function mountPreFeatureBaseline(): void {
  document.body.innerHTML = PRE_FEATURE_METRICS_HTML;
}

function metricsTabHtml(): string {
  return document.getElementById("tab-metrics")?.outerHTML ?? "";
}

// Insert a synthetic 333 comments-trend row mirroring the dashboard's
// capability-on render order (333 row mounted first, 334 row mounted
// below it).  Tests that exercise scenarios (b)/(c)/(d) need this so
// the 334 row anchors on the 333 row exactly as it does in production.
function mount333Row(): HTMLElement {
  const cycleDist = document.getElementById("cycle-distribution");
  const anchorRow = cycleDist?.closest(".charts-row");
  if (!anchorRow || !anchorRow.parentElement) {
    throw new Error("baseline missing cycle-distribution anchor");
  }
  const row = document.createElement("div");
  row.className = "charts-row";
  row.setAttribute("data-comments-trend-row", "true");
  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";
  const heading = document.createElement("h3");
  heading.textContent = "Comments Trend";
  containerCell.appendChild(heading);
  const chart = document.createElement("div");
  chart.id = "comments-trend";
  chart.className = "chart";
  containerCell.appendChild(chart);
  row.appendChild(containerCell);
  anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling);
  return chart;
}

// ---------------------------------------------------------------------------
// Per-author rollup builder (used by scenarios (b)-(d)).
// ---------------------------------------------------------------------------

interface AuthorBucket {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function makeAuthorRollup(index: number, authorCount: number): Rollup {
  const buckets: Record<string, AuthorBucket> = {};
  for (let i = 0; i < authorCount; i++) {
    buckets[`author-${String(i).padStart(3, "0")}`] = {
      thread_count: 5 + index,
      comment_count: (5 + index) * 4,
      active_thread_count: Math.min(2, 5 + index),
      coverage_partial: false,
    };
  }
  return {
    week: `2025-W${String(index + 1).padStart(2, "0")}`,
    pr_count: 10 + index * 2,
    cycle_time_p50: 60 + index * 5,
    cycle_time_p90: 120 + index * 10,
    authors_count: authorCount,
    reviewers_count: 3 + index,
    by_repository: null,
    by_team: null,
    by_author_comments: buckets,
  };
}

function makeAuthorRollups(weekCount: number, authorCount: number): Rollup[] {
  return Array.from({ length: weekCount }, (_, i) =>
    makeAuthorRollup(i, authorCount),
  );
}

const NO_FILTERS: FilterState = {
  repos: [],
  teams: [],
  reviewers: [],
  authors: [],
};

// ===========================================================================
// Source-parse contract — locks the test-side mirrors to dashboard.ts.
// ===========================================================================

describe("comments-author-density dashboard lifecycle — source-parse contract", () => {
  it("ensureCommentsAuthorDensityContainer in dashboard.ts implements check-first idempotency + 333 anchor preference", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsAuthorDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2000);

    // Check-first idempotency: the helper queries the existing leaf BEFORE
    // building any new DOM. Without this, scenario (d) would fail (a
    // second render would insert a duplicate row).
    expect(helperBody).toContain(
      'document.getElementById("comments-author-density")',
    );
    expect(helperBody).toMatch(/if \(existing\) return existing;/);

    // 333 anchor preference + cycle-distribution fallback. The
    // production anchor logic is what places the 334 row BELOW the 333
    // chart per FR-4-01 in the typical capability-on render order.
    expect(helperBody).toContain('[data-comments-trend-row="true"]');
    expect(helperBody).toContain(
      'document.getElementById("cycle-distribution")',
    );
    expect(helperBody).toContain('.closest(".charts-row")');

    // Row markers used by the cleanup helper and by scenarios (a)-(d).
    expect(helperBody).toContain('row.className = "charts-row"');
    expect(helperBody).toContain(
      'row.setAttribute("data-comments-author-density-row", "true")',
    );
    expect(helperBody).toContain('chart.id = "comments-author-density"');

    // Insertion ordering: the new row sits immediately after the anchor
    // row's next sibling so it lands BELOW the 333 chart (or below
    // cycle-distribution when 333 is not mounted).
    expect(helperBody).toContain(
      "anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling)",
    );
  });

  it("ensureCommentsAuthorDensityContainer mounts the heading", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsAuthorDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2000);

    // Peer-pattern parity with the 333 row: every chart container has
    // an <h3> title. The locked text is asserted here so a future
    // refactor that drops or renames it fails this contract.
    expect(helperBody).toContain('document.createElement("h3")');
    expect(helperBody).toContain(
      'heading.textContent = "Comments by Author"',
    );
  });

  it("removeCommentsAuthorDensityContainer in dashboard.ts targets the data-attribute selector", () => {
    const helperStart = dashboardSrc.indexOf(
      "function removeCommentsAuthorDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 800);
    expect(helperBody).toContain('[data-comments-author-density-row="true"]');
    expect(helperBody).toMatch(/if \(!row\) return;/);
    expect(helperBody).toContain("row.parentElement?.removeChild(row)");
  });

  it("dashboard refresh path calls both helpers behind the capability gate", () => {
    // The capability gate at dashboard.ts is the entry point all four
    // lifecycle scenarios verify. If the gate or call sites move, this
    // assertion fails so scenario (d)'s "two consecutive refreshes"
    // simulation can be re-validated.
    expect(dashboardSrc).toContain("ensureCommentsAuthorDensityContainer()");
    expect(dashboardSrc).toContain(
      "renderCommentsAuthorDensityChartModule(cadContainer",
    );
    expect(dashboardSrc).toContain("removeCommentsAuthorDensityContainer()");
  });
});

// ===========================================================================
// Lifecycle scenarios (a)-(d).
// ===========================================================================

describe("comments-author-density dashboard lifecycle — four scenarios (T027)", () => {
  let baselineHtml: string;

  beforeEach(() => {
    mountPreFeatureBaseline();
    baselineHtml = metricsTabHtml();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // -------------------------------------------------------------------------
  // Scenario (a) — initial capability-off (FR-3-01 + SC-1-03).
  // -------------------------------------------------------------------------

  it("(a) initial capability-off renders Metrics tab byte-identical to pre-feature baseline", () => {
    // The dashboard's capability-off branch calls the remove helper only
    // (no insertion). Initial capability-off is a pure no-op because the
    // row was never inserted.
    removeCommentsAuthorDensityContainerContract();

    // No chart leaf, no row marker.
    expect(document.getElementById("comments-author-density")).toBeNull();
    expect(
      document.querySelector('[data-comments-author-density-row="true"]'),
    ).toBeNull();

    // Heading absent under initial capability-off — the chart row was
    // never inserted, so its child <h3> is not mounted either.
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"] h3'),
    ).toHaveLength(0);

    // Four pre-existing charts still occupy their original layout positions.
    expect(document.getElementById("throughput-chart")).not.toBeNull();
    expect(document.getElementById("cycle-time-trend")).not.toBeNull();
    expect(document.getElementById("reviewer-activity")).not.toBeNull();
    expect(document.getElementById("cycle-distribution")).not.toBeNull();

    // Two pre-feature `.charts-row` elements only — no new row inserted.
    expect(document.querySelectorAll(".charts-row").length).toBe(2);

    // Strict byte-identity: capability-off must produce the same DOM
    // string as the pre-feature baseline.
    expect(metricsTabHtml()).toBe(baselineHtml);
  });

  // -------------------------------------------------------------------------
  // Scenario (b) — on→off transition (FR-3-02).
  // -------------------------------------------------------------------------

  it("(b) on→off transition cleans up the chart row and restores byte-identity", () => {
    // In production the 333 row mounts first under capability-on.  Mirror
    // that anchoring environment so the 334 row is inserted below it.
    mount333Row();
    const baselineWith333 = metricsTabHtml();

    // Step 1: capability-on render inserts the per-author row + content.
    const chart = ensureCommentsAuthorDensityContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsAuthorDensityChart(chart!, makeAuthorRollups(8, 5), {
      filters: NO_FILTERS,
    });

    // Sanity: per-author row + chart leaf + rendered rows present.
    expect(document.getElementById("comments-author-density")).not.toBeNull();
    expect(
      document.querySelector('[data-comments-author-density-row="true"]'),
    ).not.toBeNull();
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"] h3'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(".comments-author-density-row").length,
    ).toBe(5);
    // 2 pre-feature rows + 333 row + 334 row = 4
    expect(document.querySelectorAll(".charts-row").length).toBe(4);

    // Step 2: capability-off reload runs only the remove helper.
    removeCommentsAuthorDensityContainerContract();

    // Cleanup: per-author row gone, but the 333 row stays (it's owned
    // by removeCommentsTrendContainer, not this helper).
    expect(document.getElementById("comments-author-density")).toBeNull();
    expect(
      document.querySelector('[data-comments-author-density-row="true"]'),
    ).toBeNull();
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"] h3'),
    ).toHaveLength(0);
    // 333 row still present.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"]').length,
    ).toBe(1);
    // 2 pre-feature rows + 333 row = 3
    expect(document.querySelectorAll(".charts-row").length).toBe(3);
    expect(metricsTabHtml()).toBe(baselineWith333);
  });

  // -------------------------------------------------------------------------
  // Scenario (c) — off→on transition (FR-3-02).
  // -------------------------------------------------------------------------

  it("(c) off→on transition inserts the chart row exactly once", () => {
    mount333Row();

    // Step 1: capability-off render is a no-op on a fresh DOM.
    removeCommentsAuthorDensityContainerContract();
    expect(document.getElementById("comments-author-density")).toBeNull();

    // Step 2: capability-on reload calls the ensure helper and renders.
    const chart = ensureCommentsAuthorDensityContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsAuthorDensityChart(chart!, makeAuthorRollups(8, 5), {
      filters: NO_FILTERS,
    });

    // Exactly one row marker and one chart leaf.
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"]')
        .length,
    ).toBe(1);
    expect(document.querySelectorAll("#comments-author-density").length).toBe(
      1,
    );
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"] h3'),
    ).toHaveLength(1);

    // Total `.charts-row` count is now 4 (row-1 + row-2 + 333 row + 334 row).
    expect(document.querySelectorAll(".charts-row").length).toBe(4);

    // The 334 row sits IMMEDIATELY AFTER the 333 row (FR-4-01: per-author
    // breakdown sits below the weekly trend chart).
    const trendRow = document.querySelector('[data-comments-trend-row="true"]');
    expect(trendRow).not.toBeNull();
    expect(trendRow!.nextElementSibling).not.toBeNull();
    expect(
      trendRow!.nextElementSibling?.getAttribute(
        "data-comments-author-density-row",
      ),
    ).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Scenario (d) — on→on re-render idempotency.
  // -------------------------------------------------------------------------

  it("(d) on→on re-render is idempotent at the dashboard AND chart layers", () => {
    mount333Row();
    const rollups = makeAuthorRollups(8, 5);

    // First "refresh" — capability-on path.
    const chart1 = ensureCommentsAuthorDensityContainerContract();
    expect(chart1).not.toBeNull();
    renderCommentsAuthorDensityChart(chart1!, rollups, {
      filters: NO_FILTERS,
    });

    const rowCountAfterFirst = document.querySelectorAll(
      '[data-comments-author-density-row="true"]',
    ).length;
    const chartCountAfterFirst = document.querySelectorAll(
      "#comments-author-density",
    ).length;
    const dataRowCountAfterFirst = document.querySelectorAll(
      ".comments-author-density-row",
    ).length;
    const sortToolbarCountAfterFirst = document.querySelectorAll(
      '.comments-author-density-sort[role="toolbar"]',
    ).length;
    const headingCountAfterFirst = document.querySelectorAll(
      '[data-comments-author-density-row="true"] h3',
    ).length;

    expect(rowCountAfterFirst).toBe(1);
    expect(chartCountAfterFirst).toBe(1);
    expect(dataRowCountAfterFirst).toBe(5);
    expect(sortToolbarCountAfterFirst).toBe(1);
    expect(headingCountAfterFirst).toBe(1);

    // Second "refresh" — same capability state, same data.
    const chart2 = ensureCommentsAuthorDensityContainerContract();
    expect(chart2).not.toBeNull();
    renderCommentsAuthorDensityChart(chart2!, rollups, {
      filters: NO_FILTERS,
    });

    // DASHBOARD-LAYER IDEMPOTENCY: the second ensure call MUST reuse
    // the existing chart leaf instead of inserting a duplicate row.
    expect(chart2).toBe(chart1);
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"]')
        .length,
    ).toBe(1);
    expect(document.querySelectorAll("#comments-author-density").length).toBe(
      1,
    );

    // CHART-LAYER IDEMPOTENCY: renderTrustedHtml replaces content, so
    // row + sort-toolbar counts stay stable instead of doubling.
    expect(
      document.querySelectorAll(".comments-author-density-row").length,
    ).toBe(dataRowCountAfterFirst);
    expect(
      document.querySelectorAll('.comments-author-density-sort[role="toolbar"]')
        .length,
    ).toBe(sortToolbarCountAfterFirst);

    // Heading + total `.charts-row` count stable.
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"] h3')
        .length,
    ).toBe(1);
    expect(document.querySelectorAll(".charts-row").length).toBe(4);
  });
});
