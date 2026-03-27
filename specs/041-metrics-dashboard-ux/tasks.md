# Tasks: Metrics Dashboard UX Improvements

**Input**: Design documents from `/specs/041-metrics-dashboard-ux/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Verify environment and ensure all existing tests pass before making changes.

- [ ] T001 Verify extension builds and all 642+ tests pass by running `cd extension && pnpm install && pnpm run test:ci`
- [ ] T002 Verify demo dataset exists or generate it by running `python scripts/build-demo-dataset.py`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure required by multiple user stories. MUST complete before any user story work begins.

- [ ] T003 Create tooltip manager module with `dismissAllTooltips()`, `showChartTooltip()`, and `showInfoTooltip()` functions per tooltip-system contract in extension/ui/modules/tooltip-manager.ts
- [ ] T004 Add `DataAvailabilitySignal` interface to extension/ui/types.ts (alongside existing `DatasetCapabilityState`) and create `deriveAvailabilitySignal()` function in extension/ui/modules/data-availability.ts
- [ ] T005 [P] Add `.info-tooltip` CSS class with z-index 150, positioning rules, and styling consistent with `.chart-tooltip` in extension/ui/styles.css
- [ ] T006 [P] Export new modules from barrel file in extension/ui/modules/index.ts
- [ ] T007 Run full test suite to verify foundational changes introduce no regressions: `pnpm run test:ci`

**Checkpoint**: Foundation ready — tooltip manager, data availability types, and CSS in place. User story implementation can begin.

---

## Phase 3: User Story 1 — Readable Tooltips at Any Scroll Position (Priority: P1)

**Goal**: Fix the tooltip positioning bug so tooltips appear anchored near the hovered element at any scroll position, with viewport boundary detection.

**Independent Test**: Scroll the dashboard so charts are at various viewport positions. Hover/tap data elements. Tooltips must appear near the element, within the viewport, at all scroll positions.

### Implementation for User Story 1

- [ ] T008 [US1] Update `showTooltip()` to use `position: fixed` instead of `position: absolute` and use `getBoundingClientRect()` viewport coordinates directly in extension/ui/modules/charts.ts
- [ ] T009 [US1] Add viewport boundary detection: flip tooltip below element when it would overflow top, shift horizontally when it would overflow left/right, checking against `window.innerWidth` and `window.innerHeight` in extension/ui/modules/charts.ts
- [ ] T010 [US1] Add structural assertion in tooltip initialization that verifies no intermediate positioned ancestors exist between `document.body` and chart containers, logging a warning if violated, in extension/ui/modules/charts.ts
- [ ] T011 [US1] Update `.chart-tooltip` CSS from `position: absolute` to `position: fixed` in extension/ui/styles.css
- [ ] T012 [US1] Integrate chart tooltips with tooltip manager: replace direct DOM append/remove with `showChartTooltip()`/`dismissAllTooltips()` calls in extension/ui/modules/charts.ts
- [ ] T013 [US1] Update existing tooltip tests for `position: fixed` behavior and add lifecycle invariant test verifying dismiss → create → position → append sequence in extension/tests/modules/charts/tooltip.test.ts
- [ ] T014 [US1] Add viewport boundary detection tests (top overflow flip, left/right clamping, narrow viewport) in extension/tests/modules/charts/tooltip.test.ts
- [ ] T015 [US1] Run full test suite to verify tooltip changes pass all 642+ tests: `pnpm run test:ci`

**Checkpoint**: Tooltips work correctly at any scroll position. Touch scroll-cancellation preserved. Existing tests pass.

---

## Phase 4: User Story 4 — Explanatory Info Icons on Summary Cards (Priority: P2)

**Goal**: Add an info icon to each of the five summary cards that reveals a plain-English explanation of the metric on hover or click.

**Independent Test**: Load dashboard with data. Each of the 5 summary cards has a visible info icon. Hovering/clicking shows explanation. Only one tooltip (chart or info) visible at a time.

> **Note**: US4 is implemented before US2 and US3 because it depends only on the tooltip manager (Phase 2) and the tooltip fix (US1), and is a small self-contained change.

### Implementation for User Story 4

- [ ] T016 [P] [US4] Define MetricExplanation constants (all 5 card explanations) in extension/ui/modules/charts/summary-cards.ts
- [ ] T017 [US4] Add info icon rendering (Unicode ⓘ with `.info-icon-btn` class) next to each summary card title in the `renderMetricValues()` function in extension/ui/modules/charts/summary-cards.ts
- [ ] T018 [US4] Wire info icon hover/click events to `showInfoTooltip()` from tooltip manager, ensuring mutual exclusion with chart tooltips, in extension/ui/modules/charts/summary-cards.ts
- [ ] T019 [US4] Add `.info-icon-btn` CSS styling (size, cursor, hover state) in extension/ui/styles.css
- [ ] T020 [US4] Add tests verifying all 5 info icons render, tooltip content matches explanations, and only one tooltip exists at a time in extension/tests/modules/charts/summary-cards-info.test.ts
- [ ] T021 [US4] Add parity test verifying info icon rendering is identical across both entry points in extension/tests/parity/render-equivalence.test.ts
- [ ] T022 [US4] Run full test suite: `pnpm run test:ci`

**Checkpoint**: All 5 summary cards have info icons with correct explanations. Chart and info tooltips are mutually exclusive.

---

## Phase 5: User Story 3 — Context-Aware Empty State Messaging (Priority: P2)

**Goal**: Replace generic "No data for selected range" messages with context-specific messaging that distinguishes between filtered-out data, missing data, minimum data requirements, and data not extracted.

**Independent Test**: Apply filter combinations and date ranges that produce empty charts. Each empty chart shows a message specific to the cause: filter-caused, date-range, minimum-data, or not-extracted.

> **Note**: US3 is implemented before US2 because it is independent of the filter refactor and provides immediate UX value.

### Implementation for User Story 3

- [ ] T023 [US3] Create empty state classifier module implementing strict short-circuit evaluation hierarchy (not-extracted → filter-caused → minimum-data → date-range-empty) per empty-state-classifier contract in extension/ui/modules/empty-state-classifier.ts
- [ ] T024 [US3] Define `EMPTY_STATE_MESSAGES` and `EMPTY_STATE_HINTS` constants replacing the old `NO_DATA_HINTS` in extension/ui/modules/empty-state-classifier.ts
- [ ] T025 [US3] Update `renderNoData()` signature in extension/ui/modules/shared/render.ts to accept `EmptyStateClassification` and render message + hint from classification
- [ ] T026 [P] [US3] Add type guard for null-vs-empty breakdown fields in `normalizeRollup()` ensuring `undefined` and missing fields are normalized to `null` with warning in extension/ui/dataset-loader.ts
- [ ] T027 [US3] Integrate classifier into throughput chart: replace inline empty checks with `classifyEmptyState()` call, passing filter state and unfiltered rollups in extension/ui/modules/charts/throughput.ts
- [ ] T028 [US3] Integrate classifier into cycle time trend chart: replace inline empty checks with `classifyEmptyState()` call in extension/ui/modules/charts/cycle-time.ts
- [ ] T029 [US3] Integrate classifier into cycle time distribution: replace inline empty checks with `classifyEmptyState()` call in extension/ui/modules/charts/cycle-time.ts
- [ ] T030 [US3] Integrate classifier into reviewer activity chart: replace `getReviewerNoDataHint()` and inline checks with `classifyEmptyState()` call in extension/ui/modules/charts/reviewer-activity.ts
- [ ] T031 [US3] Add comprehensive classifier tests covering all 4 hierarchy levels, short-circuit behavior (early condition prevents later evaluation), and overlapping conditions in extension/tests/modules/empty-state-classifier.test.ts
- [ ] T032 [US3] Add parity test verifying empty state rendering is identical across both entry points given same inputs in extension/tests/parity/render-equivalence.test.ts
- [ ] T033 [US3] Run full test suite: `pnpm run test:ci`

**Checkpoint**: All four chart types use the centralized classifier. Messages are context-specific and actionable. Existing tests pass.

---

## Phase 6: User Story 2 — Consistent Searchable Filters (Priority: P1)

**Goal**: Replace four inconsistent filter implementations with a unified typeahead dropdown component supporting searchable options, multi-select chips, and single-select mode.

**Independent Test**: Click each of the four filters. All show searchable dropdown. Repo/Team support multi-select with chips. Reviewer/Author are single-select. URL bookmarks work. Filter constraints preserved.

> **Note**: US2 is the largest scope and depends on the constraint resolver. Positioned last to benefit from tooltip manager and classifier already being in place. Despite P1 priority, it is safe to implement last because US1 (also P1) is the true MVP blocker.

### Implementation for User Story 2

- [ ] T034 [US2] Create filter constraint resolver function `resolveFilterConstraints()` as single authority for Author+Team, Reviewer+Repo/Team rules per filter-component contract in extension/ui/modules/filter-constraint-resolver.ts
- [ ] T035 [US2] Add comprehensive constraint resolver tests covering all 16 filter combination states (4 dimensions x all combos), constraint notices, and determinism in extension/tests/modules/filter-constraint-resolver.test.ts
- [ ] T036 [US2] Update URL serialization in `serializeFiltersToUrl()` to canonical format: sorted multi-select values, `encodeURIComponent()`, empty selection deletes parameter in extension/ui/modules/filters.ts
- [ ] T037 [US2] Update URL deserialization in `parseFiltersFromUrl()` to apply `decodeURIComponent()`, strip empty values, validate against dimensions in extension/ui/modules/filters.ts
- [ ] T038 [US2] Add URL round-trip tests verifying `serialize(deserialize(serialize(state))) === serialize(state)` for all filter states in extension/tests/integration/filter-url-roundtrip.test.ts
- [ ] T039 [US2] Create unified typeahead dropdown component with single/multi mode, debounced search input (200ms), chip display for multi-select, and windowed rendering for large option sets per filter-component contract in extension/ui/modules/typeahead-dropdown.ts
- [ ] T040 [US2] Add all-selected normalization logic: when all available options are selected in multi-select mode, emit empty array before firing onChange callback in extension/ui/modules/typeahead-dropdown.ts
- [ ] T041 [US2] Add typeahead dropdown unit tests: single-select behavior, multi-select chip rendering, search filtering, zero-match display, all-selected normalization in extension/tests/modules/typeahead-dropdown.test.ts
- [ ] T042 [US2] Add typeahead performance tests using `performance.now()` timing following existing `chart-scalability.test.ts` pattern, verifying < 100ms update for 200 options and < 200ms for 1000 options; jank-free verified via synchronous timing budget (if filtering completes within 200ms, no frame is blocked beyond that budget; frame-level measurement deferred to Playwright E2E if needed) in extension/tests/performance/typeahead-performance.test.ts
- [ ] T043 [US2] Update filter markup in extension/ui/index.html: replace `<select>` elements and `<datalist>` with typeahead component mount point `<div>` containers for all 4 filters
- [ ] T044 [US2] Update `populateFilterDropdowns()` in extension/ui/dashboard.ts to initialize typeahead components with dimension data, correct modes (multi for repo/team, single for reviewer/author), and onChange handlers
- [ ] T045 [US2] Replace `applyAuthorFilterCompatibility()` and `applyReviewerFilterCompatibility()` in extension/ui/dashboard.ts with calls to the single `resolveFilterConstraints()` resolver
- [ ] T046 [US2] Remove duplicate constraint warning logic from `applyFiltersToRollups()` in extension/ui/modules/metrics.ts, replacing with resolver call at the entry point
- [ ] T047 [US2] Update `restoreFiltersFromUrl()` in extension/ui/dashboard.ts to deserialize URL params and set typeahead component selections via `setSelected()` API
- [ ] T048 [US2] Update `handleFilterChange()` in extension/ui/dashboard.ts to: read typeahead selections → normalize all-selected → resolve constraints → update URL → refresh metrics
- [ ] T049 [US2] Verify hidden filter behavior: ensure typeahead components for dimensions with no options are hidden, matching existing behavior, in extension/ui/dashboard.ts
- [ ] T050 [US2] Add parity test verifying filter rendering is identical across both entry points given same dimension data in extension/tests/parity/render-equivalence.test.ts
- [ ] T051 [US2] Run full test suite: `pnpm run test:ci`

**Checkpoint**: All four filters use unified typeahead. URL bookmarks work. Constraints enforced by single resolver. Performance thresholds met. All tests pass.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, cleanup, and cross-cutting improvements.

- [ ] T052 Remove any dead code from old filter implementations (`<select>`, `<datalist>` population logic, old constraint functions) in extension/ui/dashboard.ts and extension/ui/index.html
- [ ] T053 Remove old `NO_DATA_HINTS` constant and `getReviewerNoDataHint()` function replaced by classifier in extension/ui/modules/shared/render.ts and extension/ui/modules/charts/reviewer-activity.ts
- [ ] T054 [P] Verify all new modules are exported from barrel file in extension/ui/modules/index.ts
- [ ] T055 [P] Build production bundle and verify no bundle size regressions: `node scripts/bundle-ui.mjs`
- [ ] T056 Run full test suite one final time: `pnpm run test:ci`
- [ ] T057 Manual verification using quickstart.md checklist: scroll + hover tooltips, type in all filters, trigger empty states, hover info icons
- [ ] T058 Verify demo dataset renders correctly with all changes: `ado-insights dashboard --dataset ./artifacts/demo-enterprise/data --open`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 Tooltips (Phase 3)**: Depends on Phase 2 (tooltip manager)
- **US4 Info Icons (Phase 4)**: Depends on Phase 3 (tooltip fix + manager integration)
- **US3 Empty States (Phase 5)**: Depends on Phase 2 (data availability types). Independent of US1 and US4.
- **US2 Filters (Phase 6)**: Depends on Phase 2. Independent of US1, US3, US4 but benefits from all being complete.
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1: Setup
    │
    ▼
Phase 2: Foundational (tooltip manager, data availability, CSS)
    │
    ├──▶ Phase 3: US1 (Tooltip fix)
    │       │
    │       ▼
    │    Phase 4: US4 (Info icons) ─── depends on US1 tooltip fix
    │
    ├──▶ Phase 5: US3 (Empty states) ─── independent, can parallel with US1/US4
    │
    └──▶ Phase 6: US2 (Filters) ─── independent, can parallel with US3; benefits from US1/US4 complete
            │
            ▼
         Phase 7: Polish
```

