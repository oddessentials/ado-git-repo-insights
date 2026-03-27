# Tasks: CLI Hardening — Core Usability and Reliability Fixes

**Input**: Design documents from `/specs/039-cli-hardening/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, contracts/cli-interface.md, quickstart.md

**Tests**: Required by spec Section 5 (FR-022 through FR-031). Each test is explicitly enumerated.

**Organization**: Tasks follow the mandatory implementation order from spec Section 1 and plan Section "Required Implementation Order". Out-of-order implementation is a reject condition.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Version Unification + `__main__.py` (Spec Step 1)

**Goal**: Establish the single version source and enable `python -m` invocation

**Stories**: US1 (Version and Invocation), US5 (Version Consistency)

**Independent Test**: `python -c "from ado_git_repo_insights import __version__; assert '0.0.0' not in __version__"`

- [x] T001 [P] [US1] Replace `__init__.py` version with `importlib.metadata` resolution and `"unknown (dev)"` fallback with logged WARNING in `src/ado_git_repo_insights/__init__.py`
- [x] T002 [P] [US1] Create `src/ado_git_repo_insights/__main__.py` with `sys.exit(main())` and absolute import
- [x] T003 [P] [US5] Replace `get_tool_version()` in `src/ado_git_repo_insights/utils/run_summary.py` — remove VERSION file read, use `importlib.metadata` with `"unknown (dev)"` fallback
- [x] T004 [P] [US5] Remove VERSION file read from `get_git_sha()` in `src/ado_git_repo_insights/utils/run_summary.py` — keep only `git rev-parse` fallback
- [x] T005 [US5] Update `_get_version()` fallback from `"unknown"` to `"unknown (dev)"` in `src/ado_git_repo_insights/commands/doctor.py`

**Checkpoint**: `python -m ado_git_repo_insights --help` works. `__version__` is not `"0.0.0"`. `get_tool_version()` returns metadata-based version.

---

## Phase 2: `--version` Flag (Spec Step 2)

**Goal**: Add global `--version` flag to CLI

**Stories**: US1 (Version and Invocation)

**Independent Test**: `python -m ado_git_repo_insights --version` prints version and exits 0

- [x] T006 [US1] Add `_get_runtime_version()` helper function before `create_parser()` in `src/ado_git_repo_insights/cli.py`
- [x] T007 [US1] Add `--version` argument to `create_parser()` in `src/ado_git_repo_insights/cli.py` — must use `action="version"` with `_get_runtime_version()`
- [x] T008 [US1] Remove `# pragma: no cover` from `create_parser()` definition at `src/ado_git_repo_insights/cli.py:47`

**Checkpoint**: `ado-insights --version` prints real version, no subcommand required, exit code 0.

---

## Phase 3: Parse-Boundary Validation (Spec Step 3)

**Goal**: Extract command fails immediately at parse boundary with exit code 2 and zero side effects

**Stories**: US3 (Extract Fails at Parse Boundary)

**Independent Test**: `python -m ado_git_repo_insights.cli extract --pat x` exits code 2, no directories created

**Zero Side Effects Rule**: Validation MUST occur after `parse_args()` and BEFORE: logging initialization, PATH guidance emission, directory creation, filesystem access, config loading, DB connection, network calls. Variable assignments for `artifacts_dir` and `summary_path` (needed by exception handler) are NOT side effects — they compute paths without creating anything.

- [x] T009 [US3] Add conditional validation block in `main()` immediately after `parse_args()` in `src/ado_git_repo_insights/cli.py` — check extract requires org/projects unless `--config`, use `parser.error()` for exit code 2
- [x] T010 [US3] Reorder `main()` in `src/ado_git_repo_insights/cli.py` — move `setup_logging()`, `_check_path_guidance()`, and `artifacts_dir.mkdir()` to AFTER validation block. Keep `artifacts_dir` and `summary_path` variable assignments before the try block.

**Validation Ownership (FR-019..FR-021)**: These requirements are design constraints enforced by this phase's approach — CLI validation via `parser.error()` in T009 owns all user-facing error messaging; `Config.__post_init__` remains unchanged as defense-in-depth for programmatic callers. No separate implementation task is needed because no code in `config.py` is modified.

**Checkpoint**: `ado-insights extract --pat x` exits 2 with usage. `ado-insights extract --pat x --config config.yaml` passes validation. No `run_artifacts/` directory created on validation failure.

---

## Phase 4: Lazy Import Refactor (Spec Step 4)

**Goal**: Heavy dependencies load only when the specific command executes, not at module import time

**Stories**: US2 (Help and Doctor Work in Broken Environments)

**Independent Test**: `python -c "from ado_git_repo_insights.cli import create_parser; import sys; assert 'pandas' not in sys.modules"`

