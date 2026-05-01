/**
 * Comments-Density Sub-Grid Layout Tests (Issue #357).
 *
 * Verifies the dashboard-layer wrapper helpers
 * (``ensureCommentsDensityGrid`` /
 * ``removeCommentsDensityGridIfEmpty``) and the cross-helper lifecycle
 * invariants when all three density panels (per-author 334, per-repo
 * 335, per-reviewer 336) share the same
 * ``[data-comments-density-grid="true"]`` wrapper:
 *
 *   - Wrapper absent under initial capability-off (SC-1-03 byte-identity
 *     contract still holds; the wrapper is not mounted unless at least
 *     one density panel ensures it).
 *   - Wrapper created on first density-panel mount; subsequent panels
 *     reuse the existing wrapper (idempotency).
 *   - Wrapper persists across partial removals (still hosts children).
 *   - Wrapper removed when its last density-panel child is detached.
 *   - on→off→on cycles cleanly recreate the wrapper.
 *   - Trend row (333) stays full-width as the wrapper's preceding
 *     sibling — issue #357 acceptance ("trend full-width above the
 *     density grid").
 *
 * Same source-parse-contract pattern as the per-panel lifecycle tests:
 * test-side mirrors of the wrapper helpers are locked to production
 * via ``dashboardSrc.indexOf`` + ``expect(helperBody).toContain(...)``.
 *
 * @module tests/dashboard/comments-density-subgrid-layout.test.ts
 */

import * as _fsOriginal from "fs";

function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}

const _fs = _loadFs();

import { resolve } from "path";

const dashboardSrcPath = resolve(__dirname, "../../ui/dashboard.ts");
const dashboardSrc = _fs.readFileSync(dashboardSrcPath, "utf-8");

// ---------------------------------------------------------------------------
// Test-side mirrors — locked to production via the source-parse contract
// describe block below.
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

function appendDensityChildContract(
  grid: HTMLElement,
  dataAttr: string,
  chartId: string,
  headingText: string,
): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "chart-container";
  cell.setAttribute(dataAttr, "true");
  const heading = document.createElement("h3");
  heading.textContent = headingText;
  cell.appendChild(heading);
  const chart = document.createElement("div");
  chart.id = chartId;
  chart.className = "chart";
  cell.appendChild(chart);
  grid.appendChild(cell);
  return cell;
}

function detachDensityChild(dataAttr: string): void {
  const row = document.querySelector(`[${dataAttr}="true"]`);
  row?.parentElement?.removeChild(row);
  removeCommentsDensityGridIfEmptyContract();
}

// ---------------------------------------------------------------------------
// Pre-feature Metrics-tab baseline.  Mirrors the static markup the
// dashboard's ``init()`` builds before any density panel is mounted.
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

// ===========================================================================
// Source-parse contract — locks the test-side mirrors to dashboard.ts.
// ===========================================================================

