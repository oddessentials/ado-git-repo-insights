# Weekly Rollup Schema v2 Contract

**Breaking change**: `aggregates_schema_version` bumped from 1 to 2.

## Schema (v2)

```json
{
  "week": "YYYY-Www",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "pr_count": number,
  "cycle_time_p50": number | null,
  "cycle_time_p90": number | null,
  "review_time_p50": number | null,
  "review_time_p90": number | null,
  "authors_count": number,
  "reviewers_count": number,

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

## New Fields (v2)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `by_team_and_repo` | object | Optional | Nested team→repo→metrics breakdown |

## Key Rules

1. `by_team_and_repo` is OPTIONAL — absence triggers proportional fallback
2. Only non-empty intersections are stored (sparse)
3. Keys are `team_name` (outer) and `repository_name` (inner)
4. Consistency (pr_count only): `sum(by_team_and_repo[T][*].pr_count) == by_team[T].pr_count`.
   This invariant does NOT hold for `authors_count` or `reviewers_count` because these are
   distinct-count metrics — a single author contributing to multiple repos is counted in each
   entry, so `sum(authors_count) >= by_team[T].authors_count` is expected
5. Maximum 5,000 entries per week; max 500KB per rollup file
6. When truncation occurs (>5,000 entries), the consistency invariant (rule 4) is relaxed
   for affected teams — the truncated sum will be less than the team total. The rollup
   SHOULD include a `_truncated: true` flag when truncation has been applied
7. When aggregating across multiple teams, PR counts may exceed
   `by_repository[R].pr_count` due to multi-team membership. This is intentional per-team
   attribution, not a double-counting error
8. Cycle time P50/P90 entries with fewer than 5 PRs in the intersection are set to `null`
   to avoid statistically misleading percentiles at small sample sizes

## Consumer Compatibility

| Consumer | v1 Rollup | v2 Rollup |
|----------|-----------|-----------|
| v1 Frontend (no cross-dim support) | Full support | Ignores new fields (permissive validator warns) |
| v2 Frontend (cross-dim support) | Proportional fallback | Exact cross-dim data |
| PowerBI (CSV only) | Unaffected | Unaffected (cross-dim is JSON-only) |

## Manifest Changes

```json
{
  "aggregates_schema_version": 2,
  "features": {
    "teams": true,
    "cross_dimensional": true,
    "comments": false,
    "predictions": false,
    "ai_insights": false
  }
}
```
