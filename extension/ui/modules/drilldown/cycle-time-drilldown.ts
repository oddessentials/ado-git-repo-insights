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
import type { AuthorEntry } from "../../schemas/dimensions.schema";
import type { BreakdownEntry } from "../../schemas/rollup.schema";
import { createEmptyFilterState, type FilterState } from "../filters";
import { dismissAllTooltips } from "../tooltip-manager";
import { formatDuration } from "../shared/format";
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

/**
 * Feature 361: build the PR-detail section for a cycle-time drill-down.
 *
 * Structurally mirrors throughput's `buildPrListSection` — same classifier,
 * same four content states, same row construction. The cycle-time consumer
 * trusts the producer's existing `cycle_time desc, id asc` ordering and
 * does NOT re-sort; FR-019 makes the rendered DOM order the contract.
 *
 * Called after the comparison short-circuit in `activate()`, so the
 * `comparison` classification is unreachable here — only team / reviewer /
 * supported are possible (narrowed-return overload of `classifyFilterState`).
 */
function buildPrListSection(
  rollup: Rollup,
  options: CycleTimeDrilldownOptions,
): PrListSection {
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
      if (rawPrs.length === 0 || !webContext || capValue === undefined) {
        return makePrListSection({ contentState: "supported-empty" });
      }
      const commentsMetricsAvailable =
        options.commentsMetricsAvailable ?? false;
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
        // Issue #367 — single-rollup: ``capValue`` is the per-week
        // ``rollup._prs_cap`` and the rendered rows ARE the top-N-by-
        // cycle-time slice of this rollup.  Pre-#367 truncation copy
        // is preserved byte-for-byte.
        capScope: "single-rollup",
      });
    }
  }
}

function buildPanelContent(
  rollup: Rollup,
  metric: Metric,
  options: CycleTimeDrilldownOptions,
): PanelContent {
  const count = rollup.pr_count;
  const weekTitle = formatWeekTitle(rollup);
  const title = `${weekTitle} — ${metric.toUpperCase()}`;
  const subtitle = `${count} ${count === 1 ? "PR" : "PRs"}`;
  const stats = makeStatRow([
    { label: "P50", value: formatDurationOrDash(rollup.cycle_time_p50) },
    { label: "P90", value: formatDurationOrDash(rollup.cycle_time_p90) },
  ]);
  // Section order (FR-002, contract § 2): stats → by-repository → PR list.
  // PR list always renders (one of four content states) so panel section
  // count is stable across filter / data / capability shapes.
  return makePanelContent(title, subtitle, [
    stats,
    buildRepositoryBreakdown(rollup.by_repository),
    buildPrListSection(rollup, options),
  ]);
}

/**
 * Options passed at `installCycleTimeDrilldown` time. Feature 361 mirrors
 * `ThroughputDrilldownOptions` field-for-field so the dashboard can build
 * one options bag and pass it to both installs. See
 * `specs/361-cycle-time-pr-drilldown/data-model.md` § 3 for field
 * semantics. All fields are optional; when absent the cycle-time PR list
 * falls through to the `supported-empty` content state (no PR list rows).
 *
 * `authorsDimension` is accepted for call-site uniformity with the
 * throughput install but is NOT consumed by the cycle-time render path
 * (cycle-time has no `By author` breakdown). Threading it through keeps
 * `dashboard.ts` constructing one bag for both surfaces.
 */
export interface CycleTimeDrilldownOptions {
  readonly filters?: FilterState;
  readonly repositoriesDimension?:
    | readonly PrUrlRepositoryEntry[]
    | null
    | undefined;
  readonly webContext?: PrUrlWebContext;
  readonly authorsDimension?: readonly AuthorEntry[] | null | undefined;
  readonly commentsMetricsAvailable?: boolean;
}

export function installCycleTimeDrilldown(
  container: HTMLElement,
  rollups: readonly Rollup[],
  options: CycleTimeDrilldownOptions = {},
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
      content: buildPanelContent(rollup, metric, options),
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
