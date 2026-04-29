/**
 * Per-Repo Comments-Density Chart Module Tests (Feature 335 US1 / T015)
 *
 * JSDOM behaviour tests for renderCommentsRepositoryDensityChart covering
 * the MVP contract surface (FR-4-01..FR-4-06 + FR-4-08 + FR-4-09 + FR-4-10
 * + FR-4-11 + chart-layer idempotency).  10 cases per spec.tasks.md T015:
 *
 *   (a) 12-repo fixture renders top-50-by-comment_count-desc; each row
 *       carries repository display label + 3 numeric metrics.
 *   (b) Range-filter narrowing (subset of rollups) re-renders rows with
 *       sums over the narrowed range.
 *   (c) Truncation indicator surfaces when input exceeds the cap
 *       (cap+3 fixture → cap visible + indicator).
 *   (d) Partial-coverage qualifier on rows whose reduced
 *       coverage_partial=true; non-partial rows MUST NOT carry it
 *       (FR-4-03).
 *   (e) Deterministic UI tie-break — chosen-metric desc → repository_name
 *       asc → repository_id asc as final tie-breaker (covers a
 *       duplicate-display-name fixture from rename / fallback collision).
 *   (f) FR-4-09 no click-through: rows have no data-drilldown-* attribute
 *       and no click handler attached by the chart module.
 *   (g) FR-4-10 a11y: rows expose metrics via screen-reader-readable
 *       aria-label; sort-selector buttons are wired into a WAI-ARIA
 *       toolbar (role="toolbar" + aria-pressed; each <button> is
 *       independently Tab-reachable).
 *   (h) Chart-layer idempotency: rendering twice on the same container
 *       produces ONE chart, not two — content replaced via the 333 / 334
 *       renderTrustedHtml pattern.
 *   (i) FR-4-11 raw-repository_id fallback when repositoriesDimension
 *       entry missing — bucket whose repository_id is absent from the
 *       passed dimension renders the raw ID as label (no blank, no row
 *       omission).
 *   (j) FR-4-08 no-data-in-range empty state — capability-on but visible
 *       range yields zero contributions; chart renders a no-data marker
 *       visibly distinct from the filter-not-supported empty state
 *       (FR-4-07).
 *
 * NO sentinel-rendering case (mirrors 334 T017 (g)) — Feature 335 CL-03 /
 * INV-3-12 leaves no sentinel concept for the per-repo dimension; the
 * raw-ID fallback case (i) is the closest analog and is explicit about
 * the FR-4-11 contract it exercises.
 */

import {
  MAX_COMMENTS_REPO_DENSITY_ROWS,
  renderCommentsRepositoryDensityChart,
} from "../../../ui/modules/charts/comments-repository-density";
import type { Rollup } from "../../../ui/dataset-loader";
import type { FilterState } from "../../../ui/modules/filters";

interface RepoBucket {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function makeRollup(
  index: number,
  byRepositoryComments: Record<string, RepoBucket> | undefined,
): Rollup {
  const rollup: Rollup = {
    week: `2025-W${String(index + 1).padStart(2, "0")}`,
    pr_count: 10,
    cycle_time_p50: 60,
    cycle_time_p90: 120,
    authors_count: 4,
    reviewers_count: 3,
    by_repository: null,
    by_team: null,
  };
  if (byRepositoryComments) {
    rollup.by_repository_comments = byRepositoryComments;
  }
  return rollup;
}

function emptyFilters(): FilterState {
  return { repos: [], teams: [], reviewers: [], authors: [] };
}

function buildRepositoriesDimension(
  count: number,
  prefix = "repo",
): { repository_id: string; repository_name: string }[] {
  const out: { repository_id: string; repository_name: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      repository_id: `${prefix}-${String(i).padStart(3, "0")}`,
      repository_name: `${prefix} ${i}`,
    });
  }
  return out;
}

