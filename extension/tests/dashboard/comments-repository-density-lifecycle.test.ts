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
 * Source-parse contract: a separate describe block below LOCKS the
 * test-side mirrors to the production helpers in ``dashboard.ts`` via
 * ``dashboardSrc.indexOf(...)`` + ``expect(helperBody).toContain(...)``
 * assertions — so the mirrors cannot silently drift from the real
 * helpers (Codex stop-time review caught a prior version that used
 * the mirrors without the source-parse lock — the lifecycle scenarios
 * verified the mirror's behavior, not production's).  Same contract
 * shape as 334's lifecycle test (lines 236-317) but scoped to the
 * 335 helpers + the CL-10 anchor (per-author row → per-repo row).
 *
 * No F3 live-loader regression here — that's covered separately in
 * extension/tests/artifact-client.test.ts (T010, Phase 2.1a) per
 * FR-3-04.
 */

import * as _fsOriginal from "fs";

function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}

const _fs = _loadFs();

import { resolve } from "path";

import { renderCommentsRepositoryDensityChart } from "../../ui/modules/charts/comments-repository-density";
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
// Mirrors ``ensureCommentsRepositoryDensityContainer`` /
// ``removeCommentsRepositoryDensityContainer``.  These duplicate the
// production helpers so lifecycle scenarios can be exercised without
// bootstrapping the full dashboard chain.  Drift between mirror and
// production is caught by behavioral assertions (not source-parse) —
// any production-side change to the helpers' DOM shape (id, data-attr,
// heading text, anchor selector) will surface as a scenario failure.
// ---------------------------------------------------------------------------

function ensureCommentsDensityGridContract(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>(
    '[data-comments-density-grid="true"]',
  );
  if (existing) return existing;

  const trendRow = document.querySelector('[data-comments-trend-row="true"]');
  let anchorRow: Element | null = trendRow;
  if (!anchorRow) {
    const cycleDist = document.getElementById("cycle-distribution");
    anchorRow = cycleDist?.closest(".charts-row") ?? null;
  }
  if (!anchorRow || !anchorRow.parentElement) return null;

  const grid = document.createElement("div");
  grid.className = "charts-row comments-density-grid";
  grid.setAttribute("data-comments-density-grid", "true");

  anchorRow.parentElement.insertBefore(grid, anchorRow.nextSibling);

  return grid;
}

function removeCommentsDensityGridIfEmptyContract(): void {
  const grid = document.querySelector('[data-comments-density-grid="true"]');
  if (!grid) return;
  if (grid.children.length === 0) {
    grid.parentElement?.removeChild(grid);
  }
}

function ensureCommentsRepositoryDensityContainerContract(): HTMLElement | null {
  const existing = document.getElementById("comments-repository-density");
  if (existing) return existing;

  const grid = ensureCommentsDensityGridContract();
  if (!grid) return null;

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";
  containerCell.setAttribute("data-comments-repository-density-row", "true");

  const heading = document.createElement("h3");
  heading.textContent = "Comments by Repository";
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-repository-density";
  chart.className = "chart";

  containerCell.appendChild(chart);
  grid.appendChild(containerCell);

  return chart;
}

