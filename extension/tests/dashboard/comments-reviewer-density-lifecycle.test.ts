/**
 * Comments-Reviewer-Density Dashboard Lifecycle Tests (Feature 336 / T029).
 *
 * Verifies the dashboard-layer container helpers
 * (``ensureCommentsReviewerDensityContainer`` /
 * ``removeCommentsReviewerDensityContainer``) and the on→on re-render
 * idempotency invariant under the four lifecycle paths called out by
 * FR-3-01 + FR-3-02 + SC-1-03:
 *
 *   (a) Initial capability-off — no chart row mounted; Metrics tab DOM
 *       byte-identical to the pre-feature baseline.
 *   (b) On→off transition — ``removeCommentsReviewerDensityContainer``
 *       cleans up the previously inserted row; sibling 333 + 334 + 335
 *       rows stay (each owned by its own remove helper).
 *   (c) Off→on transition — ``ensureCommentsReviewerDensityContainer``
 *       inserts the row exactly once, positioned IMMEDIATELY AFTER the
 *       335 per-repo row per CL-11.
 *   (d) On→on re-render idempotency — calling the dashboard's
 *       per-refresh sequence (``ensureCommentsReviewerDensityContainer()``
 *       + ``renderCommentsReviewerDensityChart()``) twice consecutively
 *       yields exactly ONE row, ONE chart leaf, and non-duplicated row /
 *       sort-toolbar content.
 *
 * Same test-side-mirror pattern as the 334 / 335 lifecycle tests: the
 * file does NOT mock ``getCapabilityState()``; it instead simulates the
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
 * helpers.  Same contract shape as 334 / 335 lifecycle tests but
 * scoped to the 336 helpers + the CL-11 anchor (per-repo row →
 * per-author row → trend row → cycle-distribution).
 *
 * No F3 live-loader regression here — that's covered separately in
 * extension/tests/artifact-client.test.ts per FR-3-04.
 */

import * as _fsOriginal from "fs";

function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}

const _fs = _loadFs();

import { resolve } from "path";

import { renderCommentsReviewerDensityChart } from "../../ui/modules/charts/comments-reviewer-density";
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
// Mirrors ``ensureCommentsReviewerDensityContainer`` /
// ``removeCommentsReviewerDensityContainer``.  These duplicate the
// production helpers so lifecycle scenarios can be exercised without
// bootstrapping the full dashboard chain.  Drift between mirror and
// production is caught by behavioral assertions (not source-parse) —
// any production-side change to the helpers' DOM shape (id, data-attr,
// heading text, anchor selector) will surface as a scenario failure.
// ---------------------------------------------------------------------------

function ensureCommentsReviewerDensityContainerContract(): HTMLElement | null {
  const existing = document.getElementById("comments-reviewer-density");
  if (existing) return existing;

  const perRepoRow = document.querySelector(
    '[data-comments-repository-density-row="true"]',
  );
  let anchorRow: Element | null = perRepoRow;
  if (!anchorRow) {
    anchorRow = document.querySelector(
      '[data-comments-author-density-row="true"]',
    );
  }
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
  row.setAttribute("data-comments-reviewer-density-row", "true");

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";

  const heading = document.createElement("h3");
  heading.textContent = "Comment Density by Reviewer";
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-reviewer-density";
  chart.className = "chart";

  containerCell.appendChild(chart);
  row.appendChild(containerCell);

  anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling);

  return chart;
}

function removeCommentsReviewerDensityContainerContract(): void {
  const row = document.querySelector(
    '[data-comments-reviewer-density-row="true"]',
  );
  if (!row) return;
  row.parentElement?.removeChild(row);
}

// ---------------------------------------------------------------------------
// Pre-feature Metrics-tab baseline.
//
// Mirrors the pre-Feature-336 static markup: the four pre-existing charts
// (throughput, cycle-time-trend, reviewer-activity, cycle-distribution).
// Capability-off renders the Metrics tab byte-identical to this baseline:
// none of the 333 / 334 / 335 / 336 rows are mounted (they share the
// single ``commentsMetricsAvailable`` gate per the SC-1-03 byte-identity
// contract).
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
// the same so the 335 row can anchor on the 334 row, and the 336 row
// can anchor on the 335 row per CL-11.
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

// Insert a synthetic 335 per-repo row immediately after the 334 row.
// Mirrors the dashboard's capability-on render order so the 336 row
// can anchor on the 335 row per CL-11.  Tests (b), (c), (d) need 333
// + 334 + 335 rows mounted to exercise the 336 anchor-and-insert path
// correctly.
function mount335Row(): HTMLElement {
  const perAuthorRow = document.querySelector(
    '[data-comments-author-density-row="true"]',
  );
  if (!perAuthorRow || !perAuthorRow.parentElement) {
    throw new Error("334 row must be mounted before 335 row");
  }
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
  perAuthorRow.parentElement.insertBefore(row, perAuthorRow.nextSibling);
  return chart;
}

