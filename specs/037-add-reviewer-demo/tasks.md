# Tasks: Reviewer Demo Coverage

**Input**: Design documents from `/specs/037-add-reviewer-demo/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED because the feature explicitly depends on deterministic regeneration, blocking validation, and automated demo-parity verification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared constants and helper structure for reviewer fixture validation and deterministic publication scope.

- [ ] T001 Add canonical reviewer fixture key constants and synthetic-name helper scaffolding in `scripts/generate-demo-data.py`
- [ ] T002 [P] Add canonical publication scope helper scaffolding and reviewer validation entry points in `scripts/build-demo-dataset.py`

**Checkpoint**: Shared generator and build-script anchors exist for the feature contract.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Lock the manifest and validation contract that every reviewer story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Extend manifest generation with reviewer fixture metadata placeholders and deterministic threshold fields in `scripts/generate-demo-data.py`
- [ ] T004 [P] Add reviewer fixture metadata schema assertions in `tests/demo/test_schema_guard.py`
- [ ] T005 Add reusable reviewer fixture validation helpers and blocking error construction in `scripts/build-demo-dataset.py`

**Checkpoint**: Manifest and build pipeline agree on the required reviewer fixture contract.

---

## Phase 3: User Story 1 - Demonstrate Reviewer-Filtered Views (Priority: P1) 🎯 MVP

**Goal**: Make the canonical demo dataset produce convincing reviewer-filtered views backed by unique realistic synthetic names and measurable reviewer coverage.

**Independent Test**: Load the canonical demo dataset, apply reviewer filters, and confirm reviewer-specific views show meaningful results across supported dashboard screens with unique human-readable names and no numeric suffixes.

### Tests for User Story 1

- [ ] T006 [P] [US1] Add synthetic identity and reviewer coverage invariants in `tests/unit/test_synthetic_dataset.py`
- [ ] T007 [P] [US1] Add reviewer-filtering parity assertions for canonical rollups and dimensions in `tests/demo/test_demo_parity_pipeline.py`

### Implementation for User Story 1

- [ ] T008 [US1] Replace numeric-suffixed display name generation with deterministic unique realistic names in `scripts/generate-demo-data.py`
- [ ] T009 [US1] Strengthen reviewer breakdown generation for at least five active reviewers and at least one multi-repository reviewer in `scripts/generate-demo-data.py`
- [ ] T010 [US1] Keep `users`, `authors`, `reviewers`, and weekly `by_reviewer` outputs aligned with the new synthetic identities in `scripts/generate-demo-data.py`
- [ ] T011 [US1] Enforce the minimum meaningful-activity threshold of at least 3 reviewed pull requests and 3 review actions for each canonical active reviewer in `scripts/generate-demo-data.py`

**Checkpoint**: Reviewer filtering works on the canonical demo dataset and demo-facing identities are realistic, unique, and number-free.

---

## Phase 4: User Story 2 - Demonstrate Reviewer Constraints (Priority: P2)

**Goal**: Make constrained reviewer mode and the reviewer-plus-team disallowed signal deterministic, documented, and easy to validate.

**Independent Test**: Use the canonical demo dataset to enter reviewer-constrained mode and resolve the documented disallowed reviewer-plus-team example without exploratory searching.

### Tests for User Story 2

- [ ] T012 [P] [US2] Add constrained and disallowed reviewer fixture assertions in `tests/demo/test_demo_parity_pipeline.py`
- [ ] T013 [P] [US2] Add reviewer fixture metadata field coverage checks in `tests/demo/test_schema_guard.py`

### Implementation for User Story 2

- [ ] T014 [US2] Populate deterministic `reviewer_filter_examples` and `reviewer_constrained_example` metadata in `scripts/generate-demo-data.py`
- [ ] T015 [US2] Populate deterministic `reviewer_team_disallowed_example`, `minimum_active_reviewers`, and `minimum_multi_repo_reviewers` metadata in `scripts/generate-demo-data.py`
- [ ] T016 [US2] Enrich reviewer capability evidence for constrained and disallowed modes in `scripts/build-demo-dataset.py`

**Checkpoint**: Reviewer-constrained and disallowed flows are explicitly encoded in the canonical manifest and verifiable in the parity pipeline.

---

## Phase 5: User Story 3 - Preserve Canonical Demo Trustworthiness (Priority: P3)

**Goal**: Ensure reviewer coverage remains deterministic, promotion-safe, and blocked on clear errors when reviewer contract artifacts are missing.

**Independent Test**: Regenerate the canonical demo repeatedly and confirm the canonical data, manifest, report, and metadata artifacts remain stable while missing reviewer fixtures stop promotion with explicit error reasons.

### Tests for User Story 3

- [ ] T017 [P] [US3] Expand regeneration-scope assertions for canonical data, report, and metadata artifacts in `tests/demo/test_regeneration.py`
- [ ] T018 [P] [US3] Add blocking failure-mode tests for missing reviewer fixtures in `tests/demo/test_demo_parity_pipeline.py`

### Implementation for User Story 3

- [ ] T019 [US3] Enforce blocking reviewer fixture validation with explicit error reasons in `scripts/build-demo-dataset.py`
- [ ] T020 [US3] Extend canonical publication comparison and promotion validation scope in `scripts/build-demo-dataset.py`

**Checkpoint**: Canonical rebuilds stay deterministic and incomplete reviewer artifacts cannot be promoted silently.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Regenerate artifacts, run the planned verification commands, and confirm the reviewer-enhanced demo contract end to end.

- [ ] T021 Regenerate canonical demo artifacts with `scripts/build-demo-dataset.py` and inspect outputs under `artifacts/demo-enterprise/` and `docs/data/`
- [ ] T022 [P] Run reviewer parity and failure-mode verification in `tests/demo/test_demo_parity_pipeline.py`
- [ ] T023 [P] Run deterministic regeneration verification in `tests/demo/test_regeneration.py`
- [ ] T024 [P] Run synthetic dataset invariant verification in `tests/unit/test_synthetic_dataset.py`
- [ ] T025 [P] Run lint and format verification with `ruff check .` and `ruff format --check .`
- [ ] T026 [P] Run type-check verification with `mypy src/` if enabled for this repository
- [ ] T027 [P] Run broader required test verification with `pytest tests/unit tests/integration`
- [ ] T028 Document accepted out-of-scope ML coverage and extension artifact parity concerns in `specs/037-add-reviewer-demo/quickstart.md`
- [ ] T029 Record final verification results against `specs/037-add-reviewer-demo/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion - MVP scope
- **User Story 2 (Phase 4)**: Depends on Foundational completion and benefits from User Story 1 reviewer identity/output work
- **User Story 3 (Phase 5)**: Depends on Foundational completion and consumes User Story 1 and User Story 2 reviewer contract data
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 2 - no dependency on other stories
- **User Story 2 (P2)**: Can start after Phase 2, but is safest after US1 because it reuses reviewer identities and manifest outputs
- **User Story 3 (P3)**: Starts after US1 and US2 because it validates their generated reviewer contract artifacts

