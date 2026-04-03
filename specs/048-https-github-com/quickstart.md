# Quickstart: QG-40 Eliminate typing.Any in src/

**Branch**: `048-https-github-com` | **Date**: 2026-04-02

## Prerequisites

- Python 3.10+ (project minimum)
- `pip install -e ".[dev]"` (includes mypy, ruff, pytest)
- pnpm installed (for extension tests)

## Key Commands

### Run the Any-type scanner
```bash
python scripts/check_no_any_types.py           # Full-tree scan, compare against baseline
python scripts/check_no_any_types.py --diff     # Staged files only (pre-commit mode)
python scripts/check_no_any_types.py --update-baseline  # Ratchet down after fixing
```

### Run mypy strict check
```bash
mypy src/ tests/ scripts/                        # Full typecheck surface (same as CI)
```

### Run full preflight (same as CI)
```bash
python scripts/run_pr_preflight.py              # All gates including Any-type scanner
```

### Run specific test suites
```bash
pytest tests/unit/ -v --no-cov                  # Unit tests
pytest tests/integration/ -v --no-cov           # Integration tests
cd extension && pnpm test                        # Extension tests (Jest)
```

## Workflow Per Batch

1. Create/modify TypedDicts in `src/ado_git_repo_insights/types.py`
2. Replace `dict[str, Any]` annotations in target files with precise types
3. Remove `from typing import Any` import once all annotations in a file are replaced
4. Run `mypy src/ tests/ scripts/` — fix any type errors
5. Run `pytest tests/ -v --no-cov` — ensure no regressions
6. Run `python scripts/check_no_any_types.py` — verify count decreased
7. Run `python scripts/check_no_any_types.py --update-baseline` — lock in the gain
8. Commit both code changes and updated `.any-type-baseline.json`

## File Map

| File to Modify | Batch | Current Count | Target |
|----------------|-------|:-------------:|:------:|
| `src/.../types.py` | ALL | 0 (new) | 0 |
| `src/.../config.py` | P1 | 2 | 0 |
| `src/.../utils/run_summary.py` | P1 | 2 | 0 |
| `src/.../persistence/database.py` | P1 | 3 | 0 |
| `src/.../utils/logging_config.py` | P1 | 5 | 0 |
| `src/.../extractor/ado_client.py` | P2 | 11 | 0 |
| `src/.../ml/forecaster.py` | P3 | 6 | 0 |
| `src/.../ml/fallback_forecaster.py` | P3 | 7 | 0 |
| `src/.../ml/insights.py` | P3 | 13 | 0 |
| `src/.../persistence/repository.py` | P4 | 5 | 0 |
| `src/.../transform/aggregators.py` | P5a/b/c | 46 | 0 |
| `.any-type-baseline.json` | ALL | 100 | 0 |
