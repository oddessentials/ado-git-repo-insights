/**
 * Throughput drill-down (US1).
 *
 * Delegated `click` + `keydown` on the throughput chart container per
 * `contracts/drilldown-integration.md`: resolves `[data-drilldown-week]`
 * targets and opens the shared DetailPanel with per-week breakdowns
 * sourced from the already-rendered rollup slice (no second data fetch —
 * FR-070). Keyboard activation (Enter/Space on a focused bar) triggers
 * the same flow; Space calls `preventDefault()` to suppress page scroll.
 *
 * Touch activation: relies on the browser-synthesized `click` event
 * that follows a touch tap. The companion chart-tooltip pointerup
 * handler in `modules/charts.ts` intentionally does NOT call
 * `preventDefault` so the synthesized click propagates to this
 * delegated listener; `tests/modules/charts/tooltip.test.ts` locks
 * that invariant.
 *
 * `is-drilldown-active` class tracking uses a MutationObserver on the
 * shared panel root's `class` attribute: when the panel loses `is-open`
 * (via any dismiss path — Escape, outside-click, close button, filters-
 * changed, tab-changed, comparison-toggled) the observer fires once,
 * removes the class, disconnects itself, and drops out of the install's
 * observer set. `dispose()` additionally disconnects any still-live
 * observers so a stale observer from a disposed install cannot influence
 * a subsequent install.
 */

import type { Rollup } from "../../dataset-loader";
import type { AuthorEntry } from "../../schemas/dimensions.schema";
import type { BreakdownEntry } from "../../schemas/rollup.schema";
import { createEmptyFilterState, type FilterState } from "../filters";
import { dismissAllTooltips } from "../tooltip-manager";
import {
  makeBreakdownTable,
  makeEmptyState,
  makePanelContent,
  makePrListSection,
  makeStatRow,
  openDetailPanel,
  type DrillDownContext,
  type PanelContent,
  type PanelRow,
  type PanelSection,
  type PrListRow,
  type PrListSection,
} from "../shared/detail-panel";
import { resolveDisplayName } from "../shared/identity-fallback";
import {
  resolvePrUrl,
  type PrUrlRepositoryEntry,
  type PrUrlWebContext,
} from "../shared/pr-url";
import {
  isDrilldownDisabledByComparison,
  showComparisonAdvisoryToast,
} from "./comparison-advisory";
import { classifyFilterState } from "./filter-support";
import { formatWeekTitle } from "./week-range";

const ACTIVE_CLASS = "is-drilldown-active";

/**
 * Options passed at `installThroughputDrilldown` time. Feature 060 added the
 * PR-detail fields; issue #308 adds `authorsDimension` so the `By author`
 * breakdown resolves `user_id` GUIDs to friendly names (no GUID in visible
 * text). All fields remain optional — when `authorsDimension` is missing
 * every row label falls back to `UNKNOWN_USER_LABEL`.
 */
export interface ThroughputDrilldownOptions {
  readonly filters?: FilterState;
  readonly repositoriesDimension?:
    | readonly PrUrlRepositoryEntry[]
    | null
    | undefined;
  readonly webContext?: PrUrlWebContext;
  readonly authorsDimension?: readonly AuthorEntry[] | null | undefined;
  // Feature 310 — section-level gate for the three comments-metrics
  // columns on the PR-detail rendering.  Default is ``false`` when absent
  // (back-compat with callers that do not wire the capability state).
  // When ``true`` the renderer emits thread / comment / unresolved
  // counts per row + sort + threshold filter controls; when ``false``
  // the DOM stays byte-identical to the pre-310 shape (SC-03).
  readonly commentsMetricsAvailable?: boolean;
}

/**
 * When `nameByKey` is supplied, row labels are resolved through it (with
 * `UNKNOWN_USER_LABEL` fallback per #308). Omitting `nameByKey` preserves
 * the key-as-label shape for non-identity breakdowns (e.g. the
 * `By repository` table, whose keys are already repository names).
 */
