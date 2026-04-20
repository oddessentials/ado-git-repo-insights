/**
 * Cycle-time drill-down (US2).
 *
 * Delegated `click` + `keydown` on the cycle-time chart container per
 * `contracts/drilldown-integration.md`: resolves
 * `[data-drilldown-metric]` targets on `.line-chart-dot` SVG circles
 * (the lowercase attribute is intentional — the existing uppercase
 * `data-metric` attribute is preserved for the tooltip layer) and
 * opens the shared DetailPanel.
 *
 * Retarget-in-place: the DetailPanel itself handles content swap when
 * `openDetailPanel` is called while already open (see
 * `contracts/detail-panel-api.md`). Clicking P50 then P90 on the same
 * week (or switching weeks entirely) produces a single CSS transition,
 * not a close/reopen flicker.
 *
 * Panel content shape per FR-021 + FR-031 + data-model.md:19:
 *   - title: "Week of {condensed range} — {METRIC}" (metric uppercase)
 *   - subtitle: "{n} PRs"
 *   - sections: StatRowSection (P50, P90 via formatDuration) + per-
 *     repository BreakdownTableSection (or EmptyStateSection when
 *     `by_repository` is empty/null).
 *
 * Touch / tooltip / MutationObserver contracts mirror the throughput
 * drill-down module; see `throughput-drilldown.ts` for the invariant
 * commentary.
 */

import type { Rollup } from "../../dataset-loader";
import type { BreakdownEntry } from "../../schemas/rollup.schema";
import { dismissAllTooltips } from "../tooltip-manager";
import { formatDuration } from "../shared/format";
import {
  makeBreakdownTable,
  makeEmptyState,
  makePanelContent,
  makeStatRow,
  openDetailPanel,
  type DrillDownContext,
  type PanelContent,
  type PanelRow,
  type PanelSection,
} from "../shared/detail-panel";
import {
  isDrilldownDisabledByComparison,
  showComparisonAdvisoryToast,
} from "./comparison-advisory";
import { formatWeekTitle } from "./week-range";

const ACTIVE_CLASS = "is-drilldown-active";

type Metric = "p50" | "p90";

function formatDurationOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatDuration(value);
}

function buildRepositoryBreakdown(
  entries: Record<string, BreakdownEntry> | null | undefined,
): PanelSection {
  if (!entries || Object.keys(entries).length === 0) {
    return makeEmptyState(
      "By repository",
      "No repository-level cycle-time data for this week.",
    );
  }
  const rows: PanelRow[] = Object.entries(entries)
    .sort((a, b) => b[1].pr_count - a[1].pr_count)
    .map(([label, entry]) => ({
      label,
      values: [
        formatDurationOrDash(entry.cycle_time_p50),
        formatDurationOrDash(entry.cycle_time_p90),
      ],
    }));
  return makeBreakdownTable(
    "By repository",
    ["Repository", "P50", "P90"] as const,
    rows,
  );
}

function buildPanelContent(rollup: Rollup, metric: Metric): PanelContent {
  const count = rollup.pr_count;
  const weekTitle = formatWeekTitle(rollup);
  const title = `${weekTitle} — ${metric.toUpperCase()}`;
  const subtitle = `${count} ${count === 1 ? "PR" : "PRs"}`;
  const stats = makeStatRow([
    { label: "P50", value: formatDurationOrDash(rollup.cycle_time_p50) },
    { label: "P90", value: formatDurationOrDash(rollup.cycle_time_p90) },
  ]);
  return makePanelContent(title, subtitle, [
    stats,
    buildRepositoryBreakdown(rollup.by_repository),
  ]);
}

export function installCycleTimeDrilldown(
  container: HTMLElement,
  rollups: readonly Rollup[],
): { dispose(): void } {
  const controller = new AbortController();
  const { signal } = controller;
  const observers = new Set<MutationObserver>();
  let activeTrigger: HTMLElement | null = null;

  function resolveTrigger(evt: Event): HTMLElement | null {
    const target = evt.target;
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>("[data-drilldown-metric]");
  }

  function clearActive(): void {
    if (activeTrigger) {
      activeTrigger.classList.remove(ACTIVE_CLASS);
      // PR #302 P1.E — aria-expanded mirrors active class; symmetric
      // with throughput-drilldown.ts and reviewer-drilldown.ts. Single
      // dismiss-path coverage via the panel observer.
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
    const metricAttr = trigger.getAttribute("data-drilldown-metric");
    if (!weekIso) return;
    if (metricAttr !== "p50" && metricAttr !== "p90") return;

    dismissAllTooltips();

    if (isDrilldownDisabledByComparison()) {
      showComparisonAdvisoryToast(trigger);
      return;
    }

    const rollup = rollups.find((r) => r.week === weekIso);
    if (!rollup) return;

    const metric: Metric = metricAttr;
    const context: DrillDownContext = {
      sourceChart: "cycle-time",
      focusedData: { kind: "cycle-time", weekIso, metric },
      triggerElement: trigger,
      content: buildPanelContent(rollup, metric),
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
