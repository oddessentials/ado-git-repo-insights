# Implementation Plan: CLI Distribution Hardening

**Branch**: `003-cli-distribution` | **Date**: 2026-01-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-cli-distribution/spec.md`

## Summary

This feature hardens CLI distribution by establishing pipx and uv as primary frictionless installation methods, adding PATH detection and guidance for pip users, and introducing two new CLI commands (`setup-path` and `doctor`) for installation management and diagnostics. The implementation adds infrastructure for cross-platform shell detection, PATH manipulation, and conflict resolution without changing core CLI functionality.

## Technical Context

**Language/Version**: Python 3.10+ (matches existing project requirement)
**Primary Dependencies**: argparse (stdlib), pathlib (stdlib), shutil (stdlib), subprocess (stdlib), sys (stdlib)
**Storage**: N/A (no persistent storage for this feature)
**Testing**: pytest (existing), manual cross-platform validation
**Target Platform**: Windows, macOS, Linux (cross-platform)
**Project Type**: single (CLI tool extension)
**Performance Goals**: N/A (CLI commands complete in <1s)
**Constraints**: Must not require elevated privileges; must work with user-level installations
**Scale/Scope**: 2 new CLI commands, ~500 lines of new code, 3 supported shells

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevant | Status | Notes |
|-----------|----------|--------|-------|
| I. CSV Schema Contract | No | N/A | No CSV changes |
| II. No Breaking CSV Changes | No | N/A | No CSV changes |
| III. Deterministic CSV Output | No | N/A | No CSV changes |
| IV. PowerBI Frictionless Import | No | N/A | No CSV changes |
| V. SQLite as Source of Truth | No | N/A | No data layer changes |
| VI. Pipeline Artifacts as Persistence | No | N/A | No persistence changes |
| VII. No Publish on Failure | No | N/A | No publish changes |
| VIII. Idempotent State Updates | No | N/A | No state changes |
| IX. Recoverable Persistence | No | N/A | No persistence changes |
| X. Daily Incremental Extraction Default | No | N/A | No extraction changes |
| XI. Periodic Backfill Required | No | N/A | No backfill changes |
| XII. No Silent Data Loss | No | N/A | No data changes |
| XIII. Bounded Rate Limiting | No | N/A | No rate limiting changes |
| XIV. Stable UPSERT Keys | No | N/A | No key changes |
| XV. Organization/Project Scoping | No | N/A | No scoping changes |
| XVI. Names as Labels, IDs as Identity | No | N/A | No identity changes |
| XVII. Cross-Agent Compatibility | Yes | ✓ PASS | CLI works on hosted/self-hosted agents |
| XVIII. Actionable Failure Logs | Yes | ✓ PASS | doctor command provides actionable diagnostics |
| XIX. PAT Secrecy | No | N/A | No PAT handling in new commands |
| XX. Least Privilege Default | Yes | ✓ PASS | No elevated privileges required |
| XXI. Single-Authority Storage Backend | No | N/A | No storage changes |
| XXII. Explicit One-Way Migration | No | N/A | No migration changes |
| XXIII. Automated CSV Contract Validation | No | N/A | No contract changes |
| XXIV. End-to-End Testability | Yes | ✓ PASS | New commands are testable |
| XXV. Backfill Mode Testing | No | N/A | No backfill changes |

**Constitution Check Result**: ✓ PASS - No violations. Changes extend CLI without affecting core data processing.

## Project Structure

### Documentation (this feature)

```text
specs/003-cli-distribution/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Not needed (no data model)
├── quickstart.md        # Installation quickstart guide
├── contracts/           # Not needed (no API contracts)
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── ado_git_repo_insights/
│   ├── cli.py                    # [MODIFY] Add setup-path and doctor subcommands
│   ├── commands/                 # [ADD] New directory for command implementations
│   │   ├── __init__.py
│   │   ├── setup_path.py         # [ADD] setup-path command implementation
│   │   └── doctor.py             # [ADD] doctor command implementation
│   └── utils/
│       ├── shell_detection.py    # [ADD] Cross-platform shell detection
│       ├── path_utils.py         # [ADD] PATH manipulation utilities
│       └── install_detection.py  # [ADD] Installation method detection

tests/
├── unit/
│   ├── test_setup_path.py        # [ADD] Tests for setup-path command
│   ├── test_doctor.py            # [ADD] Tests for doctor command
│   ├── test_shell_detection.py   # [ADD] Tests for shell detection
│   └── test_path_utils.py        # [ADD] Tests for PATH utilities
└── integration/
    └── test_cli_distribution.py  # [ADD] End-to-end installation tests

