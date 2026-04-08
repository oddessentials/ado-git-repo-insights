# Contract: Weekly Rollup JSON (Extended)

**Feature**: 052-review-time-pipeline | **Date**: 2026-04-04

## Overview

This contract documents the additions to the weekly rollup JSON output (`aggregates/weekly_rollups/{YYYY-Www}.json`). The existing fields are unchanged; only new fields are documented here.

## Root-Level Additions

```json
{
  "review_time_p50": <number | null>,
  "review_time_p90": <number | null>,
  "...existing fields unchanged..."
}
```

| Field | Type | Unit | Null Semantics |
|-------|------|------|----------------|
| `review_time_p50` | `number \| null` | minutes | NULL when fewer than 2 PRs have non-null review_time_minutes in this week |
| `review_time_p90` | `number \| null` | minutes | NULL when fewer than 2 PRs have non-null review_time_minutes in this week |

## Breakdown Entry Additions

All dimension breakdown entries (`by_repository`, `by_author`, `by_team`, `by_author_and_repo`, `by_team_and_repo`) gain:

```json
{
  "review_time_p50": <number | null>,
  "review_time_p90": <number | null>,
  "...existing fields unchanged..."
}
```

**Threshold varies by slice type**:
- Single-dimension (by_repository, by_author, by_team): NULL when < 2 PRs with data
- Cross-dimensional (by_author_and_repo, by_team_and_repo): NULL when < 5 PRs with data

## TypeScript Schema Compatibility

The TypeScript `WeeklyRollup` and `BreakdownEntry` interfaces already define `review_time_p50?: number | null` and `review_time_p90?: number | null` as optional fields. No TypeScript changes required.

The `KNOWN_ROOT_FIELDS` and `KNOWN_BREAKDOWN_FIELDS` validator allowlists already include these fields.

## CSV Contract

**UNCHANGED.** `review_time_minutes` is DB-internal only and does not appear in CSV output.

## Backward Compatibility

- Old consumers that don't read `review_time_p50`/`review_time_p90` are unaffected (fields are additive)
- The TypeScript frontend has had forward-compatible optional fields since PR #220
- Schema parity test `TS_ONLY_FORWARD_COMPAT_FIELDS` will be cleared (fields now produced by backend)
