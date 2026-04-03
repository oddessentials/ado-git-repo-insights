# Data Model: QG-40 Eliminate typing.Any in src/

**Branch**: `048-https-github-com` | **Date**: 2026-04-02

All types defined in `src/ado_git_repo_insights/types.py` (new shared module, FR-013).

## Foundational Types

### JSONValue (FR-013 — canonical recursive alias)

```
JSONValue = str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]
```

**Consumers**: `_redact_dict` (logging_config.py), `_write_json` (aggregators.py), `emit` log entry (logging_config.py), `to_dict` (run_summary.py).

### SqliteParam

```
SqliteParam = str | int | float | bytes | None
```

**Consumers**: `execute` and `executemany` (database.py).

## ADO API Response Types (P2)

### AdoRepository

| Field | Type | Required |
|-------|------|----------|
| id | str | yes |
| name | str | yes |

### AdoCreatedBy

| Field | Type | Required |
|-------|------|----------|
| id | str | yes |
| displayName | str | yes |
| uniqueName | str | yes |

### AdoReviewer

| Field | Type | Required |
|-------|------|----------|
| id | str | yes |
| displayName | str | yes |
| uniqueName | str | yes |
| vote | int | yes |

### AdoPullRequest

| Field | Type | Required |
|-------|------|----------|
| pullRequestId | int | yes |
| title | str | yes |
| status | str | yes |
| description | str or None | no |
| creationDate | str (ISO 8601) | yes |
| closedDate | str (ISO 8601) or None | no |
| repository | AdoRepository | yes |
| createdBy | AdoCreatedBy | yes |
| reviewers | list[AdoReviewer] | yes |

### AdoTeam

| Field | Type | Required |
|-------|------|----------|
| id | str | yes |
| name | str | yes |
| description | str or None | no |

### AdoIdentity

| Field | Type | Required |
|-------|------|----------|
| id | str | yes |
| displayName | str | yes |

### AdoTeamMember

| Field | Type | Required |
|-------|------|----------|
| identity | AdoIdentity | yes |
| isTeamAdmin | bool | yes |

### AdoComment

| Field | Type | Required |
|-------|------|----------|
| id | int | yes |
| content | str or None | no |
| commentType | str | yes |
| publishedDate | str (ISO 8601) | yes |
| lastUpdatedDate | str or None | no |
| isDeleted | bool | yes |
| author | AdoCreatedBy | yes |

### AdoThread

| Field | Type | Required |
|-------|------|----------|
| id | int | yes |
| status | str | yes |
| lastUpdatedDate | str (ISO 8601) | yes |
| publishedDate | str (ISO 8601) | yes |
| threadContext | JSONValue or None | no |
| isDeleted | bool | yes |
| comments | list[AdoComment] | yes |

## Forecast Types (P3, FR-006)

### ForecastValue (shared base)

| Field | Type | Required |
|-------|------|----------|
| period_start | str (YYYY-MM-DD) | yes |
| predicted | float | yes |
| lower_bound | float | yes |
| upper_bound | float | yes |

### ForecastValueWithConstraints (extends ForecastValue)

| Field | Type | Required |
|-------|------|----------|
| constraints_applied | list[str] | yes |

Used by fallback_forecaster.py. Inherits all ForecastValue fields.

### MetricForecast (existing dataclass, field type change)

| Field | Type | Required |
|-------|------|----------|
| metric | str | yes |
| unit | str | yes |
| horizon_weeks | int | yes |
| values | list[ForecastValue] | yes (changed from list[dict[str, Any]]) |

### InsightObject

| Field | Type | Required |
|-------|------|----------|
| id | str | yes |
| category | str | yes |
| severity | str | yes |
| title | str | yes |
| description | str | yes |
| affected_entities | list[AffectedEntity] | yes |
| data | InsightData | no |
| recommendation | InsightRecommendation | no |

### AffectedEntity

| Field | Type | Required |
|-------|------|----------|
| type | str | yes |
| name | str | yes |

### InsightData

| Field | Type | Required |
|-------|------|----------|
| metric | str | yes |
| current_value | float | yes |
| previous_value | float | yes |
| change_percent | float | yes |
| trend_direction | str | yes |
| sparkline | list[float] | yes |

### InsightRecommendation

| Field | Type | Required |
|-------|------|----------|
| action | str | yes |
| priority | str | yes |
| effort | str | yes |

### PRStats

| Field | Type | Required |
|-------|------|----------|
| total_prs | int | yes |
| date_range_start | str | yes |
| date_range_end | str | yes |
| avg_cycle_time_minutes | float | yes |
| p90_cycle_time_minutes | float | yes |
| authors_count | int | yes |
| repositories_count | int | yes |

## Dimension Entity Types (P5a, FR-014)

### RepositoryRecord

| Field | Type | Required |
|-------|------|----------|
| organization_name | str | yes |
| project_name | str | yes |
| repository_id | str | yes |
| repository_name | str | yes |

