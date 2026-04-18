# Phase 0 Research — Chart drill-down Phase 1

**Branch**: `059-chart-drill-down`
**Date**: 2026-04-18
**Status**: Resolved — no outstanding `NEEDS CLARIFICATION` markers.

This document captures the five research themes identified during plan drafting. Each theme has a **Decision**, a **Rationale** tied to the current code state (surveyed 2026-04-18), and the **Alternatives** that were considered and rejected.

---

## R-01 — Cross-cutting lifecycle signals (filter change, tab change, comparison toggle)

### Decision

Introduce a new module `extension/ui/modules/drilldown/lifecycle-signals.ts` that:

- **Publishes** three typed `CustomEvent`s on `window`:
  - `drilldown:filters-changed` — fired from inside `refreshMetrics()` in `dashboard.ts`, at the entry point, before any re-render work.
  - `drilldown:tab-changed` — fired from inside `switchTab(tabId)` in `dashboard.ts`, with the new active tab id in `detail`.
  - `drilldown:comparison-toggled` — fired from inside `toggleComparisonMode()` / `exitComparisonMode()` in `dashboard.ts`, with the new `comparisonMode` boolean in `detail`.
- **Exposes** strongly-typed `subscribe*` helpers that each return an `AbortController`-compatible cleanup (matching the idiom used in `extension/ui/modules/tooltip-manager.ts` and `extension/ui/modules/typeahead-dropdown.ts`).

The DetailPanel subscribes to all three at open time and unsubscribes on dismiss. Chart consumers subscribe only to `drilldown:comparison-toggled` (to update their own disabled-indicator state).

### Rationale

Current state (verified 2026-04-18):

- `dashboard.ts:122` — `let comparisonMode = false;` is a module-level boolean, not exposed.
- `dashboard.ts:734-740` — tab clicks call `switchTab(tabId)` synchronously, no event emitted.
- `dashboard.ts:919` — `applyFiltersToRollups(rawRollups, currentFilters)` called inside `refreshMetrics()`; line 918 is the preceding comment. The render block that emits chart DOM lives at `dashboard.ts:970-974` (`renderSummaryCards` / `renderThroughputChart` / `renderCycleTimeTrend` / `renderReviewerActivity` / `renderCycleDistribution`). Drill-down install hooks attach AFTER that block.
- `dashboard.ts:1911-1924` — `toggleComparisonMode()` mutates the flag then calls `void refreshMetrics()` at line 1924.
- `dashboard.ts:1930-1936` — `exitComparisonMode()` mirrors the toggle and calls `void refreshMetrics()` at line 1935.
- Dashboard imports chart render functions with a local alias convention: `renderThroughputChart as renderThroughputChartModule` etc. (imports at dashboard.ts:47-52). The alias is dashboard-internal; the drill-down modules never call these render functions and never need to know about the alias.
- **No single "filters changed" event** is emitted by the typeahead onChange callbacks today.

A central typed-event channel is the smallest change that gives the DetailPanel a stable subscription point. It localizes coupling inside the drill-down feature: `dashboard.ts` gains three single-line emit calls and nothing else. The events are `window`-scoped `CustomEvent`s — no new framework — matching the `addEventListener + AbortController` idiom already in the codebase.

### Alternatives considered

- **Poll `currentFilters` / `comparisonMode` module variables from inside the panel** — rejected; requires exporting internal state and creates test-flaky timing assumptions.
- **Reuse existing `onChange` callbacks** — rejected; every typeahead would need DetailPanel wiring, spreading coupling across every filter control. Each new filter would need to be remembered and extended.
- **Introduce a full observable / state-management library** — rejected; adds a runtime dependency for a three-event surface.

---

## R-02 — Click-target wiring across the four charts

### Decision

Per chart, the drill-down glue attaches a delegated click listener to the chart container (not individual data points), inspects `event.target`'s `data-drilldown-*` attributes to resolve the click, and dispatches to `openDetailPanel(context)` — or, in comparison mode, delegates to the comparison advisory handler.

Concrete wiring:

