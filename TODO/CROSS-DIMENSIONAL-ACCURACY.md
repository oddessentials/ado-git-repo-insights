# Cross-Dimensional Filter Accuracy

> Last reviewed: 2026-02-06

## Problem Statement

When multiple filter dimensions are active simultaneously (e.g., repo + team,
or repo + author), the dashboard uses a **proportional intersection estimate**
because no cross-dimensional data exists. This assumes statistical independence
between dimensions, which fails when dimensions are correlated (e.g., teams
that specialize in specific repos).

## Current Filter Dimensions

| Dimension | Backend Slice | Status | Independence Risk |
|-----------|--------------|--------|-------------------|
| Repository | `by_repository` | :white_check_mark: Implemented | N/A (single-dim) |
| Team | `by_team` | :white_check_mark: Implemented | High -- teams often specialize in repos |
| Author | `by_author` | :x: Planned | Medium -- authors often work in specific repos |
| Reviewer | `by_reviewer` | :x: Planned | Medium -- reviewers may be repo-specific |
| Date Range | URL params | :white_check_mark: Implemented | N/A (applied at load time) |

## Current Approximation Method

**File:** `extension/ui/modules/metrics.ts:305-345`

When N dimensions are active, the combined ratio is:

```
combinedRatio = product(dimension_share_i) for i = 1..N
combinedPrCount = Math.round(total_pr_count * combinedRatio)
```

Cycle times are averaged across all active dimension estimates.

### Error Characteristics

| Correlation | Direction | Magnitude |
|-------------|-----------|-----------|
| Strong positive (team works only in one repo) | Underestimate | Up to -60% |
| None (uniform distribution) | Accurate | ~0% |
| Moderate | Varies | +/-10-30% |
| Strong negative (team avoids certain repos) | Overestimate | Up to +40% |
| Multi-team overlap | Clamped at 100% | teamShare capped to 1.0 before combining (v0.x.x) |

## Solution: Cross-Dimensional Breakdowns

### Architecture

Add nested breakdown fields to weekly rollups:

```json
{
  "by_team_and_repo": {
    "Team Alpha": {
      "Repo-Backend": { "pr_count": 15, "cycle_time_p50": 340.5 },
      "Repo-Frontend": { "pr_count": 3, "cycle_time_p50": 180.2 }
    }
  },
  "by_author_and_repo": {
    "user-id-123": {
      "Repo-Backend": { "pr_count": 8 }
    }
  }
}
```

### Required Cross-Dimensional Pairs

| Pair | Priority | Data Size (per week) | Justification |
|------|----------|---------------------|---------------|
| team x repo | High | N_teams x M_repos (sparse) | Most common combined filter |
| author x repo | Medium | N_authors x M_repos (sparse) | Author filter + repo filter |
| team x author | Low | Already implicit -- author in team | No new data needed |
| reviewer x repo | Low | N_reviewers x M_repos (sparse) | Rare use case |

### Implementation Plan

#### Phase 1: Backend (~3-4 days)

**File:** `src/ado_git_repo_insights/transform/aggregators.py`

1. Add `_generate_team_repo_slice()` method:
   - For each team, for each repo: filter PRs where author in team AND repo = repo
   - Compute metrics from intersected set
   - Store as nested dict: `{ team_name: { repo_name: BreakdownEntry } }`
   - Only emit non-empty intersections (sparse)

2. Add `_generate_author_repo_slice()` method:
   - Similar pattern: for each author, for each repo
   - Only emit non-empty intersections

3. Add to `generate_weekly_rollup()`:
   ```python
   rollup["by_team_and_repo"] = self._generate_team_repo_slice(...)
   rollup["by_author_and_repo"] = self._generate_author_repo_slice(...)
   ```

4. Tests:
   - test_team_repo_slice_is_sparse (empty intersections excluded)
   - test_team_repo_slice_sums_match_team_slice (within each team)
   - test_team_repo_slice_exact_vs_proportional (verify accuracy improvement)

#### Phase 2: Schema & Validation (~1 day)

**File:** `extension/ui/schemas/rollup.schema.ts`

1. Add type: `Record<string, Record<string, BreakdownEntry>>`
2. Add to `KNOWN_ROOT_FIELDS`: `"by_team_and_repo"`, `"by_author_and_repo"`
3. Add nested validation logic

**File:** `extension/ui/schemas/dimensions.schema.ts`

No changes needed -- dimensions are already flat lists.

#### Phase 3: Frontend Filter Logic (~2 days)

**File:** `extension/ui/modules/metrics.ts`

In `applyFiltersToRollups()`, when both filters are active:

```typescript
// Prefer exact cross-dimensional data if available
if (repoSlice && teamSlice && rollup.by_team_and_repo) {
  // Look up exact intersection
  const exactEntries = filters.teams.flatMap(team =>
    filters.repos.map(repo => rollup.by_team_and_repo?.[team]?.[repo])
  ).filter(Boolean);
  if (exactEntries.length > 0) {
    return buildFilteredRollup(rollup, aggregateEntries(exactEntries));
  }
}
// Fall back to proportional intersection
```

#### Phase 4: Synthetic Generator (~1 day)

**File:** `scripts/generate-synthetic-dataset.py`

Generate `by_team_and_repo` by intersecting team and repo weights.

#### Phase 5: Testing & Validation (~1 day)

- Verify cross-dimensional exact values vs proportional estimates
- Performance test with 50 teams x 100 repos
- Backward compatibility: old data without cross-dimensional fields still works

### Data Size Analysis

| Scenario | Teams | Repos | Max Entries/Week | Typical (sparse) |
|----------|-------|-------|-----------------|-------------------|
| Small org | 5 | 10 | 50 | ~20 |
| Medium org | 20 | 30 | 600 | ~150 |
| Large org | 50 | 100 | 5000 | ~500 |

At ~100 bytes per BreakdownEntry, 500 sparse entries = ~50KB per week.
Over 260 weeks = ~13MB total. Acceptable.

### Migration Strategy

1. New field is optional (`by_team_and_repo?:`)
2. Frontend falls back to proportional intersection when field is absent
3. No schema version bump needed (additive change)
4. Backend generates cross-dimensional data only when team data is available

---

## Key Files Reference

| Purpose | File |
|---------|------|
| Current proportional intersection | `extension/ui/modules/metrics.ts:305-345` |
| Team slice generation (pattern) | `src/ado_git_repo_insights/transform/aggregators.py:624-690` |
| Repo slice generation (pattern) | `src/ado_git_repo_insights/transform/aggregators.py:587-622` |
| Rollup schema | `extension/ui/schemas/rollup.schema.ts` |
| Filter logic | `extension/ui/modules/metrics.ts:255-349` |
| Synthetic generator | `scripts/generate-synthetic-dataset.py` |

## Related Documents

- `TODO/TEAM_REVIEWER_FILTERS.md` -- Team and reviewer filter status
- `TODO/AUTHOR_CONTRIBUTOR_FILTERS.md` -- Author/contributor filter status
