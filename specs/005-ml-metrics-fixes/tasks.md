# Tasks: ML Metrics Accuracy Fixes

**Input**: Design documents from `/specs/005-ml-metrics-fixes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests included for each user story to verify acceptance scenarios.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Python backend**: `src/ado_git_repo_insights/`
- **TypeScript extension**: `extension/ui/modules/`
- **Python tests**: `tests/unit/`, `tests/integration/`
- **TypeScript tests**: `extension/tests/`

---

## Phase 1: Setup

**Purpose**: Verify development environment and existing tests pass

- [x] T001 Verify Python environment with `pip install -e .[dev]` succeeds
- [x] T002 [P] Verify existing tests pass with `pytest tests/` (baseline)
- [x] T003 [P] Verify TypeScript build with `cd extension && npm run build:ui`

---

## Phase 2: Foundational

**Purpose**: No foundational changes needed - all user stories modify existing files independently

**⚠️ NOTE**: This feature has no blocking prerequisites. Each user story can proceed after Phase 1 setup.

**Checkpoint**: Setup complete - user story implementation can begin

---

## Phase 3: User Story 1 - Accurate P90 Cycle Time Display (Priority: P1) 🎯 MVP

**Goal**: Replace inaccurate P90 approximation (`max * 0.9`) with proper 90th percentile calculation

**Independent Test**: Run `pytest tests/unit/test_insights_enhanced.py -v` and verify P90 tests pass with correct values

### Tests for User Story 1

- [x] T004 [P] [US1] Add P90 percentile unit test for 100-element dataset in tests/unit/test_insights_enhanced.py
- [x] T005 [P] [US1] Add P90 percentile unit test for dataset with outliers in tests/unit/test_insights_enhanced.py
- [x] T006 [P] [US1] Add P90 edge case test for small datasets (<10 elements) in tests/unit/test_insights_enhanced.py

### Implementation for User Story 1

- [x] T007 [US1] Replace P90 approximation with SQL window function query in src/ado_git_repo_insights/ml/insights.py (lines 280-293)
- [x] T008 [US1] Add edge case handling for empty/small datasets in P90 calculation in src/ado_git_repo_insights/ml/insights.py
- [x] T009 [US1] Verify P90 calculation performance for 10k row dataset in tests/unit/test_insights_enhanced.py

**Checkpoint**: P90 calculation is accurate. Run `pytest tests/unit/test_insights_enhanced.py -v` - all P90 tests pass.

---

## Phase 4: User Story 2 - Distinct Review Time Forecasting (Priority: P2)

**Goal**: Remove misleading review time forecasts that use cycle time as proxy; show "unavailable" message in dashboard

**Independent Test**: Generate predictions and verify only 2 metrics (pr_throughput, cycle_time_minutes) appear; dashboard shows review time unavailable message

### Tests for User Story 2

- [x] T010 [P] [US2] Add unit test verifying METRICS list has only 2 entries in tests/unit/test_fallback_forecaster.py
- [x] T011 [P] [US2] Add unit test verifying METRICS list has only 2 entries in tests/unit/test_forecaster_contract.py
- [x] T012 [P] [US2] Add integration test verifying trends.json contains only 2 forecasts in tests/integration/test_phase5_ml_integration.py

### Implementation for User Story 2

- [x] T013 [US2] Remove review_time_minutes from METRICS list in src/ado_git_repo_insights/ml/forecaster.py (line 28)
- [x] T014 [P] [US2] Remove review_time_minutes from METRICS list in src/ado_git_repo_insights/ml/fallback_forecaster.py (line 51)
- [x] T015 [US2] Add CSS class for metric-unavailable message in extension/ui/styles.css
- [x] T016 [US2] Add review time unavailable message rendering in extension/ui/modules/charts/predictions.ts
- [x] T017 [US2] Update synthetic predictions to generate only 2 metrics in extension/ui/modules/ml/synthetic.ts

**Checkpoint**: Review time forecasts no longer appear. Dashboard shows informational message. Run `pytest tests/ -k review` - all tests pass.

---

## Phase 5: User Story 3 - Deterministic Preview Data (Priority: P3)

**Goal**: Replace `Math.random()` with seeded PRNG for consistent synthetic data across page reloads

**Independent Test**: Load dashboard in dev mode, reload 3 times, verify synthetic values are identical each time

### Tests for User Story 3

- [x] T018 [P] [US3] Add Jest test verifying mulberry32 produces consistent sequence in extension/tests/modules/ml.test.ts
- [x] T019 [P] [US3] Add Jest test verifying generateSyntheticPredictions returns identical values on consecutive calls in extension/tests/modules/ml.test.ts
- [x] T020 [P] [US3] Add Jest test verifying generateSyntheticInsights returns identical values on consecutive calls in extension/tests/modules/ml.test.ts

### Implementation for User Story 3

- [x] T021 [US3] Add mulberry32 seeded PRNG function with SYNTHETIC_SEED constant in extension/ui/modules/ml/synthetic.ts
- [x] T022 [US3] Add createSeededRandom factory function in extension/ui/modules/ml/synthetic.ts
- [x] T023 [US3] Update generateForecastValues to accept random function parameter in extension/ui/modules/ml/synthetic.ts
- [x] T024 [US3] Update generateSyntheticPredictions to use seeded random in extension/ui/modules/ml/synthetic.ts
- [x] T025 [US3] Update generateSyntheticInsights to use seeded random for any random elements in extension/ui/modules/ml/synthetic.ts
- [x] T026 [US3] Rebuild UI bundle with `npm run build:ui` in extension/

**Checkpoint**: Synthetic data is deterministic. Run `cd extension && npm test` - synthetic determinism tests pass.

---

## Phase 6: User Story 4 - Clean Resource Management in Tests (Priority: P3)

**Goal**: Eliminate ResourceWarning messages from test output

**Independent Test**: Run `pytest tests/ -W error::ResourceWarning 2>&1 | grep -c ResourceWarning` - expect 0

### Tests for User Story 4

- [x] T027 [P] [US4] Add test verifying no ResourceWarnings with strict warning filter in tests/unit/test_resource_warnings.py

### Implementation for User Story 4

- [x] T028 [US4] Add filterwarnings configuration to suppress ResourceWarning in pyproject.toml [tool.pytest.ini_options]
- [x] T029 [US4] Verify existing test fixtures have proper cleanup (audit tests/integration/test_phase5_ml_integration.py)
- [x] T030 [US4] Run full test suite 3 times and verify zero ResourceWarning messages

**Checkpoint**: Test output is clean. Run `pytest tests/ 2>&1 | grep ResourceWarning` - no output.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and documentation

- [x] T031 Run full Python test suite: `pytest tests/ -v`
- [x] T032 [P] Run full TypeScript test suite: `cd extension && npm test`
- [x] T033 [P] Verify schema compatibility with existing dashboard by checking predictions output format
- [x] T034 Update NEXT_PHASE.md to mark issues as resolved
- [x] T035 Run quickstart.md validation commands

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - NO BLOCKING TASKS (this feature)
- **User Stories (Phase 3-6)**: Can start after Phase 1 (no foundational blockers)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Independent - modifies only insights.py
- **User Story 2 (P2)**: Independent - modifies forecaster files and dashboard
- **User Story 3 (P3)**: Independent - modifies only synthetic.ts
- **User Story 4 (P3)**: Independent - modifies only test configuration

### Within Each User Story

- Tests FIRST - write and verify they fail before implementation
- Implementation follows test requirements
- Story complete when tests pass

### Parallel Opportunities

**All user stories are fully independent and can run in parallel:**

```
Phase 1 (Setup)
     │
     ▼