// ---------------------------------------------------------------------------
// Per-reviewer rollup builder (used by scenarios (b)-(d)).
// ---------------------------------------------------------------------------

interface ReviewerBucket {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function makeReviewerRollup(index: number, reviewerCount: number): Rollup {
  const buckets: Record<string, ReviewerBucket> = {};
  for (let i = 0; i < reviewerCount; i++) {
    buckets[`user-${String(i).padStart(3, "0")}`] = {
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
    authors_count: reviewerCount,
    reviewers_count: 3 + index,
    by_repository: null,
    by_team: null,
    by_reviewer_comments: buckets,
  };
}

function makeReviewerRollups(
  weekCount: number,
  reviewerCount: number,
): Rollup[] {
  return Array.from({ length: weekCount }, (_, i) =>
    makeReviewerRollup(i, reviewerCount),
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
// mirror's behavior, leaving production drift undetected.  Same shape
// as 334 / 335 lifecycle tests' source-parse contract.
// ===========================================================================

describe("comments-reviewer-density dashboard lifecycle — source-parse contract", () => {
  it("ensureCommentsReviewerDensityContainer in dashboard.ts implements check-first idempotency + CL-11 (per-repo) anchor preference", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsReviewerDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2500);

    // Check-first idempotency: the helper queries the existing leaf
    // BEFORE building any new DOM.  Without this, scenario (d) would
    // fail (a second render would insert a duplicate row).
    expect(helperBody).toContain(
      'document.getElementById("comments-reviewer-density")',
    );
    expect(helperBody).toMatch(/if \(existing\) return existing;/);

    // CL-11 anchor: 335 per-repo row primary, 334 per-author row
    // fallback, 333 trend row fallback, cycle-distribution baseline.
    // This locks the production anchor chain so any refactor that
    // drops or reorders the fallbacks surfaces here.  Scenario (c)
    // verifies the resulting position, but the contract here verifies
    // the lookup PREFERENCE is intact.
    expect(helperBody).toContain(
      '[data-comments-repository-density-row="true"]',
    );
    expect(helperBody).toContain('[data-comments-author-density-row="true"]');
    expect(helperBody).toContain('[data-comments-trend-row="true"]');
    expect(helperBody).toContain(
      'document.getElementById("cycle-distribution")',
    );
    expect(helperBody).toContain('.closest(".charts-row")');

    // Row markers used by the cleanup helper and by scenarios (a)-(d).
    expect(helperBody).toContain('row.className = "charts-row"');
    expect(helperBody).toContain(
      'row.setAttribute("data-comments-reviewer-density-row", "true")',
    );
    expect(helperBody).toContain('chart.id = "comments-reviewer-density"');

    // Insertion ordering: the new row sits immediately after the anchor
    // row's next sibling so it lands BELOW the per-repo row per CL-11.
    expect(helperBody).toContain(
      "anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling)",
    );
  });

  it("ensureCommentsReviewerDensityContainer mounts the heading", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsReviewerDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2500);

    // Peer-pattern parity with the 333 / 334 / 335 rows: every chart
    // container has an <h3> title.  The locked text is asserted here
    // so a future refactor that drops or renames it fails this
    // contract.
    expect(helperBody).toContain('document.createElement("h3")');
    expect(helperBody).toContain(
      'heading.textContent = "Comment Density by Reviewer"',
    );
  });

