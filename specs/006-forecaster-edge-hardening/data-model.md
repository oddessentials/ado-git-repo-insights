# Data Model: ML Forecaster Edge Case Hardening

**Feature**: 006-forecaster-edge-hardening
**Date**: 2026-01-27

## Entity Changes

This feature modifies the forecast output schema. All changes are additive and backward-compatible.

### ForecastValue (per-prediction object)

**Current Fields**:
- `period_start: string` - ISO date for forecast period start
- `predicted: number` - Predicted value
- `lower_bound: number` - Lower confidence bound
- `upper_bound: number` - Upper confidence bound

**New Fields**:
- `constraints_applied: string[]` - List of constraints applied to this value
  - Empty array `[]` when no constraints triggered
  - Possible values: `"floor_zero"`, `"outlier_clipped"`

**Example**:
```json
{
  "period_start": "2026-02-03",
  "predicted": 0.0,
  "lower_bound": 0.0,
  "upper_bound": 15.5,
  "constraints_applied": ["floor_zero"]
}
```

---

### ForecastMetric (per-metric object)

**Current Fields**:
- `metric: string` - Metric name (e.g., "pr_throughput", "cycle_time_minutes")
- `unit: string` - Unit of measurement
- `horizon_weeks: number` - Number of weeks forecasted
- `values: ForecastValue[]` - Array of forecast values

**No changes** - constraints are tracked at the value level.

---

### PredictionsResult (top-level output)

**Current Fields**:
- `schema_version: number` - Schema version (1)
- `generated_at: string` - ISO timestamp
- `generated_by: string` - Generator ID (e.g., "linear-v1.0")
- `is_stub: boolean` - Whether this is synthetic/preview data
- `forecaster: string` - Forecaster type ("linear" or "prophet")
- `data_quality: string` - Quality assessment ("normal", "low_confidence", "insufficient")
- `forecasts: ForecastMetric[]` - Array of metric forecasts

**New Fields**:
- `status: string` - Result status enum
  - `"ok"` - Forecast generated successfully
  - `"insufficient_data"` - Cannot forecast (too few weeks, all NaN)
  - `"invalid_data"` - Data present but unusable
  - `"degraded"` - Forecast generated with caveats
- `reason_code: string | null` - Machine-readable reason code
  - `null` when status is "ok" without caveats
  - Possible values: `"too_few_weeks"`, `"all_nan"`, `"negative_values_filtered"`, `"constant_series"`, `"outliers_clipped"`, `"stats_undefined"`, `"floor_applied"`

**Example** (constant series):
```json
{
  "schema_version": 1,
  "generated_at": "2026-01-27T12:00:00Z",
  "generated_by": "linear-v1.0",
  "is_stub": false,
  "forecaster": "linear",
  "data_quality": "normal",
  "status": "ok",
  "reason_code": "constant_series",
  "forecasts": [...]
}
```

**Example** (insufficient data):
```json
{
  "schema_version": 1,
  "generated_at": "2026-01-27T12:00:00Z",
  "generated_by": "linear-v1.0",
  "is_stub": false,
  "forecaster": "linear",
  "data_quality": "insufficient",
  "status": "insufficient_data",
  "reason_code": "too_few_weeks",
  "forecasts": []
}
```

---

## State Transitions

### Forecast Generation Flow

```
Input Data
    │
    ▼
┌───────────────────────┐
│ Check data availability│
│ (N >= MIN_WEEKS)       │
└───────────────────────┘
    │
    ├─── N < 4 ──────────► status: insufficient_data
    │                      reason_code: too_few_weeks
    │
    ▼
┌───────────────────────┐
│ Filter to finite values│
└───────────────────────┘
    │
    ├─── All NaN ────────► status: insufficient_data
    │                      reason_code: all_nan
    │
    ▼
┌───────────────────────┐
│ Check for constant    │
│ series (ptp == 0)     │
└───────────────────────┘
    │
    ├─── Constant ───────► status: ok
    │                      reason_code: constant_series
    │                      (return constant forecast)
    │
    ▼
┌───────────────────────┐
│ Safe outlier clipping │
│ (N >= 4 finite values)│
└───────────────────────┘
    │
    ├─── Stats undefined ─► status: degraded
    │                       reason_code: stats_undefined
    │                       (skip clipping, continue)
    │
    ▼
┌───────────────────────┐
│ Linear regression     │
└───────────────────────┘
    │
    ▼
┌───────────────────────┐
│ Generate predictions  │
│ with confidence bands │
└───────────────────────┘
    │
    ▼
┌───────────────────────┐
│ Floor negatives to 0  │
│ (track in constraints)│
└───────────────────────┘
    │
    ▼
┌───────────────────────┐
│ Format deterministic  │
│ JSON output           │
└───────────────────────┘
    │
    ▼
status: ok (or degraded if any issues)
```

---

## Validation Rules

### Input Validation

| Field | Rule | Error Response |
|-------|------|----------------|
| Week count | N >= 4 | status: insufficient_data, reason: too_few_weeks |
| Finite values | At least 1 finite | status: insufficient_data, reason: all_nan |
| Value range | All finite after filtering | Silently filter non-finite |

### Output Validation

| Field | Rule |
|-------|------|
| `predicted` | Must be finite, >= 0 |
| `lower_bound` | Must be finite, >= 0, <= predicted |
| `upper_bound` | Must be finite, >= predicted |
| `constraints_applied` | Must be array (may be empty) |
| `status` | Must be one of enum values |
| `reason_code` | Must be string or null |

---

## Backward Compatibility

All schema changes are **additive**:

1. New fields have sensible defaults for consumers that don't check them:
   - `status` defaults to `"ok"` behavior (no action needed)
   - `reason_code` defaults to `null` (no special handling)
   - `constraints_applied` defaults to `[]` (no constraints)

2. Existing consumers can ignore new fields without breaking

3. No existing fields are removed or renamed

4. Output remains valid JSON with same structure