function breakdownSection(
  title: string,
  columns: readonly [string, string, ...string[]],
  entries: Record<string, BreakdownEntry> | null | undefined,
  emptyDetail: string,
  nameByKey?: ReadonlyMap<string, string>,
): PanelSection {
  if (!entries || Object.keys(entries).length === 0) {
    return makeEmptyState(title, emptyDetail);
  }
  const rows: PanelRow[] = Object.entries(entries)
    .sort((a, b) => b[1].pr_count - a[1].pr_count)
    .map(([key, entry]) => ({
      label: nameByKey ? resolveDisplayName(key, nameByKey) : key,
      values: [String(entry.pr_count)],
    }));
  return makeBreakdownTable(title, columns, rows);
}

/**
 * Feature 060: build the PR-detail section for a throughput drill-down.
 *
 * Called after the comparison short-circuit in `activate()`, so the
 * `comparison` classification is unreachable here — only team / reviewer /
 * supported are possible.
 */
function buildPrListSection(
  rollup: Rollup,
  options: ThroughputDrilldownOptions,
): PrListSection {
  // `false` for comparisonActive uses the narrowed-return overload so the
  // switch below covers every reachable classification (no unreachable
  // "comparison" arm). Callers that need to handle comparison state do so
  // upstream in activate() before this function is invoked.
  const filters = options.filters ?? createEmptyFilterState();
  const { classification } = classifyFilterState(filters, false);
  switch (classification) {
    case "team":
      return makePrListSection({ contentState: "team-inline" });
    case "reviewer":
      return makePrListSection({ contentState: "reviewer-inline" });
    case "supported": {
      const rawPrs = rollup.prs ?? [];
      const webContext = options.webContext;
      const capValue = rollup._prs_cap;
      // Supported-empty covers: no PRs to show, no web context for URL
      // composition, or a rollup that violates the aggregator contract by
      // omitting `_prs_cap`. Every other supported-state rollup renders the
      // full PR list.
      if (rawPrs.length === 0 || !webContext || capValue === undefined) {
        return makePrListSection({ contentState: "supported-empty" });
      }
      const commentsMetricsAvailable =
        options.commentsMetricsAvailable ?? false;
      // Feature 310: when capability is on, pass the three optional
      // comments-metrics fields straight through to the row without
      // normalizing ``undefined`` to ``null`` — the renderer's partial
      // check (``value === null || value === undefined``) handles both
      // equivalently, so the extra ``??`` step would only add a
      // partial-branch with no behavioral difference.  When capability is
      // off, we skip attaching the triplet entirely so
      // ``PrListRow.threadCount`` etc. stay absent (SC-03).
      const rows: PrListRow[] = rawPrs.map((pr): PrListRow => {
        if (!commentsMetricsAvailable) {
          return {
            id: pr.id,
            title: pr.title,
            cycleTimeMinutes: pr.cycle_time,
            url: resolvePrUrl(pr, options.repositoriesDimension, webContext),
          };
        }
        return {
          id: pr.id,
          title: pr.title,
          cycleTimeMinutes: pr.cycle_time,
          url: resolvePrUrl(pr, options.repositoriesDimension, webContext),
          threadCount: pr.thread_count,
          commentCount: pr.comment_count,
          activeThreadCount: pr.active_thread_count,
        };
      });
      return makePrListSection({
        contentState: "pr-list",
        rows,
        renderedCount: rows.length,
        actualFilteredCount: rollup.pr_count,
        capValue,
        commentsMetricsAvailable,
      });
    }
  }
}