  it("removeCommentsReviewerDensityContainer in dashboard.ts targets the data-attribute selector", () => {
    const helperStart = dashboardSrc.indexOf(
      "function removeCommentsReviewerDensityContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 800);
    expect(helperBody).toContain('[data-comments-reviewer-density-row="true"]');
    expect(helperBody).toMatch(/if \(!row\) return;/);
    expect(helperBody).toContain("row.parentElement?.removeChild(row)");
  });

  it("dashboard refresh path calls both helpers behind the capability gate", () => {
    // The capability gate at dashboard.ts is the entry point all four
    // lifecycle scenarios verify.  If the gate or call sites move,
    // this assertion fails so scenario (d)'s "two consecutive
    // refreshes" simulation can be re-validated.
    //
    // Trailing semicolon is load-bearing: the bare ``ensureCommentsReviewer
    // DensityContainer()`` / ``removeCommentsReviewerDensityContainer()``
    // strings match BOTH the call statements AND the function definitions
    // (``function name(): HTMLElement | null {`` / ``function name():
    // void {``), so a future refactor that deletes either callsite would
    // leave the assertions matching the definition and the contract would
    // pass vacuously.  The ``();`` form distinguishes call statements
    // from the ``():`` definition headers.
    expect(dashboardSrc).toContain("ensureCommentsReviewerDensityContainer();");
    expect(dashboardSrc).toContain(
      "renderCommentsReviewerDensityChartModule(crvContainer",
    );
    expect(dashboardSrc).toContain("removeCommentsReviewerDensityContainer();");
  });
});

// ===========================================================================
// Lifecycle scenarios (a)-(d) per T029.
// ===========================================================================

describe("comments-reviewer-density dashboard lifecycle — four scenarios (T029)", () => {
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
    removeCommentsReviewerDensityContainerContract();

    // No chart leaf, no row marker.
    expect(document.getElementById("comments-reviewer-density")).toBeNull();
    expect(
      document.querySelector('[data-comments-reviewer-density-row="true"]'),
    ).toBeNull();

    // Heading absent under initial capability-off — chart row was never
    // inserted, so its child <h3> is not mounted either.
    expect(
      document.querySelectorAll(
        '[data-comments-reviewer-density-row="true"] h3',
      ),
    ).toHaveLength(0);

    // Four pre-existing charts still occupy their original layout positions.
    expect(document.getElementById("throughput-chart")).not.toBeNull();
    expect(document.getElementById("cycle-time-trend")).not.toBeNull();
    expect(document.getElementById("reviewer-activity")).not.toBeNull();
    expect(document.getElementById("cycle-distribution")).not.toBeNull();

    // Two pre-feature `.charts-row` elements only — no new row inserted
    // (333 / 334 / 335 / 336 rows are also absent under capability-off,
    // matching the SC-1-03 byte-identity contract — the four features
    // share the single commentsMetricsAvailable gate).
    expect(document.querySelectorAll(".charts-row").length).toBe(2);

    // Strict byte-identity: capability-off must produce the same DOM
    // string as the pre-feature baseline.
    expect(metricsTabHtml()).toBe(baselineHtml);
  });

  // -------------------------------------------------------------------------
  // Scenario (b) — on→off transition (FR-3-02).
  // -------------------------------------------------------------------------

