# Tasks: Roadmap Closure Program

**Input**: Design documents from `/specs/034-roadmap-closure/`
**Prerequisites**: [plan.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/plan.md), [spec.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/spec.md), [research.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/research.md), [data-model.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/data-model.md), [quickstart.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/quickstart.md), [dataset-capabilities.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/contracts/dataset-capabilities.md), [roadmap-closure-evidence.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/contracts/roadmap-closure-evidence.md)

**Tests**: Tests are required by the feature specification and are included per user story.

**Organization**: Tasks are grouped by user story so each story remains independently implementable and testable once foundational work is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel on disjoint files after dependencies are satisfied
- **[Story]**: Maps to a user story from `spec.md` (`US1` through `US4`)
- Every task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare planning and evidence scaffolding used by all implementation slices

- [ ] T001 Create roadmap-closure evidence directory and README in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\evidence\README.md`
- [ ] T002 Create task execution checklist template for roadmap evidence in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\evidence\000-template-evidence.md`
- [ ] T003 Create comments auxiliary output documentation stub in `E:\projects\ado-git-repo-insights\docs\reference\dataset-contract.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-cutting capability, contract, and loader groundwork that all user stories depend on

**⚠️ CRITICAL**: No user story implementation should begin until this phase is complete

- [ ] T004 Update aggregate/schema version constants and additive capability plumbing in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\transform\schema_versions.py`
- [ ] T005 Update manifest capability and coverage validation rules per contract precedence in `E:\projects\ado-git-repo-insights\extension\ui\schemas\manifest.schema.ts`
- [ ] T006 Update dataset loader normalization to honor manifest-first capability precedence in `E:\projects\ado-git-repo-insights\extension\ui\dataset-loader.ts`
- [ ] T007 [P] Add manifest capability/version compatibility tests in `E:\projects\ado-git-repo-insights\extension\tests\schema\parity.test.ts`
- [ ] T008 [P] Add loader capability precedence and legacy fallback tests in `E:\projects\ado-git-repo-insights\extension\tests\version-adapter-integration.test.ts`
- [ ] T009 Add core CSV non-regression assertions for roadmap-closure protections in `E:\projects\ado-git-repo-insights\tests\unit\test_csv_contract.py`
- [ ] T010 Add auxiliary-output determinism harness hooks in `E:\projects\ado-git-repo-insights\tests\unit\test_csv_determinism.py`

**Checkpoint**: Foundation ready. User stories can begin.

---

## Phase 3: User Story 1 - Filter by PR Author (Priority: P1) 🎯 MVP

**Goal**: Deliver end-to-end author filtering with canonical `user_id` identity, loader-backed capability detection, and constrained author+team semantics.

**Independent Test**: Generate rollups with `by_author`, load them into the extension, select a single author, and verify metrics match the authored PR subset while legacy datasets still load safely.

### Tests for User Story 1

- [ ] T011 [P] [US1] Add backend author slice and identity stability tests in `E:\projects\ado-git-repo-insights\tests\unit\test_aggregators.py`
- [ ] T012 [P] [US1] Add author rollup schema validation tests in `E:\projects\ado-git-repo-insights\extension\tests\schema\rollup.test.ts`
- [ ] T013 [P] [US1] Add author filter state and constrained author+team metrics tests in `E:\projects\ado-git-repo-insights\extension\tests\modules\metrics.test.ts`
- [ ] T014 [P] [US1] Add author filter UI visibility and interaction tests in `E:\projects\ado-git-repo-insights\extension\tests\dashboard.test.ts`

### Implementation for User Story 1

