# Tasks: Close Suppression Audit Blind Spot

**Input**: Design documents from `/specs/047-close-suppression-blindspot/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md
**Constraints**: Cross-OS (Windows/macOS/Linux). Strictly typed (no `Any` types — use precise types or `object` with protocols). Zero lint warnings. Zero suppressions unless proven required with committed artifact. Enterprise test coverage. Local hooks mirror CI.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Project initialization — no code changes to existing behavior

- [x] T001 Create feature branch `047-close-suppression-blindspot` from main (already done)
- [x] T002 Read and document the verified suppression inventory by running `python scripts/audit-suppressions.py` against expanded scope to establish pre-hardening baseline count

---

## Phase 2: Foundational — Canonical Scope Map (BLOCKS all user stories)

**Purpose**: Refactor `SCOPES` into a single authoritative structure that all scope-dependent behavior derives from. This is the prerequisite for every subsequent phase.

- [x] T003 Refactor `SCOPES` dict in `scripts/audit-suppressions.py` from `dict[str, str]` to a rich typed structure: `dict[str, ScopeConfig]` where `ScopeConfig` is a `TypedDict` with `dir: str`, `pattern: str`, `language: Literal["python", "typescript"]`. Add the 3 new scopes: `python-scripts` (`scripts/`, `*.py`, `python`), `python-tests` (`tests/`, `*.py`, `python`), `python-ci-scripts` (`.github/scripts/`, `*.py`, `python`). Update `FILE_PATTERNS` to derive from the new structure. File: `scripts/audit-suppressions.py`
- [x] T004 Refactor `scan_file()` pattern dispatch (line 251) in `scripts/audit-suppressions.py` to select suppression patterns by looking up `scope.language` from the canonical `SCOPES` structure — no hardcoded if/elif chain. `"python"` → `["type-ignore", "noqa"]`. `"typescript"` → all TS patterns. File: `scripts/audit-suppressions.py`
- [x] T005 Refactor `build_baseline()` scope routing (lines 389-396) in `scripts/audit-suppressions.py` to derive scope from `SCOPES` dict by matching file path prefix against `scope.dir` — no hardcoded `startswith("src/")`, no `"unknown"` fallback. A tracked file matching zero scopes is a hard error. File: `scripts/audit-suppressions.py`
- [x] T006 Refactor `cmd_check_justifications()` (line 790) in `scripts/audit-suppressions.py` to use `scope.language == "python"` from `SCOPES` instead of hardcoded `path.startswith("src/")` for the `--python-only` filter. File: `scripts/audit-suppressions.py`
- [x] T007 [P] Add unit tests for the canonical scope map: (a) every tracked `.py` file resolves to exactly one scope, (b) every tracked `.ts` file resolves to exactly one scope, (c) a file in an unknown directory causes a hard error, (d) scope routing in `build_baseline()` matches scope routing in `scan_file()` for all test files. File: `tests/unit/test_audit_suppressions.py`

**Checkpoint**: `SCOPES` is the single source of truth. `scan_file()`, `build_baseline()`, and `cmd_check_justifications()` all derive from it. All existing tests pass.

---

## Phase 3: User Story 1 — Scanner Produces Trusted Counts (Priority: P1)

**Goal**: Replace regex scanner with tokenize-based scanner. Produce verified census.

**Independent Test**: Create a Python file with `# noqa` inside a string literal and a real `# noqa` on a code line. Run the audit. Only the real one is counted.

### Tests for US1

- [x] T008 [P] [US1] Add regression test: string literal containing `# noqa` is NOT counted as a suppression. Create temp .py file with `msg = "x = 1  # noqa: E501\n"` plus a real `# noqa` comment. Assert count = 1. File: `tests/unit/test_audit_suppressions.py`
- [x] T009 [P] [US1] Add regression test: docstring containing `# type: ignore` is NOT counted. File: `tests/unit/test_audit_suppressions.py`
- [x] T010 [P] [US1] Add regression test: f-string containing `# noqa` is NOT counted. File: `tests/unit/test_audit_suppressions.py`
- [x] T011 [P] [US1] Add regression test: multi-line string with suppression pattern is NOT counted. File: `tests/unit/test_audit_suppressions.py`
- [x] T012 [P] [US1] Add regression test: file with syntax error causes hard error (exit code 1), NOT empty list. Verify error message format is `"[ERROR] Cannot tokenize {file_path}: {error}"`. File: `tests/unit/test_audit_suppressions.py`
- [x] T013 [P] [US1] Add regression test: invoke `audit-suppressions.py` via `subprocess.run` on a file with syntax error — verify exit code 1 is returned (entry-point parity for TokenError). File: `tests/unit/test_audit_suppressions.py`

