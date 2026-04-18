# Contract — Per-chart drill-down integration

**Modules affected**:
- `extension/ui/modules/drilldown/throughput-drilldown.ts` (NEW)
- `extension/ui/modules/drilldown/cycle-time-drilldown.ts` (NEW)
- `extension/ui/modules/drilldown/reviewer-drilldown.ts` (NEW)
- `extension/ui/modules/drilldown/sparkline-navigator.ts` (NEW)
- `extension/ui/modules/charts/throughput.ts` (MODIFIED — attribute surface only)
- `extension/ui/modules/charts/cycle-time.ts` (MODIFIED — attribute surface only)
- `extension/ui/modules/charts/reviewer-activity.ts` (MODIFIED — attribute surface only)
- `extension/ui/modules/charts/summary-cards.ts` (MODIFIED — sparkline wrapper buttons)

**Contract stability**: chart-module data attributes are the stable surface; the drill-down module's function names are implementation detail and may change without breaking the contract.

---

## Attribute surface (chart modules publish these)

| Chart               | Host element                    | Attributes to publish                                                                            |
|---------------------|---------------------------------|--------------------------------------------------------------------------------------------------|
| Throughput          | existing `.bar-container` div   | Existing: `data-tooltip="true"`, `data-week`, `data-count`. Add: `data-drilldown-week`, `tabindex="0"`, `role="button"`.           |
| Cycle-time trend    | existing `.line-chart-dot` SVG  | Existing: `data-tooltip="true"`, `data-week`, `data-value`, `data-metric` (values `"P50"` / `"P90"` — **uppercase**, unchanged). Add: `data-drilldown-week`, `data-drilldown-metric` (values `"p50"` / `"p90"` — **lowercase**, intentional orthogonality), `tabindex="0"`, `role="button"`. |
| Reviewer activity   | existing `.h-bar-row` div       | Add: `data-drilldown-reviewer-id`, `tabindex="0"`, `role="button"`. Title attribute preserved.   |
| Summary sparklines  | NEW `<button class="sparkline-trigger">` wrapping the SVG | `type="button"`, `data-drilldown-target-chart` (values `throughput` / `cycle-time` / `reviewer`), `aria-label` describing target chart. Sparkline-navigator resolves the scroll destination to `#throughput-chart` / `#cycle-time-trend` / `#reviewer-activity` (IDs defined in `extension/ui/index.html:238/243/251`). |

Chart modules MUST NOT reference the drill-down module directly. Chart modules MUST NOT attach click listeners themselves — listeners are owned by the drill-down modules using delegated listeners on the chart container.

---

## Drill-down module responsibilities

Each per-chart drill-down module exports exactly one function with this shape:

```ts
export function installThroughputDrilldown(container: HTMLElement, rollups: readonly Rollup[]): { dispose(): void };
export function installCycleTimeDrilldown(container: HTMLElement, rollups: readonly Rollup[]): { dispose(): void };
export function installReviewerDrilldown(container: HTMLElement, rollups: readonly Rollup[]): { dispose(): void };
export function installSparklineNavigator(container: HTMLElement): { dispose(): void };
```

### Behavior

1. **Install**: attach ONE delegated `click` listener and ONE `keydown` listener (for Enter/Space on keyboard-focused targets) to `container`. Return `{ dispose() }` that calls `abortController.abort()` to remove both.
2. **Resolve target**: on dispatch, walk `event.target` ancestors until an element with the relevant `data-drilldown-*` attribute is found.
3. **Comparison check**: if `comparison-advisory.ts` reports comparison active, dispatch to `showComparisonAdvisoryToast(targetElement)` and return — do NOT open the panel.
4. **Build context**: compose a `DrillDownContext` from the clicked attributes and the current `rollups` slice. Only use aggregate fields already present in rollups (FR-070).
5. **Handle empties**: if the breakdown is empty, construct a `PanelContent` with `EmptyStateSection` entries for every section that would have been empty — NEVER produce an empty `sections` array, NEVER hide sections silently (FR-071, FR-023, FR-041).
6. **Open panel**: call `openDetailPanel(ctx)` from the DetailPanel contract.
7. **Highlight source element**: add the `is-drilldown-active` class to the clicked target; register a cleanup hook (via `onDetailPanelDismiss` from `lifecycle-signals.ts`) that removes the class.

### Sparkline-navigator specifics (FR-050/051/052)

