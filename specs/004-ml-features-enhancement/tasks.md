# Tasks: ML Features Enhancement

**Input**: Design documents from `/specs/004-ml-features-enhancement/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included per NFR-005 (80%+ test coverage requirement)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `src/ado_git_repo_insights/`
- **Frontend**: `extension/ui/`
- **Tests**: `tests/unit/`, `tests/integration/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and TypeScript types for enhanced schemas

- [x] T001 [P] Extend InsightItem TypeScript interface with v2 fields (data, recommendation) in extension/ui/types.ts
- [x] T002 [P] Add InsightData and Recommendation TypeScript interfaces in extension/ui/types.ts
- [x] T003 [P] Add data_quality field to PredictionsRenderData interface in extension/ui/types.ts
- [x] T004 [P] Add forecaster field to PredictionsRenderData interface in extension/ui/types.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create FallbackForecaster base class with identical interface to ProphetForecaster in src/ado_git_repo_insights/ml/fallback_forecaster.py
- [x] T006 Implement data quality assessment function (insufficient/low_confidence/normal) in src/ado_git_repo_insights/ml/fallback_forecaster.py
- [x] T007 Implement outlier clipping (3 standard deviations) in src/ado_git_repo_insights/ml/fallback_forecaster.py
- [x] T008 Add get_forecaster() factory function for auto-detection in src/ado_git_repo_insights/ml/__init__.py
- [x] T009 Export FallbackForecaster from ml package in src/ado_git_repo_insights/ml/__init__.py

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Zero-Config Predictions (Priority: P1) 🎯 MVP

**Goal**: Predictions work immediately with fallback linear regression when Prophet is unavailable

**Independent Test**: Enable `enablePredictions: true` without Prophet installed → forecast charts render with "Linear Forecast" indicator

### Tests for User Story 1

- [x] T010 [P] [US1] Unit test for linear regression forecasting in tests/unit/test_fallback_forecaster.py
- [x] T011 [P] [US1] Unit test for confidence band calculation in tests/unit/test_fallback_forecaster.py
- [x] T012 [P] [US1] Unit test for data quality assessment (4+ weeks check) in tests/unit/test_fallback_forecaster.py
- [x] T013 [P] [US1] Unit test for outlier clipping logic in tests/unit/test_fallback_forecaster.py
- [x] T014 [P] [US1] Integration test for fallback forecaster end-to-end in tests/integration/test_phase5_ml_integration.py
- [x] T015 [P] [US1] Integration test for Prophet auto-detection in tests/integration/test_phase5_ml_integration.py

### Implementation for User Story 1

- [x] T016 [US1] Implement NumPy-based linear regression forecast in src/ado_git_repo_insights/ml/fallback_forecaster.py
- [x] T017 [US1] Implement confidence band calculation using residual standard error in src/ado_git_repo_insights/ml/fallback_forecaster.py
- [x] T018 [US1] Implement generate() method with identical output schema to ProphetForecaster in src/ado_git_repo_insights/ml/fallback_forecaster.py
- [x] T019 [US1] Add forecaster field ("linear" or "prophet") to trends.json output in src/ado_git_repo_insights/ml/fallback_forecaster.py
- [x] T020 [US1] Modify aggregators.py to use get_forecaster() factory for auto-detection in src/ado_git_repo_insights/transform/aggregators.py
- [x] T021 [P] [US1] Create forecast chart module structure in extension/ui/modules/charts/predictions.ts
- [x] T022 [US1] Implement SVG line chart with historical data (solid line) in extension/ui/modules/charts/predictions.ts
- [x] T023 [US1] Implement forecast data rendering (dashed line) in extension/ui/modules/charts/predictions.ts
- [x] T024 [US1] Implement confidence band fill between datasets in extension/ui/modules/charts/predictions.ts
- [x] T025 [US1] Add forecaster type indicator ("Linear Forecast" / "Prophet Forecast") in extension/ui/modules/charts/predictions.ts
- [x] T026 [US1] Add data quality warning banner for low_confidence state in extension/ui/modules/charts/predictions.ts
- [x] T027 [US1] Integrate chart rendering into ml.ts renderPredictions() in extension/ui/modules/ml.ts
- [x] T028 [US1] Add CSS styles for forecast charts and confidence bands in extension/ui/styles.css

**Checkpoint**: User Story 1 complete - zero-config predictions work with fallback forecaster

---

## Phase 4: User Story 2 - Actionable AI Insights (Priority: P2)

