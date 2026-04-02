# Implementation Plan: Close Suppression Audit Blind Spot

**Branch**: `047-close-suppression-blindspot` | **Date**: 2026-04-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/047-close-suppression-blindspot/spec.md`
**Reviewed by**: 4-specialist team (2026-04-02). All blockers and high-probability risks addressed below.

## Summary

Expand the suppression audit from 3 scopes to 6, covering all Python files in the repository. Resolve all existing suppressions (~114 verified by auditor, verified census via hardened scanner TBD) through code refactoring and justified rule configuration. Introduce two-phase gating, file-coverage enforcement, tokenize-based scanner hardening, compensating guardrails for disabled rules, mypy extension to `tests/`, and regression tests for each root-cause fix.

## Technical Context

**Language/Version**: Python 3.10+ (audit tool, scripts, tests), TypeScript 5.x (extension — read-only for this feature)
**Primary Dependencies**: ruff 0.15.x (linting), mypy 1.20.x (type checking), pytest 9.x (testing), tokenize (stdlib)
**Storage**: `.suppression-baseline.json` (v1→v2 schema migration), `.rule-disable-audit-*.json` (new artifacts)
**Testing**: pytest (Python), Jest (extension — unchanged)
**Target Platform**: Windows 11 (local dev), Ubuntu Latest (CI)
**Project Type**: CLI tool + Azure DevOps extension (hybrid Python/TypeScript)
**Constraints**: Every intermediate commit must pass all existing gates. No per-file-ignores. No temporary relaxations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Evidence |
|------|--------|----------|
| QG-17 Lint + format | WILL SATISFY | All suppressions removed; ruff passes clean |
| QG-18 Type checking | WILL SATISFY | All type:ignore removed; mypy extended to tests/; mypy --strict passes on src/ + tests/ |
| QG-19 Unit + integration tests | WILL SATISFY | No test behavior changes; regression tests added |
| QG-35 Every CI check has local equivalent | WILL SATISFY | New guardrail script callable from all entry points (FR-021) |
| QG-36 No weaker local mode | WILL SATISFY | Same script, same logic, same scope list (FR-015) |
| QG-37 New CI check requires local gate + doc | WILL SATISFY | Guardrail added to pre-commit, preflight, CI + LOCAL_CI_PARITY_INVARIANTS.md updated |
| QG-38 --no-verify forbidden | N/A | No hooks bypassed |

**Post-design re-check**: All gates satisfiable. No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/047-close-suppression-blindspot/
├── plan.md              # This file
├── research.md          # Phase 0 output (R-001 through R-006)
├── data-model.md        # Phase 1 output (baseline v2, scopes, artifacts)
├── quickstart.md        # Phase 1 output
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
scripts/
├── audit-suppressions.py          # MODIFIED: tokenize scanner, file coverage, scope expansion, v2 baseline
├── check_rule_disable_invariants.py  # NEW: compensating guardrails for S603/S311
├── run_repo_hook.py               # MODIFIED: register new guards
├── run_pr_preflight.py            # MODIFIED: register new CommandSpec entries
├── generate-demo-data.py          # MODIFIED: importlib refactoring (E402/I001/type:ignore)
├── generate-synthetic-dataset.py  # MODIFIED: importlib refactoring
├── check_coverage_delta.py        # MODIFIED: N817 (defusedxml import)
├── check-version-unchanged.py     # MODIFIED: S607 (shutil.which for git)
└── demo_generation_common.py      # UNCHANGED (loaded via importlib.util)

.github/scripts/
├── generate-badge-json.py         # MODIFIED: N817
├── get-coverage-actuals.py        # MODIFIED: N817
├── validate-test-results.py       # MODIFIED: N817
└── verify-badge-url.py            # MODIFIED: S310 (requests.get)

tests/
├── conftest.py                    # MODIFIED: FakeProphetModule, FakeOpenAIModule, FakeStdin
├── unit/
│   ├── test_audit_suppressions.py # MODIFIED: scanner false-positive regression tests
│   ├── test_cli_dashboard.py      # MODIFIED: use FakeStdin
│   ├── test_aggregators.py        # MODIFIED: ANN annotations
│   ├── test_fallback_forecaster.py # MODIFIED: ANN annotations
│   ├── test_ado_client_pagination.py # MODIFIED: S105 variable renames
│   ├── test_pagination_helper.py  # MODIFIED: S105 variable renames
│   ├── test_cli_serve_flags.py    # MODIFIED: remove unused pytest import
│   ├── test_optional_deps_isolation.py # MODIFIED: importlib for F401
│   ├── test_install_detection.py  # MODIFIED: F841 fix
│   ├── test_secret_redaction.py   # MODIFIED: contextlib.suppress for S110
│   ├── test_coverage_delta.py     # MODIFIED: S603 noqa removal (after global disable)
│   └── test_rule_disable_invariants.py # NEW: guardrail regression tests
├── performance/
│   └── test_chart_render.py       # MODIFIED: F841 (assert on bounds)
├── integration/
│   ├── test_stage_artifacts.py    # MODIFIED: S105 variable renames
│   ├── test_phase5_ml_integration.py # MODIFIED: use typed fixture
│   └── test_cli_distribution.py   # MODIFIED: S603 noqa removal
├── demo/
│   ├── test_base_path.py          # MODIFIED: S310 (requests.get) + S310 comment cleanup
│   ├── test_regeneration.py       # MODIFIED: S603 noqa removal
│   └── test_demo_parity_pipeline.py # MODIFIED: S603 noqa removal
└── unit/
    └── test_forecaster_contract.py # MODIFIED: use typed fixture
    └── test_insights_contract.py   # MODIFIED: use typed fixture
    └── test_insights_id_stability.py # MODIFIED: use typed fixture

Root files:
├── pyproject.toml                 # MODIFIED: S603, S311, S607 added to ruff ignore
├── .suppression-baseline.json     # MODIFIED: v2 schema, 6 scopes, baseline 0
├── .rule-disable-audit-S603.json  # NEW: full-tree subprocess audit artifact
├── .rule-disable-audit-S311.json  # NEW: full-tree random audit artifact
├── .github/workflows/ci.yml      # MODIFIED: new rule-disable-invariants job
└── LOCAL_CI_PARITY_INVARIANTS.md  # MODIFIED: new gate rows
```

