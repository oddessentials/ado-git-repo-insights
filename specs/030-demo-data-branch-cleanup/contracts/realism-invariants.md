# Contract: Demo Data Realism Invariants

**Date**: 2026-02-21
**Feature**: 030-demo-data-branch-cleanup

## Purpose

Defines the programmatic assertions that the generated demo dataset must satisfy.
These invariants are enforced by tests that run the generator and validate the output JSON files.

## Invariant Assertions (per weekly rollup file)

### INV-001: Parent-child bounding
For every `by_repository[repo]` entry in a rollup:
- `entry.reviewers_count <= rollup.reviewers_count`
- `entry.authors_count <= rollup.authors_count`
- `entry.pr_count <= rollup.pr_count`

Same for every `by_team[team]` entry.

### INV-002: Cross-dim consistency
For every team in `by_team_and_repo`:
- `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count`

### INV-003: Cross-dim bounding
For every `by_team_and_repo[team][repo]` entry:
- `entry.pr_count <= by_team[team].pr_count`
- `entry.pr_count <= by_repository[repo].pr_count`
- `entry.reviewers_count <= rollup.reviewers_count`
- `entry.authors_count <= rollup.authors_count`

### INV-004: Non-negativity
All `pr_count`, `authors_count`, `reviewers_count` fields >= 0 across all levels.

### INV-005: Logical bounds
- `authors_count <= pr_count` for every entry at every level
- `reviewers_count >= 1` for every entry where `pr_count >= 1`

### INV-006: Realism distribution (demo data only)
Across all generated weekly rollup files:
- Fewer than 20% of `by_repository` entries with `pr_count >= 2` have `reviewers_count == 1`
- Fewer than 20% of `by_team` entries with `pr_count >= 2` have `reviewers_count == 1`

### INV-007: Determinism
Two runs of the generator with the same seed produce byte-identical output files.
