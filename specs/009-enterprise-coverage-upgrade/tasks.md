# Tasks: Security Hardening Fixes + Enterprise Coverage Upgrade

**Input**: Design documents from `/specs/008-security-hardening-fixes/` and `/specs/009-enterprise-coverage-upgrade/`
**Branch**: `feat/optimize-quality`
**Prerequisites**: plan.md, spec.md, research.md, quickstart.md for both features

**Organization**: Tasks are grouped by user story across both features to enable independent implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1-008, US1-009)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Verify current state and prepare for changes

- [ ] T001 Verify current Python coverage by running `pytest --cov=src/ado_git_repo_insights --cov-report=term-missing`
- [ ] T002 [P] Verify current TypeScript coverage by running `cd extension && npm run test:coverage`
- [ ] T003 [P] Install eslint-plugin-security if not present: `cd extension && npm install --save-dev eslint-plugin-security`
- [ ] T004 [P] Document current coverage baselines in spec notes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core changes that must be complete before user story work

**⚠️ CRITICAL**: These changes affect multiple features and must be done first

- [ ] T005 Update pre-push hook shebang from `#!/bin/sh` to `#!/usr/bin/env bash` in `.husky/pre-push`
- [ ] T006 Add `set -o pipefail` after `set -e` in `.husky/pre-push`
- [ ] T007 Verify ESLint `@typescript-eslint/no-explicit-any` is set to `'error'` in `extension/eslint.config.mjs`
- [ ] T008 Verify mypy `strict = true` in `pyproject.toml`

**Checkpoint**: Foundation ready - user story implementation can begin

---

## Phase 3: User Story 1 (008) - Shell Injection Prevention (Priority: P0)

**Goal**: Harden pre-push CRLF guard against option injection, word splitting, and newline attacks

**Independent Test**: Create a file with special characters in name, verify CRLF guard handles it safely

### Implementation

- [ ] T009 [US1-008] Convert `.husky/` CRLF check from `grep -rlI` to `find -print0 | xargs -0 grep -l --` pattern in `.husky/pre-push`
- [ ] T010 [US1-008] Convert `*.sh` CRLF check to NUL-delimited pattern with `--` separator in `.husky/pre-push`
- [ ] T011 [US1-008] Convert `.github/scripts/` CRLF check to NUL-delimited pattern in `.husky/pre-push`
- [ ] T012 [US1-008] Convert `scripts/` CRLF check to NUL-delimited pattern in `.husky/pre-push`
- [ ] T013 [US1-008] Convert `extension/scripts/` CRLF check to NUL-delimited pattern in `.husky/pre-push`
- [ ] T014 [US1-008] Convert `extension/ui/` CRLF check to NUL-delimited pattern in `.husky/pre-push`

**Checkpoint**: All CRLF guards use safe NUL-delimited filename handling

---

## Phase 4: User Story 2 (008) - Robust Error Handling (Priority: P0)

**Goal**: Ensure pre-push hook fails reliably on any error including pipeline failures

**Independent Test**: Simulate pipeline failure, verify hook exits non-zero

### Implementation

- [ ] T015 [US2-008] Verify `set -eo pipefail` is at top of `.husky/pre-push` (from T005, T006)
- [ ] T016 [US2-008] Test pipeline failure handling by temporarily breaking a command in `.husky/pre-push`

**Checkpoint**: Pipeline failures are properly caught

---

## Phase 5: User Story 3 (008) - Secure Git Executable Resolution (Priority: P1)

**Goal**: Validate git executable via behavior check, not just path existence

**Independent Test**: Run env_guard.py, verify it checks `git --version` output

### Implementation

- [ ] T017 [US3-008] Add `git --version` validation function to `scripts/env_guard.py`
- [ ] T018 [US3-008] Add regex check for `git version X.Y.Z` pattern in `scripts/env_guard.py`
- [ ] T019 [US3-008] Exit non-zero with clear error if git validation fails in `scripts/env_guard.py`

**Checkpoint**: Git executable is validated by behavior

---

## Phase 6: User Story 4 (008) - Robust File Error Handling (Priority: P1)

**Goal**: env_guard.py exits non-zero on any file error (fail-closed)

**Independent Test**: Attempt to scan unreadable file, verify non-zero exit

### Implementation

- [ ] T020 [US4-008] Replace `errors="ignore"` with explicit encoding in `scripts/env_guard.py`
- [ ] T021 [US4-008] Add try/except for FileNotFoundError with sys.exit() in `scripts/env_guard.py`
- [ ] T022 [US4-008] Add try/except for PermissionError with sys.exit() in `scripts/env_guard.py`
- [ ] T023 [US4-008] Add try/except for UnicodeDecodeError with sys.exit() in `scripts/env_guard.py`
- [ ] T024 [US4-008] Remove bare `except OSError: pass` pattern in `scripts/env_guard.py`

**Checkpoint**: File errors cause fail-closed behavior

---

## Phase 7: User Story 5 (008) - AI Review Configuration (Priority: P2)

**Goal**: Verify and document trusted_only setting

**Independent Test**: Inspect .ai-review.yml, confirm trusted_only is documented

### Implementation

- [ ] T025 [US5-008] Add SECURITY comment explaining trusted_only setting in `.ai-review.yml`

**Checkpoint**: AI review security setting is documented

---

## Phase 8: User Story 6 (008) - ESLint Security Rule Re-enablement (Priority: P1)

**Goal**: Re-enable detect-object-injection with mandatory SECURITY: tags

**Independent Test**: Run `npm run lint`, verify zero warnings

### Implementation

