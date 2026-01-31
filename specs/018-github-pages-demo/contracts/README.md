# Contracts: GitHub Pages Demo Dashboard

**Feature**: 018-github-pages-demo
**Date**: 2026-01-30

## Overview

This feature uses existing JSON schema contracts from the repository. No new schemas are required.

## Referenced Schemas

### 1. Dataset Manifest Schema

**Location**: `schemas/dataset-manifest.schema.json`
**Version**: Defined by `manifest_schema_version` field (currently 1)
**Purpose**: Discovery manifest for dashboard data loading

**Key Validations**:
- Required fields: manifest_schema_version, dataset_schema_version, aggregates_schema_version, generated_at, features, coverage, aggregate_index
- aggregate_index.weekly_rollups must be non-empty array
- aggregate_index.distributions must be non-empty array
- features object must include: teams, comments, predictions, ai_insights (booleans)

---

### 2. Predictions Schema

**Location**: `schemas/predictions.schema.json`
**Version**: Defined by `schema_version` field (currently 1)
**Purpose**: ML forecast data validation

**Key Validations**:
- Required fields: schema_version, generated_at, forecasts
- Each forecast must have: metric (enum), unit (enum), values (array)
- metric enum: pr_throughput, cycle_time_minutes, review_time_minutes
- Each value must have: period_start (date), predicted (number), lower_bound (number), upper_bound (number)

---

### 3. Insights Schema

**Location**: `schemas/insights.schema.json`
**Version**: Defined by `schema_version` field (currently 1)
**Purpose**: AI-generated insight validation

**Key Validations**:
- Required fields: schema_version, generated_at, insights
- Each insight must have: id, category, severity, title, description, affected_entities
- category enum: bottleneck, trend, anomaly
- severity enum: info, warning, critical

---

## Implicit Contracts (Not Schema-Defined)

### Weekly Rollup Structure

**Expected in**: `aggregates/weekly_rollups/YYYY-Www.json`

```json
{
  "week": "YYYY-Www",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "pr_count": integer,
  "cycle_time_p50": float,
  "cycle_time_p90": float,
  "authors_count": integer,
  "reviewers_count": integer,
  "by_repository": {
    "<repo_name>": {
      "pr_count": integer,
      "cycle_time_p50": float,
      "cycle_time_p90": float,
      "authors_count": integer,
      "reviewers_count": integer
    }
  },
  "by_team": null | object
}
```

### Distribution Structure

**Expected in**: `aggregates/distributions/YYYY.json`

```json
{
  "year": "YYYY",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "total_prs": integer,
  "cycle_time_buckets": {
    "0-1h": integer,
    "1-4h": integer,
    "4-24h": integer,
    "1-3d": integer,
    "3-7d": integer,
    "7d+": integer
  },
  "prs_by_month": {
    "YYYY-01": integer,
    "YYYY-02": integer,
    ...
    "YYYY-12": integer
  }
}
```

### Dimensions Structure

**Expected in**: `aggregates/dimensions.json`

```json
{
  "date_range": {
    "min": "YYYY-MM-DD",
    "max": "YYYY-MM-DD"
  },
  "projects": [
    {
      "organization_name": string,
      "project_name": string
    }
  ],
  "repositories": [
    {
      "organization_name": string,
      "project_name": string,
      "repository_id": uuid,
      "repository_name": string
    }
  ],
  "teams": [],
  "users": [
    {
      "user_id": uuid,
      "display_name": string
    }
  ]
}
```

---

## Validation Strategy

1. **Schema Validation**: Use `jsonschema` Python library to validate against existing schemas
2. **Structure Validation**: Custom assertions for implicit contracts (weekly rollups, distributions, dimensions)
3. **Coverage Validation**: Verify all 260 weeks present, all 5 distributions present
4. **Size Validation**: Verify total docs/ size < 50 MB

---

## Backward Compatibility (FR-019)

Per specification, `./docs/data/` is a versioned public artifact. Any changes must be:

1. **Backward-compatible**: New fields may be added; existing fields may not be removed or renamed
2. **Explicitly versioned**: Schema version fields must be incremented for structural changes
3. **Documented**: Changes must be noted in release notes

This ensures bookmarked demo URLs continue to work across deployments.
