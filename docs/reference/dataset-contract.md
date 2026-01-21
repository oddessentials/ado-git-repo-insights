# Dataset Contract Specification

This document defines the normative contract for PR Insights dataset consumption. Any consumer (extension UI, CLI dashboard, PowerBI) MUST use this contract.

## Breaking Change (v2.0.0)

> [!CAUTION]
> **Breaking Change (January 2026):** The nested `aggregates/aggregates` artifact layout is deprecated and will cause a hard error. If you encounter this error, re-run your pipeline with the updated YAML configuration and re-stage artifacts with `ado-insights stage-artifacts`.

## Dataset Layout

The dataset MUST follow this structure, with `dataset-manifest.json` at the artifact root:

```
<artifact-root>/
├── dataset-manifest.json     # Discovery entry point (REQUIRED, at root)
├── aggregates/
│   ├── dimensions.json       # Filter dimensions
│   ├── weekly_rollups/
│   │   └── YYYY-Www.json     # Weekly metrics per ISO week
│   └── distributions/
│       └── YYYY.json         # Yearly distributions
├── predictions/              # Phase 3.5 (OPTIONAL)
│   └── trends.json           # Trend forecasts
└── insights/                 # Phase 3.5 (OPTIONAL)
    └── summary.json          # AI-generated insights
```

**Discovery Rules:**
- Consumers probe `dataset-manifest.json` in this order: `.` (root), then `aggregates/`
- The deprecated `aggregates/aggregates` path is **no longer supported**
- All `aggregate_index[*].path` values resolve relative to the manifest location



## Schema Versions

All consumers MUST validate schema versions before rendering:

| Field | Current | Compatibility |
|-------|---------|---------------|
| `manifest_schema_version` | 1 | Reject if > supported |
| `dataset_schema_version` | 1 | Reject if > supported |
| `aggregates_schema_version` | 1 | Reject if > supported |
| `predictions_schema_version` | 1 | Reject if > supported (Phase 3.5) |
| `insights_schema_version` | 1 | Reject if > supported (Phase 3.5) |

## Manifest Schema (v1)

```json
{
  "manifest_schema_version": 1,
  "dataset_schema_version": 1,
  "aggregates_schema_version": 1,
  "generated_at": "ISO-8601 timestamp",
  "run_id": "string",
  "warnings": [],
  "aggregate_index": {
    "weekly_rollups": [
      { "week": "YYYY-Www", "path": "relative/path", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "size_bytes": number }
    ],
    "distributions": [
      { "year": "YYYY", "path": "relative/path", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "size_bytes": number }
    ]
  },
  "defaults": { "default_date_range_days": 90 },
  "limits": { "max_date_range_days_soft": 730 },
  "features": { "teams": bool, "comments": bool, "predictions": bool, "ai_insights": bool },
  "coverage": { "total_prs": number, "date_range": { "min": "YYYY-MM-DD", "max": "YYYY-MM-DD" } }
}
```

## Weekly Rollup Schema (v1)

```json
{
  "week": "YYYY-Www",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "pr_count": number,
  "cycle_time_p50": number | null,
  "cycle_time_p90": number | null,
  "authors_count": number,
  "reviewers_count": number
}
```

## Distribution Schema (v1)

```json
{
  "year": "YYYY",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "total_prs": number,
  "cycle_time_buckets": { "0-1h": n, "1-4h": n, "4-24h": n, "1-3d": n, "3-7d": n, "7d+": n },
  "prs_by_month": { "YYYY-MM": n }
}
```

---

## Phase 3.5: Predictions Schema (v1)

**File location:** `predictions/trends.json` (REQUIRED when `features.predictions=true`)

```json
{
  "schema_version": 1,
  "generated_at": "ISO-8601 timestamp",
  "is_stub": false,
  "generated_by": "string (e.g., 'phase3.5-stub-v1' or 'prophet-v1.0')",
  "forecasts": [
    {
      "metric": "pr_throughput | cycle_time_minutes | review_time_minutes",
      "unit": "count | minutes | minutes",
      "horizon_weeks": number,
      "values": [
        {
          "period_start": "YYYY-MM-DD (Monday-aligned)",
          "predicted": number,
          "lower_bound": number,
          "upper_bound": number
        }
      ]
    }
  ]
}
```

**Required fields:**
- `schema_version` — Version for consumer validation
- `generated_at` — ISO-8601 timestamp of generation
- `is_stub` — `true` if synthetic data, `false` if real ML output
- `generated_by` — Generator identifier for traceability
- `forecasts[]` — Array of metric forecasts

**Metric enum (enforced):**
- `pr_throughput` — Predicted PR count per period
- `cycle_time_minutes` — Predicted cycle time per period
- `review_time_minutes` — Predicted review latency per period

**Extensibility:** Unknown fields MUST be allowed for forward compatibility.

---

## Phase 3.5: AI Insights Schema (v1)

**File location:** `insights/summary.json` (REQUIRED when `features.ai_insights=true`)

```json
{
  "schema_version": 1,
  "generated_at": "ISO-8601 timestamp",
  "is_stub": false,
  "generated_by": "string",
  "insights": [
    {
      "id": "unique-insight-id",
      "category": "bottleneck | trend | anomaly",
      "severity": "info | warning | critical",
      "title": "string",
      "description": "string (descriptive only, no recommendations)",
      "affected_entities": ["repo:name", "team:name", "user:id"],
      "evidence_refs": ["optional array of reference strings"]
    }
  ]
}
```

**Required fields:**
- `schema_version` — Version for consumer validation
- `generated_at` — ISO-8601 timestamp
- `is_stub` — Stub indicator
- `generated_by` — Generator identifier
- `insights[]` — Array of insight objects

**Each insight requires:**
- `id` — Unique identifier
- `category` — One of: `bottleneck`, `trend`, `anomaly`
- `severity` — One of: `info`, `warning`, `critical`
- `title` — Short summary
- `description` — Detailed description (descriptive only, no recommendations)
- `affected_entities[]` — Array of entity references

**Optional fields:**
- `evidence_refs[]` — References for future traceability

---

## UI State Rules (Phase 3.5)

Consumers MUST handle these states gracefully:

| State | Condition | UI Behavior |
|-------|-----------|-------------|
| **Missing** | File does not exist | Show "Not generated yet. Enable predictions in pipeline configuration." |
| **Invalid** | Schema validation fails | Show "Unable to display predictions. [Error code: PRED_001]" + log details |
| **Empty** | File exists but `forecasts[]` or `insights[]` is empty | Show "No data yet for the selected time range." |
| **Valid** | Schema validates + data present | Render content |

---

## Consumer Requirements

1. **Entry point**: Always load `dataset-manifest.json` first
2. **Version check**: Fail gracefully if schema versions are unsupported
3. **Lazy loading**: Load only chunks needed for current date range
4. **Caching**: Cache loaded chunks to avoid refetch on range expansion
5. **Feature flags**: Hide/disable UI for unsupported features (teams, predictions, AI)
6. **Null-safe rendering**: Never throw on missing/partial data (Phase 3.5)
7. **ADO artifact loading**: Support loading directly from ADO Build Artifacts API (Phase 3.5)