### Implementation for US1

- [x] T014 [US1] Replace the inner scanning loop in `scan_file()` with `tokenize.generate_tokens(io.StringIO(content).readline)`. Only apply suppression regex patterns to tokens where `tok_type == tokenize.COMMENT`. Use `generate_tokens` (not `tokenize.tokenize`) because file content is already read as `str`. File: `scripts/audit-suppressions.py`
- [x] T015 [US1] Make `tokenize.TokenError` a hard error in `scan_file()`: log `"[ERROR] Cannot tokenize {file_path}: {error}"` to stderr and return a sentinel that causes the audit to exit with code 1. Do NOT return an empty list (silent false negative). Ensure identical behavior across all entry points. File: `scripts/audit-suppressions.py`
- [x] T016 [US1] Run verified census: execute `python scripts/audit-suppressions.py` against all 6 scopes (new scopes included from Phase 2). Document the exact count in a commit message. Expect ~5 fewer than the preliminary 114 due to false-positive elimination in `test_audit_suppressions.py`.

**Checkpoint**: Scanner produces zero false positives. TokenError is a hard failure. Verified census recorded.

---

## Phase 4: User Story 2 — Every Python File Is Audited (Priority: P1)

**Goal**: File-coverage check guarantees no `.py` file escapes the audit. Two-phase gating deployed.

**Independent Test**: Create a `.py` file in an unscoped directory. Coverage check fails naming the file.

### Tests for US2

- [x] T017 [P] [US2] Add test: `--check-coverage` on a temp repo with an unscoped `.py` file returns exit code 1 and lists the uncovered path. File: `tests/unit/test_audit_suppressions.py`
- [x] T018 [P] [US2] Add test: `--check-coverage` on a temp repo where all `.py` files are scoped returns exit code 0. File: `tests/unit/test_audit_suppressions.py`
- [x] T019 [P] [US2] Add test: a `.py` file matching multiple scopes causes a hard error (scope overlap). File: `tests/unit/test_audit_suppressions.py`

### Implementation for US2

- [x] T020 [US2] Implement `cmd_check_coverage()` in `scripts/audit-suppressions.py`: enumerate tracked files via `git ls-files '*.py' '*.ts'` (cross-OS: use `subprocess.run` with list args), match each against `SCOPES` directory prefixes, fail if any file has 0 or >1 scopes. Output uncovered/overlapping file paths on failure. File: `scripts/audit-suppressions.py`
- [x] T021 [US2] Add `--check-coverage` CLI flag to the argparse configuration in `scripts/audit-suppressions.py`, wired to `cmd_check_coverage()`. File: `scripts/audit-suppressions.py`
- [x] T022 [US2] Extend baseline schema to v2: add `scope_policy: dict[str, Literal["blocking", "advisory"]]` field to `SuppressionBaseline` TypedDict. Default existing scopes to `"blocking"`, new scopes to `"advisory"`. Bump `SCHEMA_VERSION` from 1 to 2. File: `scripts/audit-suppressions.py`
- [x] T023 [US2] Update `validate_baseline()` to validate v2 fields: `scope_policy` must exist (for v2), all scope names must match `by_scope` keys, values must be `"blocking"` or `"advisory"` only. Backward-compatible: v1 baselines (no `scope_policy`) treated as all-blocking. File: `scripts/audit-suppressions.py`
- [x] T024 [US2] Update `cmd_diff()` to check `scope_policy` per file: advisory scopes log warnings but do not fail. Add v1→v2 transition fallback: scopes present in scan but absent from baseline are treated as `count=0, policy="advisory"` with warning message `"Scope '{name}' not in baseline — treating as advisory (v1→v2 transition)"`. File: `scripts/audit-suppressions.py`
- [x] T025 [US2] Add advisory→blocking transition message to `cmd_diff()`: when a suppression increase is in a scope that was recently promoted, include `"Note: scope '{name}' was recently promoted from advisory to blocking enforcement."` File: `scripts/audit-suppressions.py`

