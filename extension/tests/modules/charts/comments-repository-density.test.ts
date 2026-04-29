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
        r.querySelector(".comments-repository-density-name")?.textContent ?? "",
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
      orphanRow?.querySelector(".comments-repository-density-name")
        ?.textContent,
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
    // Fixture chosen so the THREE orderings (default comment_count
    // desc, thread_count desc, active_thread_count desc) are ALL
    // distinct — this prevents the Space activation assertion from
    // passing vacuously when Space is a no-op (Codex caught a prior
    // version where thread_count and active_thread_count produced
    // identical orderings, so an inert Space handler stayed on the
    // thread_count ordering Enter had already established).  All
    // entries satisfy INV-3-07 (active_thread_count <= thread_count).
    const buckets: Record<string, RepoBucket> = {
      [repos[0]!.repository_id]: makeBucket(50, 10, 5),
      [repos[1]!.repository_id]: makeBucket(10, 20, 8),
      [repos[2]!.repository_id]: makeBucket(20, 30, 3),
    };
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    // Initial-state guard: the default comment_count desc ordering
    // is [repos[2] (30), repos[1] (20), repos[0] (10)].  Asserted so
    // a future fixture drift that aligned default + Enter outcomes
    // would surface here rather than masking a broken keyboard
    // handler.
    const initial = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));
    expect(initial).toEqual([
      repos[2]!.repository_id, // 30 comments
      repos[1]!.repository_id, // 20 comments
      repos[0]!.repository_id, // 10 comments
    ]);

    // Enter on the thread_count button.  Re-orders by thread_count
    // desc → [repos[0] (50), repos[2] (20), repos[1] (10)] which is
    // a different sequence from the comment_count default.
    const threadBtn = container.querySelector<HTMLButtonElement>(
      '.comments-repository-density-sort-btn[data-sort-metric="thread_count"]',
    );
    expect(threadBtn).not.toBeNull();
    threadBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    const afterEnter = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row",
      ),
    ).map((r) => r.getAttribute("data-repository-id"));
    expect(afterEnter).toEqual([
      repos[0]!.repository_id, // 50 threads
      repos[2]!.repository_id, // 20 threads
      repos[1]!.repository_id, // 10 threads
    ]);

    // Space on the active_thread_count button.  Re-orders by
    // active_thread_count desc → [repos[1] (8), repos[0] (5),
    // repos[2] (3)] which is DISTINCT from BOTH the comment_count
    // default and the thread_count Enter ordering — so an inert
    // Space handler would leave the rows in their thread_count order
    // and the assertion would fail loudly.  This is the Codex-fix
    // that prevents the "afterSpace == afterEnter so Space could be
    // a no-op" vacuous-pass mode.
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
      repos[1]!.repository_id, // 8 active
      repos[0]!.repository_id, // 5 active
      repos[2]!.repository_id, // 3 active
    ]);
    // Final invariant: the post-Space ordering MUST differ from the
    // post-Enter ordering — direct proof Space activation actually
    // fired and was not silently masked by a sibling re-render path.
    expect(afterSpace).not.toEqual(afterEnter);
    // And the active button's aria-pressed reflects the Space
    // activation (FR-4-10 keyboard parity with click).
    const checkedBtn = container.querySelector(
      '.comments-repository-density-sort-btn[aria-pressed="true"]',
    );
    expect(checkedBtn?.getAttribute("data-sort-metric")).toBe(
      "active_thread_count",
    );
  });

  // ===========================================================================
  // US4 / T026: filter-not-supported posture (FR-4-07).
  //
  // When ANY of the dashboard's per-PR dimension filters (repos / teams /
  // authors / reviewers) is active, the chart MUST render a self-explanatory
  // empty state instead of rows.  The empty state MUST be visibly distinct
  // from the no-data-in-range empty state (FR-4-08) AND MUST disappear cleanly
  // when filters are cleared.
  //
  // 3 tests; floor +3.
  // ===========================================================================

  it("(T026-a) any of the four dimension filters (repos / teams / authors / reviewers) triggers filter-not-supported", () => {
    // Same data fixture across all four sub-iterations so the filter
    // dimension is the sole independent variable.  If any of the four
    // filter slots is non-empty → the chart MUST render the
    // filter-not-supported empty state, NOT the rows the data alone
    // would produce.  This locks FR-4-07's "ANY" contract — a future
    // refactor that narrowed the gate to only a subset of dimensions
    // would surface here.
    const repos = buildRepositoriesDimension(3);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r) => {
      buckets[r.repository_id] = makeBucket(2, 5, 1);
    });
    const rollups = [makeRollup(0, buckets)];

    const filterCases: { name: string; filters: FilterState }[] = [
      {
        name: "repos",
        filters: { repos: ["repo-x"], teams: [], reviewers: [], authors: [] },
      },
      {
        name: "teams",
        filters: { repos: [], teams: ["team-x"], reviewers: [], authors: [] },
      },
      {
        name: "authors",
        filters: { repos: [], teams: [], reviewers: [], authors: ["user-x"] },
      },
      {
        name: "reviewers",
        filters: {
          repos: [],
          teams: [],
          reviewers: ["user-y"],
          authors: [],
        },
      },
    ];

    for (const { name, filters } of filterCases) {
      // Reset the container's content between iterations so each
      // assertion stands alone (mirrors the way the dashboard re-
      // renders into the same container as filters change).
      container.innerHTML = "";
      renderCommentsRepositoryDensityChart(container, rollups, {
        filters,
        repositoriesDimension: repos,
      });

      // No rows under any active filter — the data fixture would
      // otherwise produce 3 rows.
      const rows = container.querySelectorAll(
        ".comments-repository-density-row",
      );
      expect(rows).toHaveLength(0);
      // Filter-not-supported message present (text owned by renderNoData;
      // the chart's filter short-circuit message contains "filterable").
      expect(container.textContent?.toLowerCase() ?? "").toContain(
        "filterable",
      );
      // And the no-data-in-range message is NOT present — that's the
      // sibling empty state for capability-on + no contributions, gated
      // separately (case (j) above).
      expect(container.textContent?.toLowerCase() ?? "").not.toContain(
        "no comments data",
      );
      // Sanity: this assertion fires per-iteration; if the chart
      // accidentally rendered rows under a specific filter dimension,
      // the diagnostic identifies which one via the iteration's name.
      if (rows.length !== 0) {
        throw new Error(
          `filter dimension "${name}" did not trigger the filter-not-` +
            `supported empty state; rendered ${rows.length} data rows`,
        );
      }
    }
  });

  it("(T026-b) clearing the filter restores the rows", () => {
    const repos = buildRepositoriesDimension(3);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r, i) => {
      buckets[r.repository_id] = makeBucket(2, 10 - i, 1);
    });
    const rollups = [makeRollup(0, buckets)];

    // Step 1: filter active → rows absent (filter-not-supported).
    renderCommentsRepositoryDensityChart(container, rollups, {
      filters: { repos: ["repo-x"], teams: [], reviewers: [], authors: [] },
      repositoriesDimension: repos,
    });
    expect(
      container.querySelectorAll(".comments-repository-density-row").length,
    ).toBe(0);
    expect(container.textContent?.toLowerCase() ?? "").toContain("filterable");

    // Step 2: filters cleared (same container, same data) → rows
    // restored.  Verifies the empty state disappears cleanly when
    // filters are cleared (FR-4-07 second-half contract).
    renderCommentsRepositoryDensityChart(container, rollups, {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });
    const rowsAfterClear = container.querySelectorAll(
      ".comments-repository-density-row",
    );
    expect(rowsAfterClear).toHaveLength(3);
    // The "filterable" message is gone — the chart's render path
    // is on the rows path now, not the empty-state path.
    expect(container.textContent?.toLowerCase() ?? "").not.toContain(
      "filterable",
    );
  });

  it("(T026-c) filter-not-supported empty state is visibly distinct from no-data-in-range", () => {
    // FULL-VERIFY MARKER ENUMERATION (per memory feedback_stop_patching
    // _full_verify.md after 2nd Codex catch on T026-c distinctness):
    // exhaustively list every word/phrase that uniquely identifies one
    // state's user-facing wording so the cross-state leakage gate
    // catches ANY future text change that introduced an other-state
    // marker into the wrong state.  The prior pair-of-words pattern
    // (excluded "widening" but not "extraction" in filter state;
    // excluded "filterable" + "clear repo" but not "filters" in no-data
    // state) left holes.
    const FILTER_STATE_UNIQUE_MARKERS = [
      "filterable", // heading: "Comments density is not yet filterable"
      "clear repo", // hint: "Clear repo / team / author / reviewer filters"
      "filters", // hint: "...filters to view per-repo..."
      "per-dimension", // hint: "Per-dimension comments breakdowns..."
      "review-conversation", // hint: "...review-conversation totals."
    ] as const;
    const NODATA_STATE_UNIQUE_MARKERS = [
      "no comments data", // heading: "No comments data for selected range"
      "selected range", // heading: "...for selected range"
      "widening", // hint: "Try widening the date range..."
      "extraction", // hint: "...comments extraction is enabled..."
    ] as const;

    const repos = buildRepositoriesDimension(2);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r) => {
      buckets[r.repository_id] = makeBucket(1, 5, 0);
    });
    const dataRollups = [makeRollup(0, buckets)];

    // Capture the filter-not-supported state's structural surfaces.
    // renderNoData produces TWO paragraphs: ``.no-data`` (heading) and
    // ``.no-data-hint`` (actionable body).  Visible distinctness per
    // FR-4-07 means BOTH paragraphs differ between the two empty states;
    // a user reading one paragraph alone must be able to tell which
    // state the chart is in.
    renderCommentsRepositoryDensityChart(container, dataRollups, {
      filters: { repos: ["repo-x"], teams: [], reviewers: [], authors: [] },
      repositoriesDimension: repos,
    });

    const filterHeading = container.querySelector(".no-data");
    const filterHint = container.querySelector(".no-data-hint");
    expect(filterHeading).not.toBeNull();
    expect(filterHint).not.toBeNull();
    const filterHeadingText = (filterHeading?.textContent ?? "").toLowerCase();
    const filterHintText = (filterHint?.textContent ?? "").toLowerCase();

    // Heading actionable wording — filter state's distinguishing word.
    expect(filterHeadingText).toContain("filterable");
    // Hint actionable wording — filter state's call-to-action ("Clear
    // ... filters") MUST be present so a hint rewrite that dropped the
    // user-action surfaces here.
    expect(filterHintText).toContain("clear");
    expect(filterHintText).toContain("filters");

    // FULL CROSS-STATE EXCLUSION: no no-data marker may appear in
    // EITHER paragraph of the filter state.  Iterating the full marker
    // list catches the leakage gap Codex flagged on the prior pair-of-
    // words assertion (which only excluded "widening" + "no comments
    // data" but allowed "extraction" + "selected range" through).
    for (const marker of NODATA_STATE_UNIQUE_MARKERS) {
      expect(filterHeadingText).not.toContain(marker);
      expect(filterHintText).not.toContain(marker);
    }

    // Reset + render the no-data-in-range path (rollups have no
    // by_repository_comments emission; filters cleared).
    container.innerHTML = "";
    renderCommentsRepositoryDensityChart(
      container,
      [makeRollup(0, undefined), makeRollup(1, undefined)],
      {
        filters: emptyFilters(),
        repositoriesDimension: repos,
      },
    );

    const nodataHeading = container.querySelector(".no-data");
    const nodataHint = container.querySelector(".no-data-hint");
    expect(nodataHeading).not.toBeNull();
    expect(nodataHint).not.toBeNull();
    const nodataHeadingText = (nodataHeading?.textContent ?? "").toLowerCase();
    const nodataHintText = (nodataHint?.textContent ?? "").toLowerCase();

    // Heading actionable wording — no-data state's distinguishing
    // phrase.
    expect(nodataHeadingText).toContain("no comments data");
    // Hint actionable wording — no-data state's user-visible
    // remediation MUST surface either widening the range or confirming
    // extraction (at least one of the two markers).  A hint rewrite
    // that dropped both actions surfaces here.
    expect(
      nodataHintText.includes("widening") ||
        nodataHintText.includes("extraction"),
    ).toBe(true);

    // FULL CROSS-STATE EXCLUSION: no filter marker may appear in
    // EITHER paragraph of the no-data state.  Iterating the full
    // marker list catches the leakage gap Codex flagged where
    // "filters" / "per-dimension" / "review-conversation" could leak
    // into a future no-data hint and pass the prior assertion set.
    for (const marker of FILTER_STATE_UNIQUE_MARKERS) {
      expect(nodataHeadingText).not.toContain(marker);
      expect(nodataHintText).not.toContain(marker);
    }

    // Final invariants: heading AND hint texts differ at the paragraph
    // level between the two states.  Direct proof of FR-4-07 /
    // FR-4-08 visible-distinctness at BOTH paragraph granularities.
    expect(filterHeadingText).not.toBe(nodataHeadingText);
    expect(filterHintText).not.toBe(nodataHintText);
  });

  // ===========================================================================
  // Phase 7 partial-branch ratchet covering tests (+3 in this block).
  //
  // These exercise defensive branches in the chart module that real
  // production paths can trigger but the primary T015 / T023 / T026
  // tests don't reach.  Per memory feedback_partial_branches_ratchet.md
  // the ratchet does not grow; the user authorized covering tests
  // (rather than source removal) for branches that represent real
  // user/data behavior.
  // ===========================================================================

  it("(P7-a) is a no-op when the container is null (defensive null guard)", () => {
    const repos = buildRepositoriesDimension(2);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r) => {
      buckets[r.repository_id] = makeBucket(1, 5, 0);
    });
    // Call with null container — production callers (dashboard.ts) guard
    // null already, but the type signature allows it so any direct
    // caller that doesn't guard MUST not throw.  Covers the
    // ``if (!container) return;`` branch at the top of the chart's
    // render function.
    expect(() =>
      renderCommentsRepositoryDensityChart(null, [makeRollup(0, buckets)], {
        filters: emptyFilters(),
        repositoriesDimension: repos,
      }),
    ).not.toThrow();
  });

  it("(P7-b) ignores repositoriesDimension entries with non-string fields (mirrors 334 dimension-shape defense)", () => {
    const buckets: Record<string, RepoBucket> = {
      "known-repo": makeBucket(1, 5, 0),
      "unknown-repo": makeBucket(1, 4, 0),
    };
    // Mixed-shape dimension: one valid + one each invalid shape.  The
    // chart MUST silently skip the invalid entries (typeof check at the
    // directory builder) and render the valid mapping plus the raw key
    // for the un-resolvable repo.  Covers both arms of the typeof
    // entry.repository_id === "string" && typeof entry.repository_name
    // === "string" branch.
    const dim: { repository_id?: unknown; repository_name?: unknown }[] = [
      { repository_id: "known-repo", repository_name: "Known Repo" },
      { repository_id: "no-name" }, // missing name (undefined)
      { repository_name: "no-id" }, // missing id (undefined)
      { repository_id: 42, repository_name: "non-string-id" }, // wrong type
      { repository_id: "ok-id", repository_name: 99 }, // wrong type for name
    ];
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: dim as unknown as readonly {
        repository_id?: string;
        repository_name?: string;
      }[],
    });
    const names = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-repository-density-row .comments-repository-density-name",
      ),
    ).map((n) => n.textContent ?? "");
    // Valid entry resolves to "Known Repo".
    expect(names).toContain("Known Repo");
    // Unknown-repo falls through to raw-ID per FR-4-11.
    expect(names).toContain("unknown-repo");
  });

  it("(P7-c) delegated event handlers ignore non-button + invalid-metric + non-Enter/Space events", () => {
    // The chart's click + keydown handlers attach at the container
    // level (delegated).  They contain three defensive guards each that
    // only fire on edge-case events:
    //   1. ``findSortButton`` returns null when the event's target has
    //      no .comments-repository-density-sort-btn ancestor — covers
    //      line 268 (click) + line 280 (keydown).
    //   2. ``resolveMetric`` returns undefined when data-sort-metric
    //      doesn't map to a known metric — covers line 270 (click) +
    //      line 284 (keydown).
    //   3. keydown checks key !== "Enter" && key !== " " — covers
    //      line 282 (other keys like Tab / Escape).
    // ONE test exercises all five branches by dispatching crafted
    // events and asserting the chart does NOT re-render (no metric
    // change; aria-pressed indicator stays on default comment_count).
    const repos = buildRepositoriesDimension(3);
    const buckets: Record<string, RepoBucket> = {};
    repos.forEach((r, i) => {
      buckets[r.repository_id] = makeBucket(2, 50 - i, 1);
    });
    renderCommentsRepositoryDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      repositoriesDimension: repos,
    });

    // Sanity: the default comment_count button is initially active.
    const initialActive = container.querySelector(
      '.comments-repository-density-sort-btn[aria-pressed="true"]',
    );
    expect(initialActive?.getAttribute("data-sort-metric")).toBe(
      "comment_count",
    );

    // 1. Click on the chart container itself (no button ancestor).
    //    The findSortButton path returns null → handler returns early.
    container.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // 2. Click on a button whose data-sort-metric is mutated to an
    //    unknown value.  resolveMetric returns undefined → handler
    //    returns early.
    const threadBtn = container.querySelector<HTMLButtonElement>(
      '.comments-repository-density-sort-btn[data-sort-metric="thread_count"]',
    );
    expect(threadBtn).not.toBeNull();
    threadBtn?.setAttribute("data-sort-metric", "not-a-real-metric");
    threadBtn?.click();
    // Restore so subsequent renders find the button by metric again.
    threadBtn?.setAttribute("data-sort-metric", "thread_count");

    // 3. Keydown on the chart container itself (no button ancestor).
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    // 4. Keydown with a non-Enter/Space key on a real button.
    threadBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );

    // 5. Keydown with valid key but mutated invalid metric.
    threadBtn?.setAttribute("data-sort-metric", "still-not-a-real-metric");
    threadBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    threadBtn?.setAttribute("data-sort-metric", "thread_count");

    // After all 5 defensive paths fired (each returning early), the
    // chart should still be on the original sort metric — no
    // re-render happened.  The aria-pressed indicator MUST still mark
    // comment_count as active.
    const finalActive = container.querySelector(
      '.comments-repository-density-sort-btn[aria-pressed="true"]',
    );
    expect(finalActive?.getAttribute("data-sort-metric")).toBe("comment_count");
  });
});