- [ ] T015 [US1] Implement canonical `by_author` weekly rollup generation in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\transform\aggregators.py`
- [ ] T016 [US1] Extend dimensions generation with stable author labeling rules in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\transform\aggregators.py`
- [ ] T017 [US1] Add `by_author` support and capability-aware normalization in `E:\projects\ado-git-repo-insights\extension\ui\schemas\rollup.schema.ts`
- [ ] T018 [US1] Add author filter state serialization and constrained author+team behavior in `E:\projects\ado-git-repo-insights\extension\ui\modules\filters.ts`
- [ ] T019 [US1] Add author-aware metrics resolution in `E:\projects\ado-git-repo-insights\extension\ui\modules\metrics.ts`
- [ ] T020 [US1] Add author filter UI controls and dashboard wiring in `E:\projects\ado-git-repo-insights\extension\ui\index.html`
- [ ] T021 [US1] Populate author filter options and dashboard interactions in `E:\projects\ado-git-repo-insights\extension\ui\dashboard.ts`
- [ ] T022 [US1] Document author filter behavior and constrained author+team semantics in `E:\projects\ado-git-repo-insights\docs\user-guide\extension.md`

**Checkpoint**: User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - Exact Author x Repository Filtering (Priority: P1)

**Goal**: Deliver exact bounded author x repository metrics with deterministic truncation and explicit capability/truncation signaling.

**Independent Test**: Generate rollups with `by_author_and_repo`, select an author and repository, and verify the exact nested slice is used when available and safe fallback behavior remains for legacy datasets.

### Tests for User Story 2

- [ ] T023 [P] [US2] Add bounded author x repository invariant and truncation tests in `E:\projects\ado-git-repo-insights\tests\unit\test_aggregators.py`
- [ ] T024 [P] [US2] Add author x repository synthetic dataset coverage tests in `E:\projects\ado-git-repo-insights\tests\unit\test_synthetic_dataset.py`
- [ ] T025 [P] [US2] Add author x repository schema and normalization tests in `E:\projects\ado-git-repo-insights\extension\tests\schema\rollup.test.ts`
- [ ] T026 [P] [US2] Add exact author+repo metrics resolution and truncation-state tests in `E:\projects\ado-git-repo-insights\extension\tests\modules\metrics.test.ts`

### Implementation for User Story 2

- [ ] T027 [US2] Implement bounded `by_author_and_repo` generation with `pr_count DESC`, `author_id ASC`, `repository_name ASC` truncation in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\transform\aggregators.py`
- [ ] T028 [US2] Add capability/truncation metadata emission for exact author x repository support in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\transform\aggregators.py`
- [ ] T029 [US2] Extend synthetic dataset generation for author x repository exactness and truncation scenarios in `E:\projects\ado-git-repo-insights\scripts\generate-synthetic-dataset.py`
- [ ] T030 [US2] Add `by_author_and_repo` schema and capability handling in `E:\projects\ado-git-repo-insights\extension\ui\schemas\rollup.schema.ts`
- [ ] T031 [US2] Implement exact author+repository lookup precedence in `E:\projects\ado-git-repo-insights\extension\ui\modules\metrics.ts`
- [ ] T032 [US2] Document author x repository exactness, truncation signaling, and legacy fallback in `E:\projects\ado-git-repo-insights\docs\reference\dataset-contract.md`

**Checkpoint**: User Stories 1 and 2 are both independently functional and testable.

---

## Phase 5: User Story 3 - Complete Comments Pipeline With User Value (Priority: P1)

**Goal**: Complete comments as an auxiliary feature from SQLite outputs through aggregate JSON, dashboard rendering, docs, and operator-visible capped coverage state.

**Independent Test**: Run extraction with `--include-comments`, generate outputs, validate auxiliary comment CSVs and comments aggregates, then load the dataset in the dashboard and verify metrics and partial-coverage signaling.

### Tests for User Story 3

- [ ] T033 [P] [US3] Add auxiliary comments CSV schema and path tests in `E:\projects\ado-git-repo-insights\tests\unit\test_csv_contract.py`
- [ ] T034 [P] [US3] Add comments determinism and capped coverage tests in `E:\projects\ado-git-repo-insights\tests\unit\test_csv_determinism.py`
- [ ] T035 [P] [US3] Add comments aggregate and coverage-state tests in `E:\projects\ado-git-repo-insights\tests\unit\test_aggregators.py`
- [ ] T036 [P] [US3] Add comments capability and coverage loader tests in `E:\projects\ado-git-repo-insights\extension\tests\schema\manifest.test.ts`
- [ ] T037 [P] [US3] Add comments dashboard rendering and capped-state tests in `E:\projects\ado-git-repo-insights\extension\tests\dashboard\ml-state-rendering.test.ts`

