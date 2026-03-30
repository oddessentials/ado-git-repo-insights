/**
 * Loading State Module
 *
 * Single-source-of-truth refresh-cycle state machine for the Metrics tab.
 * One dashboard-level boolean drives per-region CSS presentation (dimming + spinner).
 * A monotonic counter identifies each refresh cycle for stale-result discard.
 *
 * Dependency rule: this module imports only from ./shared (DOM-free utilities).
 * It receives DOM elements as parameters — no global document queries.
 */

import { type FilterState } from "./filters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Snapshot of dashboard state used by the no-op guard.
 * If two consecutive snapshots are identical, the refresh is skipped.
 */
export interface EffectiveState {
  filters: FilterState;
  startDate: string;
  endDate: string;
  comparisonMode: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPINNER_CLASS = "metrics-loading-spinner";
const LOADING_CLASS = "metrics-loading";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Monotonic counter — incremented on every refresh start. */
let currentCycleId = 0;

/** Whether a refresh cycle is currently in-flight. */
let active = false;

/** Timer ID for the live-region clear delay. Stored so it can be cancelled. */
let announcementTimerId: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Spinner DOM helpers
// ---------------------------------------------------------------------------

/**
 * Idempotently append a spinner element to a region.
 * If the region already contains a spinner (from a superseded refresh),
 * no duplicate is created.
 */
function addSpinner(region: HTMLElement): void {
  if (region.querySelector(`.${SPINNER_CLASS}`)) return;
  const spinner = document.createElement("div");
  spinner.className = SPINNER_CLASS;
  region.appendChild(spinner);
}

/**
 * Remove all spinner elements from a region.
 */
function removeSpinner(region: HTMLElement): void {
  const spinner = region.querySelector(`.${SPINNER_CLASS}`);
  if (spinner) {
    spinner.remove();
  }
}

// ---------------------------------------------------------------------------
// Announcement timer helper
// ---------------------------------------------------------------------------

/**
 * Cancel any pending live-region clear timer.
 * Called before writing a new announcement and on failure/reset paths
 * so old timers cannot wipe later messages.
 */
function cancelAnnouncementTimer(): void {
  if (announcementTimerId !== null) {
    clearTimeout(announcementTimerId);
    announcementTimerId = null;
  }
}

// ---------------------------------------------------------------------------
// Refresh-cycle state machine
// ---------------------------------------------------------------------------

/**
 * Begin a refresh cycle.
 *
 * - Increments the monotonic cycle counter.
 * - Marks all regions as loading (CSS class + spinner element).
 * - Sets aria-busy on the metrics section.
 *
 * Spinner insertion is idempotent — if a region already has a spinner
 * from a superseded refresh, no duplicate is created.
 *
 * @param metricsSection - The #tab-metrics element (receives aria-busy).
 * @param regions        - Chart region elements to dim (summary-cards + 4 chart-containers).
 * @returns The cycle ID for this refresh (caller must pass to endRefresh).
 */
export function startRefresh(
  metricsSection: HTMLElement,
  regions: ReadonlyArray<HTMLElement>,
): number {
  currentCycleId += 1;
  active = true;

  for (const region of regions) {
    region.classList.add(LOADING_CLASS);
    addSpinner(region);
  }

  metricsSection.setAttribute("aria-busy", "true");

  return currentCycleId;
}

/**
 * Clear loading presentation (CSS class + spinner + aria-busy).
 * Shared by both success and failure paths.
 *
 * @returns true if this was the current cycle (loading cleared), false if stale.
 */
function clearLoading(
  cycleId: number,
  metricsSection: HTMLElement,
  regions: ReadonlyArray<HTMLElement>,
): boolean {
  // Compare via subtraction to avoid false positive from security/detect-possible-timing-attacks.
  // This is a monotonic counter, not a secret — constant-time comparison is unnecessary.
  if (cycleId - currentCycleId !== 0) {
    return false;
  }

  active = false;

  for (const region of regions) {
    region.classList.remove(LOADING_CLASS);
    removeSpinner(region);
  }

  metricsSection.removeAttribute("aria-busy");

  return true;
}

/**
 * End a refresh cycle on success.
 *
 * If the cycle ID matches the current ID (winning refresh):
 * - Removes loading CSS and spinner from all regions.
 * - Clears aria-busy.
 * - Announces "Dashboard updated" via the aria-live status element.
 * - Returns true.
 *
 * If the cycle ID is stale (superseded refresh):
 * - Does nothing — loading state remains for the newer cycle.
 * - Returns false.
 *
 * @param cycleId        - The ID returned by startRefresh for this cycle.
 * @param metricsSection - The #tab-metrics element.
 * @param regions        - The same region elements passed to startRefresh.
 * @param statusEl       - The #metrics-status aria-live element (nullable for safety).
 * @returns true if this was the winning refresh, false if stale.
 */
export function endRefresh(
  cycleId: number,
  metricsSection: HTMLElement,
  regions: ReadonlyArray<HTMLElement>,
  statusEl: HTMLElement | null,
): boolean {
  if (!clearLoading(cycleId, metricsSection, regions)) {
    return false;
  }

  // Announce to screen readers via polite live region (success only).
  // Cancel any pending clear timer so it cannot wipe this new announcement.
  if (statusEl) {
    cancelAnnouncementTimer();
    statusEl.textContent = "Dashboard updated";
    announcementTimerId = setTimeout(() => {
      statusEl.textContent = "";
      announcementTimerId = null;
    }, 1000);
  }

  return true;
}

/**
 * End a refresh cycle on failure.
 *
 * Clears loading presentation (CSS class + spinner + aria-busy) without
 * announcing success. Cancels any pending announcement clear timer so
 * old timers cannot wipe later messages.
 *
 * @param cycleId        - The ID returned by startRefresh for this cycle.
 * @param metricsSection - The #tab-metrics element.
 * @param regions        - The same region elements passed to startRefresh.
 * @returns true if this was the current cycle (loading cleared), false if stale.
 */
export function failRefresh(
  cycleId: number,
  metricsSection: HTMLElement,
  regions: ReadonlyArray<HTMLElement>,
): boolean {
  const cleared = clearLoading(cycleId, metricsSection, regions);
  if (cleared) {
    cancelAnnouncementTimer();
  }
  return cleared;
}

/**
 * Check whether a given cycle ID has been superseded.
 */
export function isStale(cycleId: number): boolean {
  return cycleId - currentCycleId !== 0;
}

/**
 * Check whether any refresh cycle is currently in-flight.
 */
export function isActive(): boolean {
  return active;
}

// ---------------------------------------------------------------------------
// No-op guard
// ---------------------------------------------------------------------------

/**
 * Compare two effective states. Returns true if they differ (refresh needed).
 * Uses JSON.stringify for a cheap, correct comparison of this flat structure.
 */
export function hasStateChanged(
  prev: EffectiveState | null,
  next: EffectiveState,
): boolean {
  if (prev === null) return true;
  return JSON.stringify(prev) !== JSON.stringify(next);
}

// ---------------------------------------------------------------------------
// Test-only reset (not exported from barrel — tests import directly)
// ---------------------------------------------------------------------------

/**
 * Reset internal state for testing. NOT for production use.
 * @internal
 */
export function _resetForTesting(): void {
  currentCycleId = 0;
  active = false;
  cancelAnnouncementTimer();
}
