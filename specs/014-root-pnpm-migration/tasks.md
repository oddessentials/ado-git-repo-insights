# Tasks: Complete Root pnpm Migration

**Input**: Design documents from `/specs/014-root-pnpm-migration/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, quickstart.md

**Tests**: No automated tests requested - this is a configuration-only migration verified through manual validation and CI execution.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- Repository root configuration files
- `.github/workflows/` for CI/CD workflows
- `.github/actions/` for composite actions

---

## Phase 1: Setup (Lockfile Migration)

**Purpose**: Remove npm lockfile and create pnpm lockfile at repository root

- [x] T001 Delete package-lock.json at repository root
- [x] T002 Run `pnpm install` at repository root to generate pnpm-lock.yaml
- [x] T003 Verify lockfile stability by running `pnpm install` again (should show "Lockfile is up to date")
- [x] T004 Stage pnpm-lock.yaml for commit: `git add pnpm-lock.yaml`

**Checkpoint**: Root has pnpm-lock.yaml, no package-lock.json exists ✓

---

## Phase 2: Foundational (Defense-in-Depth npm Blocking)

**Purpose**: Configure repository to block npm usage through multiple enforcement layers

**⚠️ CRITICAL**: This phase must complete before workflow changes to ensure npm is blocked

- [x] T005 Add preinstall script to package.json that blocks npm via npm_config_user_agent check
- [x] T006 Add `engines.pnpm` field to package.json specifying version 9.15.0
- [x] T007 [P] Create or update .npmrc with `engine-strict=true`
- [x] T008 Verify npm blocking: run `npm install` and confirm it fails with both preinstall error AND engine mismatch

**Checkpoint**: npm is blocked at repository root through defense-in-depth configuration ✓

---

## Phase 3: User Story 1 - Developer Runs pnpm Install at Root (Priority: P1) 🎯 MVP

**Goal**: Developers can successfully run `pnpm install` at the repository root using the new pnpm-lock.yaml

**Independent Test**: Clone repository, run `pnpm install` at root, verify pnpm-lock.yaml exists and no package-lock.json is created

### Implementation for User Story 1

- [x] T009 [US1] Commit lockfile migration changes (pnpm-lock.yaml creation, package-lock.json deletion)
- [x] T010 [US1] Commit defense-in-depth npm blocking (package.json scripts/engines, .npmrc)
- [x] T011 [US1] Verify local `pnpm install` works with new lockfile
- [x] T012 [US1] Verify `npm install` fails with both blocking mechanisms

**Checkpoint**: User Story 1 complete - developers can use pnpm at root, npm is blocked ✓

---

## Phase 4: User Story 2 - Release Workflow Uses pnpm Exclusively (Priority: P1)

**Goal**: Release workflow uses pnpm for all operations and hard-fails on any lockfile mutation

**Independent Test**: Trigger release workflow, verify it uses pnpm and lockfile verification passes without exit code masking

### Implementation for User Story 2

- [x] T013 [US2] Replace `setup-node@v4` with `.github/actions/setup-pnpm` in .github/workflows/release.yml (release job)
- [x] T014 [US2] Replace `npm ci` with `pnpm install --frozen-lockfile` in .github/workflows/release.yml (release job)
- [x] T015 [US2] Add strict lockfile verification step after semantic-release in .github/workflows/release.yml (no exit code masking)
- [x] T016 [US2] Remove the now-redundant standalone `setup-node` step from release job in .github/workflows/release.yml
- [x] T017 [US2] Commit release.yml changes

**Checkpoint**: User Story 2 complete - release workflow uses pnpm exclusively with strict verification ✓

---

## Phase 5: User Story 3 - CI Rejects npm Lockfiles Anywhere (Priority: P2)

**Goal**: CI fails if package-lock.json exists anywhere in the repository workspace

**Independent Test**: Create a dummy package-lock.json, push to branch, verify CI fails with actionable error message

### Implementation for User Story 3

- [x] T018 [US3] Update pnpm-lockfile-guard job in .github/workflows/ci.yml to use `find` for workspace-wide package-lock.json detection
- [x] T019 [US3] Verify guard checks entire workspace (not just extension/ directory)
- [x] T020 [US3] Verify error message is actionable: "This repository uses pnpm exclusively. Remove package-lock.json and use pnpm install."
- [x] T021 [US3] Commit ci.yml lockfile guard changes

**Checkpoint**: User Story 3 complete - CI rejects package-lock.json anywhere in workspace ✓

---

## Phase 6: User Story 4 - Repository Enforces Single Package Manager (Priority: P2)

**Goal**: CI enforces no npm commands exist in workflows, package.json scripts, or helper scripts

**Independent Test**: Run `git grep "npm ci\|npm install" .github/workflows/ package.json scripts/` and verify only allowlisted tfx-cli remains

### Implementation for User Story 4

- [x] T022 [US4] Add new `npm-command-guard` job in .github/workflows/ci.yml
- [x] T023 [US4] Configure npm-command-guard to scan .github/workflows/ for npm ci/install commands
- [x] T024 [US4] Configure npm-command-guard to scan root package.json scripts
- [x] T025 [US4] Configure npm-command-guard to scan scripts/ directory
- [x] T026 [US4] Configure allowlist for `npm install -g tfx-cli` (global tool, not project dependency)
- [x] T027 [US4] Verify grep check fails on any non-allowlisted npm ci/install command
- [x] T028 [US4] Commit ci.yml npm-command-guard changes

**Checkpoint**: User Story 4 complete - CI enforces pnpm-only policy across workflows, scripts, and package.json ✓

---

## Phase 7: Polish & Verification

**Purpose**: Final verification and cleanup

- [x] T029 Push feature branch and verify all CI checks pass
- [x] T030 Verify `pnpm install` at root is stable (run twice, no diff)
- [x] T031 Verify `npm install` fails with both error types (preinstall + engine mismatch)
- [x] T032 Verify existing extension build still works (uses pnpm correctly)
- [x] T033 Run quickstart.md validation checklist
- [x] T034 [P] Update specs/014-root-pnpm-migration/checklists/requirements.md with completion status

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - creates blocking configuration
- **User Story 1 (Phase 3)**: Depends on Phase 1 + 2 - commits the migration
- **User Story 2 (Phase 4)**: Depends on Phase 3 - release workflow needs lockfile to exist
- **User Story 3 (Phase 5)**: Can start after Phase 3 - independent of release workflow changes
- **User Story 4 (Phase 6)**: Can start after Phase 3 - independent of other CI changes
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
    │
    v
Phase 2 (Foundational)
    │
    v
Phase 3 (US1: Lockfile Migration) ← MVP COMPLETE HERE
    │
    ├──────────────────┬──────────────────┐
    v                  v                  v
Phase 4 (US2)     Phase 5 (US3)     Phase 6 (US4)
[Release.yml]     [CI Lockfile]     [CI npm grep]
    │                  │                  │
    └──────────────────┴──────────────────┘
                       │
                       v
                Phase 7 (Polish)
```