function buildPanelContent(
  rollup: Rollup,
  options: ThroughputDrilldownOptions,
): PanelContent {
  const count = rollup.pr_count;
  const subtitle = `${count} ${count === 1 ? "PR" : "PRs"}`;
  const authorNameByKey = buildAuthorNameMap(options.authorsDimension);
  const byAuthor = breakdownSection(
    "By author",
    ["Author", "PRs"] as const,
    rollup.by_author,
    "No author-level activity for this week.",
    authorNameByKey,
  );
  const byRepository = breakdownSection(
    "By repository",
    ["Repository", "PRs"] as const,
    rollup.by_repository,
    "No repository-level activity for this week.",
  );
  const prList = buildPrListSection(rollup, options);
  // Feature 310 — week-level stat row (F6).  Strictly prepended before
  // byAuthor / byRepository / prList so the existing relative ordering
  // is byte-stable (lock #2).
  //
  // Gate: capability on AND the resolved pr-list state is ``"pr-list"``
  // — NOT ``rawPrs.length > 0`` alone.  When the active filter set
  // produces ``team-inline`` or ``reviewer-inline``, the PR-detail
  // section renders a "Clear the filter" gated message; when it
  // produces ``supported-empty`` (e.g. missing ``webContext``) the
  // section renders an empty-state message.  Emitting a stat row
  // above any of those states would claim week totals with no
  // corresponding row list visible to back them up (the exact bug the
  // Codex stop-time review surfaced on commit 2).
  //
  // Sums are derived from ``prList.rows`` — the exact typed slice
  // that feeds the rendered rows (lock #4 — same slice as rows, no
  // ``rollup`` aggregate fields read).  ``prList.rows`` is a narrowed
  // non-null ``readonly PrListRow[]`` on the ``"pr-list"`` branch of
  // the ``PrListSection`` discriminated union, which keeps the stat-
  // row derivation free of defensive null-coalescing fallbacks on the
  // array itself.
  const sections: PanelSection[] = [];
  const commentsMetricsAvailable = options.commentsMetricsAvailable ?? false;
  if (commentsMetricsAvailable && prList.contentState === "pr-list") {
    sections.push(buildCommentsStatRow(prList.rows));
  }
  sections.push(byAuthor, byRepository, prList);
  return makePanelContent(formatWeekTitle(rollup), subtitle, sections);
}

/**
 * Build the week-level comments-metrics stat row (F6).
 *
 * Input is the ``PrListSectionWithRows.rows`` slice — the exact typed
 * ``readonly PrListRow[]`` the renderer attaches to the `<ol>`.  Using
 * this slice (rather than re-reading ``rollup.prs``) keeps the stat-
 * row's derivation mechanically identical to what the user sees in the
 * row list below, and removes any need for defensive null-coalescing
 * on the array itself.
 *
 * Locks honoured:
 *   - #4 slice-only: every value read here is on ``row.threadCount``,
 *     ``row.commentCount``, ``row.activeThreadCount`` for ``row`` in
 *     ``rows``.  No ``rollup.by_author`` / ``rollup.by_repository`` /
 *     ``rollup.pr_count`` access — sums always equal the per-row sum
 *     even when the chart-level aggregate disagrees.
 *   - #5 partial accounting: partial rows are NEVER excluded from the
 *     iteration (lock #4 "never excluded from count logic"); they
 *     contribute 0 to each numeric sum (lock #4 "partial contributes
 *     0") and increment the partial counter that drives the
 *     ``(+N partial)`` annotation.  The annotation appears iff
 *     ``partialCount > 0``.
 */
function buildCommentsStatRow(rows: readonly PrListRow[]): PanelSection {
  let threadsSum = 0;
  let commentsSum = 0;
  let unresolvedSum = 0;
  let partialCount = 0;
  for (const row of rows) {
    // ``?? 0`` makes partial rows (``null`` per INV-10) and any
    // theoretically-absent field contribute 0 to the running sum.
    threadsSum += row.threadCount ?? 0;
    commentsSum += row.commentCount ?? 0;
    unresolvedSum += row.activeThreadCount ?? 0;
    // Per INV-08, the producer guarantees threadCount === null implies
    // the whole triplet is null; checking threadCount alone is
    // sufficient to identify a partial row.
    if (row.threadCount === null) partialCount += 1;
  }
  // Issue #331 / A1: distinguish "all-partial week" from "true zero
  // week" on the stat row.  Under the prior implementation, a week
  // where every row was coverage-pending rendered as ``0 (+N partial)``
  // on each axis — visually identical to a true-zero week with the
  // same partial annotation pattern, except that the latter actually
  // had numeric zeros to back the headline value.  Per INV-08 / INV-10
  // (all-or-nothing per row) "all rows partial on any one axis"
  // collapses to "all rows partial on every axis," so a single per-
  // call branch suffices — no per-axis allPartial check is required.
  //
  // Three states:
  //   - ``partialCount === 0``:               render ``K`` (true total)
  //   - ``0 < partialCount < rows.length``:   render ``K (+N partial)``
  //   - ``partialCount === rows.length > 0``: render ``Pending (N)`` —
  //     the headline literal IS the partial signal; no numeric ``0``
  //     because the underlying data is absent, not zero.
  const allRowsPartial = partialCount > 0 && partialCount === rows.length;
  function statValue(numericTotal: number): string {
    if (allRowsPartial) return `Pending (${partialCount})`;
    if (partialCount > 0) return `${numericTotal} (+${partialCount} partial)`;
    return String(numericTotal);
  }
  return makeStatRow([
    { label: "Threads", value: statValue(threadsSum) },
    { label: "Comments", value: statValue(commentsSum) },
    { label: "Unresolved threads", value: statValue(unresolvedSum) },
  ]);
}