### UserRecord

| Field | Type | Required |
|-------|------|----------|
| display_name | str | yes |
| user_id | str | yes |

### AuthorRecord

| Field | Type | Required |
|-------|------|----------|
| author_id | str | yes |
| author_name | str | yes |

### ReviewerRecord

| Field | Type | Required |
|-------|------|----------|
| reviewer_id | str | yes |
| reviewer_name | str | yes |

### ProjectRecord

| Field | Type | Required |
|-------|------|----------|
| organization_name | str | yes |
| project_name | str | yes |

### TeamRecord

| Field | Type | Required |
|-------|------|----------|
| member_count | int | yes |
| organization_name | str | yes |
| project_name | str | yes |
| team_id | str | yes |
| team_name | str | yes |

### DateRangeRecord

| Field | Type | Required |
|-------|------|----------|
| min | str (YYYY-MM-DD) | yes |
| max | str (YYYY-MM-DD) | yes |

## Rollup Metric Types (P5b)

### BaseMetrics (common across slices)

| Field | Type | Required |
|-------|------|----------|
| authors_count | int | yes |
| cycle_time_p50 | float or None | yes |
| cycle_time_p90 | float or None | yes |
| pr_count | int | yes |
| reviewers_count | int | yes |

Used by: RepositoryMetrics, AuthorMetrics, TeamMetrics, AuthorRepoMetrics, TeamRepoMetrics.

### ReviewerMetrics (different shape)

| Field | Type | Required |
|-------|------|----------|
| approval_rate | float | yes |
| authors_count | int | yes |
| repositories_count | int | yes |
| reviewed_prs | int | yes |
| reviews_count | int | yes |

### WeeklyRollupIndexEntry

| Field | Type | Required |
|-------|------|----------|
| end_date | str | yes |
| path | str | yes |
| size_bytes | int | yes |
| start_date | str | yes |
| week | str (YYYY-Www) | yes |

## Distribution Types (P5c)

### CycleTimeBuckets

| Field | Type | Required |
|-------|------|----------|
| 0-1h | int | yes |
| 1-4h | int | yes |
| 4-24h | int | yes |
| 1-3d | int | yes |
| 3-7d | int | yes |
| 7d+ | int | yes |

### YearlyDistribution

| Field | Type | Required |
|-------|------|----------|
| cycle_time_buckets | CycleTimeBuckets | yes |
| end_date | str | yes |
| prs_by_month | dict[str, int] | yes |
| start_date | str | yes |
| total_prs | int | yes |
| year | str | yes |

### DistributionIndexEntry

| Field | Type | Required |
|-------|------|----------|
| end_date | str | yes |
| path | str | yes |
| size_bytes | int | yes |
| start_date | str | yes |
| year | str | yes |

## Manifest Types (P5c)

### ManifestCapabilities

| Field | Type | Required |
|-------|------|----------|
| author_filters | bool | yes |
| author_repo_exact | bool | yes |
| comments_metrics | bool | yes |
| cross_dimensional_available | bool | yes |
| reviewer_repository_mode | str | yes |
| reviewer_team_mode | str | yes |

### CommentsStatus

| Field | Type | Required |
|-------|------|----------|
| capped | bool | yes |
| comments_fetched | int | yes |
| prs_with_threads | int | yes |
| status | str | yes |
| threads_fetched | int | yes |

### RowCounts

| Field | Type | Required |
|-------|------|----------|
| pull_requests | int | yes |
| repositories | int | yes |
| reviewers | int | yes |
| users | int | yes |

### RunSummaryDict

| Field | Type | Required |
|-------|------|----------|
| tool_version | str | yes |
| git_sha | str or None | yes |
| organization | str | yes |
| projects | list[str] | yes |
| date_range | dict[str, str] | yes |
| counts | dict[str, int or dict[str, int]] | yes |
| timings | dict[str, float] | yes |
| warnings | list[str] | yes |
| final_status | "success" or "failed" | yes |
| per_project_status | dict[str, str] | yes |
| first_fatal_error | str or None | yes |

## Type Dependency Graph

```
types.py (new, shared)
  ├── JSONValue            ← logging_config.py, aggregators.py (_write_json), run_summary.py
  ├── SqliteParam          ← database.py
  ├── Ado* TypedDicts      ← ado_client.py → repository.py
  ├── Forecast* TypedDicts ← forecaster.py, fallback_forecaster.py
  ├── Insight* TypedDicts  ← insights.py
  ├── *Record TypedDicts   ← aggregators.py (_build_dimensions)
  ├── *Metrics TypedDicts  ← aggregators.py (slice methods)
  ├── Distribution types   ← aggregators.py (_generate_distributions)
  ├── Manifest types       ← aggregators.py (generate)
  └── RunSummaryDict       ← run_summary.py
```
