# Phase 5 Contract Notes — Pre-Implementation Discovery

> **Purpose**: This document records the artifact paths, schema constraints, and consumer expectations that Phase 5 ML implementations MUST satisfy.

---

## Contract Table

| Artifact | Path | Schema Version | Consumed By | Required Fields |
|----------|------|---------------|-------------|-----------------|
| Predictions | `predictions/trends.json` | `schema_version: 1` | `dataset-loader.js:loadPredictions()` | `schema_version`, `generated_at`, `is_stub`, `generated_by`, `forecasts[]` |
| Insights | `insights/summary.json` | `schema_version: 1` | `dataset-loader.js:loadInsights()` | `schema_version`, `generated_at`, `is_stub`, `generated_by`, `insights[]` |

---

## Predictions Contract (`predictions/trends.json`)

### Producer Location
- **File**: `src/ado_git_repo_insights/transform/aggregators.py`
- **Class**: `PredictionGenerator` (lines 616-717)
- **Output path**: `output_dir / "predictions" / "trends.json"` (line 712)

### Schema Requirements

```json
{
  "schema_version": 1,           // REQUIRED - integer, ≤1 for current consumers
  "generated_at": "ISO-8601",    // REQUIRED
  "is_stub": true|false,         // REQUIRED - distinguishes stub vs real ML
  "generated_by": "string",      // REQUIRED - e.g., "phase3.5-stub-v1" or "prophet-v1.0"
  "forecasts": [                 // REQUIRED - array
    {
      "metric": "enum",          // REQUIRED - see allowed values below
      "unit": "string",          // REQUIRED - e.g., "count", "minutes"
      "horizon_weeks": number,   // REQUIRED
      "values": [                // REQUIRED - array
        {
          "period_start": "YYYY-MM-DD",  // REQUIRED - Monday-aligned
          "predicted": number,            // REQUIRED
          "lower_bound": number,          // REQUIRED
          "upper_bound": number           // REQUIRED
        }
      ]
    }
  ]
}
```

### Metric Enum (Enforced by dataset-contract.md)

| Metric | Unit | Notes |
|--------|------|-------|
| `pr_throughput` | `count` | Predicted PR count per week |
| `cycle_time_minutes` | `minutes` | Predicted cycle time |
| `review_time_minutes` | `minutes` | Predicted review latency |

### UI Validation (`dataset-loader.js` lines 676-693)

```javascript
validatePredictionsSchema(predictions) {
    if (!predictions) return { valid: false, error: 'Missing predictions data' };
    if (typeof predictions.schema_version !== 'number') {
        return { valid: false, error: 'Missing schema_version' };
    }
    if (predictions.schema_version > 1) {
        return { valid: false, error: `Unsupported schema version` };
    }
    if (!Array.isArray(predictions.forecasts)) {
        return { valid: false, error: 'Missing forecasts array' };
    }
    for (const forecast of predictions.forecasts) {
        if (!forecast.metric || !forecast.unit || !Array.isArray(forecast.values)) {
            return { valid: false, error: 'Invalid forecast structure' };
        }
    }
    return { valid: true };
}
```

---

## Insights Contract (`insights/summary.json`)

### Producer Location
- **File**: `src/ado_git_repo_insights/transform/aggregators.py`
- **Class**: `InsightsGenerator` (lines 720-828)
- **Output path**: `output_dir / "insights" / "summary.json"` (line 823)

### Schema Requirements

```json
{
  "schema_version": 1,           // REQUIRED - integer, ≤1 for current consumers
  "generated_at": "ISO-8601",    // REQUIRED
  "is_stub": true|false,         // REQUIRED
  "generated_by": "string",      // REQUIRED
  "insights": [                  // REQUIRED - array
    {
      "id": "unique-string",     // REQUIRED
      "category": "enum",        // REQUIRED - see allowed values
      "severity": "enum",        // REQUIRED - see allowed values
      "title": "string",         // REQUIRED
      "description": "string",   // REQUIRED
      "affected_entities": [],   // REQUIRED - array of strings
      "evidence_refs": []        // OPTIONAL - array of strings
    }
  ]
}
```

### Category Enum

| Value | Description |
|-------|-------------|
| `bottleneck` | Capacity/process issue identified |
| `trend` | Directional pattern observed |
| `anomaly` | Unusual behavior detected |

### Severity Enum

| Value | Description |
|-------|-------------|
| `info` | Informational, no action required |
| `warning` | Attention recommended |
| `critical` | Urgent attention required |

### UI Validation (`dataset-loader.js` lines 701-718)

```javascript
validateInsightsSchema(insights) {
    if (!insights) return { valid: false, error: 'Missing insights data' };
    if (typeof insights.schema_version !== 'number') {
        return { valid: false, error: 'Missing schema_version' };
    }
    if (insights.schema_version > 1) {
        return { valid: false, error: `Unsupported schema version` };
    }
    if (!Array.isArray(insights.insights)) {
        return { valid: false, error: 'Missing insights array' };
    }
    for (const insight of insights.insights) {
        if (!insight.id || !insight.category || !insight.severity || !insight.title) {
            return { valid: false, error: 'Invalid insight structure' };
        }
    }
    return { valid: true };
}
```

---

## Feature Flags in Manifest

The `dataset-manifest.json` controls whether UI tabs are enabled:

```json
{
  "features": {
    "predictions": true,   // Enables Predictions tab
    "ai_insights": true    // Enables AI Insights tab
  }
}
```

Producer sets these in `AggregateGenerator.generate_all()` (line 218-219):
```python
"features": {
    "predictions": predictions_generated,  # True if file exists
    "ai_insights": insights_generated,     # True if file exists
}
```

---

## Critical Implementation Notes

1. **Path consistency**: UI expects exactly `predictions/trends.json` and `insights/summary.json` — not `predictions.json` or `ai_insights.json`

2. **Schema version**: Must be integer, not string. UI rejects `schema_version > 1`.

3. **`is_stub` field**:
   - Stubs set `is_stub: true`
   - Real ML output MUST set `is_stub: false`
   - UI renders a warning banner when `is_stub: true`

4. **`generated_by` field**:
   - Current stub: `"phase3.5-stub-v1"` (constant `STUB_GENERATOR_ID`)
   - Prophet impl should use: `"prophet-v1.0"`
   - LLM impl should use: `"openai-v1.0"` or similar

5. **Empty arrays**: Valid schema with `forecasts: []` or `insights: []` triggers "Empty" UI state, not error

---

## Acceptance Criteria

- [ ] Predictions file written to exact path: `{output_dir}/predictions/trends.json`
- [ ] Insights file written to exact path: `{output_dir}/insights/summary.json`
- [ ] Both files pass UI schema validation
- [ ] `is_stub: false` for production ML output
- [ ] `generated_by` reflects actual generator (not stub ID)
- [ ] Metric names match the 3 allowed enums exactly
- [ ] Category/severity values match allowed enums exactly
