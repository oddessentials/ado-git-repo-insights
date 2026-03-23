# Tasks: Dashboard UX Polish

**Input**: Design documents from `/specs/036-dashboard-ux-polish/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED — the spec mandates automated deterministic testing (SC-010) and the plan includes test tasks in every phase.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the CSS contract test framework and rendering constants that all user stories depend on.

- [ ] T001 Create CSS stylesheet contract test file at `extension/tests/unit/css-contract.test.ts` — reads `extension/ui/styles.css` as text and provides helper `expectSelectorExists(selector)` using regex matching. Start with a passing smoke test that asserts the file is non-empty.
- [ ] T002 [P] Export new rendering constants in `extension/ui/modules/charts/throughput.ts`: `MAX_VISIBLE_LABELS = 16`. Export in `extension/ui/modules/charts.ts`: `SCROLL_CANCEL_THRESHOLD = 10`.
- [ ] T003 [P] Create touch-target constant assertions at `extension/tests/unit/touch-target-contract.test.ts` — import `MAX_VISIBLE_LABELS` and assert it equals 16. Assert `SCROLL_CANCEL_THRESHOLD` equals 10. These are contract-locking tests.

**Checkpoint**: Test framework and constants in place. `pnpm test` passes with new test files.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: CSS rules that MUST exist before any user story rendering or DOM assertions can be verified.

**CRITICAL**: No user story work can begin until this phase is complete.

> **Note**: T004–T012 are logically independent rule blocks but all target the same file (`styles.css`). Execute sequentially in a single editing session — do NOT attempt parallel execution.

- [ ] T004 Add `.filter-hint` base CSS rules in `extension/ui/styles.css` — background: `var(--bg-secondary)`, padding: `8px 12px`, border-left: `3px solid var(--info, #0078d4)`, border-radius: `var(--radius)`, font-size: `13px`, color: `var(--text-secondary)`, margin-top: `4px`, line-height: `1.4`.
- [ ] T005 Add `.filter-hint-warning` CSS variant in `extension/ui/styles.css` — border-left-color: `var(--warning)`, background: `#fff8e1`.
- [ ] T006 Restyle `.truncation-indicator` in `extension/ui/styles.css` — change color from `var(--text-tertiary)` to `var(--text-secondary)`, font-size from `11px` to `12px`, add font-weight: `500`. Position with `margin-bottom: 8px` (above chart).
- [ ] T007 Add `.btn:active` and `.btn:disabled` rules in `extension/ui/styles.css` — active: `filter: brightness(0.9)`. Disabled: `opacity: 0.6`, `cursor: not-allowed`, `pointer-events: none`.
- [ ] T008 Add `.btn-secondary:active`, `.btn-secondary:disabled` rules in `extension/ui/styles.css` — same pattern as primary button states.
- [ ] T009 Add `.filter-group select:hover` and `.filter-group input:hover` rules in `extension/ui/styles.css` — subtle border-color change to `var(--border-strong)`.
- [ ] T010 Add `input[type="search"]` normalization rules in `extension/ui/styles.css` — explicit height via padding `8px 12px`, `-webkit-appearance: none`, border, border-radius, placeholder color via `::placeholder`, focus ring matching other inputs. Add `::-webkit-search-cancel-button` styling.
- [ ] T011 Add `.tab.disabled` CSS rule in `extension/ui/styles.css` — `opacity: 0.5`, `cursor: not-allowed`, `pointer-events: none`, distinct from `.tab` inactive state.
- [ ] T012 Increase touch-target sizes in `extension/ui/styles.css` — `.filter-chip-remove`: add `min-width: 44px`, `min-height: 44px`, `display: inline-flex`, `align-items: center`, `justify-content: center`. `.btn-small`: increase padding to `8px 12px`. `.filter-group select` and `.filter-group input`: increase padding to `8px 12px`. `.export-option`: increase padding to `12px 16px`.
- [ ] T013 Add CSS contract assertions for all foundational rules in `extension/tests/unit/css-contract.test.ts` — assert selectors exist: `.filter-hint`, `.filter-hint-warning`, `.truncation-indicator`, `.btn:active`, `.btn:disabled`, `.btn-secondary:active`, `.btn-secondary:disabled`, `.filter-group select:hover`, `.filter-group input:hover`, `input[type="search"]`, `.tab.disabled`.

**Checkpoint**: All foundational CSS rules exist and pass contract tests. `pnpm test` passes.

---

## Phase 3: User Story 1 — Dense Data Readability at Enterprise Scale (Priority: P1)

**Goal**: Throughput chart labels are thinned deterministically, scroll affordance is visible, and truncation indicators are prominent.

**Independent Test**: Load enterprise demo dataset (260 weeks → 104 bars after truncation). Verify 15 labels render at indices 0,7,...,98. Verify truncation indicator is prominent. Verify scroll affordance.

### Tests for User Story 1

- [ ] T014 [P] [US1] Add label thinning test cases in `extension/tests/modules/charts/throughput.test.ts` — test 16 bars → all labels visible (16 non-empty `.bar-label` elements). Test 17 bars → step=2, 9 labels. Test 104 bars → step=7, 15 labels at indices 0,7,14,...,98. Assert total `.bar-label` count equals barCount (elements always present). Assert non-empty labels match expected count.
- [ ] T015 [P] [US1] Add truncation indicator prominence tests in `extension/tests/unit/ux-polish-rendering.test.ts` — (a) render throughput with >104 rollups, assert `.truncation-indicator` element exists and does NOT contain class referencing tertiary color, assert text content includes "Showing last". (b) Render cycle-time trend with >104 rollups, assert the same `.truncation-indicator` prominence criteria apply (shared CSS class from T006 covers both charts — this test confirms cycle-time also benefits).

### Implementation for User Story 1

- [ ] T016 [US1] Implement label thinning in `extension/ui/modules/charts/throughput.ts` — compute `labelStep = Math.ceil(displayRollups.length / MAX_VISIBLE_LABELS)`. In the `.map()` callback (lines 48-61), conditionally emit label text: render `escapeHtml(weekLabel)` when `index % labelStep === 0`, render empty string otherwise. Always emit the `.bar-label` div element.
- [ ] T017 [US1] Add scroll affordance to throughput chart in `extension/ui/styles.css` — add a gradient fade overlay on the right edge of `.bar-chart` when content overflows (using `::after` pseudo-element with `linear-gradient(to right, transparent, var(--bg-primary))` positioned absolute right, `pointer-events: none`). This communicates scrollability without JavaScript.
- [ ] T018 [US1] Move truncation indicator above the chart in `extension/ui/modules/charts/throughput.ts` — reorder the rendered HTML so `truncationHtml` appears before `barsHtml` in the container output. Verify the `.truncation-indicator` restyled CSS (T006) renders prominently.

**Checkpoint**: Label thinning produces deterministic output matching the contract table. Truncation is prominent. `pnpm test` passes.

---

## Phase 4: User Story 2 — Cross-Browser Author Filter and Filter Hints (Priority: P1)

**Goal**: `.filter-hint` banners render with visible styling. Author filter input is normalized. Reviewer constrained-mode notice uses warning severity.

**Independent Test**: Activate comments coverage banner, reviewer constrained notice, and author notice — verify each renders with visible background, border accent, and padding.

### Tests for User Story 2

- [ ] T019 [P] [US2] Add filter hint rendering tests in `extension/tests/unit/ux-polish-rendering.test.ts` — create elements with `class="filter-hint"` and `class="filter-hint filter-hint-warning"`. Assert CSS classes are correctly assigned. Test that `dashboard.ts` reviewer notice path adds `filter-hint-warning` class when constrained mode is active.

### Implementation for User Story 2

- [ ] T020 [US2] Add `.filter-hint-warning` class toggle in `extension/ui/dashboard.ts` — in the reviewer filter notice update logic (around line 1659-1667), when `reviewerFilterNoticeMessage` is set and indicates constrained mode, add `filter-hint-warning` class to `reviewer-filter-notice` element. Remove the class when notice is cleared.
- [ ] T021 [US2] Verify author filter normalization — CSS added in T010 is the automated deliverable (SC-004 verified by DOM dimension assertion on the input element in T013's CSS contract test). Supplementary manual QA: spot-check in Chrome, Firefox, and Edge that the input height, border, and focus ring are visually consistent. No additional TypeScript changes needed.

**Checkpoint**: All three filter hints render with visible styling. Author filter is normalized. `pnpm test` passes.

---

## Phase 5: User Story 3 — Touch-Friendly Interactive Elements (Priority: P1)

**Goal**: Filter chip remove buttons meet 44x44px. Secondary controls meet 36px. Chart tooltips work via tap/click.

**Independent Test**: Render filter chips and verify remove button dimensions. Simulate click on chart data points and verify tooltip appears.

### Tests for User Story 3

- [ ] T022 [P] [US3] Add tooltip tap/click tests in `extension/tests/modules/charts/tooltip.test.ts` — test that calling `addChartTooltips()` on a container with `[data-tooltip]` elements and simulating a `click` event creates a `.chart-tooltip` element. Test that clicking elsewhere dismisses it. Test that clicking a different point replaces the tooltip.
- [ ] T023 [P] [US3] Add touch target verification in `extension/tests/unit/touch-target-contract.test.ts` — two-layer approach: (a) CSS contract layer: read `styles.css` as text and assert the `.filter-chip-remove` rule contains `min-width: 44px` and `min-height: 44px` via regex. (b) DOM layer: render a filter chip with remove button via the dom-harness, assert the `.filter-chip-remove` element has the expected CSS class applied. JSDOM cannot verify computed layout — the CSS contract test provides the dimension guarantee.

### Implementation for User Story 3

- [ ] T024 [US3] Extend `addChartTooltips()` in `extension/ui/modules/charts.ts` with click/tap support — add `pointerdown` handler recording `{x, y}` origin on `dot.dataset`. Add `pointerup` handler: if distance < `SCROLL_CANCEL_THRESHOLD` (10px), create tooltip (reusing existing positioning logic) and dismiss any previous tooltip. Add document-level `click` listener to dismiss active tooltip when clicking outside.
- [ ] T025 [US3] Add `data-tooltip` attributes and call `addChartTooltips()` for throughput bars in `extension/ui/modules/charts/throughput.ts` — add `data-tooltip="true"` with `data-week` and `data-count` attributes to each `.bar-container`. After rendering, call `addChartTooltips(container, contentFn)` where `contentFn` reads the bar's data attributes. Remove native `title` attributes to prevent double-tooltip. **Also update** existing assertions in `extension/tests/modules/charts/throughput.test.ts` that check `title="2025-W01: 10 PRs"` — replace with `data-tooltip` and `data-week`/`data-count` attribute assertions to match the new rendering.
- [ ] T026 [US3] Add tab ARIA attributes in `extension/ui/index.html` — add `role="tab"`, `aria-selected="false"` (or `"true"` for default active tab), and `aria-controls` pointing to the corresponding tab content panel ID on each `.tab` button element (lines 173-177).

**Checkpoint**: Tooltips respond to tap/click. Touch targets meet tier requirements. ARIA attributes present. `pnpm test` passes.

---

## Phase 6: User Story 4 — Mobile-Responsive Layout (Priority: P2)

**Goal**: Dashboard adapts to 480px viewport width. Typography scales. Comparison banner stacks.

**Independent Test**: Render at 375px width — verify no horizontal overflow. Summary cards are single-column.

### Tests for User Story 4

- [ ] T027 [P] [US4] Add 480px breakpoint CSS contract test in `extension/tests/unit/css-contract.test.ts` — assert `@media (max-width: 480px)` block exists in stylesheet. Assert it contains rules for `.summary-cards`, `.dashboard-header h1`, `.metric-value`.

### Implementation for User Story 4

- [ ] T028 [US4] Add `@media (max-width: 480px)` breakpoint in `extension/ui/styles.css` — rules: `.summary-cards { grid-template-columns: 1fr; }`, `.dashboard-header h1 { font-size: 16px; }`, `.metric-value { font-size: 24px; }`, `.loading-state, .error-state { min-height: 250px; padding: 24px; }`, `.error-state .error-icon { font-size: 32px; }`, `.filter-bar { gap: 12px; }`, `.main-content { padding: 16px; }`.
- [ ] T029 [US4] Add toast mobile positioning in `extension/ui/styles.css` within the 480px breakpoint — `.toast { bottom: 12px; right: 12px; left: 12px; max-width: calc(100vw - 24px); }`.
- [ ] T030 [US4] Add comparison banner responsive rules in `extension/ui/styles.css` within the existing 768px breakpoint — `.comparison-banner { flex-direction: column; gap: 12px; }`, `.comparison-vs { font-size: 14px; }`. Within 480px: `.comparison-period .period-dates { font-size: 12px; }`.
- [ ] T031 [US4] Add export menu mobile positioning in `extension/ui/styles.css` within the 480px breakpoint — `.export-menu { min-width: 140px; right: auto; left: 0; }`.

**Checkpoint**: No horizontal overflow at 375px. Typography scaled. CSS contract tests pass.

---

## Phase 7: User Story 5 — Complete Button and Input States (Priority: P2)

**Goal**: All buttons have active/disabled states. Inputs have hover states. Tabs have disabled state.

**Independent Test**: Verify CSS rules exist via contract tests (foundational CSS already added in Phase 2).

### Verification for User Story 5

- [ ] T032 [US5] CSS already added in Phase 2 (T007-T011) and contract-tested by T013. Verify integration by rendering buttons in JSDOM in `extension/tests/unit/ux-polish-rendering.test.ts` — add test: create a button with `disabled` attribute, assert it matches `.btn:disabled` selector. Create a `.tab.disabled` element, verify class presence. Confirm T013 contract assertions still pass (no regression).

**Checkpoint**: All button/input states defined. `pnpm test` passes.

---

## Phase 8: User Story 6 — Actionable Error and Empty States (Priority: P2)

**Goal**: Empty-state messages include contextual guidance. Loading/error containers reduce height on mobile.

**Independent Test**: Trigger empty states with narrow filter, verify message contains guidance text.

### Tests for User Story 6

- [ ] T034 [P] [US6] Add empty-state message content tests in `extension/tests/unit/ux-polish-rendering.test.ts` — call `renderNoData()` with known trigger contexts. Assert the rendered text contains guidance hints (e.g., "Try widening", "At least 2 weeks"). Assert messages do NOT just say "No data" without context.

### Implementation for User Story 6

- [ ] T035 [US6] Update `renderNoData()` in `extension/ui/modules/shared/render.ts` — accept an optional `hint` parameter. If provided, append it after the primary message as a secondary paragraph with class `no-data-hint`. Update all callers in chart modules to pass contextual hints.
- [ ] T036 [US6] Update empty-state callers — in `extension/ui/modules/charts/throughput.ts`: pass hint "Try widening the date range or adjusting repository/team filters." In `extension/ui/modules/charts/cycle-time.ts`: for trend chart, pass hint "At least 2 weeks of data are needed to show trends." In `extension/ui/modules/charts/reviewer-activity.ts`: pass hint "Reviewer data requires the extraction pipeline to capture reviewer details."
- [ ] T037 [US6] Add `.no-data-hint` CSS rule in `extension/ui/styles.css` — `font-size: 12px`, `color: var(--text-tertiary)`, `margin-top: 8px`, `font-style: normal` (not italic like parent `.no-data`).

**Checkpoint**: All empty states include contextual hints. Mobile height reduced (480px breakpoint already added in Phase 6). `pnpm test` passes.

---

## Phase 9: User Story 7 — Print-Friendly Dashboard View (Priority: P3)

**Goal**: `@media print` hides interactive chrome while preserving analytical context.

**Independent Test**: Print preview shows clean output with filter summaries, comparison labels, and truncation indicators preserved.

### Tests for User Story 7

- [ ] T038 [P] [US7] Add print stylesheet CSS contract tests in `extension/tests/unit/css-contract.test.ts` — assert `@media print` block exists. Assert it contains `display: none` for `.filter-bar`, `.btn`, `.toast`, `.export-menu`, `.tabs`, `.filter-chip-remove`. Assert it does NOT hide `.active-filters`, `.comparison-banner`, `.filter-hint`, `.truncation-indicator`.

### Implementation for User Story 7

- [ ] T039 [US7] Add `@media print` block in `extension/ui/styles.css` — hide: `.filter-bar { display: none; }`, `.btn { display: none; }`, `.toast { display: none; }`, `.export-menu { display: none; }`, `.tabs { display: none; }`, `.filter-chip-remove { display: none; }`. Preserve (by NOT targeting in hide rules): `.active-filters { display: flex !important; }`, `.active-filters .active-filters-label { display: inline; }`, `.filter-hint:not(.hidden)`, `.truncation-indicator`, `.comparison-banner`. Style: `body { background: white; }`, `* { box-shadow: none !important; }`, `.chart-container { page-break-inside: avoid; width: 100%; }`. T038's contract test verifies both the hidden and preserved selector lists.

**Checkpoint**: Print preview clean. CSS contract tests pass. `pnpm test` passes.

---

## Phase 10: User Story 8 — Refined Tab and Animation Transitions (Priority: P3)

**Goal**: Tab content fade-in feels polished at 0.25s duration.

**Independent Test**: Switch tabs — transition is smooth, not jarring.

### Implementation for User Story 8

- [ ] T041 [US8] Update `@keyframes fadeIn` duration in `extension/ui/styles.css` — change animation duration from `0.2s` to `0.25s` in the `.tab-content` rule (around line 486). Verify easing is `ease` (already correct).

**Checkpoint**: Tab transitions feel polished. No test regression.

---

## Phase 11: Truncation Badges for Predictions and Sparklines (Cross-cutting P1/P2)

**Goal**: Add truncation badges to predictions and sparkline charts that silently truncate data.

### Tests for Truncation Badges

- [ ] T042 [P] Add predictions truncation badge test in `extension/tests/unit/ux-polish-rendering.test.ts` — render predictions with data exceeding `MAX_CHART_POINTS` (200). Assert a `.truncation-badge` element is rendered with text indicating partial data.
- [ ] T043 [P] Add sparkline truncation badge test in `extension/tests/unit/ux-polish-rendering.test.ts` — render sparkline with data exceeding `MAX_SPARKLINE_POINTS`. Assert a `.truncation-badge` element is rendered.

### Implementation for Truncation Badges

- [ ] T044 Add truncation badge to predictions chart in `extension/ui/modules/charts/predictions.ts` — after the data slicing at line 389-390, if original data length exceeds `MAX_CHART_POINTS`, render a `<span class="truncation-badge" title="Showing last ${MAX_CHART_POINTS} data points">Partial history</span>` near the chart header.
- [ ] T045 Add truncation badge to sparklines in `extension/ui/modules/ml.ts` — after slicing at lines 170-171, if original values exceed `MAX_SPARKLINE_POINTS`, add a `<span class="truncation-badge">*</span>` near the sparkline with an explanatory title attribute.
- [ ] T046 Add `.truncation-badge` CSS rule in `extension/ui/styles.css` — `font-size: 11px`, `color: var(--text-secondary)`, `background: var(--bg-tertiary)`, `padding: 2px 6px`, `border-radius: var(--radius)`, `margin-left: 8px`, `vertical-align: middle`.

**Checkpoint**: Truncation badges visible when data is capped. `pnpm test` passes.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Integration verification, parity checks, and final validation.

- [ ] T047 Rebuild extension UI bundle — `cd extension && pnpm build:ui`
- [ ] T048 Sync UI bundle to CLI — `python -c "from ado_git_repo_insights.utils.ui_sync import sync_ui_bundle; sync_ui_bundle()"`
- [ ] T049 Verify demo parity — `python scripts/build-demo-dataset.py` succeeds with byte-identical regeneration
- [ ] T050 Run demo parity tests — `pytest tests/demo/ -v` all pass
- [ ] T051 Run full extension test suite — `cd extension && pnpm test:ci`
- [ ] T052 Run full preflight — `python scripts/run_pr_preflight.py`
- [ ] T053 Manual verification — load `docs/index.html` at 375px width (no horizontal overflow), 1280px width (labels thinned), print preview (chrome hidden, context preserved)
- [ ] T054 Run quickstart.md validation per `specs/036-dashboard-ux-polish/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **User Stories (Phases 3-10)**: All depend on Phase 2 completion
  - US1 (Phase 3), US2 (Phase 4), US3 (Phase 5) — P1 stories, can proceed in parallel
  - US4 (Phase 6), US5 (Phase 7), US6 (Phase 8) — P2 stories, can proceed in parallel after P1
  - US7 (Phase 9), US8 (Phase 10) — P3 stories
- **Truncation Badges (Phase 11)**: Can run in parallel with any story after Phase 2
- **Polish (Phase 12)**: Depends on ALL previous phases — final verification

### User Story Dependencies

- **US1** (Dense Data): No dependencies on other stories
- **US2** (Filter Hints): No dependencies on other stories (CSS from Phase 2)
- **US3** (Touch Targets): No dependencies on other stories (CSS from Phase 2)
- **US4** (Mobile): Independent — pure CSS additions
- **US5** (Button States): CSS already in Phase 2 — verification only
- **US6** (Empty States): Independent — rendering changes
- **US7** (Print): Independent — pure CSS additions
- **US8** (Animations): Independent — single CSS change
- **Truncation Badges**: Independent — predictions.ts and ml.ts changes

### Within Each User Story

- Tests FIRST (assert expected behavior fails before implementation)
- CSS rules before TypeScript rendering changes
- Rendering changes before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T002, T003: Setup constants — parallel (different files)
- T004-T012: All foundational CSS — logically independent but sequential (same file `styles.css`)
- T014, T015: US1 tests — parallel (different test files)
- T019, T022, T023: US2/US3 tests — parallel (different test files)
- T027, T034, T038: US4/US6/US7 tests — parallel (different test assertions)
- T042, T043: Truncation badge tests — parallel
- US1, US2, US3: All P1 stories — parallel after Phase 2
- US4, US5, US6: All P2 stories — parallel after P1 stories

---

## Parallel Example: P1 Stories After Phase 2

```text
# After Phase 2 completes, launch all P1 story tests simultaneously:
Agent A: T014 + T015 (US1 tests), then T016 + T017 + T018 (US1 implementation)
Agent B: T019 (US2 tests), then T020 + T021 (US2 implementation)
Agent C: T022 + T023 (US3 tests), then T024 + T025 + T026 (US3 implementation)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational CSS (T004-T013)
3. Complete Phase 3: US1 — Dense Data Readability (T014-T018)
4. **STOP and VALIDATE**: Label thinning produces 15 labels for 104 bars, truncation is prominent
5. This alone delivers the single highest-impact polish improvement

### Incremental Delivery

1. Setup + Foundational → CSS foundation ready
2. US1 (Dense Data) → Test → Highest-impact visual improvement
3. US2 (Filter Hints) → Test → Data-quality signals visible
4. US3 (Touch Targets) → Test → Accessibility compliance
5. US4-US8 → Test → Responsive, print, polish
6. Truncation Badges → Test → Enterprise data completeness signals
7. Integration → Full parity verification

### Parallel Team Strategy

With multiple developers after Phase 2:
- **Developer A**: US1 (throughput.ts) + US6 (render.ts) — chart rendering focus
- **Developer B**: US2 (dashboard.ts) + US3 (charts.ts + index.html) — interaction focus
- **Developer C**: US4 + US7 + US8 (styles.css only) — pure CSS focus
- **All**: Phase 12 integration verification together

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- All CSS changes are in a single file (`styles.css`) — foundational rules (Phase 2) MUST be committed before story-specific CSS to avoid merge conflicts
- Test assertions use JSDOM-compatible patterns: `innerHTML.toContain()`, `querySelectorAll()`, `classList.contains()`, stylesheet-as-text regex
- No visual regression framework — CSS contract tests read the stylesheet as a string
- Commit after each phase completion, not after individual tasks
- The `styles.css` file is the highest-contention file — Phase 2 establishes all foundational rules to minimize later conflicts
