/**
 * Comparison-mode drill-down advisory.
 *
 * Handles the user-visible side of the FR-060 / FR-061 / FR-062 contract:
 * while comparison mode is active, drill-down is disabled and the user
 * sees three coordinated cues (per research.md R-05):
 *
 *   1. Interaction affordance — `data-drilldown-disabled="comparison"`
 *      is set on the four chart container elements (#throughput-chart,
 *      #cycle-time-trend, #reviewer-activity, .summary-cards) so CSS
 *      can render a subdued affordance on the clickable descendants.
 *   2. Persistent banner note — mounted inside the existing comparison
 *      banner region whenever comparison activates.
 *   3. Transient on-attempt toast — showComparisonAdvisoryToast() places
 *      a short, auto-dismissing message near the clicked chart element
 *      when a drill-down click is intercepted during comparison.
 *
 * Subscriptions: a lifetime COMPARISON_TOGGLED_EVENT listener attached
 * at module load. No unsubscribe — this module lives for the dashboard
 * lifetime and must not leak listeners across dashboard re-inits.
 */

import { dismissDetailPanel, isDetailPanelOpen } from "../shared/detail-panel";
import { COMPARISON_ADVISORY_TOAST_MS } from "../shared/constants";
import { createElement, clearElement } from "../shared/render";
import {
  COMPARISON_TOGGLED_EVENT,
  type ComparisonToggledEvent,
} from "./lifecycle-signals";

const CHART_CONTAINER_IDS = [
  "throughput-chart",
  "cycle-time-trend",
  "reviewer-activity",
] as const;

const SUMMARY_CARDS_SELECTOR = ".summary-cards";
const COMPARISON_BANNER_ID = "comparison-banner";
const BANNER_NOTE_CLASS = "comparison-advisory-banner";
const TOAST_CLASS = "comparison-advisory-toast";
const DISABLED_ATTR = "data-drilldown-disabled";
const DISABLED_VALUE = "comparison";

// PR #302 P1.H — banner and toast carry DIFFERENT copy so SRs never
// hear the same advisory twice in quick succession (banner on comparison
// activate + toast on the subsequent click attempt). Banner is a
// steady-state declaration; toast is an action acknowledgement with an
// imperative next step.
const BANNER_MESSAGE = "Chart details are unavailable during comparison.";
const TOAST_MESSAGE = "Exit comparison to open chart details.";

let isActive = false;
let activeToast: HTMLElement | null = null;
let activeToastTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Public query + toast API
// ---------------------------------------------------------------------------

export function isDrilldownDisabledByComparison(): boolean {
  return isActive;
}

/**
 * Show a transient advisory toast anchored near `target`. If a toast is
 * already visible it is replaced in place (no stacking).
 */
export function showComparisonAdvisoryToast(target: HTMLElement): void {
  // Replace any in-flight toast so messages never stack.
  dismissActiveToast();

  // PR #302 P1.H — the toast fires in direct response to a blocked
  // user click; FR-061 frames this as an interruption acknowledgement,
  // so role="alert" + aria-live="assertive" is the WCAG 4.1.3 pairing
  // for "interrupt current speech to report that a user action was
  // ignored". Banner stays polite (role="status" in mountBanner below).
  const toast = createElement(
    "div",
    {
      class: TOAST_CLASS,
      role: "alert",
      "aria-live": "assertive",
    },
    TOAST_MESSAGE,
  );
  document.body.appendChild(toast);
  positionToastNear(toast, target);

  activeToast = toast;
  activeToastTimer = setTimeout(() => {
    if (activeToast === toast) {
      dismissActiveToast();
    }
  }, COMPARISON_ADVISORY_TOAST_MS);
}

function dismissActiveToast(): void {
  if (activeToastTimer !== null) {
    clearTimeout(activeToastTimer);
    activeToastTimer = null;
  }
  if (activeToast && activeToast.isConnected) {
    activeToast.remove();
  }
  activeToast = null;
}