**Exception-Handling Invariant**: Every exception type used in an `except` clause MUST be imported at the TOP of the function body, grouped with other imports, BEFORE the `try` block. A forced-failure test must verify each path.

- [x] T011 [US2] Remove heavy module-level imports from `src/ado_git_repo_insights/cli.py` — remove lines importing `.config`, `.extractor.*`, `.persistence.database`, `.transform.*`, `.utils.run_summary`, `.utils.safe_extract`. Keep stdlib and lightweight utils per plan Import Inventory.
- [x] T012 [US2] Add lazy imports to `cmd_extract()` in `src/ado_git_repo_insights/cli.py` — import `ConfigurationError`, `load_config`, `ADOClient`, `ExtractionError`, `PRExtractor`, `DatabaseError`, `DatabaseManager`, `RunCounts`, `RunSummary`, `RunTimings`, `create_minimal_summary`, `get_git_sha`, `get_tool_version` at function top, BEFORE the try block
- [x] T013 [US2] Add lazy imports to `cmd_generate_csv()` in `src/ado_git_repo_insights/cli.py` — import `DatabaseError`, `DatabaseManager`, `CSVGenerationError`, `CSVGenerator` at function top, BEFORE the try block
- [x] T014 [US2] Add lazy imports to `cmd_generate_aggregates()` in `src/ado_git_repo_insights/cli.py` — import `DatabaseError`, `DatabaseManager`, `AggregateGenerator`, `AggregationError`, `StubGenerationError` at function top, BEFORE the try block
- [x] T015 [US2] Add lazy imports to `cmd_build_aggregates()` in `src/ado_git_repo_insights/cli.py` — import `DatabaseError`, `DatabaseManager`, `AggregateGenerator`, `AggregationError` at function top, BEFORE the try block
- [x] T016 [US2] Update `main()` exception handlers in `src/ado_git_repo_insights/cli.py` — import `create_minimal_summary` inside each except block (KeyboardInterrupt and Exception)

**Checkpoint**: `ado-insights --help` works. `ado-insights doctor` works. Neither loads pandas, requests, or yaml. All existing tests pass.

---

## Phase 5: PATH Diagnostics Fix (Spec Step 5)

**Goal**: No false PATH warnings in activated virtualenvs

**Stories**: US4 (PATH Diagnostics Are Accurate)

**Independent Test**: Run `ado-insights doctor` inside an activated venv — no false PATH warning

- [x] T017 [P] [US4] Add venv detection (`sys.prefix != sys.base_prefix`) to `cmd_doctor()` PATH check at `src/ado_git_repo_insights/commands/doctor.py:91`
- [x] T018 [P] [US4] Add venv detection to `_check_path_guidance()` in `src/ado_git_repo_insights/cli.py` — suppress PATH warnings when inside activated virtualenv

**Checkpoint**: Doctor does not warn in venv. Doctor still warns for real PATH issues outside venv.

---

## Phase 6: Tests + CI Updates (Spec Step 6)

**Goal**: Every fix has a test. Every exception path is verified. CI thresholds updated.

**Stories**: All (US1-US5)

**Independent Test**: `cd src && pytest` — all pass, zero regressions, zero NameErrors

### Version and Invocation Tests (US1, US5)

- [x] T019 [P] [US1] Add test: `--version` flag exits 0, prints version string (T-01) in `tests/unit/test_cli_args.py`
- [x] T020 [P] [US1] Add test: `--version` output never contains `"0.0.0"` (T-02) in `tests/integration/test_cli_distribution.py`
- [x] T021 [P] [US1] Add test: `python -m ado_git_repo_insights --help` exits 0 (T-03) in `tests/integration/test_cli_distribution.py`
- [x] T022 [P] [US1] Add test: `python -m ado_git_repo_insights --version` exits 0 (T-04) in `tests/integration/test_cli_distribution.py`
- [x] T023 [P] [US5] Add test: `__version__` is not `"0.0.0"` in editable install (T-05) in `tests/unit/test_optional_deps_isolation.py`
- [x] T024 [P] [US5] Add test: version resolves to non-`"unknown (dev)"` in editable install (T-06) in `tests/unit/test_optional_deps_isolation.py`

### Import Safety Tests (US2)

- [x] T025 [P] [US2] Add test: `cli.py` import does NOT load pandas, requests, or yaml (T-07) in `tests/unit/test_optional_deps_isolation.py`

### Parse-Boundary Validation Tests (US3)

- [x] T026 [P] [US3] Add test: `extract --pat x` without org/config exits code 2 (T-08) in `tests/unit/test_cli_exit_code.py`
- [x] T027 [P] [US3] Add test: `extract --pat x --config ...` bypasses org requirement (T-09) in `tests/unit/test_cli_exit_code.py`

