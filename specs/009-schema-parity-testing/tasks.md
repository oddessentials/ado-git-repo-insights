# Tasks: Schema Parity Testing & Test Coverage

**Input**: Design documents from `/specs/009-schema-parity-testing/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test tasks are included as this feature is test infrastructure focused (schema validation tests, parity tests, coverage improvements).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Extension code**: `extension/ui/`
- **Extension tests**: `extension/tests/`
- **Jest config**: `extension/jest.config.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create directory structure and core types required by all user stories

- [ ] T001 Create schemas directory structure at `extension/ui/schemas/`
- [ ] T002 [P] Create ValidationResult, ValidationError, ValidationWarning types in `extension/ui/schemas/types.ts` per contracts/schema-validator.ts
- [ ] T003 [P] Create SchemaValidationError class in `extension/ui/schemas/errors.ts` with artifactType and errors properties
- [ ] T004 [P] Create test harness directory structure at `extension/tests/harness/`
- [ ] T005 [P] Create extension-artifacts fixture directory at `extension/tests/fixtures/extension-artifacts/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core validation infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Implement base validation utilities (type checking helpers, JSON path builder) in `extension/ui/schemas/utils.ts`
- [ ] T007 Create schema index barrel export in `extension/ui/schemas/index.ts` exporting all types and validators
- [ ] T008 [P] Create DOM harness base structure in `extension/tests/harness/dom-harness.ts` with setupDomHarness() and teardownDomHarness()
- [ ] T009 [P] Create VSS SDK mock allowlist in `extension/tests/harness/vss-sdk-mock.ts` with 6 enumerated functions (init, ready, notifyLoadSucceeded, getWebContext, getService, require)
- [ ] T010 Create harness index barrel export in `extension/tests/harness/index.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Validate Data Consistency Across Modes (Priority: P1) 🎯 MVP

**Goal**: Create schema validators for all 4 JSON artifact types and validate local fixtures against them

**Independent Test**: Run `npm test -- --testPathPattern="schema/"` - all fixture files validate successfully

### Tests for User Story 1

- [ ] T011 [P] [US1] Create manifest schema tests in `extension/tests/schema/manifest.test.ts` covering valid data, missing manifest_schema_version, invalid dates, unknown fields (strict mode fails)
- [ ] T012 [P] [US1] Create rollup schema tests in `extension/tests/schema/rollup.test.ts` covering valid data, missing week, invalid week format, unknown fields (permissive mode warns)
- [ ] T013 [P] [US1] Create dimensions schema tests in `extension/tests/schema/dimensions.test.ts` covering valid data, missing id in arrays, invalid dates, unknown fields (strict mode fails)
- [ ] T014 [P] [US1] Create predictions schema tests in `extension/tests/schema/predictions.test.ts` covering valid data, invalid state enum, absent file handling, unknown fields (permissive mode warns)
- [ ] T015 [P] [US1] Create parity test skeleton in `extension/tests/schema/parity.test.ts` that loads both local and extension-artifacts fixtures

### Implementation for User Story 1

- [ ] T016 [P] [US1] Implement manifest validator in `extension/ui/schemas/manifest.schema.ts` with strict mode (unknown fields = error), validate manifest_schema_version required, ISO date formats
- [ ] T017 [P] [US1] Implement rollup validator in `extension/ui/schemas/rollup.schema.ts` with permissive mode (unknown fields = warning), validate week required, ISO week format
- [ ] T018 [P] [US1] Implement dimensions validator in `extension/ui/schemas/dimensions.schema.ts` with strict mode, validate array items have id + name, ISO date formats
- [ ] T019 [P] [US1] Implement predictions validator in `extension/ui/schemas/predictions.schema.ts` with permissive mode, validate state enum, handle absent file (return valid)
- [ ] T020 [US1] Implement normalize functions for each schema in their respective files (apply ROLLUP_FIELD_DEFAULTS pattern)
- [ ] T021 [US1] Add convenience functions (validateManifest, validateRollup, validateDimensions, validatePredictions) to `extension/ui/schemas/index.ts`
- [ ] T022 [US1] Capture extension-mode artifacts and save to `extension/tests/fixtures/extension-artifacts/` (dataset-manifest.json, dimensions.json, rollup sample, predictions sample)
- [ ] T023 [US1] Complete parity test in `extension/tests/schema/parity.test.ts` - validate both sources, assert normalized shapes match

**Checkpoint**: All schema validators complete, all fixtures pass validation, parity test passes

---

## Phase 4: User Story 2 - Runtime Data Validation in DatasetLoader (Priority: P2)