**Structure Decision**: Extends existing structure. No new directories created. All changes are modifications to existing files or new files in existing directories.

## Implementation Phases

### Phase A: Scanner Hardening + Verified Census (US1, FR-006, FR-013, FR-022)

**Goal**: Produce trusted suppression counts before any cleanup work begins.

1. **Replace regex scanner with tokenize-based scanner** in `audit-suppressions.py`
   - Modify `scan_file()`: use `tokenize.tokenize()` to iterate tokens
   - Only apply suppression regex patterns to `tokenize.COMMENT` tokens
   - **[G4] tokenize.TokenError is a HARD ERROR, not a silent skip**: if a `.py` file cannot be tokenized, the scanner MUST log an error with the file path and return exit code 1 from the audit. A silently skipped file produces a false negative (zero suppressions reported for a file that may contain them). The only exception is files explicitly in EXCLUDED_DIRS.
   - **TokenError entry-point parity**: the hard-error behavior MUST be identical across pre-commit, preflight, and CI. Same exit code (1), same error message format (`"[ERROR] Cannot tokenize {file_path}: {error}"`), same semantics (audit fails, file is not silently excluded). This is inherent because all three entry points call the same `scan_file()` function — but a regression test MUST verify that a file with a syntax error causes the audit to return exit code 1 when invoked via `subprocess.run` (the same way pre-commit/preflight invoke it).
   - Preserve all existing scan logic (scope filtering, pattern matching, rule extraction)

2. **Add scanner false-positive regression tests** to `test_audit_suppressions.py`
   - Test: string literal containing `# noqa` → not counted
   - Test: docstring containing `# type: ignore` → not counted
   - Test: real comment + string literal with same pattern → only real counted
   - Test: f-string containing `# noqa` → not counted
   - Test: multi-line string with suppression pattern → not counted
   - Test: file with syntax error → scanner returns hard error, not empty list

3. **Run verified census**: execute hardened scanner against full expanded scope, record exact count
   - **[G9 from Auditor] Expect count delta**: the preliminary ~114 count includes ~5 false positives from string literals in `test_audit_suppressions.py`. The verified census will be lower. This is correct — document the delta.

**Exit criterion**: Scanner produces zero false positives on known test cases. TokenError is a hard failure. Verified census recorded.

### Phase B: Scope Expansion + File Coverage + Two-Phase Gating (US2, US4, FR-001, FR-015, FR-018, FR-019)

**Goal**: All Python files are audited; new scopes deployed in non-blocking mode.

