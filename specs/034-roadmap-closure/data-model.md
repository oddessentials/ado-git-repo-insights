# Data Model: Roadmap Closure Program

**Feature**: 034-roadmap-closure
**Date**: 2026-03-21

## Entity Definitions

### 1. AuthorBreakdownEntry (new)

Per-author weekly metrics entry stored within a weekly rollup.

**Structure**:
```text
by_author: Record<author_id, BreakdownEntry>
```

**Canonical key**:
- `author_id` is immutable Azure DevOps `user_id`

**Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pr_count | integer | Yes | PR count authored by this user in the week |
| cycle_time_p50 | float \| null | No | P50 cycle time for the author’s PRs |
| cycle_time_p90 | float \| null | No | P90 cycle time for the author’s PRs |
| authors_count | integer | Yes | Always 1 for a retained author slice |
| reviewers_count | integer | Yes | Distinct reviewers on the author’s PRs |

**Constraints**:
- keyed by canonical `user_id`, not display name
- display labels are resolved from dimensions/loader metadata
- no author slice may exist without a matching dimensions/capability path

### 2. AuthorRepositoryBreakdown (new)

Exact nested author x repository intersection metrics.

**Structure**:
```text
by_author_and_repo: Record<author_id, Record<repository_name, BreakdownEntry>>
```

**Constraints**:
- sparse nested structure; only non-empty intersections are stored
- consistency invariant for PR count:
  `sum(by_author_and_repo[author][*].pr_count) == by_author[author].pr_count`
  unless deterministic truncation explicitly occurred
- truncation must be signaled explicitly in capability or metadata surfaces
- exactness is guaranteed for retained intersections only

### 3. CommentCoverageState (extended)

Coverage object for comments-derived feature availability.

**Structure**:
```text
coverage.comments: {
  status: "disabled" | "full" | "partial",
  threads_fetched: number,
  comments_fetched: number,
  prs_with_threads: number,
  capped: boolean
}
```

**Constraints**:
- must be persisted as first-class metadata, not inferred from counts alone
- `partial` or `capped=true` must flow through manifest and UI messaging

### 4. CommentMetricsAggregate (new)

Metrics-first comments analytics emitted in additive aggregate outputs.

**Representative fields**:
| Field | Type | Description |
|-------|------|-------------|
| total_threads | integer | Threads observed in scope |
| total_comments | integer | Comments observed in scope |
| comments_per_pr | float \| null | Average comments per PR in scope |
| resolved_threads_rate | float \| null | Ratio of resolved threads |
| weekly_comment_volume | list | Weekly trend points |
| by_repository | map | Repo-level comment activity metrics |

**Constraints**:
- additive output only; not part of core CSV contract
- derived from SQLite `pr_threads` and `pr_comments`
- must respect deterministic ordering and coverage state

### 5. DatasetCapabilities (extended)

Manifest/loader capability metadata describing additive feature availability.

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| features.comments | boolean | Comment feature available |
| features.reviewers | boolean / derived presence | Reviewer support available |
| features.cross_dimensional | boolean | Exact cross-dimensional support available |
| capabilities.author_filters | boolean | Author slices available |
| capabilities.author_repo_exact | boolean | Exact author x repository available |
| capabilities.comments_metrics | boolean | Comments aggregate metrics available |
| capabilities.reviewer_mode | string | Reviewer-combination mode or support matrix reference |

Note: The exact field placement may be `features`, `capabilities`, or version-gated manifest metadata, but the loader contract must expose equivalent normalized information.

### 6. RoadmapClosureEvidenceEntry (new)

Repeatable roadmap-completion artifact entry.

**Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| roadmap_item | string | Yes | Item identifier or feature name |
| status | string | Yes | complete / deferred / blocked |
| implementation_files | list[string] | Yes | Code file references |
| test_files | list[string] | Yes | Test file references |
| docs_files | list[string] | Yes | Documentation file references |
| commands | list[string] | Yes | Exact verification commands run |
| outcomes | list[string] | Yes | Pass/fail result per command |
| constitution_gates | list[string] | Yes | Relevant QG / VR references |
| residual_risks | list[string] | No | Known follow-up or deferrals |

## Entity Relationships

```text
DatasetManifest
├── features / capabilities
├── coverage.comments
└── aggregate_index

WeeklyRollup
├── by_repository                 (existing)
├── by_team                       (existing)
├── by_reviewer                   (existing)
├── by_author                     (new)
└── by_author_and_repo            (new)

CommentMetricsAggregate
├── derived from pr_threads
├── derived from pr_comments
└── rendered by dashboard comment panels

RoadmapClosureEvidenceEntry
└── maps roadmap item -> code/tests/docs/verification evidence
```

## Validation Rules

1. Canonical author keys must be stable `user_id` values.
2. Display-name drift must not change author aggregate identity.
3. Legacy datasets missing additive author/comments capability must normalize safely.
4. Core CSV contracts remain unchanged by these entities.
5. Auxiliary comments CSVs, if emitted, must be independently schema-validated.
6. Truncated author x repository data must expose explicit truncation/capability metadata.
7. Comments coverage may never silently claim `full` when extraction caps were hit.
8. Evidence entries are required for roadmap closure review.

## State Transitions

These entities are computed outputs rather than mutable long-lived domain objects.

### Author / Comment / Cross-Dim Outputs

```text
SQLite state updated
  -> aggregate generator recomputes additive outputs
  -> manifest capabilities and coverage updated
  -> loader normalizes capability-aware dataset state
  -> dashboard consumes normalized outputs
```

### Closure Evidence

```text
Implementation complete
  -> verification commands executed
  -> evidence entry populated
  -> roadmap item marked complete or deferred
```
