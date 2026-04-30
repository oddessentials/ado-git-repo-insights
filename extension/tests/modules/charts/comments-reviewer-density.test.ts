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
    expect(
      titleText.includes("week") || titleText.includes("weekly"),
    ).toBe(true);
    expect(
      ariaLabel.includes("week") || ariaLabel.includes("weekly"),
    ).toBe(true);
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
        r.getAttribute("data-reviewer-key") ===
        "user-orphan-uuid-not-in-dim",
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
});
