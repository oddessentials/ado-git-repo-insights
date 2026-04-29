/**
 * Per-Repo Comments-Density Chart Module (Feature 335)
 *
 * Renders one row per repository across the user-selected date range,
 * sorted by a chosen count metric (default ``comment_count`` descending).
 * Reads the ``rollup[W].by_repository_comments`` outer dict emitted by
 * the aggregator under ``capabilities.comments_metrics`` (FR-1-01..1-10).
 *
 * Modeled directly on ``comments-author-density.ts`` (Feature 334) —
 * same shared primitives (``renderTrustedHtml``, ``renderTruncationIndicator``,
 * ``renderNoData``, ``hasActiveFilters``), same content-replace idempotency
 * pattern, same partial-coverage qualifier convention.  The visual is a
 * row-table (one row per repository) with integer counts surfaced via
 * ``Number.toLocaleString()``.
 *
 * Capability gating: weeks lacking the ``by_repository_comments`` outer
 * dict are filtered out at the chart boundary (capability-off path
 * emitted by the aggregator per FR-3-03).  The dashboard call site (T022)
 * also gates the chart's existence on
 * ``capabilityState.commentsMetricsAvailable``, but the chart-side filter
 * is the load-bearing defense for capability-mixed inputs.
 *
 * Filter-not-supported posture (FR-4-07, full 333 FR-1-07 / 334 FR-4-07
 * parity per CL-02): when ANY of the dashboard's per-PR dimension filters
 * (repos / teams / authors / reviewers) is active, the chart renders a
 * self-explanatory empty state instead of rows.  ``buildFilteredRollup``
 * spreads ``...rollup`` and only overrides top-level throughput fields,
 * so the rollup-root ``by_repository_comments`` carries through unchanged
 * under filters — emitting rows off filtered rollups would silently show
 * unfiltered totals (the inverse of an honest UI).
 *
 * No click-through (FR-4-09): rows are informational.  No
 * ``data-drilldown-*`` attributes; no click handler attachment beyond the
 * sort-selector toolbar.  A future per-repo drill-down panel is deferred
 * outside this feature.
 *
 * Display label resolution (CL-04 / FR-4-11): ``repositoriesDimension``
 * lookup → ``repository_name``; raw-``repository_id`` fallback when the
 * dimension entry is missing.  NO sentinel concept (CL-03 / INV-3-12 —
 * the FK constraint at ``models.py:88`` makes unknown-to-``repositories``
 * IDs impossible in well-formed production data; the producer's pre-flight
 * FK validation raises FAIL-LOUD so the renderer never receives a
 * sentinel-bucketed entry).
 */

import type { Rollup } from "../../dataset-loader";
import type { FilterState } from "../filters";
import { hasActiveFilters } from "../filters";
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";
import { renderTruncationIndicator } from "../shared/chart-layout";

/** Maximum rows rendered before truncation kicks in (CL-06 / FR-4-06). */
export const MAX_COMMENTS_REPO_DENSITY_ROWS = 50;

/** Sort metrics exposed in the WAI-ARIA toolbar sort selector (FR-4-05). */
export const COMMENTS_REPO_DENSITY_SORT_METRICS = [
  "comment_count",
  "thread_count",
  "active_thread_count",
] as const;

export type CommentsRepoDensitySortMetric =
  (typeof COMMENTS_REPO_DENSITY_SORT_METRICS)[number];

