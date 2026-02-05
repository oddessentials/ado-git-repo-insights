# Tasks: Dashboard Scalability

**Input**: Design documents from `/specs/024-dashboard-scalability/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included - the specification explicitly requires automated scalability tests (FR-013 through FR-015, User Story 5).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

- **Python Generator**: `scripts/generate-synthetic-dataset.py`
- **Python Tests**: `tests/unit/test_synthetic_dataset.py`
- **TypeScript Charts**: `extension/ui/modules/charts/`
- **TypeScript Tests**: `extension/tests/`
- **CI Workflows**: `.github/workflows/`

---

## Phase 1: Setup

**Purpose**: Ensure environment is ready and existing tests pass

- [ ] T001 Verify Python 3.11+ is available and generator runs with existing parameters in `scripts/generate-synthetic-dataset.py`
- [ ] T002 [P] Verify Node 22+ and pnpm 9.15+ are available for extension development
- [ ] T003 [P] Run existing test suite to establish baseline (`pytest tests/unit && cd extension && pnpm test`)
- [ ] T004 [P] Create `extension/tests/unit/` directory if it does not exist

**Checkpoint**: Environment ready, baseline tests passing

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: User Story 1 (Generator) must complete before User Stories 2-4 can be tested

- [ ] T005 Read and understand existing generator structure in `scripts/generate-synthetic-dataset.py`
- [ ] T006 [P] Read and understand existing chart implementation in `extension/ui/modules/charts/throughput.ts`
- [ ] T007 [P] Read and understand existing chart implementation in `extension/ui/modules/charts/cycle-time.ts`
- [ ] T008 [P] Review existing `extension/tests/scalability-invariants.test.ts` for current assertions

**Checkpoint**: Codebase understood, ready for implementation

---

## Phase 3: User Story 1 - Generate Enterprise-Scale Test Data (Priority: P1) 🎯 MVP

**Goal**: Enable synthetic data generation with 156+ weeks, 200+ users, and comment data

**Independent Test**: Run generator with `--weeks 156 --users 200 --include-comments` and verify output

### Tests for User Story 1

- [ ] T009 [P] [US1] Add test for --users argument accepting 1-500 in `tests/unit/test_synthetic_dataset.py`
- [ ] T010 [P] [US1] Add test for --weeks argument accepting 1-520 in `tests/unit/test_synthetic_dataset.py`
- [ ] T011 [P] [US1] Add test for --include-comments flag setting `features.comments: true` in `tests/unit/test_synthetic_dataset.py`
- [ ] T012 [P] [US1] Add test for --users 0 validation error in `tests/unit/test_synthetic_dataset.py`
- [ ] T013 [P] [US1] Add test for --weeks 0 validation error in `tests/unit/test_synthetic_dataset.py`
- [ ] T014 [US1] Add test verifying 200 users produces 200 entries in dimensions.json in `tests/unit/test_synthetic_dataset.py`
- [ ] T015 [US1] Add test verifying 156 weeks produces 156 rollup files in `tests/unit/test_synthetic_dataset.py`

### Implementation for User Story 1

- [ ] T016 [US1] Add `--users` CLI argument to argparse in `scripts/generate-synthetic-dataset.py` (accept 1-500, default None)
- [ ] T017 [US1] Add `--weeks` CLI argument to existing argparse in `scripts/generate-synthetic-dataset.py` (no cap removal needed, already has --weeks)
- [ ] T018 [US1] Remove 30-user cap at line 50 in `scripts/generate-synthetic-dataset.py`, use `args.users if args.users else min(200, max(10, pr_count // 10))`
- [ ] T019 [US1] Remove 52-week cap at line 82 in `scripts/generate-synthetic-dataset.py`, use `min(156, max(4, pr_count // 20))` as new default
- [ ] T020 [US1] Add `--include-comments` boolean flag to argparse in `scripts/generate-synthetic-dataset.py`
- [ ] T021 [US1] Implement `generate_threads()` function for comment data generation in `scripts/generate-synthetic-dataset.py` (2-5 threads per PR)
- [ ] T022 [US1] Implement `generate_comments()` function for comment data generation in `scripts/generate-synthetic-dataset.py` (1-4 comments per thread)
- [ ] T023 [US1] Update manifest generation to set `features.comments: true` when --include-comments in `scripts/generate-synthetic-dataset.py`
- [ ] T024 [US1] Add comment statistics to coverage section in manifest in `scripts/generate-synthetic-dataset.py`
- [ ] T025 [US1] Add input validation for --users and --weeks bounds with clear error messages in `scripts/generate-synthetic-dataset.py`
- [ ] T026 [US1] Run full generator test suite to verify all tests pass: `pytest tests/unit/test_synthetic_dataset.py -v`

**Checkpoint**: Generator can produce 156-week, 200-user, comments-enabled datasets. Run:
```bash
python scripts/generate-synthetic-dataset.py --pr-count 10000 --weeks 156 --users 200 --include-comments --seed 42 --output test-data/scalability
```

---

## Phase 4: User Story 2 - View Dashboard with 3 Years of Data (Priority: P1)

**Goal**: Charts render correctly and efficiently with 156+ weeks of data, with truncation indicators

**Independent Test**: Load 156-week dataset in dashboard and verify render time < 1s, truncation indicator visible

**Depends on**: User Story 1 (needs generated test data)

### Tests for User Story 2

- [ ] T027 [P] [US2] Add render time test for throughput chart with 156 weeks (< 1000ms) in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T028 [P] [US2] Add render time test for cycle time chart with 156 weeks (< 1000ms) in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T029 [P] [US2] Add DOM element count test for throughput chart (≤ 104 elements) in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T030 [P] [US2] Add DOM element count test for cycle time chart (≤ 104 elements) in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T031 [US2] Add truncation indicator visibility test for throughput chart in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T032 [US2] Add truncation indicator visibility test for cycle time chart in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T033 [US2] Add test verifying no truncation indicator for exactly 104 weeks in `extension/tests/unit/chart-scalability.test.ts`

### Implementation for User Story 2

- [ ] T034 [US2] Add `MAX_THROUGHPUT_POINTS = 104` constant to `extension/ui/modules/charts/throughput.ts`
- [ ] T035 [US2] Implement data truncation logic using `.slice(-MAX_THROUGHPUT_POINTS)` in `extension/ui/modules/charts/throughput.ts`
- [ ] T036 [US2] Add truncation indicator div with class `.truncation-indicator` to throughput chart in `extension/ui/modules/charts/throughput.ts`
- [ ] T037 [US2] Add `MAX_CYCLE_TIME_POINTS = 104` constant to `extension/ui/modules/charts/cycle-time.ts`
- [ ] T038 [US2] Implement data truncation logic using `.slice(-MAX_CYCLE_TIME_POINTS)` in `extension/ui/modules/charts/cycle-time.ts`
- [ ] T039 [US2] Add truncation indicator div with class `.truncation-indicator` to cycle time chart in `extension/ui/modules/charts/cycle-time.ts`
- [ ] T040 [US2] Add CSS styling for `.truncation-indicator` (light gray, smaller font) in appropriate stylesheet
- [ ] T041 [US2] Update existing chart tests to accommodate new truncation behavior in `extension/tests/modules/charts/throughput.test.ts`
- [ ] T042 [US2] Update existing chart tests to accommodate new truncation behavior in `extension/tests/modules/charts/cycle-time.test.ts`

**Checkpoint**: Charts render 156-week datasets with truncation indicators showing "Showing last 2 years (104 weeks)"

---

## Phase 5: User Story 3 - View Dashboard with 200+ Reviewers (Priority: P2)

**Goal**: Dashboard handles 200 reviewers without layout or performance issues

**Independent Test**: Load dataset with 200 reviewers and verify Reviewer Activity panel renders correctly

**Depends on**: User Story 1 (needs generated test data)

### Tests for User Story 3

- [ ] T043 [P] [US3] Add test for Reviewer Activity panel rendering with 200 users in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T044 [US3] Add performance comparison test (50 vs 200 users) to verify acceptable degradation in `extension/tests/unit/chart-scalability.test.ts`

### Implementation for User Story 3

- [ ] T045 [US3] Verify Reviewer Activity panel in `extension/ui/modules/charts/reviewer-activity.ts` handles 200 users without layout overflow
- [ ] T046 [US3] Add any necessary CSS adjustments for large reviewer counts in Reviewer Activity panel styling
- [ ] T047 [US3] Document reviewer count limits (if any) in code comments in `extension/ui/modules/charts/reviewer-activity.ts`

**Checkpoint**: Dashboard loads with 200 reviewers, Reviewer Activity panel displays correctly

---

## Phase 6: User Story 4 - View Dashboard with Comments Enabled (Priority: P2)

**Goal**: Dashboard loads without errors when `features.comments: true` in manifest

**Independent Test**: Load dataset with comments enabled and verify no runtime errors

**Depends on**: User Story 1 (needs generated test data with comments)

### Tests for User Story 4

- [ ] T048 [P] [US4] Add test for dashboard initialization with `features.comments: true` in `extension/tests/unit/chart-scalability.test.ts`
- [ ] T049 [US4] Add test verifying comment feature flag is correctly read from manifest in `extension/tests/unit/chart-scalability.test.ts`

### Implementation for User Story 4

- [ ] T050 [US4] Verify dashboard loader handles `features.comments: true` without errors in `extension/ui/dataset-loader.ts`
- [ ] T051 [US4] Verify no UI components break when comments feature is enabled in manifest
- [ ] T052 [US4] Add defensive checks for comment-related data paths if needed

**Checkpoint**: Dashboard loads successfully with comments-enabled dataset

---

## Phase 7: User Story 5 - Automated Scalability Regression Testing (Priority: P3)

**Goal**: CI automatically runs scalability tests on every PR

**Independent Test**: Push a PR and verify scalability tests run and pass in CI

**Depends on**: User Stories 1-4 (all tests and implementations)

### Tests for User Story 5

- [ ] T053 [P] [US5] Add npm script `test:scalability` to `extension/package.json` with pattern `jest --testPathPattern=scalability`
- [ ] T054 [US5] Verify scalability tests can be run locally with `pnpm test:scalability` in extension directory

### Implementation for User Story 5

- [ ] T055 [US5] Update `extension/tests/scalability-invariants.test.ts` to change `console.warn` to strict `expect().toBe()` assertions
- [ ] T056 [US5] Add scalability test job to `.github/workflows/test.yml` with Python setup, data generation, and test execution
- [ ] T057 [US5] Add cache configuration for generated scalability test data in `.github/workflows/test.yml`
- [ ] T058 [US5] Verify CI workflow runs scalability tests successfully by triggering a test run
- [ ] T059 [US5] Add documentation comment in workflow explaining scalability test purpose

**Checkpoint**: CI pipeline generates scalability data and runs tests automatically

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup

- [ ] T060 [P] Run full test suite to verify no regressions: `pytest tests/ && cd extension && pnpm test`
- [ ] T061 [P] Run scalability test suite to verify all performance thresholds: `cd extension && pnpm test:scalability`
- [ ] T062 Verify quickstart.md commands work end-to-end in `specs/024-dashboard-scalability/quickstart.md`
- [ ] T063 [P] Update `TODO/DASHBOARD_SCALABILITY.md` to mark completed tasks
- [ ] T064 [P] Verify constitution gates QG-25 through QG-29 are satisfied
- [ ] T065 [P] Verify verification requirements VR-20 through VR-23 pass
- [ ] T066 Final code review and cleanup of any TODO comments

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - start immediately
- **Foundational (Phase 2)**: Depends on Setup
- **User Story 1 (Phase 3)**: Depends on Foundational - **BLOCKS all other user stories**
- **User Stories 2-4 (Phases 4-6)**: All depend on User Story 1 completion (need test data)
- **User Story 5 (Phase 7)**: Depends on User Stories 1-4 (needs tests to exist)
- **Polish (Phase 8)**: Depends on all user stories complete

### User Story Dependencies

```
                    ┌─────────────────┐
                    │  Setup (Phase 1) │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Foundational    │
                    │ (Phase 2)       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ US1: Generator  │  ← BLOCKING
                    │ (Phase 3) P1    │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
┌────────▼────────┐ ┌────────▼────────┐ ┌────────▼────────┐
│ US2: 3yr Data   │ │ US3: 200 Users  │ │ US4: Comments   │
│ (Phase 4) P1    │ │ (Phase 5) P2    │ │ (Phase 6) P2    │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────▼────────┐
                    │ US5: CI Tests   │
                    │ (Phase 7) P3    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Polish (Phase 8) │
                    └─────────────────┘
```

### Parallel Opportunities

**Within Phase 1 (Setup)**:
- T002, T003, T004 can run in parallel

**Within Phase 2 (Foundational)**:
- T006, T007, T008 can run in parallel

**Within Phase 3 (US1 - Generator)**:
- T009, T010, T011, T012, T013 (tests) can run in parallel
- T016, T020 (CLI args) can run in parallel

**After US1 completes (Phases 4-6)**:
- User Stories 2, 3, and 4 can run in parallel on different branches/developers

**Within Phase 4 (US2 - 3yr Data)**:
- T027, T028, T029, T030 (tests) can run in parallel
- T034, T037 (constants) can run in parallel

---

## Parallel Example: User Story 2 (3-Year Data)

```bash
# Launch all tests for User Story 2 in parallel:
Task: T027 [US2] Add render time test for throughput chart
Task: T028 [US2] Add render time test for cycle time chart
Task: T029 [US2] Add DOM element count test for throughput
Task: T030 [US2] Add DOM element count test for cycle time

# Then launch chart implementations in parallel:
Task: T034 [US2] Add MAX_THROUGHPUT_POINTS constant
Task: T037 [US2] Add MAX_CYCLE_TIME_POINTS constant
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (Generator)
4. **STOP and VALIDATE**: Generate scalability dataset and verify output
5. This MVP enables all other testing

### Incremental Delivery

1. Complete Setup + Foundational → Environment ready
2. Add User Story 1 (Generator) → Test data available
3. Add User Story 2 (3yr Data) → Charts handle large datasets
4. Add User Stories 3 & 4 (200 users, comments) → Full scalability
5. Add User Story 5 (CI) → Automated regression prevention

### Parallel Team Strategy

With 2+ developers after US1 completes:
- Developer A: User Story 2 (throughput + cycle time caps)
- Developer B: User Stories 3 + 4 (reviewer panel + comments)
- Then: Both contribute to User Story 5 (CI integration)

---

## Notes

- [P] tasks = different files, no dependencies between them
- [Story] label maps task to specific user story for traceability
- User Story 1 is the critical path - all other stories depend on it
- Tests use `performance.now()` for timing, not external tools
- DOM element assertions use standard `querySelectorAll`
- Truncation indicator text: "Showing last 2 years (104 weeks)"
- Commit after each logical task group
- Run `pnpm test:scalability` to verify all performance thresholds
