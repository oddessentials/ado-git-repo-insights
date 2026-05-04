/**
 * Drill-down lifecycle signals.
 *
 * Typed CustomEvent publish / subscribe layer that lets the DetailPanel
 * and comparison-advisory modules subscribe to dashboard-level state
 * transitions without importing dashboard internals.
 *
 *   - publisher: `extension/ui/dashboard.ts` only
 *   - subscribers: DetailPanel (open-scoped), comparison-advisory (lifetime)
 *   - transport: `window` CustomEvent
 *   - cleanup idiom: AbortController returned by subscribe helpers
 *
 * Within-gesture ordering is guaranteed by the emit sites in dashboard.ts:
 * `publishComparisonToggled` is called BEFORE the existing
 * `void refreshMetrics()` tail in `toggleComparisonMode()` /
 * `exitComparisonMode()`, so subscribers see the comparison event before
 * the filters-changed event that refreshMetrics emits.
 */

export const FILTERS_CHANGED_EVENT = "drilldown:filters-changed";
export const TAB_CHANGED_EVENT = "drilldown:tab-changed";
export const COMPARISON_TOGGLED_EVENT = "drilldown:comparison-toggled";

export interface FiltersChangedDetail {
  readonly reason: "user-change";
}

export interface TabChangedDetail {
  readonly activeTabId: string;
  readonly previousTabId: string;
}

export interface ComparisonToggledDetail {
  readonly enabled: boolean;
}

export type FiltersChangedEvent = CustomEvent<FiltersChangedDetail>;
export type TabChangedEvent = CustomEvent<TabChangedDetail>;
export type ComparisonToggledEvent = CustomEvent<ComparisonToggledDetail>;

// ---------------------------------------------------------------------------
// Publishers — the only legal way to emit these events.
// ---------------------------------------------------------------------------

export function publishFiltersChanged(detail: FiltersChangedDetail): void {
  window.dispatchEvent(
    new CustomEvent<FiltersChangedDetail>(FILTERS_CHANGED_EVENT, { detail }),
  );
}

export function publishTabChanged(detail: TabChangedDetail): void {
  window.dispatchEvent(
    new CustomEvent<TabChangedDetail>(TAB_CHANGED_EVENT, { detail }),
  );
}

export function publishComparisonToggled(
  detail: ComparisonToggledDetail,
): void {
  window.dispatchEvent(
    new CustomEvent<ComparisonToggledDetail>(COMPARISON_TOGGLED_EVENT, {
      detail,
    }),
  );
}

// ---------------------------------------------------------------------------
// Subscribers — return AbortController for cleanup symmetry with
// tooltip-manager.ts and typeahead-dropdown.ts.
// ---------------------------------------------------------------------------

export function subscribeFiltersChanged(
  handler: (event: FiltersChangedEvent) => void,
): AbortController {
  const controller = new AbortController();
  window.addEventListener(FILTERS_CHANGED_EVENT, handler as EventListener, {
    signal: controller.signal,
  });
  return controller;
}

export function subscribeTabChanged(
  handler: (event: TabChangedEvent) => void,
): AbortController {
  const controller = new AbortController();
  window.addEventListener(TAB_CHANGED_EVENT, handler as EventListener, {
    signal: controller.signal,
  });
  return controller;
}

export function subscribeComparisonToggled(
  handler: (event: ComparisonToggledEvent) => void,
): AbortController {
  const controller = new AbortController();
  window.addEventListener(COMPARISON_TOGGLED_EVENT, handler as EventListener, {
    signal: controller.signal,
  });
  return controller;
}
