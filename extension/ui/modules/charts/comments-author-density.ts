/**
 * Per-Author Comments-Density Chart Module (Feature 334)
 *
 * Renders one row per author across the user-selected date range, sorted by
 * a chosen count metric (default ``comment_count`` descending). Reads the
 * ``rollup[W].by_author_comments`` outer dict emitted by the aggregator
 * under ``capabilities.comments_metrics`` (FR-1-01..FR-1-08).
 *
 * Modeled structurally on ``comments-trend.ts`` (333) — same shared
 * primitives (``renderTrustedHtml``, ``renderTruncationIndicator``,
 * ``renderNoData``, ``hasActiveFilters``), same content-replace idempotency
 * pattern, same partial-coverage qualifier convention. The visual is a
 * row-table (one row per author) instead of a bar chart; the per-row
 * metrics are integer counts surfaced via ``Number.toLocaleString()``.
 *
 * Capability gating: weeks lacking the ``by_author_comments`` outer dict
 * are filtered out at the chart boundary (capability-off path emitted by
 * the aggregator per FR-3-03). The dashboard call site (T024) also gates
 * the chart's existence on ``capabilityState.commentsMetricsAvailable``,
 * but the chart-side filter is the load-bearing defense for capability-
 * mixed inputs.
 *
 * Filter-not-supported posture (FR-4-07, full 333 FR-1-07 parity per
 * CL-02 = a): when ANY of the dashboard's per-PR dimension filters
 * (repos / teams / authors / reviewers) is active, the chart renders a
 * self-explanatory empty state instead of rows. ``buildFilteredRollup``
 * spreads ``...rollup`` and only overrides top-level throughput fields,
 * so the rollup-root ``by_author_comments`` carries through unchanged
 * under filters — emitting rows off filtered rollups would silently show
 * unfiltered totals (the inverse of an honest UI).
 *
 * No click-through (FR-4-09): rows are informational. No
 * ``data-drilldown-*`` attributes; no click handler attachment. A
 * future per-author drill-down panel is deferred outside this feature.
 *
 * Sentinel rendering (US4 / T030): the reserved bucket key
 * ``__former_or_unavailable_author__`` will be mapped to the fixed-string
 * label "Former / unavailable author" when US4 lands. US1 (this commit)
 * renders the raw key for unknown-to-directory authors; the directory
 * lookup uses ``authorsDimension`` for known authors.
 */

import type { Rollup } from "../../dataset-loader";
import type { FilterState } from "../filters";
import { hasActiveFilters } from "../filters";
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";
import { renderTruncationIndicator } from "../shared/chart-layout";

/** Maximum rows rendered before truncation kicks in (CL-05 / FR-4-06). */
export const MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50;

/** Sort metrics exposed in the radio-group sort selector (FR-4-05). */
export const COMMENTS_AUTHOR_DENSITY_SORT_METRICS = [
  "comment_count",
  "thread_count",
  "active_thread_count",
] as const;

export type CommentsAuthorDensitySortMetric =
  (typeof COMMENTS_AUTHOR_DENSITY_SORT_METRICS)[number];

