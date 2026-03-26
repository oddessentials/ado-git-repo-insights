# Research: CLI Hardening

**Feature**: 039-cli-hardening | **Date**: 2026-03-26

## R1: Version Resolution Strategy

**Decision**: Use `importlib.metadata.version("ado-git-repo-insights")` as the sole runtime version source. Fallback to `"unknown (dev)"` with a logged WARNING when metadata is unavailable.

**Rationale**: `importlib.metadata` is stdlib (Python 3.8+), works for both `pip install -e .` and wheel installs, and is already used by the `doctor` command (`doctor.py:31-34`). Adding `write_to` in pyproject.toml would create a second version file (`_version.py`) that can get committed accidentally, go stale, or diverge from metadata — rejected as unnecessary complexity.

**Alternatives considered**:
- `_version.py` via setuptools_scm `write_to`: Adds `.gitignore` entry requirement, risk of accidental commit, second version source. Rejected.
- Keep reading `VERSION` file: Only works in source checkout (4-level parent traversal breaks in installed packages). Rejected.
- Silent `"0.0.0"` fallback: Hides misconfiguration, confuses debugging. Rejected per spec FR-005.

## R2: main() Reordering for Parse-Boundary Validation

**Decision**: Insert validation immediately after `parse_args()` (line 1665), before logging setup (line 1668). Move `_check_path_guidance()` to after validation since it only needs `args.command`.

**Rationale**: The spec requires ZERO side effects before validation passes (FR-011). Currently, `setup_logging()`, `_check_path_guidance()`, `artifacts_dir.mkdir()`, and `summary_path` assignment all happen before dispatch. Validation must precede all of these.

**Verified sequence after change**:
1. `args = parser.parse_args()` — line 1665 (unchanged)
2. **NEW**: Per-command validation (extract org/projects check)
3. `setup_logging()` — moves after validation
4. `_check_path_guidance()` — moves after validation
5. `artifacts_dir.mkdir()` — moves after validation
6. `summary_path = safe_join(...)` — moves after validation
7. Command dispatch

**Critical constraint**: `summary_path` and `artifacts_dir` must remain in scope for the exception handler at lines 1707-1726. They are local variables defined before the try block — this is preserved by the reordering.

## R3: Lazy Import Pattern (Exemplar)

**Decision**: Replicate the `cmd_stage_artifacts` pattern (cli.py lines 1172-1176) for all command handlers. All imports grouped at function start, before any logic.

**Rationale**: `cmd_stage_artifacts` already demonstrates the correct pattern — lazy imports of `base64`, `json`, `datetime`, `requests` at function scope. This is the established codebase convention.

**Pattern**:
```python
def cmd_extract(args: Namespace) -> int:
    """Execute the extract command."""
    from .config import ConfigurationError, load_config
    from .extractor.ado_client import ADOClient, ExtractionError
    from .extractor.pr_extractor import PRExtractor
    from .persistence.database import DatabaseError, DatabaseManager
    from .utils.run_summary import (
        RunCounts, RunSummary, RunTimings,
        create_minimal_summary, get_git_sha, get_tool_version,
    )

    # All exception classes now guaranteed defined before try block
    start_time = time.perf_counter()
    ...
```

**Alternatives considered**:
- Decorator-based import injection: Over-engineering for 6 functions. Rejected per spec Section 7 (no registry system).
- Shared import helper module: Adds indirection without benefit for a fixed set of commands. Rejected.

## R4: Exception Class Import Safety

**Decision**: Every exception class used in an `except` clause must be imported at the TOP of the function body, grouped with other imports, BEFORE the `try` block.

**Rationale**: Moving imports from module-level to function-level means the `except ConfigurationError` clause must have `ConfigurationError` defined in the function scope. If the import is inside the `try` block or in a nested scope, a `NameError` would mask the original exception.

**Verified exception map** (each must have its class imported before the try):

| Function | Catches | Import source |
|----------|---------|---------------|
| `cmd_extract` | `ConfigurationError`, `DatabaseError`, `ExtractionError` | `.config`, `.persistence.database`, `.extractor.ado_client` |
| `cmd_generate_csv` | `DatabaseError`, `CSVGenerationError` | `.persistence.database`, `.transform.csv_generator` |
| `cmd_generate_aggregates` | `DatabaseError`, `StubGenerationError`, `AggregationError` | `.persistence.database`, `.transform.aggregators` |
| `cmd_build_aggregates` | `DatabaseError`, `AggregationError` | `.persistence.database`, `.transform.aggregators` |
| `cmd_stage_artifacts` | `ZipSlipError`, `requests.*` | Already lazy — no change needed |
| `cmd_dashboard` | None directly | No change needed |

**main() exception handler**: Catches only `KeyboardInterrupt` and `Exception` (builtins). Uses `create_minimal_summary` — must import inside the except block since `run_summary` is no longer module-level.

## R5: main() Exception Handler After Lazy Import Refactor

**Decision**: Import `create_minimal_summary` inside each except block in `main()`.

**Rationale**: `create_minimal_summary` imports only stdlib modules (`json`, `subprocess`, `re`, `dataclasses`, `pathlib`, `datetime`), so the import cannot fail. The except blocks only execute on unexpected failures, not the fast path.

**Pattern**:
```python
except KeyboardInterrupt:
    logger.info("Operation cancelled by user")
    if not summary_path.exists():
        from .utils.run_summary import create_minimal_summary
        minimal_summary = create_minimal_summary("Operation cancelled by user", artifacts_dir)
        minimal_summary.write(summary_path)
    return 130
```

## R6: _check_path_guidance Venv Detection

**Decision**: Add `sys.prefix != sys.base_prefix` check to both `_check_path_guidance()` (cli.py:1647) and `cmd_doctor()` (doctor.py:91).

**Rationale**: When a virtualenv is active, the venv's `bin/` directory is already on PATH via activation. Reporting "PATH Issue Detected" is a false positive that erodes trust in the diagnostic tool.

**Alternatives considered**:
- Check `shutil.which("ado-insights")`: Would catch more cases but adds subprocess overhead. The venv check is simpler and covers the primary false positive scenario.
- Check for `VIRTUAL_ENV` environment variable: Less reliable — not all venv activators set it. `sys.prefix != sys.base_prefix` is the CPython-blessed way to detect venvs.

## R7: create_parser() pragma:no cover

**Decision**: Remove the `# pragma: no cover` from `create_parser()` (cli.py:47).

**Rationale**: 29+ tests actively call `create_parser()` across test_cli_args.py, test_cli_serve_flags.py, and test_comments_cli.py. The pragma is incorrect — it was likely added before tests existed. Removing it increases reported coverage accuracy.

## R8: Broken test_cli_version_works

**Decision**: Replace the test entirely. Current test (test_optional_deps_isolation.py:28-38) tests a nonexistent `version` subcommand with an assertion that can never fail.

**Rationale**: The test runs `python -m ado_git_repo_insights.cli version` (not `--version`). argparse rejects `version` as an invalid subcommand, but the assertion `"ImportError" not in result.stderr` passes because the error is about invalid choice, not imports. The test is a no-op.

**Replacement**: Test `--version` flag with `python -m ado_git_repo_insights --version`, assert exit code 0 and `"0.0.0" not in result.stdout`.
