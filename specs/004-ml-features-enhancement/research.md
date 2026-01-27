# Research: ML Features Enhancement

**Date**: 2026-01-26
**Phase**: 0 (Research & Discovery)

## Research Questions

### RQ-001: Fallback Forecasting Algorithm Selection

**Question**: What linear regression approach provides adequate accuracy without Prophet?

**Decision**: NumPy-based ordinary least squares (OLS) with time-series index

**Rationale**:
- NumPy is already a project dependency (via pandas)
- OLS is simple, fast, and deterministic
- Confidence bands via standard error of prediction
- No additional dependencies required

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| scipy.stats.linregress | Equivalent to numpy, but scipy adds dependency |
| statsmodels ARIMA | Too complex for fallback; requires additional dependency |
| sklearn LinearRegression | sklearn is heavy dependency for simple use case |

**Implementation Notes**:
```python
# Pseudo-code for fallback forecaster
import numpy as np

def linear_forecast(y_values, horizon):
    x = np.arange(len(y_values))
    coeffs = np.polyfit(x, y_values, 1)  # slope, intercept

    # Predict future values
    future_x = np.arange(len(y_values), len(y_values) + horizon)
    predicted = np.polyval(coeffs, future_x)

    # Confidence bands via residual standard error
    residuals = y_values - np.polyval(coeffs, x)
    se = np.std(residuals)

    return predicted, predicted - 1.96*se, predicted + 1.96*se
```

---

### RQ-002: Stable Trend Detection Criteria

**Question**: How do we detect "stable (non-seasonal) trends" for NFR-002 accuracy comparison?

**Decision**: Three-criteria test from spec clarifications
- Coefficient of variation (CV) < 0.3 on weekly aggregates
- No significant autocorrelation at lag 4 or 12 weeks (p > 0.05)
- Linear regression R² ≥ 0.7

**Rationale**:
- CV captures variance stability
- Autocorrelation lag 4/12 detects monthly/quarterly seasonality
- R² ensures linear model fits reasonably well

**Implementation Notes**:
- Use numpy for CV and R² calculation
- Use scipy.stats or manual ACF for autocorrelation (or simplify to visual inspection in tests)
- These criteria are for test design, not runtime behavior

---

### RQ-003: Chart.js Configuration for Forecast Visualization

**Question**: How to render forecast charts with confidence bands in Chart.js?

**Decision**: Line chart with fill between datasets

**Rationale**:
- Chart.js supports `fill: '+1'` / `fill: '-1'` for area between lines
- Historical data as solid line, forecast as dashed
- Confidence band as semi-transparent fill

**Implementation Notes**:
```typescript
// Chart configuration pattern
const config = {
  type: 'line',
  data: {
    datasets: [
      { label: 'Historical', data: historical, borderDash: [] },
      { label: 'Forecast', data: forecast, borderDash: [5, 5] },
      { label: 'Upper Bound', data: upper, fill: '+1', backgroundColor: 'rgba(...)' },
      { label: 'Lower Bound', data: lower, fill: false },
    ]
  }
};
```

---

### RQ-004: Production Lock Mechanism

**Question**: How to prevent synthetic data from surfacing in production extension?

**Decision**: Build-time flag + runtime environment check

**Rationale**:
- Build-time flag in `vss-extension.json` manifest: `"devMode": false`
- Runtime check: `window.location.hostname !== 'localhost'` AND no `__ADOEXT_CONTEXT__` override
- Defense in depth: both must pass for synthetic data

**Implementation Notes**:
```typescript
function isProductionEnvironment(): boolean {
  // Check 1: Not localhost
  if (window.location.hostname === 'localhost') return false;

  // Check 2: Extension manifest flag (injected at build time)
  if (typeof __PRODUCTION_BUILD__ !== 'undefined' && __PRODUCTION_BUILD__) {
    return true;
  }

  // Check 3: Azure DevOps SDK context present
  return typeof VSS !== 'undefined';
}

function canShowSyntheticData(): boolean {
  return !isProductionEnvironment() && isDevModeRequested();
}
```

---

### RQ-005: Insight Ordering Implementation

**Question**: How to enforce deterministic insight ordering (severity → category → ID)?

**Decision**: Post-process LLM output with stable sort

**Rationale**:
- LLM output order is non-deterministic
- Apply Python `sorted()` with composite key after parsing
- Severity maps to numeric: critical=0, warning=1, info=2

**Implementation Notes**:
```python
SEVERITY_ORDER = {'critical': 0, 'warning': 1, 'info': 2}

def sort_insights(insights: list[dict]) -> list[dict]:
    return sorted(
        insights,
        key=lambda x: (
            SEVERITY_ORDER.get(x['severity'], 99),
            x['category'],
            x.get('id', ''),
        )
    )
```

---

### RQ-006: Cache Persistence Format

**Question**: What format for `insights/cache.json`?

**Decision**: JSON with metadata envelope

**Rationale**:
- Same format as existing artifacts (consistency)
- Include timestamp for TTL validation
- Include hash of input data for cache invalidation

**Schema**:
```json
{
  "schema_version": 1,
  "cached_at": "2026-01-26T12:00:00Z",
  "expires_at": "2026-01-27T00:00:00Z",
  "input_hash": "sha256:abc123...",
  "prompt_version": "phase5-v2",
  "insights": [...]
}
```

---

### RQ-007: Minimum Data Requirements for Forecasting

**Question**: What's the minimum data needed for reliable forecasts?

**Decision**: 4 weeks minimum; degrade gracefully below

**Rationale**:
- Linear regression needs at least 4 points for meaningful trend
- Below 4 weeks: show "Insufficient Data" with setup guidance
- 4-8 weeks: show "Low Confidence" warning, widen confidence bands
- 8+ weeks: normal operation

**Implementation Notes**:
```python
MIN_WEEKS_REQUIRED = 4
LOW_CONFIDENCE_THRESHOLD = 8

def assess_data_quality(weeks: int) -> str:
    if weeks < MIN_WEEKS_REQUIRED:
        return "insufficient"
    elif weeks < LOW_CONFIDENCE_THRESHOLD:
        return "low_confidence"
    else:
        return "normal"
```

---

## Technology Best Practices

### Chart.js Performance

- Limit data points to 52 weeks max (1 year)
- Use `animation: false` for initial render measurement
- Debounce resize handlers
- Use `parsing: false` if data is pre-formatted

### TypeScript Module Organization

- Keep synthetic data generator separate from rendering
- Use dependency injection for data provider (testability)
- Export pure functions where possible

### Python Forecaster Design

- Use Protocol/ABC for forecaster interface
- Factory function for auto-detection: `get_forecaster()` returns ProphetForecaster or FallbackForecaster
- Identical output schema regardless of forecaster type

---

## Summary

All research questions resolved. No blockers identified. Ready for Phase 1 design.

| Question | Status | Key Decision |
|----------|--------|--------------|
| RQ-001 | ✅ Resolved | NumPy OLS for fallback |
| RQ-002 | ✅ Resolved | CV < 0.3, no autocorr, R² ≥ 0.7 |
| RQ-003 | ✅ Resolved | Chart.js line with fill |
| RQ-004 | ✅ Resolved | Build-time flag + runtime check |
| RQ-005 | ✅ Resolved | Post-process sort by severity/category/ID |
| RQ-006 | ✅ Resolved | JSON with metadata envelope |
| RQ-007 | ✅ Resolved | 4 weeks min, degrade gracefully |