- **Throughput (`charts/throughput.ts`)**: reuse existing `.bar-container` elements at `throughput.ts:97`. Add `data-drilldown-week` in addition to the existing `data-week` / `data-count` so the drill-down module has a stable selector and does not conflict with the tooltip system.
- **Cycle-time trend (`charts/cycle-time.ts`)**: reuse existing `.line-chart-dot` SVG circles at `cycle-time.ts:285-286`. Existing `data-metric` attribute values are `"P50"` / `"P90"` (uppercase — unchanged). New drill-down attributes `data-drilldown-week` and `data-drilldown-metric` use lowercase values (`"p50"` / `"p90"`) to stay orthogonal to the existing tooltip attribute. The two attributes coexist on the same element; drill-down listeners read `data-drilldown-metric` only.
- **Reviewer activity (`charts/reviewer-activity.ts`)**: add `data-drilldown-reviewer-id` to `.h-bar-row` at `reviewer-activity.ts:180`. Current `title=` is preserved for non-interactive tooltip fallback. Separately, the existing module-internal function `computeApprovalRate` (declared at `reviewer-activity.ts:34`, used internally at `reviewer-activity.ts:210`) MUST be made `export` in the same edit so `reviewer-drilldown.ts` can reuse it without duplication.
- **Summary-card sparklines (`charts/summary-cards.ts`)**: wrap each sparkline SVG in a `<button class="sparkline-trigger" data-drilldown-target-chart="throughput|cycle-time|reviewer">` so keyboard activation works (Enter / Space on a button is native) and semantic role is clear. The button is visually transparent; the sparkline SVG remains inside it. The sparkline-navigator's scroll target is resolved via the chart container element IDs `#throughput-chart`, `#cycle-time-trend`, `#reviewer-activity` (defined at `extension/ui/index.html:238/243/251`).

### Rationale

- Delegated listeners at the chart-container level keep attach/detach cheap and avoid listener-churn when charts re-render.
- Prefixing new attributes with `data-drilldown-*` keeps them orthogonal to `data-tooltip` / `data-week` already used by the tooltip subsystem — no namespace collision, easy to grep.
- Wrapping sparklines in `<button>` elements is the simplest path to keyboard accessibility without inventing new tabindex handling (FR-050 requires keyboard activation).

### Alternatives considered

- **Per-element `click` listeners** — rejected; churn on every re-render, higher listener count.
- **Synthesize a new DOM-event type (`drilldown:request`) from the chart modules themselves** — rejected; pushes the drill-down concept into charts and breaks separation of concerns.
- **Reuse `data-week` / `data-count` directly without adding `data-drilldown-*`** — rejected; the drill-down selector would be ambiguous with tooltip matching and small future tooltip changes could silently break drill-down.

---

## R-03 — Focus management (trap + return)

### Decision

Introduce `extension/ui/modules/shared/focus-trap.ts` that:

- `trapFocus(root: HTMLElement): AbortController` — on call, records `document.activeElement` as the return target, listens for `keydown` within `root`, and cycles Tab/Shift-Tab through `root`'s focusable descendants. Exposes a companion `restoreFocus(controller)` that aborts and restores focus.
- Internally queries focusable elements via the standard selector set (`[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])`) evaluated at trap time.

DetailPanel calls `trapFocus(panelRoot)` on open and `restoreFocus` on dismiss; the focused element before open regains focus after close (FR-008).

### Rationale

- No pre-existing focus-trap module exists (survey: "The drill-down panel will introduce this as a new pattern"). Building one is unavoidable for FR-007 + FR-008.
- `AbortController` idioms already in use: `tooltip-manager.ts:17-30` (scroll/resize listeners), `typeahead-dropdown.ts:74-76` (dropdown lifecycle). New module follows the same shape, making review and future reuse mechanical.
- Factored into `shared/` so Phase 2 (PR-level detail panel, comparison-mode drill-down) and future unrelated overlays can reuse it.

### Alternatives considered

- **Inline focus trap inside DetailPanel** — rejected; not reusable and harder to unit-test.
- **Pull in a third-party focus-trap library** — rejected; adds a runtime dependency for ~60 lines of code and conflicts with the zero-new-dependencies constraint in Technical Context.

---

## R-04 — Panel rendering contract (DOM, section model, parity testing)

### Decision

- **DOM root**: single `<aside class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-panel-title">` appended to `document.body` once per dashboard lifecycle. Subsequent opens update content and toggle an `is-open` class; close hides via class toggle, does NOT remove from DOM.
- **Content contract** (documented in `contracts/detail-panel-api.md`):
  ```ts
  type PanelSection =
    | { type: "breakdown-table"; title: string; columns: readonly [string, string, ...string[]]; rows: readonly PanelRow[] }
    | { type: "stat-row"; stats: readonly PanelStat[] }
    | { type: "empty-state"; title: string; detail: string };
  // Sealed today; Phase 2 extends with `pr-list`, `mini-chart` variants.
  ```
- **Render-equivalence integration**: add idempotency cases to `extension/tests/parity/render-equivalence.test.ts` (Layer A starts at line 104; the existing per-chart idempotency pattern at lines 105-115 for throughput is the template) that compare `a.innerHTML` vs `b.innerHTML` for the DetailPanel after the same open call on two separate hosts. Panel re-rendering for identical input MUST produce identical HTML.
- **Animation**: CSS transition on `transform: translateX(...)` via the `is-open` class toggle; respects `prefers-reduced-motion`. No JavaScript animation loop.

