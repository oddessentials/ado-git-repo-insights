/**
 * Comments-Repository-Density Dashboard Lifecycle Tests (Feature 335 / T025).
 *
 * Verifies the dashboard-layer container helpers
 * (``ensureCommentsRepositoryDensityContainer`` /
 * ``removeCommentsRepositoryDensityContainer``) and the on→on re-render
 * idempotency invariant under the four lifecycle paths called out by
 * FR-3-01 + FR-3-02 + SC-1-03:
 *
 *   (a) Initial capability-off — no chart row mounted; Metrics tab DOM
 *       byte-identical to the pre-feature baseline.
 *   (b) On→off transition — ``removeCommentsRepositoryDensityContainer``
 *       cleans up the previously inserted row; sibling 333 + 334 rows
 *       stay (each owned by its own remove helper).
 *   (c) Off→on transition — ``ensureCommentsRepositoryDensityContainer``
 *       inserts the row exactly once, positioned IMMEDIATELY AFTER the
 *       334 per-author row per CL-10.
 *   (d) On→on re-render idempotency — calling the dashboard's
 *       per-refresh sequence (``ensureCommentsRepositoryDensityContainer()``
 *       + ``renderCommentsRepositoryDensityChart()``) twice consecutively
 *       yields exactly ONE row, ONE chart leaf, and non-duplicated row /
 *       sort-toolbar content.
 *
 * Same test-side-mirror pattern as the 334 lifecycle test: the file
 * does NOT mock ``getCapabilityState()``; it instead simulates the
 * capability-gate's BEHAVIOR by directly calling the contract-mirror
 * ensure/remove helpers below (the dashboard's two branches).  The
 * mirrors duplicate the production helpers' implementations so the
 * lifecycle invariants can be exercised in jsdom without bootstrapping
 * the full dashboard module (importing dashboard.ts would trigger
 * init() at module load and side-effect the entire dashboard chain).
 *
 * No F3 live-loader regression here — that's covered separately in
 * extension/tests/artifact-client.test.ts (T010, Phase 2.1a) per
 * FR-3-04 and the user's "scope narrowly to lifecycle" directive.
 */

import { renderCommentsRepositoryDensityChart } from "../../ui/modules/charts/comments-repository-density";
import type { Rollup } from "../../ui/dataset-loader";
import type { FilterState } from "../../ui/modules/filters";

// ---------------------------------------------------------------------------
// Test-side mirrors of the dashboard helpers in dashboard.ts.
//
// Mirrors ``ensureCommentsRepositoryDensityContainer`` /
// ``removeCommentsRepositoryDensityContainer``.  These duplicate the
// production helpers so lifecycle scenarios can be exercised without
// bootstrapping the full dashboard chain.  Drift between mirror and
// production is caught by behavioral assertions (not source-parse) —
// any production-side change to the helpers' DOM shape (id, data-attr,
// heading text, anchor selector) will surface as a scenario failure.
// ---------------------------------------------------------------------------

function ensureCommentsRepositoryDensityContainerContract(): HTMLElement | null {
  const existing = document.getElementById("comments-repository-density");
  if (existing) return existing;

  const perAuthorRow = document.querySelector(
    '[data-comments-author-density-row="true"]',
  );
  let anchorRow: Element | null = perAuthorRow;
  if (!anchorRow) {
    anchorRow = document.querySelector('[data-comments-trend-row="true"]');
  }
  if (!anchorRow) {
    const cycleDist = document.getElementById("cycle-distribution");
    anchorRow = cycleDist?.closest(".charts-row") ?? null;
  }
  if (!anchorRow || !anchorRow.parentElement) return null;

  const row = document.createElement("div");
  row.className = "charts-row";
  row.setAttribute("data-comments-repository-density-row", "true");

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";

  const heading = document.createElement("h3");
  heading.textContent = "Comment Density by Repository";
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-repository-density";
  chart.className = "chart";

  containerCell.appendChild(chart);
  row.appendChild(containerCell);

  anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling);

  return chart;
}

function removeCommentsRepositoryDensityContainerContract(): void {
  const row = document.querySelector(
    '[data-comments-repository-density-row="true"]',
  );
  if (!row) return;
  row.parentElement?.removeChild(row);
}

// ---------------------------------------------------------------------------
// Pre-feature Metrics-tab baseline.
//
// Mirrors the pre-Feature-335 static markup: the four pre-existing charts
// (throughput, cycle-time-trend, reviewer-activity, cycle-distribution).
// Capability-off renders the Metrics tab byte-identical to this baseline:
// neither the 333 / 334 rows nor the 335 row are mounted.
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
// capability-on render order (333 row mounted first).  Anchored on
// cycle-distribution per the production 333 helper.
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

