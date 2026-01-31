# Tasks: Security Hardening - Zip Slip Protection & Token Encoding

**Input**: Design documents from `/specs/017-security-fixes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included per spec requirements (SC-007, SC-008 mandate regression tests)

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Exact file paths included in all descriptions

## Path Conventions

- **Source**: `src/ado_git_repo_insights/`
- **Tests**: `tests/`
- **CI**: `.github/workflows/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create new module files and test fixtures

- [x] T001 Create utils directory if not exists at src/ado_git_repo_insights/utils/__init__.py
- [x] T002 [P] Create empty safe_extract module at src/ado_git_repo_insights/utils/safe_extract.py
- [x] T003 [P] Create empty pagination module at src/ado_git_repo_insights/extractor/pagination.py
- [x] T004 [P] Create test file at tests/unit/test_safe_extract.py
- [x] T005 [P] Create test file at tests/unit/test_pagination_helper.py

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Exception classes and shared utilities needed by both user stories

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Define ZipSlipError exception class in src/ado_git_repo_insights/utils/safe_extract.py
- [x] T007 Define ExtractionError exception class in src/ado_git_repo_insights/utils/safe_extract.py
- [x] T008 [P] Define PaginationError exception class in src/ado_git_repo_insights/extractor/pagination.py
- [x] T009 [P] Export exceptions from src/ado_git_repo_insights/utils/__init__.py

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Safe Artifact Extraction (Priority: P1)

**Goal**: Protect ZIP extraction against Zip Slip attacks with symlink detection, path validation, and backup-then-swap directory finalization.

**Independent Test**: Provide a ZIP with `../../evil.txt` or symlink entry and verify rejection with clear error message, no files written to output directory.

### Tests for User Story 1

> **NOTE: Write tests FIRST, ensure they FAIL before implementation**

- [x] T010 [P] [US1] Test is_symlink_entry() detects Unix symlinks in tests/unit/test_safe_extract.py
- [x] T011 [P] [US1] Test is_symlink_entry() returns False for Windows/ambiguous ZIPs in tests/unit/test_safe_extract.py
- [x] T012 [P] [US1] Test validate_entry_path() rejects absolute paths in tests/unit/test_safe_extract.py
- [x] T013 [P] [US1] Test validate_entry_path() rejects path traversal sequences in tests/unit/test_safe_extract.py
- [x] T014 [P] [US1] Test validate_entry_path() rejects paths escaping output directory in tests/unit/test_safe_extract.py
- [x] T015 [P] [US1] Test validate_entry_path() accepts valid relative paths in tests/unit/test_safe_extract.py
- [x] T016 [P] [US1] Test safe_extract_zip() extracts valid ZIP successfully in tests/unit/test_safe_extract.py
- [x] T017 [P] [US1] Test safe_extract_zip() rejects ZIP with symlink entry in tests/unit/test_safe_extract.py
- [x] T018 [P] [US1] Test safe_extract_zip() rejects ZIP with traversal path in tests/unit/test_safe_extract.py
- [x] T019 [P] [US1] Test safe_extract_zip() restores backup on swap failure in tests/unit/test_safe_extract.py
- [x] T020 [P] [US1] Create malicious_symlink.zip fixture in tests/fixtures/malicious_symlink.zip (tests create them dynamically)
- [x] T021 [P] [US1] Create malicious_traversal.zip fixture in tests/fixtures/malicious_traversal.zip (tests create them dynamically)

### Implementation for User Story 1

- [x] T022 [US1] Implement is_symlink_entry(zip_info) function in src/ado_git_repo_insights/utils/safe_extract.py
- [x] T023 [US1] Implement validate_entry_path(entry_name, out_dir) function in src/ado_git_repo_insights/utils/safe_extract.py
- [x] T024 [US1] Implement _create_temp_dir(out_dir) helper in src/ado_git_repo_insights/utils/safe_extract.py
- [x] T025 [US1] Implement _backup_and_swap(temp_dir, out_dir) helper in src/ado_git_repo_insights/utils/safe_extract.py
- [x] T026 [US1] Implement safe_extract_zip(zip_path, out_dir) main function in src/ado_git_repo_insights/utils/safe_extract.py
- [x] T027 [US1] Replace extractall() call with safe_extract_zip() in src/ado_git_repo_insights/cli.py cmd_stage_artifacts()
- [x] T028 [US1] Add error handling for ZipSlipError in src/ado_git_repo_insights/cli.py with actionable message
- [x] T029 [US1] Verify all tests pass: pytest tests/unit/test_safe_extract.py -v

**Checkpoint**: User Story 1 complete - ZIP extraction is now secure and independently testable

---

## Phase 4: User Story 2 - Reliable Pagination with Special Characters (Priority: P2)

**Goal**: URL-encode continuation tokens via centralized helper to ensure reliable pagination across all ADO API endpoints.

**Independent Test**: Simulate API response with token containing `&foo=bar` and verify it's treated as single parameter value, pagination succeeds.

### Tests for User Story 2

> **NOTE: Write tests FIRST, ensure they FAIL before implementation**

