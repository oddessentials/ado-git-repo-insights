# Quickstart: CLI Hardening Implementation

**Feature**: 039-cli-hardening | **Date**: 2026-03-26

## Prerequisites

- Python 3.10+ with `pip install -e .[dev]`
- Git repo with tags (for `importlib.metadata` version resolution)
- Existing test suite passing: `cd src && pytest`

## Implementation Order (Mandatory)

Work in this exact sequence — each step depends on the previous.

### Step 1: Version Unification + `__main__.py`

**Files**: `__init__.py`, `__main__.py` (new), `run_summary.py`, `doctor.py`

1. Replace `__init__.py` — use `importlib.metadata.version()` with `"unknown (dev)"` fallback + logged WARNING
2. Create `__main__.py` — `sys.exit(main())` with absolute import
3. Update `get_tool_version()` in `run_summary.py` — same `importlib.metadata` pattern
4. Update `get_git_sha()` in `run_summary.py` — remove VERSION file read, keep `git rev-parse` fallback
5. Update `_get_version()` in `doctor.py` — change fallback from `"unknown"` to `"unknown (dev)"`

**Verify**: `python -c "from ado_git_repo_insights import __version__; assert '0.0.0' not in __version__"`

### Step 2: `--version` Flag

**Files**: `cli.py`

1. Add `_get_runtime_version()` helper before `create_parser()`
2. Add `--version` argument to `create_parser()` after description
3. Remove `# pragma: no cover` from `create_parser()`

**Verify**: `python -m ado_git_repo_insights --version`

### Step 3: Parse-Boundary Validation

**Files**: `cli.py`

1. In `main()`, add validation block immediately after `args = parser.parse_args()`
2. Move logging setup, PATH guidance, artifacts dir creation AFTER validation
3. Keep `summary_path` and `artifacts_dir` assignments before the try block (needed by exception handler)

**Verify**: `python -m ado_git_repo_insights.cli extract --pat x` → exit code 2, no directory created

### Step 4: Lazy Import Refactor

**Files**: `cli.py`

1. Remove heavy imports from module-level (lines 14-36)
2. Keep lightweight utils (install_detection, logging_config, path_security, path_utils, shell_detection)
3. Add function-local imports to each `cmd_*` function — exception classes BEFORE try blocks
4. Import `create_minimal_summary` inside `main()` except blocks

**Verify**: `python -c "from ado_git_repo_insights.cli import create_parser; import sys; assert 'pandas' not in sys.modules"`

### Step 5: PATH Diagnostics Fix

**Files**: `doctor.py`, `cli.py`

1. Add `sys.prefix != sys.base_prefix` check to `doctor.py` line 91
2. Add same check to `_check_path_guidance()` in `cli.py`

**Verify**: Run `ado-insights doctor` inside a venv — no false PATH warning

### Step 6: Tests + CI Updates

**Files**: test files, `ci.yml`

1. Add version tests (--version exits 0, "0.0.0" never appears, python -m works)
2. Add lazy import test (cli.py import doesn't load pandas/requests/yaml)
3. Add parse validation test (extract without org → exit 2)
4. Add forced exception path tests (each cmd handler)
5. Add doctor venv test
6. Replace broken `test_cli_version_works`
7. Update `--min-collected` in CI

**Verify**: `cd src && pytest` — all pass, zero regressions

## Pre-PR Checklist

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
