# Tasks: Unified Dashboard Launch

**Input**: Design documents from `/specs/001-unified-dashboard-serve/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, contracts/cli-flags.md

**Tests**: Tests included as they ensure backward compatibility and flag validation correctness.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/ado_git_repo_insights/`, `tests/` at repository root
- Primary file: `src/ado_git_repo_insights/cli.py`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No setup needed - this feature modifies existing code only

This phase is empty because the project infrastructure already exists. Proceed directly to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extract shared server function that all user stories depend on

**⚠️ CRITICAL**: User story implementation depends on this refactor being complete first

- [x] T001 Extract `_serve_dashboard(dataset_path: Path, port: int, open_browser: bool) -> int` function from `cmd_dashboard` in src/ado_git_repo_insights/cli.py (move lines 1230-1387 into new private function)
- [x] T002 Refactor `cmd_dashboard` to call `_serve_dashboard(input_path, args.port, getattr(args, "open", False))` in src/ado_git_repo_insights/cli.py
- [x] T003 Verify existing `dashboard` command still works after refactor by running `ado-insights dashboard --dataset ./test_dataset --port 8080`

**Checkpoint**: Foundation ready - `_serve_dashboard` function exists and `dashboard` command works unchanged

---

## Phase 3: User Story 1 - One-Command Dashboard Launch (Priority: P1) 🎯 MVP

**Goal**: Enable `build-aggregates --serve --open --port` to build aggregates and immediately launch the dashboard

**Independent Test**: Run `ado-insights build-aggregates --db <db> --out <dir> --serve --open` and verify aggregates are created AND browser opens

### Tests for User Story 1

- [x] T004 [P] [US1] Create unit test for `--serve` flag acceptance in tests/unit/test_cli_serve_flags.py
- [x] T005 [P] [US1] Create unit test for `--serve --open` combination in tests/unit/test_cli_serve_flags.py
- [x] T006 [P] [US1] Create unit test for `--serve --port 3000` combination in tests/unit/test_cli_serve_flags.py

### Implementation for User Story 1

- [x] T007 [US1] Add `--serve` argument to `build_parser` in `create_parser()` in src/ado_git_repo_insights/cli.py (after line 261)
- [x] T008 [US1] Add `--open` argument to `build_parser` in `create_parser()` in src/ado_git_repo_insights/cli.py
- [x] T009 [US1] Add `--port` argument with default 8080 to `build_parser` in `create_parser()` in src/ado_git_repo_insights/cli.py
- [x] T010 [US1] Modify `cmd_build_aggregates` to call `_serve_dashboard(args.out, port, open_browser)` after successful build when `--serve` is set in src/ado_git_repo_insights/cli.py

**Checkpoint**: User Story 1 complete - `build-aggregates --serve --open` works end-to-end

---

## Phase 4: User Story 2 - Preserved Two-Step Workflow (Priority: P2)

**Goal**: Ensure backward compatibility - existing `build-aggregates` (without --serve) exits immediately after build

**Independent Test**: Run `ado-insights build-aggregates --db <db> --out <dir>` (no --serve) and verify command exits after generating files

### Tests for User Story 2

- [x] T011 [P] [US2] Create unit test verifying `build-aggregates` without `--serve` does NOT start server in tests/unit/test_cli_serve_flags.py
- [x] T012 [P] [US2] Create unit test verifying `dashboard` command unchanged in tests/unit/test_cli_serve_flags.py

### Implementation for User Story 2

- [x] T013 [US2] Add conditional check in `cmd_build_aggregates`: only call `_serve_dashboard` if `getattr(args, "serve", False)` is True in src/ado_git_repo_insights/cli.py
- [x] T014 [US2] Verify `cmd_dashboard` function signature unchanged and still callable independently in src/ado_git_repo_insights/cli.py

**Checkpoint**: User Story 2 complete - backward compatibility verified

---

## Phase 5: User Story 3 - Clear Error for Invalid Flag Combinations (Priority: P3)

**Goal**: Provide clear error messages when `--open` or `--port` are used without `--serve`

**Independent Test**: Run `ado-insights build-aggregates --db <db> --out <dir> --open` and verify error message "--open requires --serve"

### Tests for User Story 3