- [ ] T026 [US6-008] Add eslint-plugin-security import to `extension/eslint.config.mjs`
- [ ] T027 [US6-008] Add security plugin configuration to `extension/eslint.config.mjs`
- [ ] T028 [US6-008] Set `'security/detect-object-injection': 'error'` in `extension/eslint.config.mjs`
- [ ] T029 [US6-008] Run ESLint to identify all violations: `cd extension && npm run lint`
- [ ] T030 [US6-008] Add `// eslint-disable-next-line security/detect-object-injection -- SECURITY: <reason>` for each false positive in `extension/ui/*.ts`
- [ ] T031 [US6-008] Verify suppression count matches: `grep -c "detect-object-injection" extension/ui/*.ts` equals `grep -c "SECURITY:" extension/ui/*.ts`

**Checkpoint**: detect-object-injection enabled with governed suppressions

---

## Phase 9: User Story 1 (009) - Enterprise-Grade Test Coverage (Priority: P0)

**Goal**: Increase TypeScript coverage from ~42% to 70%

**Independent Test**: Run `npm run test:coverage`, verify 70% across all metrics

### Implementation

- [ ] T032 [US1-009] Identify lowest-coverage TypeScript modules via coverage report
- [ ] T033 [P] [US1-009] Write tests for `extension/ui/error-codes.ts` in `extension/tests/ui/error-codes.test.ts`
- [ ] T034 [P] [US1-009] Write tests for `extension/ui/error-types.ts` in `extension/tests/ui/error-types.test.ts`
- [ ] T035 [P] [US1-009] Write tests for `extension/ui/dataset-loader.ts` in `extension/tests/ui/dataset-loader.test.ts`
- [ ] T036 [P] [US1-009] Write tests for `extension/ui/artifact-client.ts` in `extension/tests/ui/artifact-client.test.ts`
- [ ] T037 [US1-009] Write additional tests for other low-coverage modules as identified in T032
- [ ] T038 [US1-009] Verify TypeScript coverage >= 70% by running `npm run test:coverage`

**Checkpoint**: TypeScript coverage meets 70% threshold

---

## Phase 10: User Story 2 (009) - Strict Typing Enforcement (Priority: P0)

**Goal**: Verify no `any` types exist in TypeScript codebase

**Independent Test**: Run `npm run lint`, verify no explicit any errors

### Implementation

- [ ] T039 [US2-009] Verify `noImplicitAny: true` in `extension/tsconfig.json`
- [ ] T040 [US2-009] Verify `@typescript-eslint/no-explicit-any: 'error'` in `extension/eslint.config.mjs`
- [ ] T041 [US2-009] Run `npx tsc --noEmit` to verify no implicit any violations
- [ ] T042 [US2-009] Run `npm run lint` to verify no explicit any violations

**Checkpoint**: All any types eliminated

---

## Phase 11: User Story 3 (009) - TypeScript Coverage Badge (Priority: P1)

**Goal**: Add separate Codecov badge for TypeScript in README

**Independent Test**: After CI run, verify TypeScript badge shows coverage percentage

### Implementation

- [ ] T043 [US3-009] Add TypeScript coverage upload step with `--flag typescript` to `.github/workflows/ci.yml`
- [ ] T044 [US3-009] Add Python coverage upload step with `--flag python` to `.github/workflows/ci.yml`
- [ ] T045 [US3-009] Create `codecov.yml` with flag configuration for python and typescript paths
- [ ] T046 [US3-009] Add TypeScript Codecov badge to `README.md`
- [ ] T047 [US3-009] Update existing Python badge to use `?flag=python` in `README.md`

**Checkpoint**: Separate coverage badges for each language

---

## Phase 12: User Story 4 (009) - Local/CI Parity (Priority: P0)

**Goal**: Local hooks enforce identical thresholds as CI

**Independent Test**: Compare jest.config.ts threshold to CI config

### Implementation

- [ ] T048 [US4-009] Set `coverageThreshold` to 70% in `extension/jest.config.ts`
- [ ] T049 [US4-009] Verify `fail_under = 70` in `pyproject.toml` [tool.coverage.report]
- [ ] T050 [US4-009] Verify pre-push hook runs coverage-enforced tests in `.husky/pre-push`

**Checkpoint**: Local and CI thresholds match

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [ ] T051 Run full pre-push hook to verify all checks pass: `git push --dry-run`
- [ ] T052 [P] Verify all CI checks pass by pushing to feature branch
- [ ] T053 [P] Update spec status from Draft to Complete in both spec.md files
- [ ] T054 Run quickstart.md validation for both features

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories
- **008 User Stories (Phase 3-8)**: Depend on Foundational
- **009 User Stories (Phase 9-12)**: Depend on Foundational
- **Polish (Phase 13)**: Depends on all user stories complete

### Feature Independence

- **008 (Security Hardening)**: Phases 3-8 can proceed independently
- **009 (Coverage Upgrade)**: Phases 9-12 can proceed independently
- Both features share Foundational phase but are otherwise independent

### Parallel Opportunities

Within 008:
- T009-T014: All CRLF guard conversions can run in parallel

Within 009:
- T033-T036: All test writing tasks can run in parallel
- T043-T047: Badge setup can run in parallel with test writing

---

## Implementation Strategy

### MVP First (008 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phases 3-8: All 008 user stories
4. **STOP and VALIDATE**: Run pre-push hook
5. Deploy if security hardening is priority

### Full Delivery (Both Features)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phases 3-8: 008 Security Hardening
4. Complete Phases 9-12: 009 Coverage Upgrade
5. Complete Phase 13: Polish
6. Deploy complete quality upgrade

---

## Summary

| Feature | User Stories | Task Count |
|---------|--------------|------------|
| 008-security-hardening-fixes | 6 | 26 |
| 009-enterprise-coverage-upgrade | 4 | 19 |
| Shared (Setup/Foundational/Polish) | - | 8 |
| **Total** | **10** | **54** |
