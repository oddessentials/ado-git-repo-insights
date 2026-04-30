/**
 * Per-Reviewer Comments-Density Chart Module Tests (Feature 336 US1 / T019)
 *
 * JSDOM behaviour tests for renderCommentsReviewerDensityChart covering
 * the MVP contract surface (FR-4-01..FR-4-06 + FR-4-08..FR-4-12 +
 * chart-layer idempotency).  12 cases per spec.tasks.md T019.
 *
 *   (a) 12-reviewer fixture renders top-50-by-comment_count-desc; each
 *       row carries reviewer display label + 3 numeric metrics.
 *   (b) Range-filter narrowing (subset of rollups) re-renders rows with
 *       sums over the narrowed range.
 *   (c) Truncation indicator surfaces when input exceeds the cap
 *       (cap+3 fixture → cap visible + indicator with noun "reviewers").
 *   (d) Partial-coverage qualifier on rows whose reduced
 *       coverage_partial=true; non-partial rows MUST NOT carry it
 *       (FR-4-03); tooltip text emphasizes WEEK-LEVEL uncertainty per
 *       CL-10 directive.
 *   (e) FR-4-02 all-zero row filter applied BEFORE sort and truncate —
 *       across all 3 sort metrics; the all-zero row never appears.
 *   (f) Deterministic UI tie-break per FR-4-05: chosen-metric desc →
 *       display name asc → reviewer key asc as final tie-breaker.
 *   (g) FR-4-09 no click-through: rows have no data-drilldown-* attribute
 *       and no click handler attached by the chart module.
 *   (h) FR-4-10 a11y (rows + STATIC sort scaffold): rows expose metrics
 *       via screen-reader-readable aria-label; sort selector renders as
 *       a WAI-ARIA toolbar (role="toolbar" + 3 buttons + aria-pressed
 *       tracking active metric); each button is keyboard-reachable
 *       (default <button> tabindex=0).  This slice does NOT assert
 *       keyboard activation / row reordering — those land in the later
 *       sort-toggle slice.
 *   (i) Chart-layer idempotency: rendering twice on the same container
 *       produces ONE chart, not two — content replaced via the
 *       renderTrustedHtml pattern.
 *   (j) FR-4-11 raw-user_id fallback when usersDimension entry missing.
 *   (k) FR-4-12 sentinel rendering (CL-03 / CL-05): sentinel-keyed
 *       bucket renders fixed-string label "Former / unavailable author";
 *       defensive precedence (sentinel branch wins even when
 *       usersDimension contains an entry under the literal key);
 *       sentinel participates in sort like other rows (NOT pinned).
 *   (l) FR-4-08 no-data-in-range empty state.  Marker constants
 *       FILTER_STATE_UNIQUE_MARKERS / NODATA_STATE_UNIQUE_MARKERS are
 *       defined for forward use; cross-state exclusion against
 *       filter-not-supported text lands with the filter-not-supported
 *       branch in a later slice (NOT this slice — that exclusion would
 *       be vacuous until the filter branch exists).
 */

import {
  MAX_COMMENTS_REVIEWER_DENSITY_ROWS,
  renderCommentsReviewerDensityChart,
} from "../../../ui/modules/charts/comments-reviewer-density";
import type { Rollup } from "../../../ui/dataset-loader";
import type { FilterState } from "../../../ui/modules/filters";

interface ReviewerBucket {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function makeRollup(
  index: number,
  byReviewerComments: Record<string, ReviewerBucket> | undefined,
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
  if (byReviewerComments) {
    rollup.by_reviewer_comments = byReviewerComments;
  }
  return rollup;
}

function emptyFilters(): FilterState {
  return { repos: [], teams: [], reviewers: [], authors: [] };
}

function buildUsersDimension(
  count: number,
  prefix = "user",
): { user_id: string; display_name: string }[] {
  const out: { user_id: string; display_name: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      user_id: `${prefix}-${String(i).padStart(3, "0")}`,
      display_name: `${prefix} ${i}`,
    });
  }
  return out;
}

function makeBucket(
  thread: number,
  comment: number,
  active: number,
  partial = false,
): ReviewerBucket {
  return {
    thread_count: thread,
    comment_count: comment,
    active_thread_count: active,
    coverage_partial: partial,
  };
}

const SENTINEL_KEY = "__former_or_unavailable_author__";
const SENTINEL_LABEL = "Former / unavailable author";

// Forward-defined marker constants for the cross-state-exclusion gate
// that lands with the later filter-not-supported slice (T026 in #336
// numbering).  This slice does NOT cross-check markers against the
// filter-not-supported state — that branch isn't implemented yet and
// the assertion would be vacuous.  The constants are kept here so the
// follow-up slice can extend case (l) without re-deriving the marker
// list (memory feedback_atomic_crossfile_sweep_before_edit.md — keep
// drift-prone enumerations in one place).
const FILTER_STATE_UNIQUE_MARKERS = [
  "filterable",
  "clear repo",
  "filters",
  "per-dimension",
  "review-conversation",
] as const;

const NODATA_STATE_UNIQUE_MARKERS = [
  "no comments data",
  "selected range",
  "widening",
  "extraction",
] as const;