### Tests for US2 (two-phase gating)

- [x] T026 [P] [US2] Add test: advisory scope with suppressions logs warning but returns exit code 0. File: `tests/unit/test_audit_suppressions.py`
- [x] T027 [P] [US2] Add test: blocking scope with suppressions returns exit code 1. File: `tests/unit/test_audit_suppressions.py`
- [x] T028 [P] [US2] Add test: v1 baseline (no `scope_policy`) is treated as all-blocking by `cmd_diff()`. File: `tests/unit/test_audit_suppressions.py`
- [x] T029 [P] [US2] Add test: scope in scan but absent from baseline is treated as advisory during transition. File: `tests/unit/test_audit_suppressions.py`

**Checkpoint**: Every `.py` file is in exactly one scope. New scopes report advisory warnings. Coverage check works cross-OS.

---

## Phase 5: User Story 4 — Gate Parity Across All Entry Points (Priority: P2)

**Goal**: Register all new checks in pre-commit, preflight, and CI with precise per-tier contracts.

**Independent Test**: Add a suppression to `scripts/`, run pre-commit and the CI command — both detect it.

### Implementation for US4

- [x] T030 [US4] Add staged-subset scope check to pre-commit in `scripts/run_repo_hook.py`: new `run_scope_coverage_guard()` function that iterates `staged_paths()`, matches each `.py`/`.ts` file against `SCOPES` directory prefixes, fails if any staged file is unscoped. Add call in `run_pre_commit_hook()`. File: `scripts/run_repo_hook.py`
- [x] T031 [US4] Add full `--check-coverage` CommandSpec to `scripts/run_pr_preflight.py` in `build_commands()`. File: `scripts/run_pr_preflight.py`
- [x] T032 [US4] Add `--check-coverage` step to the suppression-audit CI job in `.github/workflows/ci.yml`. File: `.github/workflows/ci.yml`
- [x] T033 [P] [US4] Add scope-parity test: import `SCOPES` from `audit-suppressions.py`, verify the scope names match what CI workflow references, and verify pre-commit staged-subset check uses the same `SCOPES` map. File: `tests/unit/test_audit_suppressions.py`

### Tests for US4

- [x] T034 [P] [US4] Add test: staged file in an unscoped directory causes pre-commit to fail. Mock `staged_paths()` to return a path outside all scopes. File: `tests/unit/test_hook_triggers.py` or `tests/unit/test_audit_suppressions.py`

**Checkpoint**: Pre-commit checks staged files are in known scopes. Preflight/CI verify full repo coverage. Scope list is the single source of truth.

---

## Phase 6: User Story 5 — Rule Disabling With Proof and Guardrails (Priority: P2)

**Goal**: Disable S603/S311/S607 with machine-readable proof, compensating guardrails, and CI verification.

**Independent Test**: After disabling S603, add `subprocess.run(cmd, shell=True)` to `src/`. Guardrail catches it.

### Implementation for US5 — Proof Artifacts

- [ ] T035 [US5] Create script to generate `.rule-disable-audit-S603.json`: walk all `.py` files via `git ls-files`, use `tokenize.generate_tokens` to find `subprocess.run/Popen/call` call sites, classify each by shell mode and argument type (literal list vs variable). Output: file, line, code snippet, safety classification. File: `scripts/check_rule_disable_invariants.py`
- [ ] T036 [US5] Extend the script to generate `.rule-disable-audit-S311.json`: find all `random.*` usages, classify by purpose (seeded deterministic vs crypto). File: `scripts/check_rule_disable_invariants.py`
- [ ] T037 [US5] Run both generators, review output, commit artifacts: `.rule-disable-audit-S603.json` and `.rule-disable-audit-S311.json`

### Implementation for US5 — Guardrails

