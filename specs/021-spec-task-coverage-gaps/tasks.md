# Tasks: Spec-Task Coverage Gap Resolution

**Input**: Design documents from `/specs/021-spec-task-coverage-gaps/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md, contracts/test-contracts.md

**Tests**: This feature IS the testing infrastructure - all tasks involve creating tests, test configurations, or test automation.

**Organization**: Tasks are grouped by user story (all P1 priority). This feature extends `specs/001-fix-filter-prcount-sum/tasks.md` with enterprise-grade testing infrastructure.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US4)
- Include exact file paths in descriptions

## Path Conventions

- **Extension code**: `extension/ui/modules/`
- **Extension tests**: `extension/tests/`
- **Test configs**: `extension/`
- **Demo UI**: `docs/`

---

## Phase 1: Type Test Infrastructure (US1)

**Purpose**: Implement compile-time type safety tests with fail-on-regression detection

**User Story 1**: Type Safety Enforcement with Fail-on-Regression Tests (Priority: P1)

**Goal**: Create dedicated type test harness that catches type regressions at compile time

**Independent Test**: Run `pnpm run test:types` - exit 0 = pass, exit non-zero = regression

### Configuration

- [x] T024 [US1] Create `extension/tsconfig.type-tests.json` extending base tsconfig with `noEmit: true` and include pattern `tests/**/*.type-test.ts` only (FR-030)
- [x] T025 [US1] Add `"test:types": "tsc --noEmit --project tsconfig.type-tests.json"` script to `extension/package.json` (FR-031)

### Type Test Implementation

- [x] T026 [US1] Create `extension/tests/types/rollup.type-test.ts` with positive test: access `pr_count` from `BreakdownEntry` via `Rollup.by_repository['key']` - must compile without error (FR-001)
- [x] T027 [P] [US1] Add positive test in `extension/tests/types/rollup.type-test.ts`: verify `Rollup.by_team['key'].pr_count` compiles (FR-001)
- [x] T028 [P] [US1] Add negative test in `extension/tests/types/rollup.type-test.ts`: use `// @ts-expect-error` before assigning `BreakdownEntry` to `number` type - annotation must be satisfied (FR-002)
- [x] T029 [P] [US1] Add negative test in `extension/tests/types/rollup.type-test.ts`: use `// @ts-expect-error` before treating `Rollup.by_repository['key']` as direct number - annotation must be satisfied (FR-002)

### Harness Validation

- [x] T030 [US1] Validate type test harness by temporarily changing `by_repository` type to `Record<string, number>` in rollup.schema.ts, running `pnpm run test:types`, verifying exit code non-zero with TS2578, then reverting change (FR-032)

**Checkpoint**: Gate 2 passes - `pnpm run test:types` exits 0 with 2+ positive and 2+ negative tests

---

## Phase 2: Smoke Test Infrastructure (US2)

**Purpose**: Implement deterministic Playwright-based browser automation with artifact capture

**User Story 2**: Deterministic Smoke Test with Pass/Fail Artifact (Priority: P1)

**Goal**: Create repeatable smoke test that validates demo UI and produces screenshot evidence

**Independent Test**: Run `pnpm run test:smoke` - produces screenshot in `extension/test-artifacts/smoke/`

### Dependencies

- [x] T031 [US2] Add Playwright as pinned devDependency in `extension/package.json` with exact version (e.g., `"@playwright/test": "1.40.0"`) (FR-026)
- [x] T032 [US2] Add `"test:smoke": "playwright test"` script to `extension/package.json` (FR-005)

### Configuration

- [x] T033 [US2] Create `extension/playwright.config.ts` with: `testDir: './tests/smoke'`, `testMatch: '**/*.smoke.ts'`, `webServer` config serving `../docs` on port 3000, `screenshot: 'on'`, `outputDir: 'test-artifacts/smoke'` (FR-021, FR-007)
- [x] T034 [P] [US2] Add `extension/test-artifacts/` to `.gitignore` (local artifacts, CI uploads)

### DOM Selectors

- [x] T035 [US2] Add `data-testid="total-prs"` attribute to Total PRs display element in `docs/index.html` (FR-033)
- [x] T036 [P] [US2] Add `data-testid="filter-repository"` attribute to repository filter control in `docs/index.html` (FR-034)
- [x] T037 [P] [US2] Add `data-testid="filter-team"` attribute to team filter control in `docs/index.html` (FR-034)

### Smoke Test Implementation