function makeBucket(
  thread: number,
  comment: number,
  active: number,
  partial = false,
): RepoBucket {
  return {
    thread_count: thread,
    comment_count: comment,
    active_thread_count: active,
    coverage_partial: partial,
  };
}

describe("renderCommentsRepositoryDensityChart (Feature 335 US1)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("(a) renders one row per repository sorted by comment_count desc; each row carries display name + 3 metrics", () => {
    const repos = buildRepositoriesDimension(12);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r, i) => {
      // Distinct comment_count per repo so the desc sort is deterministic.
      buckets[r.repository_id] = makeBucket(2, 100 - i, 1);
    });
    const rollups: Rollup[] = [makeRollup(0, buckets)];

    renderCommentsRepositoryDensityChart(container, rollups, {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    );
    expect(rows).toHaveLength(12);

    const firstRowName = rows[0]?.querySelector(
      ".comments-repository-density-name",
    )?.textContent;
    expect(firstRowName).toBe("repo 0"); // highest comment_count = 100

    // Repository display label + 3 numeric metrics — table renders 4 cells per row.
    const firstRowCells = rows[0]?.querySelectorAll('[role="cell"]');
    expect(firstRowCells).toHaveLength(4);
  });

  it("(b) re-renders rows over a narrowed rollup range", () => {
    const repos = buildRepositoriesDimension(3);
    const wideRollups: Rollup[] = [];
    for (let i = 0; i < 4; i++) {
      const buckets: Record<string, RepoBucket> = {};
      repos.forEach((r) => {
        buckets[r.repository_id] = makeBucket(1, 5, 0);
      });
      wideRollups.push(makeRollup(i, buckets));
    }
    renderCommentsRepositoryDensityChart(container, wideRollups, {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });
    const wideRows = container.querySelectorAll<HTMLElement>(
      ".comments-repository-density-row",
    );
    expect(wideRows).toHaveLength(3);
    // 4 weeks × 5 comments = 20 per repo on the wide range.
    const wideFirstCommentCell = wideRows[0]?.querySelectorAll(
      ".comments-repository-density-numeric",
    )[2];
    expect(wideFirstCommentCell?.textContent).toBe("20");

    // Narrow to first 2 weeks → 2 × 5 = 10 per repo.
    renderCommentsRepositoryDensityChart(container, wideRollups.slice(0, 2), {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });
    const narrowRows = container.querySelectorAll<HTMLElement>(
      ".comments-repository-density-row",
    );
    expect(narrowRows).toHaveLength(3);
    const narrowFirstCommentCell = narrowRows[0]?.querySelectorAll(
      ".comments-repository-density-numeric",
    )[2];
    expect(narrowFirstCommentCell?.textContent).toBe("10");
  });

  it("(c) renders the truncation indicator when repositories exceed the cap", () => {
    const overCap = MAX_COMMENTS_REPO_DENSITY_ROWS + 3;
    const repos = buildRepositoriesDimension(overCap);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r, i) => {
      buckets[r.repository_id] = makeBucket(1, overCap - i, 0);
    });
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    const rows = container.querySelectorAll(".comments-repository-density-row");
    expect(rows).toHaveLength(MAX_COMMENTS_REPO_DENSITY_ROWS);
    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain(
      String(MAX_COMMENTS_REPO_DENSITY_ROWS),
    );
  });

  it("(d) applies the partial-coverage qualifier ONLY to rows whose reduced coverage_partial=true", () => {
    const repos = buildRepositoriesDimension(3);
    const week1Buckets: Record<string, RepoBucket> = {
      [repos[0]!.repository_id]: makeBucket(2, 4, 1, true),
      [repos[1]!.repository_id]: makeBucket(2, 4, 1, false),
      [repos[2]!.repository_id]: makeBucket(2, 4, 1, false),
    };
    const week2Buckets: Record<string, RepoBucket> = {
      [repos[0]!.repository_id]: makeBucket(2, 4, 1, false),
      [repos[1]!.repository_id]: makeBucket(2, 4, 1, false),
      [repos[2]!.repository_id]: makeBucket(2, 4, 1, true),
    };
    renderCommentsRepositoryDensityChart(
      container,
      [makeRollup(0, week1Buckets), makeRollup(1, week2Buckets)],
      { filters: emptyFilters(), repositoriesDimension: repos },
    );

    const partial = container.querySelectorAll(
      '.comments-repository-density-row.coverage-partial[data-coverage-partial="true"]',
    );
    // repo 0 (partial in W1) + repo 2 (partial in W2) = 2 rows; repo 1 has
    // no partial weeks → no qualifier.
    expect(partial).toHaveLength(2);
    const partialKeys = Array.from(partial).map((r) =>
      r.getAttribute("data-repository-id"),
    );
    expect(partialKeys.sort()).toEqual(
      [repos[0]!.repository_id, repos[2]!.repository_id].sort(),
    );
  });

  it("(e) tie-breaks deterministically on chosen-metric desc → repository_name asc → repository_id asc", () => {
    // Three repos with the SAME comment_count.  After display-name asc
    // tie-break, the two "Alpha" rows are ordered by repository_id asc
    // (repo-aaa-1 then repo-bob-2), then Zelda's repo-zzz-3.  This
    // mirrors 334's case (e) — the tie-break stages are identical
    // structurally even though the final tie-breaker is repository_id
    // (vs author_id in 334).
    const repos = [
      { repository_id: "repo-bob-2", repository_name: "Alpha" },
      { repository_id: "repo-aaa-1", repository_name: "Alpha" },
      { repository_id: "repo-zzz-3", repository_name: "Zelda" },
    ];
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r) => {
      buckets[r.repository_id] = makeBucket(1, 7, 0);
    });
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    );
    const orderedKeys = rows.map((r) => r.getAttribute("data-repository-id"));
    expect(orderedKeys).toEqual(["repo-aaa-1", "repo-bob-2", "repo-zzz-3"]);
  });

  it("(f) emits no drill-down attributes or handlers (FR-4-09)", () => {
    const repos = buildRepositoriesDimension(3);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r) => {
      buckets[r.repository_id] = makeBucket(1, 5, 0);
    });
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    // No element under the chart container carries any data-drilldown-* attr.
    const drilldownAttrCarriers = container.querySelectorAll(
      "[data-drilldown-week], [data-drilldown-author], [data-drilldown-pr], [data-drilldown-repo]",
    );
    expect(drilldownAttrCarriers).toHaveLength(0);
    // Rows are not rendered as buttons (no role="button"), and have no
    // tabindex (informational rows, not interactive — sort buttons are the
    // sole interactive primitive).
    const rows = container.querySelectorAll(".comments-repository-density-row");
    rows.forEach((row) => {
      expect(row.getAttribute("role")).toBe("row");
      expect(row.hasAttribute("tabindex")).toBe(false);
    });
  });

  it("(g) wires the sort selector as a WAI-ARIA toolbar with screen-reader-readable rows", () => {
    const repos = buildRepositoriesDimension(3);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r) => {
      buckets[r.repository_id] = makeBucket(2, 7, 1);
    });
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    const toolbar = container.querySelector(
      '.comments-repository-density-sort[role="toolbar"]',
    );
    expect(toolbar).not.toBeNull();
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".comments-repository-density-sort-btn",
    );
    expect(buttons).toHaveLength(3);
    // Toolbar pattern: every button is independently Tab-reachable
    // (default <button> tabindex=0, no explicit tabindex attribute).
    buttons.forEach((btn) => {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.hasAttribute("tabindex")).toBe(false);
    });
    const checked = container.querySelectorAll(
      '.comments-repository-density-sort-btn[aria-pressed="true"]',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.getAttribute("data-sort-metric")).toBe("comment_count");

    // Rows carry an aria-label that includes all 3 metric values.
    const firstRow = container.querySelector<HTMLElement>(
      ".comments-repository-density-row",
    );
    const ariaLabel = firstRow?.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("threads");
    expect(ariaLabel).toContain("active threads");
    expect(ariaLabel).toContain("comments");
  });

  it("(h) is idempotent under repeated render calls on the same container", () => {
    const repos = buildRepositoriesDimension(5);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r, i) => {
      buckets[r.repository_id] = makeBucket(2, 50 - i, 1);
    });
    const rollups = [makeRollup(0, buckets)];
    renderCommentsRepositoryDensityChart(container, rollups, {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });
    renderCommentsRepositoryDensityChart(container, rollups, {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    const tables = container.querySelectorAll(
      ".comments-repository-density-table",
    );
    expect(tables).toHaveLength(1);
    const rows = container.querySelectorAll(".comments-repository-density-row");
    expect(rows).toHaveLength(5);
    const toolbars = container.querySelectorAll(
      '.comments-repository-density-sort[role="toolbar"]',
    );
    expect(toolbars).toHaveLength(1);
  });

  it("(i) FR-4-11 raw-repository_id fallback when repositoriesDimension entry missing", () => {
    // Construct a fixture with one bucket whose repository_id is absent
    // from the repositoriesDimension array (e.g., a brand-new repo created
    // after the dimension snapshot, or a renamed repo that's missing under
    // the new ID).  The renderer MUST fall back to rendering the raw
    // repository_id as the display label per CL-04 / FR-4-11 — no blank,
    // no row omission.
    const knownRepos = [
      { repository_id: "repo-known-1", repository_name: "Known Repo" },
    ];
    const buckets: Record<string, RepoBucket> = {
      "repo-known-1": makeBucket(2, 10, 1),
      "repo-orphan-uuid-not-in-dim": makeBucket(3, 7, 2),
    };
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: knownRepos,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    );
    expect(rows).toHaveLength(2);
    const names = rows.map(
      (r) =>
        r.querySelector(".comments-repository-density-name")?.textContent ??
        "",
    );
    // Both rows render — the orphan does NOT get omitted (would be the
    // contract violation FR-4-11 guards against).
    expect(names).toContain("Known Repo");
    expect(names).toContain("repo-orphan-uuid-not-in-dim");
    // The orphan row's data-repository-id matches the raw key.
    const orphanRow = rows.find(
      (r) =>
        r.getAttribute("data-repository-id") === "repo-orphan-uuid-not-in-dim",
    );
    expect(orphanRow).toBeDefined();
    expect(
      orphanRow?.querySelector(".comments-repository-density-name")?.textContent,
    ).toBe("repo-orphan-uuid-not-in-dim");
  });

  it("(k) FR-4-02 suppresses all-zero rows even when coverage_partial=true; renders only non-zero rows", () => {
    // The aggregator emits all-zero buckets (thread_count=0,
    // comment_count=0, active_thread_count=0, coverage_partial=true)
    // for repos whose entire canonical PR set in W is unextracted (see
    // _compute_weekly_by_repository_comments).  Per FR-4-02 the chart
    // MUST NOT render these as data rows — even though the partial
    // qualifier (FR-4-03) would otherwise attach.  This test constructs
    // a mixed fixture (one zero+partial bucket + one non-zero bucket)
    // and asserts only the non-zero row renders + the zero+partial row
    // is suppressed.
    const repos = [
      { repository_id: "repo-non-zero", repository_name: "Active Repo" },
      { repository_id: "repo-zero-partial", repository_name: "Quiet Repo" },
    ];
    const buckets: Record<string, RepoBucket> = {
      [repos[0]!.repository_id]: makeBucket(3, 7, 1, false),
      // All-zero numerics + partial=true — the contract violation
      // surface FR-4-02 guards against.
      [repos[1]!.repository_id]: makeBucket(0, 0, 0, true),
    };
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-repository-id")).toBe(
      repos[0]!.repository_id,
    );
    // The zero+partial row MUST NOT appear — neither as a data row nor
    // as a partial-coverage qualifier surface.
    const zeroRow = container.querySelector(
      `[data-repository-id="${repos[1]!.repository_id}"]`,
    );
    expect(zeroRow).toBeNull();
  });

  it("(j) FR-4-08 no-data-in-range empty state visibly distinct from filter-not-supported", () => {
    // Capability-on path (filters CLEAR) but the visible range yields zero
    // contributions: every rollup either lacks by_repository_comments or
    // carries an empty entry set.  Chart renders the no-data-in-range
    // empty state with a marker visibly distinct from the filter-not-
    // supported state (FR-4-07).  Two assertions: (1) no rows render;
    // (2) the empty-state text discriminates between "no data" and "not
    // filterable" wording so the two states are user-distinguishable.
    const rollups = [makeRollup(0, undefined), makeRollup(1, undefined)];
    renderCommentsRepositoryDensityChart(container, rollups, {
      filters: emptyFilters(),
      repositoriesDimension: buildRepositoriesDimension(2),
    });
    const rows = container.querySelectorAll(".comments-repository-density-row");
    expect(rows).toHaveLength(0);
    const text = container.textContent ?? "";
    // The no-data-in-range message is owned by renderNoData; we assert
    // on the absence of rows plus the presence of "no comments data"-
    // shaped wording (mirrors 334's case at line 354-363).
    expect(text.toLowerCase()).toContain("no comments data");
    // And the message MUST NOT include the filter-not-supported wording
    // ("filterable") — that's the FR-4-07 surface, gated separately
    // (T026 in Phase 6).  This assertion is the visible-distinctness
    // gate that FR-4-08 mandates.
    expect(text.toLowerCase()).not.toContain("filterable");
  });

  // ===========================================================================
  // US2 / T023: sort-toggle behaviour — clicking a button or activating it
  // via Enter/Space re-orders the rows by the new metric and updates the
  // aria-pressed indicator.  Tie-break determinism (repository_name asc →
  // repository_id asc) is reproducible across re-renders.  Sort respects
  // the FR-4-02 zero-row suppression: the sorted candidate set excludes
  // all-zero reduced rows before applying truncation logic (verified
  // structurally via case (k) above; the chart's render path filters
  // before sort, so a click-triggered re-render walks the same code
  // path).  4 tests; floor +4.
  // ===========================================================================

  function clickSortButton(metric: string): HTMLButtonElement {
    const btn = container.querySelector<HTMLButtonElement>(
      `.comments-repository-density-sort-btn[data-sort-metric="${metric}"]`,
    );
    if (!btn) {
      throw new Error(`sort button for metric ${metric} not found`);
    }
    btn.click();
    return btn;
  }

  it("(T023-a) clicking the thread_count button re-orders rows and updates aria-pressed", () => {
    const repos = buildRepositoriesDimension(3);
    // thread_count and comment_count rank repos differently so the
    // re-order is unambiguously visible.
    const buckets: Record<string, RepoBucket> = {
      [repos[0]!.repository_id]: makeBucket(1, 100, 0),
      [repos[1]!.repository_id]: makeBucket(50, 1, 25),
      [repos[2]!.repository_id]: makeBucket(20, 50, 10),
    };
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    clickSortButton("thread_count");

    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));
    expect(orderedKeys).toEqual([
      repos[1]!.repository_id, // 50 threads
      repos[2]!.repository_id, // 20 threads
      repos[0]!.repository_id, // 1 thread
    ]);
    const checked = container.querySelector(
      '.comments-repository-density-sort-btn[aria-pressed="true"]',
    );
    expect(checked?.getAttribute("data-sort-metric")).toBe("thread_count");
  });

  it("(T023-b) clicking the active_thread_count button re-orders rows", () => {
    const repos = buildRepositoriesDimension(3);
    const buckets: Record<string, RepoBucket> = {
      [repos[0]!.repository_id]: makeBucket(10, 50, 1),
      [repos[1]!.repository_id]: makeBucket(10, 50, 8),
      [repos[2]!.repository_id]: makeBucket(10, 50, 4),
    };
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    clickSortButton("active_thread_count");

    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));
    expect(orderedKeys).toEqual([
      repos[1]!.repository_id, // 8 active
      repos[2]!.repository_id, // 4 active
      repos[0]!.repository_id, // 1 active
    ]);
    const checked = container.querySelector(
      '.comments-repository-density-sort-btn[aria-pressed="true"]',
    );
    expect(checked?.getAttribute("data-sort-metric")).toBe(
      "active_thread_count",
    );
  });

  it("(T023-c) tie-break is reproducible across reloads on a duplicate-display-name fixture", () => {
    // Fixture with deliberate ties on comment_count AND on
    // repository_name (rename-collision shape: two repos sharing the
    // same display name).  Per FR-4-05 the final tie-break is
    // repository_id ascending — so the rendered order is fully
    // determined by repository_id once the metric + name ties hit.
    // Render twice and assert byte-identical row ordering — proves
    // the chart's sort is reproducible across re-renders (no hidden
    // state that varies between calls).
    const repos = [
      { repository_id: "repo-bbb", repository_name: "Beta" },
      { repository_id: "repo-aaa", repository_name: "Alpha" },
      // Same name as repo-bbb (rename collision); repository_id is
      // the tie-breaker.
      { repository_id: "repo-ccc", repository_name: "Beta" },
    ];
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r) => {
      // All three have identical comment_count so the metric tie
      // delegates to repository_name asc → repository_id asc.
      buckets[r.repository_id] = makeBucket(1, 7, 0);
    });
    const rollups = [makeRollup(0, buckets)];
    const opts = {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    };

    // First render.
    renderCommentsRepositoryDensityChart(container, rollups, opts);
    const firstOrder = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));

    // Expected: Alpha first (single-name tie-break wins), then the two
    // Beta-named rows tie-broken by repository_id asc → bbb before ccc.
    expect(firstOrder).toEqual(["repo-aaa", "repo-bbb", "repo-ccc"]);

    // Second render: same inputs → same output byte-by-byte.
    renderCommentsRepositoryDensityChart(container, rollups, opts);
    const secondOrder = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));
    expect(secondOrder).toEqual(firstOrder);
  });

  it("(T023-d) keyboard activation (Enter / Space) re-orders rows like a click", () => {
    const repos = buildRepositoriesDimension(3);
    const buckets: Record<string, RepoBucket> = {
      [repos[0]!.repository_id]: makeBucket(1, 100, 0),
      [repos[1]!.repository_id]: makeBucket(50, 1, 25),
      [repos[2]!.repository_id]: makeBucket(20, 50, 10),
    };
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    // Find the thread_count button and dispatch a keyboard Enter
    // event with bubbles so the delegated container-level keydown
    // handler picks it up (mirrors how a Tab-focused button + Enter
    // press flows in real browsers).
    const btn = container.querySelector<HTMLButtonElement>(
      '.comments-repository-density-sort-btn[data-sort-metric="thread_count"]',
    );
    expect(btn).not.toBeNull();
    btn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    const afterEnter = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));
    expect(afterEnter).toEqual([
      repos[1]!.repository_id, // 50 threads
      repos[2]!.repository_id, // 20 threads
      repos[0]!.repository_id, // 1 thread
    ]);

    // Now Space on the active_thread_count button.  Re-fetch since
    // the prior render replaced the toolbar.
    const activeBtn = container.querySelector<HTMLButtonElement>(
      '.comments-repository-density-sort-btn[data-sort-metric="active_thread_count"]',
    );
    expect(activeBtn).not.toBeNull();
    activeBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    const afterSpace = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));
    expect(afterSpace).toEqual([
      repos[1]!.repository_id, // 25 active
      repos[2]!.repository_id, // 10 active
      repos[0]!.repository_id, // 0 active
    ]);
  });
});
