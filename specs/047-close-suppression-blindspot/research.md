# Research: Close Suppression Audit Blind Spot

**Feature**: 047-close-suppression-blindspot
**Date**: 2026-04-02

## R-001: Scanner Hardening Approach

**Decision**: Use Python's `tokenize` module (Option A — AST-based)

**Rationale**:
- `tokenize` emits `COMMENT` tokens separate from `STRING` tokens — structurally eliminates false positives
- Python's `ast` module discards comments entirely, making it unsuitable
- Performance overhead is ~620ms total for 119 files — negligible in CI context
- Eliminates an entire class of bugs (string literals containing suppression keywords)
- Future-proof: any new suppression pattern automatically gets the same accuracy guarantee

**Alternatives considered**:
- **Option B (explicit-case regex + tests)**: Requires ongoing maintenance as edge cases are discovered. Does not provide structural correctness. Rejected because the tokenize approach is equally simple (~25-30 lines) and permanently correct.
- **Keep current regex**: Rejected because test_audit_suppressions.py contains known false-positive patterns (string literals with `# noqa`) that would inflate the verified census.

**Key implementation detail**: Replace the inner loop in `scan_file()` with `tokenize.tokenize()`, filtering to `tok_type == tokenize.COMMENT` before applying regex patterns. Wrap in `try/except tokenize.TokenError` for graceful handling of malformed files.

## R-002: Two-Phase Gating Mechanism

**Decision**: Extend baseline schema with `scope_policy` metadata (version 2)

**Rationale**:
- The current baseline format (`version: 1`) treats all scopes identically — no per-scope blocking/non-blocking support
- Adding `scope_policy: {"python-scripts": "advisory", ...}` to the baseline keeps the single-source-of-truth pattern
- Phase 1→2 transition is a baseline regeneration + commit (policy values change from `"advisory"` to `"blocking"`) — no code change
- All three entry points (pre-commit, preflight, CI) call `cmd_diff()` which gains policy awareness — no entry-point changes needed

**Alternatives considered**:
- **Separate config file** (`.suppression-scope-policy.json`): Creates two files to maintain with desync risk. Rejected.
- **CLI flag** (`--advisory-scopes=...`): Non-persistent, not auditable, ugly in CI. Rejected.

**Mechanics**:
- `cmd_diff()` modified: for each file with increased suppressions, look up its scope's policy. If `"advisory"`, log warning and continue. If `"blocking"`, enforce strict (current behavior).
- Validation updated: `scope_policy` must exist, all scopes must be covered, only `"blocking"` or `"advisory"` values.
- Schema version bumped from 1 to 2. Old v1 baselines treated as all-blocking (backward compatible).

**Entry point behavior (unchanged)**:
| Entry Point | Baseline Source | Notes |
|-------------|----------------|-------|
| Pre-commit | Committed `.suppression-baseline.json` | Zero-tolerance for blocking scopes |
| Preflight | Committed, then `origin/main` | Dual gates, strict for blocking scopes |
| CI | `origin/main` preferred, fallback committed | PR approval still works for blocking scopes |

## R-003: Guardrail Implementation Pattern

**Decision**: Single `scripts/check_rule_disable_invariants.py` script following the audit-suppressions.py pattern

**Rationale**:
- The codebase has an established pattern: guards in `run_repo_hook.py` (pre-commit), `CommandSpec` in `run_pr_preflight.py` (preflight), jobs in `ci.yml` (CI)
- Guardrails mirror the suppression audit architecture: baseline JSON + `--diff` mode + deterministic output
- Single script callable from all three entry points — same logic everywhere

**S603 guardrail specification**:
- Scans: all `.py` files in full tree (excluding EXCLUDED_DIRS)
- Detects: `subprocess.run(` / `subprocess.Popen(` / `subprocess.call(` with `shell=True` or non-literal first argument
- Detection method: `tokenize` to extract non-comment, non-string code lines; regex for pattern match
- Failure: hard fail with file path, line number, offending pattern
- Artifact: `.rule-disable-audit-S603.json` listing every subprocess call site with safety classification

