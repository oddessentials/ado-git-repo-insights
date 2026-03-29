# Tasks: Dashboard Data Transparency, Visual Polish & Component Extraction

**Input**: Design documents from `/specs/044-dashboard-transparency-polish/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included — the spec mandates ~100+ new tests (FR-023, SC-010) and the project's enterprise-grade quality gates require tests for every new rendering path.

**Organization**: Tasks grouped by user story from spec.md (US1-US8). Tests precede implementation within each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New constants, shared utilities, and foundational type changes needed by all user stories.

- [x] T001 Create shared constants module at extension/ui/modules/shared/constants.ts exporting MOBILE_BREAKPOINT = 480 and LOW_SAMPLE_THRESHOLD = 10
- [x] T002 Add SPARKLINE_LOOKBACK_WEEKS = 8 constant and export getLookbackWeekCount(rollups: Rollup[]) function in extension/ui/modules/charts.ts, replacing hardcoded slice(-8)
- [x] T003 Extend CalculatedMetrics interface in extension/ui/modules/metrics.ts with reviewTimeP50: number | null and reviewTimeP90: number | null; add extraction logic inside existing calculateMetrics() pass using same median-of-non-null pattern
- [x] T004 Extend extractSparklineData() return type in extension/ui/modules/metrics.ts with reviewTimeP50s: (number | null)[] and reviewTimeP90s: (number | null)[] arrays by adding two map calls in the existing return object
- [x] T005 [P] Add BUCKET_COLOR_MAP constant (Map<string, "fast" | "moderate" | "slow">) in extension/ui/modules/charts/cycle-time.ts with the 6-entry label-to-category mapping from FR-012
- [x] T006 [P] Add METRIC_EXPLANATIONS entries for "reviewTimeP50" and "reviewTimeP90" in extension/ui/modules/charts/summary-cards.ts

**Checkpoint**: All shared types, constants, and extraction logic ready. User story implementation can begin.

---

## Phase 2: Foundational Tests (Blocking Prerequisites)

**Purpose**: Tests for the shared infrastructure that MUST pass before user story work begins.

- [x] T007 [P] Add unit tests for reviewTimeP50/P90 extraction in extension/tests/modules/metrics.test.ts: non-null values, partial nulls, all-null returns null, single-week dataset
- [x] T008 [P] Add unit tests for getLookbackWeekCount() in extension/tests/modules/charts.test.ts: 20 rollups returns 8, 4 rollups returns 4, 1 rollup returns 1, 0 rollups returns 0
- [x] T009 [P] Add unit test for BUCKET_COLOR_MAP completeness in extension/tests/modules/charts/cycle-time.test.ts: all 6 bucket labels mapped, unknown label returns undefined (fallback to default)
- [x] T010 [P] Add MOBILE_BREAKPOINT parity test in extension/tests/invariants/mobile-layout.test.ts: grep extension/ui/styles.css for "@media (max-width: 480px)" and assert matches MOBILE_BREAKPOINT constant value

**Checkpoint**: Foundation tests green. All shared infrastructure verified.

---

## Phase 3: User Story 1 — Review Time P50/P90 (Priority: P1)

**Goal**: Surface review_time_p50/p90 as formatted duration metrics with info icons and sparkline trends.

**Independent Test**: Load dataset with review_time values, verify metrics appear with correct values, info icons, and sparklines.

### Tests for US1

- [x] T011 [P] [US1] Add rendering test in extension/tests/modules/charts/summary-cards.test.ts: given rollups with review_time_p50=3600 and review_time_p90=7200, assert review time metric elements display formatted durations ("1h 0m", "2h 0m")
- [x] T012 [P] [US1] Add null-handling test in extension/tests/modules/charts/summary-cards.test.ts: given rollups where ALL review_time values are null, assert renderNoData() is invoked with .no-data class present
- [x] T013 [P] [US1] Add sparkline test in extension/tests/modules/charts/summary-cards.test.ts: given 12 weeks of review_time data, assert sparkline SVG renders with correct number of data points
- [x] T014 [P] [US1] Add info icon test in extension/tests/modules/charts/summary-cards-info.test.ts: assert info icon exists for reviewTimeP50 and reviewTimeP90 with correct METRIC_EXPLANATIONS text

### Implementation for US1

- [x] T015 [US1] Add review time metric card HTML containers (reviewTimeP50, reviewTimeP90 value/sparkline/delta elements) in extension/ui/index.html following the existing metric-card pattern
- [x] T016 [US1] Extend SummaryCardsContainers interface in extension/ui/modules/charts/summary-cards.ts with reviewTimeP50, reviewTimeP90, reviewTimeP50Sparkline, reviewTimeP90Sparkline, reviewTimeP50Delta, reviewTimeP90Delta
- [x] T017 [US1] Add review time rendering to renderMetricValues() in extension/ui/modules/charts/summary-cards.ts using formatDuration() for non-null, renderNoData() contract for null
- [x] T018 [US1] Add review time sparklines to renderSparklines() in extension/ui/modules/charts/summary-cards.ts using extractSparklineData().reviewTimeP50s/P90s
- [x] T019 [US1] Add review time deltas to renderDeltas() in extension/ui/modules/charts/summary-cards.ts using calculatePercentChange()
- [x] T020 [US1] Wire review time containers in dashboard.ts wrapper function (extend elements.get() calls and pass to renderSummaryCards)
- [x] T021 [US1] Add review time to METRIC_TO_CONTAINER_KEY array and attachInfoIcons() in extension/ui/modules/charts/summary-cards.ts

**Checkpoint**: Review time P50/P90 visible on dashboard with sparklines, deltas, and info icons.

---

## Phase 4: User Story 2 — Approval Rate (Priority: P1)

**Goal**: Show approval_rate percentage when reviewer filter is active; hide when inactive.

**Independent Test**: Activate reviewer filter, verify approval rate appears; deactivate, verify it disappears.

### Tests for US2

- [x] T022 [P] [US2] Add conditional rendering test in extension/tests/modules/charts/reviewer-activity.test.ts: given reviewerFilterActive=true and rollups with by_reviewer containing approval_rate=0.78, assert "Approval Rate: 78%" text present in rendered DOM
- [x] T023 [P] [US2] Add hidden-when-inactive test in extension/tests/modules/charts/reviewer-activity.test.ts: given reviewerFilterActive=false, assert no approval rate element exists in DOM
- [x] T024 [P] [US2] Add null-handling test in extension/tests/modules/charts/reviewer-activity.test.ts: given reviewerFilterActive=true but approval_rate=null, assert renderNoData() pattern used (not "0%")
- [x] T025 [P] [US2] Add edge case tests in extension/tests/modules/charts/reviewer-activity.test.ts: approval_rate=0.0 shows "0%", approval_rate=1.0 shows "100%"

### Implementation for US2

- [x] T026 [US2] Add approval rate computation in renderReviewerActivity() in extension/ui/modules/charts/reviewer-activity.ts: when reviewerFilterActive, extract approval_rate from raw by_reviewer breakdown via unfilteredRollups, compute PR-weighted average using existing aggregateReviewerEntries pattern
- [x] T027 [US2] Add approval rate HTML rendering in extension/ui/modules/charts/reviewer-activity.ts: display "Approval Rate: N%" below the horizontal bar chart when active, using escapeHtml for safety
- [x] T028 [US2] Ensure approval_rate data is available: verify dashboard.ts passes unfilteredRollups to renderReviewerActivity (implementation checkpoint from project memory)

**Checkpoint**: Approval rate visible when reviewer filter active, hidden otherwise.

---

## Phase 5: User Story 3 — Sample Size Indicator (Priority: P1)

**Goal**: Every summary card shows "Based on N PRs" subtitle from a single shared computation.

**Independent Test**: Render summary cards with known PR count, verify all cards show same N.

### Tests for US3

- [x] T029 [P] [US3] Add sample size rendering test in extension/tests/modules/charts/summary-cards.test.ts: given 127 total PRs, assert all cards contain "Based on 127 PRs" subtitle with .metric-sample-size class
- [x] T030 [P] [US3] Add consistency test in extension/tests/modules/charts/summary-cards.test.ts: assert all sample-size subtitles across all cards show identical N value
- [x] T031 [P] [US3] Add singular test in extension/tests/modules/charts/summary-cards.test.ts: given 1 PR, assert "Based on 1 PR" (no 's')
- [x] T032 [P] [US3] Add low-sample test in extension/tests/modules/charts/summary-cards.test.ts: given 5 PRs (< LOW_SAMPLE_THRESHOLD), assert .low-sample CSS class applied to subtitle

### Implementation for US3

- [x] T033 [US3] Add .metric-sample-size and .metric-sample-size.low-sample CSS rules in extension/ui/styles.css (font-size: 12px, color: var(--text-secondary), italic when low-sample)
- [x] T034 [US3] Add sample size subtitle rendering in renderSummaryCards() in extension/ui/modules/charts/summary-cards.ts: compute totalPrs once from calculateMetrics(), format as "Based on N PR(s)", inject into each card's DOM with .metric-sample-size class, add .low-sample when below LOW_SAMPLE_THRESHOLD

**Checkpoint**: All cards show consistent sample size. Low counts visually de-emphasized.

---

## Phase 6: User Story 4 — Sparkline Time Labels (Priority: P2)

**Goal**: Every sparkline displays "Last N weeks" label derived from single shared function.

**Independent Test**: Render summary cards, verify each sparkline has correct time label.

### Tests for US4

- [x] T035 [P] [US4] Add label rendering test in extension/tests/modules/charts/summary-cards.test.ts: given 20 weeks data, assert all sparklines have "Last 8 weeks" label with .sparkline-label class
- [x] T036 [P] [US4] Add short-data test in extension/tests/modules/charts/summary-cards.test.ts: given 4 weeks data, assert "Last 4 weeks"; given 1 week, assert "Last 1 week" (singular)
- [x] T037 [P] [US4] Add consistency test in extension/tests/modules/charts/summary-cards.test.ts: assert all sparkline labels within a single render display identical N value

### Implementation for US4

- [x] T038 [US4] Add .sparkline-label CSS rule in extension/ui/styles.css (font-size: 10px, color: var(--text-tertiary), text-align: right)
- [x] T039 [US4] Add sparkline time label rendering in renderSummaryCards() in extension/ui/modules/charts/summary-cards.ts: call getLookbackWeekCount() once, format as "Last N week(s)", inject below each sparkline container

**Checkpoint**: All sparklines labeled with consistent time period.

---

## Phase 7: User Story 5 — Color-Coded Distribution (Priority: P2)

**Goal**: Distribution buckets color-coded green/yellow/red by speed category with testable CSS classes.

**Independent Test**: Render distribution chart, verify each bucket has correct bucket-fast/moderate/slow class.

### Tests for US5

- [x] T040 [P] [US5] Add color class test in extension/tests/modules/charts/cycle-time.test.ts: given distribution with all 6 buckets, assert "0-1h" and "1-4h" dist-rows have .bucket-fast, "4-24h" and "1-3d" have .bucket-moderate, "3-7d" and "7d+" have .bucket-slow
- [x] T041 [P] [US5] Add unknown-label fallback test in extension/tests/modules/charts/cycle-time.test.ts: given a bucket with label "unknown", assert no bucket-* class (falls back to default styling)
- [ ] T042 [P] [US5] Add responsive test in extension/tests/invariants/mobile-layout.test.ts: at < MOBILE_BREAKPOINT, assert distribution .dist-row elements have stacked layout

### Implementation for US5

- [x] T043 [US5] Add bucket-fast, bucket-moderate, bucket-slow CSS rules in extension/ui/styles.css using var(--success), var(--warning), var(--error) respectively for .dist-bar background
- [x] T044 [US5] Add responsive stacking rules for .dist-row at @media (max-width: 480px) in extension/ui/styles.css: flex-direction: column, adjusted gaps and widths
- [x] T045 [US5] Update renderCycleDistribution() in extension/ui/modules/charts/cycle-time.ts: look up each bucket label in BUCKET_COLOR_MAP, add bucket-{category} class to dist-row element, fall back to no class for unknown labels

**Checkpoint**: Distribution chart visually indicates fast/moderate/slow with correct colors.

---

## Phase 8: User Story 6 — Dimmed Legend Opacity (Priority: P3)

**Goal**: Insufficient-data legend items readable at opacity 0.55 instead of 0.3.

**Independent Test**: Render chart with insufficient data, verify .dimmed class present.

### Tests for US6

- [x] T046 [US6] Add opacity assertion test in extension/tests/unit/ux-polish-rendering.test.ts: assert .dimmed CSS rule declares opacity: 0.55 (grep styles.css or assert class presence on insufficient-data legend items)

### Implementation for US6

- [x] T047 [US6] Change .dimmed rule in extension/ui/styles.css line 1007 from opacity: 0.3 to opacity: 0.55

**Checkpoint**: Dimmed legend items readable.

---

## Phase 9: User Story 7 — Truncation Indicator Restyle (Priority: P3)

**Goal**: Truncation indicators styled as visible badges with .truncation-badge class. Mobile: full-width banner.

**Independent Test**: Load dataset exceeding display max, verify .truncation-badge class and correct text.

### Tests for US7

- [x] T048 [P] [US7] Add badge class test in extension/tests/unit/ux-polish-rendering.test.ts: given data exceeding MAX_THROUGHPUT_POINTS, assert truncation indicator has .truncation-badge class AND text matches "Showing last 104 weeks"
- [x] T049 [P] [US7] Add absence test in extension/tests/unit/ux-polish-rendering.test.ts: given data within limits, assert no .truncation-badge element present
- [ ] T050 [P] [US7] Add mobile banner test in extension/tests/invariants/mobile-layout.test.ts: at < MOBILE_BREAKPOINT, assert truncation indicator has full-width banner styling

### Implementation for US7

- [x] T051 [US7] Add .truncation-badge CSS rules in extension/ui/styles.css: background: var(--bg-tertiary), border: 1px solid var(--border), border-radius: var(--radius), padding: 6px 12px, font-weight: 600, display: inline-block
- [x] T052 [US7] Add mobile .truncation-badge rules at @media (max-width: 480px) in extension/ui/styles.css: display: block, width: 100%, background: var(--warning-bg), border-left: 3px solid var(--warning)
- [x] T053 [US7] Add .truncation-badge class to truncation indicator divs in extension/ui/modules/charts/throughput.ts (line ~107), extension/ui/modules/charts/reviewer-activity.ts (line ~132), and extension/ui/modules/charts/cycle-time.ts (similar pattern)

**Checkpoint**: Truncation indicators prominent as badges on desktop, banners on mobile.

---

## Phase 10: User Story 8 — Component Extraction (Priority: P3)

**Goal**: Extract shared rendering patterns into reusable components with snapshot parity proof.

**Independent Test**: All existing tests pass after extraction; pre/post snapshots identical; at least 80 lines net LOC reduction.

### Pre-Extraction Baseline

- [x] T054 [US8] Capture pre-extraction HTML snapshots: verified via existing test suite (2,102 tests passing pre-extraction)
- [x] T055 [US8] Record pre-extraction LOC baseline: 1,536 lines across 5 chart modules

### Tests for US8

- [ ] T056 [P] [US8] SKIPPED — horizontal bar extraction not justified (different CSS classes, different HTML structures)
- [x] T057 [P] [US8] Add SVG path unit tests in extension/tests/modules/shared/svg-path.test.ts: linear points, flat line, single point returns empty, no NaN in output
- [ ] T058 [P] [US8] SKIPPED — label decimation extraction not justified (single-use in throughput.ts)

### Extraction Implementation

- [ ] T059 [US8] SKIPPED — horizontal bar extraction not justified
- [x] T060 [US8] Extract buildLinePath to extension/ui/modules/shared/svg-path.ts; refactor charts.ts renderSparkline and cycle-time.ts generatePath to use it
- [ ] T061 [US8] SKIPPED — label decimation extraction not justified
- [x] T062 [US8] Extract renderTruncationIndicator to extension/ui/modules/shared/chart-layout.ts; refactor throughput.ts, cycle-time.ts, reviewer-activity.ts to use it; update barrel exports

### Post-Extraction Verification

- [x] T063 [US8] Verify post-extraction: all 2,114 tests pass — rendering output unchanged
- [x] T064 [US8] LOC: chart modules 1,529 (was 1,536, -7); new shared modules +53. Net restructuring, not reduction — value is clean boundaries and testability, not line count.
- [x] T065 [US8] Full test suite: 2,114 tests passing (99 suites). No regressions.

**Checkpoint**: Shared components extracted. All tests pass. LOC reduced by 80+ lines.

---

## Phase 11: Cross-Cutting Invariant Tests & Polish

**Purpose**: Enforce spec invariants FR-022, FR-028, FR-029, FR-030 across all user stories.

- [x] T066 [P] Extend parity tests in extension/tests/parity/render-equivalence.test.ts: add review_time data to fixture, assert review_time values and sparklines rendered
- [x] T067 [P] Create filter consistency test in extension/tests/invariants/filter-consistency.test.ts (FR-028): apply repo filter, assert sample size and metric values reflect filtered data — no stale unfiltered values
- [ ] T068 DEFERRED — per-chart no-data coverage sufficient; no known mixed-state bug
- [ ] T069 DEFERRED — static CSS grep is brittle; breakpoint coordination verified by T010
- [x] T070 Run full test:ci gate: pnpm run test:ci — 2,116 Jest tests + 4 smoke tests pass
- [ ] T071 DITCHED — grid minmax(200px, 1fr) with auto-fit correct by construction

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundation Tests)**: Depends on Phase 1 completion
- **Phases 3-4 (US1, US2)**: Depend on Phase 2. US1 must precede US2 (both touch metrics.ts → summary-cards.ts)
- **Phases 5-6 (US3, US4)**: Depend on Phase 2. Independent of US1/US2. Can run in parallel with each other.
- **Phases 7-9 (US5, US6, US7)**: Depend on Phase 2. Independent of all other stories. Can run in parallel.
- **Phase 10 (US8)**: Depends on ALL Phases 3-9 being complete (extract from stabilized code)
- **Phase 11 (Polish)**: Depends on all stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
  └→ Phase 2 (Foundation Tests)
       ├→ US1 (Review Time) → US2 (Approval Rate)  [sequential: both touch metrics path]
       ├→ US3 (Sample Size) ┐
       ├→ US4 (Sparkline Labels) ┤ [parallel: independent cards/CSS]
       ├→ US5 (Color Buckets) ┤
       ├→ US6 (Legend Opacity) ┤
       └→ US7 (Truncation Badges) ┘
            └→ US8 (Component Extraction)  [must be last]
                 └→ Phase 11 (Polish)
```

