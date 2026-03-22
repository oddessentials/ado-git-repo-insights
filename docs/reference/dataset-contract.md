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

## Demo Publication Boundary

The enterprise demo dataset has one canonical build output root:

`artifacts/demo-enterprise/data/`

`docs/data/` is a promoted mirror of that canonical output for GitHub Pages.
It is generated-only and MUST NOT be hand-edited.

Every published file in the enterprise demo dataset MUST be manifest-addressable
through one of these mechanisms:

1. `aggregate_index[*].path`
2. `published_files.direct`
3. `published_files.globs` for bounded additive collections

The enterprise demo currently uses `published_files.globs` for auxiliary
comments batches under `aggregates/comments/comments-batch-*.json`.

## Output Boundary

There are exactly two output classes:

1. `core-contract-csvs`
2. `auxiliary-additive-outputs`

### Core Contract CSVs

These files are the PowerBI contract and MUST remain unchanged in filename,
column set, and column order:

- `organizations.csv`
- `projects.csv`
- `repositories.csv`
- `pull_requests.csv`
- `users.csv`
- `reviewers.csv`

### Auxiliary Additive Outputs

These surfaces are explicitly outside the core CSV contract:

- additive manifest capability metadata
- additive weekly rollup fields such as `by_author` and `by_author_and_repo`
- comments aggregate JSON
- auxiliary comments CSVs

Auxiliary comments CSVs MUST live only under:

`csv-output/auxiliary/comments/`

Required filenames:

- `pr_threads.csv`
- `pr_comments.csv`

Comments coverage is additive manifest metadata and MUST NOT change any core
PowerBI CSV file shape, ordering, or root-level filenames.



## Schema Versions

All consumers MUST validate schema versions before rendering:

| Field | Current | Compatibility |
|-------|---------|---------------|
| `manifest_schema_version` | 1 | Reject if > supported |
| `dataset_schema_version` | 1 | Reject if > supported |
| `aggregates_schema_version` | 2 | Reject if > supported |
| `predictions_schema_version` | 1 | Reject if > supported (Phase 3.5) |
| `insights_schema_version` | 1 | Reject if > supported (Phase 3.5) |

## Capability Metadata Precedence

Loader normalization MUST use this precedence:

1. manifest capability flags
2. schema-version support
3. safe defaults

If a manifest capability field exists, it wins. Schema-version inference is
only used when the explicit capability field is absent.

## Manifest Schema (v1)

```json
{
  "manifest_schema_version": 1,
  "dataset_schema_version": 1,
  "aggregates_schema_version": 2,
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
  "demo_profile": {
    "name": "enterprise-demo",
    "version": "2.0.0",
    "seed": 42,
    "canonical_output_root": "artifacts/demo-enterprise"
  },
  "published_files": {
    "direct": [
      "dataset-manifest.json",
      "aggregates/dimensions.json",
      "predictions/trends.json",
      "insights/summary.json"
    ],
    "globs": ["aggregates/comments/comments-batch-*.json"]
  },
  "features": { "teams": bool, "cross_dimensional": bool, "comments": bool, "predictions": bool, "ai_insights": bool },
  "capabilities": {
    "author_filters": bool,
    "author_repo_exact": bool,
    "comments_metrics": bool,
    "reviewer_repository_mode": "constrained" | "exact" | "disallowed",
    "reviewer_team_mode": "constrained" | "exact" | "disallowed",
    "cross_dimensional_available": bool
  },
  "coverage": {
    "total_prs": number,
    "date_range": { "min": "YYYY-MM-DD", "max": "YYYY-MM-DD" },
    "comments": {
      "status": "disabled" | "full" | "partial",
      "threads_fetched": number,
      "comments_fetched": number,
      "prs_with_threads": number,
      "capped": bool
    }
  }
}
```

### Comments Coverage Rules

1. `status = "disabled"` when no comment threads were extracted
2. `status = "full"` when comment data exists and extraction was not capped
3. `status = "partial"` when comment data exists but extraction was capped
4. `capped = true` means the dataset intentionally contains bounded comments coverage
5. Frontend/operator surfaces may display comments coverage, but comments remain auxiliary and non-contract for PowerBI CSV consumers

### Enterprise Demo Metadata Rules