- Does NOT open the DetailPanel.
- On activation, resolves the scroll target by mapping `data-drilldown-target-chart` to the chart container element id: `"throughput" → "#throughput-chart"`, `"cycle-time" → "#cycle-time-trend"`, `"reviewer" → "#reviewer-activity"`; calls `element.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion)").matches ? "auto" : "smooth", block: "center" })`.
- Applies CSS class `is-sparkline-highlight` on the target chart container; class is removed via `setTimeout` after `SPARKLINE_HIGHLIGHT_MS = 1500 ms`, defined in `extension/ui/modules/shared/constants.ts`.
- When target chart is unavailable (no corresponding container — e.g. `#reviewer-activity` absent under a data-availability gap), renders an inline advisory message adjacent to the sparkline using `renderNoData` from `shared/render.ts`; does NOT scroll (FR-052).

---

## Dashboard wiring (in `dashboard.ts`)

`dashboard.ts` installs and disposes each drill-down module inside `refreshMetrics()`, **after** the existing render block at `dashboard.ts:970-974` (`renderSummaryCards` / `renderThroughputChart` / `renderCycleTimeTrend` / `renderReviewerActivity` / `renderCycleDistribution`). The wrapping local functions at `dashboard.ts:1127/1173/1213/1233` are unchanged; drill-down attaches to the already-rendered DOM and is agnostic to the dashboard's internal `*Module` import-alias convention.

```ts
// Pseudocode — actual integration point is immediately after dashboard.ts:974
for (const handle of activeDrilldownHandles) handle.dispose();
activeDrilldownHandles = [
  installThroughputDrilldown(document.getElementById("throughput-chart")!, filteredRollups),
  installCycleTimeDrilldown(document.getElementById("cycle-time-trend")!, filteredRollups),
  installReviewerDrilldown(document.getElementById("reviewer-activity")!, filteredRollups),
  installSparklineNavigator(document.querySelector(".summary-cards")!),
];
```

Install is called AFTER the render block so the DOM targets exist; dispose runs at the START of the next `refreshMetrics()` cycle to prevent listener leaks. The stable element selectors: `#throughput-chart`, `#cycle-time-trend`, `#reviewer-activity` (defined in `extension/ui/index.html:238/243/251`), and `.summary-cards` (class selector in `extension/ui/index.html:175`).

---

## Parity expectations

- Chart DOM output remains byte-identical between two hosts rendered with identical rollups — `render-equivalence.test.ts` already asserts this for the four in-scope charts. The new `data-drilldown-*` attributes are deterministic from the same inputs, so parity stays intact.
- Drill-down modules themselves are not invoked by `render-equivalence.test.ts` — the parity test renders charts, not interactions. Drill-down behavior is covered separately by per-module tests under `extension/tests/modules/drilldown/`.

---

## Accessibility

- Every click-activatable chart element MUST be reachable from keyboard: sparkline buttons are native `<button>`; existing SVG `<circle>` and `<div>` targets receive `tabindex="0"` and `role="button"` (added by chart modules in the same edit that publishes `data-drilldown-*`).
- `keydown` handler in each drill-down module triggers the same flow as `click` for `Enter` and `Space`, and calls `event.preventDefault()` on `Space` to suppress scrolling.

---

## Test obligations

Each `install*` function has a companion unit test under `extension/tests/modules/drilldown/`:

| File                                          | Minimum assertions                                                                                                   |
|-----------------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| `throughput-drilldown.test.ts`                | Click on `.bar-container` opens panel with correct title+subtitle+breakdowns; empty-breakdown path; dispose removes listeners; comparison-active path shows advisory and does not open panel. |
| `cycle-time-drilldown.test.ts`                | Click on `p50` vs `p90` dot opens distinct panels; human-readable duration formatting; repo breakdown renders.       |
| `reviewer-drilldown.test.ts`                  | Click on reviewer row opens panel; panel shows total reviews_count, total reviewed_prs, weighted approval rate (empty-state when not computable), peak repository breadth stat with qualifying week label, and per-week activity `BreakdownTableSection` with columns week / reviews_count / reviewed_prs / approval_rate; dispose cleanup; imports `computeApprovalRate` from `reviewer-activity.ts` (will be newly-exported in the same commit). |
| `sparkline-navigator.test.ts`                 | Click scrolls and highlights target; missing target surfaces advisory; keyboard activation works; highlight cleans up. |