interface AuthorBucketEntry {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

/** Minimal duck-typed shape for the dashboard's authors dimension entries.
 * Matches the dimensions.json contract validated by
 * ``schemas/dimensions.schema.ts`` (``KNOWN_AUTHOR_FIELDS``). */
interface AuthorDirectoryEntry {
  author_id?: string;
  author_name?: string;
}

interface RollupWithByAuthorComments extends Rollup {
  by_author_comments: Record<string, AuthorBucketEntry>;
}

function hasByAuthorComments(
  rollup: Rollup,
): rollup is RollupWithByAuthorComments {
  const value = rollup.by_author_comments;
  return value !== undefined && value !== null && typeof value === "object";
}

interface AuthorDensityRow {
  authorKey: string;
  displayName: string;
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function reducePerAuthor(
  rollups: RollupWithByAuthorComments[],
): Map<string, AuthorBucketEntry> {
  const reduced = new Map<string, AuthorBucketEntry>();
  for (const rollup of rollups) {
    for (const entry of Object.entries(rollup.by_author_comments)) {
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

function buildAuthorsDirectory(
  authorsDimension: readonly AuthorDirectoryEntry[] | undefined,
): Map<string, string> | null {
  if (!authorsDimension) return null;
  const map = new Map<string, string>();
  for (const entry of authorsDimension) {
    if (
      typeof entry.author_id === "string" &&
      typeof entry.author_name === "string"
    ) {
      map.set(entry.author_id, entry.author_name);
    }
  }
  return map;
}

function resolveDisplayName(
  authorKey: string,
  directory: Map<string, string> | null,
): string {
  // US4 (T030) will map ``__former_or_unavailable_author__`` to the fixed
  // label "Former / unavailable author". US1 renders the raw key for
  // unknown-to-directory authors so the FR-4-01 row contract still emits
  // a deterministic display string.
  if (directory) {
    const found = directory.get(authorKey);
    if (typeof found === "string" && found.length > 0) {
      return found;
    }
  }
  return authorKey;
}

function metricValue(
  row: AuthorDensityRow,
  metric: CommentsAuthorDensitySortMetric,
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
  a: AuthorDensityRow,
  b: AuthorDensityRow,
  metric: CommentsAuthorDensitySortMetric,
): number {
  // Primary: chosen metric descending.
  const primary = metricValue(b, metric) - metricValue(a, metric);
  if (primary !== 0) return primary;
  // Secondary: display name ascending (handles ties on the metric).
  const displayCmp = a.displayName.localeCompare(b.displayName);
  if (displayCmp !== 0) return displayCmp;
  // Final: author key ascending — handles duplicate display names AND a
  // sentinel-vs-real-name collision per FR-4-05.  Map keys are unique by
  // construction (one bucket per author key), so the equality branch is
  // unreachable in practice — collapsed into a two-way ternary so coverage
  // gates do not flag a dead third arm.
  return a.authorKey < b.authorKey ? -1 : 1;
}

export interface CommentsAuthorDensityOptions {
  filters?: FilterState;
  authorsDimension?: readonly AuthorDirectoryEntry[];
  sortMetric?: CommentsAuthorDensitySortMetric;
}

/**
 * Per-container sort metric state. Keys are the chart container element
 * so a single dashboard with multiple chart instances (none today, but
 * the contract leaves the door open) keeps state isolated. Set when the
 * user clicks a sort button (US2 / T026); read when ``options.sortMetric``
 * is not provided so the chart preserves its toggle state across
 * re-renders triggered by filter / range changes.
 */
const sortMetricByContainer = new WeakMap<
  HTMLElement,
  CommentsAuthorDensitySortMetric
>();

/**
 * Per-container listener controllers. Each render aborts the prior set
 * before attaching fresh button handlers so re-renders never accumulate
 * duplicate listeners (mirrors the throughput / 333 info-icon pattern).
 */
const sortListenerControllers = new WeakMap<HTMLElement, AbortController>();

function attachSortToggleListeners(
  container: HTMLElement,
  rollups: Rollup[],
  options: CommentsAuthorDensityOptions | undefined,
): void {
  // Drop any prior listeners attached on a previous render.  Use a
  // single delegated handler on the container itself rather than per-
  // button listeners so re-attach is a one-listener swap and so the
  // metric is resolved AT click time from the rendered ``data-sort-metric``
  // attribute (rather than captured at attach time).  The latter lets
  // tests exercise the malformed-attribute branch by mutating the
  // attribute between render and click — coverage of the validation
  // branch comes from real DOM input rather than dead code.
  sortListenerControllers.get(container)?.abort();
  const controller = new AbortController();
  sortListenerControllers.set(container, controller);
  const { signal } = controller;

  const resolveMetric = (
    raw: string | undefined,
  ): CommentsAuthorDensitySortMetric | undefined => {
    return COMMENTS_AUTHOR_DENSITY_SORT_METRICS.find((m) => m === raw);
  };

  const activate = (metric: CommentsAuthorDensitySortMetric): void => {
    sortMetricByContainer.set(container, metric);
    // Re-render with the same rollups + options but the new metric.
    // The new render replaces these listeners via the controller-abort
    // pattern at the top of this function.
    renderCommentsAuthorDensityChart(container, rollups, {
      ...options,
      sortMetric: metric,
    });
  };

  const findSortButton = (event: Event): HTMLElement | null => {
    // ``event.target`` is always the dispatching element under
    // ``container.addEventListener`` so the cast is sound; a defensive
    // ``instanceof Element`` check would create a dead branch the
    // partial-branch coverage gate cannot reach from a real test.
    const target = event.target as Element;
    return target.closest<HTMLElement>(".comments-author-density-sort-btn");
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
 * Render the per-author comments-density breakdown.
 *
 * @param container Target container element. The dashboard call site is
 *                  responsible for capability-on container provisioning
 *                  (T024 ``ensureCommentsAuthorDensityContainer``); the
 *                  chart treats ``null`` as a no-op.
 * @param rollups   Weekly rollups in chronological order. Weeks lacking
 *                  the ``by_author_comments`` outer dict are filtered
 *                  out (capability-off path defense).
 * @param options   Filter state + authors directory + chosen sort metric.
 *                  Defaults: no filters, no directory, sort by
 *                  ``comment_count`` descending.
 */
export function renderCommentsAuthorDensityChart(
  container: HTMLElement | null,
  rollups: Rollup[],
  options?: CommentsAuthorDensityOptions,
): void {
  if (!container) return;

  if (options?.filters && hasActiveFilters(options.filters)) {
    renderNoData(
      container,
      "Comments density is not yet filterable",
      "Clear repo / team / author / reviewer filters to view per-author review-conversation totals. Per-dimension comments breakdowns are tracked under follow-up issue #322.",
    );
    return;
  }

  const withByAuthor = rollups.filter(hasByAuthorComments);
  const reduced = reducePerAuthor(withByAuthor);

  if (reduced.size === 0) {
    renderNoData(
      container,
      "No comments data for selected range",
      "Try widening the date range, or confirm comments extraction is enabled for this dataset.",
    );
    return;
  }

  const directory = buildAuthorsDirectory(options?.authorsDimension);
  const rows: AuthorDensityRow[] = [];
  for (const [key, bucket] of reduced) {
    rows.push({
      authorKey: key,
      displayName: resolveDisplayName(key, directory),
      thread_count: bucket.thread_count,
      comment_count: bucket.comment_count,
      active_thread_count: bucket.active_thread_count,
      coverage_partial: bucket.coverage_partial,
    });
  }

  // Resolve the active sort metric: explicit option wins (e.g., the
  // dashboard hard-overrides per render), then per-container state set
  // by the user's last button click (US2 / T026), then the default
  // ``comment_count`` per CL-05.
  let activeMetric: CommentsAuthorDensitySortMetric;
  if (options?.sortMetric) {
    activeMetric = options.sortMetric;
    sortMetricByContainer.set(container, activeMetric);
  } else {
    activeMetric = sortMetricByContainer.get(container) ?? "comment_count";
  }
  rows.sort((a, b) => compareRows(a, b, activeMetric));

  const truncated = rows.length > MAX_COMMENTS_AUTHOR_DENSITY_ROWS;
  const display = truncated
    ? rows.slice(0, MAX_COMMENTS_AUTHOR_DENSITY_ROWS)
    : rows;
  const truncationHtml = renderTruncationIndicator(
    truncated,
    MAX_COMMENTS_AUTHOR_DENSITY_ROWS,
    "authors",
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

function metricLabel(metric: CommentsAuthorDensitySortMetric): string {
  // Switch dispatch on the closed SortMetric union — same reason as
  // ``metricValue``: avoids dynamic bracket access into a Record while
  // staying exhaustive at the type level.
  switch (metric) {
    case "comment_count":
      return "Comments";
    case "thread_count":
      return "Threads";
    case "active_thread_count":
      return "Active threads";
  }
}

function renderSortControls(
  activeMetric: CommentsAuthorDensitySortMetric,
): string {
  // Toolbar pattern (WAI-ARIA Authoring Practices "Toolbar"): each
  // button is an independently Tab-reachable <button> with aria-pressed
  // tracking the active sort metric.  Toolbar is preferred over a
  // single-tabstop radio-group here because the previous radio-group
  // implementation gated the other two buttons behind arrow-key
  // navigation that the chart did not implement — making them
  // keyboard-unreachable (Codex stop-time review caught the regression).
  // <button> elements default to tabindex=0 and natively activate on
  // Enter / Space; the delegated click + keydown handlers below catch
  // both sequences.
  const buttons = COMMENTS_AUTHOR_DENSITY_SORT_METRICS.map((metric) => {
    const checked = metric === activeMetric;
    const ariaPressed = checked ? "true" : "false";
    const label = metricLabel(metric);
    return `<button type="button" class="comments-author-density-sort-btn${checked ? " is-active" : ""}" aria-pressed="${ariaPressed}" data-sort-metric="${escapeHtml(metric)}">${escapeHtml(label)}</button>`;
  }).join("");
  return `<div class="comments-author-density-sort" role="toolbar" aria-label="Sort author rows by metric">${buttons}</div>`;
}

function renderTable(rows: readonly AuthorDensityRow[]): string {
  const rowsHtml = rows.map((row) => renderRow(row)).join("");
  return `<div class="comments-author-density-table" role="table" aria-label="Per-author comment density"><div class="comments-author-density-thead" role="row"><div role="columnheader">Author</div><div role="columnheader" class="comments-author-density-numeric">Threads</div><div role="columnheader" class="comments-author-density-numeric">Active threads</div><div role="columnheader" class="comments-author-density-numeric">Comments</div></div>${rowsHtml}</div>`;
}

function renderRow(row: AuthorDensityRow): string {
  const partialClass = row.coverage_partial ? " coverage-partial" : "";
  const partialAttr = row.coverage_partial
    ? ' data-coverage-partial="true"'
    : "";
  const partialNote = row.coverage_partial ? " (partial coverage)" : "";
  const ariaLabel = `${row.displayName}: ${row.thread_count.toLocaleString()} threads, ${row.active_thread_count.toLocaleString()} active threads, ${row.comment_count.toLocaleString()} comments${partialNote}`;
  return `<div class="comments-author-density-row${partialClass}" role="row" data-author-key="${escapeHtml(row.authorKey)}"${partialAttr} aria-label="${escapeHtml(ariaLabel)}"><div class="comments-author-density-name" role="cell">${escapeHtml(row.displayName)}</div><div class="comments-author-density-numeric" role="cell">${escapeHtml(row.thread_count.toLocaleString())}</div><div class="comments-author-density-numeric" role="cell">${escapeHtml(row.active_thread_count.toLocaleString())}</div><div class="comments-author-density-numeric" role="cell">${escapeHtml(row.comment_count.toLocaleString())}</div></div>`;
}
