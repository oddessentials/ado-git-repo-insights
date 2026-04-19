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
import { dismissAllTooltips } from "../tooltip-manager";
import {
  makeBreakdownTable,
  makeEmptyState,
  makePanelContent,
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

const ACTIVE_CLASS = "is-drilldown-active";

/**
 * Parse a `YYYY-MM-DD` string as a LOCAL-midnight Date.
 *
 * Two correctness guards:
 *
 * 1. We construct the Date with local-time `new Date(y, m, d)` rather
 *    than `new Date(isoString)` (which interprets as UTC midnight and
 *    then `toLocaleDateString` shifts the displayed day west of UTC).
 * 2. `new Date(...)` silently rolls impossible calendar dates over
 *    (e.g. `new Date(2025, 1, 31)` → `Mar 3 2025`). We round-trip the
 *    y/m/d fields through the Date and reject any input whose
 *    round-trip did not match — the caller then falls back to the ISO-
 *    week computation instead of rendering a wrong week title.
 */
function parseIsoLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Compute the Monday–Sunday calendar date range for an ISO 8601 week
 * key (e.g. "2025-W12"). ISO anchor: Jan 4 is always in week 1.
 *
 * Returns null on an unparseable key or a weekNum outside 1–53.
 *
 * Dates are pinned to LOCAL midnight of the target calendar day so
 * downstream callers (which format via `toLocaleDateString` without a
 * `timeZone` override — see `shared/format.formatDateRange`) render the
 * same calendar day regardless of the user's timezone.
 *
 * This is a FALLBACK for rollups that are missing `start_date` /
 * `end_date`. The authoritative source is the pipeline-written pair on
 * the rollup itself (see `formatWeekTitle`).
 */
function isoWeekRange(week: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNum = Number(match[2]);
  if (weekNum < 1 || weekNum > 53) return null;
  const jan4 = new Date(year, 0, 4);
  // Convert JS day-of-week (Sun=0..Sat=6) to ISO Mon-relative offset (Mon=0..Sun=6).
  const mondayOffset = (jan4.getDay() + 6) % 7;
  const start = new Date(jan4);
  start.setDate(jan4.getDate() - mondayOffset + (weekNum - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/**
 * Format a Monday/Sunday pair as a condensed week-range string matching
 * the spec example in `specs/059-chart-drill-down/data-model.md`:
 * `"Mar 18 – 24, 2025"` (same-month), `"Mar 31 – Apr 6, 2025"` (cross-
 * month), `"Dec 30, 2024 – Jan 5, 2025"` (cross-year). Uses the
 * short-month / numeric-day locale output via `toLocaleDateString`.
 */
function formatWeekRangeTitle(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear !== endYear) {
    return (
      `${startMonth} ${start.getDate()}, ${startYear} – ` +
      `${endMonth} ${end.getDate()}, ${endYear}`
    );
  }
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${startYear}`;
  }
  return (
    `${startMonth} ${start.getDate()} – ` +
    `${endMonth} ${end.getDate()}, ${startYear}`
  );
}

/**
 * Format the panel title from the rollup's authoritative
 * `start_date` / `end_date` fields (written by `aggregators.py`
 * `WeeklyRollup`). Falls back to recomputing from the ISO week key
 * only when those fields are absent or unparseable — such rollups
 * predate the current schema and should be rare.
 */
function formatWeekTitle(rollup: Rollup): string {
  const start = rollup.start_date ? parseIsoLocalDate(rollup.start_date) : null;
  const end = rollup.end_date ? parseIsoLocalDate(rollup.end_date) : null;
  if (start && end) {
    return `Week of ${formatWeekRangeTitle(start, end)}`;
  }
  const range = isoWeekRange(rollup.week);
  if (!range) return `Week ${rollup.week}`;
  return `Week of ${formatWeekRangeTitle(range.start, range.end)}`;
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

function buildPanelContent(rollup: Rollup): PanelContent {
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
  return makePanelContent(formatWeekTitle(rollup), subtitle, [
    byAuthor,
    byRepository,
  ]);
}

export function installThroughputDrilldown(
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
    // `closest` walks from target upward; since the listener is on
    // `container`, any match is guaranteed to be a descendant of container
    // (target itself is a descendant, and ancestors walked up pass through
    // container on the way to document).
    return target.closest<HTMLElement>("[data-drilldown-week]");
  }

  function clearActive(): void {
    if (activeTrigger) {
      activeTrigger.classList.remove(ACTIVE_CLASS);
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
      content: buildPanelContent(rollup),
    };

    openDetailPanel(context);

    clearActive();
    activeTrigger = trigger;
    trigger.classList.add(ACTIVE_CLASS);
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
