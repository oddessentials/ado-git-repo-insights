# Dataset Contract Specification

This document defines the normative contract for PR Insights dataset consumption. Any consumer (extension UI, CLI dashboard, PowerBI) MUST use this contract.

## Dataset Layout

```
<dataset-root>/
├── dataset-manifest.json     # Discovery entry point (REQUIRED)
├── ado-insights.sqlite       # Canonical store (OPTIONAL for UI)
└── aggregates/
    ├── dimensions.json       # Filter dimensions
    ├── weekly_rollups/
    │   └── YYYY-Www.json     # Weekly metrics per ISO week
    └── distributions/
        └── YYYY.json         # Yearly distributions
```

## Schema Versions

All consumers MUST validate schema versions before rendering:

| Field | Current | Compatibility |
|-------|---------|---------------|
| `manifest_schema_version` | 1 | Reject if > supported |
| `dataset_schema_version` | 1 | Reject if > supported |
| `aggregates_schema_version` | 1 | Reject if > supported |

## Manifest Schema (v1)

```json
{
  "manifest_schema_version": 1,
  "dataset_schema_version": 1,
  "aggregates_schema_version": 1,
  "generated_at": "ISO-8601 timestamp",
  "run_id": "string",
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
  "features": { "teams": bool, "comments": bool, "ml": bool, "ai_insights": bool },
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

## Consumer Requirements

1. **Entry point**: Always load `dataset-manifest.json` first
2. **Version check**: Fail gracefully if schema versions are unsupported
3. **Lazy loading**: Load only chunks needed for current date range
4. **Caching**: Cache loaded chunks to avoid refetch on range expansion
5. **Feature flags**: Hide/disable UI for unsupported features (teams, AI, etc.)
