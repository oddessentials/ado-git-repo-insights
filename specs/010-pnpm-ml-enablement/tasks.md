# Tasks: Enable ML Features & Migrate to pnpm

**Input**: Design documents from `/specs/010-pnpm-ml-enablement/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included per FR-008, FR-014 requirements (schema validation tests, state machine tests)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Extension**: `extension/ui/`, `extension/tests/`
- **CI**: `.github/workflows/`
- **Docs**: `README.md`, root level

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: pnpm migration and shared types - foundational for all user stories

- [x] T001 Delete `extension/package-lock.json` and any npm artifacts
- [x] T002 Add `"packageManager": "pnpm@9.15.0"` field to `extension/package.json`
- [x] T003 Generate `extension/pnpm-lock.yaml` by running `pnpm install`
- [x] T004 [P] Create `.npmrc` at repo root with `engine-strict=true`
- [x] T005 [P] Add ArtifactState discriminated union type to `extension/ui/types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: State machine and schema validation infrastructure - MUST be complete before user story features work

**⚠️ CRITICAL**: ML tab functionality depends on this phase

- [x] T006 Create `extension/ui/modules/ml/state-machine.ts` with `resolveArtifactState()` function implementing 5-state gating per FR-001 through FR-004
- [x] T007 [P] Create `extension/ui/schemas/insights.schema.ts` mirroring predictions.schema.ts pattern
- [x] T008 [P] Add schema_version validation constants (MIN_VERSION=1, MAX_VERSION=1) to `extension/ui/schemas/types.ts`
- [x] T009 [P] Create test fixture `extension/tests/fixtures/predictions-invalid.json` (malformed JSON)
- [x] T010 [P] Create test fixture `extension/tests/fixtures/predictions-unsupported-v.json` (schema_version: 99)
- [x] T011 [P] Create test fixture `extension/tests/fixtures/insights-invalid.json` (malformed JSON)
- [x] T012 [P] Create test fixture `extension/tests/fixtures/insights-unsupported-v.json` (schema_version: 99)
- [x] T013 [P] Create test fixture `extension/tests/fixtures/insights-valid.json` (valid insights with all severity levels)
- [x] T014 Create `extension/tests/modules/ml-state-machine.test.ts` with tests for all 5 states (first-match-wins behavior)
- [x] T015 Add unsupported schema version tests to `extension/tests/schema/predictions.test.ts`
- [x] T016 [P] Create `extension/tests/schema/insights.test.ts` with valid/invalid/unsupported version tests

**Checkpoint**: State machine and schema validation ready - ML tabs can now render correct states

---

## Phase 3: User Story 1 - Developer Enables Predictions Tab (Priority: P1) 🎯 MVP

**Goal**: Make Predictions tab visible and render correct state based on artifact availability

**Independent Test**: Load dashboard without predictions artifact → see `setup-required` state with YAML snippets

### Tests for User Story 1

- [x] T017 [P] [US1] Add test in `extension/tests/modules/ml.test.ts` asserting Predictions tab renders `setup-required` state when artifact missing
- [x] T018 [P] [US1] Add test asserting Predictions tab renders `ready` state with valid artifact
- [x] T019 [P] [US1] Add test asserting Predictions tab renders `invalid-artifact` state with malformed JSON
- [x] T020 [P] [US1] Add test asserting Predictions tab renders `unsupported-schema` state with wrong version
- [x] T021 [P] [US1] Add test asserting predictions series are ordered chronologically by `period_start`

### Implementation for User Story 1

- [x] T022 [US1] Remove `hidden` class from Predictions tab button in `extension/ui/index.html` (line ~161)
- [x] T023 [US1] Update `initializePhase5Features()` in `extension/ui/dashboard.ts` to always show tabs (remove conditional)
- [x] T024 [US1] Update `updateFeatureTabs()` in `extension/ui/dashboard.ts` to use `resolveArtifactState()` for Predictions
- [x] T025 [US1] Implement state-specific UI rendering for Predictions tab in `extension/ui/modules/ml.ts` (5 states → 5 UI variants)
- [x] T026 [US1] Add error banner component for `invalid-artifact` state with file path reference
- [x] T027 [US1] Add error banner component for `unsupported-schema` state with version guidance
- [x] T028 [US1] Ensure predictions series sorting by `period_start` in `extension/ui/modules/charts/predictions.ts`

**Checkpoint**: Predictions tab is visible, shows correct state, renders charts when data available

---

## Phase 4: User Story 2 - Developer Enables AI Insights Tab (Priority: P1)

