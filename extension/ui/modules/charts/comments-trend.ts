/**
 * Comments-Trend Chart Module (Feature 333)
 *
 * Renders weekly review-conversation volume on the dashboard's Metrics tab:
 * stacked bars (resolved + unresolved threads) with an overlaid line series
 * for total comment count, on a shared vertical axis (FR-1-02). Reads the
 * `rollup[W].comments` sub-object emitted by the aggregator (T011, FR-2-06).
 *
 * Modeled structurally on `throughput.ts` — same shared primitives
 * (`renderTrustedHtml`, `renderTruncationIndicator`, `addChartTooltips`),
 * same accessibility contract on each bar (`tabindex` / `role` /
 * `aria-expanded` / `aria-label`), and the same container-content
 * idempotency pattern. The drilldown click-handler wiring is deferred to
 * T022 (bars carry `data-drilldown-week` for the throughput-drilldown
 * activation path to consume).
 *
 * Capability gating: weeks lacking the `comments` sub-object (capability-off
 * path emitted by the aggregator per FR-3-03) are filtered out at the chart
 * boundary. The dashboard call site (T021) also gates the chart's existence
 * on `capabilityState.commentsMetricsAvailable`, but the chart-side filter
 * is the load-bearing defense for capability-mixed inputs.
 *
 * Partial-coverage qualifier (FR-1-04, ADR T005): weeks with
 * `coverage_partial === true` get BOTH a CSS class hook (`coverage-partial`
 * on `.bar-container`) AND a queryable data attribute
 * (`data-coverage-partial="true"`). T018 styles the class hook with a
 * hatched fill (`repeating-linear-gradient`) + dimmed segment colors. The
 * partial-coverage legend item is conditional — only visible when at least
 * one partial bar is in range. Round-9 case (vi): all-unextracted weeks
 * still render their bar element with explicit zero-height segments AND
 * the qualifier; the comment line connects through the zero point rather
 * than skipping.
 */

import type { Rollup } from "../../dataset-loader";
import type { FilterState } from "../filters";
import { hasActiveFilters } from "../filters";
import { escapeHtml, renderNoData, renderTrustedHtml } from "../shared/render";
import { renderTruncationIndicator } from "../shared/chart-layout";
import { addChartTooltips, clearChartTooltips } from "../charts";
import { weekRangeForAria } from "../drilldown/week-range";
import { showInfoTooltip, dismissAllTooltips } from "../tooltip-manager";

/** Maximum data points rendered (matches throughput's 2-year cap). */
export const MAX_COMMENTS_TREND_POINTS = 104;

/**
 * Plain-text explanation surfaced by the chart-level info-icon (FR-1-04
 * disclosure surface; SC-1-01/02 first-glance comprehension).
 *
 * #356: also discloses that the comments line includes vote events
 * (Approve / Reject / Reset) emitted by Azure DevOps as system messages.
 */
export const COMMENTS_TREND_TOOLTIP =
  "Bars show resolved (lower) and unresolved (upper) review threads per week. " +
  "The line shows total comments, including vote events (Approve / Reject / Reset) that Azure DevOps emits as system messages. " +
  "Hatched bars indicate partial coverage — " +
  "some PRs in the week aren't yet extracted, so totals are partial.";

/** Per-button AbortControllers to prevent listener accumulation on re-attach. */
const chartInfoIconControllers = new WeakMap<HTMLElement, AbortController>();

/**
 * Mount a chart-level info-icon button as a child of `heading`, with the
 * supplied `tooltipText` shown on hover/click. Generic version used by all
 * comments panels (trend + 3 density). Idempotent: re-attach replaces.
 *
 * `instanceId` is written to `data-info-tooltip` so per-chart tests can
 * disambiguate when multiple icons mount in the same DOM tree.
 */