### Within Each User Story

- Core module before integration with existing code
- Integration before tests
- Tests before checkpoint verification

### Parallel Opportunities

**After Phase 2 completes:**
- US3 (Empty states) can run in parallel with US1 (Tooltips) — different files, no dependencies
- Within US2: T034-T035 (constraint resolver) can run in parallel with T036-T038 (URL serialization) — different files
- Within US2: T039-T042 (typeahead component) can start after T034 (resolver) completes — depends on resolver for constraint behavior

---

## Parallel Example: After Foundational Phase

```bash
# Stream A: Tooltip fix + Info icons (sequential dependency)
Task: T008-T015 (US1: Tooltip positioning fix)
Task: T016-T022 (US4: Info icons — after US1 complete)

# Stream B: Empty states (fully independent)
Task: T023-T033 (US3: Empty state classifier)

# Stream C: Filters (largest scope, can start in parallel)
Task: T034-T035 (US2: Constraint resolver — independent)
Task: T036-T038 (US2: URL serialization — independent, parallel with T034)
# Then after T034 completes:
Task: T039-T051 (US2: Typeahead component + integration)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (Tooltip fix)
4. **STOP and VALIDATE**: Tooltips work at all scroll positions
5. This alone fixes the most critical UX bug

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 (Tooltip fix) → Test → Fixes critical bug (MVP!)
3. US4 (Info icons) → Test → Cards are self-documenting
4. US3 (Empty states) → Test → Messaging is context-aware
5. US2 (Unified filters) → Test → Consistent filter UX
6. Polish → Final verification
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With 2 developers after Foundational:
- **Developer A**: US1 → US4 (tooltip stream: fix → info icons)
- **Developer B**: US3 → US2 (data stream: empty states → filters)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Run `pnpm run test:ci` at every checkpoint (T007, T015, T022, T033, T051, T056)
- Total estimated effort: 9-13 hours across all stories
