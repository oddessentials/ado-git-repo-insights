# Quickstart: Cross-Dimensional Filter Accuracy

**Feature**: 029-cross-dimensional-accuracy
**Branch**: `029-cross-dimensional-accuracy`

## What This Feature Does

When a user selects both a team filter and a repository filter on the dashboard,
the metrics displayed are now **exact** (computed from the actual team-repo
intersection) instead of the current **proportional estimate** (which can be off
by up to 60% for specialized teams).

## Files to Modify

### Backend (Python)

| File | Change |
|------|--------|
| `src/ado_git_repo_insights/transform/aggregators.py` | Add `_generate_team_repo_slice()` method; call it from `_generate_weekly_rollups()`; bump `AGGREGATES_SCHEMA_VERSION` to 2; add `features.cross_dimensional` flag |
| `scripts/generate-synthetic-dataset.py` | Add `by_team_and_repo` generation with correlated team-repo distributions |
| `tests/unit/test_aggregators.py` | Add `TestTeamRepoSlicing` class for cross-dimensional tests |
| `tests/unit/test_synthetic_dataset.py` | Validate cross-dim fields in synthetic output |

### Frontend (TypeScript)

| File | Change |
|------|--------|
| `extension/ui/schemas/rollup.schema.ts` | Add `by_team_and_repo` to `WeeklyRollup` interface and `KNOWN_ROOT_FIELDS`; add nested breakdown validation |
| `extension/ui/modules/metrics.ts` | Update `applyFiltersToRollups()` to prefer exact cross-dim lookup when available; add overlap detection helper |
| `extension/ui/dashboard.ts` | Wire up accuracy indicator (tooltip on metric cards when proportional fallback active) |
| `extension/tests/modules/metrics.test.ts` | Add cross-dim filter resolution tests |
| `extension/tests/schema/rollup.test.ts` | Add v2 rollup validation tests |

### Contracts & Documentation

| File | Change |
|------|--------|
| `docs/reference/dataset-contract.md` | Add v2 rollup schema with `by_team_and_repo` field |

## Development Workflow

1. **Start**: `git checkout 029-cross-dimensional-accuracy`
2. **Backend first**: Implement `_generate_team_repo_slice()` in aggregators.py
3. **Test backend**: `pytest tests/unit/test_aggregators.py -k team_repo`
4. **Update synthetic generator**: Add cross-dim data to generate-synthetic-dataset.py
5. **Frontend schema**: Update rollup.schema.ts with new types and validation
6. **Frontend logic**: Update metrics.ts filter resolution
7. **Test frontend**: `cd extension && pnpm test -- --grep "cross-dim"`
8. **Integration**: Run full pipeline with synthetic data, verify dashboard accuracy
9. **Performance**: Run with stress dataset (50 teams, 100 repos, 260 weeks)

## Key Design Decisions

- **Name-based keys** (not GUIDs): `by_team_and_repo` uses `team_name` and
  `repository_name` as keys, matching existing `by_team`/`by_repository` convention.
  Dimensions already expose IDs for future migration.
- **Sparse storage**: Only non-empty intersections stored. Missing key = 0 PRs.
- **Fallback**: When `by_team_and_repo` is absent (legacy data), existing proportional
  estimate is used seamlessly.
- **Accuracy indicator**: Frontend derives exact vs. estimated from field presence
  (`by_team_and_repo !== undefined`).
- **Schema version**: `aggregates_schema_version` bumped to 2.

## Testing Checklist

- [ ] Cross-dim slice consistency: `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count`
- [ ] Non-additive authors/reviewers: `sum(authors_count) >= by_team[team].authors_count` (expected)
- [ ] Empty intersection returns zero (not undefined/NaN)
- [ ] Legacy rollup (no cross-dim field) falls back to proportional
- [ ] Mixed weeks (some with cross-dim, some without) blend correctly
- [ ] Multi-team overlap: sum across teams can exceed repo total
- [ ] Single filter still works unchanged (no regression)
- [ ] Schema validator accepts v2 rollups without errors
- [ ] `normalizeRollup()` preserves `by_team_and_repo` field (not stripped)
- [ ] Minimum sample size: intersections with <5 PRs have null cycle time percentiles
- [ ] Truncation: >5,000 entries removes lowest-pr_count; `_truncated` flag set
- [ ] Synthetic generator produces correlated (not independent) team-repo distributions
- [ ] Cross-stack round-trip: Python fixture → frontend filter → exact result matches
- [ ] `features.cross_dimensional` is false when teams exist but have no members
- [ ] Stress test: 50 teams × 100 repos × 260 weeks under 30s pipeline time
