# Tasks: Deterministic Smoke Tests

**Input**: Design documents from `/specs/022-deterministic-smoke-tests/`
**Prerequisites**: plan.md, spec.md, research.md, contracts/test-contracts.md

**Tests**: Meta-tests are required per spec (FR-017, FR-020, FR-021). These are CI enforcement tests, not unit tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This feature modifies the TypeScript extension test infrastructure:
- `extension/tests/smoke/` - Playwright smoke tests
- `extension/tests/modules/` - Jest unit tests
- `extension/tests/types/` - TypeScript type tests
- `extension/tests/meta/` - CI enforcement meta-tests

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create foundational constants and shared utilities needed by all user stories

- [x] T001 Create timeout constants file at `extension/tests/smoke/constants.ts` with `SMOKE_TIMEOUT_MS = 15_000`
- [x] T002 [P] Verify Node.js 22 is documented in `extension/TOOLING.md` (required for `structuredClone`)

---

## Phase 2: Foundational (Meta-Test Infrastructure)

**Purpose**: Create meta-tests that enforce spec requirements. These tests MUST exist before implementation changes so they can verify correctness.

**⚠️ CRITICAL**: Meta-tests should initially FAIL if run against current codebase (proving they detect violations)

- [x] T003 [P] Create `extension/tests/meta/smoke-determinism-guard.test.ts` with tests for WPC-001 (no waitForTimeout), WPC-002 (no networkidle), TC-002 (no timeout literals), AC-001 (testInfo.outputPath required), CQ-001 (no custom deepClone)
- [x] T004 [P] Create `extension/tests/meta/playwright-version-guard.test.ts` with test for DC-001 (exact version pin)
- [x] T005 [P] Create `extension/tests/meta/no-runtime-type-imports.test.ts` with test for CQ-003 (no ui/ imports from tests/types/)
- [x] T006 [P] Create `extension/tests/meta/type-test-header-guard.test.ts` with test for CQ-002 (COMPILE-TIME ONLY header)

**Checkpoint**: Meta-tests created. Running `pnpm test:unit` should show meta-test failures (expected - violations exist in current code)

---

## Phase 3: User Story 1 — Flaky Wait Elimination (Priority: P1) 🎯 MVP

**Goal**: Remove all `waitForTimeout()` usage from smoke tests and replace with condition-based waits

**Independent Test**: Run `grep -r "waitForTimeout" extension/tests/smoke/` → zero matches

### Implementation for User Story 1

- [x] T007 [US1] Refactor `extension/tests/smoke/negative-fixture.smoke.ts` line 31: Replace `waitForTimeout(1000)` with condition-based wait using `expect(errorSetup.or(errorGeneric)).toBeVisible({ timeout: SMOKE_TIMEOUT_MS })`
- [x] T008 [US1] Refactor `extension/tests/smoke/negative-fixture.smoke.ts` line 77: Replace `waitForTimeout(1000)` with condition-based wait using `expect(errorSetup.or(errorGeneric)).toBeVisible({ timeout: SMOKE_TIMEOUT_MS })`
- [x] T009 [US1] Import `SMOKE_TIMEOUT_MS` from `./constants` in `extension/tests/smoke/negative-fixture.smoke.ts`
- [x] T010 [US1] Verify: Run `grep -r "waitForTimeout" extension/tests/smoke/` returns zero matches (SC-001)

**Checkpoint**: User Story 1 complete. `grep -r "waitForTimeout" extension/tests/smoke/` returns zero matches.

---

## Phase 4: User Story 2 — Explicit DOM-State Waits (Priority: P1)

**Goal**: Replace all `networkidle` waits with explicit DOM state change detection

**Independent Test**: Run `grep -r "networkidle" extension/tests/smoke/` → zero matches

### Implementation for User Story 2

- [x] T011 [US2] Refactor `extension/tests/smoke/filter-display.smoke.ts` line 148: Replace `networkidle` with prior-text capture + change detection pattern for repository filter
- [x] T012 [US2] Refactor `extension/tests/smoke/filter-display.smoke.ts` line 240: Replace `networkidle` with prior-text capture + change detection pattern for team filter
- [x] T013 [US2] Refactor `extension/tests/smoke/negative-fixture.smoke.ts` line 28: Replace `networkidle` with explicit error panel visibility wait
- [x] T014 [US2] Refactor `extension/tests/smoke/negative-fixture.smoke.ts` line 76: Replace `networkidle` with explicit error panel visibility wait
- [x] T015 [US2] Import `SMOKE_TIMEOUT_MS` from `./constants` in `extension/tests/smoke/filter-display.smoke.ts`
- [x] T016 [US2] Replace timeout literals (`{ timeout: 15000 }`) with `{ timeout: SMOKE_TIMEOUT_MS }` in `extension/tests/smoke/filter-display.smoke.ts` lines 116, 186
- [x] T017 [US2] Verify: Run `grep -r "networkidle" extension/tests/smoke/` returns zero matches (SC-002)