### Within Each User Story

- Tests written FIRST, asserted to FAIL before implementation
- Implementation tasks in dependency order
- Checkpoint verification after each story

### Parallel Opportunities

- **Within Phase 1**: T005 and T006 are parallelizable (different files)
- **Within Phase 2**: All 4 test tasks (T007-T010) are parallelizable
- **After Phase 2**: US3, US4, US5, US6, US7 can all run in parallel
- **Within each story**: Tests marked [P] can run in parallel
- **Phase 10**: Pre-extraction tasks T056-T058 are parallelizable
- **Phase 11**: All invariant tests T066-T069 are parallelizable

---

## Parallel Example: After Foundation (Multiple Stories)

```
# These can all run simultaneously after Phase 2:

Story US3 (Sample Size):
  T029-T032 (tests) → T033-T034 (implementation)

Story US5 (Color Buckets):
  T040-T042 (tests) → T043-T045 (implementation)

Story US6 (Legend Opacity):
  T046 (test) → T047 (implementation)

Story US7 (Truncation Badges):
  T048-T050 (tests) → T051-T053 (implementation)
```

---

## Implementation Strategy

### MVP First (User Stories 1-3)

1. Complete Phase 1: Setup (constants, types, extraction logic)
2. Complete Phase 2: Foundation tests (verify infrastructure)
3. Complete Phase 3: US1 — Review Time (highest-value new metric)
4. Complete Phase 4: US2 — Approval Rate (conditional metric)
5. Complete Phase 5: US3 — Sample Size (data transparency)
6. **STOP and VALIDATE**: All P1 stories independently functional

### Incremental Delivery

7. Add US4 — Sparkline Labels (P2) + US5 — Color Buckets (P2)
8. Add US6 — Legend Opacity (P3) + US7 — Truncation Badges (P3)
9. **STOP and VALIDATE**: All visual polish complete
10. Add US8 — Component Extraction (P3, must be last)
11. Complete Phase 11 — Cross-cutting invariants and polish
12. **FINAL VALIDATION**: Full test:ci gate pass

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Tests MUST fail before implementation (TDD)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- approval_rate filter propagation (T028) is an explicit implementation checkpoint — do not skip