**Goal**: Make AI Insights tab visible and render correct state with deterministic card ordering

**Independent Test**: Load dashboard with valid insights artifact → see severity-ordered cards

### Tests for User Story 2

- [x] T029 [P] [US2] Add test in `extension/tests/modules/ml.test.ts` asserting AI Insights tab renders `setup-required` state when artifact missing
- [x] T030 [P] [US2] Add test asserting AI Insights tab renders `ready` state with valid artifact
- [x] T031 [P] [US2] Add test asserting insight cards are ordered: severity DESC → category ASC → id ASC
- [x] T032 [P] [US2] Add test asserting `no-data` state when insights array is empty
- [x] T033 [P] [US2] Add test asserting stale data warning when using last-known-good data

### Implementation for User Story 2

- [x] T034 [US2] Remove `hidden` class from AI Insights tab button in `extension/ui/index.html` (line ~162)
- [x] T035 [US2] Update `updateFeatureTabs()` in `extension/ui/dashboard.ts` to use `resolveArtifactState()` for Insights
- [x] T036 [US2] Implement state-specific UI rendering for AI Insights tab in `extension/ui/modules/ml.ts`
- [x] T037 [US2] Implement deterministic ordering function: `sortInsights(insights)` with severity DESC → category ASC → id ASC
- [x] T038 [US2] Add stale data warning banner component for last-known-good rendering
- [x] T039 [US2] Ensure insight cards use sorted order before rendering in `extension/ui/modules/ml.ts`

**Checkpoint**: AI Insights tab is visible, shows correct state, cards render in deterministic order

---

## Phase 5: User Story 3 - Developer Uses pnpm for Package Management (Priority: P2)

**Goal**: CI enforces pnpm-only policy with Corepack

**Independent Test**: CI run fails when `package-lock.json` exists or `npm install` is used

### Tests for User Story 3

- [x] T040 [P] [US3] Create CI guard test script `scripts/check-no-npm-lockfile.sh` that fails if `package-lock.json` exists (implemented as CI guard job)
- [x] T041 [P] [US3] Document pnpm enforcement in `extension/README.md` or root `README.md`

### Implementation for User Story 3

- [x] T042 [US3] Update `.github/workflows/ci.yml`: Replace `npm ci` with `pnpm install --frozen-lockfile` in `ui-bundle-sync` job
- [x] T043 [US3] Update `.github/workflows/ci.yml`: Add `pnpm/action-setup@v4` before `actions/setup-node@v4` in extension jobs
- [x] T044 [US3] Update `.github/workflows/ci.yml`: Replace `npm ci` with `pnpm install --frozen-lockfile` in `build-extension` job
- [x] T045 [US3] Update `.github/workflows/ci.yml`: Replace `npm ci` with `pnpm install --frozen-lockfile` in `extension-tests` job
- [x] T046 [US3] Update `.github/workflows/ci.yml`: Add guard job `pnpm-lockfile-guard` that fails if `package-lock.json` exists
- [x] T047 [US3] Update `.github/workflows/ci.yml`: Add `corepack enable` step before pnpm operations
- [x] T048 [US3] Update `.github/workflows/release.yml`: Replace all `npm` commands with `pnpm` equivalents
- [x] T049 [US3] Add fresh-clone verification job to `.github/workflows/ci.yml` per FR-034 (no cache, frozen-lockfile, build, test)
- [x] T050 [US3] Update all `npm run` references in `extension/package.json` scripts to use pnpm-compatible commands

**Checkpoint**: CI enforces pnpm-only, fresh-clone job proves determinism

---

## Phase 6: User Story 4 - User Reads Documentation for ML Features (Priority: P2)

**Goal**: Clear documentation for enabling ML features and troubleshooting all 5 error states

**Independent Test**: Follow README instructions to enable Predictions feature without external help

### Implementation for User Story 4

- [x] T051 [P] [US4] Add "ML Features" section to `README.md` with Predictions enablement YAML snippet
- [x] T052 [P] [US4] Add AI Insights enablement instructions with OpenAI API key setup to `README.md`
- [x] T053 [P] [US4] Add pnpm installation instructions with Corepack enablement to `README.md`
- [x] T054 [US4] Add "Troubleshooting ML Features" section covering all 5 error states per FR-018
- [x] T055 [US4] Document OpenAI data boundaries: what is sent (aggregated metrics) vs never sent (PR content, user identities) per FR-023
- [x] T056 [US4] Add "Developer Setup" section explaining pnpm migration from npm