**Goal**: Integrate schema validation into DatasetLoader with validate-once-and-cache strategy

**Independent Test**: Pass invalid JSON to DatasetLoader and verify it throws SchemaValidationError with specific field information

### Tests for User Story 2

- [ ] T024 [P] [US2] Create DatasetLoader validation tests in `extension/tests/dataset-loader-validation.test.ts` covering: valid data passes, missing required fields throw, invalid types throw, cached data skips validation
- [ ] T025 [P] [US2] Create SchemaValidationError tests in `extension/tests/schema-validation-error.test.ts` verifying error message format includes field path and expected/actual

### Implementation for User Story 2

- [ ] T026 [US2] Extend CacheEntry interface in `extension/ui/dataset-loader.ts` to add `validated: boolean` flag per data-model.md
- [ ] T027 [US2] Integrate validateManifest into loadManifest() in `extension/ui/dataset-loader.ts` with validate-once-and-cache logic
- [ ] T028 [US2] Integrate validateRollup into rollup loading methods in `extension/ui/dataset-loader.ts` with validate-once-and-cache logic
- [ ] T029 [US2] Integrate validateDimensions into loadDimensions() in `extension/ui/dataset-loader.ts` with validate-once-and-cache logic
- [ ] T030 [US2] Integrate validatePredictions into loadPredictions() in `extension/ui/dataset-loader.ts` - handle optional file (absent = valid)
- [ ] T031 [US2] Add warning logging for permissive mode unknown fields (rollup, predictions) in DatasetLoader

**Checkpoint**: DatasetLoader validates all data on first load, caches validation state, throws SchemaValidationError on invalid data

---

## Phase 5: User Story 3 - Comprehensive DOM Test Coverage (Priority: P3)

**Goal**: Create shared test harness and achieve tiered coverage thresholds (80% logic, 50% UI/DOM)

**Independent Test**: Run `npm test -- --coverage` and verify tiered thresholds pass

### Tests for User Story 3

- [ ] T032 [P] [US3] Create DOM harness tests in `extension/tests/harness/dom-harness.test.ts` verifying setupDomHarness creates expected elements, teardownDomHarness cleans up
- [ ] T033 [P] [US3] Create VSS SDK mock tests in `extension/tests/harness/vss-sdk-mock.test.ts` verifying all 6 functions are mocked correctly

### Implementation for User Story 3

- [ ] T034 [US3] Extend dom-harness.ts with fixture loading (setupFixtureMocks) and element helpers (getElement, waitForDom)
- [ ] T035 [US3] Extend vss-sdk-mock.ts with setMockWebContext(), setMockSettingValue() configuration helpers
- [ ] T036 [US3] Add dashboard.ts tests using shared harness in `extension/tests/dashboard-harness.test.ts` - target 50% coverage
- [ ] T037 [US3] Add settings.ts tests using shared harness in `extension/tests/settings-harness.test.ts` - target 50% coverage
- [ ] T038 [US3] Add modules/dom.ts tests in `extension/tests/modules/dom-coverage.test.ts` - target 50% coverage
- [ ] T039 [US3] Add modules/errors.ts tests in `extension/tests/modules/errors-coverage.test.ts` - target 50% coverage
- [ ] T039a [US3] Add modules/comparison.ts tests in `extension/tests/modules/comparison-coverage.test.ts` - target 50% coverage
- [ ] T040 [US3] Configure tiered coverage thresholds in `extension/jest.config.ts` per research.md (80% logic paths, 50% UI/DOM paths); exclude barrel exports (modules/index.ts) from thresholds
- [ ] T041 [US3] Document ratchet-up plan for UI modules in `extension/COVERAGE_RATCHET.md` with current baselines and target dates

**Checkpoint**: Coverage thresholds pass, shared harness enables DOM testing without bespoke mocks

---

## Phase 6: User Story 4 - CI Schema Validation Gate (Priority: P4)

**Goal**: CI blocks merges on schema violations or coverage drops, with skip tagging enforcement

**Independent Test**: Introduce a schema violation in a test branch, verify CI fails; remove violation, verify CI passes

### Tests for User Story 4

- [ ] T042 [P] [US4] Create skip tagging test in `extension/tests/skip-tagging.test.ts` that verifies any skipped test has SKIP_REASON comment (meta-test)

### Implementation for User Story 4

