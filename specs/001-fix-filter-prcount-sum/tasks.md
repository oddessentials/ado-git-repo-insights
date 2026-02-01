# Tasks: Fix Dashboard Filter PR Count Summation Bug

**Input**: Design documents from `/specs/001-fix-filter-prcount-sum/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Required per spec (FR-007, FR-008) - includes fixture updates and regression test.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. Note: US1 and US2 share the same core fix (repository and team filtering use the same code path).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Extension code**: `extension/ui/modules/`
- **Extension tests**: `extension/tests/modules/`
- **Demo bundle**: `docs/dashboard.js`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No setup needed - this is a bug fix in existing codebase

*No tasks in this phase - existing project structure is used.*

---

## Phase 2: Foundational (Core Fix Implementation)

**Purpose**: Implement the core fix that enables ALL user stories. The `toFiniteNumber()` helper and type guard fixes are shared by US1-US3.

**⚠️ CRITICAL**: All user stories depend on this phase being complete first.

- [ ] T001 Add `toFiniteNumber(value: unknown): number` helper function in `extension/ui/modules/metrics.ts` before `applyFiltersToRollups()` function. Implementation: `const n = Number(value); return Number.isFinite(n) ? n : 0`
- [ ] T002 Update repository filter type guard in `extension/ui/modules/metrics.ts` line ~150 from `.filter((r): r is number => r !== undefined)` to `.filter((entry): entry is BreakdownEntry => entry !== undefined && typeof entry?.pr_count === 'number')`
- [ ] T003 Update repository filter reduce operation in `extension/ui/modules/metrics.ts` line ~164 to use `toFiniteNumber(entry.pr_count)` instead of summing the entry directly
- [ ] T004 Update team filter type guard in `extension/ui/modules/metrics.ts` line ~188 from `.filter((t): t is number => t !== undefined)` to `.filter((entry): entry is BreakdownEntry => entry !== undefined && typeof entry?.pr_count === 'number')`
- [ ] T005 Update team filter reduce operation in `extension/ui/modules/metrics.ts` line ~202 to use `toFiniteNumber(entry.pr_count)` instead of summing the entry directly
- [ ] T006 Import `BreakdownEntry` type from `../schemas/rollup.schema` in `extension/ui/modules/metrics.ts` (if not already imported)
- [ ] T006b [P] Verify `Rollup` type in `extension/ui/dataset-loader.ts` defines `by_repository` and `by_team` as `Record<string, BreakdownEntry>` (or `BreakdownEntry | undefined`). If typed as `Record<string, number>`, update to `Record<string, BreakdownEntry>`. This satisfies FR-006 type-level enforcement.
- [ ] T007 Verify TypeScript compilation passes with `pnpm run build:check` in `extension/` directory

**Checkpoint**: Core fix applied - TypeScript compiles without errors

---

## Phase 3: User Story 1 - Repository Filter Shows Correct PR Totals (Priority: P1) 🎯 MVP

**Goal**: Fix repository filter to display correct numeric Total PRs instead of `0[object Object]...`

**Independent Test**: Select any repository filter in dashboard and verify Total PRs shows a valid number

### Tests for User Story 1

- [ ] T008 [US1] Update test fixture `baseRollup.by_repository` in `extension/tests/modules/metrics.test.ts` from `{ "repo-a": 30, "repo-b": 70 }` to `{ "repo-a": { pr_count: 30 }, "repo-b": { pr_count: 70 } }`
- [ ] T009 [US1] Verify existing repository filter tests still pass: `pnpm test:unit -- --testPathPattern=metrics.test` in `extension/` directory

**Checkpoint**: User Story 1 complete - repository filtering works correctly

---

## Phase 4: User Story 2 - Team Filter Shows Correct PR Totals (Priority: P1)

**Goal**: Fix team filter to display correct numeric Total PRs instead of `0[object Object]...`

**Independent Test**: Select any team filter in dashboard and verify Total PRs shows a valid number

### Tests for User Story 2

- [ ] T010 [US2] Update test fixture `baseRollup.by_team` in `extension/tests/modules/metrics.test.ts` from `{ "team-x": 40, "team-y": 60 }` to `{ "team-x": { pr_count: 40 }, "team-y": { pr_count: 60 } }`
- [ ] T011 [US2] Verify existing team filter tests still pass: `pnpm test:unit -- --testPathPattern=metrics.test` in `extension/` directory

**Checkpoint**: User Story 2 complete - team filtering works correctly

---

## Phase 5: User Story 3 - Malformed Data Does Not Corrupt Display (Priority: P2)

**Goal**: Ensure `toFiniteNumber()` handles edge cases gracefully without string concatenation

**Independent Test**: Provide fixtures with missing/null/non-numeric `pr_count` values and verify display shows 0

### Tests for User Story 3

- [ ] T012 [US3] Add regression test in separate `describe` block in `extension/tests/modules/metrics.test.ts` that feeds objects into reducer and asserts:
  - `typeof result[0].pr_count === 'number'`
  - `Number.isFinite(result[0].pr_count) === true`
  - `String(result[0].pr_count)` does not contain `[object`
  - `String(result[0].pr_count)` does not contain `Object`
- [ ] T013 [P] [US3] Add test case for missing `pr_count` property in `extension/tests/modules/metrics.test.ts`: fixture `{ "repo-a": {} }` should result in 0
- [ ] T014 [P] [US3] Add test case for `pr_count: null` in `extension/tests/modules/metrics.test.ts`: fixture `{ "repo-a": { pr_count: null } }` should result in 0
- [ ] T015 [P] [US3] Add test case for `pr_count: NaN` in `extension/tests/modules/metrics.test.ts`: fixture `{ "repo-a": { pr_count: NaN } }` should result in 0
- [ ] T015b [P] [US3] Add test case for string `pr_count: "50"` in `extension/tests/modules/metrics.test.ts`: fixture `{ "repo-a": { pr_count: "50" } }` should coerce to 50 (not 0, not string concatenation)
- [ ] T015c [P] [US3] Add test case for `pr_count: Infinity` in `extension/tests/modules/metrics.test.ts`: fixture `{ "repo-a": { pr_count: Infinity } }` should result in 0
- [ ] T016 [US3] Run all edge case tests: `pnpm test:unit -- --testPathPattern=metrics.test` in `extension/` directory

**Checkpoint**: User Story 3 complete - malformed data is handled gracefully

---

## Phase 6: User Story 4 - Demo Dashboard Reflects Production Fix (Priority: P2)

**Goal**: Rebuild demo bundle so GitHub Pages demo shows correct behavior

**Independent Test**: Load demo with filters applied, verify Total PRs is numeric

### Implementation for User Story 4

- [ ] T017 [US4] Rebuild UI bundle: `pnpm run build:ui` in `extension/` directory
- [ ] T018 [US4] Verify demo bundle changed: `git diff docs/dashboard.js | head -20` should show changes
- [ ] T019 [US4] Run full test suite to ensure no regressions: `pnpm test:ci` in `extension/` directory
- [ ] T019b [US4] Manual smoke test: Open `docs/index.html` in browser, select a repository filter, verify Total PRs shows numeric value (not `[object Object]`)
- [ ] T019c [US4] Manual smoke test: Select a team filter, verify Total PRs shows numeric value (not `[object Object]`)

**Checkpoint**: User Story 4 complete - demo bundle is updated and manually verified

---

## Phase 7: Polish & Verification

**Purpose**: Final validation and cleanup

- [ ] T020 Run lint check: `pnpm run lint` in `extension/` directory
- [ ] T021 Run format check: `pnpm run format:check` in `extension/` directory
- [ ] T022 Verify all success criteria per quickstart.md validation steps
- [ ] T023 Stage changes for commit: `git add extension/ui/modules/metrics.ts extension/tests/modules/metrics.test.ts docs/dashboard.js`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: N/A - no setup tasks
- **Foundational (Phase 2)**: No dependencies - can start immediately. **BLOCKS all user stories.**
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion
- **User Story 2 (Phase 4)**: Depends on Phase 2 completion (can run in parallel with US1)
- **User Story 3 (Phase 5)**: Depends on Phase 2 completion (can run in parallel with US1/US2)
- **User Story 4 (Phase 6)**: Depends on Phase 2-5 completion (must be last before polish)
- **Polish (Phase 7)**: Depends on all user stories complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Foundational phase - tests repo filtering
- **User Story 2 (P1)**: Depends only on Foundational phase - tests team filtering
- **User Story 3 (P2)**: Depends only on Foundational phase - tests edge cases
- **User Story 4 (P2)**: Depends on US1-US3 tests passing - rebuilds bundle

### Within Foundational Phase

- T001 must be first (helper function needed by T002-T005)
- T002-T006, T006b can run in parallel after T001
- T007 must be last (verify compilation)

### Parallel Opportunities

- **Phase 2**: T002, T003, T004, T005, T006, T006b can run in parallel after T001
- **Phase 3-5**: US1, US2, US3 can be worked in parallel (different test cases)
- **Phase 5**: T013, T014, T015, T015b, T015c can run in parallel (different test fixtures)

---

## Parallel Example: Foundational Phase

```bash
# First: Create helper function
Task: T001 - Add toFiniteNumber() helper

# Then in parallel:
Task: T002 - Update repository filter type guard
Task: T003 - Update repository filter reduce
Task: T004 - Update team filter type guard
Task: T005 - Update team filter reduce
Task: T006 - Import BreakdownEntry type
Task: T006b - Verify Rollup type enforcement (FR-006)

# Finally: Verify
Task: T007 - Verify TypeScript compilation
```

---

## Parallel Example: Edge Case Tests (Phase 5)

```bash
# These test different fixtures, can run in parallel:
Task: T013 - Test missing pr_count
Task: T014 - Test null pr_count
Task: T015 - Test NaN pr_count
Task: T015b - Test string coercion ("50" → 50)
Task: T015c - Test Infinity pr_count
```

---

## Implementation Strategy

### MVP First (Core Fix + US1)

1. Complete Phase 2: Foundational (T001-T007, including T006b)
2. Complete Phase 3: User Story 1 (T008-T009)
3. **STOP and VALIDATE**: Run tests, verify repository filter works
4. Can ship as quick fix if urgent

### Full Fix (Recommended)

1. Complete Phase 2: Foundational (T001-T007, including T006b)
2. Complete Phase 3-5 in parallel: US1, US2, US3 (T008-T016, including T015b, T015c)
3. Complete Phase 6: US4 - Rebuild bundle + manual smoke tests (T017-T019c)
4. Complete Phase 7: Polish (T020-T023)
5. Commit as single fix

### Single-Commit Strategy (Per Spec)

This is intended to be a one-commit fix:

1. Complete all phases (28 tasks total)
2. Commit with message per quickstart.md
3. Create PR

---

## Notes

- [P] tasks = different code locations, no dependencies
- [Story] label maps task to specific user story for traceability
- All foundational tasks (T001-T007) must complete before any user story tasks
- The fix is shared: T001-T006 fix both repository (US1) and team (US2) filtering
- Edge case tests (US3) validate the `toFiniteNumber()` helper
- Demo rebuild (US4) is a build artifact, not code change
- Manual smoke tests (T019b, T019c) satisfy FR-011/SC-007 without automation overhead
- Total: 28 tasks across 7 phases
