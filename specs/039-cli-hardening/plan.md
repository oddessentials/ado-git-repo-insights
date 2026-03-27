# Implementation Plan: CLI Hardening

**Branch**: `039-cli-hardening` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/039-cli-hardening/spec.md`

## Summary

Fix six broken CLI behaviors (issue #200): add `--version` flag, create `__main__.py`, unify version resolution to single `importlib.metadata` source, move extract argument validation to parse boundary, defer heavy imports to command handlers, and suppress false PATH warnings in virtualenvs. No architecture rewrite — hardening only.

## Technical Context

**Language/Version**: Python 3.10+ (baseline), developed on 3.14
**Primary Dependencies**: stdlib only for changes (importlib.metadata, argparse, sys, logging)
**Storage**: N/A (no storage changes)
**Testing**: pytest (unit + integration), subprocess-based CLI invocation tests
**Target Platform**: Windows, Linux, macOS (cross-platform CLI)
**Project Type**: CLI tool (`ado-insights` entry point)
**Performance Goals**: `--version` and `--help` in < 1 second; no heavy deps loaded for diagnostics
**Constraints**: Zero new dependencies; no changes to extraction, DB, or CSV logic

### In-Scope Files (Authoritative Boundary)

Only these source files may be modified. No files outside this boundary may be changed unless the spec is updated.

| File | Action | Spec References |
|------|--------|-----------------|
| `src/ado_git_repo_insights/__init__.py` | Modify | FR-003..FR-007 |
| `src/ado_git_repo_insights/__main__.py` | **Create** | FR-002..FR-004 |
| `src/ado_git_repo_insights/cli.py` | Modify | FR-001..FR-015 |
| `src/ado_git_repo_insights/commands/doctor.py` | Modify | FR-016..FR-018 |
| `src/ado_git_repo_insights/utils/run_summary.py` | Modify | FR-006..FR-007 |
| `tests/unit/test_cli_args.py` | Modify | FR-022, FR-026 |
| `tests/unit/test_cli_exit_code.py` | Modify | FR-026..FR-028 |
| `tests/unit/test_doctor.py` | Modify | FR-029 |
| `tests/unit/test_optional_deps_isolation.py` | Modify | FR-024, FR-025, FR-030 |
| `tests/integration/test_cli_distribution.py` | Modify | FR-022..FR-024 |
| `.github/workflows/ci.yml` | Modify | FR-031 |

## Required Implementation Order (Hard Gate)

Work MUST be completed in this exact sequence, matching spec Section 1. Each phase depends on the previous. Out-of-order implementation is a reject condition.

| Phase | Work | Must Complete Before |
|-------|------|---------------------|
| **1** | Version unification + `__main__.py` | Phase 2 |
| **2** | `--version` flag | Phase 3 |
| **3** | Parse-boundary validation for `extract` | Phase 4 |
| **4** | Lazy import refactor | Phase 5 |
| **5** | PATH diagnostics fix | Phase 6 |
| **6** | Tests + CI updates | PR submission |

**Rationale**: Phase 1 establishes the version source that Phase 2 depends on. Phase 3 reorders `main()` which Phase 4 relies on being stable. Phase 4 moves imports which could mask regressions if mixed with other changes. Phase 5 is independent but small. Phase 6 validates everything.

---

## Version Unification Rules (Phase 1)

### Allowed

- `importlib.metadata.version("ado-git-repo-insights")` as the sole version source
- Fallback string: exactly `"unknown (dev)"` — no other fallback is permitted
- On fallback: log `WARNING` once per process with install guidance (`pip install -e .`)

### Forbidden — Must Be Fully Removed

- Any read of the `VERSION` file for Python package version (`run_summary.py:149`, `run_summary.py:162-166`)
- The string `"0.0.0"` in any user-facing path (`__init__.py:3`, anywhere else)
- The bare fallback `"unknown"` without `"(dev)"` suffix (`doctor.py:36`)

---

## Zero Side Effects Rule (Phase 3)

Parse-boundary validation MUST occur immediately after `parser.parse_args()` and BEFORE all of the following. This is the most important behavioral fix in this feature.

The system MUST NOT do any of the following before validation passes:

1. Initialize logging (`setup_logging()` — currently cli.py:1668-1672)
2. Emit PATH guidance (`_check_path_guidance()` — currently cli.py:1675)
3. Create directories (`artifacts_dir.mkdir()` — currently cli.py:1679)
4. Touch filesystem in any way
5. Load configuration files
6. Connect to databases
7. Make network calls

**Implementation constraint**: `summary_path` and `artifacts_dir` variable assignments must remain before the `try` block at cli.py:1683 because the exception handler at cli.py:1707-1726 references them. These assignments are NOT side effects (they compute paths, they don't create anything).

---

## Import Inventory (Phase 4)

### Module-Level Imports — MUST REMAIN (used in main() pre-dispatch path)

```python
import argparse
import logging
import shutil
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from .utils.install_detection import detect_installation_method
from .utils.logging_config import LoggingConfig, setup_logging
from .utils.path_security import ensure_safe_filename, safe_join
from .utils.path_utils import format_path_guidance, get_scripts_directory, is_on_path
from .utils.shell_detection import detect_shell
```

### Module-Level Imports — MUST MOVE to command handlers

| Current import (cli.py) | Move to |
|--------------------------|---------|
| `from .config import ConfigurationError, load_config` | `cmd_extract()` |
| `from .extractor.ado_client import ADOClient, ExtractionError` | `cmd_extract()` |
| `from .extractor.pr_extractor import PRExtractor` | `cmd_extract()` |
| `from .persistence.database import DatabaseError, DatabaseManager` | `cmd_extract()`, `cmd_generate_csv()`, `cmd_generate_aggregates()`, `cmd_build_aggregates()` |
| `from .transform.aggregators import AggregateGenerator, AggregationError, StubGenerationError` | `cmd_generate_aggregates()`, `cmd_build_aggregates()` |
| `from .transform.csv_generator import CSVGenerationError, CSVGenerator` | `cmd_generate_csv()` |
| `from .utils.run_summary import RunCounts, RunSummary, RunTimings, create_minimal_summary, get_git_sha, get_tool_version` | Each `cmd_*` that uses them; `create_minimal_summary` inside `main()` except blocks |
| `from .utils.safe_extract import ZipSlipError, safe_extract_zip` | `cmd_stage_artifacts()` (already correct — no change needed) |

### Per-Command Import Map

| Command | Lazy imports at function top |
|---------|------------------------------|
| `cmd_extract` | `.config`, `.extractor.ado_client`, `.extractor.pr_extractor`, `.persistence.database`, `.utils.run_summary` |
| `cmd_generate_csv` | `.persistence.database`, `.transform.csv_generator` |
| `cmd_generate_aggregates` | `.persistence.database`, `.transform.aggregators` |
| `cmd_build_aggregates` | `.persistence.database`, `.transform.aggregators` |
| `cmd_stage_artifacts` | Already correct (imports at lines 1172-1176) — no change |
| `cmd_dashboard` | Already lightweight — no change |
| `cmd_setup_path` | Already lazy (imported in dispatch) — no change |
| `cmd_doctor` | Already lazy (imported in dispatch) — no change |

---

## Exception-Handling Invariant (Phase 4)

**Rule**: Every exception type used in an `except` clause MUST be imported at the TOP of the function body, grouped with other imports, BEFORE the `try` block. Violation of this rule creates `NameError` that masks the original exception.

### Exception Map — Each Must Have Import + Forced Failure Test

| Function | Exception caught | Import source | Test required |
|----------|-----------------|---------------|---------------|
| `cmd_extract` | `ConfigurationError` | `.config` | T-10 |
| `cmd_extract` | `DatabaseError` | `.persistence.database` | T-10 |
| `cmd_extract` | `ExtractionError` | `.extractor.ado_client` | T-10 |
| `cmd_generate_csv` | `DatabaseError` | `.persistence.database` | T-11 |
| `cmd_generate_csv` | `CSVGenerationError` | `.transform.csv_generator` | T-11 |
| `cmd_generate_aggregates` | `DatabaseError` | `.persistence.database` | T-12 |
| `cmd_generate_aggregates` | `StubGenerationError` | `.transform.aggregators` | T-12 |
| `cmd_generate_aggregates` | `AggregationError` | `.transform.aggregators` | T-12 |
| `cmd_build_aggregates` | `DatabaseError` | `.persistence.database` | T-13 |
| `cmd_build_aggregates` | `AggregationError` | `.transform.aggregators` | T-13 |

**`main()` exception handler**: Catches `KeyboardInterrupt` and `Exception` (builtins — no import needed). Uses `create_minimal_summary` — import inside each except block. `run_summary` is stdlib-only, so the import cannot fail.

---

## Mandatory Test Checklist (Phase 6)

Every test is mapped to a spec requirement and success criterion. All must pass before PR submission.

| ID | Test | Spec | SC | Type | File |
|----|------|------|----|------|------|
| T-01 | `--version` flag exits 0, prints version | FR-001, FR-002 | SC-001 | Unit | `test_cli_args.py` |
| T-02 | `--version` output never contains `"0.0.0"` | FR-005 | SC-006 | Integration | `test_cli_distribution.py` |
| T-03 | `python -m ado_git_repo_insights --help` exits 0 | FR-003, FR-004 | SC-002 | Integration | `test_cli_distribution.py` |
| T-04 | `python -m ado_git_repo_insights --version` exits 0 | FR-003, FR-004 | SC-001 | Integration | `test_cli_distribution.py` |
| T-05 | `__version__` is not `"0.0.0"` in editable install | FR-005, FR-006 | SC-006 | Unit | `test_optional_deps_isolation.py` |
| T-06 | Version resolves to non-`"unknown (dev)"` in editable install | FR-006 | SC-007 | Unit | `test_optional_deps_isolation.py` |
| T-07 | `cli.py` import does NOT load pandas, requests, or yaml | FR-012, FR-015 | SC-009 | Unit | `test_optional_deps_isolation.py` |
| T-08 | `extract --pat x` without org/config exits code 2 | FR-008..FR-011 | SC-004 | Unit | `test_cli_exit_code.py` |
| T-09 | `extract --pat x --config ...` bypasses org requirement | FR-008 | SC-004 | Unit | `test_cli_exit_code.py` |
| T-10 | `cmd_extract` exception paths return 1 (no NameError) | FR-014 | SC-010 | Unit | `test_cli_exit_code.py` |
| T-11 | `cmd_generate_csv` exception paths return 1 (no NameError) | FR-014 | SC-010 | Unit | `test_cli_exit_code.py` |
| T-12 | `cmd_generate_aggregates` exception paths return 1 (no NameError) | FR-014 | SC-010 | Unit | `test_cli_exit_code.py` |
| T-13 | `cmd_build_aggregates` exception paths return 1 (no NameError) | FR-014 | SC-010 | Unit | `test_cli_exit_code.py` |
| T-14 | Doctor suppresses PATH warning in active venv | FR-016, FR-017 | SC-008 | Unit | `test_doctor.py` |
| T-15 | Doctor still warns for real PATH issues (not in venv) | FR-018 | SC-008 | Unit | `test_doctor.py` |
| T-16 | Replace broken `test_cli_version_works` | FR-030 | SC-001 | Integration | `test_optional_deps_isolation.py` |
| T-17 | CI `--min-collected` updated | FR-031 | SC-010 | CI config | `ci.yml` |

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Relevant? | Status | Notes |
|------|-----------|--------|-------|
| QG-16 | Yes | PASS | PAT secrecy unchanged — no logging changes affect secrets |
| QG-17 | Yes | PASS | Lint/format enforced by pre-commit hooks; all changes must pass ruff |
| QG-18 | Yes | PASS | mypy must pass; TYPE_CHECKING block preserved for type annotations |
| QG-19 | Yes | PASS | All existing tests must continue to pass; new tests added |
| QG-20 | Yes | PASS | Coverage threshold (75%) maintained; new code has test coverage |
| QG-21 | Yes | PASS | `__init__.py` change does not affect package build; `importlib.metadata` is stdlib |
| All others | No | N/A | CSV, DB, extraction, pipeline, PowerBI gates not impacted by CLI hardening |

**Pre-design verdict**: All relevant gates pass. No violations to justify.

**Post-design re-check**: All gates still pass. Design introduces no new data surfaces, no new dependencies, no changes to CSV/DB/extraction/pipeline contracts. `__init__.py` version change is additive (value changes from `"0.0.0"` to real version — no API break). `run_summary.json` `tool_version` field value changes but field name and schema are preserved.

## Project Structure

### Documentation (this feature)

```text
specs/039-cli-hardening/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal — no data model changes)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI interface contract)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── __init__.py              # Version resolution (FR-003..FR-007)
├── __main__.py              # NEW: python -m support (FR-002..FR-004)
├── cli.py                   # --version, validation, lazy imports (FR-001..FR-015)
├── commands/
│   └── doctor.py            # PATH venv fix (FR-016..FR-018)
└── utils/
    └── run_summary.py       # Version unification (FR-006..FR-007)

tests/
├── unit/
│   ├── test_cli_args.py     # --version, parse validation tests
│   ├── test_cli_exit_code.py # Extract validation exit code 2, exception paths
│   ├── test_doctor.py        # Venv PATH suppression
│   └── test_optional_deps_isolation.py # Lazy import enforcement, version checks
└── integration/
    └── test_cli_distribution.py # python -m, subprocess version tests
```

**Structure Decision**: Existing single-project layout. No new directories. All changes are modifications to existing files except `__main__.py` (new) and new test functions in existing test files.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | —          | —                                   |