**Goal**: Enhanced insight cards with metrics, sparklines, and actionable recommendations

**Independent Test**: Enable `enableInsights: true` with OpenAI API key → 3 insight cards with recommendations display correctly

### Tests for User Story 2

- [x] T029 [P] [US2] Unit test for deterministic insight ordering (severity→category→ID) in tests/unit/test_insights_enhanced.py
- [x] T030 [P] [US2] Unit test for enhanced schema validation (v2 fields) in tests/unit/test_insights_enhanced.py
- [x] T031 [P] [US2] Unit test for cache file creation and TTL logic in tests/unit/test_insights_enhanced.py
- [x] T032 [P] [US2] Contract test for insights-schema-v2.json in tests/unit/test_insights_enhanced.py

### Implementation for User Story 2

- [x] T033 [US2] Implement SEVERITY_ORDER constant and sort_insights() function in src/ado_git_repo_insights/ml/insights.py
- [x] T034 [US2] Update LLM prompt to request v2 schema (data, recommendation fields) in src/ado_git_repo_insights/ml/insights.py
- [x] T035 [US2] Apply deterministic sorting after LLM response parsing in src/ado_git_repo_insights/ml/insights.py
- [x] T036 [US2] Update cache file to use insights/cache.json path per FR-006 in src/ado_git_repo_insights/ml/insights.py
- [x] T037 [US2] Change cache TTL from 24h to 12h per spec clarification in src/ado_git_repo_insights/ml/insights.py
- [x] T038 [P] [US2] Create sparkline rendering utility in extension/ui/modules/ml.ts
- [x] T039 [US2] Implement rich insight card layout with severity icon in extension/ui/modules/ml.ts
- [x] T040 [US2] Add inline sparkline visualization in insight cards in extension/ui/modules/ml.ts
- [x] T041 [US2] Add recommendation section with priority/effort badges in extension/ui/modules/ml.ts
- [x] T042 [US2] Add affected entities display with member counts in extension/ui/modules/ml.ts
- [x] T043 [US2] Add CSS styles for enhanced insight cards in extension/ui/styles.css

**Checkpoint**: User Story 2 complete - AI insights display with recommendations and sparklines

---

## Phase 5: User Story 3 - Dev Mode Preview (Priority: P3)

**Goal**: Synthetic preview data in dev mode with production lock enforcement

**Independent Test**: Open localhost?devMode=true → synthetic data displays with "PREVIEW - Demo Data" banner; production extension NEVER shows synthetic data

### Tests for User Story 3

- [x] T044 [P] [US3] Unit test for isProductionEnvironment() detection in tests/unit/test_dev_mode.py
- [x] T045 [P] [US3] Unit test for canShowSyntheticData() logic in tests/unit/test_dev_mode.py
- [x] T046 [P] [US3] Integration test asserting synthetic data rejected in production mode in tests/integration/test_production_lock.py

### Implementation for User Story 3

- [x] T047 [P] [US3] Create dev mode detection module in extension/ui/modules/ml/dev-mode.ts
- [x] T048 [US3] Implement isProductionEnvironment() with hostname and SDK checks in extension/ui/modules/ml/dev-mode.ts
- [x] T049 [US3] Implement canShowSyntheticData() combining environment and devMode param in extension/ui/modules/ml/dev-mode.ts
- [x] T050 [P] [US3] Create synthetic data generator module in extension/ui/modules/ml/synthetic.ts
- [x] T051 [US3] Implement generateSyntheticPredictions() with realistic forecast data in extension/ui/modules/ml/synthetic.ts
- [x] T052 [US3] Implement generateSyntheticInsights() with 3 sample insights in extension/ui/modules/ml/synthetic.ts
- [x] T053 [US3] Mark synthetic data with is_stub: true and generated_by: "synthetic-preview" in extension/ui/modules/ml/synthetic.ts
- [x] T054 [US3] Integrate synthetic fallback into renderPredictions() when data unavailable in extension/ui/modules/ml.ts
- [x] T055 [US3] Integrate synthetic fallback into renderAIInsights() when data unavailable in extension/ui/modules/ml.ts
- [x] T056 [US3] Add prominent "PREVIEW - Demo Data" banner for synthetic mode in extension/ui/modules/ml.ts
- [x] T057 [US3] Add CSS styles for preview banner in extension/ui/styles.css

**Checkpoint**: User Story 3 complete - dev mode preview works, production lock enforced

---

## Phase 6: User Story 4 - In-Dashboard Setup Guidance (Priority: P4)

