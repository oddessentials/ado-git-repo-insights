/**
 * Per-Author Comments-Density Chart Module Tests (Feature 334 US1)
 *
 * JSDOM behaviour tests for renderCommentsAuthorDensityChart covering the
 * MVP contract surface (FR-4-01..FR-4-06 + FR-4-09 + FR-4-10 + chart-layer
 * idempotency):
 *
 *   (a) 12-author fixture renders top-50-by-comment_count-desc; each row
 *       carries author display name + 3 numeric metrics.
 *   (b) Range-filter narrowing (subset of rollups) re-renders rows with
 *       sums over the narrowed range.
 *   (c) Truncation indicator surfaces when input exceeds the cap
 *       (53-author fixture → 50 visible + indicator).
 *   (d) Partial-coverage qualifier on rows whose reduced
 *       coverage_partial=true; non-partial rows MUST NOT carry it
 *       (FR-4-03).
 *   (e) Deterministic UI tie-break — chosen-metric desc → display name
 *       asc → author key asc as final tie-breaker.
 *   (f) FR-4-09 no click-through: rows have no data-drilldown-* attribute
 *       and no click handler attached by the chart module.
 *   (g) FR-4-10 a11y: rows expose metrics via screen-reader-readable
 *       aria-label; sort-selector buttons are wired into a WAI-ARIA
 *       radio-group (role="radio" + aria-checked + tabindex).
 *   (h) Chart-layer idempotency: rendering twice on the same container
 *       produces ONE chart, not two — content replaced via the
 *       throughput / 333-style renderTrustedHtml pattern.
 */

import {
  MAX_COMMENTS_AUTHOR_DENSITY_ROWS,
  renderCommentsAuthorDensityChart,
} from "../../../ui/modules/charts/comments-author-density";
import type { Rollup } from "../../../ui/dataset-loader";
import type { FilterState } from "../../../ui/modules/filters";

interface AuthorBucket {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function makeRollup(
  index: number,
  byAuthorComments: Record<string, AuthorBucket> | undefined,
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
  if (byAuthorComments) {
    rollup.by_author_comments = byAuthorComments;
  }
  return rollup;
}

function emptyFilters(): FilterState {
  return { repos: [], teams: [], reviewers: [], authors: [] };
}

function buildAuthorsDimension(
  count: number,
  prefix = "user",
): { author_id: string; author_name: string }[] {
  const out: { author_id: string; author_name: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      author_id: `${prefix}-${String(i).padStart(3, "0")}`,
      author_name: `${prefix} ${i}`,
    });
  }
  return out;
}

function makeBucket(
  thread: number,
  comment: number,
  active: number,
  partial = false,
): AuthorBucket {
  return {
    thread_count: thread,
    comment_count: comment,
    active_thread_count: active,
    coverage_partial: partial,
  };
}

