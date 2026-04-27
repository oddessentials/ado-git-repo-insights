/**
 * Comments-Trend Dashboard Lifecycle Tests (Feature 333, T025).
 *
 * Verifies the dashboard-layer container helpers
 * (`ensureCommentsTrendContainer` / `removeCommentsTrendContainer`) and the
 * round-12 dashboard-layer idempotency invariant under the four lifecycle
 * paths called out by FR-3-01 + FR-3-02 + SC-1-04 + research.md Decision 10:
 *
 *   (a) Initial capability-off — no chart row mounted; Metrics tab DOM
 *       byte-identical to the pre-feature baseline.
 *   (b) On→off transition — `removeCommentsTrendContainer` cleans up the
 *       previously inserted row; DOM returns to the pre-feature baseline
 *       (FR-3-02).
 *   (c) Off→on transition — `ensureCommentsTrendContainer` inserts the row
 *       exactly once (FR-3-02).
 *   (d) On→on re-render idempotency (round-13 closure of the round-12 test
 *       gap) — calling the dashboard's per-refresh comments-trend sequence
 *       (`ensureCommentsTrendContainer()` + `renderCommentsTrendChart()`)
 *       twice consecutively yields exactly ONE row, ONE chart leaf, and
 *       non-duplicated bar/legend content. The simpler "call the two
 *       helpers twice" simulation is contractually equivalent to a full
 *       dashboard refresh because those two calls are EXACTLY what the
 *       dashboard's capability-on branch (dashboard.ts:1085-1094) does for
 *       the comments-trend chart on every refresh cycle (no other helpers
 *       touch the chart's DOM between renders).
 *
 * Why this file does not import dashboard.ts directly:
 * `extension/ui/dashboard.ts` runs `void init()` at module load (the
 * `DOMContentLoaded` branch that fires immediately when jsdom's
 * `document.readyState === "complete"`), so importing it triggers the full
 * dashboard bootstrap chain (cacheElements / setupEventListeners /
 * resolveConfiguration / etc.). The established test pattern for
 * dashboard-private helpers (`tests/dashboard.test.ts` inlining
 * renderPredictions; `tests/dashboard/settings-contract.test.ts` mirroring
 * `getSourceConfig()`) is to mirror the helper's body in a thin test-side
 * "contract" function and lock the mirror to the real source via a
 * source-parse assertion. That is what this file does:
 *
 *   - `ensureCommentsTrendContainerContract()` and
 *     `removeCommentsTrendContainerContract()` mirror dashboard.ts:1580-1626.
 *   - The "source-parse contract" describe block source-parses dashboard.ts
 *     and asserts the real helpers contain the load-bearing tokens
 *     (check-first idempotency, anchor lookup, row attribute, removal
 *     selector) so the mirror cannot silently diverge from the real source.
 *
 * Reading order: scroll to the four-scenario describe block first; the
 * source-parse contract is the safety net.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import { resolve } from "path";

import {
  renderCommentsTrendChart,
  attachCommentsTrendInfoIcon,
  detachCommentsTrendInfoIcon,
} from "../../ui/modules/charts/comments-trend";
import type { Rollup } from "../../ui/dataset-loader";

// ---------------------------------------------------------------------------
// Source under test (read once for the contract-lock describe block).
// ---------------------------------------------------------------------------

const dashboardSrcPath = resolve(__dirname, "../../ui/dashboard.ts");
const dashboardSrc = _fs.readFileSync(dashboardSrcPath, "utf-8");

// ---------------------------------------------------------------------------
// Test-side mirrors of the dashboard helpers (dashboard.ts:1580-1626).
//
// These intentionally duplicate the production logic verbatim so this test
// exercises the documented behavior in jsdom without importing dashboard.ts
// (which would fire `init()` at module load and cascade through the entire
// dashboard bootstrap). The "source-parse contract" describe block locks
// each mirror to its production counterpart so they cannot silently drift.
// ---------------------------------------------------------------------------

/** Mirror of dashboard.ts:1582 `ensureCommentsTrendContainer`. */
function ensureCommentsTrendContainerContract(): HTMLElement | null {
  const existing = document.getElementById("comments-trend");
  if (existing) return existing;

  const cycleDist = document.getElementById("cycle-distribution");
  const anchorRow = cycleDist?.closest(".charts-row") ?? null;
  if (!anchorRow || !anchorRow.parentElement) return null;

  const row = document.createElement("div");
  row.className = "charts-row";
  row.setAttribute("data-comments-trend-row", "true");

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";

  const heading = document.createElement("h3");
  heading.textContent = "Comments Trend";
  attachCommentsTrendInfoIcon(heading);
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-trend";
  chart.className = "chart";

  containerCell.appendChild(chart);
  row.appendChild(containerCell);

  anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling);

  return chart;
}