### Implementation for User Story 3

- [ ] T038 [US3] Implement auxiliary comments CSV export under `csv-output/auxiliary/comments/` in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\transform\csv_generator.py`
- [ ] T039 [US3] Persist capped comments coverage and metrics-first comments aggregates in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\transform\aggregators.py`
- [ ] T040 [US3] Propagate comments capped-state metadata from extraction flow in `E:\projects\ado-git-repo-insights\src\ado_git_repo_insights\cli.py`
- [ ] T041 [US3] Add comments capability and coverage schema support in `E:\projects\ado-git-repo-insights\extension\ui\schemas\manifest.schema.ts`
- [ ] T042 [US3] Normalize comments metrics and coverage state in `E:\projects\ado-git-repo-insights\extension\ui\dataset-loader.ts`
- [ ] T043 [US3] Implement comments metrics presentation and partial-coverage UI in `E:\projects\ado-git-repo-insights\extension\ui\dashboard.ts`
- [ ] T044 [US3] Add comments panel markup and messaging in `E:\projects\ado-git-repo-insights\extension\ui\index.html`
- [ ] T045 [US3] Document comment flags, auxiliary CSV paths, and coverage semantics in `E:\projects\ado-git-repo-insights\docs\reference\cli-reference.md`

**Checkpoint**: User Stories 1, 2, and 3 are all independently functional and testable.

---

## Phase 6: User Story 4 - Finish Reviewer Follow-Through And Close The Roadmap (Priority: P2)

**Goal**: Finalize reviewer combination behavior, preserve explicit latency deferment, and close the roadmap with checked-in evidence artifacts.

**Independent Test**: Verify reviewer+repository uses constrained behavior, reviewer+team is disallowed with UX signaling, and roadmap/evidence docs trace every remaining roadmap item to passing verification.

### Tests for User Story 4

- [ ] T046 [P] [US4] Add reviewer constrained/disallowed combination tests in `E:\projects\ado-git-repo-insights\extension\tests\modules\metrics.test.ts`
- [ ] T047 [P] [US4] Add reviewer combination UX tests in `E:\projects\ado-git-repo-insights\extension\tests\dashboard.test.ts`
- [ ] T048 [P] [US4] Add roadmap closure evidence artifact validation test in `E:\projects\ado-git-repo-insights\tests\integration\test_golden_outputs.py`

### Implementation for User Story 4

