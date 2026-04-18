# Contract — Lifecycle signals

**Module**: `extension/ui/modules/drilldown/lifecycle-signals.ts`
**Publisher**: `extension/ui/dashboard.ts` (only)
**Subscribers**: `extension/ui/modules/shared/detail-panel.ts`, `extension/ui/modules/drilldown/comparison-advisory.ts`, per-chart drill-down modules
**Contract stability**: Sealed; new event types require a minor contract update.

---

## Events

Three typed `CustomEvent`s published on `window`:

```ts
// Event name constants (exported)
export const FILTERS_CHANGED_EVENT = "drilldown:filters-changed";
export const TAB_CHANGED_EVENT = "drilldown:tab-changed";
export const COMPARISON_TOGGLED_EVENT = "drilldown:comparison-toggled";

// Event detail shapes
export interface FiltersChangedDetail {
  readonly reason: "user-change";
}
export interface TabChangedDetail {
  readonly activeTabId: string;   // e.g. "metrics", "predictions", "ai-insights"
  readonly previousTabId: string;
}
export interface ComparisonToggledDetail {
  readonly enabled: boolean;
}

// Typed CustomEvent aliases
export type FiltersChangedEvent = CustomEvent<FiltersChangedDetail>;
export type TabChangedEvent = CustomEvent<TabChangedDetail>;
export type ComparisonToggledEvent = CustomEvent<ComparisonToggledDetail>;
```

---

## Publisher obligations (dashboard.ts only)

`dashboard.ts` MUST emit each event at exactly one code site.

| Event                     | Emit site (exact anchor)                                                      | Timing                                                            |
|---------------------------|-------------------------------------------------------------------------------|-------------------------------------------------------------------|
| `FILTERS_CHANGED_EVENT`   | Top of `refreshMetrics()` in `extension/ui/dashboard.ts` (preamble, before `applyFiltersToRollups` at line 919)                                    | ONCE per refresh cycle                                            |
| `TAB_CHANGED_EVENT`       | Inside `switchTab(tabId)` in `extension/ui/dashboard.ts`, AFTER state change, BEFORE DOM work. Tab click listeners live at dashboard.ts:734-740; `switchTab` body is what they invoke.  | ONCE per tab change; not emitted if clicked tab equals active tab |
| `COMPARISON_TOGGLED_EVENT`| Inside `toggleComparisonMode()` at dashboard.ts:1911 AND `exitComparisonMode()` at dashboard.ts:1930. Each function already calls `void refreshMetrics()` as its last step (dashboard.ts:1924 / 1935); `publishComparisonToggled` MUST fire **before** that call. | ONCE per state change                                              |

**Within-gesture ordering contract**: because `toggleComparisonMode` / `exitComparisonMode` both end with `void refreshMetrics()`, a comparison-mode change fires `COMPARISON_TOGGLED_EVENT` immediately, then `FILTERS_CHANGED_EVENT` a moment later when `refreshMetrics()` enters. DetailPanel subscribes to both; it dismisses on the comparison-toggled event with reason `"comparison-toggled"` (more specific); the subsequent filters-changed is a no-op because the panel is already closed. The comparison-advisory module uses the comparison-toggled event exclusively and ignores filters-changed.

No other module may emit these events; regression tests under `extension/tests/modules/drilldown/lifecycle-signals.test.ts` assert that the publisher is `dashboard.ts` only (via a static grep-style test that scans `extension/ui/**`).

---

## Subscriber helpers (lifecycle-signals.ts exports)

```ts
/**
 * Subscribe to filters-changed events. Returns an AbortController — call .abort()
 * to unsubscribe. Matches the idiom in tooltip-manager.ts and typeahead-dropdown.ts.
 */
export function subscribeFiltersChanged(
  handler: (event: FiltersChangedEvent) => void,
): AbortController;

export function subscribeTabChanged(
  handler: (event: TabChangedEvent) => void,
): AbortController;

export function subscribeComparisonToggled(
  handler: (event: ComparisonToggledEvent) => void,
): AbortController;

/**
 * Dispatch helpers — the ONLY legal way to emit these events. Hides CustomEvent
 * construction behind a typed API to prevent malformed details.
 */
export function publishFiltersChanged(detail: FiltersChangedDetail): void;
export function publishTabChanged(detail: TabChangedDetail): void;
export function publishComparisonToggled(detail: ComparisonToggledDetail): void;
```

---

## Subscription patterns

### DetailPanel

- On `openDetailPanel`, subscribes to all three events with a single combined handler.
- On each dismiss, aborts the subscription.
- Tab-changed handler dismisses only when `activeTabId !== "metrics"`.
- Comparison-toggled handler dismisses only when `enabled === true`.
- Filters-changed handler dismisses unconditionally (hard dismiss, FR-005).

### Comparison advisory (`comparison-advisory.ts`)

- Subscribes to `comparison-toggled` at module load (no unsubscribe lifecycle because it lives for the dashboard lifetime).
- On `enabled === true`: mounts banner note, sets `data-drilldown-disabled="comparison"` on all chart containers.
- On `enabled === false`: unmounts banner note, clears attributes.

### Chart drill-down modules

- Do NOT subscribe to these events directly. Comparison state is read through the advisory module's query API (`isDrilldownDisabledByComparison()`).

---

## Ordering guarantees

- `COMPARISON_TOGGLED_EVENT` MUST fire BEFORE any subsequent `FILTERS_CHANGED_EVENT` in the same user gesture, because the advisory must update visual state first, and any open panel must dismiss via comparison-toggled (cleaner reason code) rather than via a later filters-changed side-effect.
- `TAB_CHANGED_EVENT` emits the PREVIOUS tab id so subscribers can run tab-exit cleanup if they need to (DetailPanel does not).

---

## Non-goals

- No replay / late-subscribe semantics. An event missed (subscriber joined after emit) stays missed. This is intentional — drill-down subscribes at `openDetailPanel`, and the panel is never open before a user gesture anyway.
- No cross-window / cross-tab sync. Events are local to the current `window` object.

---

## Test obligations (in `extension/tests/modules/drilldown/lifecycle-signals.test.ts`)

| Assertion                                                                          | Notes                                                 |
|------------------------------------------------------------------------------------|-------------------------------------------------------|
| Each `publish*` helper emits the named event with the exact detail shape           | Use `jsdom` event listener                            |
| Each `subscribe*` returns an `AbortController` whose `abort()` detaches the listener| Verify handler is NOT called after abort             |
| DetailPanel reacts to each dismiss-worthy event with one call to `dismissDetailPanel` with the correct reason | Spy on `dismissDetailPanel`                  |
| `tab-changed` does NOT dismiss when `activeTabId === "metrics"` (e.g. re-selecting the same tab) | Explicit negative case                       |
| `comparison-toggled` with `enabled === false` does NOT dismiss a panel (panel can't be open anyway, but verify the handler is a no-op) | Explicit negative case |
| Static-audit test: only `extension/ui/dashboard.ts` contains the three `publish*` callsites | Grep-style test across `extension/ui/**`     |
