# Contract: Demo Rollup Output

**Date**: 2026-02-21 | **Governing Contracts**: 1, 3, 4

## Weekly Rollup JSON Contract

Each file at `docs/data/aggregates/weekly_rollups/{YYYY}-W{nn}.json` must conform to this structure.

### Root Level

```json
{
  "week": "2025-W26",
  "start_date": "2025-06-23",
  "end_date": "2025-06-29",
  "pr_count": 58,
  "cycle_time_p50": 423.456,
  "cycle_time_p90": 1847.123,
  "authors_count": 17,
  "reviewers_count": 26,
  "by_repository": { ... },
  "by_team": { ... },
  "by_team_and_repo": { ... }
}
```

### Field Requirements

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `week` | string | yes | ISO 8601 week: `YYYY-Wnn` |
| `start_date` | string | yes | ISO date (Monday) |
| `end_date` | string | yes | ISO date (Sunday) |
| `pr_count` | int >= 0 | yes | — |
| `cycle_time_p50` | float \| null | yes | null if pr_count < 5 |
| `cycle_time_p90` | float \| null | yes | null if pr_count < 5 |
| `authors_count` | int >= 0 | yes | — |
| `reviewers_count` | int >= 0 | yes | — |
| `by_repository` | object | yes | map of repo_name → BreakdownEntry |
| `by_team` | object | yes | map of team_name → BreakdownEntry |
| `by_team_and_repo` | object | yes | map of team_name → { repo_name → BreakdownEntry } |

### BreakdownEntry

```json
{
  "pr_count": 12,
  "cycle_time_p50": 345.678,
  "cycle_time_p90": 1234.567,
  "authors_count": 5,
  "reviewers_count": 8
}
```

| Field | Type | Constraint |
|-------|------|------------|
| `pr_count` | int >= 0 | — |
| `cycle_time_p50` | float \| null | **null if pr_count < 5** (Contract 3, no exceptions) |
| `cycle_time_p90` | float \| null | **null if pr_count < 5** (Contract 3, no exceptions) |
| `authors_count` | int >= 1 | at team-repo level: <= team-level count |
| `reviewers_count` | int >= 1 | at team-repo level: <= team-level count |

### Cross-Dimensional Invariants (Contract 4)

```json
{
  "by_team_and_repo": {
    "Platform Team": {
      "user-service": { "pr_count": 8, ... },
      "auth-service": { "pr_count": 3, ... }
    },
    "Frontend Team": {
      "react-shell": { "pr_count": 5, ... }
    }
  }
}
```

1. For each team T in `by_team` with `pr_count >= 1`:
   - `by_team_and_repo[T]` **must exist**
   - Every repo where T has >= 1 PR **must** have an entry
   - `sum(by_team_and_repo[T][*].pr_count) == by_team[T].pr_count`

2. Repos with 0 PRs for a team are **omitted** (sparse representation)

## Dataset Manifest Contract

File: `docs/data/dataset-manifest.json`

### Key Fields After Full Pipeline

| Field | Value | Source |
|-------|-------|--------|
| `aggregates_schema_version` | 2 | From `aggregators.py::AGGREGATES_SCHEMA_VERSION` |
| `features.teams` | true | — |
| `features.cross_dimensional` | true | — |
| `features.predictions` | true | Set by predictions generator |
| `features.ai_insights` | true | Set by insights generator |

## Canonical Schema Reference

The single source of truth for field names and types is:
- **File**: `extension/ui/schemas/rollup.schema.ts`
- **Root fields**: `KNOWN_ROOT_FIELDS` (line 70)
- **Breakdown fields**: `KNOWN_BREAKDOWN_FIELDS` (line 86)

Per Contract 1, no second copy of the field list may exist. The schema completeness guard reads from this file at test time.
