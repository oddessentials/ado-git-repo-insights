# Tasks: Cross-Dimensional Filter Accuracy

**Input**: Design documents from `/specs/029-cross-dimensional-accuracy/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — the plan explicitly defines test phases (B and G) with specific test requirements.

**Organization**: Tasks are grouped by user story. US1 (Accurate Team+Repo Metrics) is the MVP. US2 (Graceful Fallback) builds on US1. US3 (Author-Repo) is deferred pending Author Contributor Filters.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Branch verification

- [ ] T001 Verify branch `029-cross-dimensional-accuracy` is checked out and working tree is clean

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema and type changes needed by ALL user stories

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 Bump `AGGREGATES_SCHEMA_VERSION` from 1 to 2 at line 34 of `src/ado_git_repo_insights/transform/aggregators.py`
- [ ] T003 [P] Update `extension/ui/schemas/rollup.schema.ts`: add `by_team_and_repo?: Record<string, Record<string, BreakdownEntry>>` to `WeeklyRollup` interface (~line 63), add `"by_team_and_repo"` to `KNOWN_ROOT_FIELDS` set (~line 82), add nested breakdown validation in `validateRollup()` (outer dict -> inner dict -> BreakdownEntry), and update `normalizeRollup()` (~line 303) to explicitly pass through `by_team_and_repo` field. Also check `extension/ui/dataset-loader.ts` — if the `Rollup` interface has an explicit field list (beyond the `[key: string]: unknown` index signature), add `by_team_and_repo` there as well to prevent data loss during loading

**Checkpoint**: Schema version bumped, frontend types ready — user story implementation can begin

---

## Phase 3: User Story 1 — Accurate Team+Repository Metrics (Priority: P1) MVP

**Goal**: When a user selects both a team and a repository filter, the dashboard displays exact PR metrics for that intersection instead of a proportional estimate.

**Independent Test**: Select a team and repository filter simultaneously. Compare displayed PR count against known exact values from underlying PR data — must match 100%.

### Backend Implementation

- [ ] T004 [US1] Implement `_generate_team_repo_slice()` method after `_generate_team_slice()` (~line 690) in `src/ado_git_repo_insights/transform/aggregators.py` — join week PRs against `team_members_df` to tag each PR with team name(s), then groupby `(team_name, repository_name)` in a single pass; compute pr_count, cycle_time_p50/p90, authors_count, reviewers_count per group; return sparse nested dict `{team_name: {repo_name: BreakdownEntry}}`; set `cycle_time_p50` and `cycle_time_p90` to `None` for intersections with fewer than 5 PRs; skip entries where `pr_count == 0`; when total entries exceed 5,000, truncate least-significant by pr_count and set `_truncated` flag
- [ ] T005 [US1] Wire `_generate_team_repo_slice()` into `_generate_weekly_rollups()` (~line 544) in `src/ado_git_repo_insights/transform/aggregators.py` — call after `_generate_team_slice()`, add `by_team_and_repo` to `rollup_dict` when non-empty; add pr_count consistency assertion `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count` for each team (this invariant applies ONLY to pr_count, not authors_count/reviewers_count); track a boolean `any_rollup_has_cross_dim` during generation and set `features.cross_dimensional` from actual output (~line 284), not from input conditions

### Backend Tests

- [ ] T006 [US1] Add `TestTeamRepoSlicing` class in `tests/unit/test_aggregators.py` with fixture `db_with_team_repo_correlation` (Team Alpha -> 90% Repo-Backend, 10% Repo-Frontend; Team Beta -> inverse): test exact intersection values match known PR counts, test sparse output (empty intersections excluded), test pr_count consistency invariant holds, test `authors_count` sum across repos >= team authors_count (non-additive), test teamless authors excluded from cross-dim entries, test multi-team authors appear in both teams' entries, test minimum sample size (intersections with <5 PRs have null cycle time percentiles), test `AGGREGATES_SCHEMA_VERSION == 2`, test `features.cross_dimensional` is true when data present and false when teams exist but have no members
- [ ] T007 [US1] Add truncation behavior test in `tests/unit/test_aggregators.py` — create synthetic dataset exceeding 5,000 cross-dim entries per week, verify truncation removes lowest-pr_count entries, verify `_truncated` flag is set on the rollup, verify consistency invariant is relaxed (sum < team total) for affected teams
- [ ] T008 [US1] Add performance gate test in `tests/unit/test_aggregators.py` — generate stress dataset (50 teams x 100 repos x 260 weeks), run `_generate_team_repo_slice()` pipeline, assert total overhead < 30 seconds (SC-007), fail the test if exceeded

### Synthetic Data Generator

- [ ] T009 [P] [US1] Add `by_team_and_repo` generation with correlated team-repo distributions after `by_team` block (~line 182) in `scripts/generate-synthetic-dataset.py` — use correlated weights (e.g., Alpha -> 80% Backend / 15% Frontend / 5% Shared; Beta -> inverse), ensure per-team-repo pr_count entries sum to team totals, set null cycle times for intersections with <5 PRs, include cycle time variation per intersection
- [ ] T010 [P] [US1] Validate synthetic cross-dim data in `tests/unit/test_synthetic_dataset.py` — assert `by_team_and_repo` present in generated rollups, validate pr_count consistency invariant holds, verify correlated distributions produce non-trivial proportional estimation error (proportional estimate differs from exact by >20% for at least one team-repo pair)

### Frontend Implementation

- [ ] T011 [US1] Add cross-dimensional exact lookup in `applyFiltersToRollups()` (~line 319) in `extension/ui/modules/metrics.ts` — insert before the existing proportional fallback block: if both team and repo filters active and `rollup.by_team_and_repo` exists, iterate selected teams x repos to collect entries from `by_team_and_repo[team][repo]`, aggregate via `aggregateEntries()`, return via `buildFilteredRollup()`; if all lookups miss, return `{ ...rollup, ...ZEROED_ROLLUP_FIELDS }`; existing proportional block (lines 324-364) remains untouched as fallback
- [ ] T012 [US1] Add accuracy indicator in `extension/ui/dashboard.ts` — when both team and repo filters are active, check each rendered rollup for `by_team_and_repo` presence; if any rollup in the visible range lacks it, show a muted info icon with tooltip "Some weeks use approximate data (pre-migration)" next to metric cards; only visible when mixed exact/estimated data is present
- [ ] T012a [US1] Add multi-team overlap indicator in `extension/ui/dashboard.ts` — when multiple teams are selected and cross-dim aggregation produces a PR count sum exceeding the repository total (`sum(by_team_and_repo[*][repo]) > by_repository[repo].pr_count`), show a tooltip or footnote explaining that multi-team membership causes intentional duplication in team-level counts (FR-016)

### Frontend Tests

- [ ] T013 [P] [US1] Add cross-dim filter resolution tests in `extension/tests/modules/metrics.test.ts` — test exact cross-dim lookup returns correct values when `by_team_and_repo` present, test zeroed result when selected team has no entries in selected repo
- [ ] T014 [P] [US1] Add multi-team overlap and edge case tests in `extension/tests/modules/metrics.edge-cases.test.ts` — test sum across teams exceeds repo total with overlapping members, test all-teams + all-repos equals global total, test single team + single repo returns exact lookup value, test aggregated `authors_count` is upper bound (sum >= individual team total)
- [ ] T015 [P] [US1] Add v2 rollup validation and normalizeRollup tests in `extension/tests/schema/rollup.test.ts` — test v2 rollup with `by_team_and_repo` validates successfully, test nested structure validation catches malformed entries, test unknown fields in nested breakdown produce warnings (permissive mode), test `normalizeRollup()` preserves `by_team_and_repo` field in output (gated test for silent stripping risk)

### Cross-Stack Validation

- [ ] T016 [US1] Add cross-stack round-trip test in `extension/tests/python-integration/synthetic-fixtures.test.ts` — load a Python-generated fixture containing `by_team_and_repo`, run through `applyFiltersToRollups()` with team + repo filters, assert result matches known exact values from the fixture data, validating the full Python -> JSON -> TypeScript -> exact result pipeline

**Checkpoint**: Team+Repo filter shows exact metrics. Proportional fallback still works for legacy data. This is the MVP.

---

## Phase 4: User Story 2 — Graceful Fallback for Legacy Data (Priority: P2)

**Goal**: Datasets without cross-dimensional fields continue to work identically to current behavior. Mixed date ranges (some weeks exact, some proportional) blend seamlessly with a visible accuracy indicator.

**Independent Test**: Load a v1 dataset (no `by_team_and_repo`), apply team + repo filters, verify proportional estimates display without errors. Load a mixed dataset, verify trend lines show both exact and estimated weeks with per-week indicator.

### Implementation

- [ ] T017 [US2] Verify and document that the proportional fallback path in `applyFiltersToRollups()` (lines 324-364) in `extension/ui/modules/metrics.ts` remains untouched and correctly handles the `by_team_and_repo`-absent case — no code changes expected; this task validates the fallback contract from `contracts/filter-resolution.md` by running the existing proportional code path against v1 rollup data

### Tests

- [ ] T018 [P] [US2] Add legacy rollup fallback tests in `extension/tests/modules/metrics.test.ts` — test proportional fallback when `by_team_and_repo` absent produces same results as current behavior, test v1 rollup (no cross-dim fields) loads and validates without errors
- [ ] T019 [P] [US2] Add mixed-week blend tests in `extension/tests/modules/metrics.test.ts` — test date range spanning weeks with and without `by_team_and_repo` produces seamless time series (exact weeks use lookup, estimated weeks use proportional), verify per-week accuracy can be derived from field presence (`by_team_and_repo !== undefined`)

**Checkpoint**: All existing datasets work unchanged. Mixed exact/estimated weeks display correctly with accuracy indicator.

---

## Phase 5: User Story 3 — Author-Repository Intersection Accuracy (Priority: P3) DEFERRED

**Goal**: Exact metrics for author-repository intersections (similar to team-repo but keyed by author).

**Status**: BLOCKED — depends on Author Contributor Filters feature (0% complete per TODO/AUTHOR_CONTRIBUTOR_FILTERS.md). Do not implement until dependency is met.

**Independent Test**: Once author filters are available, select an author + repository and verify exact intersection metrics.

### Placeholder Tasks (not implementable until dependency is met)

- [ ] T020 [US3] Implement `_generate_author_repo_slice()` in `src/ado_git_repo_insights/transform/aggregators.py` — blocked on Author Contributor Filters feature
- [ ] T021 [US3] Add `by_author_and_repo` to frontend types and filter resolution in `extension/ui/schemas/rollup.schema.ts` and `extension/ui/modules/metrics.ts` — blocked on T020

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, contract updates, and final validation

- [ ] T022 [P] Add v2 rollup schema with `by_team_and_repo` field, document schema version bump (v1 -> v2), consumer compatibility matrix, and `features.cross_dimensional` manifest flag in `docs/reference/dataset-contract.md`
- [ ] T023 Run quickstart.md testing checklist (15 items) at `specs/029-cross-dimensional-accuracy/quickstart.md` and verify all pass — include QG-28 validation (dashboard renders 156 weeks in < 1000ms with cross-dim data)
- [ ] T024 Final code review: verify no regressions in existing single-filter behavior across `extension/ui/modules/metrics.ts` and `src/ado_git_repo_insights/transform/aggregators.py`
- [ ] T025 [P] Validate SC-002 (dashboard load time): measure dashboard load with and without cross-dim data using the stress dataset; assert increase is less than 10% — can be a manual timing test or automated via Playwright
- [ ] T026 [P] Validate SC-004 (file size increase): generate rollups for a typical org (20 teams, 30 repos) with and without cross-dim data; assert file size increase is ≤15%

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — MVP target
  - Backend tasks (T004-T010) and Frontend tasks (T011-T016) can run in parallel after Phase 2
  - Within backend: T004 -> T005 -> T006, T007, T008 (tests after implementation); T009, T010 parallel with tests
  - Within frontend: T011 -> T012 -> T012a; then T013, T014, T015 (tests in parallel); then T016 (needs backend fixtures)
- **US2 (Phase 4)**: Depends on Phase 3 (specifically T011 for the cross-dim-aware code path)
- **US3 (Phase 5)**: BLOCKED on external dependency (Author Contributor Filters)
- **Polish (Phase 6)**: Depends on Phase 3 + Phase 4 completion

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Foundational (Phase 2) — no other story dependencies
- **User Story 2 (P2)**: Depends on US1 implementation (fallback tested against cross-dim-aware code)
- **User Story 3 (P3)**: BLOCKED on external feature — defer entirely

### Parallel Opportunities

Backend (Python) and Frontend (TypeScript) streams are independent after Phase 2:

```
Phase 2 complete (T002, T003)
  |
  +-- Backend stream:
  |     T004 -> T005 -> T006, T007, T008 (parallel tests)
  |                      T009, T010 (parallel synthetic)
  |
  +-- Frontend stream:
        T011 -> T012
                 T013, T014, T015 (parallel tests)
                       T016 (cross-stack, needs T009 complete)
