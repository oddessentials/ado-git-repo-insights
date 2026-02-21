# Tasks: Realistic Demo Data

**Input**: Design documents from `/specs/031-realistic-demo-data/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add utility functions and update constants needed by all user stories

- [ ] T001 Add locked RNG functions `_box_muller_normal(rng)` and `_log_normal(rng, mu, sigma)` using Box-Muller transform (research.md Decision 1), replace all `RNG.lognormvariate()` calls, and remove the `lognormal()` wrapper in scripts/generate-demo-data.py
- [ ] T002 Add `_largest_remainder_allocate(total, weights)` utility function (port from scripts/generate-synthetic-dataset.py lines 32-45) in scripts/generate-demo-data.py. Add guards: (a) if `weights` is empty, return `[]`; (b) if all weights are zero, distribute round-robin (`total` split evenly with remainder to first buckets); (c) assert `total >= 0`. Weights are assumed pre-normalized by callers — add a docstring stating this contract.
- [ ] T003 Update org shape constants: fix `NUM_REPOS=23` (currently 20), add `NUM_TEAMS=4`, `NUM_WEEKS=260`, `GROWTH_RATE_PER_YEAR=0.12`, `HOLIDAY_SUPPRESSION_FACTOR=0.35` as named constants co-located with existing config block (Contract 5, FR-017) in scripts/generate-demo-data.py

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add configuration constants and import schema version — MUST complete before user stories

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Add per-repo power-law weight constants as a `REPO_WEIGHTS` dict mapping each of the 23 repo names to a fixed float weight (top 3 repos sum to >= 40% of total weight per data-model.md) in scripts/generate-demo-data.py
- [ ] T005 Add `TEAM_PRIMARY_REPOS` affinity matrix dict mapping each of the 4 team names to their 3 primary repo names (per data-model.md) in scripts/generate-demo-data.py
- [ ] T006 Add `REPO_CYCLE_TIME_CATEGORY` dict mapping each repo name to a mu_factor float (utility=0.5, frontend=0.8, backend=1.0, data_ml=1.3 per research.md Decision 5) in scripts/generate-demo-data.py
- [ ] T007 Add sys.path manipulation (matching scripts/generate-synthetic-dataset.py lines 19-21) and import `AGGREGATES_SCHEMA_VERSION` from `src/ado_git_repo_insights/transform/aggregators.py` in scripts/generate-demo-data.py

**Checkpoint**: Foundation ready — all constants and utilities in place

---

## Phase 3: User Story 1 — Complete Cross-Dimensional Demo Data (Priority: P1)

**Goal**: Every weekly rollup contains `by_team_and_repo` with non-null cross-dimensional breakdowns satisfying Contract 4 completeness and sum-equality invariants

**Independent Test**: Load every rollup file, assert `by_team_and_repo` exists with valid team→repo→BreakdownEntry structure, verify `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count` for every team in every week

### Implementation for User Story 1

- [ ] T008 [US1] Rewrite the repo PR distribution in `generate_weekly_rollups()` to use `_largest_remainder_allocate()` with `REPO_WEIGHTS` instead of sequential `RNG.randint()` allocation, producing a `repo_pr_allocation` dict (repo_name → pr_count) in scripts/generate-demo-data.py
- [ ] T009 [US1] First, add `by_team_and_repo: dict[str, dict[str, Any]] | None = None` field to the `WeeklyRollup` dataclass (lines 203-215). Then rewrite the team PR distribution in `generate_weekly_rollups()` to use `_largest_remainder_allocate()` with RNG-generated normalized weights, and for each team generate `by_team_and_repo[team]` entries by distributing team PRs across repos using affinity-weighted allocation (65% to `TEAM_PRIMARY_REPOS`, 35% to remaining repos weighted by `REPO_WEIGHTS`) via `_largest_remainder_allocate()`. Store the result in `rollup.by_team_and_repo`. Omit teams with 0 PRs and repos with 0 PRs for a team (sparse representation per spec edge cases) in scripts/generate-demo-data.py
- [ ] T010 [US1] Enforce Contract 3 cycle time threshold at all 4 levels (rollup, repo, team, team-repo): if `pr_count < 5` set both `cycle_time_p50` and `cycle_time_p90` to `None`; remove any existing `max(1, ...)` special-case logic in scripts/generate-demo-data.py
- [ ] T011 [US1] Enforce FR-016 author/reviewer count caps: at team level cap to `team.member_count`, at team-repo level cap to the parent team-level counts; use sub-linear scaling `max(1, min(cap, int(pr_count ** 0.6)))` for author/reviewer generation in scripts/generate-demo-data.py
- [ ] T012 [US1] Update rollup JSON output serialization (lines 924-935) to include `"by_team_and_repo": rollup.by_team_and_repo` in the dict written to file (the dataclass field was added in T009) in scripts/generate-demo-data.py
- [ ] T013 [US1] Update `generate_manifest()` to set `"aggregates_schema_version": AGGREGATES_SCHEMA_VERSION` (imported value = 2) and add `"cross_dimensional": True` to `features` dict in scripts/generate-demo-data.py

### Tests for User Story 1

- [ ] T014 [P] [US1] Write `tests/demo/test_cross_dim.py` with tests: (a) every rollup has non-null `by_team_and_repo` with >= 1 team entry (SC-001), (b) for every team, sum of repo pr_counts equals `by_team[team].pr_count` (Contract 4), (c) every team in `by_team` with pr_count >= 1 exists in `by_team_and_repo` with entries for all repos where team had >= 1 PR (Contract 4), (d) no breakdown entry at any level with pr_count < 5 has non-null cycle times (SC-010 / Contract 3), (e) team-repo author/reviewer counts <= parent team-level counts (FR-016)

**Checkpoint**: Cross-dimensional data complete — accuracy indicator will never trigger for any team+repo filter combination

---

## Phase 4: User Story 2 — Realistic Data Distributions (Priority: P2)

**Goal**: Demo data shows power-law repo activity, year-over-year growth, holiday dips, team affinity, and cycle time variation — not uniform synthetic noise

**Independent Test**: Generate data and verify: top-3 repos >= 40% of PRs, final year >= 1.3x first year, week 52 <= 60% of year avg, >= 20% idle repo-weeks, >= 60% team affinity, utility repos >= 2x faster than data/ML repos

### Implementation for User Story 2

- [ ] T015 [US2] Apply `GROWTH_RATE_PER_YEAR` linear growth factor to `BASE_PR_COUNT` per year: `effective_base = BASE_PR_COUNT * (1.0 + GROWTH_RATE_PER_YEAR * (year - START_YEAR))` before seasonal adjustment in `generate_weekly_rollups()` in scripts/generate-demo-data.py
- [ ] T016 [US2] Apply `HOLIDAY_SUPPRESSION_FACTOR` multiplier for week 52: override the seasonal adjustment to `* HOLIDAY_SUPPRESSION_FACTOR` when `week == 52` in `generate_weekly_rollups()` in scripts/generate-demo-data.py
- [ ] T017 [US2] Add idle repo-week logic with constant `IDLE_WEIGHT_THRESHOLD = 0.04`: after `_largest_remainder_allocate()` for repo PRs, for each repo with `REPO_WEIGHTS[repo] < IDLE_WEIGHT_THRESHOLD`, zero out its allocation if `RNG.random() > REPO_WEIGHTS[repo] / IDLE_WEIGHT_THRESHOLD` (probability of idling increases as weight decreases). Redistribute all zeroed PRs to the repo with the highest weight to maintain `sum(repo_prs) == total_prs`. Add `IDLE_WEIGHT_THRESHOLD` as a named constant co-located with other repo weight constants (Contract 5) in scripts/generate-demo-data.py
- [ ] T018 [US2] Apply `REPO_CYCLE_TIME_CATEGORY` mu_factor per repo when generating `cycle_times`: use `_log_normal(RNG, CYCLE_TIME_MU * mu_factor, CYCLE_TIME_SIGMA)` instead of the global mu for each repo's cycle time samples in scripts/generate-demo-data.py

### Tests for User Story 2

- [ ] T019 [P] [US2] Write `tests/demo/test_realism_invariants.py` with tests: (a) top 3 repos >= 40% of total PRs across all weeks (SC-002), (b) final year PRs >= 1.3x first year PRs (SC-003), (c) week 52 PR count <= 60% of year average for every year (SC-008), (d) >= 20% of possible repo-weeks have 0 PRs (SC-004), (e) >= 60% of each team's PRs land in its TEAM_PRIMARY_REPOS (SC-009), (f) utility repo median cycle time <= 0.5x data/ML repo median cycle time (FR-008)

**Checkpoint**: Data looks like a real engineering org — not synthetic toy data

---

## Phase 4b: Baseline Regeneration (REQUIRED before tests can pass)

**Purpose**: After all generator changes (T001–T018), the committed demo data files are stale (generated with the old `lognormvariate` RNG and missing `by_team_and_repo`). Tests in `test_regeneration.py` compare against committed files and will fail until data is regenerated. This phase establishes the new baseline.

- [ ] T019b Regenerate all demo data by running all three generators in order: `python scripts/generate-demo-data.py && python scripts/generate-demo-predictions.py && python scripts/generate-demo-insights.py` from repository root, then `git add docs/data/ && git commit` the regenerated files to establish the new baseline in docs/data/

**Checkpoint**: Committed demo data matches generator output — `test_regeneration.py` passes again

---

## Phase 5: User Story 3 — Schema Completeness Guard (Priority: P3)

**Goal**: A new field added to the canonical schema without updating the generator causes a test failure naming the missing field

**Independent Test**: Add a dummy field to `KNOWN_ROOT_FIELDS` in `rollup.schema.ts`, run the guard test, confirm it fails naming the missing field. Remove dummy field afterward.

### Implementation for User Story 3

- [ ] T020 [P] [US3] Write `tests/demo/test_schema_guard.py` that: (a) reads `extension/ui/schemas/rollup.schema.ts` and extracts field names from `KNOWN_ROOT_FIELDS` and `KNOWN_BREAKDOWN_FIELDS` via regex (Contract 1 — no duplicate field list), (b) loads a sample generated rollup from `docs/data/aggregates/weekly_rollups/`, (c) asserts all non-deprecated root fields (excluding `review_time_p50`, `review_time_p90`) are present in the rollup, (d) asserts all non-deprecated breakdown fields are present in at least one `by_repository` entry, (e) asserts all non-deprecated breakdown fields are present in at least one `by_team_and_repo` nested entry, (f) on failure reports the specific missing field name (SC-005), (g) verifies `dataset-manifest.json` `aggregates_schema_version` matches `SUPPORTED_AGGREGATES_VERSION` from `dataset-loader.ts` via regex extraction

**Checkpoint**: Schema drift between generator and dashboard is caught at test time

---

## Phase 6: User Story 4 — Reliable Generation Pipeline (Priority: P4)

**Goal**: A single orchestrator command regenerates all demo data deterministically in dependency order

**Independent Test**: Run the orchestrator twice with same seed, compare all output files byte-for-byte

### Implementation for User Story 4

- [ ] T021 [P] [US4] Create `scripts/regenerate-demo.py` orchestrator that imports and calls `main()` from each of the 3 generators in dependency order (data → predictions → insights), exits non-zero on any generator failure, and prints step-by-step progress (FR-012, research.md Decision 8)
- [ ] T022 [P] [US4] Standardize file I/O in `scripts/generate-demo-predictions.py`: replace `path.write_text(content, encoding="utf-8", newline="\n")` (line 101) with `path.write_bytes(content.encode("utf-8"))` to match Contract 2 / FR-014 binary-mode requirement
- [ ] T023 [P] [US4] Standardize file I/O in `scripts/generate-demo-insights.py`: replace `path.write_text(content, encoding="utf-8", newline="\n")` (line 122) with `path.write_bytes(content.encode("utf-8"))` to match Contract 2 / FR-014 binary-mode requirement

**Checkpoint**: Single command regenerates all data deterministically

---

## Phase 7: Polish & Verification

**Purpose**: Regenerate all data, run full test suite, verify all success criteria

- [ ] T024 Regenerate all demo data by running `python scripts/regenerate-demo.py` from repository root
- [ ] T025 Run full Python test suite (`cd src && pytest`) and verify all 968+ tests pass (SC-007)
- [ ] T026 Run full JS test suite (`cd extension && pnpm test:unit`) and verify all 1560+ tests pass (SC-007)
- [ ] T027 Verify determinism: run `python scripts/regenerate-demo.py` a second time, confirm byte-identical output via `tests/demo/test_regeneration.py` (SC-006)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — produces `by_team_and_repo` in generator
- **US2 (Phase 4)**: Depends on US1 — refines distributions in the same functions US1 rewrites
- **Baseline Regen (Phase 4b)**: Depends on US1+US2 — regenerates and commits all demo data so tests pass
- **US3 (Phase 5)**: Depends on Phase 4b — schema guard loads regenerated rollups to verify fields
- **US4 (Phase 6)**: Depends on Foundational only — can run in parallel with US1/US2 (different files). Orchestrator (T021) can be written early; I/O changes (T022/T023) are independent.
- **Polish (Phase 7)**: Depends on ALL user stories + Phase 4b being complete

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2 — Core cross-dimensional generation
- **US2 (P2)**: Depends on US1 — Builds realistic distributions on top of US1's allocation framework
- **US3 (P3)**: Depends on Phase 4b — Schema guard loads regenerated data, must run after baseline commit
- **US4 (P4)**: Depends on Phase 2 only — Independent files (orchestrator, I/O changes)

### Within Each User Story

- Implementation tasks are sequential within US1 and US2 (same file: `generate-demo-data.py`)
- Test tasks ([P] marked) can run in parallel with implementation tasks (different files)
- US3 and US4 tasks are all [P] — can run in parallel with each other and with US1/US2 tests

### File Conflict Map

| File | Tasks | Constraint |
|------|-------|------------|
| `scripts/generate-demo-data.py` | T001–T018 | Sequential — all modify same file |
| `tests/demo/test_cross_dim.py` | T014 | Parallel — independent file |
| `tests/demo/test_realism_invariants.py` | T019 | Parallel — independent file |
| `tests/demo/test_schema_guard.py` | T020 | Parallel — independent file |
| `scripts/regenerate-demo.py` | T021 | Parallel — new file |
| `scripts/generate-demo-predictions.py` | T022 | Parallel — independent file |
| `scripts/generate-demo-insights.py` | T023 | Parallel — independent file |

---

## Parallel Opportunities

### Parallel Set A: Tests (after Phase 2)

```text
T014: Write test_cross_dim.py
T019: Write test_realism_invariants.py
T020: Write test_schema_guard.py
```

These three test files can be written in parallel with each other and in parallel with the generator implementation (T008–T018). Tests will initially fail until the generator changes are complete.

### Parallel Set B: Pipeline (after Phase 2)

```text
T021: Create regenerate-demo.py orchestrator
T022: Binary I/O in generate-demo-predictions.py
T023: Binary I/O in generate-demo-insights.py
```

These three tasks modify different files and can all run in parallel.

### Maximum Parallelism (3 agents after Phase 2)

```text
Agent 1: T008 → T009 → T010 → T011 → T012 → T013 → T015 → T016 → T017 → T018 → T019b (generator rewrite + regen)
Agent 2: T014, T019 (test files — will fail until T019b completes, then pass)
Agent 3: T021, T022, T023 (pipeline — independent files)
After T019b: T020 (schema guard — needs regenerated data)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T007)
3. Complete Phase 3: US1 (T008–T014)
4. **STOP and VALIDATE**: Run `test_cross_dim.py` — every rollup has `by_team_and_repo` passing all invariants
5. This alone fixes the demo dashboard accuracy indicator