1. `demo_profile.name` identifies the canonical synthetic profile
2. `demo_profile.version` MUST be bumped when demo behavior changes per [DEMO-DATA-VERSIONING.md](E:/projects/ado-git-repo-insights/docs/DEMO-DATA-VERSIONING.md)
3. `demo_profile.canonical_output_root` identifies the canonical build root
4. `published_files.direct` MUST list every non-pattern-based published file outside indexed collections
5. `published_files.globs` MAY be used only for bounded additive collections with deterministic naming

## Weekly Rollup Schema (v2)

> **Schema version bump (v1 -> v2):** The `aggregates_schema_version` was bumped from 1 to 2 to signal to downstream consumers that the optional `by_team_and_repo` cross-dimensional breakdown field may be present. Consumers that cache schema assumptions should invalidate stale assumptions when encountering v2 datasets.

```json
{
  "week": "YYYY-Www",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "pr_count": number,
  "cycle_time_p50": number | null,
  "cycle_time_p90": number | null,
  "authors_count": number,
  "reviewers_count": number,
  "by_reviewer": {
    "<reviewer_id>": {
      "reviewed_prs": number,
      "reviews_count": number,
      "approval_rate": number | null,
      "authors_count": number,
      "repositories_count": number
    }
  },

  "by_repository": {
    "<repository_name>": {
      "pr_count": number,
      "cycle_time_p50": number | null,
      "cycle_time_p90": number | null,
      "authors_count": number,
      "reviewers_count": number
    }
  },

  "by_team": {
    "<team_name>": {
      "pr_count": number,
      "cycle_time_p50": number | null,
      "cycle_time_p90": number | null,
      "authors_count": number,
      "reviewers_count": number
    }
  },

  "by_team_and_repo": {
    "<team_name>": {
      "<repository_name>": {
        "pr_count": number,
        "cycle_time_p50": number | null,
        "cycle_time_p90": number | null,
        "authors_count": number,
        "reviewers_count": number
      }
    }
  }
}
```

### v2 Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `by_reviewer` | object | Optional | Reviewer activity breakdown keyed by stable `reviewer_id` |
| `by_team_and_repo` | object | Optional | Nested team -> repo -> metrics cross-dimensional breakdown |

### `by_team_and_repo` Rules

1. **Optional** -- absence triggers proportional fallback in the frontend
2. **Sparse** -- only non-empty intersections are stored (team-repo pairs with >= 1 PR)
3. **Keys** -- outer keys are `team_name`, inner keys are `repository_name`
4. **Consistency invariant (pr_count only):** `sum(by_team_and_repo[T][*].pr_count) == by_team[T].pr_count`. This does NOT hold for `authors_count` or `reviewers_count` (distinct-count metrics are not additive; `sum >= team total` is expected)
5. **Limits** -- maximum 5,000 entries per week; max 500KB per rollup JSON file
6. **Truncation** -- when entries exceed 5,000, least-significant entries (by pr_count) are removed and `_truncated: true` is set at the top level of `by_team_and_repo`. The consistency invariant is relaxed for affected teams
7. **Multi-team overlap** -- when aggregating across multiple teams, PR counts may exceed `by_repository[R].pr_count` due to multi-team membership. This is intentional per-team attribution
8. **Minimum sample size** -- cycle time P50/P90 are set to `null` for intersections with fewer than 5 PRs to avoid statistically misleading percentiles

### `features.cross_dimensional` Manifest Flag

The manifest `features` object includes a `cross_dimensional` boolean:

- `true` -- at least one weekly rollup in the dataset contains `by_team_and_repo` data
- `false` -- no cross-dimensional data is available (legacy dataset, or teams exist but have no members)

This flag is set from actual pipeline output (not from input conditions) to avoid false positives.

### Consumer Compatibility Matrix

| Consumer | v1 Rollup (no `by_team_and_repo`) | v2 Rollup (with `by_team_and_repo`) |
|----------|-----------------------------------|-------------------------------------|
| v1 Frontend (no cross-dim support) | Full support | Ignores new fields; permissive validator warns on unknown fields |
| v2 Frontend (cross-dim support) | Proportional fallback for team+repo filters | Exact cross-dimensional data used |
| PowerBI (CSV only) | Unaffected | Unaffected (cross-dim is JSON-only) |

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