### Rationale

- Single persistent root avoids the attach-detach perf cost and lets the parity test use the same `innerHTML`-compare approach proven in `render-equivalence.test.ts:105-115`.
- The discriminated-union content contract is the Phase 2 extension point specified in FR-003 (A-007 in spec). Sealing today forces future variants to go through a typed update rather than stringly-typed properties.
- CSS-driven animation honors the existing codebase convention (no JS animation loops found in `extension/ui/modules/` during survey) and auto-disables under reduced-motion.

### Alternatives considered

- **Attach/detach panel on each open** — rejected; higher GC churn and harder to drive an idempotency parity assertion.
- **Use a third-party dialog primitive (`<dialog>` element with modal showing)** — rejected; `<dialog>` modal behavior diverges between Chromium/Firefox/WebKit for body scroll and backdrop click; we need fully deterministic DOM for parity tests.

---

## R-05 — Comparison-mode disabled UX

### Decision

Three-layer visible cue, each layer reinforcing the other so the state never feels silent or broken:

1. **Interaction affordance**: while `comparisonMode === true`, the three chart container elements (`#throughput-chart`, `#cycle-time-trend`, `#reviewer-activity`, plus `.summary-cards`) gain a `data-drilldown-disabled="comparison"` attribute. CSS uses this attribute to render a subdued interactive appearance on the clickable descendants (pointer cursor → default cursor, slight opacity), signaling "not clickable right now."
2. **Attempted-interaction feedback**: a click on a disabled target still dispatches, but the drill-down glue intercepts, checks the attribute, and surfaces a short, non-modal toast-style message near the clicked element: "Drill-down is unavailable during comparison. Exit comparison to use it." The message is auto-dismissed after `COMPARISON_ADVISORY_TOAST_MS = 4000 ms` (constant defined in `extension/ui/modules/shared/constants.ts`) or on next interaction.
3. **Comparison banner co-location**: when comparison mode activates, a one-line explanatory note is mounted in the existing comparison banner region (next to the formatted `formatDateRangeDisplay` output from `comparison.ts`): "Drill-down is paused while comparison is active." The note is unmounted when comparison exits.

The same advisory text is used in all three layers so there's no wording drift. Sparkline highlight duration (separate from the toast) is `SPARKLINE_HIGHLIGHT_MS = 1500 ms`, also defined in `shared/constants.ts`.

### Rationale

- Spec FR-061 requires visible communication **before** any attempted interaction AND on attempt. A single surface can't cover both pre-attempt and on-attempt; three coordinated surfaces do.
- Placing the persistent note in the existing comparison banner avoids introducing a new persistent UI region and keeps the surface tied to the feature that caused the change.
- The transient toast on click provides immediate feedback when a user ignores or misses the banner note.

### Alternatives considered

- **Silently disable click listeners during comparison** — rejected; spec FR-061 explicitly forbids silent no-op.
- **Block comparison mode from being entered at all while a panel is open** — rejected; inverts the user's intent; spec owner decision was "disable drill-down," not "disable comparison."
- **Modal blocking popup on click** — rejected; heavy-handed; the user already knows comparison is active, so a light toast is sufficient.

---

## Cross-cutting notes

- **No new dependencies**. All five themes resolve without adding a package.
- **No typing.Any / no suppressions**. Each new module exports typed functions or interfaces; discriminated unions replace the need for `any`.
- **All tests land in Jest under `extension/tests/`**. Same-commit `.test-floor-contract.json` bump of `extension.min_collected` by the exact new-case count is an unwaivable per-commit requirement (QG-43). Partial-branch baseline co-change, if needed, lands the same commit (QG-5x adjacent).
- **Cross-OS applicability**: all new code is browser-DOM only. No `os.*` / platform checks in any path.

---

## Data-availability gap (resolved)

Pass 3 / Pass 4 verification surfaced that `ReviewerBreakdownEntry` in `extension/ui/schemas/rollup.schema.ts` contains only `{reviewed_prs, reviews_count, approval_rate?, authors_count?, repositories_count?}`. There is **no per-reviewer-per-repository listing** in Phase 1 aggregates; a proper per-repository breakdown of a single reviewer's activity would require a new cross-dimensional aggregate (reviewer × repository), which is explicitly deferred to issue #300. Phase 1 therefore surfaces `repositories_count` as a "peak repository breadth" stat (the highest value observed in any single week of the active period) rather than a table. FR-042 and FR-043 in `spec.md` have been tightened accordingly during the hardening pass.

## Outstanding items

**None.** All themes resolved to a concrete decision; Phase 1 contracts and Phase 2 tasks can proceed without further clarification.
