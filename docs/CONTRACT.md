# Stage Artifacts Contract

> **Contract Version**: 1
> **Manifest Schema Version**: 1

This document defines the authoritative contract for staged artifacts.
Any deviation is a hard failure.

---

## Build Eligibility

| Field | Requirement |
|-------|-------------|
| `status` | `completed` |
| `result` | `succeeded` OR `partiallySucceeded` |

**Selection algorithm**:
1. Fetch up to **10 builds** (bounded lookback)
2. Filter by eligible results
3. Sort by `finishTime` descending
4. Select **first** (most recent)

> ⚠️ Failed and canceled builds are **never** eligible.

---

## Required Artifacts

| Artifact | Required | Notes |
|----------|----------|-------|
| `aggregates` | **YES** | Contains manifest and aggregate data |
| `csv-output` | No | Optional CSV exports |
| `ado-insights-db` | No | Optional SQLite database |

Staging **fails immediately** if required artifacts are missing.

---

## Layout Contract

After staging, the **only** valid layout is:

```
run_artifacts/
├── dataset-manifest.json     ← MUST be at root
├── STAGED.json               ← Staging metadata
└── aggregates/               ← Data folder
    ├── dimensions.json
    ├── distributions/
    │   └── *.json
    └── weekly_rollups/
        └── *.json
```

### Forbidden Structures

These are **hard failures**:

```
❌ run_artifacts/aggregates/dataset-manifest.json
❌ run_artifacts/aggregates/aggregates/
❌ run_artifacts/aggregates/aggregates/dataset-manifest.json
```

### Layout Normalization

If a nested layout is detected during extraction:
1. Move `aggregates/dataset-manifest.json` → `dataset-manifest.json`
2. Move `aggregates/aggregates/*` → `aggregates/*`
3. Delete empty `aggregates/aggregates/` folder
4. This transformation is **irreversible**

---

## Manifest Requirements

```json
{
  "manifest_schema_version": 1,
  "aggregate_index": {
    "weekly_rollups": [...],
    "distributions": [...]
  }
}
```

| Field | Required | Valid Values |
|-------|----------|--------------|
| `manifest_schema_version` | YES | `1` |
| `aggregate_index` | YES | Non-empty object |
| All paths in `aggregate_index` | YES | Must exist on disk |

---

## STAGED.json Metadata

Written after successful staging:

```json
{
  "timestamp": "2026-01-23T22:00:00+00:00",
  "organization": "org",
  "project": "project",
  "pipeline_id": 14,
  "build_id": 113,
  "build_result": "partiallySucceeded",
  "artifact_name": "aggregates",
  "layout_normalized": true,
  "manifest_schema_version": 1,
  "contract_version": 1
}
```

---

## Structured Output

For automation, staging emits a single JSON summary:

```
STAGE_SUMMARY={"status":"success","build_id":113,...}
```

Parse with: `grep "^STAGE_SUMMARY=" | cut -d= -f2- | jq`

---

## Invariants

1. **Build selection is deterministic** - Same pipeline always selects same build
2. **Layout normalization is irreversible** - No fallback to nested layouts
3. **Contract validation is fail-fast** - Errors abort before dashboard launch
4. **partiallySucceeded is valid** - Artifacts are usable if present
5. **Bounded lookback** - Maximum 10 builds checked per invocation
6. **Schema versioning** - Unsupported versions are rejected
