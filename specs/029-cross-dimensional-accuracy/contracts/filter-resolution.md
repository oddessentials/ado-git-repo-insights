# Filter Resolution Contract

**Feature**: 029-cross-dimensional-accuracy

## Resolution Algorithm

When `applyFiltersToRollups()` is called with active dimension filters, the following
deterministic resolution order applies per rollup:

### Case 1: Single Filter Active

```
repos active, teams inactive → use by_repository (existing, exact)
teams active, repos inactive → use by_team (existing, exact)
```

No change from current behavior.

### Case 2: Two Filters Active (repo + team)

```
IF rollup.by_team_and_repo exists:
  FOR each selected team:
    FOR each selected repo:
      LOOKUP by_team_and_repo[team][repo]
      IF found → collect entry
      ELSE → treat as zero (sparse = no entry = 0 PRs)
  AGGREGATE collected entries → exact result
ELSE:
  FALL BACK to proportional intersection (existing behavior):
    combinedRatio = repoShare × teamShare
    combinedPrCount = total × combinedRatio
```

### Case 3: Three+ Filters Active (future)

```
IF team + repo active:
  USE by_team_and_repo for team-repo intersection (exact)
  APPLY proportional estimation for additional dimensions
ELSE IF author + repo active (no team):
  USE by_author_and_repo for author-repo intersection (exact)
  APPLY proportional estimation for additional dimensions
```

## Accuracy Flag Derivation

The frontend derives per-rollup accuracy from field presence:

```typescript
const isExact = rollup.by_team_and_repo !== undefined;
// isExact → "exact" indicator
// !isExact → "estimated" indicator (tooltip/muted icon)
```

## Multi-Team Overlap Handling

When selected teams have overlapping members:

1. Cross-dim lookup returns entries per-team per-repo
2. Entries are aggregated (summed) across selected teams
3. If `sum > by_repository[repo].pr_count`, overlap indicator shown
4. This is correct behavior — multi-team members cause intentional per-team attribution
5. `authors_count` and `reviewers_count` are also summed, producing upper-bound
   estimates (same author in two teams' entries is counted twice)

## Cycle Time Aggregation Note

When `aggregateEntries()` combines multiple cross-dimensional entries (e.g., 2 teams ×
3 repos = 6 entries), cycle time P50/P90 values are computed as PR-weighted averages
of the per-entry percentiles. This is NOT a true combined percentile (the weighted
average of medians ≠ the median of the combined set). The approximation is acceptable
for relative comparison across intersections but should not be treated as statistically
precise quantiles. This is a pre-existing limitation of the aggregation function, not
introduced by cross-dimensional data.

## Zeroed Rollup Conditions

Return zeroed metrics when:
- No selected team has entries in any selected repo (all lookups miss)
- Team or repo filter selection is empty after resolving against available data
