# Implementation Plan: ML Metrics Accuracy Fixes

**Branch**: `005-ml-metrics-fixes` | **Date**: 2026-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-ml-metrics-fixes/spec.md`

## Summary

Fix four ML metrics accuracy issues identified in code review:
1. **P90 Calculation** - Replace `max * 0.9` approximation with proper percentile calculation using SQL window functions
2. **Review Time Proxy** - Remove misleading review time forecasts that use cycle time as proxy; show "unavailable" message instead
3. **Synthetic Data Determinism** - Replace `Math.random()` with seeded PRNG for consistent dev mode previews
4. **Test Resource Warnings** - Investigate and fix unclosed database connections in test fixtures

## Technical Context

**Language/Version**: Python 3.10+ (backend), TypeScript (frontend)
**Primary Dependencies**: pandas, numpy (Python); esbuild (TypeScript bundling)
**Storage**: SQLite (source of truth per Constitution Principle V)
**Testing**: pytest (Python), Jest (TypeScript)
**Target Platform**: Azure DevOps Pipeline Task + Extension Hub
**Project Type**: Hybrid (Python CLI + TypeScript extension)
**Performance Goals**: Percentile calculation must complete in <1s for datasets up to 10k PRs
**Constraints**: Must preserve schema version compatibility (FR-008)
**Scale/Scope**: Typical datasets 100-5000 PRs; max supported ~100k

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| III. Deterministic CSV Output | ✅ Pass | P90 fix uses deterministic SQL; no CSV schema changes |
| V. SQLite as Source of Truth | ✅ Pass | Percentile calculated from SQLite data |
| VIII. Idempotent State Updates | ✅ Pass | No state mutation; read-only calculations |
| XII. No Silent Data Loss | ✅ Pass | Missing review time shown as "unavailable" not fake data |
| XXIII. Automated CSV Contract Validation | ✅ Pass | No CSV schema changes |
| XXIV. End-to-End Testability | ✅ Pass | All changes are unit-testable |

**Gate Status**: PASS - No constitution violations

## Project Structure

### Documentation (this feature)

```text
specs/005-ml-metrics-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── ml/
│   ├── insights.py          # P90 calculation fix (lines 280-293)
│   ├── forecaster.py        # Review time mapping fix (lines 197-200)
│   └── fallback_forecaster.py  # Review time mapping fix (lines 274-278)
└── ...

extension/
├── ui/
│   └── modules/
│       └── ml/
│           └── synthetic.ts  # Deterministic seeding fix (line 53)
└── tests/
    └── modules/
        └── ml.test.ts        # Synthetic data tests

tests/
├── unit/
│   ├── test_insights_enhanced.py   # P90 calculation tests
│   ├── test_fallback_forecaster.py # Review time tests
│   └── test_forecaster_contract.py # Schema compatibility tests
└── integration/
    └── test_phase5_ml_integration.py  # End-to-end ML tests
```

**Structure Decision**: Existing hybrid structure (Python backend + TypeScript extension). No new directories needed; all changes are modifications to existing files.

## Complexity Tracking

> No constitution violations to justify.

| Change | Complexity | Justification |
|--------|------------|---------------|
| SQL percentile query | Low | SQLite supports window functions; single query change |
| Review time removal | Low | Remove metric from list; add UI unavailable message |
| Seeded PRNG | Low | Standard pattern; mulberry32 algorithm is well-tested |
| Test fixture cleanup | Low | Add explicit close() calls or context managers |