**S311 guardrail specification**:
- Scans: all `.py` files in full tree
- Detects: `import secrets`, `os.urandom`, `random.SystemRandom` in files that also use `random`; `random.Random()` without seed argument
- Failure: hard fail with file path, line number, offending pattern
- Artifact: `.rule-disable-audit-S311.json`

**Registration across entry points**:
1. Pre-commit: `run_rule_disable_invariants_guard()` in `run_repo_hook.py` (staged files only)
2. Preflight: `CommandSpec("Rule-disable invariants", ("__PYTHON__", "scripts/check_rule_disable_invariants.py", "--diff"))`
3. CI: new `rule-disable-invariants` job
4. Parity doc: new row in `LOCAL_CI_PARITY_INVARIANTS.md` Tier 1 table

## R-004: Import Refactoring Strategy

**Decision**: Use `importlib.util.spec_from_file_location()` for demo_generation_common; rely on installed package for ado_git_repo_insights imports

**Rationale**:
- `demo_generation_common.py` is a sibling file in `scripts/`, not a package — `importlib.import_module()` cannot find it without sys.path
- `importlib.util.spec_from_file_location()` is already used in the codebase (`manage_generated_artifacts.py:26-33`) — proven pattern
- The package is installed via `pip install -e .` in all environments (CI, local dev) — `ado_git_repo_insights` imports work without sys.path
- This approach eliminates E402, I001, `type:ignore[import-untyped]`, `type:ignore[import-not-found]` without moving files

**Alternatives considered**:
- **Move scripts into src package**: Too disruptive — changes invocation patterns, CI workflows, and requires entry point registration. Rejected for this feature.
- **Convert scripts/ to a package**: Would require renaming files (dashes → underscores), adding `__init__.py`, changing invocation style. More work than necessary. Rejected.
- **`-m` invocation**: Requires scripts/ to be a package. Same issues. Rejected.

**Implementation pattern**:
```python
import importlib.util
_common_path = Path(__file__).resolve().parent / "demo_generation_common.py"
_spec = importlib.util.spec_from_file_location("demo_generation_common", _common_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
largest_remainder_allocate = _mod.largest_remainder_allocate
```

For `ado_git_repo_insights` imports: remove sys.path.insert entirely. The package is installed in all environments.

## R-005: File Coverage Check Design

**Decision**: Add `--check-coverage` mode to `audit-suppressions.py` that enumerates all `.py` files and asserts scope membership

**Rationale**:
- The audit tool already has the scope definitions and exclusion logic — adding coverage checking here keeps the single-source-of-truth
- The check walks the repo tree, applies exclusions, and for each `.py` file verifies it matches exactly one scope's directory prefix
- Files matching zero scopes → hard failure listing uncovered paths
- Files matching multiple scopes → hard failure (scope overlap, configuration error)

**Mechanics**:
- New `cmd_check_coverage()` function in `audit-suppressions.py`
- New `--check-coverage` CLI flag
- Runs in all three entry points (pre-commit, preflight, CI)
- Must account for both Python scopes (src/, scripts/, tests/, .github/scripts/) and TypeScript scopes (extension/ui/, extension/tests/)
- Only checks `.py` files against Python scopes and `.ts` files against TypeScript scopes

## R-006: Typed Test Double Strategy

**Decision**: Create typed `ModuleType` subclasses in `tests/conftest.py` and `FakeStdin` in test helpers

**Rationale**:
- `FakeProphetModule(ModuleType)` with `Prophet: type` attribute declaration satisfies `mypy --strict`
- `FakeOpenAIModule(ModuleType)` with `OpenAI: type` attribute declaration
- `FakeStdin(io.StringIO)` with `def fileno(self) -> int: return 0`
- All three placed in shared locations (conftest.py or test helpers) — used by multiple test files
- Regression tests: create untyped `ModuleType`, assign attribute, assert mypy rejects it

**Files affected**:
- `tests/conftest.py`: add `FakeProphetModule`, `FakeOpenAIModule`
- `tests/unit/test_cli_dashboard.py`: use `FakeStdin` instead of patching fileno
- `tests/unit/test_forecaster_contract.py`, `tests/unit/test_insights_contract.py`, `tests/unit/test_insights_id_stability.py`, `tests/integration/test_phase5_ml_integration.py`: use typed fixture
