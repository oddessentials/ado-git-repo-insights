# Tasks: CI Quality Gate Hardening

**Input**: Design documents from `/specs/013-ci-quality-hardening/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, quickstart.md ✓

**Tests**: Not explicitly requested in specification. Tasks focus on implementation and verification.

**Organization**: Tasks grouped by user story from spec.md (P1, P2, P3 priority order).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

---

## Phase 1: Setup (No User Story)

**Purpose**: Verify existing infrastructure and ensure clean baseline

- [x] T001 Verify mypy is installed and configured in pyproject.toml
- [x] T002 [P] Verify tsc --noEmit passes on current codebase in extension/
- [x] T003 [P] Verify ESLint passes on current codebase in extension/
- [x] T004 Run mypy src/ and document any existing errors to fix

**Checkpoint**: Current codebase passes all existing checks; mypy errors identified

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create audit script infrastructure needed by multiple user stories

**⚠️ CRITICAL**: US3 and US5 depend on this phase

- [x] T005 Create scripts/audit-suppressions.py with core scanning logic per data-model.md
- [x] T006 Implement deterministic JSON output (sorted by scope/rule/kind, forward-slash paths)
- [x] T007 Add --update-baseline flag to generate .suppression-baseline.json
- [x] T008 Add --diff flag to compare current scan against committed baseline
- [x] T009 Add --validate flag to verify baseline format/ordering per FR-020
- [x] T010 Generate initial .suppression-baseline.json and commit to repository

**Checkpoint**: `python scripts/audit-suppressions.py` runs successfully; baseline committed

---

## Phase 3: User Story 1 - Type Safety Enforcement (Priority: P1) 🎯 MVP

**Goal**: Python type errors are caught by pre-push hook and CI, blocking merge

**Independent Test**: Push a commit with deliberate mypy error → CI and pre-push must fail

### Implementation for US1

- [x] T011 [US1] Fix any existing mypy errors discovered in T004 in src/ (none found)
- [x] T012 [US1] Add mypy execution block to .husky/pre-push after pre-commit, before pytest
- [x] T013 [US1] Add actionable error message with "how to fix" hint per FR-019 in .husky/pre-push
- [x] T014 [US1] Add mypy job to .github/workflows/ci.yml (Python 3.11, runs mypy src/)
- [x] T015 [US1] Verify pre-push hook fails on deliberate type error (test locally) - verified mypy catches type errors
- [ ] T016 [US1] Verify CI job fails on deliberate type error (test in PR) - will be verified when PR is created

**Checkpoint**: US1 complete — mypy enforced locally and in CI as immutable invariant

---

## Phase 4: User Story 2 - Non-Null Assertion Prevention (Priority: P1)

**Goal**: TypeScript non-null assertions (`value!`) are blocked by ESLint unless justified

**Independent Test**: Add `const x = obj.value!;` to a file → ESLint must fail

### Implementation for US2

- [x] T017 [US2] Audit existing non-null assertions in extension/ui/ using grep or ESLint dry-run (5 found)
- [x] T018 [P] [US2] Fix non-null assertions that can use null checks or optional chaining in extension/ui/ (2 fixed in artifact-client.ts)
- [x] T019 [P] [US2] Add justified suppressions for remaining assertions per FR-007 format in extension/ui/ (2 added in metrics.ts)
- [x] T020 [US2] Add `@typescript-eslint/no-non-null-assertion: 'error'` rule to extension/eslint.config.mjs
- [x] T021 [US2] Verify ESLint now passes with rule enabled (all violations fixed or justified)
- [x] T022 [US2] Update .suppression-baseline.json to include new justified suppressions (44 -> 46)

**Checkpoint**: US2 complete — non-null assertion rule enforced; existing code compliant

---

## Phase 5: User Story 3 - Suppression Comment Auditing (Priority: P2)

**Goal**: CI tracks suppression growth and blocks increases without acknowledgment

**Independent Test**: Add an eslint-disable without SUPPRESSION-INCREASE-APPROVED → CI must fail

### Implementation for US3

- [x] T023 [US3] Add suppression-audit job to .github/workflows/ci.yml
- [x] T024 [US3] Implement PR body check for SUPPRESSION-INCREASE-APPROVED marker in audit script (done in Phase 2)
- [x] T025 [US3] Implement failure message format per FR-011 (previous, new, delta, instruction) (done in Phase 2)
- [x] T026 [US3] Implement direct-push-to-main rejection (no override) per FR-010 (done in Phase 2)
- [x] T027 [US3] Add justification tag validation (-- REASON: or -- SECURITY:) per FR-012
- [ ] T028 [US3] Verify CI fails when suppression count increases without marker (test in PR)
- [ ] T029 [US3] Verify CI passes when SUPPRESSION-INCREASE-APPROVED is in PR body

**Checkpoint**: US3 complete — suppression audit gates PR merges; acknowledgment system works

---

## Phase 6: User Story 4 - Coverage Ratchet Enforcement (Priority: P2)

**Goal**: Coverage thresholds are enforced (verify existing implementation)

**Independent Test**: Lower coverage → CI must fail with threshold violation

### Implementation for US4

- [x] T030 [US4] Verify pytest --cov fails under 70% threshold in pyproject.toml (fail_under = 70 configured)
- [x] T031 [US4] Verify jest coverage thresholds are enforced in extension/jest.config.ts (coverageThreshold configured)
- [x] T032 [US4] Document coverage ratchet verification in quickstart.md (already exists in performance baseline section)

**Checkpoint**: US4 complete — coverage enforcement verified (pre-existing, no new code)

---

## Phase 7: User Story 5 - Python Suppression Standardization (Priority: P3)

**Goal**: Python suppressions require justification tags; malformed ones block commit

**Independent Test**: Add `# type: ignore` without justification → pre-commit must fail

