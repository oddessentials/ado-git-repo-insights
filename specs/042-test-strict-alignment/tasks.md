# Tasks: Align Test Type-Checking with Production Strictness

**Input**: Design documents from `specs/042-test-strict-alignment/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, quickstart.md

**Tests**: Not explicitly requested. Test tasks are omitted except where verification is intrinsic to the feature (behavioral equivalence snapshot).

**Organization**: Tasks are grouped by user story. US1 and US4 are both P1 and tightly coupled (US4 proves US1 didn't break anything), so they share a phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Capture baseline state before any changes and prepare tooling.

- [ ] T001 Capture pre-migration behavioral equivalence baseline by running `npx jest --json --outputFile=../specs/042-test-strict-alignment/baseline-snapshot.json` in `extension/`
- [ ] T002 Capture pre-migration coverage baseline by running `npx jest --coverage --coverageReporters=json-summary` and copying `extension/coverage/coverage-summary.json` to `specs/042-test-strict-alignment/baseline-coverage.json`
- [ ] T003 Generate the full strict-mode error list by running `tsc --noEmit` against a temporary strict test config and saving output to `specs/042-test-strict-alignment/error-inventory.txt` for triage reference

**Checkpoint**: Baseline snapshots captured. Triage and infrastructure work can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create enforcement infrastructure and complete error triage. MUST be complete before any type-annotation fixes begin.

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 [P] Create resolved-config parity script at `extension/scripts/check-test-config-parity.mjs` that uses `tsc --showConfig` to compare resolved `compilerOptions` between `extension/tsconfig.json` and `extension/tsconfig.test.json`, failing on any non-allowlisted difference (allowlist: `noEmit`, `declaration`, `sourceMap`, `outDir`, `rootDir`)
- [ ] T005 [P] Add `"test:config-parity": "node scripts/check-test-config-parity.mjs"` and `"build:check-tests": "tsc --noEmit --project tsconfig.test.json"` scripts to `extension/package.json`
- [ ] T006 Categorize all ~574 errors from `specs/042-test-strict-alignment/error-inventory.txt` into mechanical (~514: TS2532, TS18047, TS18048, TS2531, TS18049, TS7006, TS7053, TS7005, TS7034) and semantic (~60: TS2345, TS2322, TS2769, TS2488). Document each semantic error with file, line, expected vs actual type, and root cause (bad mock / outdated fixture / changed interface) in `specs/042-test-strict-alignment/semantic-triage.md`

**Checkpoint**: Infrastructure scripts created, errors triaged. If any semantic error reveals a genuine production contract violation requiring production code changes, escalate to a separate issue before proceeding.

---

## Phase 3: User Story 1 + User Story 4 — Fix All Type Errors and Prove Equivalence (Priority: P1) MVP

**Goal**: Remove all 4 strictness overrides from `extension/tsconfig.test.json`, fix all 574 type errors across 33 test files, and prove via before/after snapshot comparison that zero test behavior changed.

**Independent Test**: Run `tsc --noEmit --project tsconfig.test.json` (zero errors) and compare Jest JSON output against baseline snapshot (identical per-test pass/fail/skip).

### Layer 1: Fix Shared Helpers (FR-008 — must complete before leaf tests)

- [ ] T007 [US1] Fix 4 implicit `any` types in `extension/tests/mocks/ado-sdk.ts`: add explicit types for `webContext` (line 10), error callback parameter (line 33), `runs` (line 39), and `artifacts` (line 40) in `SdkMockOptions` and `BuildApiScenario` interfaces
- [ ] T008 [US1] Fix 8 type errors in `extension/tests/harness/vss-sdk-mock.ts`: add null guards and explicit types for mock factory functions and internal object types

### Layer 2: Fix Leaf Tests — Batch A (63% of all errors)

- [ ] T009 [P] [US1] Fix 196 type errors in `extension/tests/modules/metrics.test.ts`: add non-null assertions on metric lookups, explicit parameter types on mock callbacks, and null guards on DOM element access
- [ ] T010 [P] [US1] Fix 166 type errors in `extension/tests/dashboard.test.ts`: add non-null assertions on element queries, explicit types on mock function parameters, and type guards on fixture data access

### Layer 3: Fix Leaf Tests — Batch B (17% of all errors)

- [ ] T011 [P] [US1] Fix 34 type errors in `extension/tests/version-adapter-integration.test.ts`: add explicit types for adapter mock parameters and null guards on version lookup results
- [ ] T012 [P] [US1] Fix 34 type errors in `extension/tests/modules/metrics.edge-cases.test.ts`: add non-null assertions on edge-case metric lookups and explicit parameter types
- [ ] T013 [P] [US1] Fix 28 type errors in `extension/tests/modules/ml.test.ts`: add explicit types for ML model mock data and null guards on prediction results

### Layer 4: Fix Leaf Tests — Batch C (8% of all errors)

- [ ] T014 [P] [US1] Fix 19 type errors in `extension/tests/python-integration/synthetic-fixtures.test.ts`: add explicit types for Python subprocess results and null guards on fixture parsing
- [ ] T015 [P] [US1] Fix 16 type errors in `extension/tests/e2e/dashboard-render.test.ts`: add non-null assertions on rendered DOM elements and explicit types for render context
- [ ] T016 [P] [US1] Fix 13 type errors in `extension/tests/vsix-packaging.test.ts`: add null guards on manifest property access (screenshots, contributions)

### Layer 5: Fix Leaf Tests — Batch D (remaining 12% — 24 files with <10 errors each)

- [ ] T017 [P] [US1] Fix 6 type errors in `extension/tests/schema/rollup.test.ts`
- [ ] T018 [P] [US1] Fix 6 type errors in `extension/tests/production-issues.test.ts`
- [ ] T019 [P] [US1] Fix 5 type errors in `extension/tests/smoke/filter-display.smoke.ts`
- [ ] T020 [P] [US1] Fix 4 type errors in `extension/tests/ml-types.test.ts`
- [ ] T021 [P] [US1] Fix 4 type errors in `extension/tests/meta/any-type-ratchet.test.ts`
- [ ] T022 [P] [US1] Fix 4 type errors in `extension/tests/dataset-loader-validation.test.ts`
- [ ] T023 [P] [US1] Fix 3 type errors in `extension/tests/schema/manifest.test.ts`
- [ ] T024 [P] [US1] Fix 3 type errors in `extension/tests/metrics.test.ts`
- [ ] T025 [P] [US1] Fix 3 type errors in `extension/tests/meta/ec-traceability.test.ts`
- [ ] T026 [P] [US1] Fix 3 type errors in `extension/tests/chunked-loading.test.ts`
- [ ] T027 [P] [US1] Fix 3 type errors in `extension/tests/ado-sdk.test.ts`
- [ ] T028 [P] [US1] Fix 2 type errors in `extension/tests/schema/parity.test.ts`
- [ ] T029 [P] [US1] Fix 2 type errors in `extension/tests/meta/suppression-ratchet.test.ts`
- [ ] T030 [US1] Fix remaining type errors in any files with ≤1 error each (verify count at implementation time — error inventory may shift slightly from main branch changes)

### Layer 6: Config Change and Verification

- [ ] T031 [US1] Remove all strictness overrides from `extension/tsconfig.test.json` — final file should contain only `extends`, `noEmit: true`, `declaration: false`, `sourceMap: false`, plus `include`/`exclude`
- [ ] T032 [US1] Verify `tsc --noEmit --project tsconfig.test.json` reports zero errors in `extension/`
- [ ] T033 [US4] Capture post-migration snapshot by running `npx jest --json --outputFile=../specs/042-test-strict-alignment/post-snapshot.json` and `npx jest --coverage --coverageReporters=json-summary` in `extension/`
- [ ] T034 [US4] Compare `specs/042-test-strict-alignment/baseline-snapshot.json` vs `post-snapshot.json` and `baseline-coverage.json` vs post-migration coverage: verify identical per-test pass/fail/skip status (2,015 pass, 9 skip, 0 fail) and coverage within ±0.1%
- [ ] T035 [US1] Verify zero new suppression comments were added by running `python scripts/audit-suppressions.py --diff` from repo root — test-file suppression count must remain at 5
- [ ] T035a [US1] Audit `specs/042-test-strict-alignment/semantic-triage.md` to confirm every semantic error (~60 TS2345/TS2322/TS2769/TS2488) has a documented resolution (fix test, fix mock, or fix interface) with rationale — satisfies SC-006

**Checkpoint**: US1 + US4 complete. Type checker reports zero errors, all 2,024 tests pass with proven behavioral equivalence, zero new suppressions, config overrides removed.

---

## Phase 4: User Story 2 — Unblock Future Test Authoring (Priority: P2)

**Goal**: Confirm that new test files written under the strict configuration compile and pass without any additional setup.

**Independent Test**: Create a new test file with strict patterns (explicit types, null guards) and confirm it compiles without errors.

- [ ] T036 [US2] Verify that a new test file created in `extension/tests/` with properly typed code compiles cleanly under `tsc --noEmit --project tsconfig.test.json` and that a new test file with an implicit `any` parameter is rejected by the type checker (manual verification — no permanent file created)

**Checkpoint**: US2 verified. Future test authoring is unblocked under strict rules.

---

## Phase 5: User Story 3 — Maintain Parity Going Forward (Priority: P3)

**Goal**: Add CI gates and pre-commit triggers that enforce strict type-checking and config parity going forward, covering both current and future type-checker flags.

**Independent Test**: Run `pnpm run test:config-parity` (exit 0), temporarily add a strictness override and verify it fails, run full preflight.

### Pre-Commit and Pre-Push Integration

- [ ] T037 [US3] Add test file trigger patterns (`extension/tests/**/*.ts`) to the UI trigger list in `scripts/run_repo_hook.py` (around lines 218–232) so that staging test files triggers type checking
- [ ] T038 [US3] Add a `run_extension_test_typecheck()` function in `scripts/run_repo_hook.py` that runs `pnpm run build:check-tests` when test files or `tsconfig*.json` files are staged, following the pattern of existing `run_extension_typecheck()` (lines 407–424)
- [ ] T038a [US3] Add config parity check to `scripts/run_repo_hook.py` that runs `pnpm run test:config-parity` when any `tsconfig*.json` file is staged — closes the plan Layer 1a integration point and satisfies QG-35 (every CI gate has a local equivalent)
- [ ] T039 [US3] Add `CommandSpec("Extension test type check", (PNPM_SENTINEL, "run", "build:check-tests"), cwd=EXTENSION_ROOT)` to `scripts/run_pr_preflight.py` command list (after the existing "Extension build check" entry around line 161)
- [ ] T040 [US3] Add `CommandSpec("Extension test config parity", (PNPM_SENTINEL, "run", "test:config-parity"), cwd=EXTENSION_ROOT)` to `scripts/run_pr_preflight.py` command list

### CI Integration

- [ ] T041 [P] [US3] Add `pnpm run build:check-tests` step in `.github/workflows/ci.yml` `extension-tests` job after the existing "TypeScript Type Check" step (around line 830)
- [ ] T042 [P] [US3] Add `pnpm run test:config-parity` step in `.github/workflows/ci.yml` `extension-tests` job after the new test type-check step

### Skipped Test Review (FR-009)

- [ ] T043 [US3] Review all 9 conditionally-skipped tests + 1 skipped suite: verify each compiles under strict mode, confirm skip condition is still valid, and add a one-line justification comment at each skip site in `extension/tests/vsix-artifact-inspection.test.ts`, `extension/tests/unit/chart-scalability.test.ts`, `extension/tests/python-integration/performance.test.ts`, and `extension/tests/python-integration/synthetic-fixtures.test.ts`

### Verification

- [ ] T044 [US3] Run `pnpm run test:config-parity` in `extension/` and confirm exit 0 (parity holds)
- [ ] T045 [US3] Temporarily add `"strict": false` to `extension/tsconfig.test.json`, run `pnpm run test:config-parity`, confirm exit 1 (parity violation detected), then revert the change
- [ ] T046 [US3] Run full preflight via `python scripts/run_pr_preflight.py` from repo root and confirm all checks pass including the two new gates

**Checkpoint**: US3 complete. Config parity and test type-check are enforced in pre-commit, pre-push, and CI. Skipped tests reviewed.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates and final validation.

- [ ] T047 [P] Update `LOCAL_CI_PARITY_INVARIANTS.md` to document two new Tier 1/2 gates: "Extension test type check" (`pnpm run build:check-tests`) and "Extension test config parity" (`pnpm run test:config-parity`), following the existing gate documentation format
- [ ] T048 [P] Verify quickstart instructions in `specs/042-test-strict-alignment/quickstart.md` are still accurate after implementation — run through each verification command
- [ ] T049 Run final full validation: `tsc --noEmit --project tsconfig.test.json` (0 errors) + `npx jest` (2,024 tests, 0 failures) + `pnpm run test:config-parity` (exit 0) + `python scripts/audit-suppressions.py --diff` (no new suppressions) + `python scripts/run_pr_preflight.py` (all pass)

**Checkpoint**: All user stories verified, documentation updated, preflight green. Ready for PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: T004/T005 can run in parallel with Phase 1; T006 (triage) depends on T003 (error inventory)
- **US1+US4 (Phase 3)**: Depends on Phase 2 completion (triage must be done before fixes begin). T007/T008 (helpers) must complete before T009–T030 (leaf tests). T031 (config change) must be last fix. T033/T034 (equivalence proof) depends on all fixes.
- **US2 (Phase 4)**: Depends on Phase 3 completion (config must be strict before verifying new-file behavior)
- **US3 (Phase 5)**: T037–T042 can begin after Phase 2 (infrastructure scripts exist). T043–T046 depend on Phase 3 (config must be strict). Can partially overlap with Phase 3.
- **Polish (Phase 6)**: Depends on Phases 3–5 completion

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational phase. No dependency on other stories.
- **US4 (P1)**: Depends on US1 completion (can't prove equivalence until migration is done).
- **US2 (P2)**: Depends on US1 completion (strict config must be in place).
- **US3 (P3)**: Partially independent — infrastructure tasks (T037–T042) can overlap with US1 fixes; verification tasks (T043–T046) depend on US1 completion.

### Within Phase 3

- T007, T008 (helpers) → sequential, must finish before leaf tests
- T009, T010 (Batch A) → parallel with each other, depend on T007/T008
- T011, T012, T013 (Batch B) → parallel with each other, depend on T007/T008
- T014, T015, T016 (Batch C) → parallel with each other, depend on T007/T008
- T017–T030 (Batch D) → all parallel with each other, depend on T007/T008
- Batches A–D can all run in parallel once helpers are done
- T031 (config change) → after all fixes
- T032–T035 (verification) → sequential after T031

### Parallel Opportunities

- T001 + T002 (baseline captures) — parallel
- T004 + T005 (infrastructure scripts) — parallel, and parallel with T001/T002
- T009 + T010 (Batch A) — parallel
- T011 + T012 + T013 (Batch B) — parallel
- T014 + T015 + T016 (Batch C) — parallel
- T017–T029 (Batch D) — all parallel
- Batches A + B + C + D — all parallel once helpers are done
- T037–T040 (pre-commit/pre-push integration) — partially parallel with Phase 3 fixes
- T041 + T042 (CI integration) — parallel with each other
- T047 + T048 (documentation) — parallel

---

## Parallel Example: Phase 3 Leaf Test Fixes

```text
# After T007 + T008 (helpers) are complete, launch all batches together:

Batch A (parallel):
  T009: Fix 196 errors in extension/tests/modules/metrics.test.ts
  T010: Fix 166 errors in extension/tests/dashboard.test.ts

Batch B (parallel):
  T011: Fix 34 errors in extension/tests/version-adapter-integration.test.ts
  T012: Fix 34 errors in extension/tests/modules/metrics.edge-cases.test.ts
  T013: Fix 28 errors in extension/tests/modules/ml.test.ts

Batch C (parallel):
  T014: Fix 19 errors in extension/tests/python-integration/synthetic-fixtures.test.ts
  T015: Fix 16 errors in extension/tests/e2e/dashboard-render.test.ts
  T016: Fix 13 errors in extension/tests/vsix-packaging.test.ts

Batch D (all parallel):
  T017–T030: Fix remaining 24 files (all <10 errors each)
```

---

## Implementation Strategy

### MVP First (US1 + US4 Only)

1. Complete Phase 1: Capture baselines
2. Complete Phase 2: Create infrastructure, triage errors
3. Complete Phase 3: Fix all type errors, remove overrides, prove equivalence
4. **STOP and VALIDATE**: Zero tsc errors, all tests pass, snapshot match confirmed
5. This delivers the core value: tests are strict, and the proof exists

### Incremental Delivery

1. Setup + Foundational → baselines captured, infrastructure ready
2. US1 + US4 → type errors fixed, config strict, equivalence proven (MVP!)
3. US2 → future authoring verified under strict rules
4. US3 → enforcement gates in pre-commit, pre-push, CI — durable protection
5. Polish → documentation, final preflight

### Parallel Team Strategy

With multiple developers after Phase 2:
- Developer A: Batch A leaf test fixes (T009, T010 — 362 errors, 63%)
- Developer B: Batch B + C fixes (T011–T016 — 144 errors, 25%)
- Developer C: Batch D fixes (T017–T030 — 68 errors, 12%) + US3 infrastructure (T037–T042)
- All converge for Phase 3 verification (T031–T035) and Phase 5 verification (T043–T046)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Error counts are approximate (574 total as of 2026-03-28) — verify at implementation time
- Semantic errors (~60 TS2345/TS2322/TS2769/TS2488) require individual review per T006 triage — do NOT apply mechanical casts
- The baseline snapshots (T001/T002) are stored in the specs directory for comparison only, not committed to the branch
- Fix ordering constraint (FR-008): shared helpers (T007/T008) MUST complete before any leaf test files (T009–T030)