- [ ] T049 [US4] Implement locked reviewer combination behavior in `E:\projects\ado-git-repo-insights\extension\ui\modules\metrics.ts`
- [ ] T050 [US4] Add reviewer combination UX signaling in `E:\projects\ado-git-repo-insights\extension\ui\dashboard.ts`
- [ ] T051 [US4] Update reviewer roadmap/TODO status and latency deferment docs in `E:\projects\ado-git-repo-insights\TODO\TEAM_REVIEWER_FILTERS.md`
- [ ] T052 [US4] Update author roadmap/TODO closure status in `E:\projects\ado-git-repo-insights\TODO\AUTHOR_CONTRIBUTOR_FILTERS.md`
- [ ] T053 [US4] Update comments roadmap/TODO closure status in `E:\projects\ado-git-repo-insights\TODO\COMMENTS.md`
- [ ] T054 [US4] Update final roadmap closure state and evidence references in `E:\projects\ado-git-repo-insights\TODO\ROADMAP.md`
- [ ] T055 [US4] Create checked-in evidence artifacts for all roadmap items in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\evidence\001-author-filters-evidence.md`
- [ ] T056 [US4] Create checked-in evidence artifacts for remaining roadmap items in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\evidence\002-author-repo-evidence.md`
- [ ] T057 [US4] Create checked-in evidence artifacts for remaining roadmap items in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\evidence\003-comments-evidence.md`
- [ ] T058 [US4] Create checked-in evidence artifacts for remaining roadmap items in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\evidence\004-reviewer-followthrough-evidence.md`
- [ ] T059 [US4] Create checked-in evidence artifacts for roadmap finalization in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\evidence\005-roadmap-finalization-evidence.md`

**Checkpoint**: All user stories are independently functional and roadmap closure is evidence-backed.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, cleanup, and cross-story regression protection

- [ ] T060 [P] Run full Python quality and targeted integration verification for roadmap closure in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\quickstart.md`
- [ ] T061 [P] Run full extension build/type/unit verification for roadmap closure in `E:\projects\ado-git-repo-insights\specs\034-roadmap-closure\quickstart.md`
- [ ] T062 Reconcile AGENTS/spec docs if implementation changed planned technology boundaries in `E:\projects\ado-git-repo-insights\AGENTS.md`
- [ ] T063 Perform final documentation pass on dataset and extension guidance in `E:\projects\ado-git-repo-insights\docs\reference\dataset-contract.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion; recommended MVP
- **User Story 2 (Phase 4)**: Depends on User Story 1 because `by_author` is a prerequisite
- **User Story 3 (Phase 5)**: Depends on Foundational completion; can run in parallel with User Story 1 after foundation is ready
- **User Story 4 (Phase 6)**: Depends on User Stories 1-3 completion because it closes roadmap status and writes evidence against shipped behavior
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1**: No dependency on other user stories after foundation
- **US2**: Depends on US1
- **US3**: No dependency on US1/US2 after foundation
- **US4**: Depends on US1, US2, and US3

### Within Each User Story

- Tests first
- Backend contract/model changes before frontend consumers
- Loader/schema before dashboard/UI behavior
- Docs/evidence after implementation and verification

### Parallel Opportunities

- T007 and T008 can run in parallel after T004-T006
- US1 test tasks T011-T014 can run in parallel
- US2 test tasks T023-T026 can run in parallel
- US3 test tasks T033-T037 can run in parallel
- US4 test tasks T046-T048 can run in parallel
- After Phase 2, one engineer can drive US1 while another drives US3

---

## Parallel Example: User Story 1

```text
T011 tests/unit/test_aggregators.py
T012 extension/tests/schema/rollup.test.ts
T013 extension/tests/modules/metrics.test.ts
T014 extension/tests/dashboard.test.ts
```

## Parallel Example: User Story 2

```text
T023 tests/unit/test_aggregators.py
T024 tests/unit/test_synthetic_dataset.py
T025 extension/tests/schema/rollup.test.ts
T026 extension/tests/modules/metrics.test.ts
```

## Parallel Example: User Story 3

```text
T033 tests/unit/test_csv_contract.py
T034 tests/unit/test_csv_determinism.py
T036 extension/tests/schema/manifest.test.ts
T037 extension/tests/dashboard/ml-state-rendering.test.ts
```

## Parallel Example: User Story 4

```text
T046 extension/tests/modules/metrics.test.ts
T047 extension/tests/dashboard.test.ts
T051 TODO/TEAM_REVIEWER_FILTERS.md
T052 TODO/AUTHOR_CONTRIBUTOR_FILTERS.md
T053 TODO/COMMENTS.md
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate author filtering independently before expanding scope

### Incremental Delivery

1. Setup + Foundational
2. US1 author filters
3. US2 exact author x repository
4. US3 comments completion
5. US4 reviewer follow-through and roadmap closure
6. Final polish and verification

### Parallel Team Strategy

With multiple developers:

1. Complete Phases 1-2 together
2. Split after foundation:
   - Developer A: US1 then US2
   - Developer B: US3
3. Rejoin for US4 and final polish

---

## Notes

- All tasks follow the required checklist format.
- All user-story tasks include exact file paths and story labels.
- Tests are included because the spec explicitly requires them.
- Suggested MVP scope is Phase 3 / User Story 1 only.