describe("renderCommentsReviewerDensityChart (Feature 336 US1)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("(a) renders one row per reviewer sorted by comment_count desc; each row carries display name + 3 metrics", () => {
    const users = buildUsersDimension(12);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u, i) => {
      // Distinct comment_count per reviewer so the desc sort is deterministic.
      buckets[u.user_id] = makeBucket(2, 100 - i, 1);
    });
    const rollups: Rollup[] = [makeRollup(0, buckets)];

    renderCommentsReviewerDensityChart(container, rollups, {
      filters: emptyFilters(),
      usersDimension: users,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    );
    expect(rows).toHaveLength(12);

    const firstRowName = rows[0]?.querySelector(
      ".comments-reviewer-density-name",
    )?.textContent;
    expect(firstRowName).toBe("user 0"); // highest comment_count = 100

    // Reviewer display label + 3 numeric metrics — table renders 4 cells per row.
    const firstRowCells = rows[0]?.querySelectorAll('[role="cell"]');
    expect(firstRowCells).toHaveLength(4);
  });

  it("(b) re-renders rows over a narrowed rollup range", () => {
    const users = buildUsersDimension(3);
    const wideRollups: Rollup[] = [];
    for (let i = 0; i < 4; i++) {
      const buckets: Record<string, ReviewerBucket> = {};
      users.forEach((u) => {
        buckets[u.user_id] = makeBucket(1, 5, 0);
      });
      wideRollups.push(makeRollup(i, buckets));
    }
    renderCommentsReviewerDensityChart(container, wideRollups, {
      filters: emptyFilters(),
      usersDimension: users,
    });
    const wideRows = container.querySelectorAll<HTMLElement>(
      ".comments-reviewer-density-row",
    );
    expect(wideRows).toHaveLength(3);
    // 4 weeks × 5 comments = 20 per reviewer on the wide range.
    const wideFirstCommentCell = wideRows[0]?.querySelectorAll(
      ".comments-reviewer-density-numeric",
    )[2];
    expect(wideFirstCommentCell?.textContent).toBe("20");

    // Narrow to first 2 weeks → 2 × 5 = 10 per reviewer.
    renderCommentsReviewerDensityChart(container, wideRollups.slice(0, 2), {
      filters: emptyFilters(),
      usersDimension: users,
    });
    const narrowRows = container.querySelectorAll<HTMLElement>(
      ".comments-reviewer-density-row",
    );
    expect(narrowRows).toHaveLength(3);
    const narrowFirstCommentCell = narrowRows[0]?.querySelectorAll(
      ".comments-reviewer-density-numeric",
    )[2];
    expect(narrowFirstCommentCell?.textContent).toBe("10");
  });

  it('(c) renders the truncation indicator with noun "reviewers" when input exceeds the cap', () => {
    const overCap = MAX_COMMENTS_REVIEWER_DENSITY_ROWS + 3;
    const users = buildUsersDimension(overCap);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u, i) => {
      buckets[u.user_id] = makeBucket(1, overCap - i, 0);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    const rows = container.querySelectorAll(".comments-reviewer-density-row");
    expect(rows).toHaveLength(MAX_COMMENTS_REVIEWER_DENSITY_ROWS);
    const indicator = container.querySelector(".truncation-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain(
      String(MAX_COMMENTS_REVIEWER_DENSITY_ROWS),
    );
    // Noun "reviewers" specifically — distinguishes from #335's
    // "repositories" and #334's "authors" via the chart-layer
    // truncation-indicator string.
    expect(indicator?.textContent?.toLowerCase()).toContain("reviewer");
  });

  it("(d) applies the partial-coverage qualifier ONLY to rows whose reduced coverage_partial=true; tooltip emphasizes week-level uncertainty (CL-10)", () => {
    const users = buildUsersDimension(3);
    const week1Buckets: Record<string, ReviewerBucket> = {
      [users[0]!.user_id]: makeBucket(2, 4, 1, true),
      [users[1]!.user_id]: makeBucket(2, 4, 1, false),
      [users[2]!.user_id]: makeBucket(2, 4, 1, false),
    };
    const week2Buckets: Record<string, ReviewerBucket> = {
      [users[0]!.user_id]: makeBucket(2, 4, 1, false),
      [users[1]!.user_id]: makeBucket(2, 4, 1, false),
      [users[2]!.user_id]: makeBucket(2, 4, 1, true),
    };
    renderCommentsReviewerDensityChart(
      container,
      [makeRollup(0, week1Buckets), makeRollup(1, week2Buckets)],
      { filters: emptyFilters(), usersDimension: users },
    );

    const partial = container.querySelectorAll(
      '.comments-reviewer-density-row.coverage-partial[data-coverage-partial="true"]',
    );
    // user 0 (partial in W1) + user 2 (partial in W2) = 2 rows; user 1
    // has no partial weeks → no qualifier.
    expect(partial).toHaveLength(2);
    const partialKeys = Array.from(partial).map((r) =>
      r.getAttribute("data-reviewer-key"),
    );
    expect(partialKeys.sort()).toEqual(
      [users[0]!.user_id, users[2]!.user_id].sort(),
    );

    // CL-10 / FR-4-03: tooltip text emphasizes WEEK-LEVEL uncertainty.
    // Title attribute carries the user-visible tooltip; aria-label
    // carries the screen-reader-friendly variant.  Both MUST contain
    // a week-level wording marker — bucket-specific phrasing would
    // overstate the data semantics.
    const partialRow = partial[0] as HTMLElement;
    const titleText = (partialRow.getAttribute("title") ?? "").toLowerCase();
    const ariaLabel = (
      partialRow.getAttribute("aria-label") ?? ""
    ).toLowerCase();
    expect(titleText.length).toBeGreaterThan(0);
    expect(titleText.includes("week") || titleText.includes("weekly")).toBe(
      true,
    );
    expect(ariaLabel.includes("week") || ariaLabel.includes("weekly")).toBe(
      true,
    );
  });

  it("(e) FR-4-02 filters all-zero rows BEFORE sort/truncate across all 3 sort metrics", () => {
    // Mixed fixture: ONE all-zero (partial=true) reviewer + 50 non-zero
    // reviewers chosen so the all-zero row would be visible if not
    // filtered.  Per FR-4-02 the row MUST be absent regardless of the
    // active sort metric — the filter is at the row-build step,
    // BEFORE sort and BEFORE the top-N cap (mirrors #335 case (k)).
    const users = buildUsersDimension(51);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u, i) => {
      // First user is all-zero + partial=true (the contract violation
      // surface FR-4-02 guards against).
      buckets[u.user_id] =
        i === 0 ? makeBucket(0, 0, 0, true) : makeBucket(2, 5 + i, 1);
    });

    for (const sortMetric of [
      "comment_count",
      "thread_count",
      "active_thread_count",
    ] as const) {
      // Reset the container between iterations so each render stands
      // alone (the prior render's content would otherwise mask via the
      // renderTrustedHtml content-replace pattern, but explicit reset
      // matches the dashboard's filter-change behavior).
      container.innerHTML = "";
      renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
        filters: emptyFilters(),
        usersDimension: users,
        sortMetric,
      });
      const rows = container.querySelectorAll<HTMLElement>(
        ".comments-reviewer-density-row",
      );
      // 50 non-zero rows after the all-zero filter, then top-50 cap.
      expect(rows).toHaveLength(MAX_COMMENTS_REVIEWER_DENSITY_ROWS);
      // The all-zero user is absent regardless of sort metric.
      const zeroRow = container.querySelector(
        `[data-reviewer-key="${users[0]!.user_id}"]`,
      );
      expect(zeroRow).toBeNull();
    }
  });

  it("(f) tie-breaks deterministically on chosen-metric desc → display name asc → reviewer key asc", () => {
    // Three reviewers with the SAME comment_count.  After display-name
    // asc tie-break, the two "Alpha" rows are ordered by reviewer key
    // asc (user-aaa-1 then user-bob-2), then Zelda's user-zzz-3.
    const users = [
      { user_id: "user-bob-2", display_name: "Alpha" },
      { user_id: "user-aaa-1", display_name: "Alpha" },
      { user_id: "user-zzz-3", display_name: "Zelda" },
    ];
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      buckets[u.user_id] = makeBucket(1, 7, 0);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    );
    const orderedKeys = rows.map((r) => r.getAttribute("data-reviewer-key"));
    expect(orderedKeys).toEqual(["user-aaa-1", "user-bob-2", "user-zzz-3"]);
  });

  it("(g) emits no drill-down attributes or click handlers (FR-4-09)", () => {
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      buckets[u.user_id] = makeBucket(1, 5, 0);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    // No element under the chart container carries any data-drilldown-*
    // attr (covers all four dimensions: week / author / pr / repo /
    // reviewer).
    const drilldownAttrCarriers = container.querySelectorAll(
      "[data-drilldown-week], [data-drilldown-author], [data-drilldown-pr], [data-drilldown-repo], [data-drilldown-reviewer]",
    );
    expect(drilldownAttrCarriers).toHaveLength(0);
    // Rows are not rendered as buttons (no role="button"), and have no
    // tabindex (informational rows, not interactive — sort buttons are
    // the sole interactive primitive).
    const rows = container.querySelectorAll(".comments-reviewer-density-row");
    rows.forEach((row) => {
      expect(row.getAttribute("role")).toBe("row");
      expect(row.hasAttribute("tabindex")).toBe(false);
    });
  });

  it("(h) wires the static sort selector as a WAI-ARIA toolbar with screen-reader-readable rows", () => {
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      buckets[u.user_id] = makeBucket(2, 7, 1);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    // Toolbar scaffold present with WAI-ARIA role.
    const toolbar = container.querySelector(
      '.comments-reviewer-density-sort[role="toolbar"]',
    );
    expect(toolbar).not.toBeNull();
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".comments-reviewer-density-sort-btn",
    );
    expect(buttons).toHaveLength(3);
    // Each button is independently Tab-reachable (default <button>
    // tabindex=0, no explicit tabindex attribute).
    buttons.forEach((btn) => {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.hasAttribute("tabindex")).toBe(false);
    });
    // Default aria-pressed: comment_count active, the other two inactive.
    const checked = container.querySelectorAll(
      '.comments-reviewer-density-sort-btn[aria-pressed="true"]',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.getAttribute("data-sort-metric")).toBe("comment_count");
    const unpressed = container.querySelectorAll(
      '.comments-reviewer-density-sort-btn[aria-pressed="false"]',
    );
    expect(unpressed).toHaveLength(2);

    // Rows carry an aria-label that includes all 3 metric values.
    const firstRow = container.querySelector<HTMLElement>(
      ".comments-reviewer-density-row",
    );
    const ariaLabel = firstRow?.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("threads");
    expect(ariaLabel).toContain("active threads");
    expect(ariaLabel).toContain("comments");

    // NOTE: this slice does NOT assert keyboard activation (Enter /
    // Space) or click reordering — the listener attach lands in the
    // later sort-toggle slice.  Asserting keyboard activation here
    // would either pass vacuously (if the buttons accept Enter
    // natively as click events to a no-op handler) or fail loudly
    // because no listener is attached.  Defer cleanly.
  });

  it("(i) is idempotent under repeated render calls on the same container", () => {
    const users = buildUsersDimension(5);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u, i) => {
      buckets[u.user_id] = makeBucket(2, 50 - i, 1);
    });
    const rollups = [makeRollup(0, buckets)];
    renderCommentsReviewerDensityChart(container, rollups, {
      filters: emptyFilters(),
      usersDimension: users,
    });
    renderCommentsReviewerDensityChart(container, rollups, {
      filters: emptyFilters(),
      usersDimension: users,
    });

    const tables = container.querySelectorAll(
      ".comments-reviewer-density-table",
    );
    expect(tables).toHaveLength(1);
    const rows = container.querySelectorAll(".comments-reviewer-density-row");
    expect(rows).toHaveLength(5);
    const toolbars = container.querySelectorAll(
      '.comments-reviewer-density-sort[role="toolbar"]',
    );
    expect(toolbars).toHaveLength(1);
  });

  it("(j) FR-4-11 raw-user_id fallback when usersDimension entry missing", () => {
    // Construct a fixture with one bucket whose user_id is absent from
    // the usersDimension array (e.g., a brand-new user since the
    // dimension snapshot, or an unknown commenter id).  The renderer
    // MUST fall back to rendering the raw user_id as the display
    // label per CL-05 step 3 / FR-4-11 — no blank, no row omission.
    const knownUsers = [
      { user_id: "user-known-1", display_name: "Known User" },
    ];
    const buckets: Record<string, ReviewerBucket> = {
      "user-known-1": makeBucket(2, 10, 1),
      "user-orphan-uuid-not-in-dim": makeBucket(3, 7, 2),
    };
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: knownUsers,
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    );
    expect(rows).toHaveLength(2);
    const names = rows.map(
      (r) =>
        r.querySelector(".comments-reviewer-density-name")?.textContent ?? "",
    );
    // Both rows render — the orphan does NOT get omitted (would be the
    // contract violation FR-4-11 guards against).
    expect(names).toContain("Known User");
    expect(names).toContain("user-orphan-uuid-not-in-dim");
    // The orphan row's data-reviewer-key matches the raw key.
    const orphanRow = rows.find(
      (r) =>
        r.getAttribute("data-reviewer-key") === "user-orphan-uuid-not-in-dim",
    );
    expect(orphanRow).toBeDefined();
    expect(
      orphanRow?.querySelector(".comments-reviewer-density-name")?.textContent,
    ).toBe("user-orphan-uuid-not-in-dim");
  });

  it("(k) FR-4-12 sentinel rendering: fixed label, defensive precedence, sort participation", () => {
    const users = buildUsersDimension(3);
    // Comment counts: user 0 → 100, user 1 → 50, sentinel → 75, user 2 → 10.
    // The sentinel ranks SECOND (between user 0 and user 1) on
    // comment_count desc — NOT pinned at top or bottom.  This mirrors
    // #334's case (T028-b) sentinel-ranks-second pattern.
    const buckets: Record<string, ReviewerBucket> = {
      [users[0]!.user_id]: makeBucket(2, 100, 1),
      [users[1]!.user_id]: makeBucket(2, 50, 1),
      [users[2]!.user_id]: makeBucket(2, 10, 1),
      [SENTINEL_KEY]: makeBucket(2, 75, 1),
    };
    // Defensive precedence: even if the usersDimension contained an
    // entry under the literal key, the renderer's sentinel branch MUST
    // take precedence — the row label MUST be the fixed string.
    const dim = [
      ...users,
      { user_id: SENTINEL_KEY, display_name: "Should NEVER show" },
    ];
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: dim,
    });

    // (k.1) sentinel-keyed row exists and renders the FIXED label.
    const sentinelRow = container.querySelector<HTMLElement>(
      `.comments-reviewer-density-row[data-reviewer-key="${SENTINEL_KEY}"]`,
    );
    expect(sentinelRow).not.toBeNull();
    const sentinelName = sentinelRow?.querySelector(
      ".comments-reviewer-density-name",
    )?.textContent;
    expect(sentinelName).toBe(SENTINEL_LABEL);

    // (k.2) The raw key string MUST NOT appear in any rendered row's
    // visible text (the data attribute carrying it is fine — that's
    // queryable infrastructure, not user-visible text).
    const visibleNames = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-reviewer-density-name",
      ),
    ).map((n) => n.textContent ?? "");
    expect(visibleNames).not.toContain(SENTINEL_KEY);
    expect(visibleNames).toContain(SENTINEL_LABEL);

    // (k.3) Defensive precedence: the dimension's "Should NEVER show"
    // entry under the literal key MUST NOT appear.
    expect(visibleNames).not.toContain("Should NEVER show");

    // (k.4) Sentinel participates in sort — not pinned to top or
    // bottom.  Default comment_count desc: user 0 (100) → sentinel
    // (75) → user 1 (50) → user 2 (10).
    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(orderedKeys).toEqual([
      users[0]!.user_id,
      SENTINEL_KEY,
      users[1]!.user_id,
      users[2]!.user_id,
    ]);
  });

  // ===========================================================================
  // T030: sentinel-rendering test extension (US4).  Existing case (k) covers
  // the basic sentinel-keyed bucket rendering + defensive precedence + sort
  // participation against the default metric.  T030 extends with three
  // cases the task spec calls for:
  //   (T030-a) sentinel aggregates ACROSS weeks into one row (chart-layer
  //            reducePerReviewer behavior on the sentinel key — no
  //            per-week-ghost row leakage).
  //   (T030-b) sentinel participates in sort across ALL THREE metrics
  //            (extends (k.4) with explicit cross-metric switching).
  //   (T030-c) zero-ghost range — no sentinel row appears.
  // 3 tests; floor delta measured by test:coverage (not assumed +3 per the
  // kickoff measured-ratchet directive).
  // ===========================================================================

  it("(T030-a) sentinel aggregates across multiple weeks into ONE row (no per-week ghost leakage)", () => {
    // Two weeks, both contributing a sentinel-keyed bucket whose values
    // semantically represent that week's ghost-commenter contributions
    // already collapsed by the aggregator (per CL-14).  The chart's
    // reducePerReviewer treats the sentinel key like any other key —
    // sums numeric fields, OR-reduces coverage_partial — so the
    // rendered chart MUST contain exactly ONE sentinel row whose
    // metrics equal the cross-week sum.  A regression that emitted
    // per-week sentinel rows (or that special-cased the sentinel key
    // to bypass reduction) would surface as "row count > 1 for the
    // sentinel data-reviewer-key".
    const users = buildUsersDimension(2);
    const week1Buckets: Record<string, ReviewerBucket> = {
      // Week 1 — 1 ghost commenter contributed (post-aggregator).
      [SENTINEL_KEY]: makeBucket(2, 5, 1, false),
      [users[0]!.user_id]: makeBucket(2, 10, 1, false),
      [users[1]!.user_id]: makeBucket(2, 8, 1, false),
    };
    const week2Buckets: Record<string, ReviewerBucket> = {
      // Week 2 — 2 different ghost commenters contributed (post-
      // aggregator).  Cross-week sum: thread=2+1=3, comment=5+4=9,
      // active=1+0=1.
      [SENTINEL_KEY]: makeBucket(1, 4, 0, false),
      [users[0]!.user_id]: makeBucket(2, 10, 1, false),
      [users[1]!.user_id]: makeBucket(2, 8, 1, false),
    };
    renderCommentsReviewerDensityChart(
      container,
      [makeRollup(0, week1Buckets), makeRollup(1, week2Buckets)],
      { filters: emptyFilters(), usersDimension: users },
    );

    // Exactly one sentinel row.
    const sentinelRows = container.querySelectorAll<HTMLElement>(
      `.comments-reviewer-density-row[data-reviewer-key="${SENTINEL_KEY}"]`,
    );
    expect(sentinelRows).toHaveLength(1);
    const sentinelRow = sentinelRows[0] as HTMLElement;

    // Label is the fixed-string sentinel label.
    expect(
      sentinelRow.querySelector(".comments-reviewer-density-name")?.textContent,
    ).toBe(SENTINEL_LABEL);

    // Numeric cells reflect the cross-week sum (column order in
    // ``renderTable``: Threads, Active threads, Comments).
    const numericCells = sentinelRow.querySelectorAll<HTMLElement>(
      ".comments-reviewer-density-numeric",
    );
    expect(numericCells).toHaveLength(3);
    expect(numericCells[0]!.textContent).toBe("3"); // thread_count = 2 + 1
    expect(numericCells[1]!.textContent).toBe("1"); // active_thread_count = 1 + 0
    expect(numericCells[2]!.textContent).toBe("9"); // comment_count = 5 + 4
  });

  it("(T030-b) sentinel participates in sort across all 3 metrics — distinct positions per metric", () => {
    // Anti-vacuous fixture: chosen values place the sentinel at THREE
    // distinct positions across the three sort metrics, proving the
    // sentinel is sorted like any other row (not pinned to a specific
    // position).  All entries satisfy INV-4-07 (active <= thread):
    //
    //   Sentinel: thread=50, comment=30, active=2
    //   user 0:   thread=20, comment=40, active=10
    //   user 1:   thread=10, comment=20, active=8
    //   user 2:   thread=30, comment=10, active=25
    //
    //   comment_count desc (default):   user0(40) sentinel(30) user1(20) user2(10)
    //                                                 ^^ index 1 ^^
    //   thread_count desc:              sentinel(50) user2(30) user0(20) user1(10)
    //                                       ^^ index 0 ^^
    //   active_thread_count desc:       user2(25) user0(10) user1(8) sentinel(2)
    //                                                                    ^^ index 3 ^^
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {
      [SENTINEL_KEY]: makeBucket(50, 30, 2, false),
      [users[0]!.user_id]: makeBucket(20, 40, 10, false),
      [users[1]!.user_id]: makeBucket(10, 20, 8, false),
      [users[2]!.user_id]: makeBucket(30, 10, 25, false),
    };
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    // Default ordering — sentinel at index 1 (between user 0 and user 1).
    const defaultOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(defaultOrder).toEqual([
      users[0]!.user_id,
      SENTINEL_KEY,
      users[1]!.user_id,
      users[2]!.user_id,
    ]);
    expect(defaultOrder.indexOf(SENTINEL_KEY)).toBe(1);

    // After thread_count click — sentinel at index 0 (top).
    const threadBtn = container.querySelector<HTMLButtonElement>(
      '.comments-reviewer-density-sort-btn[data-sort-metric="thread_count"]',
    );
    threadBtn?.click();
    const threadOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(threadOrder).toEqual([
      SENTINEL_KEY,
      users[2]!.user_id,
      users[0]!.user_id,
      users[1]!.user_id,
    ]);
    expect(threadOrder.indexOf(SENTINEL_KEY)).toBe(0);

    // After active_thread_count click — sentinel at index 3 (bottom).
    const activeBtn = container.querySelector<HTMLButtonElement>(
      '.comments-reviewer-density-sort-btn[data-sort-metric="active_thread_count"]',
    );
    activeBtn?.click();
    const activeOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(activeOrder).toEqual([
      users[2]!.user_id,
      users[0]!.user_id,
      users[1]!.user_id,
      SENTINEL_KEY,
    ]);
    expect(activeOrder.indexOf(SENTINEL_KEY)).toBe(3);

    // Final invariant: the three sentinel positions (1, 0, 3) are
    // pairwise distinct — direct proof the sentinel sorts by the
    // chosen metric like any other row, not pinned to top / middle /
    // bottom.
    const sentinelPositions = [
      defaultOrder.indexOf(SENTINEL_KEY),
      threadOrder.indexOf(SENTINEL_KEY),
      activeOrder.indexOf(SENTINEL_KEY),
    ];
    const distinctPositions = new Set(sentinelPositions);
    expect(distinctPositions.size).toBe(3);
  });

  it("(T030-c) zero-ghost range emits no sentinel row", () => {
    // Fixture with no sentinel-keyed bucket in any week.  The chart
    // MUST NOT manufacture a sentinel row out of nothing — its
    // existence is gated entirely on the aggregator's emission of a
    // sentinel-keyed bucket.  A regression that always rendered a
    // sentinel row (e.g., as a fallback for missing user_ids) would
    // surface as a sentinel-key row count > 0 here.
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u, i) => {
      buckets[u.user_id] = makeBucket(2, 10 - i, 1);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    // No sentinel row.
    const sentinelRows = container.querySelectorAll(
      `.comments-reviewer-density-row[data-reviewer-key="${SENTINEL_KEY}"]`,
    );
    expect(sentinelRows).toHaveLength(0);

    // The 3 real-reviewer rows render normally (sanity — proves the
    // zero-ghost case hasn't accidentally suppressed real rows).
    const allRows = container.querySelectorAll(
      ".comments-reviewer-density-row",
    );
    expect(allRows).toHaveLength(3);

    // The sentinel label string MUST NOT appear anywhere in the
    // rendered DOM (defensive — would catch a regression that always
    // included a "Former / unavailable author" label as a placeholder
    // even in the zero-ghost case).
    expect(container.textContent ?? "").not.toContain(SENTINEL_LABEL);
  });

  it("(l) FR-4-08 no-data-in-range empty state with marker constants defined for forward use", () => {
    // Capability-on path (filters CLEAR) but the visible range yields
    // zero contributions: every rollup either lacks
    // by_reviewer_comments or carries an empty entry set.  Chart
    // renders the no-data-in-range empty state.
    //
    // NOTE: this slice does NOT assert cross-state exclusion against
    // the filter-not-supported markers — that branch isn't yet
    // implemented and the assertion would be vacuous.  The
    // FILTER_STATE_UNIQUE_MARKERS / NODATA_STATE_UNIQUE_MARKERS
    // constants are forward-defined (see top of file) for the later
    // filter-not-supported slice's cross-state-exclusion test.
    const rollups = [makeRollup(0, undefined), makeRollup(1, undefined)];
    renderCommentsReviewerDensityChart(container, rollups, {
      filters: emptyFilters(),
      usersDimension: buildUsersDimension(2),
    });

    const rows = container.querySelectorAll(".comments-reviewer-density-row");
    expect(rows).toHaveLength(0);

    // Marker constants exist for forward use (compile-time + runtime
    // sanity check — ensures the constants stay in scope through
    // future slices that add the cross-state-exclusion assertion).
    expect(FILTER_STATE_UNIQUE_MARKERS.length).toBeGreaterThan(0);
    expect(NODATA_STATE_UNIQUE_MARKERS.length).toBeGreaterThan(0);

    // Heading + hint paragraphs render separately per A-14 marker
    // discipline (renderNoData produces .no-data + .no-data-hint).
    const heading = container.querySelector(".no-data");
    const hint = container.querySelector(".no-data-hint");
    expect(heading).not.toBeNull();
    expect(hint).not.toBeNull();

    const headingText = (heading?.textContent ?? "").toLowerCase();
    const hintText = (hint?.textContent ?? "").toLowerCase();

    // No-data state heading marker.
    expect(headingText).toContain("no comments data");
    expect(headingText).toContain("selected range");
    // No-data state hint markers — at least one user-visible
    // remediation MUST surface (widening the range OR confirming
    // extraction).  A hint rewrite that dropped both surfaces here.
    expect(
      hintText.includes("widening") || hintText.includes("extraction"),
    ).toBe(true);
  });

  // ===========================================================================
  // Phase 7 partial-branch ratchet covering tests.
  //
  // These exercise defensive branches the primary T019 (a)-(l) tests
  // don't reach: null container, missing usersDimension (which also
  // covers the ``if (directory)`` false branch in resolveDisplayName
  // because directory is null iff usersDimension is absent), malformed
  // dimension entries, and the reverse-direction arm of compareRows'
  // final-tier ternary.  Per memory ``feedback_partial_branches_ratchet
  // .md`` the ratchet does not grow; the branches handle real
  // production paths so removal is not appropriate.
  //
  // 4 tests cover 5 partial-branch lines: 166 + 194 (co-fired) + 169 +
  // 242 + 272.
  // ===========================================================================

  it("(P7-a) is a no-op when the container is null (defensive null guard, line 272)", () => {
    const users = buildUsersDimension(2);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      buckets[u.user_id] = makeBucket(1, 5, 0);
    });
    // Call with null container — production callers (dashboard.ts) guard
    // null already, but the type signature allows it so any direct
    // caller that doesn't guard MUST not throw.  Covers the
    // ``if (!container) return;`` false branch (the early return) which
    // none of (a)-(l) hit.
    expect(() =>
      renderCommentsReviewerDensityChart(null, [makeRollup(0, buckets)], {
        filters: emptyFilters(),
        usersDimension: users,
      }),
    ).not.toThrow();
  });

  it("(P7-b) renders raw user_id labels when usersDimension is absent (lines 166 + 194 co-fired)", () => {
    // No usersDimension passed → ``buildUsersDirectory`` returns null
    // (line 166 true branch fires) → ``resolveDisplayName`` skips the
    // ``if (directory)`` block (line 194 false branch fires) and falls
    // through to the raw-user_id step.  Both partial branches flip
    // from a single render call.
    const buckets: Record<string, ReviewerBucket> = {
      "user-1": makeBucket(2, 10, 1),
      "user-2": makeBucket(2, 5, 1),
    };
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      // usersDimension intentionally omitted — production callers
      // pass this option only when the dataset has a users dimension
      // available; older datasets / partial loads can omit it.
    });
    const rows = container.querySelectorAll<HTMLElement>(
      ".comments-reviewer-density-row",
    );
    expect(rows).toHaveLength(2);
    // Both rows render with raw user_id labels (no dimension lookup
    // because no dimension provided).
    const names = Array.from(rows).map(
      (r) =>
        r.querySelector(".comments-reviewer-density-name")?.textContent ?? "",
    );
    expect(names).toContain("user-1");
    expect(names).toContain("user-2");
  });

  it("(P7-c) ignores usersDimension entries with non-string fields (line 169)", () => {
    // Mixed-shape dimension: one valid + several invalid shapes.  The
    // chart silently skips the invalid entries via the typeof guard in
    // ``buildUsersDirectory`` (line 169 false branch fires when
    // ``typeof entry.user_id !== "string"``) and renders the valid
    // mapping plus the raw key for any un-resolvable user.
    const buckets: Record<string, ReviewerBucket> = {
      "user-real": makeBucket(2, 10, 1),
      "user-orphan": makeBucket(1, 4, 0),
    };
    const dim: { user_id?: unknown; display_name?: unknown }[] = [
      { user_id: "user-real", display_name: "Real User" },
      { user_id: "no-name" }, // missing display_name (undefined)
      { display_name: "no-id" }, // missing user_id (undefined)
      { user_id: 42, display_name: "non-string-id" }, // wrong type for user_id
      { user_id: "ok-id", display_name: 99 }, // wrong type for display_name
    ];
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: dim as unknown as readonly {
        user_id?: string;
        display_name?: string;
      }[],
    });
    const names = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".comments-reviewer-density-row .comments-reviewer-density-name",
      ),
    ).map((n) => n.textContent ?? "");
    // Valid entry resolves to "Real User".
    expect(names).toContain("Real User");
    // Orphan falls through to raw user_id per FR-4-11 (its dimension
    // entry was filtered out by the typeof guard).
    expect(names).toContain("user-orphan");
  });

  it("(P7-d) compareRows fires the reverse-order arm on a two-tier tie-break fixture (line 242)", () => {
    // Force compareRows' final ternary to fire BOTH arms by providing
    // 4 entries with two pairs of duplicate display names — one pair
    // ordered ascending by reviewer key (aaa < bbb), the other pair
    // input-ordered descending (ddd, ccc with ddd > ccc).  The sort
    // algorithm makes at least one comparison in each direction,
    // hitting both arms of the
    // ``a.reviewerKey < b.reviewerKey ? -1 : 1`` ternary.  Test (f)
    // alone fires only the ``< true`` arm under TimSort's traversal.
    const users = [
      { user_id: "user-aaa", display_name: "Alpha" },
      { user_id: "user-bbb", display_name: "Alpha" },
      { user_id: "user-ddd", display_name: "Beta" },
      { user_id: "user-ccc", display_name: "Beta" },
    ];
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      // Identical comment_count + thread_count + active_thread_count
      // so the metric tie-break + display-name tie-break delegate to
      // reviewer key as the final tier.
      buckets[u.user_id] = makeBucket(1, 5, 0);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    // Display-name asc primary → Alpha pairs first, Beta pairs second.
    // Within each name-pair, reviewer-key asc resolves the order.
    expect(orderedKeys).toEqual([
      "user-aaa",
      "user-bbb",
      "user-ccc",
      "user-ddd",
    ]);
  });

  // ===========================================================================
  // T027: sort-toggle behaviour — clicking a button or activating it via
  // Enter / Space re-orders the rows by the new metric and updates the
  // aria-pressed indicator.  Tie-break determinism (display name asc →
  // reviewer key asc) is reproducible across re-renders.  Sort respects
  // the FR-4-02 zero-row suppression: the sorted candidate set excludes
  // all-zero reduced rows before applying truncation logic (verified
  // structurally via case (e) above; the chart's render path filters
  // before sort, so a click-triggered re-render walks the same code
  // path).  4 tests; floor delta measured by ``test:coverage`` (not
  // assumed) per the kickoff directive.
  // ===========================================================================

  function clickReviewerSortButton(metric: string): HTMLButtonElement {
    const btn = container.querySelector<HTMLButtonElement>(
      `.comments-reviewer-density-sort-btn[data-sort-metric="${metric}"]`,
    );
    if (!btn) {
      throw new Error(`sort button for metric ${metric} not found`);
    }
    btn.click();
    return btn;
  }

  it("(T027-a) clicking the thread_count button re-orders rows and updates aria-pressed", () => {
    const users = buildUsersDimension(3);
    // thread_count and comment_count rank reviewers differently so the
    // re-order is unambiguously visible (mirrors #335 T023-a fixture).
    const buckets: Record<string, ReviewerBucket> = {
      [users[0]!.user_id]: makeBucket(1, 100, 0),
      [users[1]!.user_id]: makeBucket(50, 1, 25),
      [users[2]!.user_id]: makeBucket(20, 50, 10),
    };
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    clickReviewerSortButton("thread_count");

    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(orderedKeys).toEqual([
      users[1]!.user_id, // 50 threads
      users[2]!.user_id, // 20 threads
      users[0]!.user_id, // 1 thread
    ]);
    const checked = container.querySelector(
      '.comments-reviewer-density-sort-btn[aria-pressed="true"]',
    );
    expect(checked?.getAttribute("data-sort-metric")).toBe("thread_count");
  });

  it("(T027-b) clicking the active_thread_count button re-orders rows", () => {
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {
      [users[0]!.user_id]: makeBucket(10, 50, 1),
      [users[1]!.user_id]: makeBucket(10, 50, 8),
      [users[2]!.user_id]: makeBucket(10, 50, 4),
    };
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    clickReviewerSortButton("active_thread_count");

    const orderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(orderedKeys).toEqual([
      users[1]!.user_id, // 8 active
      users[2]!.user_id, // 4 active
      users[0]!.user_id, // 1 active
    ]);
    const checked = container.querySelector(
      '.comments-reviewer-density-sort-btn[aria-pressed="true"]',
    );
    expect(checked?.getAttribute("data-sort-metric")).toBe(
      "active_thread_count",
    );
  });

  it("(T027-c) tie-break is reproducible across reloads on a duplicate-display-name fixture", () => {
    // Fixture with deliberate ties on comment_count AND on display_name
    // (rename-collision shape: two reviewers sharing the same display
    // name).  Per FR-4-05 the final tie-break is reviewer-key
    // ascending — so the rendered order is fully determined by reviewer
    // key once the metric + name ties hit.  Render twice and assert
    // byte-identical row ordering — proves the chart's sort is
    // reproducible across re-renders (no hidden state that varies
    // between calls).
    const users = [
      { user_id: "user-bbb", display_name: "Beta" },
      { user_id: "user-aaa", display_name: "Alpha" },
      // Same display name as user-bbb (rename collision); reviewer key
      // is the tie-breaker.
      { user_id: "user-ccc", display_name: "Beta" },
    ];
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      // All three have identical comment_count so the metric tie
      // delegates to display name asc → reviewer key asc.
      buckets[u.user_id] = makeBucket(1, 7, 0);
    });
    const rollups = [makeRollup(0, buckets)];
    const opts = {
      filters: emptyFilters(),
      usersDimension: users,
    };

    renderCommentsReviewerDensityChart(container, rollups, opts);
    const firstOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));

    // Expected: Alpha first (single-name tie-break wins), then the two
    // Beta-named rows tie-broken by reviewer-key asc → bbb before ccc.
    expect(firstOrder).toEqual(["user-aaa", "user-bbb", "user-ccc"]);

    renderCommentsReviewerDensityChart(container, rollups, opts);
    const secondOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(secondOrder).toEqual(firstOrder);
  });

  it("(T027-d) keyboard activation (Enter / Space) re-orders rows like a click", () => {
    const users = buildUsersDimension(3);
    // Fixture chosen so the THREE orderings (default comment_count
    // desc, thread_count desc, active_thread_count desc) are ALL
    // distinct — this prevents the Space activation assertion from
    // passing vacuously when Space is a no-op (mirrors #335 T023-d
    // anti-vacuous fixture per the kickoff directive).  All entries
    // satisfy INV-4-07 (active_thread_count <= thread_count).
    const buckets: Record<string, ReviewerBucket> = {
      [users[0]!.user_id]: makeBucket(50, 10, 5),
      [users[1]!.user_id]: makeBucket(10, 20, 8),
      [users[2]!.user_id]: makeBucket(20, 30, 3),
    };
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    // Initial-state guard: the default comment_count desc ordering is
    // [users[2] (30), users[1] (20), users[0] (10)].  Asserted so a
    // future fixture drift that aligned default + Enter outcomes would
    // surface here rather than masking a broken keyboard handler.
    const initial = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(initial).toEqual([
      users[2]!.user_id, // 30 comments
      users[1]!.user_id, // 20 comments
      users[0]!.user_id, // 10 comments
    ]);

    // Enter on the thread_count button.  Re-orders by thread_count desc
    // → [users[0] (50), users[2] (20), users[1] (10)] which is a
    // different sequence from the comment_count default.
    const threadBtn = container.querySelector<HTMLButtonElement>(
      '.comments-reviewer-density-sort-btn[data-sort-metric="thread_count"]',
    );
    expect(threadBtn).not.toBeNull();
    threadBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    const afterEnter = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(afterEnter).toEqual([
      users[0]!.user_id, // 50 threads
      users[2]!.user_id, // 20 threads
      users[1]!.user_id, // 10 threads
    ]);

    // Space on the active_thread_count button.  Re-orders by
    // active_thread_count desc → [users[1] (8), users[0] (5), users[2]
    // (3)] which is DISTINCT from BOTH the comment_count default and
    // the thread_count Enter ordering — so an inert Space handler
    // would leave the rows in their thread_count order and the
    // assertion would fail loudly.
    const activeBtn = container.querySelector<HTMLButtonElement>(
      '.comments-reviewer-density-sort-btn[data-sort-metric="active_thread_count"]',
    );
    expect(activeBtn).not.toBeNull();
    activeBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    const afterSpace = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(afterSpace).toEqual([
      users[1]!.user_id, // 8 active
      users[0]!.user_id, // 5 active
      users[2]!.user_id, // 3 active
    ]);
    // Final invariant: the post-Space ordering MUST differ from the
    // post-Enter ordering — direct proof Space activation actually
    // fired and was not silently masked by a sibling re-render path.
    expect(afterSpace).not.toEqual(afterEnter);
    // And the active button's aria-pressed reflects the Space
    // activation (FR-4-10 keyboard parity with click).
    const checkedBtn = container.querySelector(
      '.comments-reviewer-density-sort-btn[aria-pressed="true"]',
    );
    expect(checkedBtn?.getAttribute("data-sort-metric")).toBe(
      "active_thread_count",
    );
  });

  it("(P7-e) FR-4-07 filter-not-supported empty state fires when any dimension filter is active", () => {
    // Codex stop-hook regression coverage: without this branch
    // (introduced after T026 dashboard wiring), filter-active rollups
    // pass through ``buildFilteredRollup`` with by_reviewer_comments
    // unchanged, so the chart would render unfiltered totals while the
    // rest of the dashboard reflects filters — silently lying to the
    // user.  The chart MUST render the filter-not-supported empty
    // state instead.
    //
    // This micro-test is the partial-branches covering test that
    // makes the new empty-state branch reachable from the test corpus.
    // Full T031 cross-state-exclusion + per-dimension iteration tests
    // land in the dedicated filter-posture slice; this asserts only
    // the minimum surface needed to exercise the branch.
    const users = buildUsersDimension(2);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      buckets[u.user_id] = makeBucket(2, 5, 1);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: { repos: ["repo-x"], teams: [], reviewers: [], authors: [] },
      usersDimension: users,
    });
    // No rows render under active filter.
    expect(
      container.querySelectorAll(".comments-reviewer-density-row").length,
    ).toBe(0);
    // Filter-not-supported wording present (renderNoData heading
    // contains "filterable" — the FR-4-07 message hook).
    expect(container.textContent?.toLowerCase() ?? "").toContain("filterable");
  });

  it("(P7-f) delegated sort handlers ignore non-button + invalid-metric + non-Enter/Space events", () => {
    // The chart's click + keydown handlers attach at the container
    // level (delegated).  They contain five defensive guards that only
    // fire on edge-case events (lines 321 / 323 / 333 / 335 / 337):
    //   - findSortButton returns null when the event's target has no
    //     .comments-reviewer-density-sort-btn ancestor (covers click +
    //     keydown).
    //   - resolveMetric returns undefined when data-sort-metric does
    //     not map to a known metric (covers click + keydown).
    //   - keydown checks key !== "Enter" && key !== " " (covers other
    //     keys like Tab / Escape).
    // ONE test exercises all five branches by dispatching crafted
    // events and asserting the chart does NOT re-render — the active
    // metric and aria-pressed indicator stay on the default
    // comment_count throughout (mirrors #335's P7-c at
    // comments-repository-density.test.ts:1026-1100).
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u, i) => {
      buckets[u.user_id] = makeBucket(2, 50 - i, 1);
    });
    renderCommentsReviewerDensityChart(container, [makeRollup(0, buckets)], {
      filters: emptyFilters(),
      usersDimension: users,
    });

    // Sanity: the default comment_count button is initially active.
    const initialActive = container.querySelector(
      '.comments-reviewer-density-sort-btn[aria-pressed="true"]',
    );
    expect(initialActive?.getAttribute("data-sort-metric")).toBe(
      "comment_count",
    );
    const initialOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));

    // 1. Click on the chart container itself (no button ancestor).
    //    findSortButton returns null → click handler returns early
    //    (line 321).
    container.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // 2. Click on a button whose data-sort-metric is mutated to an
    //    unknown value.  resolveMetric returns undefined → click
    //    handler returns early (line 323).
    const threadBtn = container.querySelector<HTMLButtonElement>(
      '.comments-reviewer-density-sort-btn[data-sort-metric="thread_count"]',
    );
    expect(threadBtn).not.toBeNull();
    threadBtn?.setAttribute("data-sort-metric", "not-a-real-metric");
    threadBtn?.click();
    threadBtn?.setAttribute("data-sort-metric", "thread_count");

    // 3. Keydown on the chart container itself (no button ancestor).
    //    findSortButton returns null → keydown handler returns early
    //    (line 333).
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    // 4. Keydown with a non-Enter/Space key on a real button (line
    //    335).
    threadBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );

    // 5. Keydown with valid key but mutated invalid metric (line 337).
    threadBtn?.setAttribute("data-sort-metric", "still-not-a-real-metric");
    threadBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    threadBtn?.setAttribute("data-sort-metric", "thread_count");

    // After all 5 defensive paths fired (each returning early), the
    // chart should still be on the original sort metric — no
    // re-render happened.  The aria-pressed indicator MUST still
    // mark comment_count as active.
    const finalActive = container.querySelector(
      '.comments-reviewer-density-sort-btn[aria-pressed="true"]',
    );
    expect(finalActive?.getAttribute("data-sort-metric")).toBe("comment_count");
    // And the row order is unchanged from the initial render —
    // proves no defensive path leaked into a real activate() call.
    const finalOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".comments-reviewer-density-row"),
    ).map((r) => r.getAttribute("data-reviewer-key"));
    expect(finalOrder).toEqual(initialOrder);
  });

  // ===========================================================================
  // T031 (US5): filter-posture matrix.
  //
  // When ANY of the dashboard's per-PR dimension filters
  // (repos / teams / authors / reviewers) is active, the chart MUST
  // render a self-explanatory empty state instead of rows.  The empty
  // state MUST be visibly distinct from the no-data-in-range empty
  // state (FR-4-08) AND MUST disappear cleanly when filters are
  // cleared.  Existing P7-e provides single-dimension partial-branches
  // coverage; T031 extends to the full matrix per the kickoff
  // directive.
  //
  // Marker constants FILTER_STATE_UNIQUE_MARKERS /
  // NODATA_STATE_UNIQUE_MARKERS were forward-defined at the top of
  // the file in the T020 chart MVP slice; T031-c uses them in the
  // exhaustive cross-state-exclusion loop pattern adopted from #335
  // (memory feedback_atomic_crossfile_sweep_before_edit.md — keep
  // drift-prone enumerations in one place).  3 tests; floor delta
  // measured by test:coverage (not assumed).
  // ===========================================================================

  it("(T031-a) any of the four dimension filters (repos / teams / authors / reviewers) triggers filter-not-supported", () => {
    // Same data fixture across all four sub-iterations so the filter
    // dimension is the sole independent variable.  If any of the four
    // filter slots is non-empty → the chart MUST render the
    // filter-not-supported empty state, NOT the rows the data alone
    // would produce.  Locks FR-4-07's "ANY" contract — a future
    // refactor that narrowed the gate to a subset of dimensions would
    // surface here.  Mirrors #335's T026-a iteration shape.
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      buckets[u.user_id] = makeBucket(2, 5, 1);
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
        filters: {
          repos: [],
          teams: [],
          reviewers: [],
          authors: ["user-x"],
        },
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
      renderCommentsReviewerDensityChart(container, rollups, {
        filters,
        usersDimension: users,
      });

      // No rows under any active filter — the data fixture would
      // otherwise produce 3 rows.
      const rows = container.querySelectorAll(".comments-reviewer-density-row");
      expect(rows).toHaveLength(0);
      // Filter-not-supported message present (text owned by
      // renderNoData; the chart's filter short-circuit message
      // contains "filterable").
      expect(container.textContent?.toLowerCase() ?? "").toContain(
        "filterable",
      );
      // And the no-data-in-range message is NOT present — that's the
      // sibling empty state for capability-on + no contributions,
      // gated separately (case (l) above).
      expect(container.textContent?.toLowerCase() ?? "").not.toContain(
        "no comments data",
      );
      // Diagnostic: per-iteration error identifies which dimension
      // regressed if the chart accidentally rendered rows under a
      // specific filter.
      if (rows.length !== 0) {
        throw new Error(
          `filter dimension "${name}" did not trigger the filter-not-` +
            `supported empty state; rendered ${rows.length} data rows`,
        );
      }
    }
  });

  it("(T031-b) clearing the filter restores the rows", () => {
    const users = buildUsersDimension(3);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u, i) => {
      buckets[u.user_id] = makeBucket(2, 10 - i, 1);
    });
    const rollups = [makeRollup(0, buckets)];

    // Step 1: filter active → rows absent (filter-not-supported).
    renderCommentsReviewerDensityChart(container, rollups, {
      filters: { repos: ["repo-x"], teams: [], reviewers: [], authors: [] },
      usersDimension: users,
    });
    expect(
      container.querySelectorAll(".comments-reviewer-density-row").length,
    ).toBe(0);
    expect(container.textContent?.toLowerCase() ?? "").toContain("filterable");

    // Step 2: filters cleared (same container, same data) → rows
    // restored.  Verifies the empty state disappears cleanly when
    // filters are cleared (FR-4-07 second-half contract).
    renderCommentsReviewerDensityChart(container, rollups, {
      filters: emptyFilters(),
      usersDimension: users,
    });
    const rowsAfterClear = container.querySelectorAll(
      ".comments-reviewer-density-row",
    );
    expect(rowsAfterClear).toHaveLength(3);
    // The "filterable" message is gone — the chart's render path
    // is on the rows path now, not the empty-state path.
    expect(container.textContent?.toLowerCase() ?? "").not.toContain(
      "filterable",
    );
  });

  it("(T031-c) filter-not-supported empty state is visibly distinct from no-data-in-range", () => {
    // FULL CROSS-STATE EXCLUSION using the forward-defined marker
    // constants.  Each state's heading + hint paragraph is queried
    // SEPARATELY (per A-14 kickoff lesson — mirroring the way
    // renderNoData splits content across .no-data + .no-data-hint).
    // The cross-state exclusion loop iterates the FULL marker list
    // for each state, catching any future text rewrite that
    // accidentally introduced an other-state marker into the wrong
    // state.  Mirrors #335's T026-c at
    // comments-repository-density.test.ts:845-958.
    const users = buildUsersDimension(2);
    const buckets: Record<string, ReviewerBucket> = {};
    users.forEach((u) => {
      buckets[u.user_id] = makeBucket(1, 5, 0);
    });
    const dataRollups = [makeRollup(0, buckets)];

    // Filter-not-supported state.
    renderCommentsReviewerDensityChart(container, dataRollups, {
      filters: { repos: ["repo-x"], teams: [], reviewers: [], authors: [] },
      usersDimension: users,
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
    // ... filters") MUST be present so a hint rewrite that dropped
    // the user-action surfaces here.
    expect(filterHintText).toContain("clear");
    expect(filterHintText).toContain("filters");

    // FULL CROSS-STATE EXCLUSION: no NODATA marker may appear in
    // EITHER paragraph of the filter state.  Iterating the full
    // marker list catches any future text rewrite that introduced a
    // no-data marker into the filter state.
    for (const marker of NODATA_STATE_UNIQUE_MARKERS) {
      expect(filterHeadingText).not.toContain(marker);
      expect(filterHintText).not.toContain(marker);
    }

    // Reset + render the no-data-in-range path (rollups have no
    // by_reviewer_comments emission; filters cleared).
    container.innerHTML = "";
    renderCommentsReviewerDensityChart(
      container,
      [makeRollup(0, undefined), makeRollup(1, undefined)],
      {
        filters: emptyFilters(),
        usersDimension: users,
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
    // remediation MUST surface either widening the range or
    // confirming extraction (at least one of the two markers).  A
    // hint rewrite that dropped both actions surfaces here.
    expect(
      nodataHintText.includes("widening") ||
        nodataHintText.includes("extraction"),
    ).toBe(true);

    // FULL CROSS-STATE EXCLUSION: no FILTER marker may appear in
    // EITHER paragraph of the no-data state.  Iterating the full
    // marker list catches any future text rewrite that introduced a
    // filter marker into the no-data state.
    for (const marker of FILTER_STATE_UNIQUE_MARKERS) {
      expect(nodataHeadingText).not.toContain(marker);
      expect(nodataHintText).not.toContain(marker);
    }

    // Final invariants: heading AND hint texts differ at the
    // paragraph level between the two states.  Direct proof of
    // FR-4-07 / FR-4-08 visible-distinctness at BOTH paragraph
    // granularities.
    expect(filterHeadingText).not.toBe(nodataHeadingText);
    expect(filterHintText).not.toBe(nodataHintText);
  });
});