1. **Add 3 new scopes** to `SCOPES` and `FILE_PATTERNS` in `audit-suppressions.py`
   - `python-scripts`: `scripts/` → `*.py`
   - `python-tests`: `tests/` → `*.py`
   - `python-ci-scripts`: `.github/scripts/` → `*.py`

2. **[R1+R2] Canonical scope map — single source of truth for all scope behavior**
   - The `SCOPES` dict is the ONE authoritative structure. Both `scan_file()` (pattern dispatch) and `build_baseline()` (scope routing) MUST derive their behavior from `SCOPES` — neither may define scope behavior independently.
   - **Add `SCOPE_LANGUAGE` mapping** derived from scope names: `{"python-*": "python", "typescript-*": "typescript"}`. Or add a `language` field to the SCOPES structure itself: `SCOPES = {"python-scripts": {"dir": "scripts/", "pattern": "*.py", "language": "python"}, ...}`.
   - `scan_file()` selects suppression patterns by looking up the scope's language from this canonical structure — no hardcoded if/elif chain, no fallback to `"unknown"`.
   - `build_baseline()` maps file paths to scopes by matching against `SCOPES` directory prefixes — no hardcoded `startswith("src/")`, no `"unknown"` fallback. A tracked Python file that matches zero scopes is a **hard error** (means the scope list is incomplete — same failure mode as `--check-coverage`).
   - This ensures scope routing cannot diverge between scanning and baseline building.

3. **Implement file-coverage check** (`--check-coverage` flag)
   - New `cmd_check_coverage()` function
   - Walk repo tree, collect all `.py` and `.ts` files
   - **[G3] Canonical exclusion list**: merge `EXCLUDED_DIRS` with additional directories that commonly contain generated `.py` files: `.mypy_cache`, `htmlcov`, `run_artifacts`, `eggs`, `.tox`, `.nox`, `.pytest_cache`. Alternatively, use `git ls-files` to enumerate only tracked files (respects `.gitignore` by definition). Using `git ls-files '*.py'` is the most robust approach — it cannot produce false positives from generated/cached files.
   - For each file, check which scope(s) match by directory prefix
   - Fail if any file has 0 scopes or >1 scope
   - **[G1] Register in preflight and CI ONLY — not pre-commit.** Pre-commit operates on staged files only (`staged_paths()` via `git diff --cached`). A full-tree walk violates the staged-only contract. In pre-commit, at most check that each staged `.py`/`.ts` file belongs to a known scope (staged-subset coverage, not full-tree enumeration).

4. **Extend baseline to v2** with `scope_policy`
   - Add `scope_policy` field to `SuppressionBaseline` TypedDict
   - Update `build_baseline()` to include scope policy (default all existing to `"blocking"`, new scopes to `"advisory"`)
   - Update `validate_baseline()` for v2 schema
   - Update `cmd_diff()`: check scope policy per file; `"advisory"` scopes log warnings but return 0
   - **[R3] v1→v2 baseline transition behavior**: when `cmd_diff()` encounters scopes present in the current scan but absent from the baseline (e.g., preflight fetches origin/main which still has v1 baseline with 3 scopes), treat missing scopes as `count=0, policy="advisory"`. This prevents the preflight gate from hard-failing during the transition period. Log a warning: "Scope 'python-scripts' not in baseline — treating as advisory (v1→v2 transition)."
   - **v1→v2 transition exit condition**: the missing-scope-as-advisory fallback is temporary. It MUST be removed in Phase E when the v2 baseline with all 6 scopes is committed. After Phase E, any scope present in a scan but absent from the baseline is a **hard error** (means the baseline is stale or the scope list changed without updating the baseline). Phase E step 2 explicitly verifies this by removing the fallback code path.
   - **[R6] Advisory→blocking transition message**: when a suppression increase is detected in a scope whose policy just changed from advisory to blocking (detectable by comparing committed vs origin/main baseline), include in the error message: "Note: scope 'python-scripts' was recently promoted from advisory to blocking enforcement."

5. **Register in entry points — with precise contracts per tier**
   - **Pre-commit**: staged-subset scope check only. Contract: for each staged `.py`/`.ts` file, verify it belongs to at least one scope in the canonical `SCOPES` map. This proves "no staged file escapes audit" but does NOT prove "every repo file is covered" (that's preflight/CI's job). Implementation: iterate `staged_paths()`, match each against `SCOPES` directory prefixes, fail if any staged file is unscoped.
   - **Preflight**: full `--check-coverage` via `CommandSpec`. Contract: enumerate ALL tracked `.py`/`.ts` files via `git ls-files`, verify each belongs to exactly one scope. This proves complete repo coverage.
   - **CI**: same full `--check-coverage`. Contract: identical to preflight.

