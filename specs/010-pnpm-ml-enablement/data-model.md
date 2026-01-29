# Data Model: Enable ML Features & Migrate to pnpm

**Branch**: `010-pnpm-ml-enablement` | **Date**: 2026-01-28

## Entities

### PredictionsArtifact

JSON file at `predictions/trends.json` containing ML forecast data.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | integer | Yes | Version number for schema compatibility (currently: 1) |
| `generated_at` | string (ISO 8601) | Yes | Timestamp of artifact generation |
| `generated_by` | string | No | Generator identifier ("linear", "prophet", "synthetic-preview") |
| `is_stub` | boolean | No | True if synthetic/preview data (blocks production render) |
| `forecaster` | "linear" \| "prophet" | No | Algorithm used for forecasting |
| `data_quality` | "normal" \| "low_confidence" \| "insufficient" | No | Data quality indicator |
| `forecasts` | Forecast[] | Yes | Array of forecast series |

### Forecast

Individual forecast series within PredictionsArtifact.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `metric` | string | Yes | Metric name (e.g., "pr_cycle_time", "throughput") |
| `unit` | string | Yes | Unit of measurement (e.g., "hours", "prs_per_week") |
| `horizon_weeks` | integer | Yes | Forecast horizon in weeks |
| `values` | ForecastValue[] | Yes | Time series of predicted values |

### ForecastValue

Single point in a forecast series.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `period_start` | string (ISO 8601) | Yes | Start of forecast period |
| `predicted` | number | Yes | Predicted value |
| `lower_bound` | number | No | Lower confidence bound |
| `upper_bound` | number | No | Upper confidence bound |

### InsightsArtifact

JSON file at `ai_insights/summary.json` containing AI-generated insights.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | integer | Yes | Version number for schema compatibility (currently: 1) |
| `generated_at` | string (ISO 8601) | Yes | Timestamp of artifact generation |
| `is_stub` | boolean | No | True if synthetic/preview data |
| `insights` | InsightItem[] | Yes | Array of insight items |

### InsightItem

Individual insight within InsightsArtifact.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string \| number | Yes | Unique identifier for stable ordering |
| `category` | string | Yes | Category for grouping (e.g., "velocity", "quality", "collaboration") |
| `severity` | "critical" \| "warning" \| "info" | Yes | Severity level for ordering |
| `title` | string | Yes | Short insight title |
| `description` | string | Yes | Detailed insight description |
| `data` | InsightData | No | Supporting metric data |
| `affected_entities` | AffectedEntity[] | No | Entities affected by this insight |
| `recommendation` | Recommendation | No | Suggested action |

### InsightData

Optional metric data attached to an insight.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `metric_name` | string | Yes | Name of the metric |
| `current_value` | number | Yes | Current metric value |
| `previous_value` | number | No | Previous period value for comparison |
| `change_percent` | number | No | Percentage change |
| `trend` | "up" \| "down" \| "stable" | No | Trend direction |

### AffectedEntity

Entity affected by an insight (for drill-down).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | "repository" \| "team" \| "user" | Yes | Entity type |
| `id` | string | Yes | Entity identifier |
| `name` | string | Yes | Display name |

### Recommendation

Suggested action for an insight.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | Recommended action text |
| `effort` | "low" \| "medium" \| "high" | No | Estimated effort |
| `priority` | "low" \| "medium" \| "high" | No | Suggested priority |

## State Machine Types

### ArtifactState (Discriminated Union)

```typescript
type ArtifactState =
  | { type: 'setup-required' }
  | { type: 'no-data'; quality?: 'insufficient' }
  | { type: 'invalid-artifact'; error: string; path?: string }
  | { type: 'unsupported-schema'; version: number; supported: [number, number] }
  | { type: 'ready'; data: PredictionsRenderData | InsightsRenderData };
```

### State Transitions

States are **terminal**—once resolved, no further transitions occur.

| Check Order | Condition | Resulting State |
|-------------|-----------|-----------------|
| 1 | File does not exist | `setup-required` |
| 2 | JSON parse fails | `invalid-artifact` |
| 3 | Required fields missing | `invalid-artifact` |
| 4 | schema_version not in supported range | `unsupported-schema` |
| 5 | data_quality = "insufficient" OR empty array | `no-data` |
| 6 | All checks pass | `ready` |

## Validation Rules

### Schema Version

- **Supported Range**: `[1, 1]` (initially version 1 only)
- **Validation**: `schema_version >= MIN_VERSION && schema_version <= MAX_VERSION`
- **Error Message**: "Unsupported Schema Version X (supported: Y-Z)"

### Required Fields

**Predictions**:
- `schema_version` must be present and integer
- `generated_at` must be present and valid ISO 8601
- `forecasts` must be present and array

**Insights**:
- `schema_version` must be present and integer
- `generated_at` must be present and valid ISO 8601
- `insights` must be present and array

### Ordering Rules

**Insights Cards** (FR-006):
1. `severity` DESC: critical → warning → info
2. `category` ASC: alphabetical
3. `id` ASC: numeric or alphabetical (fallback to `title` if no id)

**Predictions Series** (FR-007):
1. `period_start` ASC: chronological order

## Package Manager Config

### package.json

```json
{
  "packageManager": "pnpm@9.15.0"
}
```

### pnpm-lock.yaml

Generated lockfile replacing `package-lock.json`. Contains:
- Exact dependency versions
- Integrity hashes
- Peer dependency resolution

### .npmrc (optional)

```ini
# Prevent accidental npm usage
engine-strict=true
```