- [x] T038 [US2] Create `extension/tests/smoke/filter-display.smoke.ts` with `test.beforeAll()` that validates `docs/data/dataset-manifest.json` exists and matches minimum schema (FR-035)
- [x] T039 [US2] Add smoke test case in `extension/tests/smoke/filter-display.smoke.ts`: select repository filter via `page.getByTestId('filter-repository')`, capture screenshot, verify `page.getByTestId('total-prs')` text is finite number (FR-009, FR-022)
- [x] T040 [P] [US2] Add smoke test case in `extension/tests/smoke/filter-display.smoke.ts`: select team filter via `page.getByTestId('filter-team')`, capture screenshot, verify Total PRs is finite number (FR-009, FR-022)

**Checkpoint**: Gate 4 passes - `pnpm run test:smoke` exits 0, screenshot artifact in `extension/test-artifacts/smoke/`

---

## Phase 3: Edge Case Traceability (US3)

**Purpose**: Create exhaustive edge case test coverage with enforceable traceability

**User Story 3**: Exhaustive Edge Case Test Coverage (Priority: P1)

**Goal**: Implement 5 explicit edge case tests (EC-001 through EC-005) with meta-test enforcement

**Independent Test**: Run `pnpm test:unit -- --testPathPattern=metrics.edge-cases.test.ts` - all 5 EC tests pass

### Edge Case Test File

- [ ] T041 [US3] Create `extension/tests/modules/metrics.edge-cases.test.ts` with test for EC-001: `pr_count: NaN` returns 0, include comment `// Covers EC-001: pr_count NaN returns 0` (FR-010, FR-024)
- [ ] T042 [P] [US3] Add test for EC-002 in `extension/tests/modules/metrics.edge-cases.test.ts`: `pr_count: "50"` coerces to 50, include comment `// Covers EC-002: pr_count string coercion` (FR-010, FR-024)
- [ ] T043 [P] [US3] Add test for EC-003 in `extension/tests/modules/metrics.edge-cases.test.ts`: `pr_count: Infinity` returns 0, include comment `// Covers EC-003: pr_count Infinity returns 0` (FR-010, FR-024)
- [ ] T044 [P] [US3] Add test for EC-004 in `extension/tests/modules/metrics.edge-cases.test.ts`: `pr_count: -Infinity` returns 0, include comment `// Covers EC-004: pr_count -Infinity returns 0` (FR-010, FR-024)
- [ ] T045 [P] [US3] Add test for EC-005 in `extension/tests/modules/metrics.edge-cases.test.ts`: mixed dataset `[{pr_count: 10}, {pr_count: NaN}, {pr_count: "20"}, {pr_count: Infinity}]` sums to 30, include comment `// Covers EC-005: mixed valid/invalid dataset sums correctly` (FR-010, FR-024)

### Meta-Test Enforcement

- [ ] T046 [US3] Create `extension/tests/meta/ec-traceability.test.ts` that scans `metrics.edge-cases.test.ts` for `// Covers EC-###:` comments and fails if any EC-001..EC-005 is missing or duplicated (FR-037)
- [ ] T047 [US3] Verify ec-traceability meta-test runs as part of `pnpm test:ci` and blocks on missing EC coverage (FR-038)

**Checkpoint**: Gate 3 passes - `pnpm test:unit` exits 0, all EC-001..EC-005 tests pass, traceability check passes

---

## Phase 4: Quality Gate Documentation (US4)

**Purpose**: Document quality gates as explicit phase blockers with CI enforcement

**User Story 4**: Quality Gates as Phase Blockers (Priority: P1)

**Goal**: Ensure all 5 quality gates are documented and enforced in CI

**Independent Test**: Review tasks.md - each phase has explicit gate with command and expected output

### Documentation

- [ ] T048 [US4] Create `extension/TOOLING.md` documenting: Node version (22), pnpm version (9.15.0), Playwright version (pinned), TypeScript version (5.7.3), and canonical CI commands for all 5 gates (FR-027)
- [x] T049 [P] [US4] Add CI artifact upload step in `.github/workflows/` for smoke test screenshots using `actions/upload-artifact` with path `extension/test-artifacts/smoke/` (FR-023)

### CI Integration

- [x] T050 [US4] Update `pnpm test:ci` script in `extension/package.json` to run gates in order: `build:check`, `test:types`, `test:unit` (includes traceability), `test:smoke`
- [x] T051 [US4] Verify full CI suite passes: `pnpm test:ci` in `extension/` directory exits 0 with all gates green

**Checkpoint**: Gate 5 passes - `pnpm test:ci` runs all gates in sequence, all pass

---

## Phase 5: Polish & Verification

