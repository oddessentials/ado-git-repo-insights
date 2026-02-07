# Author & Contributor Filter Implementation Status

> Last reviewed: 2026-02-06

## Summary

| Filter Type | Status | Effort to Complete |
|-------------|--------|-------------------|
| **Author (PR creator)** | :x: 0% Complete | ~5-7 days |

---

## Author Filters :x: NOT IMPLEMENTED

### Current State

| Layer | Status | Gap |
|-------|--------|-----|
| Database Schema | :white_check_mark: Exists | `pull_requests.user_id` links PR to author |
| User Table | :white_check_mark: Exists | `users` table: `user_id`, `display_name`, `email` |
| Dimensions | :white_check_mark: Partial | `dimensions.json` has `users[]` array (user_id, display_name) |
| Backend Slices | :x: Missing | No `by_author` in weekly rollups |
| Rollup Schema | :x: Missing | No `by_author` field in `WeeklyRollup` |
| UI Dropdown | :x: Missing | No HTML element for author filter |
| Filter State | :x: Missing | No `authors` in `DimensionFilters` interface |
| Filter Logic | :x: Missing | No case in `applyFiltersToRollups()` |
| Feature Gating | :x: Missing | No author feature flag |
| Tests | :x: Missing | No author filter tests |

### What Author Data Exists Today

- `pull_requests` table: each PR has `user_id` (the author)
- `users` table: `user_id` -> `display_name`, `email`
- `dimensions.json`: `users[]` array with user_id and display_name
- Aggregate metric: `authors_count` per week (count only, not breakdown)
- Team filter already does author-level attribution internally (`aggregators.py:667`)

### Relationship to Team Filter

The production team filter (`_generate_team_slice`) already works at the individual
author level internally -- it filters PRs by `user_id in team_member_ids`. An author
filter would expose this same individual-level attribution directly, allowing users
to view metrics for specific contributors without the team grouping.

**Author filter does NOT improve team filter accuracy.** Both use the same underlying
PR -> user_id attribution. Author filtering is a new dimension, not a correction.

---

## Implementation Plan for Author Filters

### Phase 1: Backend Infrastructure (~2-3 days)

#### 1.1 Generate by_author Slices
**File:** `src/ado_git_repo_insights/transform/aggregators.py`

Add new method similar to `_generate_team_slice()`:
- Group PRs by `user_id` (author)
- For each author: pr_count, cycle_time_p50/p90, reviewers_count
- Join with `users` table for display_name as key
- Note: authors_count is always 1 per slice (it's one author)

#### 1.2 Update Weekly Rollup Generation
**File:** `src/ado_git_repo_insights/transform/aggregators.py`

In `generate_weekly_rollup()`, add:
```python
rollup["by_author"] = self._generate_author_slice(week_group, week_reviewers)
```

#### 1.3 Add Tests
**File:** `tests/unit/test_aggregators.py`

- test_generates_by_author_slices
- test_author_slice_includes_cycle_times
- test_no_prs_returns_empty_by_author

### Phase 2: Frontend Implementation (~2-3 days)

#### 2.1 Update Rollup Schema
**File:** `extension/ui/schemas/rollup.schema.ts`

Add `by_author?: Record<string, BreakdownEntry>` to `WeeklyRollup`.
Add `"by_author"` to `KNOWN_ROOT_FIELDS`.

#### 2.2 Update Filter State
**File:** `extension/ui/modules/metrics.ts`

Add `authors: string[]` to `DimensionFilters` interface.
Add author filter case to `applyFiltersToRollups()`.

#### 2.3 Add UI Component
**File:** `extension/ui/index.html`

Add author filter dropdown after team filter.

#### 2.4 Wire Up Dashboard
**File:** `extension/ui/dashboard.ts`

- Populate author dropdown from `dimensions.users`
- Add change handler
- Conditionally show/hide based on data availability

### Phase 3: Testing (~1 day)

- Jest tests for author filter logic
- Integration tests for author filter end-to-end

---

## Design Considerations

### What Metrics Make Sense for Author Filtering?

| Metric | Feasibility | Notes |
|--------|-------------|-------|
| PRs Authored | :white_check_mark: Easy | Count of PRs created by this author |
| Cycle Time P50/P90 | :white_check_mark: Easy | Percentile of author's PR cycle times |
| Reviewers Count | :white_check_mark: Easy | Unique reviewers on author's PRs |
| Authors Count | N/A | Always 1 per author slice |

### Scalability Concern

With 200+ authors, the filter dropdown needs:
- Search/autocomplete instead of multi-select
- "Top 20 most active" default view
- Grouping by team

### Combined Filter Interactions

When author filter is combined with repo or team filters, the same proportional
intersection limitation applies. See `TODO/CROSS-DIMENSIONAL-ACCURACY.md` for
the full cross-dimensional accuracy plan.

---

## Key Files Reference

### Backend
| Purpose | File |
|---------|------|
| Database Schema | `src/ado_git_repo_insights/persistence/models.py` |
| Aggregators | `src/ado_git_repo_insights/transform/aggregators.py` |
| Existing Team Slice (pattern to follow) | `aggregators.py:624-690` |
| Aggregator Tests | `tests/unit/test_aggregators.py` |

### Frontend
| Purpose | File |
|---------|------|
| Dashboard HTML | `extension/ui/index.html` |
| Dashboard Logic | `extension/ui/dashboard.ts` |
| Filter Logic | `extension/ui/modules/metrics.ts` |
| Rollup Schema | `extension/ui/schemas/rollup.schema.ts` |
| Dimensions Schema | `extension/ui/schemas/dimensions.schema.ts` |