function removeCommentsRepositoryDensityContainerContract(): void {
  const row = document.querySelector(
    '[data-comments-repository-density-row="true"]',
  );
  if (!row) return;
  row.parentElement?.removeChild(row);
  removeCommentsDensityGridIfEmptyContract();
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

// Insert a synthetic 334 per-author panel as the FIRST child of the
// shared comments-density-grid wrapper (issue #357 reshape).  In the
// pre-#357 world the 334 row was a sibling row inserted below 333; in
// the new world it is the wrapper's first child.  Tests (b), (c), (d)
// need a mounted 334 panel so the 335 anchor + insertion path can be
// exercised: the 335 helper appends its own panel to the same wrapper
// so 335 lands as the wrapper's SECOND child (sibling of 334 within
// the grid, not within the metrics tab).
function mount334Row(): HTMLElement {
  const grid = ensureCommentsDensityGridContract();
  if (!grid) {
    throw new Error("density grid not mountable (333 row missing?)");
  }
  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";
  containerCell.setAttribute("data-comments-author-density-row", "true");
  const heading = document.createElement("h3");
  heading.textContent = "Comments by Author";
  containerCell.appendChild(heading);
  const chart = document.createElement("div");
  chart.id = "comments-author-density";
  chart.className = "chart";
  containerCell.appendChild(chart);
  grid.appendChild(containerCell);
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
// Source-parse contract — locks the test-side mirrors to dashboard.ts.
//
// These assertions are the load-bearing binding between the mirror
// helpers above and the production helpers in ``dashboard.ts``.
// Without them the lifecycle scenarios (a)-(d) would only verify the
// mirror's behavior, leaving production drift undetected (Codex
// stop-time review caught this on a prior version of T025).
// ===========================================================================

describe("comments-repository-density dashboard lifecycle — source-parse contract", () => {
  it("ensureCommentsRepositoryDensityContainer in dashboard.ts implements check-first idempotency + density-grid mount (issue #357)", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsRepositoryDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2500);

    // Check-first idempotency: the helper queries the existing leaf
    // BEFORE building any new DOM.  Without this, scenario (d) would
    // fail (a second render would insert a duplicate panel).
    expect(helperBody).toContain(
      'document.getElementById("comments-repository-density")',
    );
    expect(helperBody).toMatch(/if \(existing\) return existing;/);

    // Issue #357: the per-author / per-repo / per-reviewer panels share
    // a single comments-density-grid wrapper.  The pre-#357 fallback
    // chain (334 → 333 → cycle-distribution) collapsed into the
    // wrapper helper itself, locked by ensureCommentsDensityGrid's
    // own source-parse contract in
    // comments-density-subgrid-layout.test.ts; here we only assert
    // this helper delegates to it.
    expect(helperBody).toContain("ensureCommentsDensityGrid()");
    expect(helperBody).toMatch(/if \(!grid\) return null;/);

    // Container markers used by the cleanup helper, lifecycle scenarios
    // (a)-(d), and dashboard parity gates.  The data-attribute moved
    // from the old outer ``.charts-row`` element to the
    // ``.chart-container`` cell — selector-by-attribute callers
    // continue to find the panel because the attribute is still
    // present on the same logical element.
    expect(helperBody).toContain('containerCell.className = "chart-container"');
    expect(helperBody).toContain(
      'containerCell.setAttribute("data-comments-repository-density-row", "true")',
    );
    expect(helperBody).toContain('chart.id = "comments-repository-density"');

    // Insertion is now an appendChild on the wrapper rather than an
    // insertBefore on a sibling — children fill the 2-up grid in
    // call order (author → repo → reviewer).
    expect(helperBody).toContain("grid.appendChild(containerCell)");
  });

  it("ensureCommentsRepositoryDensityContainer mounts the heading", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsRepositoryDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2500);

    // Peer-pattern parity with the 333 / 334 rows: every chart container
    // has an <h3> title.  The locked text is asserted here so a future
    // refactor that drops or renames it fails this contract.
    expect(helperBody).toContain('document.createElement("h3")');
    expect(helperBody).toContain(
      'heading.textContent = "Comments by Repository"',
    );
  });

  it("removeCommentsRepositoryDensityContainer targets the data-attribute selector and trims the empty wrapper (issue #357)", () => {
    const helperStart = dashboardSrc.indexOf(
      "function removeCommentsRepositoryDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 800);
    expect(helperBody).toContain(
      '[data-comments-repository-density-row="true"]',
    );
    expect(helperBody).toMatch(/if \(!row\) return;/);
    expect(helperBody).toContain("row.parentElement?.removeChild(row)");
    // Issue #357: cleanup must ALSO trim the wrapper when the panel
    // was the last density child.
    expect(helperBody).toContain("removeCommentsDensityGridIfEmpty()");
  });

  it("dashboard refresh path calls both helpers behind the capability gate", () => {
    // The capability gate at dashboard.ts is the entry point all four
    // lifecycle scenarios verify.  If the gate or call sites move,
    // this assertion fails so scenario (d)'s "two consecutive
    // refreshes" simulation can be re-validated.
    expect(dashboardSrc).toContain(
      "ensureCommentsRepositoryDensityContainer()",
    );
    expect(dashboardSrc).toContain(
      "renderCommentsRepositoryDensityChartModule(crdContainer",
    );
    expect(dashboardSrc).toContain(
      "removeCommentsRepositoryDensityContainer()",
    );
  });
});

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
    // Issue #357: 2 pre-feature rows + 333 trend row + density-grid
    // wrapper (containing author + repo) = 4.  The wrapper counts as
    // a single ``.charts-row`` regardless of how many density panels
    // it hosts.
    expect(document.querySelectorAll(".charts-row").length).toBe(4);

    // Step 2: capability-off reload runs only the remove helper.
    removeCommentsRepositoryDensityContainerContract();

    // Cleanup: per-repo row gone, but the 333 trend row and the
    // density-grid wrapper (still hosting the author panel) survive
    // because the wrapper is only trimmed when its child count
    // drops to zero.
    expect(document.getElementById("comments-repository-density")).toBeNull();
    expect(
      document.querySelector('[data-comments-repository-density-row="true"]'),
    ).toBeNull();
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"] h3',
      ),
    ).toHaveLength(0);
    // 333 row + density-grid wrapper (with author) still present.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"]').length,
    ).toBe(1);
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"]')
        .length,
    ).toBe(1);
    expect(
      document.querySelectorAll('[data-comments-density-grid="true"]').length,
    ).toBe(1);
    // 2 pre-feature rows + 333 row + density-grid (with author) = 4.
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
      document.querySelectorAll('[data-comments-repository-density-row="true"]')
        .length,
    ).toBe(1);
    expect(
      document.querySelectorAll("#comments-repository-density").length,
    ).toBe(1);
    expect(
      document.querySelectorAll(
        '[data-comments-repository-density-row="true"] h3',
      ),
    ).toHaveLength(1);

    // Issue #357: 2 pre-feature rows + 333 trend row + density-grid
    // wrapper (now hosting author + repo as children) = 4.
    expect(document.querySelectorAll(".charts-row").length).toBe(4);

    // CL-10 ordering inside the density-grid wrapper: the per-repo
    // panel sits IMMEDIATELY AFTER the per-author panel (siblings
    // within the wrapper, not within the metrics tab).  This keeps
    // the original "repo follows author" reading order even though
    // they now share a parent.
    const perAuthorRow = document.querySelector(
      '[data-comments-author-density-row="true"]',
    );
    expect(perAuthorRow).not.toBeNull();
    expect(
      perAuthorRow!.parentElement?.getAttribute("data-comments-density-grid"),
    ).toBe("true");
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
      document.querySelectorAll('[data-comments-repository-density-row="true"]')
        .length,
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
    // Issue #357: 2 pre-feature + 333 + density-grid = 4 (wrapper
    // counts as one row regardless of how many density panels it hosts).
    expect(document.querySelectorAll(".charts-row").length).toBe(4);
  });
});