### Within Each User Story

- Configuration changes before commits
- Verification after each change
- Commit at story completion

### Parallel Opportunities

- **Phase 2**: T007 (.npmrc) can run in parallel with T005/T006 (package.json) - different files
- **Phase 5 & 6**: US3 and US4 can run in parallel after US1 (different CI jobs)
- **Phase 7**: T034 can run in parallel with verification tasks

---

## Parallel Example: Foundational Phase

```bash
# T005 and T006 are sequential (same file: package.json)
# T007 can run in parallel with package.json changes (different file: .npmrc)
Task: "Add preinstall script to package.json" → then → "Add engines.pnpm field to package.json"
Task: "Create or update .npmrc with engine-strict=true"  # parallel with above
```

## Parallel Example: User Stories 3 & 4

```bash
# After User Story 1 completes, both can run in parallel:
Task: "Update pnpm-lockfile-guard job in .github/workflows/ci.yml to use find for workspace-wide detection"
Task: "Add new npm-command-guard job in .github/workflows/ci.yml"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (lockfile migration)
2. Complete Phase 2: Foundational (npm blocking)
3. Complete Phase 3: User Story 1 (commit changes)
4. **STOP and VALIDATE**: Test `pnpm install` and `npm install` locally
5. Push and verify basic CI passes

### Incremental Delivery

1. Complete Setup + Foundational → npm blocked locally
2. Add User Story 1 → Push branch → Verify pnpm works (MVP!)
3. Add User Story 2 → Release workflow migrated
4. Add User Story 3 + 4 (parallel) → Full CI enforcement
5. Polish → All verification complete

### File Change Summary

| File | Tasks | Action |
|------|-------|--------|
| package-lock.json | T001 | Delete |
| pnpm-lock.yaml | T002 | Create (auto-generated) |
| package.json | T005, T006 | Modify (add scripts + engines) |
| .npmrc | T007 | Create/Modify |
| .github/workflows/release.yml | T013-T016 | Modify |
| .github/workflows/ci.yml | T018, T022-T026 | Modify |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each story completion
- Stop at any checkpoint to validate story independently
- No automated tests requested - verification is through manual validation and CI execution

---

## Implementation Status

**Status**: ✅ COMPLETE (2026-01-29)

All 34 tasks completed successfully:
- Phase 1: 4/4 tasks ✓
- Phase 2: 4/4 tasks ✓
- Phase 3 (US1): 4/4 tasks ✓
- Phase 4 (US2): 5/5 tasks ✓
- Phase 5 (US3): 4/4 tasks ✓
- Phase 6 (US4): 7/7 tasks ✓
- Phase 7 (Polish): 6/6 tasks ✓

**Commits**:
1. `feat(root): migrate from npm to pnpm with defense-in-depth blocking`
2. `ci(release): migrate release workflow to pnpm with strict lockfile verification`
3. `ci: extend CI guards for pnpm-only enforcement`

**Branch**: `014-root-pnpm-migration` pushed to origin