**Goal**: Embedded setup instructions with copyable YAML snippets when features not enabled

**Independent Test**: View Predictions/Insights tabs when not enabled → clear setup instructions with Copy button

### Tests for User Story 4

- [x] T058 [P] [US4] Unit test for YAML snippet generation in tests/unit/test_setup_guides.py
- [x] T059 [P] [US4] Unit test for clipboard copy functionality in tests/unit/test_setup_guides.py

### Implementation for User Story 4

- [x] T060 [P] [US4] Create setup guides module in extension/ui/modules/ml/setup-guides.ts
- [x] T061 [US4] Implement predictions setup guide with YAML snippet in extension/ui/modules/ml/setup-guides.ts
- [x] T062 [US4] Implement insights setup guide with step-by-step instructions in extension/ui/modules/ml/setup-guides.ts
- [x] T063 [US4] Implement clipboard copy with visual confirmation feedback in extension/ui/modules/ml/setup-guides.ts
- [x] T064 [US4] Add cost estimate display (~$0.001-0.01 per run) in insights guide in extension/ui/modules/ml/setup-guides.ts
- [x] T065 [US4] Integrate setup guides into empty state for Predictions tab in extension/ui/modules/ml.ts
- [x] T066 [US4] Integrate setup guides into empty state for Insights tab in extension/ui/modules/ml.ts
- [x] T067 [US4] Add CSS styles for setup guide components in extension/ui/styles.css

**Checkpoint**: User Story 4 complete - setup guidance embedded in dashboard

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T068 [P] Update docs/internal/enable-ml-features.md with fallback forecaster documentation
- [x] T069 [P] Add ML section to CLI reference documentation
- [x] T070 Run quickstart.md validation scenarios
- [x] T071 [P] Verify WCAG 2.1 AA accessibility for new chart components
- [x] T072 [P] Verify WCAG 2.1 AA accessibility for insight cards
- [x] T073 Performance benchmark: verify chart render <100ms for 12 weeks data
- [x] T074 Run full test suite and verify 80%+ coverage for new modules
- [x] T075 Final code review and cleanup

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - Can proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3 → P4)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 2 - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Phase 2 - No dependencies on other stories
- **User Story 3 (P3)**: Can start after Phase 2 - Uses components from US1/US2 but independently testable
- **User Story 4 (P4)**: Can start after Phase 2 - Integrates with empty states from US1/US2

### Within Each User Story

- Tests written FIRST, ensure they FAIL before implementation
- Backend before frontend (for Python+TypeScript tasks)
- Core logic before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks (T001-T004) can run in parallel
- Within each user story: tests marked [P] can run in parallel
- User stories can be worked on in parallel by different developers after Phase 2

---

## Parallel Example: User Story 1

```bash
# Launch all tests for US1 in parallel:
Task: "Unit test for linear regression forecasting"
Task: "Unit test for confidence band calculation"
Task: "Unit test for data quality assessment"
Task: "Unit test for outlier clipping logic"
Task: "Integration test for fallback forecaster"
Task: "Integration test for Prophet auto-detection"

# Launch TypeScript type setup in parallel with Python implementation:
Task: "Create forecast chart module structure in extension/ui/modules/charts/predictions.ts"
```

---

## Parallel Example: Multi-Agent Strategy

```bash
# Agent A (Python Backend):
Phase 2: T005-T009 (Foundational)
US1: T016-T020 (Fallback forecaster implementation)
US2: T033-T037 (Enhanced insights backend)

# Agent B (TypeScript Frontend):
Phase 1: T001-T004 (Type definitions)
US1: T021-T028 (Chart rendering)
US2: T038-T043 (Rich insight cards)
US3: T047-T057 (Dev mode + synthetic)
US4: T060-T067 (Setup guides)

# Agent C (Tests):
US1: T010-T015 (Forecaster tests)
US2: T029-T032 (Insights tests)
US3: T044-T046 (Production lock tests)
US4: T058-T059 (Setup guide tests)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T009)
3. Complete Phase 3: User Story 1 (T010-T028)
4. **STOP and VALIDATE**: Test zero-config predictions independently
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → Test → Deploy (MVP - predictions work!)
3. Add User Story 2 → Test → Deploy (AI insights enhanced)
4. Add User Story 3 → Test → Deploy (Dev mode preview)
5. Add User Story 4 → Test → Deploy (Setup guidance)
6. Polish → Final release

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Tests use NFR-005 80% coverage requirement
- No new npm dependencies per NFR-003
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
