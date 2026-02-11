# Tasks: Dependency Updates

**Input**: Design documents from `/specs/028-dep-updates/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 — Apply Safe Patch-Level Updates (Priority: P1) MVP

**Goal**: Apply the 3 low-risk, patch-level dependency updates locally to reduce security exposure and establish a clean baseline.

**Independent Test**: Apply each update, run the full CI pipeline, confirm all checks pass.

### Implementation for User Story 1

- [ ] T001 [P] [US1] Update `dependency-cruiser` from `17.3.7` to `17.3.8` in `extension/package.json`
- [ ] T002 [P] [US1] Update `serve` pin from `14.2.0` to `14.2.5` in `extension/package.json`
- [ ] T003 [US1] Update serve version assertion in `extension/tests/meta/playwright-version-guard.test.ts` to match `14.2.5`
- [ ] T004 [P] [US1] Update `@types/node` from `25.1.0` to `25.2.2` in `extension/package.json`
- [ ] T005 [US1] Run `cd extension && pnpm install` to update lockfile with all three changes
- [ ] T006 [US1] Run `pnpm test:ci` in `extension/` to verify all tests pass after patch updates

**Checkpoint**: All 3 safe patch updates applied. CI green on main. SC-001 validated.

---

## Phase 2: User Story 2 — Refresh Lockfiles for In-Range Updates (Priority: P1)

**Goal**: Refresh lockfiles in both extension/ and root/ to pick up in-range minor/patch bumps without changing any package declarations.

**Independent Test**: Refresh lockfiles in both directories, run full test suite, confirm all pass.

### Implementation for User Story 2

- [ ] T007 [US2] Run `pnpm update` in `extension/` to refresh `extension/pnpm-lock.yaml` (picks up typescript-eslint, esbuild in-range bumps)
- [ ] T008 [US2] Run `pnpm test:ci` in `extension/` to verify all tests pass after lockfile refresh
- [ ] T009 [US2] Run `pnpm update` in root `/` to refresh `pnpm-lock.yaml` (picks up semantic-release, @semantic-release/github)
- [ ] T010 [US2] Commit lockfile changes, push, verify CI green on all matrix legs

**Checkpoint**: Both lockfiles refreshed. SC-002 validated (at least 4 in-range bumps). CI green on main.

---

## Phase 3: User Story 3 — Upgrade CI Caching Action (Priority: P2)

**Goal**: Upgrade `actions/cache` from v4 to v5 in CI workflows for improved caching and continued support.

**Independent Test**: Update workflow file, push to feature branch, confirm all CI jobs with caching pass.

### Implementation for User Story 3

- [ ] T011 [US3] Verify GitHub-hosted runner version meets minimum (≥2.327.1) by checking a recent CI run log
- [ ] T012 [US3] Update `actions/cache@v4` to `actions/cache@v5` in `.github/workflows/ci.yml`
- [ ] T013 [US3] Commit, push to feature branch, verify all CI jobs pass (especially cache restore/save steps)
- [ ] T014 [US3] Merge to main after CI green

**Checkpoint**: CI caching action upgraded. SC-003 validated (all caching jobs pass first attempt). CI green on main.

---

## Phase 4: User Story 4 — Migrate Linter/Formatter to Latest Version (Priority: P3)

**Goal**: Upgrade ruff from 0.14.14 to 0.15.0, adopting the 2026 formatting style and newly stabilized lint rules, as a single atomic commit.

**Independent Test**: Bump ruff in both configs, run formatter and checker, verify type checks and tests pass.

### Implementation for User Story 4

- [ ] T015 [US4] Update `ruff==0.14.14` to `ruff==0.15.0` in `pyproject.toml`
- [ ] T016 [US4] Update `.pre-commit-config.yaml` rev from `v0.14.14` to `v0.15.0` (ruff-pre-commit)
- [ ] T017 [US4] Install updated ruff: `pip install -e .[dev]`
- [ ] T018 [US4] Run `ruff format .` to reformat entire Python codebase to 2026 style
- [ ] T019 [US4] Run `ruff check .` — fix any new violations from stabilized rules (especially B912 `map-without-explicit-strict`)
- [ ] T020 [US4] Run `mypy src/` to verify type checking still passes
- [ ] T021 [US4] Run `pytest tests/` to verify all tests pass with coverage threshold met
- [ ] T022 [US4] Regenerate suppression baseline: `python scripts/audit-suppressions.py > .suppression-baseline.json`
- [ ] T023 [US4] Run `pre-commit run --all-files` to verify all hooks pass
- [ ] T024 [US4] Commit as single atomic commit (all reformatted files + config changes + baseline)

**Checkpoint**: Ruff 0.15.0 migration complete. SC-004 validated (zero unaccounted violations). All Python quality gates pass.

---

## Phase 5: User Story 5 — Upgrade Browser Test Framework (Priority: P3)

**Goal**: Upgrade @playwright/test from 1.50.0 to 1.58.2 to benefit from browser engine updates, bug fixes, and security patches.

**Independent Test**: Update pinned version, run install (triggers browser download), execute smoke tests and full test suite.

### Implementation for User Story 5

- [ ] T025 [US5] Update `@playwright/test` pin from `1.50.0` to `1.58.2` in `extension/package.json`
- [ ] T026 [US5] Run `cd extension && pnpm install` (auto-downloads matching Chromium binary)
- [ ] T027 [US5] Run `pnpm test:smoke` in `extension/` to verify smoke tests pass with new browser version
- [ ] T028 [US5] If smoke tests fail: adjust selectors/timeouts as needed in test files
- [ ] T029 [US5] Run `pnpm test:ci` in `extension/` to verify full test suite passes
- [ ] T030 [US5] Verify version guard test (`extension/tests/meta/playwright-version-guard.test.ts`) passes with new exact version
- [ ] T031 [US5] Commit and push

**Checkpoint**: Playwright 1.58.2 migration complete. SC-005 validated (all smoke tests pass first run). Version guard updated.

---

## Phase 6: User Story 6 — Upgrade File Globbing Library (Priority: P3)

**Goal**: Upgrade glob from v10 to v13, closing a 3-major-version gap. Audit all usage sites to ensure no reliance on removed APIs.

**Independent Test**: Upgrade the package, run install, execute full test suite to identify any breakages.

### Implementation for User Story 6

- [ ] T032 [US6] Audit all `glob` imports and usages in `extension/` and `scripts/` — document usage sites
- [ ] T033 [US6] Check if `@types/glob` can be removed (glob v13 includes built-in TypeScript types)
- [ ] T034 [US6] Update `glob` version from `^10.4.0` to `^13.0.1` in `extension/package.json`
- [ ] T035 [US6] Remove `@types/glob` from devDependencies if glob v13 includes built-in types
- [ ] T036 [US6] Run `cd extension && pnpm install`
- [ ] T037 [US6] Fix any compilation errors from API changes (if identified in audit)
- [ ] T038 [US6] Run `pnpm test:ci` in `extension/` to verify full test suite passes
- [ ] T039 [US6] Verify no build scripts depend on glob CLI binary
- [ ] T040 [US6] Commit and push

**Checkpoint**: glob v13 migration complete. SC-006 validated (globbing results identical to v10 baseline). No build scripts broken.

---

## Phase 7: Final Validation

**Purpose**: Cross-cutting validation after all batches are complete

- [ ] T041 Verify all 7 audited dependency updates are applied and no open Dependabot PRs remain (SC-007)
- [ ] T042 Verify CI is green on main across all matrix legs
- [ ] T043 Run `pnpm test:ci` in `extension/` — full pass
- [ ] T044 Run `pytest tests/` with coverage threshold — full pass
- [ ] T045 Run `mypy src/` — zero errors
- [ ] T046 Run `pre-commit run --all-files` — all hooks pass
- [ ] T047 Check for open security advisories on direct dependencies (SC-008)

**Checkpoint**: All success criteria (SC-001 through SC-008) validated. Feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (US1: Safe PRs) ──→ Phase 2 (US2: Lockfiles) ──→ Phase 3 (US3: CI Action)
                                                            │
                                                            ├──→ Phase 4 (US4: Ruff)
                                                            ├──→ Phase 5 (US5: Playwright)
                                                            └──→ Phase 6 (US6: glob)
                                                                          │
                                                            All ─────────→ Phase 7 (Validation)
```

