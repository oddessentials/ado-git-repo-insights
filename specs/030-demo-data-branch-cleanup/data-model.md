# Data Model: Demo Data Realism & Branch Cleanup

**Date**: 2026-02-21
**Feature**: 030-demo-data-branch-cleanup

## Entities

### Weekly Rollup (existing, unchanged structure)

The top-level aggregation unit for a single week of engineering activity.

| Field | Type | Constraints |
|-------|------|-------------|
| week | string | ISO week format "YYYY-WNN" |
| pr_count | integer | >= 0 |
| cycle_time_p50 | float or null | null when pr_count < 2 |
| cycle_time_p90 | float or null | null when pr_count < 2 |
| authors_count | integer | >= 0, <= pr_count |
| reviewers_count | integer | >= 0; >= 1 when pr_count >= 1 |
| by_repository | map<string, BreakdownEntry> | sparse (only non-empty repos) |
| by_team | map<string, BreakdownEntry> | sparse (only non-empty teams) |
| by_team_and_repo | map<string, map<string, BreakdownEntry>> | optional, sparse |

### Breakdown Entry (existing, unchanged structure)

A metrics slice for a specific dimension or dimension intersection.

| Field | Type | Constraints |
|-------|------|-------------|
| pr_count | integer | >= 0 |
| cycle_time_p50 | float or null | null when pr_count < sample threshold |
| cycle_time_p90 | float or null | null when pr_count < sample threshold |
| authors_count | integer | >= 0, <= pr_count, <= parent rollup authors_count |
| reviewers_count | integer | >= 0, <= parent rollup reviewers_count; >= 1 when pr_count >= 1 |

## Invariants (enforced by programmatic assertions)

### Parent-Child Bounding
- `entry.reviewers_count <= rollup.reviewers_count` for all entries in the same week
- `entry.authors_count <= rollup.authors_count` for all entries in the same week
- `entry.pr_count <= rollup.pr_count` for all entries in the same week

### Cross-Dimensional Consistency
- `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count` for each team
- `by_team_and_repo[team][repo].pr_count <= by_team[team].pr_count` for all intersections
- `by_team_and_repo[team][repo].pr_count <= by_repository[repo].pr_count` for all intersections

### Non-Negativity
- All count fields >= 0
- `authors_count <= pr_count` (can't have more authors than PRs)
- `reviewers_count >= 1` when `pr_count >= 1` (every PR has at least one reviewer)

## Realism Distribution (demo data only)

The demo data generator should produce breakdown counts that follow these distribution guidelines:

### Reviewer Count Distribution
- For entries with 1 PR: `reviewers_count` is 1 (single reviewer is valid)
- For entries with 2-3 PRs: `reviewers_count` is typically 2, occasionally 1 or 3
- For entries with 4+ PRs: `reviewers_count` scales proportionally, bounded by team size
- Overall: fewer than 20% of entries with 2+ PRs should show `reviewers_count == 1`

### Author Count Distribution
- For entries with 1 PR: `authors_count` is 1
- For entries with 2+ PRs: `authors_count` scales proportionally, never exceeds pr_count
- Typical ratio: 50-80% of pr_count (some authors contribute multiple PRs)
