# Tasks: Professional Dashboard Loading Feedback

**Input**: Design documents from `/specs/045-professional-loading-feedback/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Required — 5 behavioral tests specified in the feature specification.

**Organization**: Tasks grouped by user story. US1+US2+US3 are combined into a single MVP phase since they share one implementation path (all callers of `refreshMetrics()`). US4 and US5 layer independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Foundational (State Machine + CSS + DOM)

**Purpose**: Create the loading-state module, loading CSS, and aria-live DOM element that all user stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T001 Create the refresh-cycle state machine module in `extension/ui/modules/loading-state.ts`. Export: `startRefresh(metricsSection: HTMLElement, regions: HTMLElement[]): number` (increments monotonic token, sets `active = true`, applies `.metrics-loading` class to each region, sets `aria-busy="true"` on metricsSection, returns token), `endRefresh(token: number, metricsSection: HTMLElement, regions: HTMLElement[]): boolean` (if token matches current, removes `.metrics-loading`, removes `aria-busy`, announces via aria-live, sets `active = false`, returns true; if stale token, returns false), `isStale(token: number): boolean`, `isActive(): boolean`. Internal state: `let currentToken = 0; let active = false;`. Use `createElement` from `./shared/render` for any DOM construction. No innerHTML.
- [ ] T002 [P] Add no-op guard function to `extension/ui/modules/loading-state.ts`. Export: `hasStateChanged(prev: EffectiveState, next: EffectiveState): boolean`. `EffectiveState` type: `{ filters: FilterState; startDate: string; endDate: string; comparisonMode: boolean }`. Compare via `JSON.stringify` — return `false` if identical. Export the `EffectiveState` type.
- [ ] T003 [P] Add loading overlay CSS to `extension/ui/styles.css`. Add `.metrics-loading` class that applies `opacity: 0.5` with `transition: opacity 0.3s ease-in-out` and `pointer-events: none` to prevent interaction during load. Add a `.metrics-loading-spinner` class for a small (20px) absolutely-positioned spinner in the top-right corner of chart containers using existing `--primary`/`--border` tokens and the existing `@keyframes spin`. Add `@media (prefers-reduced-motion: reduce)` rule that sets `transition: none` on `.metrics-loading` and `animation: none` on `.metrics-loading-spinner`. Use only existing CSS custom properties — no hardcoded values.
- [ ] T004 [P] Add an aria-live region element to `extension/ui/index.html`. Inside `<section id="tab-metrics">`, before the `.metrics-grid` div, add: `<div id="metrics-status" class="visually-hidden" aria-live="polite" role="status"></div>`. This element receives text announcements from the loading-state module when the winning refresh completes.

**Checkpoint**: Foundation ready — loading-state module exported, CSS applied via class toggle, aria-live region in DOM.

---

## Phase 2: US1 + US2 + US3 — Core Loading Feedback + Correctness (Priority: P1) MVP

**Goal**: Wire the loading state into `refreshMetrics()` and all its callers so that every user-triggered data reload shows loading feedback, supersedes stale requests, and skips no-op state changes.

**Independent Test**: Select any dimension filter, change date range, or toggle comparison — all chart regions dim with loading treatment. Rapid successive changes produce exactly one data load for the final state.

### Implementation

- [ ] T005 [US1] [US2] [US3] Wire loading state into `refreshMetrics()` in `extension/ui/dashboard.ts`. At the top of the function (after the existing early-return guard), call `startRefresh()` passing the `#tab-metrics` element and the 5 chart region elements (`.summary-cards`, and the 4 `.chart-container` parents of `#throughput-chart`, `#cycle-time-trend`, `#reviewer-activity`, `#cycle-distribution`). Capture the returned token. After all chart renders complete (after `renderCycleDistribution`), call `endRefresh(token, ...)` — if it returns `false` (stale), return early without updating `cachedRollups` or indicators. Wrap the entire async body in try/catch: on catch, call `endRefresh(token, ...)` to ensure loading clears on failure.
- [ ] T006 [US1] [US2] [US3] Add no-op guard to `refreshMetrics()` in `extension/ui/dashboard.ts`. Before the loading state starts, snapshot the current `EffectiveState` (from `currentFilters`, `currentDateRange`, `comparisonMode`) and compare to a module-level `lastEffectiveState` variable using `hasStateChanged()`. If unchanged, return immediately — no loading state, no fetch. Update `lastEffectiveState` after the snapshot passes. Cache the region elements once in `cacheElements()` rather than querying DOM on every refresh.
- [ ] T007 [US1] [US2] [US3] Update the aria-live announcement in `extension/ui/modules/loading-state.ts`. In `endRefresh()`, when the token matches (winning refresh), set `textContent` of `#metrics-status` to `"Dashboard updated"`. Clear it after a brief delay (1s) so it doesn't persist for the next screen reader sweep. For superseded loads (stale token), do NOT update the live region.