### Within Each User Story

- Tests should be written before implementation and fail against the current gap
- Generator changes come before build/report validation for the same story
- Build/report validation comes before full end-to-end regeneration
- Each story must be independently runnable with the checks listed in its independent test criteria

### Parallel Opportunities

- **Phase 1**: T001 and T002 can run in parallel
- **Phase 2**: T004 can run in parallel with T005 after T003 defines the metadata contract
- **US1**: T006 and T007 can run in parallel; T008-T011 remain sequential in `scripts/generate-demo-data.py`
- **US2**: T012 and T013 can run in parallel; T014-T015 remain sequential in `scripts/generate-demo-data.py`; T016 can follow once metadata is emitted
- **US3**: T017 and T018 can run in parallel; T019 and T020 remain sequential in `scripts/build-demo-dataset.py`
- **Polish**: T022-T027 can run in parallel after T021 regenerates artifacts

---

## Parallel Example: User Story 1

```text
# Launch the User Story 1 test work together:
Task: "T006 [US1] Add synthetic identity and reviewer coverage invariants in tests/unit/test_synthetic_dataset.py"
Task: "T007 [US1] Add reviewer-filtering parity assertions for canonical rollups and dimensions in tests/demo/test_demo_parity_pipeline.py"

# Then complete the generator work in order:
Task: "T008 [US1] Replace numeric-suffixed display name generation in scripts/generate-demo-data.py"
Task: "T009 [US1] Strengthen reviewer breakdown generation in scripts/generate-demo-data.py"
Task: "T010 [US1] Keep users/authors/reviewers outputs aligned in scripts/generate-demo-data.py"
Task: "T011 [US1] Enforce minimum meaningful-activity thresholds in scripts/generate-demo-data.py"
```

