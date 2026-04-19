---
description: "Task list for 059-chart-drill-down — Phase 1 cohort (shared DetailPanel + four chart consumers)"
---

# Tasks: Chart drill-down — Phase 1

**Input**: Design documents in `specs/059-chart-drill-down/`
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/detail-panel-api.md`, `contracts/drilldown-integration.md`, `contracts/lifecycle-signals.md`, `quickstart.md`

**Tests**: Included throughout. This repo's constitution (QG-42) and the user's standing "enterprise test coverage" invariant mandate comprehensive Jest coverage for every new module, behavior, and integration seam. Treat tests as required artifacts of each phase, not optional.

**Ratchet discipline (non-negotiable per QG-43 and user memory)**: every commit that adds Jest cases MUST bump `.test-floor-contract.json` `extension.min_collected` by the exact new-case count in the **same commit**. The ratchet-bump task at the end of each phase explicitly owns that delta so nothing slips.

**Organization**: tasks grouped by user story (US1 throughput = P1 MVP, US2 cycle-time = P2, US3 reviewer = P3, US4 sparkline = P4). Foundation phase delivers the shared infrastructure every user story depends on.

## Format: `- [ ] TaskID [P?] [Story?] Description with file path`

- `[P]` — may run in parallel (different files, no unmet dependency)
- `[USn]` — user-story label, required for user-story phase tasks
- File paths are absolute within the repo

---

## Phase 1: Setup

**Purpose**: establish a clean working state and baseline measurement before any edits.

- [X] T001 Verify branch `059-chart-drill-down` is checked out with a clean working tree; confirm `git status` shows only the `specs/059-chart-drill-down/` planning artifacts as untracked/modified
- [X] T002 [P] Record pre-change baselines for reference: capture current `.test-floor-contract.json` `extension.min_collected` value and current `.coverage-partial-branches-baseline.json` content; save to a scratchpad (do NOT commit) so each phase's ratchet delta is easy to compute

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: ship the four shared infrastructure pieces every user story builds on — lifecycle signals, focus trap, DetailPanel core, comparison advisory.

**⚠️ CRITICAL**: no user-story phase may begin until this phase is complete and tests are green.

**Commit boundaries in this phase**:
- Commit A: lifecycle-signals module + dashboard emit sites + tests + floor bump (T003–T008)
- Commit B: focus-trap module + tests + floor bump (T009–T012)
- Commit C: DetailPanel core + CSS + tests + render-equivalence parity + floor bump (T013–T018)
- Commit D: comparison-advisory module + CSS + dashboard init + tests + floor bump (T019–T023)

### Step 1 — Lifecycle signals (Commit A)

- [X] T003 [P] Create `extension/ui/modules/drilldown/index.ts` as a barrel file exporting the other drilldown modules as they are added in later phases (start with an empty re-export placeholder)
- [X] T004 Create `extension/ui/modules/drilldown/lifecycle-signals.ts` per `contracts/lifecycle-signals.md`: define `FILTERS_CHANGED_EVENT`, `TAB_CHANGED_EVENT`, `COMPARISON_TOGGLED_EVENT` constants; define `FiltersChangedDetail` / `TabChangedDetail` / `ComparisonToggledDetail` interfaces; define `FiltersChangedEvent` / `TabChangedEvent` / `ComparisonToggledEvent` CustomEvent type aliases; implement `publishFiltersChanged` / `publishTabChanged` / `publishComparisonToggled` helpers; implement `subscribeFiltersChanged` / `subscribeTabChanged` / `subscribeComparisonToggled` helpers returning AbortController matching the idiom in `extension/ui/modules/tooltip-manager.ts`
- [X] T005 Add `publishFiltersChanged({ reason: "user-change" })` call at the top of `refreshMetrics()` in `extension/ui/dashboard.ts` — emit BEFORE the `applyFiltersToRollups(...)` call at dashboard.ts:919
- [X] T006 Add `publishTabChanged({ activeTabId, previousTabId })` call inside `switchTab(tabId)` in `extension/ui/dashboard.ts` — track previous tab id through a module-level variable or closure; emit AFTER the active-tab state mutation, BEFORE DOM work; skip emit when `activeTabId === previousTabId`. The tab click handlers live at dashboard.ts:734-740; `switchTab` is the function they invoke.
- [X] T007 Add `publishComparisonToggled({ enabled })` calls inside both `toggleComparisonMode()` at dashboard.ts:1911 and `exitComparisonMode()` at dashboard.ts:1930 — emit AFTER the `comparisonMode = …` mutation and BEFORE the existing `void refreshMetrics()` call (dashboard.ts:1924 / 1935) so the comparison-toggled event precedes the filters-changed event per the contract's within-gesture ordering guarantee
- [X] T008 Create `extension/tests/modules/drilldown/lifecycle-signals.test.ts`: (a) each `publish*` helper emits the named event with the exact detail shape; (b) each `subscribe*` returns an AbortController whose `abort()` detaches the listener (handler NOT called afterward); (c) static grep-style audit asserts `publishFiltersChanged`, `publishTabChanged`, `publishComparisonToggled` callsites exist only in `extension/ui/dashboard.ts` within the `extension/ui/**` tree; (d) `TabChangedEvent` carries the previous tab id; (e) double-emit suppression when tab id did not change
- [X] T009 Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest test cases added by T008; commit T003–T009 together (Commit A)

### Step 2 — Focus trap (Commit B)

- [X] T010 [P] Create `extension/ui/modules/shared/focus-trap.ts` per `research.md` R-03: implement `trapFocus(root: HTMLElement): AbortController` that records `document.activeElement` as the return target, listens for `keydown` within `root`, cycles Tab/Shift-Tab through focusable descendants using the standard focusable selector (`[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])`); export a companion `restoreFocus(controller: AbortController)` that aborts and restores focus to the recorded element
- [X] T011 [P] Add `export * from "./focus-trap";` to `extension/ui/modules/shared/index.ts`
- [X] T012 [P] Create `extension/tests/modules/shared/focus-trap.test.ts`: forward-cycle test with three mock focusable elements; backward-cycle test; abort restores original `document.activeElement`; non-focusable descendants are skipped; trap on an empty root throws no errors and leaves focus unchanged
- [X] T013 Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest cases added by T012; commit T010–T013 together (Commit B)

### Step 3 — DetailPanel core (Commit C)

- [X] T014 Add `SPARKLINE_HIGHLIGHT_MS = 1500` and `COMPARISON_ADVISORY_TOAST_MS = 4000` constants (exported) to `extension/ui/modules/shared/constants.ts`; these are the concrete Pass-4-resolved durations referenced by `sparkline-navigator.ts` and `comparison-advisory.ts`. Then create `extension/ui/modules/shared/detail-panel.ts` per `contracts/detail-panel-api.md`: export all types (`PanelContent`, `PanelSection` sealed discriminated union with `BreakdownTableSection` / `StatRowSection` / `EmptyStateSection`, `PanelRow`, `PanelStat`, `DrillDownContext`, `DismissReason`); implement construction helpers (`makePanelContent`, `makeBreakdownTable`, `makeStatRow`, `makeEmptyState`) with runtime validation that throws `TypeError` on empty title, empty sections, or row-length != columns-length - 1; implement lifecycle (`openDetailPanel`, `dismissDetailPanel`, `isDetailPanelOpen`) following the state machine in `data-model.md` §5a; on open, subscribe to all three lifecycle signals via `lifecycle-signals.ts` helpers and call `trapFocus` on the panel root; on dismiss, abort all subscriptions and call `restoreFocus`; panel DOM root is a single `<aside>` lazily appended to `document.body`; opens after the first open update content via idempotent render and toggle `is-open` class
- [X] T015 Add panel CSS to `extension/ui/styles.css`: `.detail-panel` base layout + right-edge positioning; `.detail-panel.is-open` with `transform: translateX(0)` transition; section-type classes `.detail-panel-section--breakdown-table` / `--stat-row` / `--empty-state`; `@media (prefers-reduced-motion: reduce)` override that disables the transition; ensure styles do not leak into chart areas
- [X] T016 Add `export * from "./detail-panel";` to `extension/ui/modules/shared/index.ts`
- [X] T017 Create `extension/tests/modules/shared/detail-panel.test.ts`: construction helpers validate invariants (empty title → TypeError; empty sections → TypeError; row/column length mismatch → TypeError); `openDetailPanel` renders expected DOM for each section type; `dismissDetailPanel` closes with each `DismissReason` and restores focus to `DrillDownContext.triggerElement`; hard-dismiss on `filters-changed` performs NO content revalidation between event and CLOSING transition (spy on render internals); retarget in place when `openDetailPanel` called with a new context while already open (no close → reopen flicker; single `is-open` class toggle); throws or no-ops when called while comparison mode is active. **Performance (SC-001)**: assert `openDetailPanel(ctx)` with a 156-rollup fixture completes in under 1000 ms (measured via `performance.now()` delta); fails the test if slower. **Viewport containment (FR-012)**: open the panel inside a jsdom window sized to the minimum supported dashboard width (resize `window.innerWidth` to 768); assert `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal overflow) and that the source chart element retains non-zero `getBoundingClientRect().width` (not fully obscured).
- [X] T018 Extend `extension/tests/parity/render-equivalence.test.ts` (Layer A starts line 104): for each of a sample throughput `DrillDownContext`, a sample cycle-time `DrillDownContext`, and a sample reviewer `DrillDownContext`, assert that opening the panel on two separate host containers with identical input produces byte-identical `innerHTML` on the `aside.detail-panel` root; mirror the existing `a.innerHTML === b.innerHTML` pattern at lines 105-115 for the throughput chart idempotency case
- [X] T019 Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest cases added by T017 + T018; commit T014–T019 together (Commit C)

### Step 4 — Comparison-mode advisory (Commit D)

- [X] T020 Create `extension/ui/modules/drilldown/comparison-advisory.ts` per `research.md` R-05 and `contracts/lifecycle-signals.md`: subscribe to `COMPARISON_TOGGLED_EVENT` at module load (dashboard-lifetime subscription; no unsubscribe); on `enabled === true` mount a banner note inside the existing comparison banner region (reuse `formatDateRangeDisplay` surroundings from `extension/ui/modules/comparison.ts`), set `data-drilldown-disabled="comparison"` attribute on the chart container elements resolved via `document.getElementById("throughput-chart")`, `document.getElementById("cycle-time-trend")`, `document.getElementById("reviewer-activity")`, and `document.querySelector(".summary-cards")` (IDs and class match `extension/ui/index.html:238/243/251/175`), and dismiss any open panel with reason `"comparison-toggled"`; on `enabled === false` unmount banner, clear attributes, restore drill-down; export `isDrilldownDisabledByComparison(): boolean` and `showComparisonAdvisoryToast(target: HTMLElement): void`; toast auto-dismisses after `COMPARISON_ADVISORY_TOAST_MS` (imported from `shared/constants.ts`); new click replaces in-flight toast
- [X] T021 Add comparison-advisory CSS to `extension/ui/styles.css`: `[data-drilldown-disabled="comparison"]` subdued-affordance rules (cursor change, opacity, disable hover state) scoped to chart click targets; `.comparison-advisory-banner` in the comparison-banner region; `.comparison-advisory-toast` ephemeral positioning + auto-dismiss fade animation; prefers-reduced-motion override for the toast animation
- [X] T022 Import and initialize `comparison-advisory.ts` from `extension/ui/dashboard.ts` during dashboard boot (after DOM ready, before any chart render); add `export * from "./comparison-advisory";` to `extension/ui/modules/drilldown/index.ts`
- [X] T023 Create `extension/tests/modules/drilldown/comparison-advisory.test.ts`: `COMPARISON_TOGGLED_EVENT` with `enabled=true` mounts banner, sets disabled attributes on all four chart containers, dismisses any currently-open DetailPanel with reason `"comparison-toggled"`; `enabled=false` reverses all three; toast auto-dismisses after the fixed duration; a new `showComparisonAdvisoryToast` call while a toast is visible replaces the existing one (no stacking); `isDrilldownDisabledByComparison()` returns the correct boolean in each state
- [X] T024 Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest cases added by T023; commit T020–T024 together (Commit D)

**Checkpoint — Foundation complete**: DetailPanel renders in isolation; comparison-mode disables it; lifecycle signals fire. User-story phases can now begin in parallel if multiple developers are available, or sequentially P1 → P2 → P3 → P4.

---

## Phase 3: User Story 1 — Throughput drill-down (Priority: P1) 🎯 MVP

**Goal**: a user clicking a throughput bar sees a right-side panel with that week's date range, PR count, and breakdown tables by author and by repository.

**Independent Test**: load the dashboard with a multi-week dataset, click the highest throughput bar, verify the panel opens with the expected title / subtitle / tables; verify all dismiss paths (Escape, click-outside, filter change, tab switch, close control); verify comparison mode disables the interaction with a visible cue.

**Commit boundary**: one commit, T025–T030 together.

### Tests for User Story 1

> **TDD guidance**: write the tests below first; they SHOULD fail until the implementation tasks land.

- [X] T025 [P] [US1] Create `extension/tests/modules/drilldown/throughput-drilldown.test.ts`: click on a `.bar-container` opens the panel with the correct human-readable week range, PR count subtitle, and per-author + per-repository breakdown tables sourced from `rollup.by_author` and `rollup.by_repository`; clicked bar gets the `is-drilldown-active` class; empty-breakdown path (week with zero authors or zero repositories) renders an `EmptyStateSection` for each empty section — never an empty table; dispose handle removes listeners (subsequent clicks do nothing); comparison-active path calls `showComparisonAdvisoryToast` and does NOT open the panel; keyboard activation (Enter and Space on a focused bar) triggers the same flow as click
- [X] T026 [P] [US1] Extend `extension/tests/parity/prod-shape-edge-cases.test.ts` with an empty-breakdown throughput week case asserting `EmptyStateSection` renders, not an empty `<table>`; and an all-null cycle-time week that still produces a valid panel when opened via cycle-time (this case also supports US2 but is added here in the edge-case file)

### Implementation for User Story 1

- [X] T027 [P] [US1] Modify `extension/ui/modules/charts/throughput.ts`: on every `.bar-container` at `throughput.ts:97`, add `data-drilldown-week` with the ISO week key, `tabindex="0"`, and `role="button"`; preserve existing `data-tooltip`, `data-week`, `data-count` attributes
- [X] T028 [US1] Create `extension/ui/modules/drilldown/throughput-drilldown.ts`: export `installThroughputDrilldown(container: HTMLElement, rollups: readonly Rollup[]): { dispose(): void }` per `contracts/drilldown-integration.md`; attach ONE delegated `click` and ONE `keydown` listener on `container` (Enter/Space trigger activation; Space calls `event.preventDefault()`); resolve target via `data-drilldown-week`; on comparison active, dispatch to `showComparisonAdvisoryToast(targetElement)` and return; on dispatch, build a `DrillDownContext` with `sourceChart: "throughput"`, `focusedData: { kind: "throughput", weekIso }`, `triggerElement`, and a `PanelContent` whose title is the human-readable week range, subtitle is the PR count, and sections are two `BreakdownTableSection`s (`By author` / `By repository`) built from the rollup's existing `by_author` and `by_repository` fields (substitute `EmptyStateSection` when either is empty); add `is-drilldown-active` class to `triggerElement` and register removal via a dismiss subscription; `dispose()` aborts listeners
- [X] T029 [US1] Wire `installThroughputDrilldown` into `extension/ui/dashboard.ts` `refreshMetrics()`: dispose any previous drilldown handles at the START of the refresh cycle (immediately after the publishFiltersChanged emit from T005), then install the throughput handle AFTER the render block at dashboard.ts:970-974 completes (i.e., after `renderReviewerActivity(...)` at line 973 and `renderCycleDistribution(...)` at line 974); resolve the container via `document.getElementById("throughput-chart")`; store handles in a module-level `activeDrilldownHandles: Array<{ dispose(): void }>` so Phases 4–6 can add peers without racing
- [X] T030 [US1] Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest cases added by T025 + T026; commit T025–T030 together

**Checkpoint — US1 complete**: MVP delivered. A user can now explain a throughput spike end-to-end.

---

## Phase 4: User Story 2 — Cycle-time point drill-down (Priority: P2)

**Goal**: a user clicking a P50 or P90 dot on the cycle-time trend chart sees a panel with the week's P50 and P90 as human-readable durations, PR count, and a per-repository breakdown.

**Independent Test**: load dashboard with multi-week cycle-time data, click a P50 dot on a week; verify panel opens with distinct metric; click the P90 dot on the same week; verify panel retargets (no close/reopen flicker) and shows the P90 metric; verify dismiss paths.

**Commit boundary**: one commit, T031–T035 together.

### Tests for User Story 2

- [X] T031 [P] [US2] Create `extension/tests/modules/drilldown/cycle-time-drilldown.test.ts`: click on a `.line-chart-dot` with `data-drilldown-metric="p50"` opens the panel with a P50-focused title/stat row; click on the P90 dot of the same week retargets the panel (panel remains open, content swaps, single transition); durations render in human-readable units (hours or days) using `extension/ui/modules/shared/format.ts` helpers; per-repository `BreakdownTableSection` renders from `by_repository`; empty-breakdown path shows `EmptyStateSection`; comparison-active path calls `showComparisonAdvisoryToast`; keyboard activation works

### Implementation for User Story 2

- [X] T032 [P] [US2] Modify `extension/ui/modules/charts/cycle-time.ts`: on every `.line-chart-dot` at `cycle-time.ts:285-286`, add `data-drilldown-week` (ISO week key) and `data-drilldown-metric` (lowercase values `"p50"` or `"p90"` — intentionally orthogonal to the existing uppercase `data-metric="P50"|"P90"` attribute that is preserved); add `tabindex="0"` and `role="button"`; preserve existing `data-tooltip`, `data-week`, `data-value`, `data-metric` attributes untouched
- [X] T033 [US2] Create `extension/ui/modules/drilldown/cycle-time-drilldown.ts`: export `installCycleTimeDrilldown(container: HTMLElement, rollups: readonly Rollup[]): { dispose(): void }` per `contracts/drilldown-integration.md`; delegated click + keydown handlers; resolve `{weekIso, metric}` from the lowercase `data-drilldown-metric` attribute; on comparison active, toast and return; build `DrillDownContext` with `sourceChart: "cycle-time"`, `focusedData: { kind: "cycle-time", weekIso, metric }`; `PanelContent` title is the week range, subtitle indicates which metric is focused, sections are a `StatRowSection` with two stats (`P50` and `P90` values formatted via `formatDuration(minutes)` from `extension/ui/modules/shared/format.ts`) plus a per-repository `BreakdownTableSection` from `rollup.by_repository` (EmptyStateSection when empty); retarget-in-place when called while already open with a same-chart context
- [X] T034 [US2] Wire `installCycleTimeDrilldown` into `extension/ui/dashboard.ts` `refreshMetrics()` alongside the throughput handle; push the handle onto `activeDrilldownHandles` after the render block at dashboard.ts:970-974; container resolved via `document.getElementById("cycle-time-trend")`
- [X] T035 [US2] Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest cases added by T031; commit T031–T035 together

**Checkpoint — US2 complete**: cycle-time point drill-down shipped.

---

## Phase 5: User Story 3 — Reviewer detail drill-down (Priority: P3)

**Goal**: a user clicking a reviewer row on the reviewer activity chart sees a panel with that reviewer's total reviews, weighted approval rate, reviews-by-repository breakdown, and per-reviewer weekly trend.

**Independent Test**: load dashboard with multi-reviewer data, click a reviewer row; verify panel shows total reviews, approval rate (or empty state when not computable), per-repository distribution, per-week trend.

**Commit boundary**: one commit, T036–T040 together.

### Tests for User Story 3

- [ ] T036 [P] [US3] Create `extension/tests/modules/drilldown/reviewer-drilldown.test.ts`: click on a `.h-bar-row` with `data-drilldown-reviewer-id="..."` opens the panel with the correct reviewer subject; `StatRowSection` shows total `reviews_count` sum, total `reviewed_prs` sum, weighted approval rate from `computeApprovalRate` (with `EmptyStateSection` variant when the reviewer has no qualifying PRs), and **peak repository breadth** (highest per-week `repositories_count` across the active period with qualifying week label); a `BreakdownTableSection` with columns `Week` / `Reviews` / `PRs reviewed` / `Approval rate` populated by iterating `by_reviewer[reviewerId]` across rollups; dispose cleanup; comparison-active path toasts and returns; keyboard activation works. **No per-repository breakdown assertion** — per the narrowed FR-042, that belongs to #300.

### Implementation for User Story 3

- [ ] T037 [P] [US3] Modify `extension/ui/modules/charts/reviewer-activity.ts`: (a) on every `.h-bar-row` at `reviewer-activity.ts:180`, add `data-drilldown-reviewer-id` with the reviewer id, `tabindex="0"`, and `role="button"`; preserve the existing `title=` attribute as a non-interactive hover fallback; (b) change the declaration at `reviewer-activity.ts:34` from `function computeApprovalRate(` to `export function computeApprovalRate(` so `reviewer-drilldown.ts` can import it directly (no duplication)
- [ ] T038 [US3] Create `extension/ui/modules/drilldown/reviewer-drilldown.ts`: export `installReviewerDrilldown(container: HTMLElement, rollups: readonly Rollup[]): { dispose(): void }` per `contracts/drilldown-integration.md`; resolve `reviewerId` from `data-drilldown-reviewer-id`; on comparison active, toast and return; import the newly-exported `computeApprovalRate` from `../charts/reviewer-activity`; build `PanelContent` with the reviewer display name as title, a `StatRowSection` containing four stats (total reviews_count sum, total reviewed_prs sum, weighted approval rate via `computeApprovalRate(rollups, [reviewerId])`, peak repository breadth = `Math.max(...rollups.map(r => r.by_reviewer?.[reviewerId]?.repositories_count ?? 0))` with the qualifying week label as supporting text), and a `BreakdownTableSection` with columns `["Week", "Reviews", "PRs reviewed", "Approval rate"]` whose rows are built by iterating rollups and reading `by_reviewer[reviewerId]` entries (skip weeks where the reviewer had no activity; `approval_rate` null → empty cell)
- [ ] T039 [US3] Wire `installReviewerDrilldown` into `extension/ui/dashboard.ts` `refreshMetrics()`; push onto `activeDrilldownHandles` after the render block at dashboard.ts:970-974; container resolved via `document.getElementById("reviewer-activity")`
- [ ] T040 [US3] Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest cases added by T036; commit T036–T040 together

**Checkpoint — US3 complete**: reviewer drill-down shipped. DetailPanel consumers are all three in place.

---

## Phase 6: User Story 4 — Sparkline navigator (Priority: P4)

**Goal**: a user clicking a summary-card sparkline navigates to the corresponding full chart and sees a short-lived highlight; missing targets surface an inline advisory.

**Independent Test**: load dashboard, click a sparkline; verify the page scrolls to the corresponding full chart and the chart receives a highlight; click a sparkline whose target chart is unavailable (e.g. gated by data-availability); verify an advisory is shown and no scroll occurs.

**Commit boundary**: one commit, T041–T046 together.

### Tests for User Story 4

- [ ] T041 [P] [US4] Create `extension/tests/modules/drilldown/sparkline-navigator.test.ts`: click on a `<button class="sparkline-trigger">` scrolls the target full chart into view (mock `scrollIntoView`) and applies the `is-sparkline-highlight` class; missing target element surfaces an inline advisory via a `renderNoData`-style helper and does NOT scroll; keyboard activation (Enter and Space on the focused button) triggers the same behavior; highlight class is removed after the fixed duration (use fake timers); repeat activation re-triggers scroll + highlight; comparison-active path applies `[data-drilldown-disabled="comparison"]` styling (from comparison-advisory) and clicking surfaces the advisory toast instead of scrolling

### Implementation for User Story 4

- [ ] T042 [P] [US4] Modify `extension/ui/modules/charts/summary-cards.ts`: wrap each sparkline SVG in a `<button type="button" class="sparkline-trigger" data-drilldown-target-chart="throughput|cycle-time|reviewer" aria-label="Open full {chart} chart">`; no behavior change beyond markup; the button is visually transparent (CSS in T043 handles appearance)
- [ ] T043 [P] [US4] Add `.sparkline-trigger` button styles and `.is-sparkline-highlight` chart highlight class to `extension/ui/styles.css`; include prefers-reduced-motion override for the highlight animation; ensure the button does not visually disturb the existing sparkline layout
- [ ] T044 [US4] Create `extension/ui/modules/drilldown/sparkline-navigator.ts`: export `installSparklineNavigator(container: HTMLElement): { dispose(): void }` per `contracts/drilldown-integration.md`; delegated click + keydown listeners on `container`; resolve `data-drilldown-target-chart`; locate the target chart container via the ID mapping `"throughput" → document.getElementById("throughput-chart")`, `"cycle-time" → document.getElementById("cycle-time-trend")`, `"reviewer" → document.getElementById("reviewer-activity")`; call `element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" })`; add `is-sparkline-highlight` class and remove via `setTimeout(..., SPARKLINE_HIGHLIGHT_MS)` imported from `shared/constants.ts`; when the target is not present, render an inline advisory using the `renderNoData` helper from `shared/render.ts` and do NOT scroll
- [ ] T045 [US4] Wire `installSparklineNavigator` into `extension/ui/dashboard.ts` `refreshMetrics()` (push onto `activeDrilldownHandles` after the render block at dashboard.ts:970-974; container resolved via `document.querySelector(".summary-cards")`); add `export * from "./sparkline-navigator";` to `extension/ui/modules/drilldown/index.ts`
- [ ] T046 [US4] Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of Jest cases added by T041; commit T041–T046 together

**Checkpoint — US4 complete**: all four user stories shipped. Every primary chart answers "why did this happen?" when clicked.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: reconcile quality floors, run full gate chain locally, and self-review.

- [X] T047 Audit partial branches: run `pnpm --dir extension run test:coverage` followed by `pnpm --dir extension run test:partial-branches`; if counts shifted on any `extension/ui/**/*.ts` file, co-change `.coverage-partial-branches-baseline.json` in this commit, respecting `LOCKED_ZERO_FILES` (locked files must stay at zero — refactor if they moved)
- [ ] T048 Run `pnpm --dir extension run test:ci` from the repo root; iterate until green; if drift surfaces in test counts or coverage, resolve within the last feature commit (do NOT create a separate "drift-fix" commit after the feature is done)
- [ ] T049 Run `python scripts/run_repo_hook.py pre-push` from the repo root; iterate until green. This runs version-guard, baseline-integrity, pre-commit, CRLF guard, asset validation, invariant-contract guards, and preflight in order. Do NOT `git push` until the user explicitly authorizes.
- [ ] T050 Self-review the full diff end-to-end against `spec.md` FRs and SCs; walk the render paths data → DOM for each of the four user stories; confirm no regressions in hover tooltips (`tooltip-manager.ts`), filter chips (`filters.ts`), or existing keyboard behavior; confirm DetailPanel is the sole drawer implementation (no per-chart duplicates)
- [ ] T051 Validate `quickstart.md` exit criteria: all four user stories functional in the running dashboard, all SC-001 through SC-008 measurable outcomes satisfied, zero new suppressions, no `any` types, cross-OS tests pass, comparison-mode cue visible and clear

---

## Dependencies & Execution Order

### Phase-level dependencies

- **Phase 1 (Setup)**: no dependencies; may start immediately.
- **Phase 2 (Foundational)**: depends on Phase 1. Hard blocker for every user-story phase.
- **Phase 3–6 (User Stories)**: each depends on Phase 2 completion. Each may proceed in parallel if team capacity allows; otherwise in priority order P1 → P2 → P3 → P4.
- **Phase 7 (Polish)**: depends on every user-story phase planned to ship. Phase 7's ratchet co-change and gate runs are the last commit(s) on the branch before PR-readiness.

### Within Phase 2 (foundational order)

- `lifecycle-signals.ts` (Commit A) and `focus-trap.ts` (Commit B) have no dependency on each other — can be built in parallel.
- `detail-panel.ts` (Commit C) depends on BOTH Commit A and Commit B.
- `comparison-advisory.ts` (Commit D) depends on Commit A (subscribes to events) and Commit C (dismisses panels).

### Within each user-story phase

- Tests written first and expected to fail → implementation → ratchet bump → commit.
- Same-file edits cannot parallelize within a phase (e.g. T028 creates the drilldown module while T029 edits dashboard.ts — different files, but T029 depends on T028's exports, so sequential).

### Parallel opportunities

- Commit A ∥ Commit B (different files, no cross-dependency)
- Within US1: T025 ∥ T026 (test files, both [P]); T027 (throughput.ts edit) can run parallel with the tests being drafted
- US1 ∥ US2 ∥ US3 ∥ US4 once Foundation is green
- Within US4: T042 ∥ T043 ∥ T041 (summary-cards.ts edit, CSS edit, test file — all different files)

---

## Summary

- **Total tasks**: 51 (T001–T051)
- **Per user story**: Setup=2 · Foundation=22 · US1=6 · US2=5 · US3=5 · US4=6 · Polish=5
- **Parallel opportunities**: Commit A ∥ Commit B in Foundation; all four user stories once Foundation is green; within-story tests ∥ chart-module edits
- **MVP boundary**: complete T001–T030 (Setup + Foundation + US1). After T030 the dashboard ships with a throughput drill-down; the other three stories can follow independently.
- **Commit count on the feature branch (expected)**: Commit A (T003–T009) · Commit B (T010–T013) · Commit C (T014–T019) · Commit D (T020–T024) · US1 (T025–T030) · US2 (T031–T035) · US3 (T036–T040) · US4 (T041–T046) · Polish (T047–T051). Nine commits total; each a self-contained, ratchet-aligned unit.

### Format validation

Every task above follows `- [ ] TNNN [P?] [USn?] description with file path`. Setup / Foundation / Polish tasks have no story label; user-story phase tasks all carry `[US1]` / `[US2]` / `[US3]` / `[US4]`; parallelizable tasks carry `[P]`; file paths are absolute within the repo. Checklist format verified.

### Independent test criteria per story

- **US1**: click highest throughput bar; verify title / subtitle / tables; exercise all dismiss paths; exercise comparison-mode disabled cue.
- **US2**: click a P50 dot, then a P90 dot on the same week; verify retarget-in-place, distinct content, human-readable durations; exercise dismiss paths.
- **US3**: click a reviewer row; verify total reviews / approval rate (or empty state) / per-repo breakdown / per-week trend; exercise dismiss paths.
- **US4**: click a sparkline; verify scroll + highlight on target; click a sparkline without target; verify inline advisory; exercise keyboard activation; exercise comparison-disabled state.

---

## References

- Spec: `specs/059-chart-drill-down/spec.md`
- Plan: `specs/059-chart-drill-down/plan.md`
- Research: `specs/059-chart-drill-down/research.md`
- Data model: `specs/059-chart-drill-down/data-model.md`
- Contracts: `specs/059-chart-drill-down/contracts/detail-panel-api.md`, `contracts/drilldown-integration.md`, `contracts/lifecycle-signals.md`
- Quickstart: `specs/059-chart-drill-down/quickstart.md`
- Parent issue: #205 (Chart drill-down & interactive exploration)
- Deferred follow-up: #300 (Phase 2 / deferred items)
- Constitution: `.specify/memory/constitution.md` v1.5.0
