# Implementation Plan: Security Hardening - Zip Slip Protection & Token Encoding

**Branch**: `017-security-fixes` | **Date**: 2026-01-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-security-fixes/spec.md`

## Summary

Harden ZIP extraction against Zip Slip attacks by validating every ZIP entry's target path before extraction, using a temp-directory-then-swap approach with backup-on-failure recovery. Additionally, URL-encode Azure DevOps continuation tokens via a centralized helper function to ensure reliable pagination across all endpoints (PRs, teams, team members, PR threads).

## Technical Context

**Language/Version**: Python 3.10+
**Primary Dependencies**: `zipfile` (stdlib), `urllib.parse` (stdlib), `requests>=2.28.0`
**Storage**: SQLite (artifacts staged to local filesystem)
**Testing**: pytest with 75% coverage floor
**Target Platform**: Linux/Windows (Azure DevOps hosted and self-hosted agents)
**Project Type**: Single Python package with CLI entry point
**Performance Goals**: No measurable regression on extraction or pagination
**Constraints**: Cross-platform compatibility (Windows rename semantics differ from Unix)
**Scale/Scope**: Handles ZIP artifacts up to typical ADO pipeline artifact sizes; paginated APIs return 100-1000 items per page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| XII. No Silent Data Loss | ✅ PASS | Pagination encoding ensures complete token handling; ZIP validation prevents silent file escape |
| VII. No Publish on Failure | ✅ PASS | Backup-then-swap ensures no partial extraction on failure |
| XVIII. Actionable Failure Logs | ✅ PASS | Clear error messages identify offending ZIP entries or rename failures |
| XIX. PAT Secrecy | ✅ PASS | No changes to auth handling |
| XVII. Cross-Agent Compatibility | ✅ PASS | Using stdlib `zipfile` and `os.rename`; cross-platform backup-then-swap handles Windows semantics |
| XXIII. Automated CSV Contract Validation | ✅ PASS | No CSV schema changes |
| XXIV. End-to-End Testability | ✅ PASS | Adding regression tests for ZIP attacks and token encoding |

**Pre-Design Gate**: PASS - No constitution violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/017-security-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal - no new data entities)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal function contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── cli.py                      # ZIP extraction in cmd_stage_artifacts() - MODIFY
├── extractor/
│   ├── ado_client.py           # Pagination token handling - MODIFY
│   └── pagination.py           # NEW: Centralized token helper
└── utils/
    └── safe_extract.py         # NEW: Safe ZIP extraction module

tests/
├── unit/
│   ├── test_safe_extract.py    # NEW: Zip Slip regression tests
│   ├── test_pagination_helper.py # NEW: Token encoding tests
│   └── test_ado_client_pagination.py # MODIFY: Add special char token tests
├── fixtures/
│   ├── malicious_symlink.zip   # NEW: Test fixture with symlink entry
│   └── malicious_traversal.zip # NEW: Test fixture with ../../../ path
└── integration/
    └── test_stage_artifacts.py # MODIFY: Add security regression tests

.github/workflows/
└── ci.yml                      # MODIFY: Add continuationToken guard step
```

**Structure Decision**: Single Python package structure maintained. New modules added under existing directories following established patterns.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |

## Implementation Phases

### Phase 0: Research Complete

See [research.md](./research.md) for:
- Python `zipfile` symlink detection via `external_attr`
- Cross-platform `os.rename` vs `shutil.move` semantics
- `urllib.parse.quote_plus` vs `quote` for query string encoding
- CI guard implementation patterns

### Phase 1: Design Artifacts

See:
- [data-model.md](./data-model.md) - Entity definitions (ZIP Entry validation, Token handling)
- [contracts/](./contracts/) - Function signatures and contracts
- [quickstart.md](./quickstart.md) - Developer testing guide

### Phase 2: Task Decomposition

Generated via `/speckit.tasks` command after Phase 1 approval.

## Post-Design Constitution Re-Check

*GATE: Verified after Phase 1 design completion.*

| Principle | Status | Notes |
|-----------|--------|-------|
| XII. No Silent Data Loss | ✅ PASS | `add_continuation_token()` ensures complete pagination; `safe_extract_zip()` fails loud on violations |
| VII. No Publish on Failure | ✅ PASS | Backup-then-swap in `safe_extract_zip()` preserves previous state on failure |
| XVIII. Actionable Failure Logs | ✅ PASS | `ZipSlipError` includes `entry_name` and `reason`; pagination errors include context |
| XIX. PAT Secrecy | ✅ PASS | No changes to auth handling; tokens are pagination tokens, not secrets |
| XVII. Cross-Agent Compatibility | ✅ PASS | Using stdlib only (`zipfile`, `shutil`, `urllib.parse`); tested patterns work on Windows |
| XXIII. Automated CSV Contract Validation | ✅ PASS | No CSV changes; CI guard added for `continuationToken` enforcement |
| XXIV. End-to-End Testability | ✅ PASS | Regression tests defined: symlink ZIP, traversal ZIP, special-char token |
| QG-09 Pagination Completeness | ✅ PASS | Centralized helper ensures all endpoints use proper encoding |

**Post-Design Gate**: PASS - Design preserves all constitution principles.

## Generated Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Implementation Plan | `specs/017-security-fixes/plan.md` | ✅ Complete |
| Research | `specs/017-security-fixes/research.md` | ✅ Complete |
| Data Model | `specs/017-security-fixes/data-model.md` | ✅ Complete |
| Safe Extract Contract | `specs/017-security-fixes/contracts/safe_extract.md` | ✅ Complete |
| Pagination Contract | `specs/017-security-fixes/contracts/pagination.md` | ✅ Complete |
| Quickstart Guide | `specs/017-security-fixes/quickstart.md` | ✅ Complete |
| Task Decomposition | `specs/017-security-fixes/tasks.md` | ✅ Complete |