- [x] T030 [P] [US2] Test add_continuation_token() with None token returns URL unchanged in tests/unit/test_pagination_helper.py
- [x] T031 [P] [US2] Test add_continuation_token() with empty string returns URL unchanged in tests/unit/test_pagination_helper.py
- [x] T032 [P] [US2] Test add_continuation_token() encodes spaces as + in tests/unit/test_pagination_helper.py
- [x] T033 [P] [US2] Test add_continuation_token() encodes & = + special chars in tests/unit/test_pagination_helper.py
- [x] T034 [P] [US2] Test add_continuation_token() with &foo=bar stays single param in tests/unit/test_pagination_helper.py
- [x] T035 [P] [US2] Test add_continuation_token() appends ? for URL without params in tests/unit/test_pagination_helper.py
- [x] T036 [P] [US2] Test add_continuation_token() appends & for URL with existing params in tests/unit/test_pagination_helper.py
- [x] T037 [P] [US2] Test extract_continuation_token() from header in tests/unit/test_pagination_helper.py
- [x] T038 [P] [US2] Test extract_continuation_token() from JSON body in tests/unit/test_pagination_helper.py
- [x] T039 [P] [US2] Test extract_continuation_token() returns None when absent in tests/unit/test_pagination_helper.py

### Implementation for User Story 2

- [x] T040 [US2] Implement add_continuation_token(url, token) function in src/ado_git_repo_insights/extractor/pagination.py
- [x] T041 [US2] Implement extract_continuation_token(response) function in src/ado_git_repo_insights/extractor/pagination.py
- [x] T042 [US2] Refactor Pull Requests pagination in src/ado_git_repo_insights/extractor/ado_client.py to use add_continuation_token()
- [x] T043 [US2] Refactor Teams pagination in src/ado_git_repo_insights/extractor/ado_client.py to use add_continuation_token()
- [x] T044 [US2] Refactor Team Members pagination in src/ado_git_repo_insights/extractor/ado_client.py to use add_continuation_token()
- [x] T045 [US2] Refactor PR Threads pagination in src/ado_git_repo_insights/extractor/ado_client.py to use add_continuation_token()
- [x] T046 [US2] Add regression test for special char token in tests/unit/test_ado_client_pagination.py (covered in test_pagination_helper.py)
- [x] T047 [US2] Verify all tests pass: pytest tests/unit/test_pagination_helper.py tests/unit/test_ado_client_pagination.py -v

**Checkpoint**: User Story 2 complete - Pagination is now reliable and independently testable

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: CI guard, integration tests, and final validation

- [x] T048 [P] Add continuationToken CI guard step in .github/workflows/ci.yml
- [x] T049 [P] Add security regression tests in tests/integration/test_stage_artifacts.py
- [x] T050 Run full test suite: pytest --cov=ado_git_repo_insights --cov-fail-under=75 (764 tests pass)
- [x] T051 Run quickstart.md validation steps manually (validated safe extraction and pagination)
- [x] T052 Verify CI guard catches violations locally: run rg command from research.md (no violations found)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational - can proceed independently
- **User Story 2 (Phase 4)**: Depends on Foundational - can proceed in parallel with US1
- **Polish (Phase 5)**: Depends on both user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on US2 - fully independent
- **User Story 2 (P2)**: No dependencies on US1 - fully independent

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Validate functions before main orchestration function
- Integration with existing code after new module complete
- Run tests after each implementation task

### Parallel Opportunities

**Setup Phase (5 parallel tasks)**:
```
T002, T003, T004, T005 can all run in parallel after T001
```

**User Story 1 Tests (12 parallel tasks)**:
```
T010-T021 can all run in parallel
```

**User Story 1 Implementation**:
```
T022, T023 can run in parallel (no dependencies)
T024, T025 can run in parallel after T022, T023
T026 depends on T022-T025
T027, T028 depend on T026
```

**User Story 2 Tests (10 parallel tasks)**:
```
T030-T039 can all run in parallel
```

**User Story 2 Implementation**:
```
T040, T041 can run in parallel
T042, T043, T044, T045 can run in parallel after T040
```

**Polish Phase**:
```
T048, T049 can run in parallel
```

---

## Parallel Example: User Story 1 Tests

```bash
# Launch all US1 tests together (they test different functions):
Task: "Test is_symlink_entry() detects Unix symlinks"
Task: "Test validate_entry_path() rejects absolute paths"
Task: "Test validate_entry_path() rejects path traversal sequences"
Task: "Test safe_extract_zip() extracts valid ZIP successfully"
Task: "Create malicious_symlink.zip fixture"
Task: "Create malicious_traversal.zip fixture"
```

## Parallel Example: User Story 2 Refactoring

```bash
# After T040-T041, refactor all 4 endpoints in parallel:
Task: "Refactor Pull Requests pagination to use add_continuation_token()"
Task: "Refactor Teams pagination to use add_continuation_token()"
Task: "Refactor Team Members pagination to use add_continuation_token()"
Task: "Refactor PR Threads pagination to use add_continuation_token()"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (Zip Slip protection)
4. **STOP and VALIDATE**: Test ZIP extraction with malicious fixtures
5. Deploy if security fix is urgent

### Full Implementation

1. Complete Setup + Foundational → Foundation ready
2. Complete User Story 1 → Test independently → Security fix deployed
3. Complete User Story 2 → Test independently → Pagination fix deployed
4. Complete Polish → CI guard prevents regressions

### Parallel Team Strategy

With 2 developers:
1. Both complete Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Zip Slip)
   - Developer B: User Story 2 (Pagination)
3. Both complete Polish together

---

## Notes

- [P] tasks = different files, no dependencies
- [US1] = Zip Slip protection tasks
- [US2] = Pagination encoding tasks
- Each user story is independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- SC-007 and SC-008 from spec require regression tests (included)
- SC-009 requires CI guard (T048)