**Checkpoint**: US1+US2+US3 complete. Filter changes, date range changes, and comparison toggles all show consistent loading feedback. Rapid interactions coalesce. Stale results are discarded.

---

## Phase 3: US4 — Accessible Loading Feedback (Priority: P2)

**Goal**: Screen readers receive deterministic `aria-busy` + one polite completion announcement per winning refresh.

**Independent Test**: Inspect ARIA attributes during a filter change — `aria-busy="true"` appears on `#tab-metrics` during loading, clears on completion, and `#metrics-status` receives exactly one announcement text.

### Implementation

- [ ] T008 [US4] Verify aria-busy and aria-live behavior are correct in `extension/ui/modules/loading-state.ts`. The `startRefresh()` function already sets `aria-busy="true"` (T001) and `endRefresh()` already clears it and announces (T007). This task validates: (a) `aria-busy` is set on `#tab-metrics` (the `metricsSection` parameter), not on individual regions; (b) superseded loads do NOT clear `aria-busy` or make announcements; (c) the live region text is cleared after 1 second so it doesn't repeat. If any of these behaviors are missing from T001/T007, fix them here.

**Checkpoint**: US4 complete. Accessibility behavior verified and deterministic.

---

## Phase 4: US5 — Consistent Visual Language (Priority: P3)

**Goal**: All 5 chart regions receive identical loading treatment using only existing design system tokens.

**Independent Test**: Trigger loading and visually inspect all regions — summary cards, throughput, cycle time trend, reviewer activity, cycle distribution all show same dimming + spinner.

### Implementation

- [ ] T009 [US5] Verify and adjust CSS consistency across all 5 chart regions in `extension/ui/styles.css`. Ensure `.metrics-loading` class produces identical visual result on `.summary-cards` (grid of 7 cards) and each `.chart-container` (single chart). Confirm: (a) spinner positions consistently in top-right of each region; (b) dimming opacity is uniform; (c) no region-specific overrides exist that would break consistency; (d) responsive breakpoints (768px, 480px) do not break the loading overlay layout; (e) all values use CSS custom properties from the design system. Add `position: relative` to `.chart-container` and `.summary-cards` if not already set, so the absolutely-positioned spinner is anchored correctly.

**Checkpoint**: US5 complete. Visual consistency verified across all regions.

---

## Phase 5: Required Tests

**Purpose**: 5 behavioral tests specified in the feature specification. Tests validate the state machine and its integration points.