---

## Parallel Example: User Story 2

```text
# Launch the User Story 2 contract checks together:
Task: "T012 [US2] Add constrained and disallowed reviewer fixture assertions in tests/demo/test_demo_parity_pipeline.py"
Task: "T013 [US2] Add reviewer fixture metadata field coverage checks in tests/demo/test_schema_guard.py"

# Then complete metadata generation and reporting:
Task: "T014 [US2] Populate reviewer_filter_examples and reviewer_constrained_example metadata in scripts/generate-demo-data.py"
Task: "T015 [US2] Populate reviewer_team_disallowed_example and threshold metadata in scripts/generate-demo-data.py"
Task: "T016 [US2] Enrich reviewer capability evidence in scripts/build-demo-dataset.py"
```

---

## Parallel Example: User Story 3

```text
# Launch trustworthiness-focused tests together:
Task: "T017 [US3] Expand regeneration-scope assertions in tests/demo/test_regeneration.py"
Task: "T018 [US3] Add blocking failure-mode tests in tests/demo/test_demo_parity_pipeline.py"

# Then implement the blocking validation flow:
Task: "T019 [US3] Enforce blocking reviewer fixture validation in scripts/build-demo-dataset.py"
Task: "T020 [US3] Extend canonical publication comparison scope in scripts/build-demo-dataset.py"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Build the canonical demo and verify reviewer-filtered views plus unique realistic names
5. Demo the reviewer-filtered experience as the minimum viable closure of the core gap

### Incremental Delivery

1. Complete Setup + Foundational
2. Deliver User Story 1 and validate reviewer filtering
3. Deliver User Story 2 and validate constrained/disallowed reviewer fixtures
4. Deliver User Story 3 and validate deterministic blocking publication behavior
5. Finish with the Polish phase verification run, including repo-level lint, type-check, and broader test gates so the deterministic reviewer contract stays enforced in normal development

### Parallel Team Strategy

1. One developer completes Phase 1 and Phase 2
2. After foundation is ready:
   - Developer A: User Story 1 generator work in `scripts/generate-demo-data.py`
   - Developer B: User Story 2 tests and build-report updates in `tests/demo/` and `scripts/build-demo-dataset.py`
   - Developer C: User Story 3 regeneration and failure-mode tests in `tests/demo/test_regeneration.py` and `tests/demo/test_demo_parity_pipeline.py`
3. Rejoin for Phase 6 regeneration and validation

---

## Notes

- [P] tasks = different files, no dependencies on incomplete work
- [Story] labels map every story task back to the spec for traceability
- `scripts/generate-demo-data.py` is the main contention point for US1 and US2 - keep those edits sequential
- `scripts/build-demo-dataset.py` is the main contention point for foundational and US3 work - keep those edits sequential
- No task requires manual editing under `docs/data/`; that directory remains generated-only
- The MVP scope is **User Story 1**
