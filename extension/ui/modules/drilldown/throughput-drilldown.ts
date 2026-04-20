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
import type { BreakdownEntry } from "../../schemas/rollup.schema";
import { createEmptyFilterState, type FilterState } from "../filters";
import { dismissAllTooltips } from "../tooltip-manager";
import {
  makeBreakdownTable,
  makeEmptyState,
  makePanelContent,
  makePrListSection,
  openDetailPanel,
  type DrillDownContext,
  type PanelContent,
  type PanelRow,
  type PanelSection,
  type PrListRow,
  type PrListSection,
} from "../shared/detail-panel";
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
 * Options passed at `installThroughputDrilldown` time. Feature 060 adds the
 * three fields the PR-detail section needs; all are optional so existing
 * tests that call the two-argument form keep working (the PR section
 * defaults to `supported-empty` in that case).
 */
export interface ThroughputDrilldownOptions {
  readonly filters?: FilterState;
  readonly repositoriesDimension?:
    | readonly PrUrlRepositoryEntry[]
    | null
    | undefined;
  readonly webContext?: PrUrlWebContext;
}

function breakdownSection(
  title: string,
  columns: readonly [string, string, ...string[]],
  entries: Record<string, BreakdownEntry> | null | undefined,
  emptyDetail: string,
): PanelSection {
  if (!entries || Object.keys(entries).length === 0) {
    return makeEmptyState(title, emptyDetail);
  }
  const rows: PanelRow[] = Object.entries(entries)
    .sort((a, b) => b[1].pr_count - a[1].pr_count)
    .map(([label, entry]) => ({
      label,
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
  const classification = classifyFilterState(
    options.filters ?? createEmptyFilterState(),
    false,
  );
  switch (classification.classification) {
    case "team":
      return makePrListSection({ contentState: "team-inline" });
    case "reviewer":
      return makePrListSection({ contentState: "reviewer-inline" });
    case "comparison":
      // Unreachable: activate() short-circuits comparison with a toast
      // and early return. Defensive fallback keeps the sealed-union
      // exhaustiveness check satisfied at build time.
      return makePrListSection({ contentState: "supported-empty" });
    case "supported": {
      const rawPrs = rollup.prs ?? [];
      const webContext = options.webContext;
      if (rawPrs.length === 0 || !webContext) {
        return makePrListSection({ contentState: "supported-empty" });
      }
      const rows: PrListRow[] = rawPrs.map((pr) => ({
        id: pr.id,
        title: pr.title,
        cycleTimeMinutes: pr.cycle_time,
        url: resolvePrUrl(
          pr,
          options.repositoriesDimension ?? null,
          webContext,
        ),
      }));
      return makePrListSection({
        contentState: "pr-list",
        rows,
        renderedCount: rows.length,
        actualFilteredCount: rollup.pr_count,
        capValue: rollup._prs_cap ?? 500,
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
  const byAuthor = breakdownSection(
    "By author",
    ["Author", "PRs"] as const,
    rollup.by_author,
    "No author-level activity for this week.",
  );
  const byRepository = breakdownSection(
    "By repository",
    ["Repository", "PRs"] as const,
    rollup.by_repository,
    "No repository-level activity for this week.",
  );
  const prList = buildPrListSection(rollup, options);
  return makePanelContent(formatWeekTitle(rollup), subtitle, [
    byAuthor,
    byRepository,
    prList,
  ]);
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
