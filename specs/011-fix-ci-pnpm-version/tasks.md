# Tasks: Fix CI pnpm Version Specification

**Input**: Design documents from `/specs/011-fix-ci-pnpm-version/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, quickstart.md

**Tests**: No tests explicitly requested. This is a configuration-only fix validated by CI execution.

**Organization**: Tasks are minimal due to single-file fix. US2 is automatically satisfied once US1 completes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No setup required - this is a configuration fix to an existing project

*Skipped - project already initialized*

---

## Phase 2: Foundational

**Purpose**: No foundational work required - fixing existing CI configuration

*Skipped - no blocking prerequisites*

---

## Phase 3: User Story 1 - CI Pipeline Executes Successfully (Priority: P1) 🎯 MVP

**Goal**: Fix pnpm/action-setup@v4 "No pnpm version is specified" error across all CI jobs

**Independent Test**: Push any commit and observe all GitHub Actions workflow jobs complete without pnpm setup errors

### Implementation for User Story 1

- [x] T001 [US1] Add `"packageManager": "pnpm@9.15.0"` field to package.json (root)
- [x] T002 [US1] Verify version matches extension/package.json (`9.15.0`)
- [x] T003 [US1] Local validation: run `pnpm --version` from repository root
- [x] T004 [US1] Local validation: run `cd extension && pnpm install --frozen-lockfile`

**Checkpoint**: Root package.json has packageManager field matching extension/package.json

---

## Phase 4: User Story 2 - Test Results Are Captured (Priority: P2)

**Goal**: Jest test results captured in extension/test-results.xml

**Independent Test**: CI workflow extension-tests job produces test-results.xml after pnpm setup succeeds

### Implementation for User Story 2

*No implementation tasks - US2 is automatically satisfied once US1 is complete*

US2 depends on:
- pnpm/action-setup@v4 succeeding (US1 fix)
- Jest running successfully (existing configuration)
- jest-junit reporter producing XML (already configured in extension/package.json)

**Checkpoint**: extension-tests job produces extension/test-results.xml

---

## Phase 5: CI Validation & Verification

**Purpose**: Verify fix resolves all failing jobs from incident report

- [x] T005 Push changes and trigger CI workflow
- [ ] T006 Verify ci.yml `ui-bundle-sync` job passes (line 126) [PENDING CI]
- [ ] T007 Verify ci.yml `build-extension` job passes (line 467) [PENDING CI]
- [ ] T008 Verify ci.yml `extension-tests` job passes (line 544) [PENDING CI]
- [ ] T009 Verify ci.yml `fresh-clone-verify` job passes (line 651) [PENDING CI]
- [ ] T010 Verify release.yml `build-extension` job passes (line 85) [PENDING CI]
- [ ] T011 Verify extension/test-results.xml is generated in extension-tests job [PENDING CI]
- [x] T012 Verify no quality checks were removed or bypassed (SC-003)

**Checkpoint**: All 5 previously failing jobs now pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Skipped
- **Foundational (Phase 2)**: Skipped
- **User Story 1 (Phase 3)**: No dependencies - can start immediately
- **User Story 2 (Phase 4)**: Automatically satisfied by US1 - no separate work
- **CI Validation (Phase 5)**: Depends on US1 completion

### User Story Dependencies

- **User Story 1 (P1)**: Can start immediately - No dependencies
- **User Story 2 (P2)**: No separate implementation - downstream effect of US1

### Within User Story 1

Sequential execution required:
1. T001 (edit package.json) - ROOT CAUSE FIX
2. T002 (verify version match)
3. T003-T004 (local validation)

### Parallel Opportunities

- T003 and T004 can run in parallel (both are local validation)
- T006-T010 can be checked in parallel (independent CI jobs)

---

## Parallel Example: CI Validation

```bash
# Check all CI jobs in parallel after push:
# Job 1: ui-bundle-sync (ci.yml:126)
# Job 2: build-extension (ci.yml:467)
# Job 3: extension-tests (ci.yml:544)
# Job 4: fresh-clone-verify (ci.yml:651)
# Job 5: build-extension (release.yml:85)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001: Add packageManager to root package.json
2. Complete T002-T004: Local validation
3. **STOP and VALIDATE**: Verify file change is correct
4. Push and observe CI

### Single-PR Delivery

This fix is intentionally minimal:
- 1 file changed: `package.json` (root)
- 1 line added: `"packageManager": "pnpm@9.15.0"`
- 0 workflow files changed
- 0 code changes

---

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 12 |
| US1 Tasks | 4 (implementation) |
| US2 Tasks | 0 (auto-satisfied) |
| Validation Tasks | 8 |
| Files Modified | 1 (`package.json`) |
| Lines Changed | 1 |

### Traceability to Failing Jobs

| Task | Maps to Failing Job |
|------|---------------------|
| T006 | ci.yml ui-bundle-sync (line 126) |
| T007 | ci.yml build-extension (line 467) |
| T008 | ci.yml extension-tests (line 544) |
| T009 | ci.yml fresh-clone-verify (line 651) |
| T010 | release.yml build-extension (line 85) |

---

## Notes

- All validation tasks (T006-T012) are observational - verify CI behavior, no code changes
- US2 requires no implementation because jest-junit is already configured
- The fix is reversible with a single-line revert if needed
- Low blast radius: configuration-only, no runtime behavior changes

## Additional Fix: Pre-existing Test Infrastructure Issue

During implementation, discovered a pre-existing issue with `@jest/globals` module resolution
that caused TypeScript module resolution failures across 13 test files.

**Root cause**: `@jest/globals` was a transitive dependency but not explicitly declared,
causing TypeScript to fail module resolution in CI environments.

**Fix** (comprehensive approach):
1. Added `@jest/globals: "^30.0.0"` as explicit devDependency
2. Added `@types/jsdom: "^21.1.7"` for jsdom type support
3. Removed redundant `@jest/globals` imports from 12 test files (describe/it/expect are globals via @types/jest)
4. Kept `import { jest } from "@jest/globals"` in `tests/setup.ts` (required for jest.fn() and jest.Mock)

**Impact**: Without this fix, 0 tests would collect (all 54 test suites fail to start)

Commits:
1. `bd03eee` - fix(ci): add packageManager to root package.json (original issue)
2. `09c3cac` - fix(test): remove @jest/globals import (initial attempt)
3. `4724b38` - fix(test): resolve @jest/globals module resolution for CI (comprehensive fix)

Local test verification:
- Python: 312 tests passed, 75.65% coverage
- TypeScript: 1092 tests passed across 54 test suites
