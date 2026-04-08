# Data Model: Review Time Pipeline (052)

**Branch**: `052-review-time-pipeline` | **Date**: 2026-04-04

## Entity Changes

### 1. Reviewer Record (Extended)

**Table**: `reviewers`
**New Column**: `reviewed_at TEXT` (ISO 8601, nullable)

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| id | INTEGER PK | auto | Existing |
| pull_request_uid | TEXT NOT NULL | extraction | Existing |
| user_id | TEXT NOT NULL | extraction | Existing — matches thread comment `author.id` |
| vote | INTEGER NOT NULL | extraction | Existing — final vote value |
| repository_id | TEXT NOT NULL | extraction | Existing |
| **reviewed_at** | **TEXT** | **thread system comment** | **NEW — `publishedDate` of vote event, or NULL** |

**Validation Rules**:
- `reviewed_at` is ISO 8601 UTC (e.g., `2026-04-01T21:14:57.67Z`)
- NULL when: no positive vote in threads, threads not yet fetched, or deleted vote comment
- Only populated from system comments where regex `^(.+) voted (-?\d+)$` matches AND vote value is 10 or 5
- `author.id` on the system comment must match `user_id` in the reviewer record

### 2. Pull Request Record (Extended)

**Table**: `pull_requests`
**New Column**: `review_time_minutes REAL` (nullable)

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| ... | ... | ... | All existing fields unchanged |
| cycle_time_minutes | REAL | extraction | Existing — (closed_date - creation_date) |
| **review_time_minutes** | **REAL** | **computed** | **NEW — (earliest_reviewed_at - creation_date), or NULL** |

**Computation Rules**:
- `review_time_minutes = (earliest_positive_reviewed_at - creation_date)` in minutes
- Minimum floor: 1.0 minute (same as cycle_time)
- Precision: 2 decimal places (same as cycle_time)
- NULL when: no reviewer has a non-NULL `reviewed_at` for this PR
- `earliest_positive_reviewed_at` = MIN(`reviewed_at`) across all reviewers with vote IN (10, 5) for this PR

**Invariant**: `review_time_minutes <= cycle_time_minutes` for every PR (review happens before or at closure). Violations clamped by the 1.0-minute floor.

**DB-Internal Only**: NOT added to CSV output contract. `CSV_SCHEMAS` in models.py unchanged.

### 3. WeeklyRollup (Extended)

**Dataclass**: `src/ado_git_repo_insights/transform/aggregators.py`

| Field | Type | Notes |
|-------|------|-------|
| week | str | Existing — ISO week `YYYY-Www` |
| start_date | str | Existing |
| end_date | str | Existing |
| pr_count | int | Existing |
| cycle_time_p50 | float \| None | Existing |
| cycle_time_p90 | float \| None | Existing |
| **review_time_p50** | **float \| None** | **NEW — 50th percentile of review_time_minutes** |
| **review_time_p90** | **float \| None** | **NEW — 90th percentile of review_time_minutes** |
| authors_count | int | Existing |
| reviewers_count | int | Existing |

**Percentile Rules**:
- Computed via `pandas.Series.quantile(0.5 / 0.9)` on non-null `review_time_minutes` values
- NULL when: `notna().sum() < _ROLLUP_MIN_SAMPLE` (2 for base rollups)
- NULL when: `pd.isna()` on the quantile result (degenerate series)

### 4. SliceMetrics (Extended)

**TypedDict**: `src/ado_git_repo_insights/types.py`

| Field | Type | Notes |
|-------|------|-------|
| pr_count | int | Existing |
| cycle_time_p50 | float \| None | Existing |
| cycle_time_p90 | float \| None | Existing |
| **review_time_p50** | **float \| None** | **NEW** |
| **review_time_p90** | **float \| None** | **NEW** |
| authors_count | int | Existing |
| reviewers_count | int | Existing |

**Applied to all dimension slices**: by_repository, by_author, by_team, by_author_and_repo, by_team_and_repo

**Threshold by slice type**:
- Single-dimension (author, repo, team): `_ROLLUP_MIN_SAMPLE = 2`
- Cross-dimensional (author_repo, team_repo): `_CROSS_DIM_MIN_SAMPLE = 5`

### 5. Vote Event (New Concept, Not a Table)

Extracted from existing `pr_comments` table, not a new table.

| Attribute | Source | Notes |
|-----------|--------|-------|
| pull_request_uid | pr_comments.pull_request_uid | PR identifier |
| author_id | pr_comments.author_id | Reviewer who voted — matches `reviewers.user_id` |
| vote_value | Parsed from pr_comments.content | Integer from regex `^(.+) voted (-?\d+)$` |
| vote_timestamp | pr_comments.created_at | ISO 8601, the `publishedDate` from ADO API |
| is_deleted | pr_comments.is_deleted | Skip if true |
| comment_type | pr_comments.comment_type | Must be `"system"` |

**Positive votes**: vote_value IN (10, 5) — approved or approved-with-suggestions.

## Schema Migration

**Version**: 1 → 2

**Changes**:
1. `ALTER TABLE reviewers ADD COLUMN reviewed_at TEXT`
2. `ALTER TABLE pull_requests ADD COLUMN review_time_minutes REAL`
3. `INSERT INTO schema_version (version, applied_at) VALUES (2, datetime('now'))`

**SCHEMA_SQL update**: New columns included in CREATE TABLE statements for fresh installs. Initial version becomes 2.

**Idempotency**: Migration checks `get_schema_version()`. If already >= 2, skip all ALTER statements.

## Data Flow

```
ADO API (PR threads endpoint)
    ↓ get_pr_threads()
pr_threads + pr_comments tables (existing comment extraction)
    ↓ _populate_review_timestamps() [NEW]
reviewers.reviewed_at (per reviewer per PR)
    ↓ calculate_review_time_minutes() [NEW]
pull_requests.review_time_minutes (per PR)
    ↓ _generate_weekly_rollups() SQL query (adds review_time_minutes)
pandas DataFrame
    ↓ .quantile(0.5/0.9) with min sample threshold
WeeklyRollup.review_time_p50/p90 + SliceMetrics.review_time_p50/p90
    ↓ asdict() + json.dump()
weekly_rollups/{YYYY-Www}.json
    ↓ (existing UI auto-activation)
Dashboard review time cards visible
```

## Relationships

```
pull_requests 1──N reviewers     (pull_request_uid FK)
pr_threads    1──N pr_comments   (thread_id FK)
pr_comments   N──1 reviewers     (author_id = user_id, via vote event parsing)
```

The vote event parsing creates a logical relationship between `pr_comments` (where timestamps live) and `reviewers` (where `reviewed_at` is stored), linked by `(pull_request_uid, author_id/user_id)`.
