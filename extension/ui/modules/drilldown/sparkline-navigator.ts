/**
 * Sparkline navigator (US4 + #363).
 *
 * Delegated `click` + `keydown` on the summary-cards container per
 * `contracts/drilldown-integration.md`. Two activation paths
 * branched on `data-drilldown-target-chart` (#363 LD-2):
 *
 *   - `throughput` / `cycle-time` → open the shared DetailPanel with a
 *     period-scoped PR list (LD-1 union over the active rollup window).
 *     The panel title comes from `formatPeriodTitle(rollups)`; the
 *     subtitle is `{N} PR(s)` over the period; capability-on prepends
 *     the comments stat row above the PR list.
 *   - `reviewer` → preserved scroll-and-highlight (the reviewer card's
 *     metric does not map to a single PR set; the existing handoff to
 *     the reviewer-activity chart is the right destination — see
 *     LD-2 rationale below at `wrapSparklineTrigger` in
 *     `summary-cards.ts`).
 *
 * Target resolution is the three chart ids defined in
 * `extension/ui/index.html:238/243/251`:
 *
 *   - `throughput`  → `#throughput-chart`
 *   - `cycle-time`  → `#cycle-time-trend`
 *   - `reviewer`    → `#reviewer-activity`
 *
 * Missing target (FR-003 / FR-052): renders an inline advisory message
 * adjacent to the sparkline via `renderNoData` and exits before EITHER
 * branch runs. Comparison mode (FR-004) routes to the comparison-
 * advisory toast and exits before either branch.
 *
 * prefers-reduced-motion (reviewer branch only): resolved at activation
 * time to pick the `scrollIntoView` behavior ("auto" vs "smooth"). The
 * CSS in `styles.css` additionally disables the highlight animation
 * when reduced-motion is requested.
 *
 * Branch B / Q-R4 lock: the cross-rollup union/cap/truncation walk is
 * implemented as a private helper inside this module
 * (`buildPeriodScopedEnvelope`). The structurally similar walk in
 * `reviewer-drilldown.ts:282-322` reads from per-(reviewer, week)
 * entries, not rollup-level fields, so a shared helper would force a
 * call-site restructure on the reviewer drill-down. #363 accepts the
 * local duplication; FR-022 enumerates the six reviewer-drill-down
 * paths that this slice MUST NOT modify.
 */