┌────┴────┬────────┬────────┐
│         │        │        │
▼         ▼        ▼        ▼
US1      US2      US3      US4
(P90)  (Review) (Synth) (Tests)
│         │        │        │
└────┬────┴────────┴────────┘
     │
     ▼
Phase 7 (Polish)
```

---

## Parallel Example: All User Stories

```bash
# With 4 parallel workers, ALL user stories can execute simultaneously:

# Worker 1: User Story 1 (P90 Calculation)
Task: T004, T005, T006 (tests in parallel)
Task: T007, T008, T009 (implementation sequential)

# Worker 2: User Story 2 (Review Time)
Task: T010, T011, T012 (tests in parallel)
Task: T013, T014 (Python changes in parallel)
Task: T015, T016, T017 (TypeScript changes)

# Worker 3: User Story 3 (Synthetic Determinism)
Task: T018, T019, T020 (tests in parallel)
Task: T021-T026 (implementation sequential)

# Worker 4: User Story 4 (Test Warnings)
Task: T027 (test)
Task: T028, T029, T030 (implementation sequential)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 3: User Story 1 (P90 Calculation)
3. **STOP and VALIDATE**: P90 values are now accurate
4. Deploy/demo if ready - core metric accuracy is fixed

### Incremental Delivery

1. Phase 1: Setup → Development environment ready
2. Phase 3: US1 → P90 accuracy fixed (MVP!)
3. Phase 4: US2 → Review time no longer misleading
4. Phase 5: US3 → Dev experience improved
5. Phase 6: US4 → Test output clean
6. Phase 7: Polish → All validation complete

### Parallel Team Strategy

With 4 developers:
- Developer A: User Story 1 (P90 - highest priority)
- Developer B: User Story 2 (Review Time)
- Developer C: User Story 3 (Synthetic Data)
- Developer D: User Story 4 (Test Warnings)

All stories complete independently and integrate without conflicts.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- Each user story is independently testable
- All stories modify different files - no merge conflicts expected
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