interface RepoBucketEntry {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

/** Minimal duck-typed shape for the dashboard's repositories dimension
 * entries.  Matches the dimensions.json contract for the repositories
 * array (each entry has at least ``repository_id`` + ``repository_name``;
 * additional fields are ignored). */
interface RepoDirectoryEntry {
  repository_id?: string;
  repository_name?: string;
}

interface RollupWithByRepositoryComments extends Rollup {
  by_repository_comments: Record<string, RepoBucketEntry>;
}

function hasByRepositoryComments(
  rollup: Rollup,
): rollup is RollupWithByRepositoryComments {
  const value = rollup.by_repository_comments;
  return value !== undefined && value !== null && typeof value === "object";
}

interface RepoDensityRow {
  repositoryId: string;
  displayName: string;
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

function reducePerRepository(
  rollups: RollupWithByRepositoryComments[],
): Map<string, RepoBucketEntry> {
  const reduced = new Map<string, RepoBucketEntry>();
  for (const rollup of rollups) {
    for (const entry of Object.entries(rollup.by_repository_comments)) {
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

function buildRepositoriesDirectory(
  repositoriesDimension: readonly RepoDirectoryEntry[] | undefined,
): Map<string, string> | null {
  if (!repositoriesDimension) return null;
  const map = new Map<string, string>();
  for (const entry of repositoriesDimension) {
    if (
      typeof entry.repository_id === "string" &&
      typeof entry.repository_name === "string"
    ) {
      map.set(entry.repository_id, entry.repository_name);
    }
  }
  return map;
}

function resolveDisplayName(
  repositoryId: string,
  directory: Map<string, string> | null,
): string {
  // FR-4-11 / CL-04: dimension lookup first, raw-`repository_id` fallback.
  // No sentinel branch (CL-03 / INV-3-12 — the per-repo dimension is
  // FK-protected; sentinel concept N/A).
  if (directory) {
    const found = directory.get(repositoryId);
    if (typeof found === "string" && found.length > 0) {
      return found;
    }
  }
  return repositoryId;
}

function metricValue(
  row: RepoDensityRow,
  metric: CommentsRepoDensitySortMetric,
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
  a: RepoDensityRow,
  b: RepoDensityRow,
  metric: CommentsRepoDensitySortMetric,
): number {
  // Primary: chosen metric descending.
  const primary = metricValue(b, metric) - metricValue(a, metric);
  if (primary !== 0) return primary;
  // Secondary: display name ascending (handles ties on the metric;
  // duplicate display names from rename / fallback collisions per FR-4-05).
  const displayCmp = a.displayName.localeCompare(b.displayName);
  if (displayCmp !== 0) return displayCmp;
  // Final: repository_id ascending.  Map keys are unique by construction
  // (one bucket per repository_id), so the equality branch is unreachable
  // in practice — collapsed into a two-way ternary so the partial-branches
  // ratchet does not flag a dead third arm (mirrors 334's compareRows
  // collapse for the same reason; spec A-10 / .coverage-partial-branches-
  // baseline.json zero-growth contract).
  return a.repositoryId < b.repositoryId ? -1 : 1;
}

export interface CommentsRepoDensityOptions {
  filters?: FilterState;
  repositoriesDimension?: readonly RepoDirectoryEntry[];
  sortMetric?: CommentsRepoDensitySortMetric;
}

/**
 * Per-container sort metric state.  Keys are the chart container element
 * so a single dashboard with multiple chart instances (none today, but
 * the contract leaves the door open) keeps state isolated.  Set when the
 * user clicks a sort button (US2 / T024); read when ``options.sortMetric``
 * is not provided so the chart preserves its toggle state across
 * re-renders triggered by filter / range changes.
 */
const sortMetricByContainer = new WeakMap<
  HTMLElement,
  CommentsRepoDensitySortMetric
>();

/**
 * Per-container listener controllers.  Each render aborts the prior set
 * before attaching fresh button handlers so re-renders never accumulate
 * duplicate listeners (mirrors the 334 / 333 info-icon pattern).
 */
const sortListenerControllers = new WeakMap<HTMLElement, AbortController>();

function attachSortToggleListeners(
  container: HTMLElement,
  rollups: Rollup[],
  options: CommentsRepoDensityOptions | undefined,
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
  ): CommentsRepoDensitySortMetric | undefined => {
    return COMMENTS_REPO_DENSITY_SORT_METRICS.find((m) => m === raw);
  };

  const activate = (metric: CommentsRepoDensitySortMetric): void => {
    sortMetricByContainer.set(container, metric);
    // Re-render with the same rollups + options but the new metric.
    // The new render replaces these listeners via the controller-abort
    // pattern at the top of this function.
    renderCommentsRepositoryDensityChart(container, rollups, {
      ...options,
      sortMetric: metric,
    });
  };

  const findSortButton = (event: Event): HTMLElement | null => {
    const target = event.target as Element;
    return target.closest<HTMLElement>(".comments-repository-density-sort-btn");
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
 * Render the per-repo comments-density breakdown.
 *
 * @param container Target container element.  The dashboard call site is
 *                  responsible for capability-on container provisioning
 *                  (T022 ``ensureCommentsRepositoryDensityContainer``);
 *                  the chart treats ``null`` as a no-op.
 * @param rollups   Weekly rollups in chronological order.  Weeks lacking
 *                  the ``by_repository_comments`` outer dict are filtered
 *                  out (capability-off path defense).
 * @param options   Filter state + repositories directory + chosen sort
 *                  metric.  Defaults: no filters, no directory, sort by
 *                  ``comment_count`` descending.
 */
export function renderCommentsRepositoryDensityChart(
  container: HTMLElement | null,
  rollups: Rollup[],
  options?: CommentsRepoDensityOptions,
): void {
  if (!container) return;

  if (options?.filters && hasActiveFilters(options.filters)) {
    renderNoData(
      container,
      "Comments density is not yet filterable",
      "Clear repo / team / author / reviewer filters to view per-repo review-conversation totals. Per-dimension comments breakdowns are tracked under follow-up issue #322.",
    );
    return;
  }

  const withByRepository = rollups.filter(hasByRepositoryComments);
  const reduced = reducePerRepository(withByRepository);

  if (reduced.size === 0) {
    renderNoData(
      container,
      "No comments data for selected range",
      "Try widening the date range, or confirm comments extraction is enabled for this dataset.",
    );
    return;
  }

  const directory = buildRepositoriesDirectory(options?.repositoriesDimension);
  const rows: RepoDensityRow[] = [];
  for (const [key, bucket] of reduced) {
    rows.push({
      repositoryId: key,
      displayName: resolveDisplayName(key, directory),
      thread_count: bucket.thread_count,
      comment_count: bucket.comment_count,
      active_thread_count: bucket.active_thread_count,
      coverage_partial: bucket.coverage_partial,
    });
  }

  // Resolve the active sort metric: explicit option wins (e.g., the
  // dashboard hard-overrides per render), then per-container state set
  // by the user's last button click (US2 / T024), then the default
  // ``comment_count`` per CL-06.
  let activeMetric: CommentsRepoDensitySortMetric;
  if (options?.sortMetric) {
    activeMetric = options.sortMetric;
    sortMetricByContainer.set(container, activeMetric);
  } else {
    activeMetric = sortMetricByContainer.get(container) ?? "comment_count";
  }
  rows.sort((a, b) => compareRows(a, b, activeMetric));

  const truncated = rows.length > MAX_COMMENTS_REPO_DENSITY_ROWS;
  const display = truncated
    ? rows.slice(0, MAX_COMMENTS_REPO_DENSITY_ROWS)
    : rows;
  const truncationHtml = renderTruncationIndicator(
    truncated,
    MAX_COMMENTS_REPO_DENSITY_ROWS,
    "repositories",
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

function metricLabel(metric: CommentsRepoDensitySortMetric): string {
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
  activeMetric: CommentsRepoDensitySortMetric,
): string {
  // WAI-ARIA Toolbar pattern (memory feedback_wai_aria_toolbar_for_keyboard
  // _reachability.md): each button is an independently Tab-reachable
  // <button> with aria-pressed tracking the active sort metric.  Toolbar
  // is preferred over a single-tabstop radio-group so all three buttons
  // are keyboard-reachable without arrow-key navigation that the chart
  // does not implement.  <button> elements default to tabindex=0 and
  // natively activate on Enter / Space; the delegated click + keydown
  // handlers in attachSortToggleListeners catch both sequences.
  const buttons = COMMENTS_REPO_DENSITY_SORT_METRICS.map((metric) => {
    const checked = metric === activeMetric;
    const ariaPressed = checked ? "true" : "false";
    const label = metricLabel(metric);
    return `<button type="button" class="comments-repository-density-sort-btn${checked ? " is-active" : ""}" aria-pressed="${ariaPressed}" data-sort-metric="${escapeHtml(metric)}">${escapeHtml(label)}</button>`;
  }).join("");
  return `<div class="comments-repository-density-sort" role="toolbar" aria-label="Sort repository rows by metric">${buttons}</div>`;
}

function renderTable(rows: readonly RepoDensityRow[]): string {
  const rowsHtml = rows.map((row) => renderRow(row)).join("");
  return `<div class="comments-repository-density-table" role="table" aria-label="Per-repository comment density"><div class="comments-repository-density-thead" role="row"><div role="columnheader">Repository</div><div role="columnheader" class="comments-repository-density-numeric">Threads</div><div role="columnheader" class="comments-repository-density-numeric">Active threads</div><div role="columnheader" class="comments-repository-density-numeric">Comments</div></div>${rowsHtml}</div>`;
}

function renderRow(row: RepoDensityRow): string {
  const partialClass = row.coverage_partial ? " coverage-partial" : "";
  const partialAttr = row.coverage_partial
    ? ' data-coverage-partial="true"'
    : "";
  const partialNote = row.coverage_partial ? " (partial coverage)" : "";
  const ariaLabel = `${row.displayName}: ${row.thread_count.toLocaleString()} threads, ${row.active_thread_count.toLocaleString()} active threads, ${row.comment_count.toLocaleString()} comments${partialNote}`;
  return `<div class="comments-repository-density-row${partialClass}" role="row" data-repository-id="${escapeHtml(row.repositoryId)}"${partialAttr} aria-label="${escapeHtml(ariaLabel)}"><div class="comments-repository-density-name" role="cell">${escapeHtml(row.displayName)}</div><div class="comments-repository-density-numeric" role="cell">${escapeHtml(row.thread_count.toLocaleString())}</div><div class="comments-repository-density-numeric" role="cell">${escapeHtml(row.active_thread_count.toLocaleString())}</div><div class="comments-repository-density-numeric" role="cell">${escapeHtml(row.comment_count.toLocaleString())}</div></div>`;
}