- **Phase 1 (US1)**: No dependencies — start immediately
- **Phase 2 (US2)**: Depends on Phase 1 (clean main with merged PRs)
- **Phase 3 (US3)**: Depends on Phase 2 (stable lockfiles before CI changes)
- **Phases 4, 5, 6 (US4, US5, US6)**: Depend on Phase 3 (clean baseline). Independent of each other — can run in parallel.
- **Phase 7**: Depends on all previous phases

### Parallel Opportunities

- **Phases 4 + 5 + 6** can run in parallel (different files, different ecosystems):
  - US4 (ruff): Python config + source files
  - US5 (Playwright): extension/package.json + browser tests
  - US6 (glob): extension/package.json + test infrastructure
  - **Conflict note**: US5 and US6 both modify `extension/package.json` — if run in parallel, coordinate the merge or combine into one commit

### Within Each Phase

- Tasks within a phase are sequential (each step depends on the prior step's validation)
- T002 + T003 can be done in one commit (serve pin + version guard must be coordinated per D-005)
- T015 + T016 must be in one commit (ruff + pre-commit lockstep per FR-003)

---

## Implementation Strategy

### MVP First (Phases 1-2 Only)

1. Complete Phase 1: Merge safe Dependabot PRs
2. Complete Phase 2: Refresh lockfiles
3. **STOP and VALIDATE**: All P1 work done, CI green, immediate security exposure reduced
4. Remaining phases can be scheduled in separate sessions

### Incremental Delivery

1. Phases 1 + 2 → P1 complete (3 PRs merged, lockfiles refreshed)
2. Phase 3 → P2 complete (CI caching upgraded)
3. Phases 4, 5, 6 → P3 complete (breaking migrations done)
4. Phase 7 → Full validation

### Separate Session Strategy (per quickstart.md)

- Phases 1-3: Single session (~45 minutes, mostly CI wait time)
- Phase 4: Dedicated ruff session (~1 hour)
- Phase 5: Dedicated Playwright session (~30 minutes)
- Phase 6: Dedicated glob session (~45 minutes)
- Phase 7: Final validation (~15 minutes)

---

## Notes

- All Dependabot PRs (#141, #142, #144, #145, #146, #147, #148) have been closed — all changes are applied manually
- T001 + T002 + T003 + T004 can be a single commit (all safe patch updates together)
- T015 + T016 must be a single commit (FR-003: ruff + pre-commit lockstep)
- T024 must be a single atomic commit (all ruff reformat changes together)
- US5 and US6 both touch `extension/package.json` — if done in parallel, resolve merge conflict
- Tasks T028 and T037 are conditional — only needed if tests fail after upgrade
- All phases must pass FR-008 (full CI pipeline) before proceeding to next phase
