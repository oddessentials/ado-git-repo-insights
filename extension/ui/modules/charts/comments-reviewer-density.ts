/**
 * Per-Reviewer Comments-Density Chart Module (Feature 336)
 *
 * Renders one row per reviewer (commenter) across the user-selected date
 * range, sorted by a chosen count metric (default ``comment_count``
 * descending).  Reads the ``rollup[W].by_reviewer_comments`` outer dict
 * emitted by the aggregator under ``capabilities.comments_metrics``
 * (FR-1-01..FR-1-12).
 *
 * Modeled directly on ``comments-repository-density.ts`` (Feature 335) +
 * ``comments-author-density.ts`` (Feature 334) — same shared primitives
 * (``renderTrustedHtml``, ``renderTruncationIndicator``, ``renderNoData``),
 * same content-replace idempotency pattern, same partial-coverage qualifier
 * convention.  The visual is a row-table (one row per reviewer) with
 * integer counts surfaced via ``Number.toLocaleString()``.
 *
 * Capability gating: weeks lacking the ``by_reviewer_comments`` outer
 * dict are filtered out at the chart boundary (capability-off path emitted
 * by the aggregator per FR-3-03).  The dashboard call site (later slice)
 * also gates the chart's existence on
 * ``capabilityState.commentsMetricsAvailable``, but the chart-side filter
 * is the load-bearing defense for capability-mixed inputs.
 *
 * Sort-toggle wiring (FR-4-05): three keyboard-reachable <button>s with
 * aria-pressed tracking the active metric.  Click + keydown (Enter /
 * Space) handlers update the per-container metric state and re-render
 * the chart.  Per-container state is held in ``sortMetricByContainer``
 * (a WeakMap keyed on the container element) so the chart preserves
 * its toggle selection across re-renders triggered by filter / range
 * changes.  Listeners are tracked in ``sortListenerControllers`` so
 * each render aborts the prior set before attaching fresh handlers
 * (mirrors 333 / 334 / 335 info-icon + sort-handler pattern).
 *
 * Filter-not-supported posture (FR-4-07, full 333 / 334 / 335 parity):
 * when ANY of the dashboard's per-PR dimension filters
 * (repos / teams / authors / reviewers) is active, the chart renders
 * a self-explanatory empty state instead of rows.  ``buildFilteredRollup``
 * spreads ``...rollup`` and only overrides top-level throughput fields,
 * so the rollup-root ``by_reviewer_comments`` carries through unchanged
 * under filters — emitting rows off filtered rollups would silently
 * show unfiltered totals (the inverse of an honest UI).
 *
 * No click-through (FR-4-09): rows are informational.  No
 * ``data-drilldown-*`` attributes; no click handler attachment.
 *
 * Display label resolution (CL-05 / FR-4-11 / FR-4-12): three-step
 * precedence:
 *   1. Sentinel branch — the reserved literal
 *      ``__former_or_unavailable_author__`` always renders the fixed
 *      label "Former / unavailable author" (FR-4-12), regardless of
 *      whether ``usersDimension`` happens to contain an entry under the
 *      literal key (defensive — the producer guarantees no collision per
 *      A-07, but the renderer keeps the contract one-sided).
 *   2. ``usersDimension`` lookup → ``display_name``.
 *   3. Raw-``user_id`` fallback (FR-4-11) when the dimension entry is
 *      missing.
 * Sentinel concept APPLIES for this dimension (CL-03 / INV-4-12 —
 * divergence from #335's FK-protected no-sentinel posture).
 */

import type { Rollup } from "../../dataset-loader";
import type { FilterState } from "../filters";
import { hasActiveFilters } from "../filters";
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";
import { renderTruncationIndicator } from "../shared/chart-layout";

/** Maximum rows rendered before truncation kicks in (CL-06 / FR-4-06). */
export const MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50;

/**
 * Reserved aggregator-side bucket key for ALL pr_comments rows whose
 * ``author_id`` is absent from the ``users`` table per Feature 336
 * CL-03 / INV-4-12 / FR-1-03.  The canonical Python constant lives at
 * ``src/ado_git_repo_insights/transform/constants.py:27`` and the
 * literal ``"__former_or_unavailable_author__"`` is the producer /
 * consumer contract.  The literal is hard-coded here rather than
 * imported from a shared module so the extension chart bundle does not
 * couple to the transform package.  Drift between the two is gated by
 * the existing #334 / #336 sentinel-collision-safety scan in
 * ``tests/unit/test_aggregators_author_comments.py`` (the T029
 * extension widens the assertion list to include reviewer-key
 * namespaces per #336 kickoff directive).
 */