### Incremental Delivery

1. Setup + Foundational → Utilities and constants ready
2. Add US1 → Cross-dimensional data works → Dashboard accuracy indicator eliminated (MVP!)
3. Add US2 → Data looks realistic → Demo is credible for sales
4. Add US3 → Schema guard catches future drift → Durability
5. Add US4 → Pipeline is automated → Maintenance-free
6. Polish → Full verification → Ship

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- T001–T018 all modify `scripts/generate-demo-data.py` — must execute sequentially
- T014, T019 are test files that can be written early but will FAIL until T019b regenerates data
- T020 (schema guard) must run AFTER T019b since it loads regenerated rollup files
- T021–T023 modify different files and can run in parallel
- The spec explicitly requests tests (each user story has "Independent Test" criteria)
- Existing tests (`test_regeneration.py`, `test_synthetic_data.py`) must continue to pass
- All 260+ weekly rollup JSON files plus predictions and insights will be regenerated — expect a large diff
- `demo.yml` uses Python 3.11 which is compatible (Box-Muller uses only `random()` which is stable across Python versions)

### Review Findings Applied (2026-02-21)

Reviewed by 3 agents (plan-reviewer, task-reviewer, devils-advocate). Fixes applied:
1. **BLOCKER**: Added T019b (Phase 4b) — intermediate regeneration + commit after generator rewrite. Without this, `test_regeneration.py` fails during development because committed files use old lognormvariate output.
2. **BLOCKER**: Merged `WeeklyRollup` dataclass field addition into T009 (was buried in T012). T009 now explicitly adds `by_team_and_repo` field to dataclass before generating data.
3. **MEDIUM**: Added edge case guards to T002 (`_largest_remainder_allocate`): empty weights, all-zero weights, non-negative total.
4. **MEDIUM**: T017 now has concrete constant `IDLE_WEIGHT_THRESHOLD = 0.04` and explicit probability formula instead of vague "e.g., 0.15".
5. **Cleared**: RNG cross-contamination (not a risk — predictions/insights don't use random), binary I/O change (byte-identical output), manifest `cross_dimensional` field (already in TS schema), git diff timeout (pytest hook is manual-only).