docs/
├── installation.md               # [ADD/MODIFY] Installation documentation
└── troubleshooting.md            # [ADD] Troubleshooting guide with doctor usage
```

**Structure Decision**: Extends existing single-project structure. New commands are organized under `commands/` subdirectory for clarity. Utilities are added to existing `utils/` directory.

## Complexity Tracking

No complexity violations. All changes extend existing CLI infrastructure without adding architectural complexity.

## File Change Summary

| File | Type | Changes | Priority |
|------|------|---------|----------|
| `src/ado_git_repo_insights/cli.py` | Modify | Add setup-path and doctor subcommands | P1 |
| `src/ado_git_repo_insights/commands/__init__.py` | Add | Package init | P1 |
| `src/ado_git_repo_insights/commands/setup_path.py` | Add | setup-path implementation | P1 |
| `src/ado_git_repo_insights/commands/doctor.py` | Add | doctor implementation | P2 |
| `src/ado_git_repo_insights/utils/shell_detection.py` | Add | Shell detection logic | P1 |
| `src/ado_git_repo_insights/utils/path_utils.py` | Add | PATH manipulation | P1 |
| `src/ado_git_repo_insights/utils/install_detection.py` | Add | Installation detection | P2 |
| `tests/unit/test_setup_path.py` | Add | Unit tests | P1 |
| `tests/unit/test_doctor.py` | Add | Unit tests | P2 |
| `tests/unit/test_shell_detection.py` | Add | Unit tests | P1 |
| `tests/unit/test_path_utils.py` | Add | Unit tests | P1 |
| `docs/installation.md` | Add/Modify | Installation guide | P1 |
| `README.md` | Modify | Update installation section | P1 |

## Design Decisions

### D1: Shell Detection Strategy

**Decision**: Use a combination of environment variables and file existence checks to detect the current shell.

**Detection Order** (per research.md R1):
1. Check `$PSModulePath` for PowerShell detection (cross-platform, including Windows)
2. Check `$SHELL` environment variable (Unix/macOS)
3. On Windows without PowerShell markers, default to `cmd`
4. Fall back to `bash` if unable to detect on Unix

**Note**: PowerShell check comes first because `$PSModulePath` is set even when PowerShell is running on Unix/macOS, and this is the most reliable cross-platform signal.

**Shell Configuration Files**:
| Shell | Config File | Notes |
|-------|------------|-------|
| bash | `~/.bashrc` | Also check `~/.bash_profile` on macOS |
| zsh | `~/.zshrc` | Default on modern macOS |
| PowerShell | `$PROFILE` | Cross-platform PowerShell profile |

### D2: PATH Entry Format

**Decision**: Use a consistent marker comment to identify entries added by setup-path.

**Format**:
```bash
# >>> ado-insights setup-path >>>
export PATH="$PATH:/path/to/scripts"
# <<< ado-insights setup-path <<<
```

**Benefits**:
- Easy to identify for removal
- Idempotent (can detect if already present)
- Human-readable
- Consistent across shells

### D3: Doctor Output Format

**Decision**: Use structured output with clear sections for each diagnostic area.

**Output Structure**:
```
ado-insights doctor
==================

Executable: /path/to/ado-insights
Version: X.Y.Z
Python: /path/to/python (3.X.Y)
Installation Method: pipx | uv | pip | unknown

Environment
-----------
Scripts Directory: /path/to/scripts
On PATH: Yes | No
PATH contains: [list of matching entries]

Conflicts
---------
[Only shown if conflicts detected]
Multiple installations found:
  1. /path/to/first (pipx)
  2. /path/to/second (pip)

Recommendation:
  Run: pipx uninstall ado-git-repo-insights  # or specific fix command

Status: OK | CONFLICT | PATH_ISSUE
```

### D4: Installation Method Detection

**Decision**: Detect installation method by examining the executable path and environment.

**Detection Logic**:
| Method | Indicator |
|--------|-----------|
| pipx | Path contains `.local/pipx/venvs/` or similar |
| uv | Path contains `.local/share/uv/tools/` or similar |
| pip (user) | Path contains `.local/bin/` without pipx/uv markers |
| pip (venv) | Path inside a virtualenv |
| unknown | None of the above |

### D5: Conflict Detection Strategy

**Decision**: Search PATH for all instances of `ado-insights` executable and report if multiple found.

**Search Algorithm**:
1. Get all directories in PATH
2. For each directory, check if `ado-insights` (or `ado-insights.exe` on Windows) exists
3. Deduplicate by resolved path
4. If >1 unique executables found, report as conflict
5. Provide specific uninstall commands based on detected installation methods

### D6: Error Handling Philosophy

**Decision**: Fail gracefully with actionable messages; never leave user stuck.

**Principles**:
- If shell config file doesn't exist, create it
- If shell config file is read-only, report the issue and provide manual instructions
- If shell is unsupported, provide best-effort guidance
- Always provide the command that would have been run (via `--print-only` or in error message)

### D7: Cross-Platform PowerShell Profile

**Decision**: Support PowerShell on all platforms (Windows, macOS, Linux).

**Profile Locations**:
| OS | Profile Path |
|----|--------------|
| Windows | `$HOME\Documents\PowerShell\Microsoft.PowerShell_profile.ps1` |
| macOS/Linux | `~/.config/powershell/Microsoft.PowerShell_profile.ps1` |

**Note**: Check `$PROFILE` variable first for custom locations.
