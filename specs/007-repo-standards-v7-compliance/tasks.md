# Tasks: Repository Standards v7.1.1 Compliance

**Input**: Design documents from `/specs/007-repo-standards-v7-compliance/`
**Prerequisites**: plan.md (required), spec.md (required), research.md

**Tests**: No test tasks included - this is a configuration-focused feature with manual verification steps.

**Organization**: Tasks are grouped by user story to enable independent implementation and verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

This feature modifies configuration files across:
- Root: `package.json`, `tsconfig.json`, `.husky/pre-push`
- Extension: `extension/package.json`, `extension/tsconfig.json`, `extension/eslint.config.mjs`, `extension/jest.config.ts`
- Scripts: `scripts/env_guard.py`
- Pre-commit: `.pre-commit-config.yaml`

---

## Phase 1: Setup (Package Upgrade)

**Purpose**: Upgrade @oddessentials/repo-standards to v7.1.1 as prerequisite for all other changes

- [x] T001 [US1] Update @oddessentials/repo-standards version from ^6.0.0 to ^7.1.1 in package.json
- [x] T002 [US1] Run `npm install` to update package-lock.json
- [x] T003 [US1] Verify `npm run standards:ts` outputs v7 schema
- [x] T004 [US1] Verify `npm run standards:py` outputs v7 schema

**Checkpoint**: Package upgrade complete. Standards commands show v7 schema.

---

## Phase 2: User Story 1 - Standards Package Upgrade (Priority: P0) 🎯 MVP

**Goal**: Repository standards package upgraded to v7.1.1 with verification

**Independent Test**: Run `npm run standards:ts` and `npm run standards:py` - both should output v7 schema requirements

### Implementation for User Story 1

> Note: Tasks T001-T004 in Phase 1 complete User Story 1

**Checkpoint**: User Story 1 complete. Proceed to P1 stories.

---

## Phase 3: User Story 2 - Developer Code Quality Assurance (Priority: P1)

**Goal**: TypeScript strictness and ESLint security plugin catch unused code and vulnerabilities

**Independent Test**:
1. Create a file with `const unused = 1;` - TypeScript should error
2. Create a file with `eval(userInput)` - ESLint should error

### Implementation for User Story 2

#### TypeScript Strictness

- [x] T005 [P] [US2] Add `noUnusedLocals: true` to compilerOptions in tsconfig.json (root)
- [x] T006 [P] [US2] Add `noUnusedParameters: true` to compilerOptions in tsconfig.json (root)
- [x] T007 [P] [US2] Add `noUnusedLocals: true` to compilerOptions in extension/tsconfig.json
- [x] T008 [P] [US2] Add `noUnusedParameters: true` to compilerOptions in extension/tsconfig.json
- [x] T009 [US2] Run `cd extension && npx tsc --noEmit` to verify no compilation errors
- [x] T010 [US2] Fix any unused variable errors by prefixing with `_` (if any found)

#### ESLint Security Plugin

- [x] T011 [US2] Install eslint-plugin-security@^3.0.0 in extension/package.json
- [x] T012 [US2] Run `cd extension && npm install` to update lockfile
- [x] T013 [US2] Add security plugin import to extension/eslint.config.mjs
- [x] T014 [US2] Add security.configs.recommended to ESLint config in extension/eslint.config.mjs
- [x] T015 [US2] Configure security rule severities (error for dangerous, warn for risky) in extension/eslint.config.mjs
- [x] T016 [US2] Run `cd extension && npm run lint` to verify no ESLint errors

**Checkpoint**: TypeScript catches unused variables, ESLint catches security patterns.

---

## Phase 4: User Story 3 - Test Coverage Enforcement (Priority: P1)

**Goal**: Coverage thresholds prevent test quality regression

**Independent Test**: Run `cd extension && npm run test:coverage` - should enforce thresholds

### Implementation for User Story 3

- [x] T017 [US3] Add coverageThreshold configuration to extension/jest.config.ts
- [x] T018 [US3] Set initial thresholds at current levels (statements: 42, branches: 36, functions: 47, lines: 43)
- [x] T019 [US3] Run `cd extension && npm run test:coverage` to verify threshold enforcement works
- [x] T020 [US3] Add comment documenting plan to increase thresholds to 70% in extension/jest.config.ts

**Checkpoint**: Coverage thresholds enforced. Test suite fails if coverage drops below thresholds.

---

## Phase 5: User Story 4 - Pre-push Verification Parity (Priority: P2)

**Goal**: Pre-push hook mirrors CI checks, blocking pushes with lint errors

**Independent Test**: Introduce deliberate ESLint error, attempt push - should be blocked

### Implementation for User Story 4