**Checkpoint**: User Story 2 complete. `grep -r "networkidle" extension/tests/smoke/` returns zero matches.

---

## Phase 5: User Story 3 — Collision-Proof Artifact Paths (Priority: P2)

**Goal**: Migrate all hardcoded screenshot paths to `testInfo.outputPath()`

**Independent Test**: Run `grep -r "path:.*test-artifacts" extension/tests/smoke/` → zero matches for hardcoded paths

### Implementation for User Story 3

- [x] T018 [US3] Refactor `extension/tests/smoke/filter-display.smoke.ts` line 154-156: Replace hardcoded path with `testInfo.outputPath("repository-filter.png")`
- [x] T019 [US3] Refactor `extension/tests/smoke/filter-display.smoke.ts` line 216-218: Replace hardcoded path with `testInfo.outputPath("team-filter-disabled.png")`
- [x] T020 [US3] Refactor `extension/tests/smoke/filter-display.smoke.ts` line 246-248: Replace hardcoded path with `testInfo.outputPath("team-filter.png")`
- [x] T021 [US3] Refactor `extension/tests/smoke/filter-display.smoke.ts` line 263-265: Replace hardcoded path with `testInfo.outputPath("team-filter-default.png")`
- [x] T022 [US3] Add `testInfo` parameter to test functions in `extension/tests/smoke/filter-display.smoke.ts` that need it
- [x] T023 [US3] Verify: All `page.screenshot()` calls use `testInfo.outputPath()` (SC-003)

**Checkpoint**: User Story 3 complete. All screenshots use `testInfo.outputPath()`.

---

## Phase 6: User Story 4 — Playwright Version Policy (Priority: P2)

**Goal**: Document and enforce Playwright version pinning policy

**Independent Test**: CI meta-test fails on caret/tilde versions; TOOLING.md documents policy

### Implementation for User Story 4

- [x] T024 [US4] Add "Playwright Version Policy" section to `extension/TOOLING.md` with quarterly upgrade cadence and PR checklist
- [x] T025 [US4] Verify `extension/package.json` has exactly pinned `@playwright/test` version (no `^` or `~`) - current: `"1.40.0"` is correct
- [x] T026 [US4] Verify: Meta-test `playwright-version-guard.test.ts` passes with current package.json (DC-001)

**Checkpoint**: User Story 4 complete. TOOLING.md documents policy; meta-test enforces pinning.

---

## Phase 7: User Story 5 — Standardized Deep Cloning (Priority: P3)

**Goal**: Replace custom `deepClone` function with native `structuredClone()`

**Independent Test**: Run `grep -r "function deepClone" extension/tests/` → zero matches

### Implementation for User Story 5

- [x] T027 [US5] Remove custom `deepClone` function definition from `extension/tests/modules/metrics.edge-cases.test.ts` lines 232-244
- [x] T028 [US5] Replace all `deepClone()` calls with `structuredClone()` in `extension/tests/modules/metrics.edge-cases.test.ts` (lines 266, 277)
- [x] T029 [US5] Update test comment documentation in `extension/tests/modules/metrics.edge-cases.test.ts` to reference `structuredClone`
- [x] T030 [US5] Verify: Run `grep -r "function deepClone" extension/tests/` returns zero matches (SC-006)
- [x] T031 [US5] Verify: Edge case tests still pass with `structuredClone` (NaN, Infinity, -Infinity preserved)

**Checkpoint**: User Story 5 complete. `structuredClone` used everywhere; no custom deepClone.

---

## Phase 8: User Story 6 — Type Test Compile-Time Contract (Priority: P3)

**Goal**: Add COMPILE-TIME ONLY header to type-test files and enforce no runtime imports

**Independent Test**: Type-test files have header comment; meta-test passes

### Implementation for User Story 6

- [x] T032 [US6] Add "COMPILE-TIME ONLY" header comment to `extension/tests/types/rollup.type-test.ts` as first line of JSDoc
- [x] T033 [US6] Verify: Meta-test `type-test-header-guard.test.ts` passes (CQ-002)
- [x] T034 [US6] Verify: Meta-test `no-runtime-type-imports.test.ts` passes - no imports from `tests/types/` in `ui/` (CQ-003, SC-008)