### Exception Path Tests (US2 — forced failure, no NameError)

- [x] T028 [P] [US2] Add test: `cmd_extract` ConfigurationError/DatabaseError/ExtractionError paths return 1, no NameError (T-10) in `tests/unit/test_cli_exit_code.py`
- [x] T029 [P] [US2] Add test: `cmd_generate_csv` DatabaseError/CSVGenerationError paths return 1, no NameError (T-11) in `tests/unit/test_cli_exit_code.py`
- [x] T030 [P] [US2] Add test: `cmd_generate_aggregates` DatabaseError/StubGenerationError/AggregationError paths return 1, no NameError (T-12) in `tests/unit/test_cli_exit_code.py`
- [x] T031 [P] [US2] Add test: `cmd_build_aggregates` DatabaseError/AggregationError paths return 1, no NameError (T-13) in `tests/unit/test_cli_exit_code.py`

### PATH Diagnostics Tests (US4)

- [x] T032 [P] [US4] Add test: doctor suppresses PATH warning in active venv (T-14) in `tests/unit/test_doctor.py`
- [x] T033 [P] [US4] Add test: doctor still warns for real PATH issues not in venv (T-15) in `tests/unit/test_doctor.py`

### Cleanup and CI

- [x] T034 [US1] Replace broken `test_cli_version_works` with correct `--version` flag test (T-16) in `tests/unit/test_optional_deps_isolation.py`
- [x] T035 Update `--min-collected` threshold in `.github/workflows/ci.yml` to account for new tests (T-17)

**Checkpoint**: `cd src && pytest` — all pass. `ruff check .` — clean. `mypy src/` — clean. Full 14-gate preflight passes. No `"0.0.0"` in any output. No false PATH warnings.

---

## Dependencies & Execution Order

### Phase Dependencies (Strict Sequential — No Exceptions)

- **Phase 1** (Version + __main__): No dependencies — start immediately
- **Phase 2** (--version flag): Depends on Phase 1 (needs version resolution)
- **Phase 3** (Parse validation): Depends on Phase 2 (modifies main() which Phase 2 also touches)
- **Phase 4** (Lazy imports): Depends on Phase 3 (main() reorder must be stable)
- **Phase 5** (PATH fix): Depends on Phase 4 (lazy imports change what's available at import time)
- **Phase 6** (Tests): Depends on Phases 1-5 (tests validate all changes)

### Within-Phase Parallelism

- **Phase 1**: T001, T002, T003, T004 can run in parallel (different files). T005 can also parallel (different file).
- **Phase 2**: T006 → T007 → T008 are sequential (same file, each depends on previous).
- **Phase 3**: T009 → T010 are sequential (same file, reordering depends on validation block).
- **Phase 4**: T011 must complete first (removes imports). Then T012-T015 can run in parallel if implemented carefully (same file, but different function bodies). T016 after T012-T015.
- **Phase 5**: T017 and T018 can run in parallel (different files).
- **Phase 6**: All test tasks (T019-T033) can run in parallel (different test files). T034-T035 are sequential (cleanup).

---

## Implementation Strategy

### Sequential — Single Developer

1. Complete Phase 1 → Verify `__version__` not `"0.0.0"`
2. Complete Phase 2 → Verify `--version` exits 0
3. Complete Phase 3 → Verify extract exit code 2, no side effects
4. Complete Phase 4 → Verify `--help` doesn't load pandas
5. Complete Phase 5 → Verify doctor in venv
6. Complete Phase 6 → Run full test suite + preflight
7. **STOP**: All 10 success criteria verified. Submit PR.

### Pre-PR Validation (from quickstart.md)

```
[ ] pip install -e .[dev]
[ ] ado-insights --version                          → real version, no 0.0.0
[ ] python -m ado_git_repo_insights --version       → same
[ ] python -m ado_git_repo_insights --help           → no ImportError
[ ] ado-insights doctor                              → no false PATH warning
[ ] ado-insights extract --pat x                     → exit 2, zero side effects
[ ] cd src && pytest                                 → all pass
[ ] ruff check .                                     → clean
[ ] mypy src/                                        → clean
[ ] scripts/run_pr_preflight.py                      → all 14 gates pass
```

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Phase order is a hard gate — deviation requires spec update
- Commit after each phase completion (not after each task)
- Every exception type in an `except` clause has a corresponding import AND forced-failure test
- `"0.0.0"` must not appear in any output — T020, T023 enforce this
- No files outside the In-Scope Boundary (plan Section "In-Scope Files") may be modified
- `config.py` is NOT modified by this feature — `Config.__post_init__` retains its existing validation as defense-in-depth for programmatic callers (spec edge case, FR-020). CLI error messaging lives exclusively in `parser.error()` (FR-019, FR-021)
