# Implementation Plan: Unified Dashboard Launch

**Branch**: `001-unified-dashboard-serve` | **Date**: 2026-01-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-unified-dashboard-serve/spec.md`

## Summary

Add `--serve`, `--open`, and `--port` flags to the `build-aggregates` command to enable a single-command workflow for building aggregates and launching the local dashboard. The implementation reuses the existing `cmd_dashboard` server logic by extracting it into a shared function, ensuring no code duplication while preserving full backward compatibility.

## Technical Context

**Language/Version**: Python 3.10+ (project already supports 3.10, 3.11, 3.12)
**Primary Dependencies**: argparse (stdlib), http.server/socketserver (stdlib), webbrowser (stdlib)
**Storage**: N/A (no new storage; uses existing SQLite → aggregates → temp directory flow)
**Testing**: pytest (existing test infrastructure)
**Target Platform**: Linux, Windows, macOS (cross-platform CLI)
**Project Type**: Single project (Python package with CLI)
**Performance Goals**: N/A (no performance-critical changes; server startup is already instant)
**Constraints**: Must not duplicate server code; backward compatible; fail-fast on invalid flag combinations
**Scale/Scope**: Minor feature addition affecting ~50-100 lines of code in cli.py

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| VII. No Publish on Failure | ✅ PASS | Server only starts after successful aggregate build |
| XVIII. Actionable Failure Logs | ✅ PASS | Clear errors for --open/--port without --serve |
| XVII. Cross-Agent Compatibility | ✅ PASS | Uses only stdlib modules (argparse, http.server) |
| XXIV. End-to-End Testability | ✅ PASS | New flags are unit testable; server logic already tested |

**Relevant Quality Gates**:
- QG-17: Lint + format checks pass
- QG-18: Type checking passes
- QG-19: Unit + integration tests pass

**No violations detected.** This feature is additive and does not modify any data contracts, persistence logic, or extraction behavior.

## Project Structure

### Documentation (this feature)

```text
specs/001-unified-dashboard-serve/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── quickstart.md        # Phase 1 output (usage guide)
├── spec.md              # Feature specification
├── checklists/          # Quality checklists
│   └── requirements.md  # Spec validation
└── contracts/           # Phase 1 output (CLI contract)
    └── cli-flags.md     # New flag definitions
```

**Note**: `data-model.md` is not applicable - this feature adds CLI flags only with no new data entities.

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── cli.py               # MODIFY: Add --serve, --open, --port to build-aggregates
│                        #         Extract _serve_dashboard() helper function
│                        #         Add flag validation in cmd_build_aggregates
└── utils/
    └── dataset_discovery.py  # READ-ONLY: Reuse existing validation

tests/
├── unit/
│   └── test_cli_serve_flags.py  # NEW: Unit tests for flag validation
└── integration/
    └── test_build_aggregates_serve.py  # NEW: Integration test for serve flow
```

**Structure Decision**: Single project. All changes are in `src/ado_git_repo_insights/cli.py` with new test files.

## Complexity Tracking

> No violations - feature is simple additive change.

| Aspect | Complexity | Justification |
|--------|------------|---------------|
| Code duplication | None | Extract shared `_serve_dashboard()` function |
| New dependencies | None | Uses stdlib only |
| Breaking changes | None | New flags are opt-in; default behavior unchanged |