- [ ] T038 [US5] Implement S603 compensating guardrail in `scripts/check_rule_disable_invariants.py`: `--check-subprocess` mode detects `subprocess.run/Popen/call` with `shell=True` or non-literal first argument. Uses `tokenize.generate_tokens` on string content (compatible with `staged_file_content()` which returns `str`). Scans full tree for preflight/CI. File: `scripts/check_rule_disable_invariants.py`
- [ ] T039 [US5] Implement S311 compensating guardrail: `--check-random` mode detects `import secrets`, `os.urandom`, `random.SystemRandom`, or `random.Random()` without a seed argument in any file that also imports `random`. File: `scripts/check_rule_disable_invariants.py`
- [ ] T040 [US5] Implement `--verify-artifacts` mode: regenerate audit artifacts into temp files, compare against committed artifacts (JSON-level comparison ignoring `generated_at`), fail if divergent. File: `scripts/check_rule_disable_invariants.py`
- [ ] T041 [US5] Register guardrail in pre-commit: add `run_rule_disable_invariants_guard()` to `scripts/run_repo_hook.py` — iterate `staged_paths()`, read with `staged_file_content()`, check S603+S311 patterns on staged content. File: `scripts/run_repo_hook.py`
- [ ] T042 [US5] Register guardrail in preflight: add `CommandSpec` for `check_rule_disable_invariants.py --check-subprocess --check-random` in `scripts/run_pr_preflight.py`. File: `scripts/run_pr_preflight.py`
- [ ] T043 [US5] Register guardrail in CI: add `rule-disable-invariants` job to `.github/workflows/ci.yml` with `--check-subprocess --check-random --verify-artifacts`. File: `.github/workflows/ci.yml`

### Implementation for US5 — Rule Disable

- [ ] T044 [US5] Add S603, S311, S607 to ruff `ignore` list in `pyproject.toml` with inline documentation comments explaining justification and pointing to proof artifacts. Verify S602 remains in `select`. File: `pyproject.toml`
- [ ] T045 [US5] Remove all `# noqa: S603` comments across the entire repo (~59 occurrences in scripts/ and tests/). Verify `ruff check` passes. Files: all files listed in suppression inventory
- [ ] T046 [US5] Remove all `# noqa: S311` comments (~5 in scripts/). Verify `ruff check` passes. Files: `scripts/generate-demo-data.py`, `scripts/generate-synthetic-dataset.py`
- [ ] T047 [US5] Remove all `# noqa: S607` comments (2 in `scripts/check-version-unchanged.py`). Refactor to use `shutil.which("git")` with assertion that result is not `None`. Verify `ruff check` passes. File: `scripts/check-version-unchanged.py`

### Tests for US5