import type { Rollup } from "../../dataset-loader";
import type { AuthorEntry } from "../../schemas/dimensions.schema";
import type { PrRecord } from "../../schemas/rollup.schema";
import { SPARKLINE_HIGHLIGHT_MS } from "../shared/constants";
import { renderNoData } from "../shared/render";
import { dismissAllTooltips } from "../tooltip-manager";
import { createEmptyFilterState, type FilterState } from "../filters";
import {
  isPartialPrRow,
  makePanelContent,
  makePrListSection,
  makeStatRow,
  openDetailPanel,
  type DrillDownContext,
  type PanelContent,
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
import { formatPeriodTitle } from "./week-range";

const HIGHLIGHT_CLASS = "is-sparkline-highlight";
const ADVISORY_CLASS = "sparkline-advisory";
const ACTIVE_CLASS = "is-drilldown-active";

const TARGET_ID_BY_CHART = {
  throughput: "throughput-chart",
  "cycle-time": "cycle-time-trend",
  reviewer: "reviewer-activity",
} as const;

type TargetChart = keyof typeof TARGET_ID_BY_CHART;

function targetIdFor(chart: TargetChart): string {
  if (chart === "throughput") return TARGET_ID_BY_CHART.throughput;
  if (chart === "cycle-time") return TARGET_ID_BY_CHART["cycle-time"];
  return TARGET_ID_BY_CHART.reviewer;
}

function chartLabel(chart: TargetChart): string {
  if (chart === "cycle-time") return "cycle time";
  return chart;
}

/**
 * Options bag for `installSparklineNavigator` — mirrors
 * `ThroughputDrilldownOptions` / `CycleTimeDrilldownOptions` /
 * `ReviewerDrilldownOptions` field-for-field so the dashboard can build
 * one canonical bag and pass it to every drill-down install. See
 * `data-model.md` § 3 for field semantics. All fields are optional;
 * absent fields fall through to the same defaults as the other
 * drill-down installs (empty filter set, capability-off DOM shape, etc).
 */
export interface SparklineDrilldownOptions {
  readonly filters?: FilterState;
  readonly repositoriesDimension?:
    | readonly PrUrlRepositoryEntry[]
    | null
    | undefined;
  readonly webContext?: PrUrlWebContext;
  readonly authorsDimension?: readonly AuthorEntry[] | null | undefined;
  readonly commentsMetricsAvailable?: boolean;
}

/**
 * Period-scoped union envelope. Output of `buildPeriodScopedEnvelope`
 * when at least one rollup contributes a valid (prs, _prs_truncated,
 * _prs_cap) trio. See `data-model.md` § 6.
 */
interface PeriodScopedUnionEnvelope {
  readonly collected: readonly PrRecord[];
  readonly capValue: number;
  readonly anyTruncated: boolean;
  readonly totalPeriodPrCount: number;
}

type EnvelopeResult = PeriodScopedUnionEnvelope | "supported-empty";

/**
 * Walk every rollup in the active window, validate the per-rollup trio
 * (`prs` is array, `_prs_truncated` is boolean, `_prs_cap` is number),
 * and accumulate the period-scoped union per LD-1 steps 1-3.
 *
 * Any participating rollup missing the trio collapses the whole window
 * to `"supported-empty"` (mirrors reviewer-drilldown.ts:312-315). When
 * every rollup contributes but the union is empty (or no rollup carried
 * a `_prs_cap`), also returns `"supported-empty"`.
 *
 * Branch B (Q-R4 lock): structurally similar to the reviewer-drilldown
 * walk but reads rollup-level fields directly. Shared extraction was
 * disqualified at Pass 3 pre-flight because the reviewer walk's per-
 * (reviewer, week) entry shape would force a call-site restructure on
 * a regression-locked path (FR-022).
 */
function buildPeriodScopedEnvelope(rollups: readonly Rollup[]): EnvelopeResult {
  let capValue: number | undefined;
  let totalPeriodPrCount = 0;
  let anyTruncated = false;
  const collected: PrRecord[] = [];
  for (const rollup of rollups) {
    const prs = rollup.prs;
    const truncated = rollup._prs_truncated;
    const cap = rollup._prs_cap;
    if (
      !Array.isArray(prs) ||
      typeof truncated !== "boolean" ||
      typeof cap !== "number"
    ) {
      return "supported-empty";
    }
    capValue = capValue === undefined ? cap : Math.max(capValue, cap);
    totalPeriodPrCount += rollup.pr_count;
    if (truncated) anyTruncated = true;
    for (const pr of prs) {
      collected.push(pr);
    }
  }
  if (collected.length === 0 || capValue === undefined) {
    return "supported-empty";
  }
  return { collected, capValue, anyTruncated, totalPeriodPrCount };
}

/**
 * Build the period-scoped PR list section. Mirrors the classifier-driven
 * shape of `throughput-drilldown.ts:buildPrListSection` and
 * `cycle-time-drilldown.ts:buildPrListSection`. The supported branch
 * re-sorts the cross-rollup union by `cycle_time desc, id asc` (LD-1
 * step 6) and renders with `capScope: "per-rollup-union"` so the
 * truncation cue parenthetical is the #367 union copy
 * (`top {capValue} per week by cycle time`) rather than the single-
 * rollup literal.
 */
function buildPrListSectionPeriod(
  envelope: EnvelopeResult,
  filters: FilterState,
  webContext: PrUrlWebContext | undefined,
  repositoriesDimension: readonly PrUrlRepositoryEntry[] | null | undefined,
  commentsMetricsAvailable: boolean,
): PrListSection {
  const { classification } = classifyFilterState(filters, false);
  if (classification === "team") {
    return makePrListSection({ contentState: "team-inline" });
  }
  if (classification === "reviewer") {
    return makePrListSection({ contentState: "reviewer-inline" });
  }
  // supported
  if (envelope === "supported-empty" || !webContext) {
    return makePrListSection({ contentState: "supported-empty" });
  }
  const sorted = envelope.collected.slice().sort((a, b) => {
    if (b.cycle_time !== a.cycle_time) return b.cycle_time - a.cycle_time;
    return a.id - b.id;
  });
  const rows: PrListRow[] = sorted.map((pr): PrListRow => {
    if (!commentsMetricsAvailable) {
      return {
        id: pr.id,
        title: pr.title,
        cycleTimeMinutes: pr.cycle_time,
        url: resolvePrUrl(pr, repositoriesDimension, webContext),
      };
    }
    return {
      id: pr.id,
      title: pr.title,
      cycleTimeMinutes: pr.cycle_time,
      url: resolvePrUrl(pr, repositoriesDimension, webContext),
      threadCount: pr.thread_count,
      commentCount: pr.comment_count,
      activeThreadCount: pr.active_thread_count,
    };
  });
  const truncationDetected =
    envelope.anyTruncated ||
    envelope.collected.length < envelope.totalPeriodPrCount;
  const actualFilteredCount = truncationDetected
    ? envelope.totalPeriodPrCount
    : rows.length;
  return makePrListSection({
    contentState: "pr-list",
    rows,
    renderedCount: rows.length,
    actualFilteredCount,
    capValue: envelope.capValue,
    capScope: "per-rollup-union",
    commentsMetricsAvailable,
  });
}

/**
 * Period-scoped comments stat row. Local duplication of
 * `throughput-drilldown.ts:buildCommentsStatRow` — see Branch B
 * rationale in tasks.md T013. Sums the three comments-metrics fields
 * across `rows`, treating partial rows (`isPartialPrRow`) as
 * contributing 0 to each axis and incrementing the partial counter
 * that drives the `(+N partial)` annotation. When every row is
 * partial, the headline literal becomes `Pending (N)` so the absence-
 * of-data state is visible without conflating it with a true zero
 * (#331 / A1).
 */
function buildCommentsStatRowLocal(rows: readonly PrListRow[]): PanelSection {
  let threadsSum = 0;
  let commentsSum = 0;
  let unresolvedSum = 0;
  let partialCount = 0;
  for (const row of rows) {
    threadsSum += row.threadCount ?? 0;
    commentsSum += row.commentCount ?? 0;
    unresolvedSum += row.activeThreadCount ?? 0;
    if (isPartialPrRow(row)) partialCount += 1;
  }
  const allRowsPartial = partialCount > 0 && partialCount === rows.length;
  function statValue(numericTotal: number): string {
    if (allRowsPartial) return `Pending (${partialCount})`;
    if (partialCount > 0) {
      return `${numericTotal} (+${partialCount} partial)`;
    }
    return String(numericTotal);
  }
  return makeStatRow([
    { label: "Threads", value: statValue(threadsSum) },
    { label: "Comments", value: statValue(commentsSum) },
    { label: "Unresolved threads", value: statValue(unresolvedSum) },
  ]);
}

function resolveTargetCard(
  chart: "throughput" | "cycle-time",
  trigger: HTMLElement,
): "totalPrs" | "cycleP50" | "cycleP90" | null {
  if (chart === "throughput") return "totalPrs";
  const metric = trigger.getAttribute("data-drilldown-cycle-metric");
  if (metric === "p50") return "cycleP50";
  if (metric === "p90") return "cycleP90";
  return null;
}

/**
 * Build the panel content for the throughput / cycle-time sparkline
 * branch. Title resolves via `formatPeriodTitle(rollups)`; cycle-time
 * triggers append `— P50` / `— P90` based on the
 * `data-drilldown-cycle-metric` attribute. Subtitle counts the period
 * total `pr_count` (from rollups directly so it stays correct even
 * when the envelope rejects to `supported-empty`).
 */
function buildPanelContent(
  targetChart: "throughput" | "cycle-time",
  trigger: HTMLElement,
  rollups: readonly Rollup[],
  options: SparklineDrilldownOptions,
): PanelContent {
  const filters = options.filters ?? createEmptyFilterState();
  const envelope = buildPeriodScopedEnvelope(rollups);
  const commentsMetricsAvailable = options.commentsMetricsAvailable ?? false;
  const prList = buildPrListSectionPeriod(
    envelope,
    filters,
    options.webContext,
    options.repositoriesDimension,
    commentsMetricsAvailable,
  );

  const periodTitle = formatPeriodTitle(rollups);
  let title = periodTitle;
  if (targetChart === "cycle-time") {
    const metric = trigger.getAttribute("data-drilldown-cycle-metric");
    if (metric === "p50") title = `${periodTitle} — P50`;
    else if (metric === "p90") title = `${periodTitle} — P90`;
  }

  const totalPeriodPrCount = rollups.reduce((sum, r) => sum + r.pr_count, 0);
  const subtitle = `${totalPeriodPrCount} ${totalPeriodPrCount === 1 ? "PR" : "PRs"}`;

  const sections: PanelSection[] = [];
  if (commentsMetricsAvailable && prList.contentState === "pr-list") {
    sections.push(buildCommentsStatRowLocal(prList.rows));
  }
  sections.push(prList);

  return makePanelContent(title, subtitle, sections);
}

export function installSparklineNavigator(
  container: HTMLElement,
  rollups: readonly Rollup[],
  options: SparklineDrilldownOptions = {},
): { dispose(): void } {
  const controller = new AbortController();
  const { signal } = controller;
  const highlightTimers = new Set<ReturnType<typeof setTimeout>>();
  const observers = new Set<MutationObserver>();
  let activeTrigger: HTMLElement | null = null;

  function resolveTrigger(evt: Event): HTMLElement | null {
    const target = evt.target;
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>("[data-drilldown-target-chart]");
  }

  function clearAdvisoryIn(parent: HTMLElement): void {
    const existing = parent.querySelector(`.${ADVISORY_CLASS}`);
    if (existing) existing.remove();
  }

  function showAdvisoryIn(parent: HTMLElement, label: string): void {
    clearAdvisoryIn(parent);
    const slot = document.createElement("div");
    slot.className = ADVISORY_CLASS;
    parent.appendChild(slot);
    renderNoData(
      slot,
      `No full ${label} chart available on this page.`,
      "The detailed view is gated by a data-availability check.",
    );
  }

  function prefersReducedMotion(): boolean {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    return mq ? mq.matches : false;
  }

  function clearActive(): void {
    if (activeTrigger) {
      activeTrigger.classList.remove(ACTIVE_CLASS);
      // Mirrors throughput-drilldown.ts / cycle-time-drilldown.ts: aria-
      // expanded swaps in lockstep with the active class so the SR
      // state stays coherent across every dismiss path (Escape, outside
      // click, close button, filters-changed, tab-changed, comparison-
      // toggled, retarget-in-place via T016 ordering).
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
    dismissAllTooltips();

    if (isDrilldownDisabledByComparison()) {
      showComparisonAdvisoryToast(trigger);
      return;
    }

    const chart = trigger.getAttribute("data-drilldown-target-chart");
    if (
      chart !== "throughput" &&
      chart !== "cycle-time" &&
      chart !== "reviewer"
    ) {
      return;
    }
    const parent = trigger.parentElement;
    if (!parent) return;

    // Cross-card retarget cleanup: once the user is genuinely
    // navigating a known card (past the comparison-mode toast and
    // structural guards), any prior `is-drilldown-active` /
    // `aria-expanded="true"` on a previously panel-opening trigger
    // becomes stale — the user's attention has moved. This includes
    // the panel-card → reviewer-card path (panel stays open per
    // FR-002 but the previous trigger should not visually claim
    // active state) AND the missing-target advisory path (the user
    // clearly intended to navigate). The panel-open path further
    // down sets the NEW active trigger after `openDetailPanel`, so
    // this single clear handles every retarget shape.
    clearActive();

    const targetEl = document.getElementById(targetIdFor(chart));
    if (!targetEl) {
      showAdvisoryIn(parent, chartLabel(chart));
      return;
    }
    clearAdvisoryIn(parent);

    if (chart === "reviewer") {
      // PRESERVED branch (FR-002 / SC-005 regression-lock): scroll the
      // reviewer-activity chart into view + apply the short-lived
      // highlight class. Byte-equivalent to the pre-#363
      // implementation; LD-2 documents why the reviewer card cannot
      // map to a single PR set without first picking a reviewer.
      const behavior: ScrollBehavior = prefersReducedMotion()
        ? "auto"
        : "smooth";
      targetEl.scrollIntoView({ behavior, block: "center" });
      // Idempotent highlight restart: remove first so the animation
      // re-triggers even if a previous activation's timer is still
      // pending. The `void offsetWidth` reflow flush is required for
      // the class re-add to restart the CSS animation.
      targetEl.classList.remove(HIGHLIGHT_CLASS);
      void targetEl.offsetWidth;
      targetEl.classList.add(HIGHLIGHT_CLASS);
      const timer = setTimeout(() => {
        targetEl.classList.remove(HIGHLIGHT_CLASS);
        highlightTimers.delete(timer);
      }, SPARKLINE_HIGHLIGHT_MS);
      highlightTimers.add(timer);
      return;
    }

    // NEW branch (#363): throughput / cycle-time → open the period-
    // scoped DetailPanel. Retarget-in-place ordering (FR-016, T016):
    //   (1) `clearActive()` already ran above (cross-card retarget
    //       cleanup), so any previously-active trigger is cleared
    //       before the panel content swap — no observable window
    //       where both the prior and new triggers carry
    //       `is-drilldown-active`.
    //   (2) build content (pure — depends on rollups + options + the
    //       trigger's `data-drilldown-cycle-metric` attribute).
    //   (3) `openDetailPanel(context)` — single CSS transition retarget
    //       when a panel is already open; no close/reopen flicker.
    //   (4) set the new active class + aria-expanded; register the
    //       panel observer so the next external dismiss clears state.
    const targetCard = resolveTargetCard(chart, trigger);
    if (!targetCard) return;
    const content = buildPanelContent(chart, trigger, rollups, options);
    const context: DrillDownContext = {
      sourceChart: "summary-card",
      focusedData: { kind: "summary-card", targetCard },
      triggerElement: trigger,
      content,
    };

    openDetailPanel(context);
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
      for (const timer of highlightTimers) {
        clearTimeout(timer);
      }
      highlightTimers.clear();
      for (const observer of observers) {
        observer.disconnect();
      }
      observers.clear();
      clearActive();
    },
  };
}
