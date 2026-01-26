# Implementation Plan: Address Review Feedback for Unified Dashboard Serve

**Branch**: `002-serve-review-fixes` | **Date**: 2026-01-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-serve-review-fixes/spec.md`

## Summary

This flight addresses code review feedback from Flight 20260126B. All changes are targeted fixes to improve logging, validation hardening, collision safety, regex escaping, DRY flag validation, and dashboard function decomposition. No behavioral changes to the existing --serve feature.

## Technical Context

**Language/Version**: Python 3.10+ (CLI refactoring), PowerShell 5.1+/7+ (script fixes)
**Primary Dependencies**: argparse (stdlib), http.server/socketserver (stdlib), webbrowser (stdlib)
**Storage**: N/A
**Testing**: pytest, Pester (PowerShell)
**Target Platform**: Windows, Linux, macOS
**Project Type**: single (CLI tool with scripts)
**Performance Goals**: N/A (no performance changes)
**Constraints**: Must preserve existing behavior, all existing tests must pass
**Scale/Scope**: 5 files modified, ~200 lines changed

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
| XVII. Cross-Agent Compatibility | Yes | ✓ PASS | PowerShell scripts work cross-platform |
| XVIII. Actionable Failure Logs | Yes | ✓ PASS | Adding warnings improves diagnostics |
| XIX. PAT Secrecy | No | N/A | No PAT handling changes |
| XX. Least Privilege Default | No | N/A | No permission changes |
| XXI. Single-Authority Storage Backend | No | N/A | No storage changes |
| XXII. Explicit One-Way Migration | No | N/A | No migration changes |
| XXIII. Automated CSV Contract Validation | No | N/A | No contract changes |
| XXIV. End-to-End Testability | Yes | ✓ PASS | Refactoring improves testability |
| XXV. Backfill Mode Testing | No | N/A | No backfill changes |

**Constitution Check Result**: ✓ PASS - No violations. All changes improve code quality without affecting core data contracts.

## Project Structure

### Documentation (this feature)

```text
specs/002-serve-review-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Not needed (no data model changes)
├── quickstart.md        # Not needed (no new features)
├── contracts/           # Not needed (no API changes)
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── ado_git_repo_insights/
│   ├── cli.py           # [MODIFY] DRY flag validation, dashboard decomposition
│   └── ...

tests/
├── unit/
│   └── test_cli_validation.py  # [ADD] Tests for shared validation function
└── integration/

.specify/scripts/powershell/
├── common.ps1           # [MODIFY] Add git fallback warning
├── create-new-feature.ps1    # [MODIFY] Add fetch failure warning, collision detection
└── update-agent-context.ps1  # [MODIFY] Placeholder validation, regex escaping

.claude/commands/
└── speckit.implement.md # [MODIFY] Externalize technology patterns (optional/P3)
```

**Structure Decision**: Single project structure retained. Changes are localized refactoring within existing files.

## Complexity Tracking

No complexity violations. All changes are targeted fixes that simplify or improve existing code.

## File Change Summary

| File | Type | Changes | Priority |
|------|------|---------|----------|
| `.specify/scripts/powershell/common.ps1` | Modify | Add Write-Warning on git fallback | P1 |
| `.specify/scripts/powershell/create-new-feature.ps1` | Modify | Fetch warning, collision detection | P1 |
| `.specify/scripts/powershell/update-agent-context.ps1` | Modify | Placeholder validation, regex escaping | P1 |
| `src/ado_git_repo_insights/cli.py` | Modify | Extract shared validation, decompose _serve_dashboard | P2 |
| `.claude/commands/speckit.implement.md` | Modify | Externalize patterns (optional) | P3 |

## Design Decisions

### D1: Git Fallback Warning Strategy

**Decision**: Use `Write-Warning` with `[specify]` prefix for consistency with existing warnings.

**Rationale**: Existing code already uses this pattern (line 78, 251 in create-new-feature.ps1).

**Format**: `Write-Warning "[specify] Git not available, falling back to script location for repo root"`

### D2: Branch Name Collision Detection

**Decision**: After truncation, check both local and remote branches. If collision detected, append short hash of original branch name.

**Rationale**: Hash suffix preserves uniqueness without requiring user intervention. Uses first 6 characters of SHA256 of full original name.

**Implementation**:
```powershell
# Pseudo-code
if (branch-exists $truncatedName) {
    $hash = (Get-StringHash $originalName).Substring(0,6)
    $truncatedName = "$truncatedName-$hash"
}
```

### D3: Regex Escaping Pattern

**Decision**: Use `[Regex]::Escape()` on all user-provided values before regex replacement.

**Rationale**: PowerShell's `-replace` operator interprets the replacement string as a regex pattern. Special characters like `$`, `\`, etc. must be escaped.

**Affected Lines**: Lines 225, 238, 241, 244, 256, 279, 285, 291, 292 in update-agent-context.ps1

### D4: Placeholder Validation

**Decision**: Before template replacement, verify all required placeholders exist. If missing, log warning and skip that replacement (don't fail).

**Rationale**: Graceful degradation is better than hard failure for optional placeholders. Critical placeholders should be documented.

**Required Placeholders**:
- `[PROJECT NAME]` - Required
- `[DATE]` - Required
- `[EXTRACTED FROM ALL PLAN.MD FILES]` - Optional (may be empty)
- `[ACTUAL STRUCTURE FROM PLANS]` - Optional
- `[ONLY COMMANDS FOR ACTIVE TECHNOLOGIES]` - Optional
- `[LANGUAGE-SPECIFIC, ONLY FOR LANGUAGES IN USE]` - Optional
- `[LAST 3 FEATURES AND WHAT THEY ADDED]` - Optional

### D5: Shared Flag Validation Function

**Decision**: Extract flag validation into `_validate_serve_flags(args, command_name)` function.

**Rationale**: DRY principle - identical validation logic in cmd_build_aggregates (line 803-815) and cmd_stage_artifacts (line 1104-1116).

**Function Signature**:
```python
def _validate_serve_flags(args: Namespace, command_name: str) -> Optional[int]:
    """Validate --serve related flags. Returns exit code if invalid, None if valid."""
```

### D6: Dashboard Function Decomposition

**Decision**: Break `_serve_dashboard` into three focused functions:
1. `_sync_ui_bundle(repo_root, ui_source)` - Dev mode UI sync logic
2. `_prepare_serve_directory(ui_source, dataset_path)` - Temp dir setup, file copying
3. `_run_http_server(serve_dir, port, open_browser)` - Server execution

**Rationale**: Current function (lines 1298-1449) handles UI sync, file preparation, and server execution. Decomposition improves testability and readability.

### D7: Technology Patterns Configuration (P3 - Optional)

**Decision**: Move hardcoded technology patterns in speckit.implement.md to a separate config file at `.specify/config/technology-patterns.yaml`.

**Rationale**: Easier maintenance, allows users to extend patterns without modifying command files.

**Deferred**: This is P3 priority and may be deferred to a future flight.