export function attachChartInfoIcon(
  heading: HTMLElement,
  tooltipText: string,
  instanceId: string,
): void {
  const existing = heading.querySelector(
    ".info-icon-btn",
  ) as HTMLElement | null;
  if (existing) {
    chartInfoIconControllers.get(existing)?.abort();
    chartInfoIconControllers.delete(existing);
    existing.remove();
  }

  const controller = new AbortController();
  const { signal } = controller;

  const btn = document.createElement("button");
  btn.className = "info-icon-btn";
  btn.setAttribute("type", "button");
  btn.setAttribute("aria-label", "About this chart");
  btn.setAttribute("data-info-tooltip", instanceId);
  btn.textContent = "ℹ"; // Unicode info symbol ⓘ

  btn.addEventListener(
    "pointerenter",
    () => {
      showInfoTooltip(btn, tooltipText);
    },
    { signal },
  );
  btn.addEventListener(
    "pointerleave",
    () => {
      dismissAllTooltips();
    },
    { signal },
  );
  btn.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      const open = document.querySelector(".info-tooltip");
      if (open) {
        dismissAllTooltips();
        return;
      }
      showInfoTooltip(btn, tooltipText);
      requestAnimationFrame(() => {
        const dismissOnce = (): void => {
          dismissAllTooltips();
          document.removeEventListener("click", dismissOnce);
        };
        document.addEventListener("click", dismissOnce);
      });
    },
    { signal },
  );

  chartInfoIconControllers.set(btn, controller);
  heading.appendChild(btn);
}

/**
 * Remove a chart-level info-icon button from `heading` and abort its
 * listeners. Also dismisses any open info-tooltip — document-rooted
 * tooltips would otherwise outlive the anchor button on capability flips.
 * No-op when the heading carries no button AND no tooltip is open.
 */
export function detachChartInfoIcon(heading: HTMLElement): void {
  const btn = heading.querySelector(".info-icon-btn") as HTMLElement | null;
  if (!btn) return;
  chartInfoIconControllers.get(btn)?.abort();
  chartInfoIconControllers.delete(btn);
  btn.remove();
  dismissAllTooltips();
}

/**
 * Mount the comments-trend chart-level info-icon. Thin wrapper around
 * `attachChartInfoIcon` preserving the original (heading)-only signature
 * for the dashboard's trend ensure helper and existing tests.
 */
export function attachCommentsTrendInfoIcon(heading: HTMLElement): void {
  attachChartInfoIcon(heading, COMMENTS_TREND_TOOLTIP, "comments-trend");
}

/**
 * Remove the comments-trend chart-level info-icon. Thin wrapper around
 * `detachChartInfoIcon` preserving the original (heading)-only signature.
 */
export function detachCommentsTrendInfoIcon(heading: HTMLElement): void {
  detachChartInfoIcon(heading);
}

/** Maximum visible week labels before thinning kicks in. */
const MAX_VISIBLE_LABELS = 16;

/** SVG viewport height for the comment-line overlay (matches throughput). */
const CHART_HEIGHT_PX = 200;

/** Vertical padding inside the SVG viewport so endpoints don't clip. */
const CHART_PADDING_PX = 8;