6. **Add scope-parity test** proving local and CI use identical scope list

**Exit criterion**: All `.py` files in repo belong to exactly one scope. New scopes report advisory warnings. Existing scopes remain blocking. Scope routing and pattern dispatch are data-driven.

### Phase C: Suppression Cleanup — Rule Configuration (US3 scenarios 1,4; US5; FR-004, FR-009, FR-014, FR-017, FR-020, FR-021)

**Goal**: Disable S603, S311, S607 with full-tree proof and compensating guardrails.

1. **Full-tree execution-surface verification for S603**
   - Script generates `.rule-disable-audit-S603.json`: every `subprocess.run/Popen/call` call site with file, line, code, shell mode, argument type, safety classification
   - Verify: all call sites use `shell=False` with hardcoded list args
   - Commit artifact

2. **Full-tree verification for S311**
   - Script generates `.rule-disable-audit-S311.json`: every `random.*` usage with file, line, code, purpose classification
   - Verify: all usage is seeded deterministic, zero crypto usage
   - Commit artifact

3. **Implement compensating guardrail script** (`scripts/check_rule_disable_invariants.py`)
   - S603 guardrail: detect `shell=True` or non-literal first arg in any `subprocess.*` call
   - S311 guardrail: detect `import secrets`, `os.urandom`, unseeded `random.Random()`
   - Uses tokenize for accurate detection (no string-literal false positives)
   - `--diff` mode with baseline JSON (same pattern as audit-suppressions.py)
   - **[R4] Pre-commit must use staged content, not worktree files.** In `run_repo_hook.py`, the guardrail runs via a `run_rule_disable_invariants_guard()` function that iterates `staged_paths()` and reads each file with `staged_file_content()` — consistent with `run_npm_command_guard`, `run_pagination_token_guard` patterns (lines 306-349). The full-tree `--diff` mode runs only in preflight and CI.
   - Register in all three entry points + LOCAL_CI_PARITY_INVARIANTS.md

4. **CI artifact verification step**: CI job checks `.rule-disable-audit-*.json` matches current codebase

5. **Disable S603, S311, S607 in ruff config** (`pyproject.toml`)
   - Add to `ignore` list with inline documentation comment
   - Verify S602 remains active
   - Remove all S603, S311, S607 `# noqa` comments repo-wide (~66 suppressions)

6. **Regression tests for guardrails**: test that simulated violations (shell=True, import secrets) are caught

**Exit criterion**: S603/S311/S607 disabled with committed proof artifacts, passing guardrails, and regression tests. ~66 suppressions removed.

### Phase D-0: Extend mypy to tests/ and scripts/ (BLOCKER prerequisite for Phase D)

**Goal**: Make type:ignore removals in tests/ and scripts/ verifiable by an actual gate, not cosmetic.

**[B1] BLOCKER context**: mypy currently runs only on `src/` (CI: `ci.yml:627`, preflight: `run_pr_preflight.py:132`). `scripts/` is explicitly excluded (`pyproject.toml:103`). The 13 `type:ignore` comments in `tests/` are dead code that mypy never sees. Removing them without extending mypy coverage is cosmetic — no gate catches reintroduction.

**Steady-state mypy scope decision**: After this phase, the mypy invocation target is `mypy src/ tests/ scripts/` in CI and preflight. This is the permanent steady-state — not a temporary un-exclusion for cleanup. `scripts/` is removed from the exclude list and stays removed. `.github/scripts/` is excluded from mypy because those files are CI-only utility scripts with no project imports and minimal type complexity; their `type:ignore` comments (0 currently) are covered by the suppression audit, not mypy.

1. **Remove `scripts/` from mypy excludes** in `pyproject.toml:103`
   - Currently: `exclude = ["^scripts/", ...]`
   - Remove the `"^scripts/"` entry permanently
   - Fix any mypy errors that surface in `scripts/`

2. **Change mypy invocation to `mypy src/ tests/ scripts/`** in CI and preflight
   - CI (`ci.yml`): change `mypy src/` to `mypy src/ tests/ scripts/`
   - Preflight (`run_pr_preflight.py`): same change
   - Pre-commit: mypy is not in pre-commit (too slow). Keep it out — preflight/CI is sufficient.

