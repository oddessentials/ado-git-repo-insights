# Implementation Plan: ML Forecaster Edge Case Hardening

**Branch**: `006-forecaster-edge-hardening` | **Date**: 2026-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-forecaster-edge-hardening/spec.md`

## Summary

Harden the ML forecaster (`FallbackForecaster`) against edge cases identified in code review feedback. Key changes include handling zero-variance (constant) data series without division-by-zero errors, implementing safe outlier clipping with fallback behavior, adding structured status codes with reason codes, tracking floor-to-zero constraints, and ensuring deterministic JSON output for golden-file testing.

## Technical Context

**Language/Version**: Python 3.10+ (backend), TypeScript (frontend/extension)
**Primary Dependencies**: numpy, pandas (Python); esbuild (TypeScript bundling)
**Storage**: SQLite (source of truth per Constitution Principle V)
**Testing**: pytest (Python), Jest (TypeScript)
**Target Platform**: Azure DevOps Pipeline + Browser Extension
**Project Type**: Single monorepo with Python backend + TypeScript extension
**Performance Goals**: Chart rendering <100ms for 200 data points
**Constraints**: No NaN/inf in output; deterministic JSON; backward-compatible schema
**Scale/Scope**: Forecast datasets typically 4-52 weeks; edge cases up to 10^9 values

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| III. Deterministic Output | ✅ PASS | FR-008 mandates deterministic JSON (sorted keys, 2dp rounding) |
| V. SQLite as Source of Truth | ✅ PASS | Forecaster reads from SQLite weekly rollups |
| VII. No Publish on Failure | ✅ PASS | Status codes (insufficient_data, invalid_data) prevent silent failures |
| XII. No Silent Data Loss | ✅ PASS | Structured status + reason_code makes failures explicit |
| XXIII. Automated Contract Validation | ✅ PASS | FR-007 requires edge case tests; SC-007 adds golden-file test |

**Gate Result**: PASS - No constitution violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/006-forecaster-edge-hardening/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── forecast-schema.json
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── ml/
│   ├── __init__.py           # get_forecaster factory
│   ├── fallback_forecaster.py # PRIMARY: Edge case hardening here
│   ├── forecaster.py          # Prophet-based forecaster (parallel changes)
│   └── insights.py            # LLM insights (no changes)
└── transform/
    └── aggregators.py         # Weekly rollup generation

extension/ui/modules/
├── charts/
│   └── predictions.ts         # Chart rendering (data point limits)
└── ml.ts                      # ML sparklines (data point limits)

tests/
├── unit/
│   └── test_fallback_forecaster.py  # Edge case tests
└── fixtures/
    └── golden/
        └── constant-series-forecast.json  # Golden file for SC-007
```

**Structure Decision**: Existing monorepo structure. Primary changes in `ml/fallback_forecaster.py` with supporting test additions.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |

## Phase 0: Research Summary

See [research.md](./research.md) for detailed findings.

### Key Decisions

1. **Constant series handling**: Detect via `np.ptp(values) == 0`, return baseline as predicted with identical bounds
2. **Safe outlier clipping**: Filter to finite values first, require N≥4, skip clipping if stats undefined
3. **Status enum**: `ok | insufficient_data | invalid_data | degraded` with `reason_code` string
4. **Constraint tracking**: `constraints_applied: string[]` per forecast value
5. **Deterministic output**: `json.dump(..., sort_keys=True)` + explicit 2dp rounding

## Phase 1: Design Summary

See [data-model.md](./data-model.md) for entity definitions and [contracts/forecast-schema.json](./contracts/forecast-schema.json) for the output schema.

### API Changes

**ForecastValue** (per-value object):
- Add `constraints_applied: string[]` field

**ForecastResult** (top-level):
- Add `status: str` field (ok | insufficient_data | invalid_data | degraded)
- Add `reason_code: str | None` field

### New Functions

- `safe_clip_outliers(values, threshold, min_n)` - Safe clipping with fallback
- `detect_constant_series(values)` - Zero-variance detection
- `format_forecast_json(data)` - Deterministic JSON formatting

## Implementation Phases

### Phase 2.1: Core Forecaster Hardening (P1)

1. Add constant series detection in `_forecast_metric()`
2. Implement safe outlier clipping with fallback
3. Add `constraints_applied` tracking to forecast values
4. Add `status` and `reason_code` to output schema
5. Implement deterministic JSON formatting

### Phase 2.2: Test Coverage (P2)

1. Add constant series test with golden file
2. Add zero-variance clipping test
3. Add NaN-heavy dataset test
4. Add large value (10^9) overflow test
5. Add negative prediction floor test with constraint tracking

### Phase 2.3: Chart Performance Guards (P3)

1. Add data point limit (200) to predictions.ts
2. Add data point limit to ml.ts sparklines
3. Add deterministic downsampling (take last N)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Schema change breaks consumers | Low | High | Additive-only changes; new fields have defaults |
| Golden file flakiness | Medium | Low | Deterministic formatting + sorted keys |
| Performance regression | Low | Medium | Limit data points; benchmark in tests |

## Next Steps

Run `/speckit.tasks` to generate the task breakdown for implementation.