**Purpose**: Final validation and cleanup

- [ ] T052 Run `pnpm run lint` in `extension/` directory - verify no lint errors
- [ ] T053 Run `pnpm run format:check` in `extension/` directory - verify formatting
- [ ] T054 Verify SC-001: tasks.md has 30+ tasks (original 28 + new tasks)
- [ ] T055 Verify SC-003: Type test suite has 2+ positive and 2+ negative tests
- [ ] T056 Verify SC-005: 5 explicit edge case tests exist (EC-001..EC-005)
- [ ] T057 Verify SC-007: Run consistency analysis - zero critical/medium issues
- [ ] T058 Stage changes for commit: `git add extension/ docs/ .github/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Type Tests)**: No dependencies - can start immediately
- **Phase 2 (Smoke Tests)**: No dependencies - can start in parallel with Phase 1
- **Phase 3 (Edge Cases)**: No dependencies - can start in parallel with Phase 1/2
- **Phase 4 (Quality Gates)**: Depends on Phases 1-3 (documents and integrates all gates)
- **Phase 5 (Polish)**: Depends on all phases complete

### User Story Dependencies

- **User Story 1 (US1)**: Type tests - standalone, no dependencies
- **User Story 2 (US2)**: Smoke tests - standalone, no dependencies on US1
- **User Story 3 (US3)**: Edge case tests - standalone, no dependencies on US1/US2
- **User Story 4 (US4)**: Quality gate documentation - integrates US1-US3, depends on them

### Within Each Phase

**Phase 1 (Type Tests)**:
- T024 → T025 (config before script)
- T026 → T027, T028, T029 in parallel (after first type test file created)
- T030 must be last (validates harness)

**Phase 2 (Smoke Tests)**:
- T031 → T032 (dependency before script)
- T033 → T034 in parallel (config, gitignore)
- T035 → T036, T037 in parallel (after first data-testid)
- T038 → T039, T040 in parallel (fixture validation before tests)

**Phase 3 (Edge Cases)**:
- T041 → T042, T043, T044, T045 in parallel (after first EC test)
- T046 → T047 (meta-test before CI verification)

**Phase 4 (Quality Gates)**:
- T048 → T049 in parallel (docs, CI artifact)
- T050 → T051 (update script before verify)

### Parallel Opportunities

- **Phases 1-3 can run in parallel** (different test types, no dependencies)
- **Within Phase 1**: T027, T028, T029 can run in parallel (different test cases in same file)
- **Within Phase 2**: T036, T037 can run in parallel (different DOM elements)
- **Within Phase 2**: T039, T040 can run in parallel (different smoke test cases)
- **Within Phase 3**: T042-T045 can run in parallel (different EC tests)

---

## Implementation Strategy

### MVP First (Type Tests Only)

1. Complete Phase 1: Type Test Infrastructure (T024-T030)
2. **STOP and VALIDATE**: Run `pnpm run test:types` - verify exit 0
3. Can ship type safety gate independently

### Incremental Delivery

1. Phase 1 (Type Tests) → Gate 2 passes
2. Phase 2 (Smoke Tests) → Gate 4 passes
3. Phase 3 (Edge Cases) → Gate 3 passes
4. Phase 4 (Quality Gates) → Gate 5 passes
5. Phase 5 (Polish) → Full verification

### Parallel Team Strategy

With multiple developers:
- Developer A: Phase 1 (Type Tests)
- Developer B: Phase 2 (Smoke Tests)
- Developer C: Phase 3 (Edge Cases)
- All: Phase 4 (integration) after 1-3 complete

---

## Gate Validation Commands

| Gate | Command | Pass Criteria | Phase |
|------|---------|---------------|-------|
| Gate 1 | `pnpm run build:check` | Exit 0 | Pre-existing |
| Gate 2 | `pnpm run test:types` | Exit 0 | Phase 1 complete |
| Gate 3 | `pnpm test:unit` | Exit 0, all tests pass | Phase 3 complete |
| Gate 4 | `pnpm run test:smoke` | Exit 0, screenshot in test-artifacts/ | Phase 2 complete |
| Gate 5 | `pnpm test:ci` | Exit 0, all gates pass | Phase 4 complete |

---

## Notes

- [P] tasks = different files or code locations, no dependencies
- [Story] label maps task to specific user story (US1-US4)
- All user stories are P1 priority (testing infrastructure is foundational)
- EC-### comments are mandatory for traceability enforcement
- Screenshot artifacts are git-ignored locally, uploaded in CI
- Total: 35 new tasks (T024-T058)
