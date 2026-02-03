# Tasks: Dashboard Critical Test Coverage

**Input**: Design documents from `/specs/023-dashboard-coverage/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: This feature IS a testing feature—all tasks involve creating tests. The triple assertion pattern (console.error spy, no throws, fallback DOM) is required for all rendering tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Extension tests**: `extension/tests/`
- **Fixtures**: `extension/tests/fixtures/`
- **Harness**: `extension/tests/harness/`
- **Jest config**: `extension/jest.config.ts`

---

## Phase 1: Setup (Test Infrastructure)

**Purpose**: Extend existing test harnesses and create required fixtures

- [X] T001 Create `extension/tests/dashboard/` directory for dashboard-specific tests
- [X] T002 [P] Create `predictions-ready.json` fixture in `extension/tests/fixtures/` per data-model.md schema
- [X] T003 [P] Create `predictions-no-data.json` fixture in `extension/tests/fixtures/` per data-model.md schema
- [X] T004 [P] Rename `insights-valid.json` to `insights-ready.json` in `extension/tests/fixtures/`
- [X] T005 [P] Create `insights-no-data.json` fixture in `extension/tests/fixtures/` per data-model.md schema
- [X] T006 Add `createErrorAssertionContext()` helper to `extension/tests/harness/dom-harness.ts` for triple assertion pattern
- [X] T007 Add `configureExtensionDataService()` helper to `extension/tests/harness/vss-sdk-mock.ts` for settings mocking

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core test utilities that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Verify all 8 fixture files exist and conform to schemas in data-model.md
- [X] T009 Verify `createErrorAssertionContext()` works with jest.spyOn and DOM assertions
- [X] T010 Verify `mockExtensionDataService()` properly mocks VSS.getService calls

**Checkpoint**: Harness extensions verified - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Dashboard Rendering Stability (Priority: P1) 🎯 MVP

**Goal**: Tests that validate dashboard renders correctly for all ML tab states with triple assertion enforcement

**Independent Test**: Run `pnpm test -- tests/dashboard/ml-state-rendering.test.ts` and verify all 10 state tests pass

### Implementation for User Story 1

- [X] T011 [US1] Create `extension/tests/dashboard/ml-state-rendering.test.ts` with test structure for 5 states × 2 artifact types
- [X] T012 [P] [US1] Add tests for `renderPredictionsForState` with `ready` state in `ml-state-rendering.test.ts`
- [X] T013 [P] [US1] Add tests for `renderPredictionsForState` with `no-data` state in `ml-state-rendering.test.ts`
- [X] T014 [P] [US1] Add tests for `renderPredictionsForState` with `invalid-artifact` state in `ml-state-rendering.test.ts`
- [X] T015 [P] [US1] Add tests for `renderPredictionsForState` with `unsupported-schema` state in `ml-state-rendering.test.ts`
- [X] T016 [P] [US1] Add tests for `renderPredictionsForState` with `setup-required` state in `ml-state-rendering.test.ts`
- [X] T017 [P] [US1] Add tests for `renderInsightsForState` with `ready` state in `ml-state-rendering.test.ts`
- [X] T018 [P] [US1] Add tests for `renderInsightsForState` with `no-data` state in `ml-state-rendering.test.ts`
- [X] T019 [P] [US1] Add tests for `renderInsightsForState` with `invalid-artifact` state in `ml-state-rendering.test.ts`
- [X] T020 [P] [US1] Add tests for `renderInsightsForState` with `unsupported-schema` state in `ml-state-rendering.test.ts`
- [X] T021 [P] [US1] Add tests for `renderInsightsForState` with `setup-required` state in `ml-state-rendering.test.ts`
- [X] T022 [US1] Create `extension/tests/dashboard/settings-contract.test.ts` for settings boundary tests
- [X] T023 [P] [US1] Add tests for `getSourceConfig()` with valid settings in `settings-contract.test.ts`
- [X] T024 [P] [US1] Add tests for `getSourceConfig()` with missing settings in `settings-contract.test.ts`
- [X] T025 [P] [US1] Add tests for `getSourceConfig()` with invalid settings in `settings-contract.test.ts`
- [X] T026 [P] [US1] Add tests for `resolveConfiguration()` with valid config in `settings-contract.test.ts`
- [X] T027 [P] [US1] Add tests for `resolveConfiguration()` with fallback scenarios in `settings-contract.test.ts`
- [X] T028 [US1] Verify Critical Path contract tests pass: (1) `ml-state-rendering.test.ts` covers 5-state × 2-artifact matrix, (2) `settings-contract.test.ts` covers getSourceConfig/resolveConfiguration boundary. Global ratchet enforces non-decreasing coverage; IIFE bundles (dashboard.ts, settings.ts) explicitly excluded from per-file thresholds.

**Checkpoint**: User Story 1 complete - dashboard rendering stability verified with 70%+ coverage

---

## Phase 4: User Story 2 - API Client Resilience (Priority: P2)

**Goal**: Tests that validate artifact client handles all HTTP response scenarios correctly

**Independent Test**: Run `pnpm test -- tests/artifact-client/http-responses.test.ts` and verify all HTTP code tests pass

### Implementation for User Story 2

- [X] T029 [US2] Create `extension/tests/artifact-client/http-responses.test.ts` with test structure for HTTP codes
- [X] T030 [P] [US2] Add tests for `_authenticatedFetch` with 200 success response in `http-responses.test.ts`
- [X] T031 [P] [US2] Add tests for `_authenticatedFetch` with 401 unauthorized response in `http-responses.test.ts`
- [X] T032 [P] [US2] Add tests for `_authenticatedFetch` with 403 forbidden response in `http-responses.test.ts`
- [X] T033 [P] [US2] Add tests for `_authenticatedFetch` with 404 not found response in `http-responses.test.ts`
- [X] T034 [P] [US2] Add tests for `_authenticatedFetch` with 500 server error response in `http-responses.test.ts`
- [X] T035 [P] [US2] Add tests for `_authenticatedFetch` with malformed JSON response in `http-responses.test.ts`
- [X] T036 [US2] Add test documenting missing timeout handling (gap documentation) in `http-responses.test.ts`
- [X] T037 [US2] Verify artifact-client.ts coverage reaches 40%+ via `pnpm test -- --coverage --collectCoverageFrom="ui/artifact-client.ts"` (actual: 65%)

**Checkpoint**: User Story 2 complete - API client resilience verified with 40%+ coverage

---

## Phase 5: User Story 3 - Coverage Regression Prevention (Priority: P3)

**Goal**: Configure Jest thresholds to prevent coverage regression and document threshold update procedure

**Independent Test**: Run `pnpm test -- --coverage` and verify threshold enforcement blocks PRs below limits

### Implementation for User Story 3

- [X] T038 [US3] Add `ui/modules/ml.ts` threshold (75%) to `extension/jest.config.ts` coverageThreshold section (IIFE bundles excluded)
- [X] T039 [P] [US3] Add `ui/artifact-client.ts` threshold (40%) to `extension/jest.config.ts` coverageThreshold section
- [X] T040 [P] [US3] Add `ui/modules/shared/security.ts` threshold (95%) to `extension/jest.config.ts` coverageThreshold section
- [X] T041 [US3] Update `extension/COVERAGE_RATCHET.md` history table with new threshold values and date
- [X] T042 [US3] Verify CI fails when coverage drops below thresholds by temporarily lowering a threshold

**Checkpoint**: User Story 3 complete - coverage thresholds enforce regression prevention

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: XSS prevention tests and final validation

- [ ] T043 [P] Create `extension/tests/security/xss-prevention.test.ts` for security boundary tests
- [ ] T044 [P] Add tests for `escapeHtml()` with all HTML special characters in `xss-prevention.test.ts`
- [ ] T045 [P] Add tests for `safeHtml` template literal with malicious payloads in `xss-prevention.test.ts`
- [ ] T046 [P] Add tests for `sanitizeUrl()` blocking javascript:/data:/vbscript: schemes in `xss-prevention.test.ts`
- [ ] T047 Verify security.ts coverage reaches 95%+ via `pnpm test -- --coverage --collectCoverageFrom="ui/modules/shared/security.ts"`
- [ ] T048 Run full test suite with coverage: `pnpm test -- --coverage` and verify all thresholds pass
- [ ] T049 Update `specs/023-dashboard-coverage/checklists/requirements.md` marking all items complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Can start after Foundational; does not depend on user stories

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1
- **User Story 3 (P3)**: Depends on US1 and US2 completion (needs coverage to enforce thresholds)

### Within Each User Story

- Create test file structure first
- Add individual test cases (can be parallel within same file)
- Verify coverage target met last

### Parallel Opportunities

- All fixture creation tasks (T002-T005) can run in parallel
- All harness extension tasks (T006-T007) can run in parallel
- All ML state tests within US1 (T012-T021) can run in parallel
- All settings tests within US1 (T023-T027) can run in parallel
- All HTTP response tests within US2 (T030-T036) can run in parallel
- All threshold config tasks within US3 (T038-T040) can run in parallel
- All XSS tests in Polish (T044-T046) can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all ML state tests together:
Task: "Add tests for renderPredictionsForState with ready state"
Task: "Add tests for renderPredictionsForState with no-data state"
Task: "Add tests for renderPredictionsForState with invalid-artifact state"
Task: "Add tests for renderPredictionsForState with unsupported-schema state"
Task: "Add tests for renderPredictionsForState with setup-required state"
Task: "Add tests for renderInsightsForState with ready state"
# ... (all 10 state tests can run in parallel)

# Launch all settings tests together:
Task: "Add tests for getSourceConfig() with valid settings"
Task: "Add tests for getSourceConfig() with missing settings"
Task: "Add tests for getSourceConfig() with invalid settings"
Task: "Add tests for resolveConfiguration() with valid config"
Task: "Add tests for resolveConfiguration() with fallback scenarios"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (fixtures + harness)
2. Complete Phase 2: Foundational (verify harness works)
3. Complete Phase 3: User Story 1 (ML state rendering + settings tests)
4. **STOP and VALIDATE**: Run `pnpm test -- --coverage` and verify dashboard.ts at 70%+
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Harness ready
2. Add User Story 1 → Test independently → 70% dashboard coverage (MVP!)
3. Add User Story 2 → Test independently → 40% artifact-client coverage
4. Add User Story 3 → Configure thresholds → CI enforcement active
5. Add Polish → 95% security coverage → Feature complete

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (dashboard + settings tests)
   - Developer B: User Story 2 (artifact client tests)
   - Developer C: Polish (XSS tests)
3. User Story 3 waits for US1 + US2 (needs coverage to enforce)

---

## Notes

- [P] tasks = different files or different sections of same file, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Triple assertion pattern REQUIRED: console.error spy + no throws + fallback DOM check
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Canonical coverage values come from CI (ubuntu-latest + Node 22), not local runs