/** Mirror of dashboard.ts:1625 `removeCommentsTrendContainer`. */
function removeCommentsTrendContainerContract(): void {
  const row = document.querySelector('[data-comments-trend-row="true"]');
  if (!row) return;
  const heading = row.querySelector("h3");
  if (heading instanceof HTMLElement) {
    detachCommentsTrendInfoIcon(heading);
  }
  row.parentElement?.removeChild(row);
}

// ---------------------------------------------------------------------------
// Pre-feature Metrics-tab baseline.
//
// Mirrors the static markup in `extension/ui/index.html` lines 234-258 (the
// two `.charts-row` blocks that host the four pre-existing charts):
//   Row 1: throughput-chart + cycle-time-trend
//   Row 2: reviewer-activity + cycle-distribution
//
// FR-3-01 / SC-1-04 byte-identity is verified against this baseline.
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

// ---------------------------------------------------------------------------
// Comments-bearing rollup builder (12-week fixture used by scenario (d)).
// Mirrors `makeCommentsRollup` in modules/charts/comments-trend.test.ts so
// the chart-layer assertions stay aligned across the two test files.
// ---------------------------------------------------------------------------

function makeCommentsRollup(index: number): Rollup {
  const threadCount = 5 + index;
  return {
    week: `2025-W${String(index + 1).padStart(2, "0")}`,
    pr_count: 10 + index * 2,
    cycle_time_p50: 60 + index * 5,
    cycle_time_p90: 120 + index * 10,
    authors_count: 4 + index,
    reviewers_count: 3 + index,
    by_repository: null,
    by_team: null,
    comments: {
      thread_count: threadCount,
      comment_count: threadCount * 4,
      active_thread_count: Math.min(2, threadCount),
      coverage_partial: false,
    },
  };
}

function makeCommentsRollups(count: number): Rollup[] {
  return Array.from({ length: count }, (_, i) => makeCommentsRollup(i));
}

// ===========================================================================
// Source-parse contract — locks the test-side mirrors to dashboard.ts.
// ===========================================================================

describe("comments-trend dashboard lifecycle — source-parse contract", () => {
  it("ensureCommentsTrendContainer in dashboard.ts implements check-first idempotency", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsTrendContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2000);

    // Round-12 idempotency: the helper queries the existing leaf BEFORE
    // building any new DOM. If it didn't, a second render would insert a
    // duplicate row, breaking scenario (d).
    expect(helperBody).toContain('document.getElementById("comments-trend")');
    expect(helperBody).toMatch(/if \(existing\) return existing;/);

    // Anchor on the static `cycle-distribution` row so insertion is stable
    // across capability flips and dataset reloads.
    expect(helperBody).toContain(
      'document.getElementById("cycle-distribution")',
    );
    expect(helperBody).toContain('.closest(".charts-row")');

    // Row markers used by the cleanup helper and by scenarios (a)-(d).
    expect(helperBody).toContain('row.className = "charts-row"');
    expect(helperBody).toContain(
      'row.setAttribute("data-comments-trend-row", "true")',
    );
    expect(helperBody).toContain('chart.id = "comments-trend"');

    // Insertion ordering: the new row sits immediately after the anchor
    // row's next sibling — keeps the new full-width chart below the 2x2.
    expect(helperBody).toContain(
      "anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling)",
    );
  });

  it("ensureCommentsTrendContainer mounts the heading + info-icon affordance", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsTrendContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2000);

    // Peer-pattern parity with index.html:236-256: every chart container
    // has an <h3> title. The new chart's heading text is locked here so a
    // future refactor that drops or renames it fails this contract.
    expect(helperBody).toContain('document.createElement("h3")');
    expect(helperBody).toContain('heading.textContent = "Comments Trend"');

    // Chart-level info-icon affordance (FR-1-04 disclosure surface).
    // The attach call is the contractual binding to the controller-tracked
    // info-icon module — moving the wiring out of this helper would break
    // the dashboard-layer cleanup path.
    expect(helperBody).toContain("attachCommentsTrendInfoIcon(heading)");
  });

  it("removeCommentsTrendContainer in dashboard.ts targets the data-attribute selector and detaches the info-icon", () => {
    const helperStart = dashboardSrc.indexOf(
      "function removeCommentsTrendContainer(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 800);
    expect(helperBody).toContain('[data-comments-trend-row="true"]');
    // Early-return guard keeps the rest of the body inside an
    // already-narrowed `row` reference, so the removal line drops the
    // leading `row?.` chain that the pre-affordance helper used.
    expect(helperBody).toMatch(/if \(!row\) return;/);
    expect(helperBody).toContain("row.parentElement?.removeChild(row)");
    // Info-icon detach is the cleanup half of the new affordance.
    expect(helperBody).toContain("detachCommentsTrendInfoIcon(heading)");
  });

  it("dashboard refresh path calls both helpers behind the capability gate", () => {
    // The capability gate at dashboard.ts:1085-1094 is the entry point that
    // all four lifecycle scenarios verify. If the gate or the helpers'
    // call sites move, this assertion fails so scenario (d)'s "two
    // consecutive refreshes" simulation can be re-validated.
    expect(dashboardSrc).toContain("commentsMetricsAvailable === true");
    expect(dashboardSrc).toContain("ensureCommentsTrendContainer()");
    expect(dashboardSrc).toContain(
      "renderCommentsTrendChartModule(ctsContainer",
    );
    expect(dashboardSrc).toContain("removeCommentsTrendContainer()");
  });
});

