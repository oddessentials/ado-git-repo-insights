# Implementation Plan: ML Features Enhancement

**Branch**: `004-ml-features-enhancement` | **Date**: 2026-01-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-ml-features-enhancement/spec.md`

## Summary

Enhance the ML features (Predictions and AI Insights tabs) from basic tables to enterprise-grade visualizations with zero-config defaults. Add a fallback linear regression forecaster (numpy-only) that works without Prophet, implement Chart.js-based forecast visualizations with confidence bands, enhance AI insight cards with sparklines and actionable recommendations, and provide synthetic preview data in dev mode with production lock enforcement.

## Technical Context

**Language/Version**: Python 3.10+ (backend), TypeScript (frontend)
**Primary Dependencies**:
- Backend: numpy (fallback forecaster), prophet (optional enhanced), openai (insights)
- Frontend: Chart.js (already in project), existing extension SDK
**Storage**: Pipeline artifacts (`insights/cache.json`, `predictions/trends.json`)
**Testing**: pytest (Python), manual dashboard testing (TypeScript)
**Target Platform**: Azure DevOps Extension, local CLI (`--serve`)
**Project Type**: Hybrid (Python backend + TypeScript extension UI)
**Performance Goals**: Chart rendering <100ms for 12 weeks of data
**Constraints**: No new npm dependencies (NFR-003), 80%+ test coverage (NFR-005)
**Scale/Scope**: 10,000+ PRs per project, 12 weeks forecast horizon max

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CSV Schema Contract | ✅ PASS | ML features don't modify CSV output |
| II. No Breaking CSV Changes | ✅ PASS | No CSV changes in this feature |
| III. Deterministic CSV Output | ✅ PASS | Not affected |
| IV. PowerBI Frictionless Import | ✅ PASS | Not affected |
| V. SQLite as Source of Truth | ✅ PASS | Forecaster reads from SQLite via DB manager |
| VI. Pipeline Artifacts as Persistence | ✅ PASS | Cache persists in `insights/cache.json` artifact |
| VII. No Publish on Failure | ✅ PASS | ML output is additive; CSV generation unaffected |
| XII. No Silent Data Loss | ✅ PASS | Low-data scenarios show "Insufficient Data" warning |
| XIX. PAT Secrecy | ✅ PASS | OpenAI key handled via pipeline secrets |
| XXIII. Automated Contract Validation | ⚠️ VERIFY | Must add tests for ML JSON schemas |

**Gate Result**: PASS (no blocking violations)

## Project Structure

### Documentation (this feature)

```text
specs/004-ml-features-enhancement/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── ml/
│   ├── __init__.py           # Export forecasters
│   ├── forecaster.py         # MODIFY: Add fallback integration
│   ├── fallback_forecaster.py # NEW: Linear regression forecaster
│   ├── insights.py           # MODIFY: Enhanced schema + ordering
│   └── date_utils.py         # Existing
├── cli.py                    # MODIFY: Auto-detection logic
└── ...

extension/ui/
├── modules/
│   ├── ml.ts                 # MODIFY: Chart rendering, rich cards
│   ├── ml/
│   │   ├── types.ts          # Existing
│   │   ├── synthetic.ts      # NEW: Synthetic data generator
│   │   ├── dev-mode.ts       # NEW: Dev mode detection
│   │   └── setup-guides.ts   # NEW: Embedded setup instructions
│   └── charts/
│       └── predictions.ts    # NEW: Forecast chart rendering
├── types.ts                  # MODIFY: Extended InsightItem schema
├── styles.css                # MODIFY: New component styles
└── index.html                # MODIFY: Setup guide containers

tests/
├── unit/
│   ├── test_fallback_forecaster.py  # NEW
│   └── test_insights_enhanced.py    # NEW
└── integration/
    └── test_ml_integration.py       # MODIFY: Add fallback tests
```

**Structure Decision**: Hybrid project - Python backend in `src/` with TypeScript extension UI in `extension/ui/`. New modules follow existing patterns.

## Complexity Tracking

> No Constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
