# Tasks: CI/pnpm Hardening with Test Isolation

**Input**: Design documents from `/specs/012-ci-pnpm-test-isolation/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, quickstart.md

**Tests**: No automated test tasks requested. Manual verification via CI workflow runs.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **GitHub Actions**: `.github/workflows/`, `.github/actions/`, `.github/scripts/`
- **Extension**: `extension/package.json`, `extension/tests/`
- **Root**: `package.json`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the shared composite action that all workflow migrations depend on

- [x] T001 Create directory structure for composite action at `.github/actions/setup-pnpm/`
- [x] T002 Create shared pnpm setup composite action at `.github/actions/setup-pnpm/action.yml` with inputs for node-version, cache, and cache-dependency-path

---

## Phase 2: Foundational (Test Script Configuration)

**Purpose**: Configure test scripts and directory structure that workflows will reference

**⚠️ CRITICAL**: Test isolation must be in place before workflows can reference test:unit vs test:all

- [x] T003 Create `extension/tests/python-integration/` directory
- [x] T004 [P] Move `extension/tests/synthetic-fixtures.test.ts` to `extension/tests/python-integration/synthetic-fixtures.test.ts`
- [x] T005 [P] Move `extension/tests/performance.test.ts` to `extension/tests/python-integration/performance.test.ts`
- [x] T006 Update test scripts in `extension/package.json`: add test:unit, test:all, remap test to test:unit, update test:watch and test:coverage

**Checkpoint**: Test isolation in place - workflow migrations can now begin

---

## Phase 3: User Story 1 - CI Maintainer Prevents pnpm Setup Drift (Priority: P1) 🎯 MVP

**Goal**: All workflows use the shared composite action for deterministic pnpm setup

**Independent Test**: Run any CI workflow and verify pnpm version in logs is exactly `9.15.0`

### Implementation for User Story 1

- [x] T007 [US1] Update ui-bundle-sync job in `.github/workflows/ci.yml` to use composite action (lines 126-135)
- [x] T008 [P] [US1] Update build-extension job in `.github/workflows/ci.yml` to use composite action (lines 467-476)
- [x] T009 [P] [US1] Update extension-tests job in `.github/workflows/ci.yml` to use composite action (lines 545-554)
- [x] T010 [P] [US1] Update fresh-clone-verify job in `.github/workflows/ci.yml` to use composite action with cache: 'false' (lines 663-670)
- [x] T011 [US1] Verify `packageManager` field exists in root `package.json` (no change needed, document verification)

**Checkpoint**: All 4 target workflows now use composite action. CI should pass with pnpm@9.15.0 in all logs.

---

## Phase 4: User Story 2 - Developer Runs Unit Tests Without Python (Priority: P1)

**Goal**: Default `pnpm test` runs only unit tests without Python dependencies

**Independent Test**: Run `pnpm test:unit` on machine without Python; all tests pass

### Implementation for User Story 2

- [x] T012 [US2] Verify test scripts in `extension/package.json` correctly exclude python-integration directory (validation of T006)
- [x] T013 [US2] Run `pnpm test:unit` locally and verify no Python errors (manual verification, document results)

**Checkpoint**: Developers without Python can run unit tests locally.

---

## Phase 5: User Story 3 - CI Operator Runs Full Integration Tests (Priority: P2)

**Goal**: `extension-tests` job runs full test suite including Python integration tests

**Independent Test**: Run `pnpm test:all` with Python installed; both unit and integration tests execute

### Implementation for User Story 3

- [x] T014 [US3] Ensure extension-tests job in `.github/workflows/ci.yml` continues to run `pnpm run test:ci` (which includes Python tests)
- [x] T015 [US3] Verify extension-tests job still installs Python and runs full test suite (validation step)

**Checkpoint**: Full test coverage maintained in extension-tests job.

---

## Phase 6: User Story 4 - New Developer Understands Test Architecture (Priority: P2)

**Goal**: Clear documentation explains test structure and Python requirements

**Independent Test**: New developer can determine test requirements by reading documentation

### Implementation for User Story 4

- [x] T016 [P] [US4] Create test documentation at `extension/tests/README.md` documenting test suites, Python requirements, and CI jobs
- [x] T017 [P] [US4] Create Python integration test README at `extension/tests/python-integration/README.md` explaining why tests are separated

**Checkpoint**: Test architecture is documented for onboarding.

---

## Phase 7: User Story 5 - CI Maintainer Detects Configuration Regression (Priority: P2)

**Goal**: CI fails when packageManager is removed or inline pnpm setup is added

**Independent Test**: Intentionally break config and verify CI fails with clear error

### Implementation for User Story 5

- [x] T018 [US5] Create regression guard script at `.github/scripts/validate-ci-guards.sh` checking packageManager field and direct pnpm/action-setup usage
- [x] T019 [US5] Add ci-guards job to `.github/workflows/ci.yml` that runs validate-ci-guards.sh

**Checkpoint**: Regression guards prevent configuration drift.

---

## Phase 8: User Story 6 - CI Jobs Have Distinct Responsibilities (Priority: P3)

**Goal**: extension-tests and fresh-clone-verify have clearly separated concerns

**Independent Test**: Examine job definitions and verify distinct dependency surfaces

**Note**: After T020-T021, `fresh-clone-verify` becomes the FR-011 enforcement job (runs `test:unit` without Python installed).

### Implementation for User Story 6

- [x] T020 [US6] Update fresh-clone-verify job in `.github/workflows/ci.yml` to remove Python setup steps (lines 654-661) — satisfies FR-011
- [x] T021 [US6] Update fresh-clone-verify job to run `pnpm test:unit` instead of `pnpm test` (line 683) — satisfies FR-011
- [x] T022 [US6] Verify extension-tests and fresh-clone-verify have distinct responsibilities (validation step)

**Checkpoint**: CI jobs have clear, non-overlapping responsibilities.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and documentation updates

- [x] T023 Run full CI workflow and verify all jobs pass
- [x] T024 Verify `git grep pnpm/action-setup .github/workflows/` returns no results (only composite action references)
- [x] T025 Document implementation in specs/012-ci-pnpm-test-isolation/ (update plan.md verification checklist)
- [x] T026 Run quickstart.md verification steps

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS workflow migrations
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - US1 and US2 can proceed in parallel after Foundational
  - US3, US4, US5, US6 can proceed in parallel after US1
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Phase 1-2 - Foundation for all other stories
- **User Story 2 (P1)**: Depends on Phase 2 (test scripts) - Can run parallel to US1
- **User Story 3 (P2)**: Depends on US1 (composite action in place) - Validates existing behavior
- **User Story 4 (P2)**: No dependencies on other stories - Documentation only
- **User Story 5 (P2)**: Depends on US1 (composite action must exist to guard against direct usage)
- **User Story 6 (P3)**: Depends on US1 (composite action) and US2 (test:unit script exists)

### Within Each User Story

- CI workflow changes should be committed together or in quick succession
- Verify each story independently before moving to next priority

### Parallel Opportunities

- **Phase 2**: T004 and T005 (file moves) can run in parallel
- **Phase 3**: T008, T009, T010 (workflow updates) can run in parallel after T007
- **Phase 6**: T016 and T017 (documentation) can run in parallel

---

## Parallel Example: User Story 1 Workflow Updates

```bash
# After T007 completes, launch remaining workflow updates together:
Task: "Update build-extension job in .github/workflows/ci.yml to use composite action"
Task: "Update extension-tests job in .github/workflows/ci.yml to use composite action"
Task: "Update fresh-clone-verify job in .github/workflows/ci.yml to use composite action"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2)

1. Complete Phase 1: Setup (composite action)
2. Complete Phase 2: Foundational (test scripts + file moves)
3. Complete Phase 3: User Story 1 (workflow migrations)
4. Complete Phase 4: User Story 2 (verify test isolation)
5. **STOP and VALIDATE**: Push to CI, verify all workflows pass with pnpm@9.15.0

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 + 2 → Test in CI → MVP complete!
3. Add User Story 3 + 4 → Documentation and validation
4. Add User Story 5 → Regression guards active
5. Add User Story 6 → Job separation complete
6. Each story adds protection without breaking previous work

### Single Developer Strategy

Recommended order:
1. T001-T006 (Setup + Foundational) - ~30 min
2. T007-T011 (US1) - ~20 min
3. T012-T013 (US2) - ~10 min
4. **Push to CI and validate**
5. T014-T015 (US3) - ~5 min
6. T016-T017 (US4) - ~15 min
7. T018-T019 (US5) - ~15 min
8. T020-T022 (US6) - ~10 min
9. T023-T026 (Polish) - ~15 min

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each phase or logical group
- Stop at any checkpoint to validate story independently
- Most changes are to `.github/workflows/ci.yml` - careful with merge conflicts