3. **Add mypy overrides for tests/** in `pyproject.toml`
   - Tests use MagicMock extensively — `disallow_untyped_defs` may need relaxation for test files
   - Add `[[tool.mypy.overrides]]` for `tests.*` with pragmatic settings (e.g., `disallow_untyped_defs = false`) while keeping `strict` for `src/`
   - This is NOT a relaxation — tests/ currently has zero mypy coverage. Any coverage is an improvement.
   - `scripts/` gets a similar override if needed (scripts use subprocess/pathlib heavily but have minimal type complexity)

4. **Fix all mypy errors in tests/ and scripts/**
   - This may reveal errors beyond the known `type:ignore` sites
   - Each error is either: (a) fixed by the typed doubles in Phase D, or (b) fixed by adding proper annotations
   - Do NOT add new `type:ignore` comments — fix the code

**Exit criterion**: `mypy src/ tests/ scripts/` passes in CI and preflight. `scripts/` is permanently removed from excludes. The type:ignore removals in Phase D will be mechanically verified.

### Phase D: Suppression Cleanup — Code Refactoring (US3 scenarios 2,3,5,6,7,8; FR-003, FR-010, FR-011, FR-016, FR-023)

**Goal**: Resolve all remaining suppressions through code changes. All type:ignore removals are now verifiable by mypy (Phase D-0 prerequisite).

1. **S105 — rename token variables** (10 suppressions)
   - `malicious_token` → `malicious_continuation`
   - `token_with_equals` → `continuation_with_equals`
   - `token_with_special` → `continuation_with_special`
   - `token_with_space` → `continuation_with_space`
   - `token` → `continuation_marker` (in context-specific locations)
   - Verify: tests pass, no functional change

2. **type:ignore[attr-defined] — typed fake modules** (7 suppressions)
   - **[R5+QG-40] Use `MagicMock` annotation**: The assigned value is `MagicMock()` — an instance, not a type. `MagicMock` is the precise annotation. `object` would lose callable info (downstream calls `fake_module.Prophet(...)`). See research.md R-006 Pattern 1.
   - Create `FakeProphetModule(ModuleType)` with `Prophet: MagicMock` in `tests/conftest.py`
   - Create `FakeOpenAIModule(ModuleType)` with `OpenAI: MagicMock` in `tests/conftest.py`
   - Update all fixture usages across 5 test files
   - **[G5] Regression prevention**: the suppression audit is the regression check once the expanded scope is blocking.
   - Verify: `mypy src/ tests/ scripts/` passes

3. **E402/I001/type:ignore[import-*] — importlib refactoring** (7 suppressions across 2 files)
   - `generate-demo-data.py`: use `importlib.util.spec_from_file_location()` for demo_generation_common; direct import for ado_git_repo_insights (package installed)
   - `generate-synthetic-dataset.py`: same pattern
   - Remove all `sys.path.insert` calls
   - Regression test: `sys.path.insert` or `sys.path.append` in any script (outside conftest.py) fails CI grep check
   - Verify: scripts produce identical output

4. **N817 — defusedxml direct imports** (4 suppressions)
   - **[G2] Must import `ParseError` too, not just `parse`**: 3 of 4 files use `ET.ParseError` (e.g., `generate-badge-json.py:75`, `get-coverage-actuals.py:98`, `validate-test-results.py:131`). Each file needs `from defusedxml.ElementTree import parse, ParseError` (and any other functions actually used — audit each file individually).
   - `check_coverage_delta.py`: audit which `ET.*` functions are called; import each directly
   - `.github/scripts/generate-badge-json.py`, `get-coverage-actuals.py`, `validate-test-results.py`: same — must include `ParseError`

5. **type:ignore[assignment] — FakeStdin** (3 suppressions)
   - Create `FakeStdin(io.StringIO)` with `def fileno(self) -> int: return 0` in `tests/conftest.py`
   - Update `test_cli_dashboard.py` to use `FakeStdin()` and `FakeStdin("q\n")` instead of patching fileno
   - Regression prevention: mypy now runs on tests/ (Phase D-0) — `StringIO.fileno = lambda: 0` will fail mypy directly. The suppression audit catches any `type: ignore` reintroduction.

6. **type:ignore[arg-type] — Thread wrapper** (1 suppression)
   - **[QG-40] Use `Unpack[_ThreadKwargs]` TypedDict, not `Any`**: Define a `_ThreadKwargs(TypedDict, total=False)` matching `threading.Thread.__init__` parameters (target, daemon, name, args, kwargs, group). Use `typing_extensions.Unpack` (required for Python 3.10; guarded by `TYPE_CHECKING`). This eliminates the `type: ignore[arg-type]` because the kwargs now match Thread's constructor exactly. See research.md R-006 Pattern 2.

7. **F841 — unused variables** (3 suppressions)
   - `test_chart_render.py`: add assertions on `upper_bounds` and `lower_bounds`
   - `test_install_detection.py`: call `detect_installation_method()` directly without assignment

8. **F401 — unused imports** (3 suppressions)
   - `test_cli_serve_flags.py`: remove bare `import pytest`
   - `test_optional_deps_isolation.py` (2): use `importlib.import_module()` instead

9. **S310 — urlopen** (2 suppressions)
   - `test_base_path.py`: replace `urllib.request.urlopen` with `requests.get` + remove S310 comment on previous line
   - `verify-badge-url.py`: replace with `requests.get`

10. **ANN001/002/003 — type annotations** (2 suppressions)
    - **[QG-40] Use precise types from source method signatures, not `Any`**:
    - `test_aggregators.py`: `def patched(self_gen: AggregateGenerator, week_group: pd.DataFrame, week_reviewers: pd.DataFrame, team_members_df: pd.DataFrame) -> dict[str, object]:` — matches `_generate_team_repo_slice` signature. See research.md R-006 Pattern 3.
    - `test_fallback_forecaster.py`: `def mock_polyfit(x: npt.ArrayLike, y: npt.ArrayLike, deg: int) -> npt.NDArray[np.float64]:` — matches `numpy.polyfit` signature. See research.md R-006 Pattern 4.

11. **S110 — try/except/pass** (1 suppression)
    - `test_secret_redaction.py`: `with contextlib.suppress(Exception):`

**Exit criterion**: All suppressions in new scopes resolved. ruff + mypy clean. All tests pass.

### Phase E: Gate Activation + Baseline Finalization (US3 Phase 2, FR-002, FR-012)

**Goal**: Switch from advisory to blocking enforcement for all scopes. Establish baseline merge safety.

1. **Regenerate baseline** with all scopes at 0, all policies set to `"blocking"`
   - `python scripts/audit-suppressions.py --update-baseline`
   - Verify: `by_scope` shows 0 for all 6 scopes
   - Verify: `scope_policy` shows `"blocking"` for all 6 scopes

2. **[B2] Establish deterministic baseline regeneration — single source of truth**
   - `.suppression-baseline.json` is flat JSON — two PRs touching different scopes produce merge conflicts. Naive conflict resolution (accept-theirs/ours) can produce wrong totals that silently pass validation.
   - **Invariant**: the committed baseline MUST be the exact output of `python scripts/audit-suppressions.py --update-baseline`. No hand edits. No manual merge conflict resolution of the baseline content. If a merge conflict occurs, the ONLY valid resolution is: accept either side, then immediately run `--update-baseline` to regenerate from the current codebase state. The baseline is a pure function of the code — regeneration always produces the correct answer.
   - **CI enforcement (authoritative)**: add a CI step that runs `--update-baseline` into a temp file and byte-compares against the committed baseline (ignoring `generated_at` timestamp). If they diverge, CI fails with: `"Baseline is stale or was hand-edited. Run 'python scripts/audit-suppressions.py --update-baseline' and commit the result."` This is the hard gate that prevents humans from resolving baseline conflicts incorrectly on branches.
   - **Preflight enforcement**: same check in preflight, so developers catch staleness before push.
   - **Document this protocol** in LOCAL_CI_PARITY_INVARIANTS.md alongside the merge protocol.

3. **[Transition exit] Remove v1→v2 missing-scope fallback**
   - In Phase B step 5, `cmd_diff()` was given a fallback: scopes present in scan but absent from baseline are treated as `count=0, policy="advisory"`. This was correct for the v1→v2 transition period.
   - **Now remove it.** After Phase E, all 6 scopes exist in the committed baseline. A scope present in scan but absent from baseline is a **hard error** — it means the scope list was expanded without regenerating the baseline. The fallback MUST NOT linger as a permanent escape hatch.
   - Verify: remove the fallback code path. Run the audit. Confirm it still passes (all scopes are now in the baseline).

4. **Full verification suite**
   - `python scripts/audit-suppressions.py --diff` → PASS
   - `python scripts/audit-suppressions.py --check-coverage` → PASS
   - `python scripts/check_rule_disable_invariants.py --diff` → PASS
   - Baseline staleness check → PASS (committed = regenerated)
   - `python scripts/run_pr_preflight.py` → PASS
   - `ruff check src/ scripts/ tests/ .github/scripts/` → PASS
   - `mypy src/ tests/ scripts/` → PASS
   - Full test suite → PASS

5. **Update LOCAL_CI_PARITY_INVARIANTS.md**
   - Add rows for: file-coverage check, rule-disable-invariants guardrail, baseline staleness check
   - Update suppression-audit row to reflect 6 scopes
   - Document baseline merge/regeneration protocol

6. **Update CLAUDE.md** if needed for new technologies/scripts

**Exit criterion**: All gates blocking. All entry points pass. v1→v2 fallback removed. Baseline staleness CI-enforced. Documentation updated.

## Risk Assessment

| Risk | Mitigation | Source |
|------|------------|--------|
| Verified census differs from ~114 preliminary | Plan adapts to actual count. Phases C/D scope adjusts. ~5 false positives expected to drop after scanner hardening. | Auditor G9 |
| tokenize fails on malformed Python files | **Hard error, not silent skip.** TokenError returns exit code 1 with file path. Developer must fix syntax before audit can proceed. | Fragility G4 |
| S603 full-tree verification finds unsafe call sites | S603 remains enabled for those files; individual refactoring instead of global disable. | Spec FR-017 |
| importlib refactoring breaks script output | Verify identical output before/after for both generator scripts. | Research R-004 |
| FakeStdin/typed doubles don't satisfy mypy | mypy now runs on tests/ (Phase D-0). Errors caught before commit. Fall back to `cast()` if needed. `Any` used for MagicMock assignments, not bare `type`. | Type Specialist R5 |
| Two-phase baseline v2 vs v1 on origin/main | Missing scopes treated as `count=0, policy="advisory"`. Logged as v1→v2 transition warning. | Parity Engineer R3 |
| Guardrail false positives (e.g., subprocess in comments) | Guardrail also uses tokenize — same structural correctness as scanner. | Research R-003 |
| Baseline merge conflicts produce silent corruption | Baseline is always regenerated (never hand-edited). CI staleness check catches divergence. Merge conflict resolution = re-run `--update-baseline`. | Fragility B2 |
| `--check-coverage` false positives from .mypy_cache/.py stubs | Use `git ls-files '*.py'` instead of `rglob` — only tracked files enumerated. | Fragility G3 |
| Pre-commit guardrail reads worktree instead of staged content | Guardrail in pre-commit uses `staged_file_content()` per existing guard pattern. Full-tree `--diff` in preflight/CI only. | Parity Engineer R4 |
| Advisory→blocking flip confuses developers on rebase | `cmd_diff()` error message includes: "Scope 'X' was recently promoted from advisory to blocking." | Fragility R6 |
| Cross-branch scanner divergence (old regex vs new tokenize) | Phase A merges first, before Phase B scope expansion. Linear ordering enforced by branch dependency. | Fragility R6-ordering |
| Extending mypy to tests/ surfaces many new errors | Phase D-0 uses pragmatic overrides for tests/ (e.g., `disallow_untyped_defs = false`). Any coverage > zero coverage. | Type Specialist B1 |

## Specialist Review Log

| Specialist | Date | Key Findings | Status |
|------------|------|-------------|--------|
| Python Static Analysis Auditor | 2026-04-02 | R1/R2 scope routing bugs, N817 ParseError gap, verified count 114 | All addressed in plan |
| CI/Hook Parity Engineer | 2026-04-02 | --check-coverage can't run in pre-commit, v1→v2 transition gap, staged-vs-worktree for guardrails | All addressed in plan |
| Type-System & Test Architecture | 2026-04-02 | **BLOCKER**: mypy never runs on tests/. Prophet:type wrong for MagicMock. Regression test impractical. | Blocker resolved via Phase D-0 |
| Gate Fragility Analyst | 2026-04-02 | **BLOCKER**: baseline merge conflicts. tokenize skip = silent false negative. .gitignore drift. | Blocker resolved via staleness check + hard error |

## Complexity Tracking

No constitution violations. No complexity justification needed.