**Checkpoint**: User Story 6 complete. Type-test files clearly marked; CI enforces isolation.

---

## Phase 9: User Story 7 — Gate Chain Validation (Priority: P1)

**Goal**: Prove full gate chain passes deterministically with artifacts as evidence

**Independent Test**: `pnpm test:ci` passes 3 consecutive runs with identical results

### Implementation for User Story 7

- [x] T035 [US7] Run `pnpm test:ci` locally and verify all gates pass: build:check → test:types → unit tests → test:smoke
- [x] T036 [US7] Verify smoke test artifacts exist in `extension/test-artifacts/smoke/chromium/` and `extension/test-artifacts/smoke/chromium-negative/`
- [x] T037 [US7] Run `pnpm test:ci` 3 consecutive times locally and confirm identical pass/fail results (SC-009)
- [x] T038 [US7] Verify CI workflow uploads entire `extension/test-artifacts/smoke/` tree (FR-012)

**Checkpoint**: User Story 7 complete. Gate chain is deterministic; artifacts exist and upload.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup and documentation updates

- [x] T039 [P] Run ESLint and Prettier on all modified files: `pnpm run lint && pnpm run format`
- [x] T040 [P] Update `extension/TOOLING.md` to document new meta-tests in the "Test Files" section
- [x] T041 Verify all success criteria from spec.md (SC-001 through SC-011)
- [x] T042 Run quickstart.md verification commands to confirm all patterns are correct

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - creates meta-tests that MUST exist first
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - US1 (P1) and US2 (P1): Can run in parallel (different files)
  - US3 (P2): Can run after or parallel to US1/US2 (different concerns)
  - US4 (P2): Can run after or parallel to US1/US2/US3 (documentation)
  - US5 (P3): Independent (different file - metrics.edge-cases.test.ts)
  - US6 (P3): Independent (different file - rollup.type-test.ts)
- **US7 (P1)**: Depends on US1, US2, US3, US5, US6 completion (validates everything)
- **Polish (Phase 10)**: Depends on all user stories being complete

### User Story Dependencies

| Story | Priority | Depends On | Files Modified |
|-------|----------|------------|----------------|
| US1 | P1 | Setup | negative-fixture.smoke.ts |
| US2 | P1 | Setup | filter-display.smoke.ts, negative-fixture.smoke.ts |
| US3 | P2 | Setup | filter-display.smoke.ts |
| US4 | P2 | None | TOOLING.md |
| US5 | P3 | None | metrics.edge-cases.test.ts |
| US6 | P3 | None | rollup.type-test.ts |
| US7 | P1 | US1-US6 | None (validation only) |

### Parallel Opportunities

**Phase 2 (all parallel)**:
- T003, T004, T005, T006 - different meta-test files

**User Stories (parallel groups)**:
- US1 + US5 + US6 - completely independent files
- US2 + US3 + US4 - overlap on filter-display.smoke.ts but different concerns

---

## Parallel Example: Meta-Test Creation

```bash
# Launch all meta-tests together (Phase 2):
Task: "Create smoke-determinism-guard.test.ts"
Task: "Create playwright-version-guard.test.ts"
Task: "Create no-runtime-type-imports.test.ts"
Task: "Create type-test-header-guard.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2 = Core Determinism)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Meta-tests (T003-T006)
3. Complete Phase 3: US1 - Remove waitForTimeout (T007-T010)
4. Complete Phase 4: US2 - Remove networkidle (T011-T017)
5. **STOP and VALIDATE**: `pnpm test:ci` should pass; grep checks should return zero matches
6. MVP delivered: Core determinism achieved

### Incremental Delivery

1. MVP (US1 + US2) → Core determinism ✓
2. Add US3 → Collision-proof artifacts ✓
3. Add US4 → Version policy documented ✓
4. Add US5 → structuredClone migration ✓
5. Add US6 → Type-test safety ✓
6. US7 → Final validation (3 consecutive runs) ✓

### Parallel Team Strategy

With multiple developers:

1. All developers: Setup + Meta-tests (Phase 1-2)
2. Once meta-tests exist:
   - Developer A: US1 (waitForTimeout) + US5 (deepClone)
   - Developer B: US2 (networkidle) + US3 (artifacts)
   - Developer C: US4 (TOOLING.md) + US6 (type-test header)
3. Everyone: US7 validation together

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Meta-tests (Phase 2) are designed to FAIL initially - they detect violations that implementation phases fix
- Each user story should be independently verifiable via grep or meta-test
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- The spec requires all 7 user stories for complete success criteria