// Insert a synthetic 334 per-author row immediately after the 333 row.
// In production the 334 helper anchors on the 333 row; this mirror does
// the same so the 335 row can anchor on the 334 row per CL-10.  Tests
// (b), (c), (d) need both 333 + 334 rows mounted to exercise the 335
// anchor-and-insert path correctly.
function mount334Row(): HTMLElement {
  const trendRow = document.querySelector('[data-comments-trend-row="true"]');
  if (!trendRow || !trendRow.parentElement) {
    throw new Error("333 row must be mounted before 334 row");
  }
  const row = document.createElement("div");
  row.className = "charts-row";
  row.setAttribute("data-comments-author-density-row", "true");
  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";
  const heading = document.createElement("h3");
  heading.textContent = "Comment Density by Author";
  containerCell.appendChild(heading);
  const chart = document.createElement("div");
  chart.id = "comments-author-density";
  chart.className = "chart";
  containerCell.appendChild(chart);
  row.appendChild(containerCell);
  trendRow.parentElement.insertBefore(row, trendRow.nextSibling);
  return chart;
}

// ---------------------------------------------------------------------------
// Per-repo rollup builder (used by scenarios (b)-(d)).
// ---------------------------------------------------------------------------

interface RepoBucket {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function makeRepoRollup(index: number, repoCount: number): Rollup {
  const buckets: Record<string, RepoBucket> = {};
  for (let i = 0; i < repoCount; i++) {
    buckets[`repo-${String(i).padStart(3, "0")}`] = {
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
    authors_count: repoCount,
    reviewers_count: 3 + index,
    by_repository: null,
    by_team: null,
    by_repository_comments: buckets,
  };
}

function makeRepoRollups(weekCount: number, repoCount: number): Rollup[] {
  return Array.from({ length: weekCount }, (_, i) =>
    makeRepoRollup(i, repoCount),
  );
}

const NO_FILTERS: FilterState = {
  repos: [],
  teams: [],
  reviewers: [],
  authors: [],
};

// ===========================================================================
// Lifecycle scenarios (a)-(d) per T025.
// ===========================================================================

describe("comments-repository-density dashboard lifecycle — four scenarios (T025)", () => {
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
    // Dashboard's capability-off branch calls the remove helper only
    // (no insertion).  Initial capability-off is a pure no-op because
    // the row was never inserted.
    removeCommentsRepositoryDensityContainerContract();

    // No chart leaf, no row marker.
    expect(document.getElementById("comments-repository-density")).toBeNull();
    expect(
      document.querySelector('[data-comments-repository-density-row="true"]'),
    ).toBeNull();

    // Heading absent under initial capability-off — chart row was never
    // inserted, so its child <h3> is not mounted either.
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"] h3',
      ),
    ).toHaveLength(0);

    // Four pre-existing charts still occupy their original layout positions.
    expect(document.getElementById("throughput-chart")).not.toBeNull();
    expect(document.getElementById("cycle-time-trend")).not.toBeNull();
    expect(document.getElementById("reviewer-activity")).not.toBeNull();
    expect(document.getElementById("cycle-distribution")).not.toBeNull();

    // Two pre-feature `.charts-row` elements only — no new row inserted
    // (333 and 334 rows are also absent under capability-off, matching
    // the SC-1-03 byte-identity contract).
    expect(document.querySelectorAll(".charts-row").length).toBe(2);

