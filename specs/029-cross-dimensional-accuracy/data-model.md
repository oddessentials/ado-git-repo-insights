# Data Model: Cross-Dimensional Filter Accuracy

**Feature**: 029-cross-dimensional-accuracy
**Date**: 2026-02-11

## Entity Definitions

### 1. CrossDimensionalBreakdown (new)

A nested dictionary mapping one dimension key to another dimension key to a
BreakdownEntry. Stored as an optional field within each WeeklyRollup.

**Structure**:
```
by_team_and_repo: Record<team_name, Record<repository_name, BreakdownEntry>>
by_author_and_repo: Record<author_id, Record<repository_name, BreakdownEntry>>
```

**Fields** (per intersection entry):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pr_count | integer | Yes | PR count for this exact intersection |
| cycle_time_p50 | float \| null | No | 50th percentile cycle time (minutes) |
| cycle_time_p90 | float \| null | No | 90th percentile cycle time (minutes) |
| authors_count | integer | No | Distinct authors in this intersection |
| reviewers_count | integer | No | Distinct reviewers in this intersection |

**Constraints**:
- Sparse: only non-empty intersections are stored (pr_count > 0)
- Keys use display names (matching existing `by_team`/`by_repository` convention)
- Consistency invariant (pr_count only): `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count`
  for each team. This invariant does NOT hold for `authors_count` or `reviewers_count`
  (distinct-count metrics are not additive across repos within a team)
- Minimum sample size: cycle_time_p50 and cycle_time_p90 are set to `null` when
  the intersection contains fewer than 5 PRs
- Maximum entries per week: 5,000 (configurable)
- Maximum JSON size per rollup: 500KB
- When truncation occurs (>5,000 entries), least-significant entries (by pr_count)
  are removed; the consistency invariant is relaxed for affected teams

### 2. WeeklyRollup (extended)

Existing entity with two new optional fields.

**New fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| by_team_and_repo | CrossDimensionalBreakdown | No | Team-by-repo exact metrics |
| by_author_and_repo | CrossDimensionalBreakdown | No | Author-by-repo exact metrics |

**Backward compatibility**: Both fields are optional. Rollups without these fields
continue to work with proportional intersection estimates.

### 3. DatasetManifest (extended)

**New feature flag**:
| Field | Type | Description |
|-------|------|-------------|
| features.cross_dimensional | boolean | True when cross-dim data is available |

**Schema version change**:
| Field | Old Value | New Value |
|-------|-----------|-----------|
| aggregates_schema_version | 1 | 2 |

### 4. Dimensions (unchanged)

Existing entity. Already exposes:
- `teams[].team_id` and `teams[].team_name`
- `repositories[].repository_id` and `repositories[].repository_name`

No changes needed. The dimensions data already provides the stable IDs needed for
future ID-based key migration.

## Entity Relationships

```
WeeklyRollup
├── by_repository: Record<repo_name, BreakdownEntry>          (existing)
├── by_team: Record<team_name, BreakdownEntry>                (existing)
├── by_team_and_repo: Record<team_name, Record<repo_name, BreakdownEntry>>  (NEW)
└── by_author_and_repo: Record<author_id, Record<repo_name, BreakdownEntry>> (NEW, future)
```

## Data Flow

```
SQLite (pull_requests + team_members + reviewers)
  │
  ▼
AggregateGenerator._generate_weekly_rollups()
  │
  ├── _generate_repo_slice()           → by_repository (existing)
  ├── _generate_team_slice()           → by_team (existing)
  ├── _generate_team_repo_slice()      → by_team_and_repo (NEW)
  └── _generate_author_repo_slice()    → by_author_and_repo (NEW, future)
  │
  ▼
Weekly JSON files: aggregates/weekly_rollups/YYYY-Www.json
  │
  ▼
Frontend: applyFiltersToRollups()
  │
  ├── Single filter → use by_repository or by_team (existing)
  ├── Both filters + by_team_and_repo present → exact lookup (NEW)
  └── Both filters + no cross-dim data → proportional estimate (existing fallback)
```

## Validation Rules

1. **Sparse storage**: Empty intersections (0 PRs) MUST NOT be stored
2. **Consistency (pr_count only)**: For each team T in by_team_and_repo:
   `sum(by_team_and_repo[T][*].pr_count) == by_team[T].pr_count`.
   This does NOT apply to `authors_count` or `reviewers_count` (distinct counts
   are not additive). Relaxed when truncation occurs (rule 5)
3. **No teamless authors**: PRs by authors without team membership appear in
   by_repository but NOT in by_team_and_repo
4. **Schema validation**: `by_team_and_repo` and `by_author_and_repo` must be
   added to KNOWN_ROOT_FIELDS (rollup.schema.ts) and validateBreakdown logic
   extended for nested structure. `normalizeRollup()` MUST pass through
   `by_team_and_repo` (not strip it as an unknown field)
5. **Size limit**: Per-week rollup JSON must not exceed 500KB; excess entries
   are truncated by ascending PR count. When truncation occurs, the consistency
   invariant (rule 2) is relaxed for affected teams
6. **Minimum sample size**: Cycle time percentiles (P50, P90) are set to `null`
   for intersections with fewer than 5 PRs

## State Transitions

Not applicable — cross-dimensional breakdowns are stateless computed outputs.
They are regenerated each pipeline run from the SQLite source of truth.