describe("comments-density-grid wrapper — source-parse contract (issue #357)", () => {
  it("ensureCommentsDensityGrid implements check-first idempotency + trend anchor preference", () => {
    const helperStart = dashboardSrc.indexOf(
      "function ensureCommentsDensityGrid(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2000);

    // Check-first idempotency: subsequent mounts find the existing
    // wrapper instead of inserting a duplicate.
    expect(helperBody).toContain('[data-comments-density-grid="true"]');
    expect(helperBody).toMatch(/if \(existing\) return existing;/);

    // Anchor preference: trend row primary, cycle-distribution fallback.
    // The wrapper sits IMMEDIATELY AFTER the chosen anchor — issue #357
    // acceptance ("trend full-width above the density grid").
    expect(helperBody).toContain('[data-comments-trend-row="true"]');
    expect(helperBody).toContain(
      'document.getElementById("cycle-distribution")',
    );
    expect(helperBody).toContain('.closest(".charts-row")');

    // Wrapper markers used by the cleanup helper, by per-panel ensure
    // helpers, and by dashboard parity gates that look for the wrapper
    // by attribute.
    expect(helperBody).toContain(
      'grid.className = "charts-row comments-density-grid"',
    );
    expect(helperBody).toContain(
      'grid.setAttribute("data-comments-density-grid", "true")',
    );

    // Insertion ordering: wrapper sits after the anchor's next sibling
    // (i.e., directly below the trend row when trend is mounted).
    expect(helperBody).toContain(
      "anchorRow.parentElement.insertBefore(grid, anchorRow.nextSibling)",
    );
  });

  it("removeCommentsDensityGridIfEmpty trims the wrapper only when child count is zero", () => {
    const helperStart = dashboardSrc.indexOf(
      "function removeCommentsDensityGridIfEmpty(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 800);

    // Targets the wrapper by attribute and bails when absent (no-op
    // under capability-off / repeated capability-off renders).
    expect(helperBody).toContain('[data-comments-density-grid="true"]');
    expect(helperBody).toMatch(/if \(!grid\) return;/);

    // Child-count guard: wrapper survives partial removals so the
    // remaining density panels stay mounted.  Locks the
    // ``children.length === 0`` predicate so any future refactor that
    // unconditionally removes the wrapper trips this contract.
    expect(helperBody).toContain("grid.children.length === 0");
    expect(helperBody).toContain("grid.parentElement?.removeChild(grid)");
  });

  it("each density panel's ensure helper delegates to ensureCommentsDensityGrid", () => {
    // Locks the cross-helper invariant: per-author / per-repo /
    // per-reviewer all funnel through ensureCommentsDensityGrid so the
    // wrapper is the single anchor decision (issue #357 — collapses
    // the previous fallback chains 333/334/335/cycle-dist into one).
    expect(dashboardSrc).toContain(
      "function ensureCommentsAuthorDensityContainer(",
    );
    expect(dashboardSrc).toContain(
      "function ensureCommentsRepositoryDensityContainer(",
    );
    expect(dashboardSrc).toContain(
      "function ensureCommentsReviewerDensityContainer(",
    );
    // Each helper body must contain a call to ensureCommentsDensityGrid.
    // Counted via global match: minimum 3 invocations (one per density
    // panel) plus any extras inside the helper itself if added later.
    const matches = dashboardSrc.match(/ensureCommentsDensityGrid\(\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it("each density panel's remove helper trims the wrapper via removeCommentsDensityGridIfEmpty", () => {
    // Locks the cross-helper invariant: the wrapper cleanup is shared,
    // so removing the LAST density panel deterministically removes the
    // wrapper too — independent of which panel is last to leave.
    expect(dashboardSrc).toContain(
      "function removeCommentsAuthorDensityContainer(",
    );
    expect(dashboardSrc).toContain(
      "function removeCommentsRepositoryDensityContainer(",
    );
    expect(dashboardSrc).toContain(
      "function removeCommentsReviewerDensityContainer(",
    );
    const matches = dashboardSrc.match(/removeCommentsDensityGridIfEmpty\(\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

// ===========================================================================
// Lifecycle scenarios for the wrapper itself.
// ===========================================================================

describe("comments-density-grid wrapper — lifecycle scenarios (issue #357)", () => {
  beforeEach(() => {
    mountPreFeatureBaseline();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("(a) initial capability-off does not mount the wrapper", () => {
    // No density panel ensures the wrapper, so it never appears.  The
    // 2 pre-feature ``.charts-row`` rows are the entire metrics tab.
    expect(
      document.querySelector('[data-comments-density-grid="true"]'),
    ).toBeNull();
    expect(document.querySelectorAll(".charts-row").length).toBe(2);
  });

  it("first density-panel ensure creates the wrapper exactly once; subsequent ensures reuse it", () => {
    mount333Row();

    // First call creates the wrapper.
    const grid1 = ensureCommentsDensityGridContract();
    expect(grid1).not.toBeNull();
    expect(
      document.querySelectorAll('[data-comments-density-grid="true"]').length,
    ).toBe(1);
    expect(grid1?.classList.contains("charts-row")).toBe(true);
    expect(grid1?.classList.contains("comments-density-grid")).toBe(true);

    // Second call returns the same element (idempotency).
    const grid2 = ensureCommentsDensityGridContract();
    expect(grid2).toBe(grid1);
    expect(
      document.querySelectorAll('[data-comments-density-grid="true"]').length,
    ).toBe(1);
  });

  it("wrapper sits IMMEDIATELY AFTER the trend row (full-width trend stays above the 2-up grid)", () => {
    mount333Row();
    ensureCommentsDensityGridContract();

    const trendRow = document.querySelector('[data-comments-trend-row="true"]');
    expect(trendRow).not.toBeNull();
    const wrapper = trendRow!.nextElementSibling;
    expect(wrapper?.getAttribute("data-comments-density-grid")).toBe("true");
  });

  it("falls back to cycle-distribution row when the trend row is not mounted", () => {
    // 333 row absent — wrapper falls back to anchoring on the static
    // cycle-distribution chart's parent row (last pre-feature row).
    const grid = ensureCommentsDensityGridContract();
    expect(grid).not.toBeNull();
    const lastPreFeatureRow = document.querySelector(
      '[data-pre-feature-row="row-2"]',
    );
    expect(lastPreFeatureRow!.nextElementSibling).toBe(grid);
  });

  it("hosts all three density panels as siblings within the wrapper, in author → repo → reviewer order", () => {
    mount333Row();
    const grid = ensureCommentsDensityGridContract();
    expect(grid).not.toBeNull();

    appendDensityChildContract(
      grid!,
      "data-comments-author-density-row",
      "comments-author-density",
      "Comments by Author",
    );
    appendDensityChildContract(
      grid!,
      "data-comments-repository-density-row",
      "comments-repository-density",
      "Comments by Repository",
    );
    appendDensityChildContract(
      grid!,
      "data-comments-reviewer-density-row",
      "comments-reviewer-density",
      "Comments by Reviewer",
    );

    expect(grid!.children).toHaveLength(3);
    expect(
      grid!.children[0]?.getAttribute("data-comments-author-density-row"),
    ).toBe("true");
    expect(
      grid!.children[1]?.getAttribute("data-comments-repository-density-row"),
    ).toBe("true");
    expect(
      grid!.children[2]?.getAttribute("data-comments-reviewer-density-row"),
    ).toBe("true");

    // Wrapper still counts as ONE ``.charts-row`` regardless of how
    // many density panels live inside it.
    expect(document.querySelectorAll(".charts-row").length).toBe(4);
  });

  it("wrapper persists across partial removals — only trimmed when child count drops to zero", () => {
    mount333Row();
    const grid = ensureCommentsDensityGridContract();
    appendDensityChildContract(
      grid!,
      "data-comments-author-density-row",
      "comments-author-density",
      "Comments by Author",
    );
    appendDensityChildContract(
      grid!,
      "data-comments-repository-density-row",
      "comments-repository-density",
      "Comments by Repository",
    );

    // Remove repo first — wrapper still has author, must NOT trim.
    detachDensityChild("data-comments-repository-density-row");
    expect(
      document.querySelector('[data-comments-density-grid="true"]'),
    ).not.toBeNull();
    expect(grid!.children).toHaveLength(1);

    // Remove the last child — wrapper is now trimmed.
    detachDensityChild("data-comments-author-density-row");
    expect(
      document.querySelector('[data-comments-density-grid="true"]'),
    ).toBeNull();
  });

  it("on→off→on cycles cleanly recreate the wrapper", () => {
    mount333Row();
    const grid1 = ensureCommentsDensityGridContract();
    appendDensityChildContract(
      grid1!,
      "data-comments-author-density-row",
      "comments-author-density",
      "Comments by Author",
    );

    // capability-off: detach the only child → wrapper trimmed.
    detachDensityChild("data-comments-author-density-row");
    expect(
      document.querySelector('[data-comments-density-grid="true"]'),
    ).toBeNull();

    // capability-on again: ensure recreates the wrapper as a fresh
    // element (the prior reference is dead).
    const grid2 = ensureCommentsDensityGridContract();
    expect(grid2).not.toBeNull();
    expect(grid2).not.toBe(grid1);
    expect(
      document.querySelectorAll('[data-comments-density-grid="true"]').length,
    ).toBe(1);
  });
});
