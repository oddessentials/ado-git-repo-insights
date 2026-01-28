# Research: ML Forecaster Edge Case Hardening

**Feature**: 006-forecaster-edge-hardening
**Date**: 2026-01-27

## Research Questions

### RQ-1: How to detect and handle constant (zero-variance) data series?

**Decision**: Use `np.ptp(values) == 0` (peak-to-peak range) to detect constant series before regression.

**Rationale**:
- `np.ptp()` is numerically stable and handles edge cases (single value, all identical)
- Faster than computing full variance: O(n) vs O(n) but simpler
- Returns 0.0 exactly for constant series, no floating-point tolerance needed
- Standard numpy approach used in similar forecasting libraries

**Alternatives Considered**:
- `np.var(values) == 0`: Slightly more expensive, same result
- `np.std(values) == 0`: Equivalent but less intuitive name for "range"
- `len(set(values)) == 1`: Works but converts to Python objects, slower for large arrays

**Implementation**:
```python
if np.ptp(y_values) == 0:
    constant = float(y_values[0])
    # Return constant forecast with zero confidence band
    return {
        "predicted": constant,
        "lower_bound": constant,
        "upper_bound": constant,
        "constraints_applied": []
    }
```

---

### RQ-2: How to implement safe outlier clipping that handles edge cases?

**Decision**: Filter to finite values first, require N≥4 for stats, fall back to no-clipping with status flag.

**Rationale**:
- Computing mean/stddev on NaN-containing arrays produces NaN
- Computing on arrays with inf produces inf
- Zero-variance arrays produce stddev=0, making clipping bounds collapse
- Minimum N=4 matches existing `MIN_WEEKS_REQUIRED` constant

**Alternatives Considered**:
- IQR-based clipping: More robust to outliers but adds complexity
- Percentile caps (5th-95th): Simple but loses information about distribution shape
- Winsorization: Replaces extremes rather than clipping; less transparent

**Implementation**:
```python
def safe_clip_outliers(
    values: np.ndarray,
    std_threshold: float = 3.0,
    min_n: int = 4
) -> tuple[np.ndarray, str | None]:
    """Clip outliers with safety checks for edge cases.

    Returns:
        Tuple of (clipped_values, reason_code or None)
    """
    # Filter to finite values only
    finite_mask = np.isfinite(values)
    finite_values = values[finite_mask]

    if len(finite_values) < min_n:
        return values, "stats_undefined"

    # Check for zero variance
    if np.ptp(finite_values) == 0:
        return values, None  # No clipping needed for constant

    mean = np.nanmean(finite_values)
    std = np.nanstd(finite_values)

    if not np.isfinite(mean) or not np.isfinite(std) or std == 0:
        return values, "stats_undefined"

    lower = mean - std_threshold * std
    upper = mean + std_threshold * std
    return np.clip(values, lower, upper), "outliers_clipped" if np.any(values != np.clip(values, lower, upper)) else None
```

---

### RQ-3: What status enum values and reason codes should be used?

**Decision**: Four-status enum with extensible reason codes.

**Rationale**:
- `ok`: Normal forecast generated
- `insufficient_data`: Cannot forecast (too few weeks, all NaN)
- `invalid_data`: Data present but unusable (all negative, schema violation)
- `degraded`: Forecast generated but with caveats (outliers clipped, stats undefined)

**Reason Codes** (extensible list):
- `too_few_weeks`: Less than MIN_WEEKS_REQUIRED
- `all_nan`: All values are NaN/null
- `negative_values_filtered`: Negative values were removed
- `constant_series`: All values identical (informational, status=ok)
- `outliers_clipped`: Values were clipped to bounds
- `stats_undefined`: Could not compute statistics for clipping
- `floor_applied`: Negative predictions were floored to zero

**Alternatives Considered**:
- Binary ok/error: Too coarse, loses diagnostic info
- Granular enum per scenario: Too many values, hard to extend
- Freeform error messages: Not machine-parseable

---

### RQ-4: How to track floor-to-zero constraint application?

**Decision**: Add `constraints_applied: string[]` to each forecast value object.

**Rationale**:
- Per-value tracking shows exactly which predictions were affected
- Array allows multiple constraints (e.g., `["floor_zero", "outlier_clipped"]`)
- Empty array `[]` means no constraints applied (clean prediction)
- Extensible for future constraints

**Alternatives Considered**:
- Boolean `was_floored`: Only tracks one constraint
- Count at forecast level: Loses per-value granularity
- No tracking: Hides model instability

---

### RQ-5: How to ensure deterministic JSON output for golden-file tests?

**Decision**: Use `json.dump(..., sort_keys=True)` + explicit 2-decimal rounding.

**Rationale**:
- `sort_keys=True` ensures consistent field ordering
- Explicit rounding prevents floating-point noise (e.g., 1.0000000001)
- Metrics sorted alphabetically by name (natural sort order)
- Same approach used by existing `_write_predictions()` method

**Implementation**:
```python
def format_forecast_value(value: float) -> float:
    """Round to 2 decimal places for deterministic output."""
    return round(value, 2)

def write_predictions(predictions: dict, path: Path) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(predictions, f, indent=2, sort_keys=True)
```

**Alternatives Considered**:
- Higher precision (6dp): More accurate but causes diff noise
- No rounding: Floating-point representation varies
- Custom JSON encoder: Overkill for this use case

---

### RQ-6: What data point limit should be used for chart rendering?

**Decision**: Limit to 200 data points using "take last N" strategy.

**Rationale**:
- 200 points covers ~4 years of weekly data (more than typical use)
- "Take last N" preserves most recent/relevant data
- Simple to implement: `values.slice(-MAX_POINTS)`
- Deterministic: same input always produces same output

**Alternatives Considered**:
- Uniform sampling: Loses temporal precision at boundaries
- LTTB (Largest-Triangle-Three-Buckets): Better visual fidelity but complex
- Dynamic limits: Harder to test and reason about

---

## Summary of Decisions

| Question | Decision |
|----------|----------|
| Constant series detection | `np.ptp(values) == 0` |
| Safe outlier clipping | Filter finite first, N≥4, fallback to no-clip |
| Status enum | `ok \| insufficient_data \| invalid_data \| degraded` |
| Constraint tracking | `constraints_applied: string[]` per value |
| Deterministic output | `sort_keys=True` + 2dp rounding |
| Chart data limit | 200 points, take last N |
