# Tasks: CLI Distribution Hardening

**Input**: Design documents from `/specs/003-cli-distribution/`
**Prerequisites**: plan.md (required), spec.md (required), research.md

**Tests**: Tests are included per standard project practice.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and module structure for new CLI commands

- [x] T001 Create commands package directory at src/ado_git_repo_insights/commands/**init**.py
- [x] T002 [P] Create shell_detection module at src/ado_git_repo_insights/utils/shell_detection.py with detect_shell() and get_shell_config_path() stubs
- [x] T003 [P] Create path_utils module at src/ado_git_repo_insights/utils/path_utils.py with is_on_path() and get_scripts_directory() stubs
- [x] T004 [P] Create install_detection module at src/ado_git_repo_insights/utils/install_detection.py with detect_installation_method() stub
- Note: detect_installation_method() MUST return: pipx, uv, pip, or unknown

and MUST surface uncertainty explicitly (not guess)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core utilities that MUST be complete before ANY user story can be implemented

**Note**: These utilities are shared by multiple user stories (setup-path and doctor commands)

- [x] T005 Implement detect_shell() in src/ado_git_repo_insights/utils/shell_detection.py using R1 algorithm from research.md
- [x] T006 Implement get_shell_config_path() in src/ado_git_repo_insights/utils/shell_detection.py using R2 mappings from research.md
- [x] T007 [P] Implement get_scripts_directory() in src/ado_git_repo_insights/utils/path_utils.py using R4 sysconfig approach from research.md
- [x] T008 [P] Implement is_on_path() in src/ado_git_repo_insights/utils/path_utils.py using R7 algorithm from research.md
- [x] T009 Implement detect_installation_method() in src/ado_git_repo_insights/utils/install_detection.py using R5 heuristics from research.md
- [x] T010 [P] Implement find_all_installations() in src/ado_git_repo_insights/utils/install_detection.py using R6 algorithm from research.md
- [x] T011 [P] Add unit tests for shell_detection in tests/unit/test_shell_detection.py
- [x] T012 [P] Add unit tests for path_utils in tests/unit/test_path_utils.py
- [x] T013 [P] Add unit tests for install_detection in tests/unit/test_install_detection.py

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 & 2 - pipx and uv Installation (Priority: P1)

**Goal**: Ensure frictionless installation via pipx and uv tool with automatic PATH management

**Independent Test**: Install via `pipx install ado-git-repo-insights` or `uv tool install ado-git-repo-insights`, open new terminal, verify `ado-insights --version` works without manual PATH configuration

### Implementation for User Stories 1 & 2

**Note**: These user stories require no code changes - pipx and uv handle PATH automatically. Implementation is documentation and verification only.

- [x] T014 [P] [US1] Verify pyproject.toml has correct console_scripts entry point for ado-insights
- [ ] T015 [P] [US2] Verify package can be installed via pipx and uv tool (manual test on dev machine)
- [x] T016 [US1] Document pipx installation in docs/installation.md with verification steps
- [x] T017 [US2] Document uv tool installation in docs/installation.md with verification steps

**Checkpoint**: Frictionless installation paths verified and documented

---

## Phase 4: User Story 3 - pip Installation with PATH Guidance (Priority: P2)

**Goal**: pip install emits deterministic, copy/paste PATH guidance when scripts directory is not on PATH

**Independent Test**: Run `pip install ado-git-repo-insights` in environment where scripts dir is NOT on PATH, verify clear instructions are displayed

### Implementation for User Story 3

- [x] T018 [US3] Implement PATH check and guidance emission at CLI startup (ado-insights invocation), not during pip install in src/ado_git_repo_insights/cli.py. The check MUST occur when the CLI is executed, not during package installation.
- [x] T019 [US3] Create format_path_guidance() helper in src/ado_git_repo_insights/utils/path_utils.py that generates shell-specific instructions
- [x] T020 [US3] Add shell-specific command templates for bash, zsh, and PowerShell in path_utils.py
- [x] T021 [US3] Add best-effort guidance message for unsupported shells (fish, nushell) in path_utils.py
- [x] T022 [P] [US3] Add unit tests for PATH guidance formatting in tests/unit/test_path_utils.py

**Checkpoint**: pip users receive actionable PATH guidance on install

---

## Phase 5: User Story 4 - setup-path Command (Priority: P2)

**Goal**: Provide `ado-insights setup-path` command for automated PATH configuration

**Independent Test**: Run `ado-insights setup-path`, verify shell config file is modified correctly; run `--print-only` to verify no files modified

### Implementation for User Story 4

- [x] T023 [US4] Create setup_path.py command module at src/ado_git_repo_insights/commands/setup_path.py
- [x] T024 [US4] Implement main setup_path() function with --print-only and --remove flags. Setup-path MUST refuse to run if detect_installation_method() returns pipx or uv, with a clear message.
- [x] T025 [US4] Implement read_and_modify_config() to add PATH entry with sentinel comments per R3 format
- [x] T026 [US4] Implement idempotency check per R8 (detect existing sentinel markers)
- [x] T027 [US4] Implement --remove logic to strip sentinel-marked block from config file
- [x] T028 [US4] Register setup-path subcommand in src/ado_git_repo_insights/cli.py
- [x] T029 [US4] Handle edge cases: missing config file (create), read-only file (error with manual instructions)
- [x] T030 [P] [US4] Add unit tests for setup_path command in tests/unit/test_setup_path.py
- [x] T031 [P] [US4] Add integration test for setup-path modifying actual shell config (in temp dir) in tests/integration/test_cli_distribution.py

**Checkpoint**: setup-path command fully functional with --print-only and --remove

Integration tests validate:

- file mutation logic
- sentinel handling
- Not actual shell execution

---

## Phase 6: User Story 5 - doctor Command (Priority: P2)

**Goal**: Provide `ado-insights doctor` command for diagnosing installation issues

**Independent Test**: Create conflicting install (pipx + pip), run `ado-insights doctor`, verify it detects conflict and provides fix commands

### Implementation for User Story 5

- [x] T032 [US5] Create doctor.py command module at src/ado_git_repo_insights/commands/doctor.py
- [x] T033 [US5] Implement main doctor() function with structured output per D3 format from plan.md. Doctor output MUST be stable, line-oriented, and free of emojis or ANSI color when --no-color is implied.
- [x] T034 [US5] Implement executable location detection (sys.executable, resolve symlinks)
- [x] T035 [US5] Implement environment summary (Python version, installation method)
- [x] T036 [US5] Implement conflict detection using find_all_installations() from install_detection
- [x] T037 [US5] Implement recommendation engine: generate specific uninstall commands based on detected methods
- [x] T038 [US5] Register doctor subcommand in src/ado_git_repo_insights/cli.py
- [x] T039 [P] [US5] Add unit tests for doctor command in tests/unit/test_doctor.py
- [x] T040 [P] [US5] Add integration test for doctor output formatting in tests/integration/test_cli_distribution.py

**Checkpoint**: doctor command provides actionable diagnostics for installation issues

---

## Phase 7: User Story 6 - Upgrade Experience (Priority: P2)

**Goal**: Ensure smooth upgrade via pipx upgrade, uv upgrade, or pip install --upgrade

**Independent Test**: Install older version via each method, upgrade, verify CLI remains functional

### Implementation for User Story 6

**Note**: Upgrade behavior is handled by package managers. Implementation is documentation and verification.

- [x] T041 [US6] Document upgrade commands for pipx, uv, and pip in docs/installation.md
- [ ] T042 [US6] Verify upgrade preserves CLI access (manual test with version bump)
- [x] T043 [US6] Add upgrade troubleshooting section to docs/troubleshooting.md

**Checkpoint**: Upgrade paths documented and verified

---

## Phase 8: User Story 7 - Uninstallation (Priority: P3)

**Goal**: Clean uninstallation via matching uninstall command; setup-path --remove for pip users

**Independent Test**: Install via each method, uninstall, verify tool removed; for pip+setup-path, verify config is cleaned

### Implementation for User Story 7

- [x] T044 [US7] Document uninstall commands for pipx, uv, and pip in docs/installation.md
- [x] T045 [US7] Document setup-path --remove usage before pip uninstall
- [x] T046 [P] [US7] Add integration test for setup-path --remove cleanup in tests/integration/test_cli_distribution.py

**Checkpoint**: Uninstallation paths documented with proper cleanup guidance

---

## Phase 9: User Story 8 - Enterprise/Scripted Deployment (Priority: P3)

**Goal**: Enable non-interactive installation with scriptable output for enterprise deployments

**Independent Test**: Run installation in script, verify no interactive prompts; capture setup-path --print-only output

### Implementation for User Story 8

- [x] T047 [US8] Verify all installation commands are non-interactive (no prompts)
- [x] T048 [US8] Document scripted deployment patterns in docs/user-guide/local-cli.md (enterprise section)
- [x] T049 [US8] Add example script using --print-only for automation in docs/user-guide/local-cli.md
- [x] T050 [P] [US8] Add integration test verifying --print-only outputs to stdout without file modification

**Checkpoint**: Enterprise deployment patterns documented and testable

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, README updates, and final validation

- [x] T051 [P] Installation methods documented in docs/user-guide/local-cli.md (consolidated approach)
- [x] T052 [P] Troubleshooting content added to docs/user-guide/troubleshooting.md
- [x] T053 Update README.md installation section with pipx/uv/pip and doctor reference
- [x] T054 [P] Run all unit tests and fix any failures
- [x] T055 [P] Run ruff check and fix any linting issues
- [x] T056 Validate quickstart.md scenarios (verified installation methods, doctor, upgrade, uninstall documented)
- [x] T057 Final code review for error handling and edge cases

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories 1 & 2 (Phase 3)**: Depends on Foundational - documentation only
- **User Story 3 (Phase 4)**: Depends on Foundational (needs path_utils)
- **User Story 4 (Phase 5)**: Depends on Foundational (needs shell_detection, path_utils)
- **User Story 5 (Phase 6)**: Depends on Foundational (needs install_detection)
- **User Stories 6-8 (Phases 7-9)**: Depends on Foundational - primarily documentation
- **Polish (Phase 10)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 & US2 (pipx/uv)**: Can start after Foundational - no code, documentation only
- **US3 (pip PATH)**: Can start after Foundational - uses path_utils
- **US4 (setup-path)**: Can start after Foundational - uses shell_detection, path_utils
- **US5 (doctor)**: Can start after Foundational - uses install_detection
- **US6-US8**: Primarily documentation, can run in parallel after Foundational

### Within Each User Story

- Core utilities before command implementation
- Command implementation before CLI registration
- CLI registration before tests
- Tests verify functionality

### Parallel Opportunities

- T002, T003, T004 can run in parallel (different utility modules)
- T007, T008 can run in parallel (different functions in path_utils)
- T009, T010 can run in parallel (different functions in install_detection)
- T011, T012, T013 can run in parallel (different test files)
- US3, US4, US5 can run in parallel after Foundational (different commands, different files)
- T030, T031 can run in parallel (unit vs integration tests)
- T039, T040 can run in parallel (unit vs integration tests)
- T051, T052, T054, T055 can run in parallel (different files)

---

## Parallel Example: Foundational Phase

```bash
# Launch all utility module creation in parallel:
Task: "Create shell_detection module at src/ado_git_repo_insights/utils/shell_detection.py"
Task: "Create path_utils module at src/ado_git_repo_insights/utils/path_utils.py"
Task: "Create install_detection module at src/ado_git_repo_insights/utils/install_detection.py"

# Launch all unit tests in parallel:
Task: "Add unit tests for shell_detection in tests/unit/test_shell_detection.py"
Task: "Add unit tests for path_utils in tests/unit/test_path_utils.py"
Task: "Add unit tests for install_detection in tests/unit/test_install_detection.py"
```

---

## Implementation Strategy

### MVP First (User Stories 1-4)

1. Complete Phase 1: Setup (module structure)
2. Complete Phase 2: Foundational (core utilities)
3. Complete Phase 3: US1 & US2 (pipx/uv documentation)
4. Complete Phase 4: US3 (pip PATH guidance)
5. Complete Phase 5: US4 (setup-path command)
6. **STOP and VALIDATE**: Test all installation methods independently
7. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Core utilities ready
2. Add US1 & US2 → pipx/uv paths documented and verified
3. Add US3 → pip users get PATH guidance
4. Add US4 → setup-path command available
5. Add US5 → doctor command for diagnostics
6. Add US6-US8 → Complete documentation
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
    - Developer A: US3 (pip PATH guidance)
    - Developer B: US4 (setup-path command)
    - Developer C: US5 (doctor command)
3. Stories complete and integrate independently
4. Single developer handles documentation (US6-US8) and Polish

---

## Summary

| Phase        | Tasks  | Parallel Tasks | Story Coverage  |
| ------------ | ------ | -------------- | --------------- |
| Setup        | 4      | 3              | -               |
| Foundational | 9      | 6              | -               |
| US1 & US2    | 4      | 2              | P1 (pipx, uv)   |
| US3          | 5      | 1              | P2 (pip PATH)   |
| US4          | 9      | 2              | P2 (setup-path) |
| US5          | 9      | 2              | P2 (doctor)     |
| US6          | 3      | 0              | P2 (upgrade)    |
| US7          | 3      | 1              | P3 (uninstall)  |
| US8          | 4      | 1              | P3 (enterprise) |
| Polish       | 7      | 4              | -               |
| **Total**    | **57** | **22**         | 8 stories       |

**MVP Scope**: Phases 1-5 (Setup, Foundational, US1-US4) = 31 tasks