- [ ] T048 [P] [US5] Add test: simulated `shell=True` in a temp file is caught by S603 guardrail. File: `tests/unit/test_rule_disable_invariants.py`
- [ ] T049 [P] [US5] Add test: simulated `import secrets` alongside `import random` is caught by S311 guardrail. File: `tests/unit/test_rule_disable_invariants.py`
- [ ] T050 [P] [US5] Add test: stale proof artifact (doesn't match codebase) causes `--verify-artifacts` to fail. File: `tests/unit/test_rule_disable_invariants.py`
- [ ] T051 [P] [US5] Add cross-OS test: guardrail script handles both forward-slash and backslash paths in output (Windows compatibility). File: `tests/unit/test_rule_disable_invariants.py`

**Checkpoint**: S603/S311/S607 disabled with committed proof, passing guardrails, and regression tests. ~66 suppressions removed.

---

## Phase 7: User Story 3 — Extend mypy + Type Cleanup (Priority: P1, depends on Phase 6)

**Goal**: Extend mypy to tests/ and scripts/ as permanent steady-state. Resolve all type:ignore suppressions with strictly typed replacements (no `Any`).

**Independent Test**: `mypy src/ tests/ scripts/` passes with zero errors and zero type:ignore comments.

### Implementation for US3 — mypy Extension (Phase D-0)

- [ ] T052 [US3] Remove `"^scripts/"` from mypy `exclude` list in `pyproject.toml`. This is permanent — scripts/ is in steady-state mypy scope. File: `pyproject.toml`
- [ ] T053 [US3] Add `[[tool.mypy.overrides]]` for `"tests.*"` in `pyproject.toml` with pragmatic settings: `disallow_untyped_defs = false`, `disallow_untyped_calls = false`, `check_untyped_defs = false`. Keep `strict = true` for `src/`. Add similar override for `"scripts.*"` if needed. File: `pyproject.toml`
- [ ] T054 [US3] Change mypy invocation in CI from `mypy src/` to `mypy src/ tests/ scripts/`. File: `.github/workflows/ci.yml`
- [ ] T055 [US3] Change mypy invocation in preflight from `mypy src/` to `mypy src/ tests/ scripts/`. File: `scripts/run_pr_preflight.py`
- [ ] T056 [US3] Fix all mypy errors surfaced in tests/ and scripts/ by the extended scope. Do NOT add `type: ignore` — fix the code. This may require adding return type annotations, parameter types, or import stubs. Track the count of fixes.

**Checkpoint**: `mypy src/ tests/ scripts/` passes. type:ignore removals in Phase D will be mechanically verified.

### Implementation for US3 — Typed Test Doubles (no `Any` — use precise types)

- [ ] T057 [P] [US3] Create `FakeProphetModule(ModuleType)` in `tests/conftest.py` with `Prophet: MagicMock` attribute annotation (not `type[MagicMock]` — the value is an instance, not a type; not `Any` — QG-40 forbids it; not `object` — loses callable info needed by downstream `fake_module.Prophet(...)`). See research.md R-006 Pattern 1. File: `tests/conftest.py`
- [ ] T058 [P] [US3] Create `FakeOpenAIModule(ModuleType)` in `tests/conftest.py` with `OpenAI: MagicMock` attribute annotation. Same pattern as T057. See research.md R-006 Pattern 1. File: `tests/conftest.py`
- [ ] T059 [P] [US3] Create `FakeStdin(io.StringIO)` in `tests/conftest.py` with `def fileno(self) -> int: return 0`. File: `tests/conftest.py`
- [ ] T060 [US3] Update `tests/integration/test_phase5_ml_integration.py` to use `FakeProphetModule` and `FakeOpenAIModule` fixtures. Remove all `type: ignore[attr-defined]` comments (2 occurrences). Verify mypy passes. File: `tests/integration/test_phase5_ml_integration.py`
- [ ] T061 [P] [US3] Update `tests/unit/test_forecaster_contract.py` to use `FakeProphetModule` fixture. Remove `type: ignore[attr-defined]` (1 occurrence). File: `tests/unit/test_forecaster_contract.py`
- [ ] T062 [P] [US3] Update `tests/unit/test_insights_contract.py` to use `FakeOpenAIModule` fixture. Remove `type: ignore[attr-defined]` (2 occurrences). File: `tests/unit/test_insights_contract.py`
- [ ] T063 [P] [US3] Update `tests/unit/test_insights_id_stability.py` to use `FakeOpenAIModule` fixture. Remove `type: ignore[attr-defined]` (2 occurrences). File: `tests/unit/test_insights_id_stability.py`
- [ ] T064 [US3] Update `tests/unit/test_cli_dashboard.py` to use `FakeStdin` instead of `mock_stdin.fileno = lambda: 0`. Remove all `type: ignore[assignment]` comments (3 occurrences, lines 530, 565, 620). File: `tests/unit/test_cli_dashboard.py`
- [ ] T065 [US3] Fix Thread wrapper `type: ignore[arg-type]` at `tests/unit/test_cli_dashboard.py:585`: define `_ThreadKwargs(TypedDict, total=False)` with fields matching `threading.Thread.__init__` (group, target, name, args, kwargs, daemon). Use `typing_extensions.Unpack` (guarded by `TYPE_CHECKING` — needed for Python 3.10). Change wrapper to `def _selective_thread(**kwargs: Unpack[_ThreadKwargs])`. No `Any` types. See research.md R-006 Pattern 2. File: `tests/unit/test_cli_dashboard.py`

### Implementation for US3 — Code Refactoring (remaining suppressions)

- [ ] T066 [P] [US3] Rename S105-triggering variables in `tests/unit/test_ado_client_pagination.py`: `malicious_token` → `malicious_continuation`, `token_with_equals` → `continuation_with_equals`, `token_with_special` → `continuation_with_special`. Remove `# noqa: S105` (3 occurrences). File: `tests/unit/test_ado_client_pagination.py`
- [ ] T067 [P] [US3] Rename S105-triggering variables in `tests/unit/test_pagination_helper.py`: `token` → `continuation_marker` (4 context-specific locations). Remove `# noqa: S105` (4 occurrences). File: `tests/unit/test_pagination_helper.py`
- [ ] T068 [P] [US3] Rename S105-triggering variables in `tests/integration/test_stage_artifacts.py`: `malicious_token` → `malicious_continuation`, `token_with_space` → `continuation_with_space`, `token` → `continuation_marker`. Remove `# noqa: S105` (3 occurrences). File: `tests/integration/test_stage_artifacts.py`
- [ ] T069 [US3] Refactor `scripts/generate-demo-data.py`: replace `sys.path.insert` with `importlib.util.spec_from_file_location()` for `demo_generation_common` (proven pattern from `manage_generated_artifacts.py:26-33`). Remove `sys.path.insert` call. For `ado_git_repo_insights` imports, rely on installed package (remove sys.path hack). Remove all `# noqa: E402`, `# noqa: I001`, `# type: ignore[import-untyped]` comments. Verify script produces identical output before/after. File: `scripts/generate-demo-data.py`
- [ ] T070 [US3] Refactor `scripts/generate-synthetic-dataset.py`: same importlib pattern as T069. Remove all `# noqa: E402`, `# type: ignore[import-not-found]` comments. Verify identical output. File: `scripts/generate-synthetic-dataset.py`
- [ ] T071 [P] [US3] Refactor `scripts/check_coverage_delta.py`: replace `import defusedxml.ElementTree as ET` with `from defusedxml.ElementTree import parse` (audit which `ET.*` functions are used, import each). Remove `# noqa: N817`. File: `scripts/check_coverage_delta.py`
- [ ] T072 [P] [US3] Refactor `.github/scripts/generate-badge-json.py`: `from defusedxml.ElementTree import parse, ParseError` (and any other used functions). Remove `# noqa: N817`. File: `.github/scripts/generate-badge-json.py`
- [ ] T073 [P] [US3] Refactor `.github/scripts/get-coverage-actuals.py`: same as T072. File: `.github/scripts/get-coverage-actuals.py`
- [ ] T074 [P] [US3] Refactor `.github/scripts/validate-test-results.py`: same as T072. File: `.github/scripts/validate-test-results.py`
- [ ] T075 [P] [US3] Fix F841 in `tests/performance/test_chart_render.py`: add assertions on `upper_bounds` and `lower_bounds` (e.g., `assert upper_bounds is not None`). Remove `# noqa: F841` (2 occurrences). File: `tests/performance/test_chart_render.py`
- [ ] T076 [P] [US3] Fix F841 in `tests/unit/test_install_detection.py`: call `detect_installation_method()` directly without assigning result, or assert on return type. Remove `# noqa: F841`. File: `tests/unit/test_install_detection.py`
- [ ] T077 [P] [US3] Fix F401 in `tests/unit/test_cli_serve_flags.py`: remove bare `import pytest` (fixtures resolve without explicit import). Remove `# noqa: F401`. File: `tests/unit/test_cli_serve_flags.py`
- [ ] T078 [P] [US3] Fix F401 in `tests/unit/test_optional_deps_isolation.py` (2 occurrences): replace bare `import ado_git_repo_insights.cli` and `import ado_git_repo_insights.ml.forecaster` with `importlib.import_module()`. Remove `# noqa: F401`. File: `tests/unit/test_optional_deps_isolation.py`
- [ ] T079 [P] [US3] Fix S310 in `tests/demo/test_base_path.py`: replace `urllib.request.urlopen` with `requests.get` (requests is already a dependency). Remove `# noqa: S310` on line 68 AND the S310 comment on line 67. File: `tests/demo/test_base_path.py`
- [ ] T080 [P] [US3] Fix S310 in `.github/scripts/verify-badge-url.py`: replace `urllib.request.urlopen` with `requests.get` with timeout. Remove `# noqa: S310`. File: `.github/scripts/verify-badge-url.py`
- [ ] T081 [P] [US3] Fix ANN in `tests/unit/test_aggregators.py:3229`: spell out the full signature matching `_generate_team_repo_slice`: `def patched(self_gen: AggregateGenerator, week_group: pd.DataFrame, week_reviewers: pd.DataFrame, team_members_df: pd.DataFrame) -> dict[str, object]:`. Update the call to `original()` to pass named args. Remove `# noqa: ANN001,ANN002,ANN003`. See research.md R-006 Pattern 3. File: `tests/unit/test_aggregators.py`
- [ ] T082 [P] [US3] Fix ANN in `tests/unit/test_fallback_forecaster.py:1088`: add `import numpy.typing as npt` and annotate `def mock_polyfit(x: npt.ArrayLike, y: npt.ArrayLike, deg: int) -> npt.NDArray[np.float64]:`. Matches `numpy.polyfit` signature. Remove `# noqa: ANN001`. See research.md R-006 Pattern 4. File: `tests/unit/test_fallback_forecaster.py`
- [ ] T083 [P] [US3] Fix S110 in `tests/unit/test_secret_redaction.py:126`: replace `try/except: pass` with `with contextlib.suppress(Exception):`. Remove `# noqa: S110`. File: `tests/unit/test_secret_redaction.py`
- [ ] T084 [US3] Add sys.path guard: grep-based CI check (or add to guardrail script) that fails if `sys.path.insert` or `sys.path.append` appears in any tracked `.py` file outside `conftest.py`. Add regression test. File: `scripts/check_rule_disable_invariants.py`

**Checkpoint**: All suppressions in new scopes resolved. `ruff check` clean. `mypy src/ tests/ scripts/` clean. All tests pass. Zero `Any` types added.

---

## Phase 8: Gate Activation + Baseline Finalization (All stories)

**Purpose**: Switch from advisory to blocking. Establish baseline merge safety. Remove transition code.

- [ ] T085 Regenerate baseline with all 6 scopes at 0, all policies set to `"blocking"`: run `python scripts/audit-suppressions.py --update-baseline`. Verify `by_scope` shows 0 for all 6 scopes. Commit. File: `.suppression-baseline.json`
- [ ] T086 Implement baseline staleness CI check in `scripts/audit-suppressions.py`: add `--check-staleness` flag that regenerates baseline into temp, performs JSON-level comparison ignoring `generated_at` field, fails if any other field differs. File: `scripts/audit-suppressions.py`
- [ ] T087 [P] Add test for staleness check: modify a `by_scope` value in temp baseline, verify `--check-staleness` fails. File: `tests/unit/test_audit_suppressions.py`
- [ ] T088 Register baseline staleness check in preflight: add `CommandSpec` for `--check-staleness`. File: `scripts/run_pr_preflight.py`
- [ ] T089 Register baseline staleness check in CI: add step to suppression-audit job. File: `.github/workflows/ci.yml`
- [ ] T090 Remove v1→v2 transition fallback: delete the code path in `cmd_diff()` that treats missing scopes as advisory. After this, a scope present in scan but absent from baseline is a hard error. File: `scripts/audit-suppressions.py`
- [ ] T091 [P] Add test: after fallback removal, a scope present in scan but missing from baseline causes exit code 1. File: `tests/unit/test_audit_suppressions.py`

**Checkpoint**: All scopes blocking. Baseline staleness CI-enforced. Transition fallback removed.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, parity records, final verification

- [ ] T092 Update `LOCAL_CI_PARITY_INVARIANTS.md`: add rows for file-coverage check (Tier 1 pre-commit staged-subset + Tier 2 full-tree), rule-disable-invariants guardrail (Tier 1 + Tier 2), baseline staleness check (Tier 2). Update suppression-audit row to reflect 6 scopes. Document baseline merge/regeneration protocol. File: `LOCAL_CI_PARITY_INVARIANTS.md`
- [ ] T093 [P] Run full verification suite and document results: `audit-suppressions.py --diff`, `--check-coverage`, `--check-staleness`, `check_rule_disable_invariants.py`, `run_pr_preflight.py`, `ruff check`, `mypy src/ tests/ scripts/`, full pytest, full Jest. Verify SC-006: grep `pyproject.toml` for `per-file-ignores` and confirm the section is absent or empty. All must pass.
- [ ] T094 [P] Cross-OS verification: run `python scripts/audit-suppressions.py --check-coverage` on Windows to verify `git ls-files` output uses forward slashes after normalization. Verify all path comparisons in the audit tool handle both `/` and `\`. File: `scripts/audit-suppressions.py` (verify `normalize_path()`)
- [ ] T095 [P] Verify zero suppressions via final audit run: `python scripts/audit-suppressions.py` — total must be 0 across all 6 scopes, matching the committed baseline.
- [ ] T096 Close GitHub issue #232 with summary of changes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational — scope map)**: Depends on Phase 1. **BLOCKS all user stories.**
- **Phase 3 (US1 — scanner)**: Depends on Phase 2
- **Phase 4 (US2 — coverage + gating)**: Depends on Phase 2. Can run in parallel with Phase 3.
- **Phase 5 (US4 — parity)**: Depends on Phase 4
- **Phase 6 (US5 — guardrails)**: Depends on Phase 2. Can run in parallel with Phases 3-5.
- **Phase 7 (US3 — mypy + cleanup)**: Depends on Phases 3, 4, 5, 6 (all prior phases)
- **Phase 8 (Gate activation)**: Depends on Phase 7
- **Phase 9 (Polish)**: Depends on Phase 8

### User Story Dependencies

- **US1 (Scanner)**: Depends on foundational scope map only
- **US2 (Coverage)**: Depends on foundational scope map only — can parallel with US1
- **US4 (Parity)**: Depends on US2 (needs coverage check to register)
- **US5 (Guardrails)**: Depends on foundational scope map — can parallel with US1/US2
- **US3 (Cleanup)**: Depends on US1 + US2 + US4 + US5 (needs scanner, scopes, parity, guardrails all in place)

### Parallel Opportunities

```text
Phase 2 complete →
  ├── Phase 3 (US1: scanner) ──────────────┐
  ├── Phase 4 (US2: coverage + gating) ─── Phase 5 (US4: parity) ──┐
  └── Phase 6 (US5: guardrails) ───────────────────────────────────┤
                                                                    ↓
                                                     Phase 7 (US3: cleanup)
                                                            ↓
                                                     Phase 8 (activation)
                                                            ↓
                                                     Phase 9 (polish)
```

---

## Implementation Strategy

### MVP First (Phases 1-4)

1. Phase 1: Setup
2. Phase 2: Canonical scope map (CRITICAL — blocks everything)
3. Phase 3: Scanner hardening + verified census
4. Phase 4: File coverage + two-phase gating
5. **STOP and VALIDATE**: Every `.py` file is audited. Scanner is trusted. Two-phase gating works.

### Incremental Delivery

1. MVP (Phases 1-4) → Scanner trusted, coverage complete
2. Add US4 parity (Phase 5) → Hooks registered
3. Add US5 guardrails (Phase 6) → Rules safely disabled, ~66 suppressions removed
4. Add US3 cleanup (Phase 7) → All remaining suppressions resolved
5. Activate gates (Phase 8) → Zero-tolerance enforced
6. Polish (Phase 9) → Documentation, cross-OS verification, issue closed

---

## Notes

- **No `Any` types**: All typed doubles use precise types (`type[MagicMock]`, `object`, precise parameter signatures). The Thread wrapper uses an explicit signature matching `threading.Thread.__init__`.
- **Cross-OS**: `git ls-files` for file enumeration. `normalize_path()` for slash normalization. All `subprocess.run` calls use list args (no shell). Verified on Windows in Phase 9.
- **tokenize API**: Use `tokenize.generate_tokens(io.StringIO(content).readline)` — not `tokenize.tokenize()` — because content from `staged_file_content()` is already `str`, not bytes.
- **Baseline staleness**: JSON-level comparison via `--check-staleness` flag, ignoring `generated_at` field. Not text-level diff.
- **Phase E commit ordering**: Baseline regen (T085) must be committed BEFORE fallback removal (T090). T090 is a code change that depends on T085's baseline being on main.
- **`cmd_check_justifications()` (line 790)**: Third hardcoded scope site — fixed in T006 to use canonical scope map.