- [x] T021 [US4] Add ESLint check section to .husky/pre-push after TypeScript type check
- [x] T022 [US4] Add echo statement for ESLint check start in .husky/pre-push
- [x] T023 [US4] Add `npm run lint` command to .husky/pre-push
- [x] T024 [US4] Add exit code check and failure message for ESLint in .husky/pre-push
- [x] T025 [US4] Add success message for ESLint check in .husky/pre-push
- [x] T026 [US4] Test pre-push hook by running `.husky/pre-push` manually

**Checkpoint**: Pre-push blocks on ESLint failures, matching CI behavior.

---

## Phase 6: User Story 5 - Secret Leak Prevention (Priority: P2)

**Goal**: Environment variable values detected and blocked from commits

**Independent Test**: Set `TEST_VAR=secret123`, stage file containing "secret123", commit should fail

### Implementation for User Story 5

- [x] T027 [US5] Create scripts/env_guard.py with shebang and docstring
- [x] T028 [US5] Add PROTECTED_VARS list (ADO_PAT, OPENAI_API_KEY, AZURE_DEVOPS_TOKEN) to scripts/env_guard.py
- [x] T029 [US5] Implement main() function to check staged files for secret values in scripts/env_guard.py
- [x] T030 [US5] Add entry point conditional to scripts/env_guard.py
- [x] T031 [US5] Add env-guard hook configuration to .pre-commit-config.yaml
- [x] T032 [US5] Test env-guard by running `pre-commit run env-guard` manually

**Checkpoint**: Commits with environment variable values are blocked.

---

## Phase 7: Polish & Verification

**Purpose**: Final verification and documentation updates

- [x] T033 Run full verification: `npm run standards:ts` shows v7 schema
- [x] T034 Run full verification: `npm run standards:py` shows v7 schema
- [x] T035 Run full verification: `cd extension && npx tsc --noEmit` passes
- [x] T036 Run full verification: `cd extension && npm run lint` passes
- [x] T037 Run full verification: `cd extension && npm run test:coverage` passes with thresholds
- [x] T038 Run full verification: `.husky/pre-push` completes without errors
- [x] T039 [P] Update NEXT_STEPS.md to mark completed items
- [x] T040 Commit all changes with conventional commit message

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (US1)**: Completes with Phase 1 - package upgrade is US1
- **Phase 3 (US2)**: Depends on Phase 1 completion (needs v7.1.1 installed)
- **Phase 4 (US3)**: No dependency on other user stories - can run in parallel with Phase 3
- **Phase 5 (US4)**: Depends on Phase 3 (needs ESLint configured for pre-push)
- **Phase 6 (US5)**: No dependencies on other user stories - can run in parallel
- **Phase 7 (Polish)**: Depends on all previous phases

### User Story Dependencies

| Story | Priority | Depends On | Can Parallel With |
|-------|----------|------------|-------------------|
| US1 - Package Upgrade | P0 | None | None (must be first) |
| US2 - Code Quality | P1 | US1 | US3, US5 |
| US3 - Coverage | P1 | US1 | US2, US5 |
| US4 - Pre-push | P2 | US2 (needs ESLint) | US5 |
| US5 - Env-guard | P2 | US1 | US2, US3, US4 |

### Parallel Opportunities

**Phase 3 (US2)**: T005-T008 can run in parallel (different config files)

**Across User Stories**:
- US2 and US3 can run in parallel (different config files)
- US2 and US5 can run in parallel (different files entirely)
- US3 and US5 can run in parallel (different files entirely)

---

## Parallel Example: User Story 2

```bash
# Launch TypeScript config updates in parallel:
Task: "Add noUnusedLocals to tsconfig.json (root)"
Task: "Add noUnusedLocals to extension/tsconfig.json"
Task: "Add noUnusedParameters to tsconfig.json (root)"
Task: "Add noUnusedParameters to extension/tsconfig.json"

# Then sequentially:
Task: "Verify TypeScript compilation"
Task: "Install ESLint security plugin"
Task: "Configure ESLint security rules"
Task: "Verify ESLint passes"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Package Upgrade
2. **STOP and VALIDATE**: Run standards commands to verify v7.1.1
3. This is the minimum viable compliance upgrade

### Incremental Delivery

1. Complete US1 (Package Upgrade) → Validate → Can stop here for minimal compliance
2. Add US2 (Code Quality) → Validate → TypeScript strictness + ESLint security active
3. Add US3 (Coverage) → Validate → Coverage thresholds enforced
4. Add US4 (Pre-push) → Validate → CI parity in pre-push hook
5. Add US5 (Env-guard) → Validate → Full v7.1.1 compliance achieved

### Recommended Order

For single developer:
1. US1 → US2 → US3 → US4 → US5 (sequential, priority order)

For parallel execution:
1. US1 (blocking)
2. US2 + US3 + US5 in parallel
3. US4 (needs US2 complete)

---

## Notes

- All config changes are additive (no breaking changes to existing functionality)
- TypeScript strictness verified clean in research phase - no code fixes expected
- Coverage thresholds start at current levels to avoid blocking
- Each user story adds compliance value independently
- Commit after each phase/checkpoint for incremental safety