- [ ] T010 [P] Create test file `extension/tests/unit/loading-state.test.ts`. Set up test scaffolding: mock DOM elements (metricsSection, 5 region elements, `#metrics-status` element), import the loading-state module functions. Use `jest.fn()` for DOM manipulation verification.
- [ ] T011 [P] Test: "loading starts on filter-triggered refresh" in `extension/tests/unit/loading-state.test.ts`. Call `startRefresh()` with mock elements. Assert: (a) all region elements have `.metrics-loading` class added; (b) `metricsSection.setAttribute` called with `aria-busy`, `true`; (c) returned token is > 0; (d) `isActive()` returns `true`.
- [ ] T012 [P] Test: "superseded request does not render stale results" in `extension/tests/unit/loading-state.test.ts`. Call `startRefresh()` to get token1, then `startRefresh()` again to get token2. Call `endRefresh(token1, ...)`. Assert: (a) returns `false`; (b) `.metrics-loading` class is NOT removed (still loading); (c) `aria-busy` is NOT removed; (d) `#metrics-status` textContent is NOT set. Then call `endRefresh(token2, ...)`. Assert: (a) returns `true`; (b) `.metrics-loading` removed; (c) `aria-busy` removed; (d) announcement made.
- [ ] T013 [P] Test: "loading clears on success" in `extension/tests/unit/loading-state.test.ts`. Call `startRefresh()` to get token, then `endRefresh(token, ...)`. Assert: (a) returns `true`; (b) all region elements have `.metrics-loading` class removed; (c) `aria-busy` removed from metricsSection; (d) `isActive()` returns `false`.
- [ ] T014 [P] Test: "loading clears on failure" in `extension/tests/unit/loading-state.test.ts`. Call `startRefresh()` to get token. Simulate failure by calling `endRefresh(token, ...)` (same path as success — the caller's catch block calls endRefresh). Assert same results as T013 — loading fully clears.
- [ ] T015 Test: "no-op state change does not trigger loading" in `extension/tests/unit/loading-state.test.ts`. Create two identical `EffectiveState` objects. Call `hasStateChanged(state1, state2)`. Assert returns `false`. Create two different states (different filter). Assert returns `true`.

**Checkpoint**: All 5 required behavioral tests written and passing.

---

## Phase 6: Victory Gate

**Purpose**: Full quality gate validation before any push.

- [ ] T016 Run `pnpm run build:check` from `extension/` to verify TypeScript compilation passes with zero errors.
- [ ] T017 Run `pnpm run lint` and `pnpm run lint:tests` from `extension/` to verify ESLint passes with zero warnings.
- [ ] T018 Run `pnpm test` from `extension/` to verify all Jest tests pass (existing + new loading-state tests).
- [ ] T019 Commit all changes via `git commit` (let pre-commit hooks run: tsc, ESLint, ui-bundle-sync).
- [ ] T020 When user authorizes push: run `python scripts/run_pr_preflight.py` from repo root and confirm ALL gates pass before executing push.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Foundational)**: No dependencies — start immediately
- **Phase 2 (US1+US2+US3)**: Depends on Phase 1 completion — BLOCKS all user value
- **Phase 3 (US4)**: Depends on Phase 2 — verifies accessibility behavior already wired
- **Phase 4 (US5)**: Depends on Phase 2 — verifies CSS consistency
- **Phase 5 (Tests)**: Depends on Phase 1 (module exists) — can run in parallel with Phase 2+
- **Phase 6 (Victory)**: Depends on all prior phases

### User Story Dependencies

- **US1+US2+US3 (P1)**: Combined into one phase — they share the same implementation path (`refreshMetrics()` + all callers). Cannot be separated without redundant work.
- **US4 (P2)**: Depends on US1+US2+US3 being wired — validates aria behavior that was implemented in Phase 2.
- **US5 (P3)**: Depends on US1+US2+US3 being wired — validates CSS consistency that was implemented in Phase 1+2.

### Within Phase 1

- T001 is the core module — T002 can run in parallel (separate concern: no-op guard)
- T003 (CSS) and T004 (HTML) can run in parallel with each other and with T001/T002

### Parallel Opportunities

```
Phase 1: T001 | T002 | T003 | T004  (all parallel — different files)
Phase 2: T005 → T006 → T007         (sequential — same files, dependent logic)
Phase 3: T008                        (single task)
Phase 4: T009                        (single task)
Phase 5: T010 → T011 | T012 | T013 | T014 | T015  (scaffolding first, then tests parallel)
Phase 6: T016 | T017 → T018 → T019 → T020          (build/lint parallel, then sequential)
```

---

## Implementation Strategy

### MVP First (US1+US2+US3)

1. Complete Phase 1: Foundational (loading-state.ts, CSS, HTML)
2. Complete Phase 2: Wire into dashboard.ts
3. **STOP and VALIDATE**: Trigger filter/date/comparison changes — verify loading feedback appears, stale results discarded, no-op guard works
4. This is the shippable MVP — all P1 stories functional

### Incremental Delivery

1. Phase 1+2 → MVP with core loading feedback (US1+US2+US3)
2. Phase 3 → Add accessibility verification (US4)
3. Phase 4 → CSS consistency polish (US5)
4. Phase 5 → Full test coverage
5. Phase 6 → Quality gates + push

### Single-Developer Strategy

Work sequentially through phases. Phase 1 tasks can be done in any order. Phase 2 is sequential (builds on itself). Phases 3-4 are single tasks. Phase 5 tests can be written after Phase 1 (module exists) and validated after Phase 2 (integration complete).

---

## Notes

- [P] tasks = different files, no dependencies
- US1+US2+US3 combined because they share one code path — `refreshMetrics()` and its 6 callers
- The no-op guard (T006) prevents loading flash when user re-selects the same value
- The stale-token check (T005 endRefresh) prevents race conditions from rapid interactions
- The aria-live region (T004+T007) fires exactly once per winning refresh — no spam from superseded loads
- Pre-push hooks are currently broken — T020 runs the full preflight script manually before push
- Timing thresholds (300ms show-delay) are deferred — not in scope for this branch
