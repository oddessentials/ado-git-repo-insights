# Data Model: ML Features Enhancement

**Date**: 2026-01-26
**Phase**: 1 (Design)

## Entity Overview

This feature extends the existing ML data contracts with enhanced insight schema (v2) while maintaining backward compatibility with v1.

```
┌─────────────────────────────────────────────────────────────────┐
│                     ML Data Entities                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ PredictionsData │    │  InsightsData   │                    │
│  │   (trends.json) │    │ (summary.json)  │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           ▼                      ▼                              │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │    Forecast     │    │   InsightItem   │                    │
│  │  (per metric)   │    │   (v2 schema)   │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           ▼                      ├──────────────┐              │
│  ┌─────────────────┐    ┌───────▼───────┐ ┌────▼─────┐       │
│  │  ForecastValue  │    │  InsightData  │ │Recommend │       │
│  │  (per period)   │    │ (metrics/viz) │ │  -ation  │       │
│  └─────────────────┘    └───────────────┘ └──────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Entity: PredictionsData

**File**: `predictions/trends.json`
**Purpose**: Container for all forecast metrics

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema_version | integer | Yes | Always `1` (locked) |
| generated_at | string (ISO8601) | Yes | Generation timestamp |
| generated_by | string | Yes | `"linear-v1.0"` or `"prophet-v1.0"` |
| is_stub | boolean | Yes | `true` if synthetic preview data |
| forecaster | string | Yes | `"linear"` or `"prophet"` (FR-004) |
| data_quality | string | No | `"normal"`, `"low_confidence"`, or `"insufficient"` |
| forecasts | Forecast[] | Yes | Array of metric forecasts |

**Example**:
```json
{
  "schema_version": 1,
  "generated_at": "2026-01-26T10:30:00Z",
  "generated_by": "linear-v1.0",
  "is_stub": false,
  "forecaster": "linear",
  "data_quality": "normal",
  "forecasts": [...]
}
```

---

## Entity: Forecast

**Purpose**: Time-series forecast for a single metric

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| metric | string | Yes | Metric name: `pr_throughput`, `cycle_time_minutes`, `review_time_minutes` |
| unit | string | Yes | Unit: `count` or `minutes` |
| horizon_weeks | integer | Yes | Forecast horizon (1-12) |
| values | ForecastValue[] | Yes | Predicted values per period |

**Example**:
```json
{
  "metric": "pr_throughput",
  "unit": "count",
  "horizon_weeks": 4,
  "values": [...]
}
```

---

## Entity: ForecastValue

**Purpose**: Single predicted value for one time period

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| period_start | string (YYYY-MM-DD) | Yes | Monday-aligned week start |
| predicted | number | Yes | Point estimate |
| lower_bound | number | Yes | Lower confidence bound (95%) |
| upper_bound | number | Yes | Upper confidence bound (95%) |

**Validation Rules**:
- `period_start` must be a Monday
- `lower_bound` ≤ `predicted` ≤ `upper_bound`
- All values must be non-negative

**Example**:
```json
{
  "period_start": "2026-02-03",
  "predicted": 28.5,
  "lower_bound": 22.1,
  "upper_bound": 34.9
}
```

---

## Entity: InsightsData

**File**: `insights/summary.json`
**Purpose**: Container for AI-generated insights

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema_version | integer | Yes | `1` (v1) or `2` (enhanced) |
| generated_at | string (ISO8601) | Yes | Generation timestamp |
| generated_by | string | Yes | `"openai-v1.0"` |
| is_stub | boolean | Yes | `true` if synthetic preview data |
| model | string | No | OpenAI model used (v2) |
| cached | boolean | No | `true` if served from cache (v2) |
| cache_age_hours | number | No | Hours since cache creation (v2) |
| insights | InsightItem[] | Yes | Exactly 3 insights, deterministically ordered |

**Example**:
```json
{
  "schema_version": 2,
  "generated_at": "2026-01-26T10:30:00Z",
  "generated_by": "openai-v1.0",
  "is_stub": false,
  "model": "gpt-4o-mini",
  "cached": true,
  "cache_age_hours": 6.5,
  "insights": [...]
}
```

---

## Entity: InsightItem (v2 Schema)

**Purpose**: Single AI-generated insight with enhanced data

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Stable identifier (e.g., `"trend-abc123"`) |
| category | enum | Yes | `"bottleneck"`, `"trend"`, `"anomaly"`, `"achievement"` |
| severity | enum | Yes | `"critical"`, `"warning"`, `"info"` |
| title | string | Yes | Headline (max 10 words) |
| description | string | Yes | Detailed explanation with specific numbers |
| affected_entities | AffectedEntity[] | Yes | Teams/repos affected |
| data | InsightData | No | Metrics and visualization data (v2) |
| recommendation | Recommendation | No | Actionable suggestion (v2) |

**Ordering Rule (FR-005)**:
Insights MUST be sorted by:
1. `severity` descending: critical (0) > warning (1) > info (2)
2. `category` alphabetically
3. `id` alphabetically

**Example**:
```json
{
  "id": "trend-review-latency-2026w04",
  "category": "trend",
  "severity": "warning",
  "title": "Review Latency Increasing",
  "description": "Average time-to-first-review has increased by 23% over the past 4 weeks, from 2.1 hours to 2.6 hours.",
  "affected_entities": [
    { "type": "team", "name": "Backend Team" }
  ],
  "data": {...},
  "recommendation": {...}
}
```

---

## Entity: InsightData (v2 New)

**Purpose**: Quantitative data for inline visualization

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| metric | string | Yes | Metric identifier |
| current_value | number | Yes | Current value |
| previous_value | number | No | Previous period value |
| change_percent | number | No | Percentage change |
| trend_direction | enum | Yes | `"up"`, `"down"`, `"stable"` |
| sparkline | number[] | No | 5 values for mini chart |

**Example**:
```json
{
  "metric": "review_time_minutes",
  "current_value": 156,
  "previous_value": 126,
  "change_percent": 23.8,
  "trend_direction": "up",
  "sparkline": [126, 132, 140, 148, 156]
}
```

---

## Entity: Recommendation (v2 New)

**Purpose**: Actionable suggestion with effort estimate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | Specific recommendation text |
| priority | enum | Yes | `"high"`, `"medium"`, `"low"` |
| effort | enum | Yes | `"high"`, `"medium"`, `"low"` |

**Example**:
```json
{
  "action": "Consider adding reviewers to the Backend team or reducing PR size to improve review turnaround time.",
  "priority": "medium",
  "effort": "low"
}
```

---

## Entity: AffectedEntity

**Purpose**: Team or repository affected by insight

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | Yes | `"team"`, `"repository"`, `"author"` |
| name | string | Yes | Display name |
| member_count | number | No | Team size (for teams) |

---

## Entity: InsightsCache

**File**: `insights/cache.json`
**Purpose**: Cached OpenAI response for 12-hour TTL (FR-006)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema_version | integer | Yes | Always `1` |
| cached_at | string (ISO8601) | Yes | Cache creation timestamp |
| expires_at | string (ISO8601) | Yes | Cache expiry (cached_at + 12h) |
| input_hash | string | Yes | SHA-256 of input metrics (for invalidation) |
| prompt_version | string | Yes | Prompt version for cache invalidation on upgrade |
| insights | InsightItem[] | Yes | Cached insight array |

---

## Entity: MLMetadata (Manifest Extension)

**Purpose**: Extension to main manifest indicating ML feature status

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| predictions | boolean | Yes | Whether predictions are enabled |
| ai_insights | boolean | Yes | Whether AI insights are enabled |
| forecaster | string | No | `"linear"` or `"prophet"` (if predictions enabled) |
| insights_model | string | No | OpenAI model used (if insights enabled) |
| insights_cached | boolean | No | Whether insights served from cache |
| cache_age_hours | number | No | Hours since cache creation |

---

## Schema Versioning

| Entity | Current Version | Backward Compatible |
|--------|-----------------|---------------------|
| PredictionsData | 1 | N/A (new field `forecaster` additive) |
| InsightsData | 1 → 2 | Yes (v1 fields preserved, v2 adds optional fields) |
| InsightItem | 1 → 2 | Yes (v1 fields required, v2 adds `data` and `recommendation`) |
| InsightsCache | 1 | N/A (new file) |

**Migration Strategy**:
- Frontend handles both v1 and v2 InsightItem gracefully
- Missing `data` or `recommendation` renders simpler card
- `schema_version: 2` indicates enhanced fields present