const FORMER_OR_UNAVAILABLE_AUTHOR_KEY = "__former_or_unavailable_author__";

/**
 * Renderer-side label for the sentinel bucket per CL-03 / cross-feature
 * consistency directive.  Reuses #334's English-only label literal
 * verbatim — NOT a new "Former / unavailable reviewer" string — so the
 * fixed-string surface is identical across per-author + per-reviewer
 * dimensions.  Localization deferred (out of scope per the Feature 336
 * spec).
 */
const FORMER_OR_UNAVAILABLE_AUTHOR_LABEL = "Former / unavailable author";

/** Sort metrics exposed in the WAI-ARIA toolbar sort selector (FR-4-05). */
export const COMMENTS_REVIEWER_DENSITY_SORT_METRICS = [
  "comment_count",
  "thread_count",
  "active_thread_count",
] as const;

export type CommentsReviewerDensitySortMetric =
  (typeof COMMENTS_REVIEWER_DENSITY_SORT_METRICS)[number];

interface ReviewerBucketEntry {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

/** Minimal duck-typed shape for the dashboard's users dimension entries.
 * Matches the dimensions.json contract validated by
 * ``schemas/dimensions.schema.ts`` (``UserEntry``: ``user_id`` +
 * ``display_name`` per ``dimensions.schema.ts:57``). */
interface UserDirectoryEntry {
  user_id?: string;
  display_name?: string;
}

interface RollupWithByReviewerComments extends Rollup {
  by_reviewer_comments: Record<string, ReviewerBucketEntry>;
}

function hasByReviewerComments(
  rollup: Rollup,
): rollup is RollupWithByReviewerComments {
  const value = rollup.by_reviewer_comments;
  return value !== undefined && value !== null && typeof value === "object";
}

interface ReviewerDensityRow {
  reviewerKey: string;
  displayName: string;
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function reducePerReviewer(
  rollups: RollupWithByReviewerComments[],
): Map<string, ReviewerBucketEntry> {
  const reduced = new Map<string, ReviewerBucketEntry>();
  for (const rollup of rollups) {
    for (const entry of Object.entries(rollup.by_reviewer_comments)) {
      const key = entry[0];
      const bucket = entry[1];
      const existing = reduced.get(key);
      if (existing) {
        existing.thread_count += bucket.thread_count;
        existing.comment_count += bucket.comment_count;
        existing.active_thread_count += bucket.active_thread_count;
        existing.coverage_partial =
          existing.coverage_partial || bucket.coverage_partial;
      } else {
        reduced.set(key, {
          thread_count: bucket.thread_count,
          comment_count: bucket.comment_count,
          active_thread_count: bucket.active_thread_count,
          coverage_partial: bucket.coverage_partial,
        });
      }
    }
  }
  return reduced;
}

function buildUsersDirectory(
  usersDimension: readonly UserDirectoryEntry[] | undefined,
): Map<string, string> | null {
  if (!usersDimension) return null;
  const map = new Map<string, string>();
  for (const entry of usersDimension) {
    if (
      typeof entry.user_id === "string" &&
      typeof entry.display_name === "string"
    ) {
      map.set(entry.user_id, entry.display_name);
    }
  }
  return map;
}

function resolveDisplayName(
  reviewerKey: string,
  directory: Map<string, string> | null,
): string {
  // CL-05 step 1 (highest precedence): sentinel branch.  The reserved
  // literal always renders the fixed-string label REGARDLESS of whether
  // ``usersDimension`` happens to contain an entry under the literal
  // key (defensive — the producer guarantees no collision per A-07,
  // but the renderer keeps the contract one-sided so a future fixture
  // drift cannot mask a real reviewer row as the sentinel or vice
  // versa).
  if (reviewerKey === FORMER_OR_UNAVAILABLE_AUTHOR_KEY) {
    return FORMER_OR_UNAVAILABLE_AUTHOR_LABEL;
  }
  // CL-05 step 2: users-dimension lookup.
  if (directory) {
    const found = directory.get(reviewerKey);
    if (typeof found === "string" && found.length > 0) {
      return found;
    }
  }
  // CL-05 step 3 (FR-4-11): raw-``user_id`` fallback.
  return reviewerKey;
}

function metricValue(
  row: ReviewerDensityRow,
  metric: CommentsReviewerDensitySortMetric,
): number {
  // Switch dispatch on a closed string union avoids dynamic property
  // access (``row[metric]`` would trip security/detect-object-injection)
  // while staying exhaustive over the SortMetric union — adding a new
  // metric without extending this switch is a TS error.
  switch (metric) {
    case "comment_count":
      return row.comment_count;
    case "thread_count":
      return row.thread_count;
    case "active_thread_count":
      return row.active_thread_count;
  }
}

function compareRows(
  a: ReviewerDensityRow,
  b: ReviewerDensityRow,
  metric: CommentsReviewerDensitySortMetric,
): number {
  // Primary: chosen metric descending.
  const primary = metricValue(b, metric) - metricValue(a, metric);
  if (primary !== 0) return primary;
  // Secondary: display name ascending (handles ties on the metric;
  // duplicate display names from rename / fallback collisions per
  // FR-4-05).
  const displayCmp = a.displayName.localeCompare(b.displayName);
  if (displayCmp !== 0) return displayCmp;
  // Final: reviewer key ascending — handles duplicate display names AND
  // sentinel-vs-real-name collision per FR-4-05.  Map keys are unique
  // by construction (one bucket per reviewer key), so the equality
  // branch is unreachable in practice — collapsed into a two-way
  // ternary so the partial-branches ratchet does not flag a dead third
  // arm (mirrors 334 / 335 collapse pattern; spec A-10 /
  // .coverage-partial-branches-baseline.json zero-growth contract).
  return a.reviewerKey < b.reviewerKey ? -1 : 1;
}

export interface CommentsReviewerDensityOptions {
  filters?: FilterState;
  usersDimension?: readonly UserDirectoryEntry[];
  sortMetric?: CommentsReviewerDensitySortMetric;
}

/**
 * Per-container sort metric state.  Keys are the chart container
 * element so a single dashboard with multiple chart instances (none
 * today, but the contract leaves the door open) keeps state isolated.
 * Set when the user clicks a sort button; read when ``options.sortMetric``
 * is not provided so the chart preserves its toggle state across
 * re-renders triggered by filter / range changes.
 */
const sortMetricByContainer = new WeakMap<
  HTMLElement,
  CommentsReviewerDensitySortMetric
>();

/**
 * Per-container listener controllers.  Each render aborts the prior
 * set before attaching fresh button handlers so re-renders never
 * accumulate duplicate listeners (mirrors 333 / 334 / 335 info-icon +
 * sort-handler pattern).
 */
const sortListenerControllers = new WeakMap<HTMLElement, AbortController>();

function attachSortToggleListeners(
  container: HTMLElement,
  rollups: Rollup[],
  options: CommentsReviewerDensityOptions | undefined,
): void {
  // Drop any prior listeners attached on a previous render.  Single
  // delegated handler on the container itself rather than per-button
  // listeners so re-attach is a one-listener swap and so the metric is
  // resolved AT click time from the rendered ``data-sort-metric``
  // attribute — the latter lets tests exercise the malformed-attribute
  // branch by mutating the attribute between render and click.
  sortListenerControllers.get(container)?.abort();
  const controller = new AbortController();
  sortListenerControllers.set(container, controller);
  const { signal } = controller;

  const resolveMetric = (
    raw: string | undefined,
  ): CommentsReviewerDensitySortMetric | undefined => {
    return COMMENTS_REVIEWER_DENSITY_SORT_METRICS.find((m) => m === raw);
  };

  const activate = (metric: CommentsReviewerDensitySortMetric): void => {
    sortMetricByContainer.set(container, metric);
    // Re-render with the same rollups + options but the new metric.
    // The new render replaces these listeners via the controller-abort
    // pattern at the top of this function.
    renderCommentsReviewerDensityChart(container, rollups, {
      ...options,
      sortMetric: metric,
    });
  };

  const findSortButton = (event: Event): HTMLElement | null => {
    const target = event.target as Element;
    return target.closest<HTMLElement>(".comments-reviewer-density-sort-btn");
  };

  container.addEventListener(
    "click",
    (event) => {
      const button = findSortButton(event);
      if (!button) return;
      const metric = resolveMetric(button.dataset.sortMetric);
      if (!metric) return;
      activate(metric);
    },
    { signal },
  );

  container.addEventListener(
    "keydown",
    (event) => {
      const button = findSortButton(event);
      if (!button) return;
      const key = (event as KeyboardEvent).key;
      if (key !== "Enter" && key !== " ") return;
      const metric = resolveMetric(button.dataset.sortMetric);
      if (!metric) return;
      event.preventDefault();
      activate(metric);
    },
    { signal },
  );
}

/**
 * Render the per-reviewer comments-density breakdown.
 *
 * @param container Target container element.  The dashboard call site
 *                  (later slice) is responsible for capability-on
 *                  container provisioning; the chart treats ``null`` as
 *                  a no-op.
 * @param rollups   Weekly rollups in chronological order.  Weeks
 *                  lacking the ``by_reviewer_comments`` outer dict are
 *                  filtered out (capability-off path defense).
 * @param options   Filter state (currently silently unused at this
 *                  scaffold slice — filter-not-supported branch lands
 *                  later) + users directory + chosen sort metric.
 *                  Defaults: no directory, sort by ``comment_count``
 *                  descending.
 */
export function renderCommentsReviewerDensityChart(
  container: HTMLElement | null,
  rollups: Rollup[],
  options?: CommentsReviewerDensityOptions,
): void {
  if (!container) return;

  // FR-4-07 filter-not-supported short-circuit (mirrors 334
  // ``comments-author-density.ts`` and 335 ``comments-repository-
  // density.ts``).  ``buildFilteredRollup`` spreads ``...rollup`` and
  // only overrides top-level throughput fields, so the rollup-root
  // ``by_reviewer_comments`` carries through unchanged under filters
  // — emitting rows off filter-active rollups would silently show
  // unfiltered totals (the inverse of an honest UI).  The chart MUST
  // render a self-explanatory empty state instead.  Per-dimension
  // filtering of comments aggregates is tracked under follow-up
  // issue #322.
  if (options?.filters && hasActiveFilters(options.filters)) {
    renderNoData(
      container,
      "Comments density is not yet filterable",
      "Clear repo / team / author / reviewer filters to view per-reviewer review-conversation totals. Per-dimension comment breakdowns are coming soon.",
    );
    return;
  }

  const withByReviewer = rollups.filter(hasByReviewerComments);
  const reduced = reducePerReviewer(withByReviewer);

  const directory = buildUsersDirectory(options?.usersDimension);
  const rows: ReviewerDensityRow[] = [];
  for (const [key, bucket] of reduced) {
    // FR-4-02: reviewers with zero contributions in the range MUST
    // NOT render — even when their constituent weeks have
    // ``coverage_partial: true``.  The producer can emit all-zero
    // buckets for reviewers whose entire eligible-comment set is
    // unextracted; the renderer suppresses them so the partial-
    // coverage qualifier (FR-4-03) only attaches to RENDERED rows.
    // Zero-contribution = absent.  Filter applied BEFORE sort and
    // truncate so the top-N cap operates on the non-zero set.
    if (
      bucket.thread_count === 0 &&
      bucket.comment_count === 0 &&
      bucket.active_thread_count === 0
    ) {
      continue;
    }
    rows.push({
      reviewerKey: key,
      displayName: resolveDisplayName(key, directory),
      thread_count: bucket.thread_count,
      comment_count: bucket.comment_count,
      active_thread_count: bucket.active_thread_count,
      coverage_partial: bucket.coverage_partial,
    });
  }

  // No-data fall-through merged here so it fires both when the reduced
  // Map is empty (no rollup carries by_reviewer_comments) AND when
  // every bucket is all-zero (every reviewer's range-total contribution
  // is zero — same user-facing signal: "no comments data").
  if (rows.length === 0) {
    renderNoData(
      container,
      "No comments data for selected range",
      "Try widening the date range, or confirm comments extraction is enabled for this dataset.",
    );
    return;
  }

  // Resolve the active sort metric: explicit option wins (e.g., the
  // dashboard hard-overrides per render), then per-container state set
  // by the user's last button click, then the default ``comment_count``
  // per CL-06.
  let activeMetric: CommentsReviewerDensitySortMetric;
  if (options?.sortMetric) {
    activeMetric = options.sortMetric;
    sortMetricByContainer.set(container, activeMetric);
  } else {
    activeMetric = sortMetricByContainer.get(container) ?? "comment_count";
  }
  rows.sort((a, b) => compareRows(a, b, activeMetric));

  const truncated = rows.length > MAX_COMMENTS_REVIEWER_DENSITY_ROWS;
  const display = truncated
    ? rows.slice(0, MAX_COMMENTS_REVIEWER_DENSITY_ROWS)
    : rows;
  const truncationHtml = renderTruncationIndicator(
    truncated,
    MAX_COMMENTS_REVIEWER_DENSITY_ROWS,
    "reviewers",
  );
  const sortControlsHtml = renderSortControls(activeMetric);
  const tableHtml = renderTable(display);
  const anyPartial = display.some((r) => r.coverage_partial);
  const partialLegendHtml = anyPartial
    ? `<div class="chart-legend"><div class="legend-item legend-coverage-partial-item"><span class="legend-bar legend-bar-coverage-partial"></span><span>Partial coverage</span></div></div>`
    : "";

  renderTrustedHtml(
    container,
    `${truncationHtml}${sortControlsHtml}${tableHtml}${partialLegendHtml}`,
  );

  attachSortToggleListeners(container, rollups, options);
}

function metricLabel(metric: CommentsReviewerDensitySortMetric): string {
  // Switch dispatch on the closed SortMetric union — same reason as
  // ``metricValue``: avoids dynamic bracket access into a Record while
  // staying exhaustive at the type level.
  switch (metric) {
    case "comment_count":
      return "Comments";
    case "thread_count":
      return "Threads";
    case "active_thread_count":
      return "Unresolved threads";
  }
}

function renderSortControls(
  activeMetric: CommentsReviewerDensitySortMetric,
): string {
  // WAI-ARIA Toolbar pattern (memory feedback_wai_aria_toolbar_for_keyboard
  // _reachability.md): each button is an independently Tab-reachable
  // <button> with aria-pressed tracking the active sort metric.
  // <button> elements default to tabindex=0 and natively activate on
  // Enter / Space.  The delegated click + keydown handlers in
  // ``attachSortToggleListeners`` catch both sequences and re-render
  // the chart with the new metric.
  const buttons = COMMENTS_REVIEWER_DENSITY_SORT_METRICS.map((metric) => {
    const checked = metric === activeMetric;
    const ariaPressed = checked ? "true" : "false";
    const label = metricLabel(metric);
    return `<button type="button" class="comments-reviewer-density-sort-btn${checked ? " is-active" : ""}" aria-pressed="${ariaPressed}" data-sort-metric="${escapeHtml(metric)}">${escapeHtml(label)}</button>`;
  }).join("");
  return `<div class="comments-reviewer-density-sort" role="toolbar" aria-label="Sort reviewer rows by metric">${buttons}</div>`;
}

function renderTable(rows: readonly ReviewerDensityRow[]): string {
  const rowsHtml = rows.map((row) => renderRow(row)).join("");
  return `<div class="comments-reviewer-density-table" role="table" aria-label="Per-reviewer comments"><div class="comments-reviewer-density-thead" role="row"><div role="columnheader">Reviewer</div><div role="columnheader" class="comments-reviewer-density-numeric">Threads</div><div role="columnheader" class="comments-reviewer-density-numeric">Comments</div><div role="columnheader" class="comments-reviewer-density-numeric">Unresolved</div></div>${rowsHtml}</div>`;
}

function renderRow(row: ReviewerDensityRow): string {
  const partialClass = row.coverage_partial ? " coverage-partial" : "";
  const partialAttr = row.coverage_partial
    ? ' data-coverage-partial="true"'
    : "";
  // Tooltip emphasizes WEEK-LEVEL uncertainty per CL-10 — comment
  // extraction status is recorded per-PR but the partial flag
  // semantically applies to the WEEK as a whole, not to this specific
  // reviewer's bucket.  Bucket-specific text would overstate the data
  // (the reviewer's other-week activity may be fully extracted).
  const partialTitle = row.coverage_partial
    ? ` title="${escapeHtml("This week's comments extraction is partial; reviewer activity may be incomplete")}"`
    : "";
  const partialNote = row.coverage_partial
    ? " (partial week coverage; reviewer activity may be incomplete this week)"
    : "";
  const ariaLabel = `${row.displayName}: ${row.thread_count.toLocaleString()} threads, ${row.comment_count.toLocaleString()} comments, ${row.active_thread_count.toLocaleString()} unresolved threads${partialNote}`;
  return `<div class="comments-reviewer-density-row${partialClass}" role="row" data-reviewer-key="${escapeHtml(row.reviewerKey)}"${partialAttr}${partialTitle} aria-label="${escapeHtml(ariaLabel)}"><div class="comments-reviewer-density-name" role="cell">${escapeHtml(row.displayName)}</div><div class="comments-reviewer-density-numeric" role="cell">${escapeHtml(row.thread_count.toLocaleString())}</div><div class="comments-reviewer-density-numeric" role="cell">${escapeHtml(row.comment_count.toLocaleString())}</div><div class="comments-reviewer-density-numeric" role="cell">${escapeHtml(row.active_thread_count.toLocaleString())}</div></div>`;
}