interface CommentsAggregate {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

type RollupWithComments = Rollup & { comments: CommentsAggregate };

function hasComments(rollup: Rollup): rollup is RollupWithComments {
  return rollup.comments !== undefined;
}

/**
 * Render the weekly comments-trend chart.
 *
 * @param container Target container element (dashboard call site is
 *                  responsible for capability-on container provisioning per
 *                  T020 / T021; the chart treats `null` as a no-op).
 * @param rollups   Weekly rollups in chronological order. Weeks lacking the
 *                  `comments` sub-object are filtered out (capability-off
 *                  path defense).
 * @param options   Filter state. When any of `filters.{repos,teams,authors,
 *                  reviewers}` is non-empty, the chart renders a
 *                  filter-not-supported empty state instead of bars/line
 *                  (FR-1-06). The rest of the dashboard's metric surfaces
 *                  consume `applyFiltersToRollups`-filtered rollups, but
 *                  `buildFilteredRollup` carries `rollup.comments` through
 *                  unchanged via the `...rollup` spread, so rendering bars
 *                  off filtered rollups would silently show unfiltered
 *                  week totals — the inverse of an honest UI. Per-dimension
 *                  comments slices are deferred to issue #322 / 310
 *                  Capability 2.
 */
export function renderCommentsTrendChart(
  container: HTMLElement | null,
  rollups: Rollup[],
  options?: { filters?: FilterState },
): void {
  if (!container) return;
  clearChartTooltips(container);

  // FR-1-06: dimension filters are not yet supported on this chart. The
  // dashboard slices `rollups` by date range before calling, but per-PR
  // dimension filtering does NOT propagate into the rollup-root `comments`
  // aggregate (`buildFilteredRollup` spreads `...rollup` and only overrides
  // top-level throughput fields). Render a self-explanatory empty state
  // rather than show data that contradicts the rest of the dashboard.
  if (options?.filters && hasActiveFilters(options.filters)) {
    renderNoData(
      container,
      "Comments trend is not yet filterable",
      "Clear repo / team / author / reviewer filters to view weekly comment activity. Per-dimension comment breakdowns are coming soon.",
    );
    return;
  }

  const withComments = rollups.filter(hasComments);

  if (withComments.length === 0) {
    renderNoData(
      container,
      "No comments data for selected range",
      "Try widening the date range, or confirm comments extraction is enabled for this dataset.",
    );
    return;
  }

  // Truncation: most recent slice (mirrors throughput's pattern).
  const truncated = withComments.length > MAX_COMMENTS_TREND_POINTS;
  const display = truncated
    ? withComments.slice(-MAX_COMMENTS_TREND_POINTS)
    : withComments;

  // Y-axis maximum spans both threads and comments per FR-1-02 (shared axis).
  // Floor at 1 so an all-zero range still yields a usable scale (zero-height
  // segments still render with explicit `height: 0%` per FR-2-06 (vi)).
  const maxValue = Math.max(
    1,
    ...display.map((r) =>
      Math.max(r.comments.thread_count, r.comments.comment_count),
    ),
  );

  const labelStep = Math.max(1, Math.ceil(display.length / MAX_VISIBLE_LABELS));
  const barsHtml = display
    .map((r, i) => renderBar(r, i, labelStep, maxValue))
    .join("");

  const lineHtml = renderCommentsLine(display, maxValue);
  const truncationHtml = renderTruncationIndicator(
    truncated,
    MAX_COMMENTS_TREND_POINTS,
  );

  const anyPartial = display.some((r) => r.comments.coverage_partial);
  const partialLegendItem = anyPartial
    ? `<div class="legend-item legend-coverage-partial-item"><span class="legend-bar legend-bar-coverage-partial"></span><span>Partial coverage</span></div>`
    : "";

  const legendHtml = `
    <div class="chart-legend">
      <div class="legend-item">
        <span class="legend-bar legend-bar-resolved"></span>
        <span>Resolved threads</span>
      </div>
      <div class="legend-item">
        <span class="legend-bar legend-bar-unresolved"></span>
        <span>Unresolved threads</span>
      </div>
      <div class="legend-item">
        <span class="legend-line legend-line-comments"></span>
        <span>Comments</span>
      </div>
      ${partialLegendItem}
    </div>
  `;

  renderTrustedHtml(
    container,
    `
      ${truncationHtml}
      <div class="chart-with-trend comments-trend-chart" style="--chart-surface: var(--bg-primary);">
        <div class="bar-chart comments-trend-bars">${barsHtml}</div>
        ${lineHtml}
      </div>
      ${legendHtml}
    `,
  );

  addChartTooltips(container, buildTooltipHtml);
}

function renderBar(
  rollup: RollupWithComments,
  index: number,
  labelStep: number,
  maxValue: number,
): string {
  const c = rollup.comments;
  // Resolved = total threads minus active (unresolved) threads. Always
  // non-negative because INV-1-06 guarantees active <= thread.
  const resolvedCount = c.thread_count - c.active_thread_count;
  const resolvedHeightPct = (resolvedCount / maxValue) * 100;
  const unresolvedHeightPct = (c.active_thread_count / maxValue) * 100;
  // Producer contract (aggregators.py _generate_weekly_rollups): rollup.week
  // is always `${iso_year}-W${iso_week:02d}`, so the split always yields
  // a defined wParts[1]. Trusting the contract per repo memory's
  // no-dead-code-guards rule.
  const weekLabel = rollup.week.split("-W")[1] as string;
  const showLabel = index % labelStep === 0;
  const partialClass = c.coverage_partial ? " coverage-partial" : "";
  const partialAttr = c.coverage_partial ? ' data-coverage-partial="true"' : "";
  const resolvedNoun = c.thread_count === 1 ? "thread" : "threads";
  const commentNoun = c.comment_count === 1 ? "comment" : "comments";
  const partialNote = c.coverage_partial ? " — partial coverage" : "";
  const ariaLabel =
    `Drill into week of ${weekRangeForAria(rollup)}, ` +
    `${c.thread_count} ${resolvedNoun} (${c.active_thread_count} unresolved), ` +
    `${c.comment_count} ${commentNoun}${partialNote}`;
  return `
    <div class="bar-container${partialClass}" data-tooltip="true" data-week="${escapeHtml(rollup.week)}" data-thread-count="${c.thread_count}" data-active-thread-count="${c.active_thread_count}" data-comment-count="${c.comment_count}" data-drilldown-week="${escapeHtml(rollup.week)}"${partialAttr} tabindex="0" role="button" aria-expanded="false" aria-label="${escapeHtml(ariaLabel)}">
      <div class="bar-segment-unresolved" style="height: ${unresolvedHeightPct.toFixed(1)}%"></div>
      <div class="bar-segment-resolved" style="height: ${resolvedHeightPct.toFixed(1)}%"></div>
      <div class="bar-label">${showLabel ? escapeHtml(weekLabel) : ""}</div>
    </div>
  `;
}

/**
 * Render the comment-count line series as an SVG overlay with one circle
 * marker per week. Per FR-2-06 case (vi), zero-value weeks still emit a
 * marker so the line connects through them rather than skipping.
 */
function renderCommentsLine(
  rollups: RollupWithComments[],
  maxValue: number,
): string {
  // Caller (renderCommentsTrendChart) returns early via the empty-state
  // path before reaching this function, so rollups is always non-empty
  // here. Trusting the caller contract per the no-dead-code-guards rule.

  const points = rollups.map((r, i) => {
    const x = rollups.length > 1 ? (i / (rollups.length - 1)) * 100 : 50;
    const innerHeight = CHART_HEIGHT_PX - CHART_PADDING_PX * 2;
    const ratio = r.comments.comment_count / maxValue;
    const y = CHART_HEIGHT_PX - CHART_PADDING_PX - ratio * innerHeight;
    return { x, y };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const dotsHtml = points
    .map(
      (p) =>
        `<circle class="comments-line-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" vector-effect="non-scaling-stroke"/>`,
    )
    .join("");

  return `<div class="comments-line-overlay"><svg viewBox="0 0 100 ${CHART_HEIGHT_PX}" preserveAspectRatio="none"><path class="comments-line" d="${pathD}" vector-effect="non-scaling-stroke"/>${dotsHtml}</svg></div>`;
}

function buildTooltipHtml(bar: HTMLElement): string {
  // Producer contract: renderBar always sets data-week / data-thread-count /
  // data-active-thread-count / data-comment-count on .bar-container[
  // data-tooltip="true"]. Mirroring throughput.ts' tooltip pattern (uses the
  // same `as string` cast on its dataset reads). The
  // data-coverage-partial attribute is intentionally absent on non-partial
  // bars (kept off for FR-1-04 "applied only to weeks marked partial"
  // queryability), so undefined-vs-"true" is the partial flag.
  const week = bar.dataset.week as string;
  const threads = bar.dataset.threadCount as string;
  const active = bar.dataset.activeThreadCount as string;
  const comments = bar.dataset.commentCount as string;
  const partial = bar.dataset.coveragePartial === "true";
  const partialNote = partial
    ? `<div class="chart-tooltip-row chart-tooltip-note">Some PRs in this week aren't yet extracted — values shown are partial totals; the full number may be higher.</div>`
    : "";
  return `<div class="chart-tooltip-title">${escapeHtml(week)}</div>
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-label">Threads</span>
            <span>${escapeHtml(threads)} (${escapeHtml(active)} unresolved)</span>
          </div>
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-label">Comments</span>
            <span>${escapeHtml(comments)}</span>
          </div>
          ${partialNote}`;
}
