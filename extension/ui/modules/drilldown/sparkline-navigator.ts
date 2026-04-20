/**
 * Sparkline navigator (US4).
 *
 * Delegated `click` + `keydown` on the summary-cards container per
 * `contracts/drilldown-integration.md`. Unlike the other three
 * drill-down consumers this module does NOT open the DetailPanel —
 * it scrolls the corresponding full chart into view and applies a
 * short-lived `is-sparkline-highlight` CSS class (duration locked at
 * `SPARKLINE_HIGHLIGHT_MS = 1500ms`).
 *
 * Target resolution is the three chart ids defined in
 * `extension/ui/index.html:238/243/251`:
 *
 *   - `throughput`  → `#throughput-chart`
 *   - `cycle-time`  → `#cycle-time-trend`
 *   - `reviewer`    → `#reviewer-activity`
 *
 * Missing target (FR-052): renders an inline advisory message
 * adjacent to the sparkline via `renderNoData` and does NOT scroll —
 * the user sees an explanation instead of a silent no-op.
 *
 * prefers-reduced-motion: resolved at activation time to pick the
 * `scrollIntoView` behavior ("auto" vs "smooth"). The CSS in
 * `styles.css` additionally disables the highlight animation when
 * reduced-motion is requested.
 */

import { SPARKLINE_HIGHLIGHT_MS } from "../shared/constants";
import { renderNoData } from "../shared/render";
import { dismissAllTooltips } from "../tooltip-manager";
import {
  isDrilldownDisabledByComparison,
  showComparisonAdvisoryToast,
} from "./comparison-advisory";

const HIGHLIGHT_CLASS = "is-sparkline-highlight";
const ADVISORY_CLASS = "sparkline-advisory";

const TARGET_ID_BY_CHART = {
  throughput: "throughput-chart",
  "cycle-time": "cycle-time-trend",
  reviewer: "reviewer-activity",
} as const;

type TargetChart = keyof typeof TARGET_ID_BY_CHART;

function targetIdFor(chart: TargetChart): string {
  // Bracket indexing via typed key — key is a sealed string-literal
  // union, so ESLint's object-injection rule is satisfied.
  if (chart === "throughput") return TARGET_ID_BY_CHART.throughput;
  if (chart === "cycle-time") return TARGET_ID_BY_CHART["cycle-time"];
  return TARGET_ID_BY_CHART.reviewer;
}

function chartLabel(chart: TargetChart): string {
  if (chart === "cycle-time") return "cycle time";
  return chart;
}

export function installSparklineNavigator(container: HTMLElement): {
  dispose(): void;
} {
  const controller = new AbortController();
  const { signal } = controller;
  const highlightTimers = new Set<ReturnType<typeof setTimeout>>();

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
    // Use an intermediate node so renderNoData's cleared-container
    // semantics don't wipe the trigger itself.
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
    // Parent-null guard. The trigger is always attached to a
    // summary-card in production, but we check once here so both
    // advisory helpers can assume a non-null parent below.
    const parent = trigger.parentElement;
    if (!parent) return;

    const targetEl = document.getElementById(targetIdFor(chart));
    if (!targetEl) {
      showAdvisoryIn(parent, chartLabel(chart));
      return;
    }
    clearAdvisoryIn(parent);

    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    targetEl.scrollIntoView({ behavior, block: "center" });

    // Idempotent highlight restart: remove the class first so the
    // animation re-triggers even if a previous activation's timer
    // hasn't fired yet.
    targetEl.classList.remove(HIGHLIGHT_CLASS);
    // Force style flush so the animation restarts on class re-add.
    void targetEl.offsetWidth;
    targetEl.classList.add(HIGHLIGHT_CLASS);
    const timer = setTimeout(() => {
      targetEl.classList.remove(HIGHLIGHT_CLASS);
      highlightTimers.delete(timer);
    }, SPARKLINE_HIGHLIGHT_MS);
    highlightTimers.add(timer);
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
    },
  };
}
