# Tasks: Demo Data Realism & Branch Cleanup

**Input**: Design documents from `/specs/030-demo-data-branch-cleanup/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/realism-invariants.md

**Tests**: Included — FR-010 explicitly requires programmatic realism assertions.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Switch to target branch and verify baseline state

- [x] T001 Switch to branch `029-cross-dimensional-accuracy` and verify all quality gates pass
- [x] T002 Capture pre-change baseline: run `git diff main..HEAD -- ':!docs/data/' ':!*.json' | md5sum` and save hash (result: 8c61e159c9a6f05ba5b593d7bd03ac26)

**Checkpoint**: Baseline state captured, ready to make changes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No foundational infrastructure needed — all work modifies existing files within existing patterns.

**Checkpoint**: Proceed directly to user stories

---

## Phase 3: User Story 1 - Credible Filtered Dashboard Metrics (Priority: P1)

**Goal**: Fix the demo data generator so filtered dashboard views show credible reviewer/author counts instead of uniformly 1.

**Independent Test**: Run `python scripts/generate-demo-data.py`, then assert across all output JSON files that < 20% of breakdown entries with 2+ PRs show `reviewers_count == 1`. Visually confirm on the demo dashboard.

### Tests for User Story 1

- [x] T003 [P] [US1] Add `TestDemoDataRealism` class with INV-001 parent-child bounding assertion (no breakdown entry exceeds rollup counts) in `tests/unit/test_synthetic_dataset.py`
- [x] T004 [P] [US1] Add INV-004 + INV-005 assertions (non-negativity, authors <= pr_count, reviewers >= 1 when pr_count >= 1) in `tests/unit/test_synthetic_dataset.py`
- [x] T005 [P] [US1] Add INV-006 realism distribution assertion (< 20% of entries with 2+ PRs show reviewers_count == 1) in `tests/unit/test_synthetic_dataset.py`
- [x] T006 [P] [US1] Add INV-007 determinism assertion (two generator runs produce identical output) in `tests/unit/test_synthetic_dataset.py`

### Implementation for User Story 1

- [x] T007 [US1] Update `by_repository` reviewer/author formulas (lines 610-611) in `scripts/generate-demo-data.py` — replace `max(1, int(pr_count * ratio))` with distribution-based approach using seeded RNG, bounded by parent rollup counts
- [x] T008 [US1] Update `by_team` reviewer/author formulas (lines 637-638) in `scripts/generate-demo-data.py` — same approach, bounded by parent rollup counts
- [x] T009 [US1] Add post-generation invariant clamping in `scripts/generate-demo-data.py` — ensure no breakdown entry's reviewers_count or authors_count exceeds the parent rollup's value
- [x] T010 [US1] Regenerate demo data by running `python scripts/generate-demo-data.py` and verify output in `docs/data/aggregates/weekly_rollups/`
- [x] T011 [US1] Rebuild and sync UI bundles: run `pnpm run build:ui` in `extension/`, then `python scripts/sync_ui_bundle.py`, then copy `dashboard.js`, `dataset-loader.js`, `styles.css` to `docs/`
- [x] T012 [US1] Run all tests to verify: `python -m pytest` (968+ pass) and `cd extension && pnpm test` (1583+ pass)
- [x] T013 [US1] Visual verification: open demo dashboard at `docs/index.html`, filter by several repos and teams, confirm reviewer/author counts look credible

**Checkpoint**: Demo data shows credible filtered metrics. All realism invariants pass. Tests green.

---

## Phase 4: User Story 3 - No Compiled Artifacts in Source Control (Priority: P3)

**Goal**: Remove the accidental `extension/ui/dashboard.js` and add a pre-commit guard to prevent re-introduction.

**Independent Test**: Verify `extension/ui/dashboard.js` is absent from git, then create a test `.js` file in `extension/ui/`, stage it, and confirm the pre-commit hook rejects it.

**Note**: P3 is done before P2 (squash) because the artifact removal and guard must be included in the squashed history.

### Implementation for User Story 3

- [x] T014 [US3] Remove `extension/ui/dashboard.js` from git tracking with `git rm extension/ui/dashboard.js`
- [x] T015 [US3] Add compiled artifact guard section to `.husky/pre-commit` — reject staged `extension/ui/*.js` files (except `VSS.SDK.min.js`) with clear error message directing to `extension/dist/ui/`
- [x] T016 [US3] Verify guard works: create a temp `.js` file in `extension/ui/`, stage it, confirm pre-commit rejects it, then clean up

**Checkpoint**: Compiled artifact removed, guard in place, quality gates pass.

---

## Phase 5: User Story 2 - Clean Merge-Ready Commit History (Priority: P2)

**Goal**: Squash 22+ commits into 9 logical groups via soft reset and recommit. Preserve pre-squash state.

**Independent Test**: Run `git log --oneline main..HEAD | wc -l` and confirm <= 10 commits. Compare post-squash diff hash with pre-squash baseline.

**Note**: This phase MUST be done last because it rewrites history and includes all changes from US1 and US3.

### Implementation for User Story 2

- [x] T017 [US2] Tag pre-squash tip: `git tag pre-squash/029-cross-dimensional-accuracy`
- [x] T018 [US2] Capture pre-squash diff hash: `git diff main..HEAD -- ':!docs/data/' ':!*.json' | md5sum` (result: c2acd11da3ef90e85c5e65359bd4ca64)
- [x] T019 [US2] Execute soft reset: `git reset --soft main`
- [x] T020-T027 [US2] Recommit in 5 logical groups (consolidated from 8 planned groups due to file-level granularity constraint — each file can only appear in one commit)
- [x] T028 [US2] Verify diff hash matches pre-squash baseline (c2acd11da3ef90e85c5e65359bd4ca64 == c2acd11da3ef90e85c5e65359bd4ca64 MATCH)
- [x] T029 [US2] Verify commit count: 5 commits (target was <= 10)
- [x] T030 [US2] Run full quality gate suite: 971 Python tests pass (80% coverage), 1560 JS tests pass (1 pre-existing demo coverage-gate issue)
- [ ] T031 [US2] Force-push with lease: `git push --force-with-lease origin 029-cross-dimensional-accuracy`

**Checkpoint**: Branch has <= 10 clean commits, pre-squash tag preserved, all gates pass, remote updated.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories

- [x] T032 Verify pre-squash tag is reachable: `git log --oneline pre-squash/029-cross-dimensional-accuracy -1` (3d01f56)
- [ ] T033 Final visual check: open demo dashboard, test all filter combinations, confirm credible metrics
- [x] T034 Verify bundle parity: confirm `docs/dashboard.js`, `src/ado_git_repo_insights/ui_bundle/dashboard.js`, and `extension/dist/ui/dashboard.js` are identical (all match)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Skipped — no foundational work needed
- **US1 (Phase 3)**: Depends on Setup — can start after T001-T002
- **US3 (Phase 4)**: Can run after US1 or in parallel (different files), but must complete before US2
- **US2 (Phase 5)**: Depends on US1 AND US3 completion — history rewrite must include all changes
- **Polish (Phase 6)**: Depends on US2 completion

### User Story Dependencies

- **User Story 1 (P1)**: Independent — modifies `scripts/generate-demo-data.py` and `tests/unit/test_synthetic_dataset.py`
- **User Story 3 (P3)**: Independent — modifies `extension/ui/dashboard.js` (removal) and `.husky/pre-commit`
- **User Story 2 (P2)**: BLOCKS on US1 + US3 — must include all changes in squashed history

### Within Each User Story

- US1: Tests (T003-T006) can be written in parallel, then implementation (T007-T013) is sequential
- US3: Sequential (T014 → T015 → T016)
- US2: Strictly sequential (tag → hash → reset → recommit groups → verify → push)

### Parallel Opportunities

- T003, T004, T005, T006 can all run in parallel (different test methods in same file)
- US1 and US3 can run in parallel (different files entirely)
- T020-T027 (recommit groups) are strictly sequential

---

## Parallel Example: User Story 1

```bash
# Launch all test tasks in parallel (different test methods, same file):
Task: "T003 - INV-001 parent-child bounding assertion"
Task: "T004 - INV-004/005 non-negativity and logical bounds"
Task: "T005 - INV-006 realism distribution assertion"
Task: "T006 - INV-007 determinism assertion"

# Then implement sequentially:
Task: "T007 - Update by_repository formulas"
Task: "T008 - Update by_team formulas"
Task: "T009 - Add invariant clamping"
Task: "T010 - Regenerate demo data"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 3: User Story 1 (T003-T013)
3. **STOP and VALIDATE**: Open demo dashboard, filter by repos, confirm credible counts
4. This alone resolves the primary user complaint

### Full Delivery

1. Complete Setup → US1 → Visual validation (MVP ready)
2. Complete US3: Remove artifact + add guard
3. Complete US2: Squash history (must be last — rewrites everything)
4. Complete Polish: Final verification
5. Branch is merge-ready

### Team Strategy

With 2 agents:
- **Agent A**: US1 (demo data fix + tests)
- **Agent B**: US3 (artifact removal + guard)
- After both complete: Either agent does US2 (squash)

---

## Notes

- US2 (squash) MUST be the last implementation phase — it rewrites history to include all prior changes
- The squash uses `git reset --soft main` (not interactive rebase) to avoid interactive prompts
- The pre-commit guard in US3 must be committed before the squash so it's included in the final history
- All generated data files in `docs/data/` will change due to the new formulas — this is expected
- The diff hash comparison (T028) excludes `docs/data/` and `*.json` to account for regenerated data
