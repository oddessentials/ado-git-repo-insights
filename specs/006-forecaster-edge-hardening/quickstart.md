# Quickstart: ML Forecaster Edge Case Hardening

**Feature**: 006-forecaster-edge-hardening
**Date**: 2026-01-27

## Overview

This feature hardens the ML forecaster against edge cases including:
- Zero-variance (constant) data series
- NaN-heavy datasets
- Extremely large values
- Negative prediction handling

## Key Changes

### 1. Constant Series Handling

When all input values are identical, the forecaster now returns a constant forecast instead of failing:

```python
# Before: Division by zero in regression
# After: Clean constant forecast

{
  "predicted": 100.0,
  "lower_bound": 100.0,
  "upper_bound": 100.0,
  "constraints_applied": []
}
```

### 2. Structured Status Codes

New `status` and `reason_code` fields in output:

```python
# Successful forecast
{"status": "ok", "reason_code": null}

# Insufficient data
{"status": "insufficient_data", "reason_code": "too_few_weeks"}

# Degraded (warnings but still usable)
{"status": "degraded", "reason_code": "outliers_clipped"}
```

### 3. Constraint Tracking

Each forecast value now tracks applied constraints:

```python
{
  "predicted": 0.0,
  "constraints_applied": ["floor_zero"]  # Negative was floored to 0
}
```

### 4. Deterministic Output

JSON output is now byte-stable for golden-file testing:
- Keys sorted alphabetically
- Floats rounded to 2 decimal places
- Metrics ordered by name

## Testing Edge Cases

### Constant Series Test

```python
import pandas as pd
from ado_git_repo_insights.ml.fallback_forecaster import FallbackForecaster

# Create constant data
df = pd.DataFrame({
    "closed_date": ["2026-01-06", "2026-01-13", "2026-01-20", "2026-01-27",
                    "2026-02-03", "2026-02-10", "2026-02-17", "2026-02-24"],
    "cycle_time_minutes": [100.0] * 8  # All identical
})

# Forecaster handles this gracefully
forecaster = FallbackForecaster(db, output_dir)
result = forecaster.generate()

# Verify output
assert result["status"] == "ok"
assert result["reason_code"] == "constant_series"
```

### Large Value Test

```python
# Test with extreme values (up to 10^9)
df = pd.DataFrame({
    "closed_date": [...],
    "cycle_time_minutes": [1e9, 1e9, 1e9, 1e9, 1e8, 1e8, 1e8, 1e8]
})

# Should not overflow
result = forecaster.generate()
assert result["status"] in ["ok", "degraded"]
assert all(np.isfinite(v["predicted"]) for f in result["forecasts"] for v in f["values"])
```

### Golden File Test

```python
import json

# Load expected output
with open("tests/fixtures/golden/constant-series-forecast.json") as f:
    expected = f.read()

# Generate actual output
actual = forecaster.generate()
actual_json = json.dumps(actual, indent=2, sort_keys=True)

# Byte-identical comparison
assert actual_json == expected
```

## Dashboard Integration

The dashboard handles new status codes automatically:

```typescript
// Status-aware rendering
if (predictions.status === "insufficient_data") {
  renderInsufficientDataMessage(predictions.reason_code);
} else if (predictions.status === "degraded") {
  renderDegradedWarning(predictions.reason_code);
  renderForecasts(predictions.forecasts);
} else {
  renderForecasts(predictions.forecasts);
}
```

## Migration Notes

### Backward Compatibility

All changes are **additive**. Existing consumers can ignore new fields:

| Field | Default Behavior |
|-------|------------------|
| `status` | Treat as "ok" if missing |
| `reason_code` | Treat as null if missing |
| `constraints_applied` | Treat as empty array if missing |

### Schema Validation

Use the JSON schema at `contracts/forecast-schema.json` to validate output:

```python
import jsonschema

with open("contracts/forecast-schema.json") as f:
    schema = json.load(f)

jsonschema.validate(predictions, schema)
```

## Related Files

- `src/ado_git_repo_insights/ml/fallback_forecaster.py` - Core implementation
- `tests/unit/test_fallback_forecaster.py` - Edge case tests
- `tests/fixtures/golden/constant-series-forecast.json` - Golden file
- `extension/ui/modules/charts/predictions.ts` - Dashboard rendering