```

---

## Parallel Example: User Story 1

```
# Backend + Frontend can run in parallel after Phase 2:

# Backend stream (Python):
Task T004: Implement _generate_team_repo_slice() in aggregators.py
Task T005: Wire into _generate_weekly_rollups() in aggregators.py  (after T004)
# Then in parallel:
Task T006: Backend unit tests in test_aggregators.py
Task T007: Truncation test in test_aggregators.py
Task T008: Performance gate test in test_aggregators.py
Task T009: Synthetic generator in generate-synthetic-dataset.py  (parallel with tests)
Task T010: Synthetic validation in test_synthetic_dataset.py

# Frontend stream (TypeScript) — starts after Phase 2, not after backend:
Task T011: Cross-dim lookup in metrics.ts
Task T012: Accuracy indicator in dashboard.ts  (after T011)
Task T012a: Multi-team overlap indicator in dashboard.ts  (after T012)
# Then in parallel:
Task T013: Filter resolution tests in metrics.test.ts
Task T014: Edge case tests in metrics.edge-cases.test.ts
Task T015: Rollup validation tests in rollup.test.ts
# Then:
Task T016: Cross-stack round-trip in synthetic-fixtures.test.ts  (needs T009 done)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (schema bump + frontend types)
3. Complete Phase 3: User Story 1 (backend + frontend + tests)
4. **STOP and VALIDATE**: Run quickstart.md checklist items 1-13
5. Deploy — exact team+repo metrics are now live

### Incremental Delivery

1. Setup + Foundational -> types and schema ready
2. User Story 1 -> exact cross-dim metrics live (MVP!)
3. User Story 2 -> legacy fallback validated and tested
4. Polish -> documentation and final validation
5. User Story 3 -> deferred until Author Contributor Filters complete

### Dual-Stack Parallel Strategy

With backend and frontend developers:

1. Both complete Phase 2 (each handles their stack's foundational task)
2. Backend dev: T004 -> T005 -> T006-T010
3. Frontend dev: T011 -> T012 -> T013-T015
4. Sync point: T016 (cross-stack test needs both backend fixtures and frontend code)
5. Both handle Phase 4 (US2) and Phase 6 (Polish)

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in same phase
- [Story] label maps task to specific user story for traceability
- Tests are INCLUDED because the plan explicitly defines test phases (B and G)
- US3 (Author-Repo) is entirely deferred — do not implement placeholder tasks until unblocked
- The groupby algorithm decision (R-03) is critical for meeting the 30s performance budget
- The `normalizeRollup()` pass-through (T003) is the highest-risk silent failure point
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