- [ ] T043 [US4] Add schema validation to CI workflow - run schema tests as separate step in `.github/workflows/ci.yml`
- [ ] T044 [US4] Configure coverage enforcement in CI - fail if tiered thresholds not met in `.github/workflows/ci.yml`
- [ ] T045 [US4] Create custom Jest reporter for skip tracking in `extension/tests/reporters/skip-reporter.ts` that outputs all skips with SKIP_REASON
- [ ] T046 [US4] Add skip reporter to jest.config.ts reporters array
- [ ] T047 [US4] Add ESLint rule or pre-commit check for untagged skips in test files

**Checkpoint**: CI enforces schema validation, coverage thresholds, and skip tagging

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, and verification

- [ ] T048 [P] Update quickstart.md with actual file paths after implementation
- [ ] T049 [P] Add inline documentation to schema validators explaining strictness modes
- [ ] T050 Run full test suite and verify all thresholds pass: `npm test -- --coverage`
- [ ] T051 Verify parity test passes with captured extension artifacts
- [ ] T052 Review and remove any untagged test skips or add SKIP_REASON tags
- [ ] T053 Run quickstart.md validation commands and verify all pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational - Schema validators
- **User Story 2 (Phase 4)**: Depends on User Story 1 - Uses validators in DatasetLoader
- **User Story 3 (Phase 5)**: Depends on Foundational - Can run parallel to US1/US2
- **User Story 4 (Phase 6)**: Depends on US1, US2, US3 - CI integrates all features
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

```
                    ┌─────────────────┐
                    │    Setup        │
                    │   (Phase 1)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Foundational   │
                    │   (Phase 2)     │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│   US1 (P1)     │  │   US3 (P3)     │  │                │
│ Schema Valid.  │  │ DOM Coverage   │  │  (parallel)    │
└────────┬───────┘  └────────┬───────┘  └────────────────┘
         │                   │
         ▼                   │
┌────────────────┐           │
│   US2 (P2)     │           │
│ DatasetLoader  │           │
└────────┬───────┘           │
         │                   │
         └─────────┬─────────┘
                   │
          ┌────────▼────────┐
          │    US4 (P4)     │
          │   CI Gates      │
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │     Polish      │
          │   (Phase 7)     │
          └─────────────────┘
```

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Types/interfaces before validators
- Validators before integration
- Core implementation before convenience wrappers

### Parallel Opportunities

**Phase 1 (Setup)**:
- T002, T003, T004, T005 can run in parallel

**Phase 2 (Foundational)**:
- T008, T009 can run in parallel

**Phase 3 (US1 - Schema Validators)**:
- T011, T012, T013, T014, T015 (all tests) can run in parallel
- T016, T017, T018, T019 (all validators) can run in parallel

**Phase 4 (US2 - DatasetLoader)**:
- T024, T025 (tests) can run in parallel

**Phase 5 (US3 - Coverage)**:
- T032, T033 (harness tests) can run in parallel
- T036, T037, T038, T039, T039a (coverage tests) can run in parallel after harness complete

**Phase 6 (US4 - CI)**:
- T042 (test) before implementation

---

## Parallel Example: User Story 1 Schema Validators

```bash
# Launch all schema tests together (Phase 3 tests):
Task: "Create manifest schema tests in extension/tests/schema/manifest.test.ts"
Task: "Create rollup schema tests in extension/tests/schema/rollup.test.ts"
Task: "Create dimensions schema tests in extension/tests/schema/dimensions.test.ts"
Task: "Create predictions schema tests in extension/tests/schema/predictions.test.ts"

# Then launch all validator implementations together:
Task: "Implement manifest validator in extension/ui/schemas/manifest.schema.ts"
Task: "Implement rollup validator in extension/ui/schemas/rollup.schema.ts"
Task: "Implement dimensions validator in extension/ui/schemas/dimensions.schema.ts"
Task: "Implement predictions validator in extension/ui/schemas/predictions.schema.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T005)
2. Complete Phase 2: Foundational (T006-T010)
3. Complete Phase 3: User Story 1 - Schema Validators (T011-T023)
4. **STOP and VALIDATE**: Run `npm test -- --testPathPattern="schema/"` - all tests pass
5. Deploy/demo if ready - schema parity is verified

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → Schema validators work → Fixtures validated (MVP!)
3. Add User Story 2 → DatasetLoader validates at runtime
4. Add User Story 3 → Coverage thresholds enforced
5. Add User Story 4 → CI enforces everything
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Schema Validators)
   - Developer B: User Story 3 (DOM Coverage) - can start parallel
3. After US1 complete:
   - Developer A: User Story 2 (DatasetLoader integration)
   - Developer B: Continue US3
4. After US1, US2, US3 complete:
   - Team: User Story 4 (CI Gates)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