  it("(b) on→off transition cleans up the per-reviewer row; sibling 333 + 334 + 335 rows survive", () => {
    // In production the 333 row mounts first under capability-on, then
    // 334, then 335, then 336.  Mirror that anchoring environment so
    // the 336 row is inserted below the 335 row.
    mount333Row();
    mount334Row();
    mount335Row();
    const baselineWith333_334_335 = metricsTabHtml();

    // Step 1: capability-on render inserts the per-reviewer row + content.
    const chart = ensureCommentsReviewerDensityContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsReviewerDensityChart(chart!, makeReviewerRollups(8, 5), {
      filters: NO_FILTERS,
    });

    // Sanity: per-reviewer row + chart leaf + rendered rows present.
    expect(document.getElementById("comments-reviewer-density")).not.toBeNull();
    expect(
      document.querySelector('[data-comments-reviewer-density-row="true"]'),
    ).not.toBeNull();
    expect(
      document.querySelectorAll(
        '[data-comments-reviewer-density-row="true"] h3',
      ),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(".comments-reviewer-density-row").length,
    ).toBe(5);
    // 2 pre-feature rows + 333 row + 334 row + 335 row + 336 row = 6
    expect(document.querySelectorAll(".charts-row").length).toBe(6);

    // Step 2: capability-off reload runs only the remove helper.
    removeCommentsReviewerDensityContainerContract();

    // Cleanup: per-reviewer row gone, but the 333 + 334 + 335 rows
    // stay (each owned by its own remove helper, not by this one).
    expect(document.getElementById("comments-reviewer-density")).toBeNull();
    expect(
      document.querySelector('[data-comments-reviewer-density-row="true"]'),
    ).toBeNull();
    expect(
      document.querySelectorAll(
        '[data-comments-reviewer-density-row="true"] h3',
      ),
    ).toHaveLength(0);
    // 333 + 334 + 335 rows still present.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"]').length,
    ).toBe(1);
    expect(
      document.querySelectorAll('[data-comments-author-density-row="true"]')
        .length,
    ).toBe(1);
    expect(
      document.querySelectorAll('[data-comments-repository-density-row="true"]')
        .length,
    ).toBe(1);
    // 2 pre-feature rows + 333 row + 334 row + 335 row = 5
    expect(document.querySelectorAll(".charts-row").length).toBe(5);
    expect(metricsTabHtml()).toBe(baselineWith333_334_335);
  });

  // -------------------------------------------------------------------------
  // Scenario (c) — off→on transition (FR-3-02 + CL-11 anchor).
  // -------------------------------------------------------------------------

  it("(c) off→on transition inserts the chart row exactly once, immediately after the 335 row (CL-11)", () => {
    mount333Row();
    mount334Row();
    mount335Row();

    // Step 1: capability-off render is a no-op on a fresh DOM.
    removeCommentsReviewerDensityContainerContract();
    expect(document.getElementById("comments-reviewer-density")).toBeNull();

    // Step 2: capability-on reload calls the ensure helper and renders.
    const chart = ensureCommentsReviewerDensityContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsReviewerDensityChart(chart!, makeReviewerRollups(8, 5), {
      filters: NO_FILTERS,
    });

    // Exactly one row marker and one chart leaf.
    expect(
      document.querySelectorAll('[data-comments-reviewer-density-row="true"]')
        .length,
    ).toBe(1);
    expect(document.querySelectorAll("#comments-reviewer-density").length).toBe(
      1,
    );
    expect(
      document.querySelectorAll(
        '[data-comments-reviewer-density-row="true"] h3',
      ),
    ).toHaveLength(1);

    // Total `.charts-row` count is now 6 (row-1 + row-2 + 333 + 334 +
    // 335 + 336).
    expect(document.querySelectorAll(".charts-row").length).toBe(6);

    // CL-11 anchor: the 336 row sits IMMEDIATELY AFTER the 335 row
    // (per-reviewer breakdown is mounted below the per-repo row in
    // the capability-on render order).
    const perRepoRow = document.querySelector(
      '[data-comments-repository-density-row="true"]',
    );
    expect(perRepoRow).not.toBeNull();
    expect(perRepoRow!.nextElementSibling).not.toBeNull();
    expect(
      perRepoRow!.nextElementSibling?.getAttribute(
        "data-comments-reviewer-density-row",
      ),
    ).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Scenario (d) — on→on re-render idempotency.
  // -------------------------------------------------------------------------

  it("(d) on→on re-render is idempotent at the dashboard AND chart layers", () => {
    mount333Row();
    mount334Row();
    mount335Row();
    const rollups = makeReviewerRollups(8, 5);

    // First "refresh" — capability-on path.
    const chart1 = ensureCommentsReviewerDensityContainerContract();
    expect(chart1).not.toBeNull();
    renderCommentsReviewerDensityChart(chart1!, rollups, {
      filters: NO_FILTERS,
    });

    const rowCountAfterFirst = document.querySelectorAll(
      '[data-comments-reviewer-density-row="true"]',
    ).length;
    const chartCountAfterFirst = document.querySelectorAll(
      "#comments-reviewer-density",
    ).length;
    const dataRowCountAfterFirst = document.querySelectorAll(
      ".comments-reviewer-density-row",
    ).length;
    const sortToolbarCountAfterFirst = document.querySelectorAll(
      '.comments-reviewer-density-sort[role="toolbar"]',
    ).length;
    const headingCountAfterFirst = document.querySelectorAll(
      '[data-comments-reviewer-density-row="true"] h3',
    ).length;

    expect(rowCountAfterFirst).toBe(1);
    expect(chartCountAfterFirst).toBe(1);
    expect(dataRowCountAfterFirst).toBe(5);
    expect(sortToolbarCountAfterFirst).toBe(1);
    expect(headingCountAfterFirst).toBe(1);

    // Second "refresh" — same capability state, same data.
    const chart2 = ensureCommentsReviewerDensityContainerContract();
    expect(chart2).not.toBeNull();
    renderCommentsReviewerDensityChart(chart2!, rollups, {
      filters: NO_FILTERS,
    });

    // DASHBOARD-LAYER IDEMPOTENCY: the second ensure call MUST reuse
    // the existing chart leaf instead of inserting a duplicate row.
    expect(chart2).toBe(chart1);
    expect(
      document.querySelectorAll('[data-comments-reviewer-density-row="true"]')
        .length,
    ).toBe(1);
    expect(document.querySelectorAll("#comments-reviewer-density").length).toBe(
      1,
    );

    // CHART-LAYER IDEMPOTENCY: renderTrustedHtml replaces content, so
    // row + sort-toolbar counts stay stable instead of doubling.
    expect(
      document.querySelectorAll(".comments-reviewer-density-row").length,
    ).toBe(dataRowCountAfterFirst);
    expect(
      document.querySelectorAll(
        '.comments-reviewer-density-sort[role="toolbar"]',
      ).length,
    ).toBe(sortToolbarCountAfterFirst);

    // Heading + total `.charts-row` count stable.
    expect(
      document.querySelectorAll(
        '[data-comments-reviewer-density-row="true"] h3',
      ).length,
    ).toBe(1);
    expect(document.querySelectorAll(".charts-row").length).toBe(6);
  });
});