function buildAuthorNameMap(
  dim: readonly AuthorEntry[] | null | undefined,
): ReadonlyMap<string, string> {
  if (!dim || dim.length === 0) return new Map();
  return new Map(dim.map((a) => [a.author_id, a.author_name]));
}

export function installThroughputDrilldown(
  container: HTMLElement,
  rollups: readonly Rollup[],
  options: ThroughputDrilldownOptions = {},
): { dispose(): void } {
  const controller = new AbortController();
  const { signal } = controller;
  const observers = new Set<MutationObserver>();
  let activeTrigger: HTMLElement | null = null;

  function resolveTrigger(evt: Event): HTMLElement | null {
    const target = evt.target;
    if (!(target instanceof Element)) return null;
    // `closest` walks from target upward; since the listener is on
    // `container`, any match is guaranteed to be a descendant of container
    // (target itself is a descendant, and ancestors walked up pass through
    // container on the way to document).
    return target.closest<HTMLElement>("[data-drilldown-week]");
  }

  function clearActive(): void {
    if (activeTrigger) {
      activeTrigger.classList.remove(ACTIVE_CLASS);
      // PR #302 P1.E — keep aria-expanded in lockstep with the active
      // class. clearActive runs from every dismiss path (Escape, outside
      // click, close button, filters-changed, tab-changed, comparison-
      // toggled, retarget) via the panel observer, so this single site
      // covers all SR-state transitions.
      activeTrigger.setAttribute("aria-expanded", "false");
      activeTrigger = null;
    }
  }

  function registerPanelObserver(): void {
    const panel = document.querySelector<HTMLElement>("aside.detail-panel");
    if (!panel) return;
    const observer = new MutationObserver(() => {
      if (!panel.classList.contains("is-open")) {
        observer.disconnect();
        observers.delete(observer);
        clearActive();
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
    observers.add(observer);
  }

  function activate(trigger: HTMLElement): void {
    const weekIso = trigger.getAttribute("data-drilldown-week");
    if (!weekIso) return;

    // Drill-down activation supersedes any transient chart tooltip: on a
    // tap the chart-tooltip's pointerup runs before the synthesized
    // click, so without this dismiss the tooltip would overlap both the
    // comparison-advisory toast and the DetailPanel.
    dismissAllTooltips();

    if (isDrilldownDisabledByComparison()) {
      showComparisonAdvisoryToast(trigger);
      return;
    }

    const rollup = rollups.find((r) => r.week === weekIso);
    if (!rollup) return;

    const context: DrillDownContext = {
      sourceChart: "throughput",
      focusedData: { kind: "throughput", weekIso },
      triggerElement: trigger,
      content: buildPanelContent(rollup, options),
    };

    openDetailPanel(context);

    clearActive();
    activeTrigger = trigger;
    trigger.classList.add(ACTIVE_CLASS);
    trigger.setAttribute("aria-expanded", "true");
    registerPanelObserver();
  }

  container.addEventListener(
    "click",
    (event) => {
      const trigger = resolveTrigger(event);
      if (!trigger) return;
      activate(trigger);
    },
    { signal },
  );

  container.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = resolveTrigger(event);
      if (!trigger) return;
      if (event.key === " ") event.preventDefault();
      activate(trigger);
    },
    { signal },
  );

  return {
    dispose(): void {
      controller.abort();
      for (const observer of observers) {
        observer.disconnect();
      }
      observers.clear();
      clearActive();
    },
  };
}
