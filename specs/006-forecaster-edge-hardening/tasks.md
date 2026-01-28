# Tasks: ML Forecaster Edge Case Hardening

**Feature**: 006-forecaster-edge-hardening
**Generated**: 2026-01-27
**Source**: [plan.md](./plan.md), [spec.md](./spec.md)

## Task Summary

| Phase | Tasks | Parallel Opportunities |
|-------|-------|------------------------|
| Setup | 2 | 2 (branch + schema validation) |
| US1: Constant Data (P1) | 5 | 2 (detection + status enum) |
| US2: Extreme Values (P2) | 3 | 2 (safe clipping + floor tracking) |
| US3: Test Coverage (P2) | 5 | 3 (constant + overflow + golden) |
| US4: Performance Guards (P3) | 2 | 2 (predictions.ts + ml.ts) |
| Finalize | 2 | 0 (sequential) |
| **Total** | **19** | **11** |

---

## Phase: Setup

### Task S-1: Create feature branch
- [X] Create branch `006-forecaster-edge-hardening` from main
- [X] Verify clean working tree before starting

### Task S-2: Add JSON schema validation test infrastructure
- [X] Add `jsonschema` to test dependencies if not present
- [X] Create `tests/fixtures/golden/` directory if not exists
- [X] Add schema validation helper in test conftest

---

## User Story 1: Reliable Forecasts with Constant Data (P1)

> As a team lead reviewing PR metrics, I want the forecasting system to handle datasets where all values are identical without producing errors.

**Acceptance**: FR-001, SC-001, SC-002

### Task US1-1: Add constant series detection
- [X] In `fallback_forecaster.py`, add `detect_constant_series()` function using `np.ptp(values) == 0`
- [X] Call detection before linear regression in `_forecast_metric()`
- [X] When constant detected: return baseline as predicted, lower_bound = upper_bound = predicted
- [X] Add inline comment explaining ptp approach per research.md RQ-1

**File**: `src/ado_git_repo_insights/ml/fallback_forecaster.py`

### Task US1-2: Add status enum and reason_code to output schema
- [X] Add `status: str` field to forecast output (ok | insufficient_data | invalid_data | degraded)
- [X] Add `reason_code: str | None` field to forecast output
- [X] Update `_build_result()` or equivalent to include new fields
- [X] Set `reason_code: "constant_series"` when constant series detected

**File**: `src/ado_git_repo_insights/ml/fallback_forecaster.py`

### Task US1-3: Implement deterministic JSON formatting
- [X] Add `format_forecast_json()` helper or update `_write_predictions()`
- [X] Use `json.dump(..., sort_keys=True, indent=2)`
- [X] Round all floats to 2 decimal places before serialization
- [X] Sort forecasts array alphabetically by metric name

**File**: `src/ado_git_repo_insights/ml/fallback_forecaster.py`

### Task US1-4: Handle insufficient data status codes
- [X] When N < MIN_WEEKS_REQUIRED: status = "insufficient_data", reason_code = "too_few_weeks"
- [X] When all values are NaN: status = "insufficient_data", reason_code = "all_nan"
- [X] Ensure empty forecasts array in both cases

**File**: `src/ado_git_repo_insights/ml/fallback_forecaster.py`

### Task US1-5: Propagate Prophet forecaster changes (if applicable)
- [X] Review `forecaster.py` for parallel constant series handling needs
- [X] Apply same status/reason_code pattern if Prophet forecaster is active
- [X] Skip if Prophet is not currently used

**File**: `src/ado_git_repo_insights/ml/forecaster.py`

---

## User Story 2: Robust Handling of Extreme Values (P2)

> As a data analyst, I want the forecasting system to handle extremely large cycle time values without numeric errors.

**Acceptance**: FR-002, FR-003, FR-004, FR-005, SC-006

### Task US2-1: Implement safe outlier clipping
- [X] Add `safe_clip_outliers(values, threshold=3.0, min_n=4)` function
- [X] Filter to finite values first: `finite_mask = np.isfinite(values)`
- [X] Require N≥4 finite values for stats computation
- [X] When stats undefined: return original values with `reason_code = "stats_undefined"`
- [X] Compute mean/std on finite values only using `np.nanmean()`, `np.nanstd()`
- [X] Check for zero variance before computing clip bounds

**File**: `src/ado_git_repo_insights/ml/fallback_forecaster.py`

### Task US2-2: Add constraints_applied tracking
- [X] Add `constraints_applied: list[str]` field to each forecast value dict
- [X] When negative prediction floored to 0: append `"floor_zero"` to list
- [X] When outlier clipped: append `"outlier_clipped"` to list
- [X] Default to empty list `[]` when no constraints applied

**File**: `src/ado_git_repo_insights/ml/fallback_forecaster.py`

### Task US2-3: Add NaN/negative value filtering
- [X] Filter NaN values before regression using `np.isfinite()`
- [X] Track if significant filtering occurred
- [X] When negative values filtered: set `reason_code = "negative_values_filtered"` with status = "degraded"
- [X] Ensure at least MIN_WEEKS_REQUIRED finite values remain after filtering

**File**: `src/ado_git_repo_insights/ml/fallback_forecaster.py`