- [x] T015 [P] [US3] Create unit test for `--open` without `--serve` error in tests/unit/test_cli_serve_flags.py
- [x] T016 [P] [US3] Create unit test for `--port 3000` without `--serve` error in tests/unit/test_cli_serve_flags.py
- [x] T017 [P] [US3] Create unit test for `--open --port 3000` without `--serve` combined error in tests/unit/test_cli_serve_flags.py

### Implementation for User Story 3

- [x] T018 [US3] Add flag validation at start of `cmd_build_aggregates` before any processing in src/ado_git_repo_insights/cli.py
- [x] T019 [US3] Implement validation logic: if `open_browser` or `port != 8080` and not `serve`, log error and return 1 in src/ado_git_repo_insights/cli.py
- [x] T020 [US3] Ensure error message lists all invalid flags (e.g., "--open, --port requires --serve") in src/ado_git_repo_insights/cli.py

**Checkpoint**: User Story 3 complete - invalid flag combinations rejected with clear messages

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates and final validation

- [x] T021 [P] Update docs/reference/cli-reference.md with new `--serve`, `--open`, `--port` flags for build-aggregates command
- [x] T022 [P] Run `ruff check src/ado_git_repo_insights/cli.py` and `ruff format src/ado_git_repo_insights/cli.py`
- [x] T023 [P] Run `mypy src/ado_git_repo_insights/cli.py` to verify type hints
- [x] T024 Run full test suite `pytest tests/unit/test_cli_serve_flags.py -v`
- [ ] T025 Manual validation: run quickstart.md scenarios to verify end-to-end flow

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Empty - skip
- **Phase 2 (Foundational)**: Must complete first - extracts shared function
- **Phase 3 (US1)**: Depends on Phase 2 - implements core feature
- **Phase 4 (US2)**: Depends on Phase 3 - verifies backward compatibility
- **Phase 5 (US3)**: Depends on Phase 2 only - can run parallel with US1/US2
- **Phase 6 (Polish)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Phase 2 (shared function extraction)
- **User Story 2 (P2)**: Depends on US1 implementation to verify non-interference
- **User Story 3 (P3)**: Depends on Phase 2 only - flag validation is independent of serve implementation

### Within Each User Story

- Tests FIRST (T004-T006, T011-T012, T015-T017)
- Then implementation (T007-T010, T013-T014, T018-T020)
- All tests within a story can run in parallel [P]

### Parallel Opportunities

```text
Phase 2: Sequential (T001 → T002 → T003)
Phase 3 Tests: T004, T005, T006 can run in parallel
Phase 3 Impl: T007 → T008 → T009 → T010 (sequential, same file region)
Phase 4 Tests: T011, T012 can run in parallel
Phase 5 Tests: T015, T016, T017 can run in parallel
Phase 6: T021, T022, T023 can run in parallel
```

---

## Parallel Example: User Story 3 Tests

```bash
# Launch all US3 tests together:
Task: "Create unit test for --open without --serve error in tests/unit/test_cli_serve_flags.py"
Task: "Create unit test for --port 3000 without --serve error in tests/unit/test_cli_serve_flags.py"
Task: "Create unit test for --open --port 3000 without --serve combined error in tests/unit/test_cli_serve_flags.py"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (extract `_serve_dashboard`)
2. Complete Phase 3: User Story 1 (add flags, integrate)
3. **STOP and VALIDATE**: Test `build-aggregates --serve --open` end-to-end
4. Demo/merge if ready

### Incremental Delivery

1. Phase 2 → Shared function ready
2. Phase 3 (US1) → Core feature works → Can demo one-command workflow
3. Phase 4 (US2) → Backward compatibility verified → Safe for existing users
4. Phase 5 (US3) → Error handling complete → Polished UX
5. Phase 6 → Documentation and CI checks → Release ready

### Single Developer Strategy

Recommended order:

1. T001-T003 (foundational)
2. T004-T006 (US1 tests), then T007-T010 (US1 impl)
3. T011-T012 (US2 tests), then T013-T014 (US2 impl)
4. T015-T017 (US3 tests), then T018-T020 (US3 impl)
5. T021-T025 (polish)

---

## Notes

- All implementation tasks modify the same file (`cli.py`) - avoid conflicts by completing in order
- Test file `tests/unit/test_cli_serve_flags.py` is NEW - no conflicts with existing tests
- Phase 2 refactor is the critical path - all user stories depend on it
- Commit after each phase for clean git history
- Total: 25 tasks across 6 phases