### Implementation for US5

- [x] T033 [US5] Add Python suppression format validation to scripts/audit-suppressions.py (--check-justifications flag)
- [x] T034 [US5] Add pre-commit hook entry for suppression format validation per FR-017
- [x] T035 [US5] Audit existing Python suppressions in src/ for missing justifications (9 found)
- [x] T036 [P] [US5] Fix or justify existing Python suppressions in src/ (all 9 fixed)
- [x] T037 [US5] Verify pre-commit blocks malformed Python suppression (test locally) - verified exits with code 1

**Checkpoint**: US5 complete — Python suppressions require justification; pre-commit enforced

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup

- [x] T038 Update quickstart.md with any new scenarios discovered during implementation (added Scenario 5)
- [x] T039 Run full pre-push hook and verify all checks pass - all 7 checks passed
- [ ] T040 Run full CI workflow on a test PR and verify all jobs pass
- [x] T041 Verify baseline idempotency: run audit-suppressions.py --update-baseline twice, confirm byte-identical output
- [ ] T042 Cross-OS test: verify baseline identical on Windows and Linux (will be verified in CI)
- [x] T043 Add `hooks:precommit` and `hooks:prepush` scripts to package.json per FR-018

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup; **BLOCKS US3, US5**
- **US1 (Phase 3)**: Depends on Setup only — can start in parallel with Foundational
- **US2 (Phase 4)**: Depends on Setup only — can start in parallel with Foundational and US1
- **US3 (Phase 5)**: Depends on Foundational (needs audit script)
- **US4 (Phase 6)**: No dependencies — can run anytime (verification only)
- **US5 (Phase 7)**: Depends on Foundational (needs audit script)
- **Polish (Phase 8)**: Depends on all user stories complete

### User Story Dependencies

```
Setup (Phase 1)
    │
    ├──► Foundational (Phase 2) ──► US3 (Phase 5)
    │         │                 └──► US5 (Phase 7)
    │         │
    ├──► US1 (Phase 3) ─────────────────┐
    │                                    │
    ├──► US2 (Phase 4) ─────────────────┼──► Polish (Phase 8)
    │                                    │
    └──► US4 (Phase 6) ─────────────────┘
```

### Parallel Opportunities

**After Setup completes**:
- US1 (T011-T016) can start immediately
- US2 (T017-T022) can start immediately
- US4 (T030-T032) can start immediately
- Foundational (T005-T010) can start immediately

**After Foundational completes**:
- US3 (T023-T029) can start
- US5 (T033-T037) can start (in parallel with US3)

**Within User Stories**:
- T018, T019 [P] — fix vs justify can run in parallel
- T036 [P] — Python fixes independent of validation logic

---

## Parallel Example: Maximum Concurrency

```bash
# After Setup (Phase 1) completes, launch in parallel:

# Stream 1: US1 (Type Safety)
Task: T011 "Fix existing mypy errors in src/"
Task: T012 "Add mypy to .husky/pre-push"
...

# Stream 2: US2 (Non-Null Assertions)
Task: T017 "Audit existing non-null assertions"
Task: T018 [P] "Fix non-null assertions with null checks"
Task: T019 [P] "Add justified suppressions"
...

# Stream 3: Foundational (enables US3, US5)
Task: T005 "Create scripts/audit-suppressions.py"
Task: T006 "Implement deterministic JSON output"
...

# Stream 4: US4 (Verification only)
Task: T030 "Verify pytest coverage threshold"
Task: T031 "Verify jest coverage threshold"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 3: US1 (Type Safety)
3. **STOP and VALIDATE**: mypy enforced locally and in CI
4. Deploy/demo mypy enforcement

### Incremental Delivery

| Increment | Delivers | Cumulative Value |
|-----------|----------|------------------|
| Setup + US1 | Mypy enforcement | Python type safety gate |
| + US2 | Non-null assertion rule | TypeScript safety added |
| + Foundational + US3 | Suppression auditing | Growth tracking |
| + US4 | Coverage verification | Existing gates documented |
| + US5 | Python suppression format | Cross-language consistency |
| + Polish | Final validation | Production-ready |

### Critical Path

**Fastest path to US3 (suppression auditing)**:
1. Setup (T001-T004)
2. Foundational (T005-T010) — creates audit script
3. US3 (T023-T029) — uses audit script in CI

**US1 and US2 do not block US3** — they can run in parallel.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in same story
- [Story] labels (US1-US5) map to spec.md user stories
- Pre-push already has tsc — preserve it as invariant (T012 adds mypy alongside, not replacing)
- Suppression baseline MUST be committed before US3 CI job can compute diffs
- Cross-OS testing (T042) is important for path normalization verification
- FR-020/FR-021 guardrails enforced via T009 (--validate flag) and T041 (idempotency test)