---

## User Story 3: Comprehensive Test Coverage (P2)

> As a developer maintaining the ML forecasting module, I want comprehensive test coverage for edge cases.

**Acceptance**: FR-007, SC-003, SC-004, SC-007

### Task US3-1: Add constant series test
- [X] Create test with 8 weeks of identical values (e.g., all 100.0)
- [X] Assert `status == "ok"` and `reason_code == "constant_series"`
- [X] Assert all `predicted`, `lower_bound`, `upper_bound` are equal
- [X] Assert `constraints_applied` is empty list

**File**: `tests/unit/test_fallback_forecaster.py`

### Task US3-2: Add large value overflow test
- [X] Create test with values up to 10^9
- [X] Assert no NaN/inf in output: `np.isfinite(predicted)`
- [X] Assert status is "ok" or "degraded" (not error)
- [X] Verify all forecast values are valid numbers

**File**: `tests/unit/test_fallback_forecaster.py`

### Task US3-3: Add NaN-heavy dataset test
- [X] Create test with >50% NaN values but ≥4 finite values
- [X] Assert forecaster produces valid output
- [X] Create test with <4 finite values
- [X] Assert `status == "insufficient_data"` and `reason_code == "all_nan"`

**File**: `tests/unit/test_fallback_forecaster.py`

### Task US3-4: Add negative prediction floor test
- [X] Create test data with strongly negative trend
- [X] Assert predictions are floored at 0.0
- [X] Assert `constraints_applied` contains `"floor_zero"`

**File**: `tests/unit/test_fallback_forecaster.py`

### Task US3-5: Add golden-file determinism test
- [X] Create `tests/fixtures/golden/constant-series-forecast.json` expected output
- [X] Create test that generates forecast from constant data
- [X] Compare JSON output byte-for-byte with golden file
- [X] Ensure test fails if output differs (catches formatting regressions)

**Files**:
- `tests/unit/test_fallback_forecaster.py`
- `tests/fixtures/golden/constant-series-forecast.json`

---

## User Story 4: Performance Safeguards for Large Datasets (P3)

> As a user viewing the dashboard, I want chart rendering to remain responsive with large datasets.

**Acceptance**: FR-006, SC-005

### Task US4-1: Add data point limit to predictions.ts
- [X] Add `MAX_CHART_POINTS = 200` constant
- [X] Apply `.slice(-MAX_CHART_POINTS)` to data before rendering
- [X] Add comment explaining "take last N" strategy per research.md RQ-6

**File**: `extension/ui/modules/charts/predictions.ts`

### Task US4-2: Add data point limit to ml.ts sparklines
- [X] Add `MAX_SPARKLINE_POINTS = 200` constant
- [X] Apply same slicing strategy to sparkline data
- [X] Ensure consistent behavior with predictions.ts

**File**: `extension/ui/modules/ml.ts`

---

## Phase: Finalize

### Task F-1: Run full test suite and CI checks
- [X] Run `pytest` - all tests pass
- [X] Run `ruff check .` - no lint errors
- [X] Run TypeScript compile check - no errors
- [X] Run ESLint - no errors

### Task F-2: Validate schema compliance
- [X] Validate generated forecast output against `contracts/forecast-schema.json`
- [X] Verify golden-file test passes
- [X] Manual review of sample output for correctness

---

## Dependency Graph

```
S-1 (branch) ─────────────────────────────────────────────────────────┐
S-2 (test infra) ─────────────────────────────────────────────────────┤
                                                                      │
US1-1 (constant detect) ──┬─► US1-4 (status codes) ──┐                │
US1-2 (status enum) ──────┘                          │                │
US1-3 (deterministic JSON) ──────────────────────────┤                │
US1-5 (prophet sync) ────────────────────────────────┤                │
                                                     │                │
US2-1 (safe clipping) ──┬─► US2-3 (NaN filtering) ───┤                │
US2-2 (constraints) ────┘                            │                │
                                                     ▼                │
                                              US3-* (tests) ──────────┤
                                                     │                │
US4-1 (predictions.ts) ──────────────────────────────┤                │
US4-2 (ml.ts) ───────────────────────────────────────┤                │
                                                     │                │
                                                     ▼                │
                                              F-1 (CI checks) ────────┤
                                              F-2 (schema validate) ──┘
```

## Parallel Execution Notes

**Wave 1** (can run in parallel):
- S-1: Create branch
- S-2: Test infrastructure setup

**Wave 2** (can run in parallel after Wave 1):
- US1-1: Constant series detection
- US1-2: Status enum
- US1-3: Deterministic JSON
- US2-1: Safe outlier clipping
- US2-2: Constraints tracking

**Wave 3** (depends on Wave 2):
- US1-4: Insufficient data handling (needs US1-1, US1-2)
- US1-5: Prophet sync (needs US1-2)
- US2-3: NaN filtering (needs US2-1)

**Wave 4** (can run in parallel after Wave 3):
- US3-1 through US3-5: All tests
- US4-1: predictions.ts limits
- US4-2: ml.ts limits

**Wave 5** (sequential, final):
- F-1: CI checks
- F-2: Schema validation