// ===========================================================================
// Lifecycle scenarios (a)-(d).
// ===========================================================================

describe("comments-trend dashboard lifecycle — four scenarios (T025)", () => {
  let baselineHtml: string;

  beforeEach(() => {
    mountPreFeatureBaseline();
    baselineHtml = metricsTabHtml();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // -------------------------------------------------------------------------
  // Scenario (a) — initial capability-off (FR-3-01 + SC-1-04).
  // -------------------------------------------------------------------------

  it("(a) initial capability-off renders Metrics tab byte-identical to pre-feature baseline", () => {
    // The dashboard's capability-off branch calls
    // `removeCommentsTrendContainer()` only (no insertion). Initial
    // capability-off is a pure no-op because the row was never inserted.
    removeCommentsTrendContainerContract();

    // No chart leaf, no row marker.
    expect(document.getElementById("comments-trend")).toBeNull();
    expect(
      document.querySelector('[data-comments-trend-row="true"]'),
    ).toBeNull();

    // Heading + info-icon affordance also absent under initial capability-off
    // — the chart row was never inserted, so neither child is mounted.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"] h3'),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll(
        '.info-icon-btn[data-info-tooltip="comments-trend"]',
      ),
    ).toHaveLength(0);

    // Four pre-existing charts still occupy their original layout positions.
    expect(document.getElementById("throughput-chart")).not.toBeNull();
    expect(document.getElementById("cycle-time-trend")).not.toBeNull();
    expect(document.getElementById("reviewer-activity")).not.toBeNull();
    expect(document.getElementById("cycle-distribution")).not.toBeNull();

    // Two pre-feature `.charts-row` elements only — no new row inserted.
    const rows = document.querySelectorAll(".charts-row");
    expect(rows.length).toBe(2);

    // Strict byte-identity: capability-off must produce the same DOM string
    // as the pre-feature baseline (research.md Decision 10's load-bearing
    // verification).
    expect(metricsTabHtml()).toBe(baselineHtml);
  });

  // -------------------------------------------------------------------------
  // Scenario (b) — on→off transition (FR-3-02).
  // -------------------------------------------------------------------------

  it("(b) on→off transition cleans up the chart row and restores byte-identity", () => {
    // Step 1: capability-on render inserts the row.
    const chart = ensureCommentsTrendContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsTrendChart(chart!, makeCommentsRollups(12));

    // Sanity: row + chart leaf + bar content present after the on render.
    expect(document.getElementById("comments-trend")).not.toBeNull();
    expect(
      document.querySelector('[data-comments-trend-row="true"]'),
    ).not.toBeNull();
    // Heading + info-icon are mounted alongside the chart leaf.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"] h3'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(
        '.info-icon-btn[data-info-tooltip="comments-trend"]',
      ),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(".comments-trend-bars .bar-container").length,
    ).toBe(12);
    expect(document.querySelectorAll(".charts-row").length).toBe(3);

    // Step 2: capability-off reload runs only the removal helper.
    removeCommentsTrendContainerContract();

    // Cleanup: no leaf, no row marker, byte-identical to pre-feature.
    expect(document.getElementById("comments-trend")).toBeNull();
    expect(
      document.querySelector('[data-comments-trend-row="true"]'),
    ).toBeNull();
    // Heading + info-icon are detached as part of the cleanup.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"] h3'),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll(
        '.info-icon-btn[data-info-tooltip="comments-trend"]',
      ),
    ).toHaveLength(0);
    expect(document.querySelectorAll(".charts-row").length).toBe(2);
    expect(metricsTabHtml()).toBe(baselineHtml);
  });

  // -------------------------------------------------------------------------
  // Scenario (c) — off→on transition (FR-3-02).
  // -------------------------------------------------------------------------

  it("(c) off→on transition inserts the chart row exactly once", () => {
    // Step 1: capability-off render is a no-op on a fresh DOM.
    removeCommentsTrendContainerContract();
    expect(document.getElementById("comments-trend")).toBeNull();

    // Step 2: capability-on reload calls the ensure helper and renders.
    const chart = ensureCommentsTrendContainerContract();
    expect(chart).not.toBeNull();
    renderCommentsTrendChart(chart!, makeCommentsRollups(12));

    // Exactly one row marker and one chart leaf.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"]').length,
    ).toBe(1);
    expect(document.querySelectorAll("#comments-trend").length).toBe(1);

    // Heading + info-icon affordance are mounted exactly once.
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"] h3'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(
        '.info-icon-btn[data-info-tooltip="comments-trend"]',
      ),
    ).toHaveLength(1);

    // Total `.charts-row` count is now three (row-1 + row-2 + new row).
    expect(document.querySelectorAll(".charts-row").length).toBe(3);

    // The new row sits AFTER the anchor row that hosts cycle-distribution
    // (research.md Decision 10 — top-to-bottom story is throughput → cycle
    // → comments).
    const cycleDist = document.getElementById("cycle-distribution");
    const anchorRow = cycleDist?.closest(".charts-row") ?? null;
    expect(anchorRow).not.toBeNull();
    expect(anchorRow!.nextElementSibling).not.toBeNull();
    expect(
      anchorRow!.nextElementSibling?.getAttribute("data-comments-trend-row"),
    ).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Scenario (d) — on→on re-render idempotency (round-13 addition).
  //
  // This is the load-bearing test for round-12's fix at the DASHBOARD layer.
  // The chart-layer content idempotency (modules/charts/comments-trend.test.ts
  // case (h)) covers the chart module's `renderTrustedHtml` replacement, but
  // NOT the dashboard's check-first row insertion. Round-13 caught the gap;
  // this scenario closes it.
  //
  // Calling `ensureCommentsTrendContainerContract()` + `renderCommentsTrendChart()`
  // twice in succession is contractually equivalent to a full dashboard
  // refresh fired by dataset reload / filter change / tab-switch-back: those
  // two calls are EXACTLY what dashboard.ts:1085-1094 does for the
  // comments-trend chart on every refresh cycle (locked by the source-parse
  // contract above).
  // -------------------------------------------------------------------------

  it("(d) on→on re-render is idempotent at the dashboard AND chart layers (round-12 + round-13)", () => {
    const rollups = makeCommentsRollups(12);

    // First "refresh" — capability-on path.
    const chart1 = ensureCommentsTrendContainerContract();
    expect(chart1).not.toBeNull();
    renderCommentsTrendChart(chart1!, rollups);

    // Snapshot post-first-render counts.
    const rowCountAfterFirst = document.querySelectorAll(
      '[data-comments-trend-row="true"]',
    ).length;
    const chartCountAfterFirst =
      document.querySelectorAll("#comments-trend").length;
    const barCountAfterFirst = document.querySelectorAll(
      ".comments-trend-bars .bar-container",
    ).length;
    const legendItemCountAfterFirst = document.querySelectorAll(
      ".chart-legend .legend-item",
    ).length;
    const headingCountAfterFirst = document.querySelectorAll(
      '[data-comments-trend-row="true"] h3',
    ).length;
    const infoIconCountAfterFirst = document.querySelectorAll(
      '.info-icon-btn[data-info-tooltip="comments-trend"]',
    ).length;

    expect(rowCountAfterFirst).toBe(1);
    expect(chartCountAfterFirst).toBe(1);
    expect(barCountAfterFirst).toBe(12);
    expect(legendItemCountAfterFirst).toBeGreaterThan(0);
    expect(headingCountAfterFirst).toBe(1);
    expect(infoIconCountAfterFirst).toBe(1);

    // Second "refresh" — same capability state, same data. Real dashboard
    // refreshes fire on dataset reload / filter change / tab-switch-back.
    const chart2 = ensureCommentsTrendContainerContract();
    expect(chart2).not.toBeNull();
    renderCommentsTrendChart(chart2!, rollups);

    // DASHBOARD-LAYER IDEMPOTENCY (round-12): the second
    // `ensureCommentsTrendContainerContract()` call MUST reuse the existing
    // chart leaf instead of inserting a duplicate row. Round-12's fix
    // hinges on this assertion.
    expect(chart2).toBe(chart1);
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"]').length,
    ).toBe(1);
    expect(document.querySelectorAll("#comments-trend").length).toBe(1);

    // CHART-LAYER IDEMPOTENCY (locked by modules/charts/comments-trend.test.ts
    // case (h), re-asserted here at the dashboard scope): the second
    // renderCommentsTrendChart call replaces content rather than appending,
    // so bar/legend counts stay stable instead of doubling.
    expect(
      document.querySelectorAll(".comments-trend-bars .bar-container").length,
    ).toBe(barCountAfterFirst);
    expect(document.querySelectorAll(".chart-legend .legend-item").length).toBe(
      legendItemCountAfterFirst,
    );

    // AFFORDANCE IDEMPOTENCY: the heading and info-icon are check-first
    // siblings of the chart leaf — the second ensure call returns the
    // existing leaf and skips re-mounting the row entirely, so the
    // affordance stays at exactly one each (no duplicate <h3>, no duplicate
    // info-icon button).
    expect(
      document.querySelectorAll('[data-comments-trend-row="true"] h3').length,
    ).toBe(1);
    expect(
      document.querySelectorAll(
        '.info-icon-btn[data-info-tooltip="comments-trend"]',
      ).length,
    ).toBe(1);

    // Total `.charts-row` count is still three (no second comments-trend
    // row was inserted alongside the original).
    expect(document.querySelectorAll(".charts-row").length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Scenario (e) — capability-on heading + info-icon affordance.
  //
  // Locks the chart-level disclosure surface (FR-1-04 explanatory affordance;
  // SC-1-01/02 first-glance comprehension) at the canonical attribute level,
  // so a future refactor that drops the heading text, renames the data-
  // tooltip id, or swaps the glyph fails this scenario rather than slipping
  // through the more permissive count-only assertions in (b)-(d). Mirrors
  // the canonical info-icon test pattern from
  // `modules/drilldown/pr-list-comments-columns.test.ts` (issue #332 / B2).
  // -------------------------------------------------------------------------

  it("(e) capability-on render exposes <h3>Comments Trend</h3> with a single info-icon-btn child carrying the canonical attributes", () => {
    const chart = ensureCommentsTrendContainerContract();
    expect(chart).not.toBeNull();

    // Heading is present, sits inside the comments-trend row's chart
    // container, and carries the locked title text. The info-icon glyph is
    // appended as a child node, so we use `toContain` rather than strict
    // equality on `textContent`.
    const heading = document.querySelector(
      '[data-comments-trend-row="true"] .chart-container > h3',
    );
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toContain("Comments Trend");

    // Info-icon affordance: single button, parented to the heading.
    const icons = heading?.querySelectorAll(".info-icon-btn") ?? [];
    expect(icons).toHaveLength(1);

    const btn = icons[0] as HTMLButtonElement;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-label")).toBe("About this chart");
    expect(btn.getAttribute("data-info-tooltip")).toBe("comments-trend");
    expect(btn.textContent).toBe("ℹ");
    expect(btn.parentElement).toBe(heading);
  });
});