function positionToastNear(toast: HTMLElement, target: HTMLElement): void {
  // Fixed-positioned toast placed just above the clicked element when
  // there's room, otherwise below. Horizontal center clamps to viewport.
  const rect = target.getBoundingClientRect();
  toast.style.position = "fixed";
  toast.style.visibility = "hidden";

  // Let layout compute so we can measure.
  const toastRect = toast.getBoundingClientRect();
  const gap = 8;
  let top = rect.top - toastRect.height - gap;
  if (top < 0) top = rect.bottom + gap;
  if (top + toastRect.height > window.innerHeight) {
    top = Math.max(4, window.innerHeight - toastRect.height - 4);
  }
  let left = rect.left + rect.width / 2 - toastRect.width / 2;
  if (left < 4) left = 4;
  if (left + toastRect.width > window.innerWidth - 4) {
    left = Math.max(4, window.innerWidth - toastRect.width - 4);
  }

  toast.style.top = `${top}px`;
  toast.style.left = `${left}px`;
  toast.style.visibility = "";
}

// ---------------------------------------------------------------------------
// DOM side effects — banner mount and chart-container disabled attribute
// ---------------------------------------------------------------------------

function getChartContainers(): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const id of CHART_CONTAINER_IDS) {
    const el = document.getElementById(id);
    if (el) out.push(el);
  }
  const summary = document.querySelector<HTMLElement>(SUMMARY_CARDS_SELECTOR);
  if (summary) out.push(summary);
  return out;
}

function mountBanner(): void {
  const banner = document.getElementById(COMPARISON_BANNER_ID);
  if (!banner) return;
  if (banner.querySelector(`.${BANNER_NOTE_CLASS}`)) return; // idempotent
  // PR #302 P1.H — role="status" + aria-live="polite" so SRs announce
  // the persistent state change at the moment comparison activates
  // (WCAG 4.1.3 pattern). The previous role="note" was silent for SRs
  // because role=note is not a live region. Remount on disable→enable
  // creates a new live-region element, re-announcing — that is the
  // desired cadence per FR-061 ("visible, persistent cue MUST appear"
  // at every activation).
  const note = createElement(
    "div",
    { class: BANNER_NOTE_CLASS, role: "status", "aria-live": "polite" },
    BANNER_MESSAGE,
  );
  banner.appendChild(note);
}

function unmountBanner(): void {
  const banner = document.getElementById(COMPARISON_BANNER_ID);
  if (!banner) return;
  const note = banner.querySelector(`.${BANNER_NOTE_CLASS}`);
  if (note) {
    note.remove();
  }
}

function setChartDisabled(enabled: boolean): void {
  for (const el of getChartContainers()) {
    if (enabled) {
      el.setAttribute(DISABLED_ATTR, DISABLED_VALUE);
    } else {
      el.removeAttribute(DISABLED_ATTR);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifetime event subscription (module load)
// ---------------------------------------------------------------------------

const comparisonListener: EventListener = (evt) => {
  const e = evt as ComparisonToggledEvent;
  if (e.detail.enabled) {
    isActive = true;
    mountBanner();
    setChartDisabled(true);
    if (isDetailPanelOpen()) {
      dismissDetailPanel("comparison-toggled");
    }
  } else {
    isActive = false;
    unmountBanner();
    setChartDisabled(false);
    dismissActiveToast();
  }
};

window.addEventListener(COMPARISON_TOGGLED_EVENT, comparisonListener);

// ---------------------------------------------------------------------------
// Test-only reset helper
// ---------------------------------------------------------------------------

/**
 * Reset in-memory state. Intended for unit tests that tear down the DOM
 * between cases; production code never calls this.
 */
export function __resetComparisonAdvisoryForTests(): void {
  isActive = false;
  dismissActiveToast();
  // Clear any leftover chart attributes and banner notes from the prior test.
  setChartDisabled(false);
  unmountBanner();
}

// Satisfy noUnusedLocals for the helper import when the clearElement path is
// not exercised (currently only used indirectly via createElement child sets).
void clearElement;