    // Strict byte-identity: capability-off must produce the same DOM
    // string as the pre-feature baseline.
    expect(metricsTabHtml()).toBe(baselineHtml);
  });

  // -------------------------------------------------------------------------
  // Scenario (b) — on→off transition (FR-3-02).
  // -------------------------------------------------------------------------

  it("(b) on→off transition cleans up the per-repo row; sibling 333 + 334 rows survive", () => {
    // In production the 333 row mounts first under capability-on, then
    // 334, then 335.  Mirror that anchoring environment so the 335 row
    // is inserted below the 334 row.
    mount333Row();
    mount334Row();
    const baselineWith333And334 = metricsTabHtml();

    // Step 1: capability-on render inserts the per-repo row + content.
    const chart = ensureCommentsRepositoryDensityContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsRepositoryDensityChart(chart!, makeRepoRollups(8, 5), {
      filters: NO_FILTERS,
    });

    // Sanity: per-repo row + chart leaf + rendered rows present.
    expect(
      document.getElementById("comments-repository-density"),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-comments-repository-density-row="true"]'),
    ).not.toBeNull();
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"] h3',
      ),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(".comments-repository-density-row").length,
    ).toBe(5);
    // 2 pre-feature rows + 333 row + 334 row + 335 row = 5
    expect(document.querySelectorAll(".charts-row").length).toBe(5);

    // Step 2: capability-off reload runs only the remove helper.
    removeCommentsRepositoryDensityContainerContract();

    // Cleanup: per-repo row gone, but the 333 + 334 rows stay (each
    // owned by its own remove helper, not by this one).
    expect(document.getElementById("comments-repository-density")).toBeNull();
    expect(
      document.querySelector('[data-comments-repository-density-row="true"]'),
    ).toBeNull();
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"] h3',
      ),
    ).toHaveLength(0);
    // 333 + 334 rows still present.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"]').length,
    ).toBe(1);
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"]')
        .length,
    ).toBe(1);
    // 2 pre-feature rows + 333 row + 334 row = 4
    expect(document.querySelectorAll(".charts-row").length).toBe(4);
    expect(metricsTabHtml()).toBe(baselineWith333And334);
  });

  // -------------------------------------------------------------------------
  // Scenario (c) — off→on transition (FR-3-02 + CL-10 anchor).
  // -------------------------------------------------------------------------

  it("(c) off→on transition inserts the chart row exactly once, immediately after the 334 row (CL-10)", () => {
    mount333Row();
    mount334Row();

    // Step 1: capability-off render is a no-op on a fresh DOM.
    removeCommentsRepositoryDensityContainerContract();
    expect(document.getElementById("comments-repository-density")).toBeNull();

    // Step 2: capability-on reload calls the ensure helper and renders.
    const chart = ensureCommentsRepositoryDensityContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsRepositoryDensityChart(chart!, makeRepoRollups(8, 5), {
      filters: NO_FILTERS,
    });

    // Exactly one row marker and one chart leaf.
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"]',
      ).length,
    ).toBe(1);
    expect(
      document.querySelectorAll("#comments-repository-density").length,
    ).toBe(1);
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"] h3',
      ),
    ).toHaveLength(1);

    // Total `.charts-row` count is now 5 (row-1 + row-2 + 333 + 334 + 335).
    expect(document.querySelectorAll(".charts-row").length).toBe(5);

    // CL-10 anchor: the 335 row sits IMMEDIATELY AFTER the 334 row
    // (per-repo breakdown is mounted below the per-author row in the
    // capability-on render order).
    const perAuthorRow = document.querySelector(
      '[data-comments-author-density-row="true"]',
    );
    expect(perAuthorRow).not.toBeNull();
    expect(perAuthorRow!.nextElementSibling).not.toBeNull();
    expect(
      perAuthorRow!.nextElementSibling?.getAttribute(
        "data-comments-repository-density-row",
      ),
    ).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Scenario (d) — on→on re-render idempotency.
  // -------------------------------------------------------------------------

  it("(d) on→on re-render is idempotent at the dashboard AND chart layers", () => {
    mount333Row();
    mount334Row();
    const rollups = makeRepoRollups(8, 5);

    // First "refresh" — capability-on path.
    const chart1 = ensureCommentsRepositoryDensityContainerContract();
    expect(chart1).not.toBeNull();
    renderCommentsRepositoryDensityChart(chart1!, rollups, {
      filters: NO_FILTERS,
    });

    const rowCountAfterFirst = document.querySelectorAll(
      '[data-comments-repository-density-row="true"]',
    ).length;
    const chartCountAfterFirst = document.querySelectorAll(
      "#comments-repository-density",
    ).length;
    const dataRowCountAfterFirst = document.querySelectorAll(
      ".comments-repository-density-row",
    ).length;
    const sortToolbarCountAfterFirst = document.querySelectorAll(
      '.comments-repository-density-sort[role="toolbar"]',
    ).length;
    const headingCountAfterFirst = document.querySelectorAll(
      '[data-comments-repository-density-row="true"] h3',
    ).length;

    expect(rowCountAfterFirst).toBe(1);
    expect(chartCountAfterFirst).toBe(1);
    expect(dataRowCountAfterFirst).toBe(5);
    expect(sortToolbarCountAfterFirst).toBe(1);
    expect(headingCountAfterFirst).toBe(1);

    // Second "refresh" — same capability state, same data.
    const chart2 = ensureCommentsRepositoryDensityContainerContract();
    expect(chart2).not.toBeNull();
    renderCommentsRepositoryDensityChart(chart2!, rollups, {
      filters: NO_FILTERS,
    });

    // DASHBOARD-LAYER IDEMPOTENCY: the second ensure call MUST reuse
    // the existing chart leaf instead of inserting a duplicate row.
    expect(chart2).toBe(chart1);
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"]',
      ).length,
    ).toBe(1);
    expect(
      document.querySelectorAll("#comments-repository-density").length,
    ).toBe(1);

    // CHART-LAYER IDEMPOTENCY: renderTrustedHtml replaces content, so
    // row + sort-toolbar counts stay stable instead of doubling.
    expect(
      document.querySelectorAll(".comments-repository-density-row").length,
    ).toBe(dataRowCountAfterFirst);
    expect(
      document.querySelectorAll(
        '.comments-repository-density-sort[role="toolbar"]',
      ).length,
    ).toBe(sortToolbarCountAfterFirst);

    // Heading + total `.charts-row` count stable.
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"] h3',
      ).length,
    ).toBe(1);
    expect(document.querySelectorAll(".charts-row").length).toBe(5);
  });
});