describe("renderCommentsAuthorDensityChart (Feature 334 US1)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("(a) renders one row per author sorted by comment_count desc; each row carries display name + 3 metrics", () => {
    const authors = buildAuthorsDimension(12);
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a, i) => {
      // Distinct comment_count per author so the desc sort is deterministic.
      buckets[a.author_id] = makeBucket(2, 100 - i, 1);
    });
    const rollups: Rollup[] = [makeRollup(0, buckets)];

    renderCommentsAuthorDensityChart(container, rollups, {
      filters: emptyFilters(),
      authorsDimension: authors,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-author-density-row"),
    );
    expect(rows).toHaveLength(12);

    const firstRowName = rows[0]?.querySelector(
      ".comments-author-density-name",
    )?.textContent;
    expect(firstRowName).toBe("user 0"); // highest comment_count = 100

    // Author display name + 3 numeric metrics — table renders 4 cells per row.
    const firstRowCells = rows[0]?.querySelectorAll('[role="cell"]');
    expect(firstRowCells).toHaveLength(4);
  });

  it("(b) re-renders rows over a narrowed rollup range", () => {
    const authors = buildAuthorsDimension(3);
    const wideRollups: Rollup[] = [];
    for (let i = 0; i < 4; i++) {
      const buckets: Record<string, AuthorBucket> = {};
      authors.forEach((a) => {
        buckets[a.author_id] = makeBucket(1, 5, 0);
      });
      wideRollups.push(makeRollup(i, buckets));
    }
    renderCommentsAuthorDensityChart(container, wideRollups, {
      filters: emptyFilters(),
      authorsDimension: authors,
    });
    const wideRows = container.querySelectorAll<HTMLElement>(
      ".comments-author-density-row",
    );
    expect(wideRows).toHaveLength(3);
    // 4 weeks × 5 comments = 20 per author on the wide range.
    const wideFirstCommentCell = wideRows[0]?.querySelectorAll(
      ".comments-author-density-numeric",
    )[2];
    expect(wideFirstCommentCell?.textContent).toBe("20");

    // Narrow to first 2 weeks → 2 × 5 = 10 per author.
    renderCommentsAuthorDensityChart(container, wideRollups.slice(0, 2), {
      filters: emptyFilters(),
      authorsDimension: authors,
    });
    const narrowRows = container.querySelectorAll<HTMLElement>(
      ".comments-author-density-row",
    );
    expect(narrowRows).toHaveLength(3);
    const narrowFirstCommentCell = narrowRows[0]?.querySelectorAll(
      ".comments-author-density-numeric",
    )[2];
    expect(narrowFirstCommentCell?.textContent).toBe("10");
  });

  it("(c) renders the truncation indicator when authors exceed the cap", () => {
    const overCap = MAX_COMMENTS_AUTHOR_DENSITY_ROWS + 3;
    const authors = buildAuthorsDimension(overCap);
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a, i) => {
      buckets[a.author_id] = makeBucket(1, overCap - i, 0);
    });
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: authors,
    });

    const rows = container.querySelectorAll(".comments-author-density-row");
    expect(rows).toHaveLength(MAX_COMMENTS_AUTHOR_DENSITY_ROWS);
    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain(
      String(MAX_COMMENTS_AUTHOR_DENSITY_ROWS),
    );
  });

  it("(d) applies the partial-coverage qualifier ONLY to rows whose reduced coverage_partial=true", () => {
    const authors = buildAuthorsDimension(3);
    const week1Buckets: Record<string, AuthorBucket> = {
      [authors[0]!.author_id]: makeBucket(2, 4, 1, true),
      [authors[1]!.author_id]: makeBucket(2, 4, 1, false),
      [authors[2]!.author_id]: makeBucket(2, 4, 1, false),
    };
    const week2Buckets: Record<string, AuthorBucket> = {
      [authors[0]!.author_id]: makeBucket(2, 4, 1, false),
      [authors[1]!.author_id]: makeBucket(2, 4, 1, false),
      [authors[2]!.author_id]: makeBucket(2, 4, 1, true),
    };
    renderCommentsAuthorDensityChart(
      container,
      [makeRollup(0, week1Buckets), makeRollup(1, week2Buckets)],
      { filters: emptyFilters(), authorsDimension: authors },
    );

    const partial = container.querySelectorAll(
      '.comments-author-density-row.coverage-partial[data-coverage-partial="true"]',
    );
    // user 0 (partial in W1) + user 2 (partial in W2) = 2 rows; user 1 has
    // no partial weeks → no qualifier.
    expect(partial).toHaveLength(2);
    const partialKeys = Array.from(partial).map((r) =>
      r.getAttribute("data-author-key"),
    );
    expect(partialKeys.sort()).toEqual(
      [authors[0]!.author_id, authors[2]!.author_id].sort(),
    );
  });

  it("(e) tie-breaks deterministically on chosen-metric desc → display name asc → author key asc", () => {
    // Three authors with the SAME comment_count.  After display-name asc
    // tie-break, the two "Alice" rows are ordered by author_id asc
    // (user-aaa-1 then user-bob-2), then Zelda's user-zzz-3.
    const authors = [
      { author_id: "user-bob-2", author_name: "Alice" },
      { author_id: "user-aaa-1", author_name: "Alice" },
      { author_id: "user-zzz-3", author_name: "Zelda" },
    ];
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a) => {
      buckets[a.author_id] = makeBucket(1, 7, 0);
    });
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: authors,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-author-density-row"),
    );
    const orderedKeys = rows.map((r) => r.getAttribute("data-author-key"));
    expect(orderedKeys).toEqual(["user-aaa-1", "user-bob-2", "user-zzz-3"]);
  });

  it("(f) emits no drill-down attributes or handlers (FR-4-09)", () => {
    const authors = buildAuthorsDimension(3);
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a) => {
      buckets[a.author_id] = makeBucket(1, 5, 0);
    });
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: authors,
    });

    // No element under the chart container carries any data-drilldown-* attr.
    const drilldownAttrCarriers = container.querySelectorAll(
      "[data-drilldown-week], [data-drilldown-author], [data-drilldown-pr], [data-drilldown-repo]",
    );
    expect(drilldownAttrCarriers).toHaveLength(0);
    // Rows are not rendered as buttons (no role="button"), and have no
    // tabindex (informational rows, not interactive — sort buttons are the
    // sole interactive primitive).
    const rows = container.querySelectorAll(".comments-author-density-row");
    rows.forEach((row) => {
      expect(row.getAttribute("role")).toBe("row");
      expect(row.hasAttribute("tabindex")).toBe(false);
    });
  });

  it("(g) wires the sort selector as a WAI-ARIA radio-group with screen-reader-readable rows", () => {
    const authors = buildAuthorsDimension(3);
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a) => {
      buckets[a.author_id] = makeBucket(2, 7, 1);
    });
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: authors,
    });

    const radioGroup = container.querySelector(
      '.comments-author-density-sort[role="radiogroup"]',
    );
    expect(radioGroup).not.toBeNull();
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '.comments-author-density-sort-btn[role="radio"]',
    );
    expect(buttons).toHaveLength(3);
    const checked = container.querySelectorAll(
      '.comments-author-density-sort-btn[aria-checked="true"]',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.getAttribute("data-sort-metric")).toBe("comment_count");
    expect(checked[0]?.getAttribute("tabindex")).toBe("0");

    // Rows carry an aria-label that includes all 3 metric values.
    const firstRow = container.querySelector<HTMLElement>(
      ".comments-author-density-row",
    );
    const ariaLabel = firstRow?.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("threads");
    expect(ariaLabel).toContain("active threads");
    expect(ariaLabel).toContain("comments");
  });

  it("is a no-op when the container is null", () => {
    const authors = buildAuthorsDimension(2);
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a) => {
      buckets[a.author_id] = makeBucket(1, 5, 0);
    });
    // Deliberately invoke with null container — must not throw.
    expect(() =>
      renderCommentsAuthorDensityChart(null, [makeRollup(0, buckets)], {
        filters: emptyFilters(),
        authorsDimension: authors,
      }),
    ).not.toThrow();
  });

  it("renders the filter-not-supported empty state when ANY dimension filter is active", () => {
    const authors = buildAuthorsDimension(3);
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a) => {
      buckets[a.author_id] = makeBucket(1, 5, 0);
    });
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: { repos: ["repo-1"], teams: [], reviewers: [], authors: [] },
      authorsDimension: authors,
    });
    const rows = container.querySelectorAll(".comments-author-density-row");
    expect(rows).toHaveLength(0);
    // The shared empty-state primitive renders into the container; the
    // exact selector / wording is owned by ``renderNoData`` so we assert
    // on the absence of rows + presence of *some* container content.
    expect(container.textContent ?? "").toContain("filterable");
  });

  it("renders the no-data empty state when no rollup carries by_author_comments", () => {
    const rollups = [makeRollup(0, undefined), makeRollup(1, undefined)];
    renderCommentsAuthorDensityChart(container, rollups, {
      filters: emptyFilters(),
      authorsDimension: buildAuthorsDimension(2),
    });
    const rows = container.querySelectorAll(".comments-author-density-row");
    expect(rows).toHaveLength(0);
    expect(container.textContent ?? "").toContain("No comments data");
  });

  it("falls back to the raw author key when authorsDimension is missing entirely", () => {
    const buckets: Record<string, AuthorBucket> = {
      "raw-author-key": makeBucket(1, 3, 0),
    };
    // Intentionally omit ``authorsDimension`` so the directory is null —
    // resolveDisplayName must fall back to the raw key.
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {});
    const row = container.querySelector(".comments-author-density-row");
    const name = row?.querySelector(
      ".comments-author-density-name",
    )?.textContent;
    expect(name).toBe("raw-author-key");
  });

  it("ignores authorsDimension entries with missing author_id or author_name", () => {
    const buckets: Record<string, AuthorBucket> = {
      "known-author": makeBucket(1, 5, 0),
      "unknown-author": makeBucket(1, 4, 0),
    };
    // Mixed-shape dimension: one valid + one each invalid shape.  The
    // chart MUST silently skip the invalid entries and render the valid
    // mapping plus the raw key for the un-resolvable author.
    const dim = [
      { author_id: "known-author", author_name: "Known Author" },
      { author_id: "no-name" },
      { author_name: "no-id" },
    ];
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: dim,
    });
    const names = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-author-density-row .comments-author-density-name",
      ),
    ).map((n) => n.textContent ?? "");
    expect(names).toContain("Known Author");
    expect(names).toContain("unknown-author");
  });

  it("exercises the tie-break with insertion order ascending by author key (covers `<` branch)", () => {
    // Insertion order [aaa, bob, ccc, ddd] all named "Alice" forces the
    // sort to call compareRows with successive (a, b) pairs where
    // a.authorKey < b.authorKey at the tie-break stage — exercises the
    // -1 arm of the final ternary in compareRows that the existing test
    // (e) (insertion order [bob, aaa, zzz]) hits with a.authorKey >
    // b.authorKey only.
    const authors = [
      { author_id: "user-aaa", author_name: "Alice" },
      { author_id: "user-bob", author_name: "Alice" },
      { author_id: "user-ccc", author_name: "Alice" },
      { author_id: "user-ddd", author_name: "Alice" },
    ];
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a) => {
      buckets[a.author_id] = makeBucket(1, 7, 0);
    });
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: authors,
    });
    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-author-density-row"),
    ).map((r) => r.getAttribute("data-author-key"));
    expect(orderedKeys).toEqual([
      "user-aaa",
      "user-bob",
      "user-ccc",
      "user-ddd",
    ]);
  });

  it("re-orders rows when sortMetric=thread_count is requested", () => {
    const authors = buildAuthorsDimension(3);
    // Make thread_count and comment_count rank authors differently.
    const buckets: Record<string, AuthorBucket> = {
      [authors[0]!.author_id]: makeBucket(1, 100, 0),
      [authors[1]!.author_id]: makeBucket(50, 1, 25),
      [authors[2]!.author_id]: makeBucket(20, 50, 10),
    };
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: authors,
      sortMetric: "thread_count",
    });
    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-author-density-row"),
    ).map((r) => r.getAttribute("data-author-key"));
    expect(orderedKeys?.[0]).toBe(authors[1]!.author_id); // 50 threads
    expect(orderedKeys?.[1]).toBe(authors[2]!.author_id); // 20 threads
    expect(orderedKeys?.[2]).toBe(authors[0]!.author_id); // 1 thread
    const checked = container.querySelector(
      '.comments-author-density-sort-btn[aria-checked="true"]',
    );
    expect(checked?.getAttribute("data-sort-metric")).toBe("thread_count");
  });

  it("re-orders rows when sortMetric=active_thread_count is requested", () => {
    const authors = buildAuthorsDimension(3);
    const buckets: Record<string, AuthorBucket> = {
      [authors[0]!.author_id]: makeBucket(10, 50, 1),
      [authors[1]!.author_id]: makeBucket(10, 50, 8),
      [authors[2]!.author_id]: makeBucket(10, 50, 4),
    };
    renderCommentsAuthorDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      authorsDimension: authors,
      sortMetric: "active_thread_count",
    });
    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-author-density-row"),
    ).map((r) => r.getAttribute("data-author-key"));
    expect(orderedKeys?.[0]).toBe(authors[1]!.author_id); // 8 active
    expect(orderedKeys?.[1]).toBe(authors[2]!.author_id); // 4 active
    expect(orderedKeys?.[2]).toBe(authors[0]!.author_id); // 1 active
  });

  it("(h) is idempotent under repeated render calls on the same container", () => {
    const authors = buildAuthorsDimension(5);
    const buckets: Record<string, AuthorBucket> = {};
    authors.forEach((a, i) => {
      buckets[a.author_id] = makeBucket(2, 50 - i, 1);
    });
    const rollups = [makeRollup(0, buckets)];
    renderCommentsAuthorDensityChart(container, rollups, {
      filters: emptyFilters(),
      authorsDimension: authors,
    });
    renderCommentsAuthorDensityChart(container, rollups, {
      filters: emptyFilters(),
      authorsDimension: authors,
    });

    const tables = container.querySelectorAll(".comments-author-density-table");
    expect(tables).toHaveLength(1);
    const rows = container.querySelectorAll(".comments-author-density-row");
    expect(rows).toHaveLength(5);
    const radioGroups = container.querySelectorAll(
      '.comments-author-density-sort[role="radiogroup"]',
    );
    expect(radioGroups).toHaveLength(1);
  });
});