**Checkpoint**: Documentation enables self-service ML feature enablement

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Integration tests, cleanup, and final validation

- [x] T057 [P] Add integration test in `extension/tests/integration/` verifying dashboard consumes `predictions/trends.json` at exact path per FR-036
- [x] T058 [P] Add integration test verifying dashboard consumes `ai_insights/summary.json` at exact path per FR-037
- [x] T059 Remove any remaining "Coming Soon" text from ML tab placeholders in `extension/ui/index.html`
- [x] T060 Run `pnpm test` and ensure all tests pass with zero console errors in setup-required state
- [x] T061 Validate quickstart.md instructions work for fresh clone with pnpm (documented in README.md Developer Setup)
- [x] T062 Final review: Verify no npm artifacts remain in repository
- [x] T063 Final review: Verify CI fresh-clone job passes (job added to ci.yml)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - BLOCKS all user stories
- **Phase 3-6 (User Stories)**: All depend on Phase 2 completion
- **Phase 7 (Polish)**: Depends on all user stories

### User Story Dependencies

| Story | Can Start After | Dependencies on Other Stories |
|-------|-----------------|-------------------------------|
| US1 (Predictions) | Phase 2 | None - independently testable |
| US2 (AI Insights) | Phase 2 | None - independently testable |
| US3 (pnpm CI) | Phase 1 | None - independently testable |
| US4 (Documentation) | Phase 3, 4, 5 | Needs features to document |

### Within Each User Story

1. Tests FIRST (write and verify they fail)
2. HTML changes (visibility)
3. Dashboard integration (state machine calls)
4. UI rendering (state-specific components)
5. Verify tests pass

### Parallel Opportunities

**Phase 1**:
- T004 and T005 can run in parallel

**Phase 2**:
- T007, T008 can run in parallel
- T009, T010, T011, T012, T013 can ALL run in parallel (different fixture files)
- T015, T016 can run in parallel (different test files)

**Phase 3 (US1) Tests**:
- T017, T018, T019, T020, T021 can ALL run in parallel

**Phase 4 (US2) Tests**:
- T029, T030, T031, T032, T033 can ALL run in parallel

**Phase 5 (US3)**:
- T040, T041 can run in parallel

**Phase 7 (Polish)**:
- T057, T058 can run in parallel

---

## Parallel Example: Phase 2 Fixtures

```bash
# Launch all fixture creation tasks together:
Task: "Create test fixture extension/tests/fixtures/predictions-invalid.json"
Task: "Create test fixture extension/tests/fixtures/predictions-unsupported-v.json"
Task: "Create test fixture extension/tests/fixtures/insights-invalid.json"
Task: "Create test fixture extension/tests/fixtures/insights-unsupported-v.json"
Task: "Create test fixture extension/tests/fixtures/insights-valid.json"
```

## Parallel Example: User Story 1 Tests

```bash
# Launch all US1 tests together:
Task: "Add test asserting Predictions tab renders setup-required state"
Task: "Add test asserting Predictions tab renders ready state"
Task: "Add test asserting Predictions tab renders invalid-artifact state"
Task: "Add test asserting Predictions tab renders unsupported-schema state"
Task: "Add test asserting predictions series are ordered chronologically"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (pnpm lockfile, types)
2. Complete Phase 2: Foundational (state machine, fixtures)
3. Complete Phase 3: User Story 1 (Predictions tab visible)
4. **STOP and VALIDATE**: Test Predictions tab independently
5. Demo: "Predictions tab now visible with proper error states"

### Incremental Delivery

| Increment | Delivers | User Value |
|-----------|----------|------------|
| Setup + Foundational | pnpm migration, state machine | Developer experience |
| + US1 | Predictions tab | Users see forecasts |
| + US2 | AI Insights tab | Users see AI analysis |
| + US3 | CI enforcement | Build reliability |
| + US4 | Documentation | Self-service enablement |

### Parallel Team Strategy

With 2+ developers:

1. **Together**: Phase 1 + Phase 2 (shared infrastructure)
2. **Split**:
   - Developer A: US1 (Predictions) + US2 (Insights)
   - Developer B: US3 (pnpm CI) + US4 (Documentation)
3. **Together**: Phase 7 (Polish)

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Tests included per FR-008 (ordering assertions), FR-014 (schema version fixtures)
- State machine implements first-match-wins per FR-003 (absolute precedence)
- CI is the authority for pnpm enforcement per FR-029 through FR-032
- Stop at any checkpoint to validate story independently
