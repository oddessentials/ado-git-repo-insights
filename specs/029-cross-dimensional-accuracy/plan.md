# Implementation Plan: Cross-Dimensional Filter Accuracy

**Branch**: `029-cross-dimensional-accuracy` | **Date**: 2026-02-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/029-cross-dimensional-accuracy/spec.md`

## Summary

Replace the proportional intersection estimate (up to 60% error) with exact
cross-dimensional breakdowns when multiple dashboard filters are active. The backend
generates a new `by_team_and_repo` nested breakdown in weekly rollups, computed from
the actual team-repo PR intersection. The frontend prefers this exact data when
available and falls back to proportional estimation for legacy data.

## Technical Context

**Language/Version**: Python 3.14 (backend), TypeScript 5.x (frontend)
**Primary Dependencies**: pandas (aggregation), Jest/ts-jest (frontend tests), pytest (backend tests)
**Storage**: SQLite (source of truth) → JSON weekly rollups (computed output)
**Testing**: pytest (backend unit/integration), Jest/ts-jest with jsdom (frontend unit), Playwright (e2e)
**Target Platform**: Azure DevOps Pipeline (backend), VS Code webview + ADO Extension (frontend)
**Project Type**: Backend CLI + Frontend dashboard (dual-stack)
**Performance Goals**: <30s pipeline overhead for 50 teams × 100 repos × 260 weeks; <10% dashboard load time increase
**Constraints**: Max 500KB per weekly rollup JSON; max 5,000 cross-dim entries per week
**Scale/Scope**: 50 teams, 100 repos, 200 authors, 260 weeks (enterprise upper bound)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Check (Core Principles)

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CSV schema is hard contract | PASS | Cross-dim data is JSON-only, no CSV changes |
| II. No breaking CSV changes | PASS | No CSV changes at all |
| III. Deterministic CSV output | PASS | No CSV changes |
| IV. PowerBI frictionless import | PASS | No CSV changes |
| V. SQLite as source of truth | PASS | Cross-dim computed from SQLite PRs + team_members |
| VI. Pipeline artifacts persist | PASS | No persistence model change |
| VII. No publish on failure | PASS | No change to publish logic |
| VIII. Idempotent state updates | PASS | Cross-dim regenerated each run from SQLite |
| XII. No silent data loss | PASS | Sparse storage = intentional zero, not data loss |
| XIV. Stable UPSERT keys | PASS | No new UPSERT keys (computed output only) |
| XVI. Names are labels, IDs identity | **WARN** | Cross-dim keys use `team_name` (matching existing `by_team`); see R-01 in research.md |

### Quality Gates Impact

| Gate | Impact | Action Required |
|------|--------|-----------------|
| QG-25 (156+ weeks synthetic) | AFFECTED | Update synthetic generator to produce cross-dim data |
| QG-28 (dashboard < 1000ms) | AFFECTED | Verify dashboard load with cross-dim data stays under limit |
| QG-29 (chart data caps) | UNAFFECTED | No new chart types |

### Post-Design Re-Check

| Decision | Constitution Compliance |
|----------|----------------------|
| R-01: Name-based keys | Matches existing Principle XVI convention; dimensions already expose IDs for future migration |
| R-02: Schema version bump to v2 | Compliant with Principle II (explicit version bump for schema change) |
| R-03: Groupby team-repo computation | Compliant with Principle V (computed from SQLite source of truth) |
| R-04: Field-presence as accuracy flag | Compliant — no new required fields break backward compatibility |

## Project Structure

### Documentation (this feature)

```text
specs/029-cross-dimensional-accuracy/
├── plan.md                              # This file
├── spec.md                              # Feature specification (19 FRs, 9 SCs)
├── research.md                          # Phase 0: 8 research decisions
├── data-model.md                        # Phase 1: Entity definitions
├── quickstart.md                        # Phase 1: Developer guide
├── contracts/
│   ├── weekly-rollup-v2.md              # v2 rollup schema contract
│   └── filter-resolution.md             # Filter resolution algorithm contract
├── checklists/
│   └── requirements.md                  # Spec quality checklist
└── tasks.md                             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── transform/
│   └── aggregators.py              # Add _generate_team_repo_slice(), bump schema version
└── persistence/
    └── models.py                   # No changes (existing schema sufficient)

scripts/
└── generate-synthetic-dataset.py   # Add by_team_and_repo generation

tests/
├── unit/
│   ├── test_aggregators.py         # Add TestTeamRepoSlicing class
│   └── test_synthetic_dataset.py   # Validate cross-dim in synthetic output
└── integration/
    └── (existing tests unchanged)

extension/
├── ui/
│   ├── schemas/
│   │   └── rollup.schema.ts        # Add WeeklyRollup.by_team_and_repo + validation
│   ├── modules/
│   │   └── metrics.ts              # Update applyFiltersToRollups() with cross-dim path
│   └── dashboard.ts                # Add accuracy indicator (tooltip)
└── tests/
    ├── modules/
    │   ├── metrics.test.ts          # Add cross-dim filter tests
    │   └── metrics.edge-cases.test.ts  # Add multi-team overlap tests
    ├── schema/
    │   └── rollup.test.ts           # Add v2 rollup validation tests
    └── python-integration/
        └── synthetic-fixtures.test.ts  # Validate cross-dim in synthetic fixtures

docs/
└── reference/
    └── dataset-contract.md          # Add v2 rollup schema documentation
```

**Structure Decision**: This is a dual-stack project (Python backend + TypeScript
frontend). Changes span both stacks but are isolated to the aggregation layer
(backend) and filter pipeline (frontend). No new files are created — all changes
modify existing files, except for new test classes within existing test files.

**Parallelization**: Phases A+B (backend) and Phase D (frontend schema) are
independent and can be developed in parallel. Phase E depends on both A and D
completing. Phase C (synthetic generator) depends only on Phase A.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Schema version bump (v1 → v2) | Signal to consumers that new fields exist | Additive-only (no bump) would leave consumers unable to detect cross-dim availability; constitution requires explicit versioning |
| Name-based keys (not GUID) | Backward compatibility with existing by_team/by_repository convention | GUID keys would require migrating all existing breakdown keys across both backend and frontend — a separate feature scope |
| Minimum sample size threshold (n < 5 → null percentiles) | Avoid misleading P50/P90 at small sample sizes | Always computing percentiles is simpler but produces statistically meaningless values for 1-3 PR intersections |
| `_truncated` flag on rollup | Signal relaxed consistency invariant after truncation | Silently truncating without a flag makes consumers unable to detect data loss |

## Implementation Phases

### Phase A: Backend — Cross-Dimensional Slice Generation

**Files**: `aggregators.py`
**Effort**: ~2 days

1. Add `_generate_team_repo_slice()` method after `_generate_team_slice()` (~line 690)
   - Use `groupby` approach: tag each PR with its team(s), then group by
     `(team_name, repository_name)` in a single pass — avoids O(teams × repos) iteration
   - This aligns with `_generate_repo_slice()` which already uses `groupby("repository_name")`
   - Return sparse nested dict: `{team_name: {repo_name: BreakdownEntry}}`
   - Skip entries where pr_count == 0
   - **Minimum sample size**: set `cycle_time_p50` and `cycle_time_p90` to `None`
     when the intersection contains fewer than 5 PRs

2. Call from `_generate_weekly_rollups()` (~line 544):
   ```python
   by_team_and_repo = self._generate_team_repo_slice(
       group, week_reviewers, team_members_df
   )
   if by_team_and_repo:
       rollup_dict["by_team_and_repo"] = by_team_and_repo
   ```

3. Add consistency assertion: verify `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count`
   for each team during generation. Note: this invariant applies ONLY to `pr_count`.
   `authors_count` and `reviewers_count` are distinct-count metrics and are NOT additive
   across repos within a team (`sum >= team total` is expected)

4. Bump `AGGREGATES_SCHEMA_VERSION` to 2 (line 34)

5. Set `features.cross_dimensional` flag based on actual output (~line 284):
   ```python
   # Set after rollup generation, not from input conditions
   "cross_dimensional": any_rollup_has_cross_dim,
   ```
   Track a boolean during `_generate_weekly_rollups()` that is set to `True` when
   any rollup dict receives a `by_team_and_repo` field. This avoids false positives
   when teams exist but have no members (empty `team_members_df`)

### Phase B: Backend — Tests

**Files**: `test_aggregators.py`
**Effort**: ~1.5 days

1. Add `TestTeamRepoSlicing` class with fixtures:
   - `db_with_team_repo_correlation`: Team Alpha → 90% Repo-Backend, 10% Repo-Frontend
   - Test exact intersection matches known values
   - Test sparse output (empty intersections excluded)
   - Test consistency invariant for `pr_count` (cross-dim sums = team totals)
   - Test that `authors_count` sum across repos >= team `authors_count` (non-additive)
   - Test teamless authors excluded from cross-dim
   - Test multi-team authors appear in both teams' entries
   - Test minimum sample size: intersections with <5 PRs have null cycle time percentiles

2. Add schema version bump test:
   - Verify `AGGREGATES_SCHEMA_VERSION == 2`
   - Verify `features.cross_dimensional` in manifest
   - Verify `features.cross_dimensional` is `False` when teams exist but have no members

3. Add truncation behavior test:
   - Create synthetic dataset that exceeds 5,000 cross-dim entries per week
   - Verify truncation removes lowest-pr_count entries
   - Verify `_truncated` flag is set on the rollup
   - Document: consistency invariant is relaxed for affected teams after truncation

4. Add performance gate test:
   - Run with stress dataset (50 teams × 100 repos × 260 weeks)
   - Assert total pipeline overhead < 30 seconds (SC-007)
   - Fail the build if exceeded

### Phase C: Synthetic Data Generator

**Files**: `generate-synthetic-dataset.py`
**Effort**: ~0.5 day

1. Add `by_team_and_repo` generation after `by_team` block (~line 182):
   - Use **correlated** team-repo distributions (not independent random weights)
   - Example: Team Alpha → 80% Repo-Backend, 15% Repo-Frontend, 5% Repo-Shared;
     Team Beta → 10% Repo-Backend, 70% Repo-Frontend, 20% Repo-Shared
   - Ensure per-team-repo `pr_count` entries sum to team totals
   - Include cycle time variation per intersection
   - Set cycle time percentiles to `null` for intersections with <5 PRs

2. Update `test_synthetic_dataset.py`:
   - Validate `by_team_and_repo` present in generated rollups
   - Validate consistency invariant (`pr_count` only)
   - Validate that correlated distributions produce non-trivial proportional error
     (the synthetic data must expose the estimation failures the feature fixes)

### Phase D: Frontend — Schema & Types

**Files**: `rollup.schema.ts`, `dataset-loader.ts`
**Effort**: ~0.5 day

1. Add to `WeeklyRollup` interface in `rollup.schema.ts`:
   ```typescript
   by_team_and_repo?: Record<string, Record<string, BreakdownEntry>>;
   ```
   Also update the `Rollup` interface in `dataset-loader.ts` if it has an explicit
   field list (not just the `[key: string]: unknown` index signature)

2. Add `"by_team_and_repo"` to `KNOWN_ROOT_FIELDS` set

3. Add nested breakdown validation in `validateRollup()`:
   - For `by_team_and_repo`: validate outer dict → inner dict → BreakdownEntry

4. **CRITICAL**: Update `normalizeRollup()` to explicitly pass through `by_team_and_repo`.
   The current implementation constructs a return object with only known fields — if
   `by_team_and_repo` is not explicitly included, it will be silently stripped and the
   frontend will always fall back to proportional estimation. Add a **gated test** that
   passes a rollup with `by_team_and_repo` through `normalizeRollup()` and asserts the
   field is preserved in the output

### Phase E: Frontend — Filter Resolution

**Files**: `metrics.ts`
**Effort**: ~1 day

1. In `applyFiltersToRollups()`, add cross-dim lookup between the single-filter
   and proportional-intersection blocks (~line 319):

   ```typescript
   // Cross-dimensional exact lookup (priority over proportional)
   if (repoSlice && teamSlice && rollup.by_team_and_repo) {
     const crossDimEntries: BreakdownEntry[] = [];
     for (const team of filters.teams) {
       const teamRepos = rollup.by_team_and_repo[team];
       if (!teamRepos) continue;
       for (const repo of filters.repos) {
         const entry = teamRepos[repo];
         if (entry) crossDimEntries.push(entry);
       }
     }
     if (crossDimEntries.length > 0) {
       const exactSlice = aggregateEntries(crossDimEntries);
       return buildFilteredRollup(rollup, exactSlice);
     }
     // All lookups missed → zero PRs for this intersection
     return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
   }
   ```

2. The existing proportional block (lines 324-364) remains as fallback for
   rollups without `by_team_and_repo`.

### Phase F: Frontend — Accuracy Indicator

**Files**: `dashboard.ts`
**Effort**: ~0.5 day

1. When both team and repo filters are active, check each rendered rollup for
   `by_team_and_repo` presence
2. If any rollup in the visible range lacks it, show a subtle tooltip:
   "Some weeks use approximate data (pre-migration)"
3. Style: muted info icon next to metric cards, visible only when mixed data

### Phase G: Frontend — Tests

**Files**: `metrics.test.ts`, `metrics.edge-cases.test.ts`, `rollup.test.ts`, `synthetic-fixtures.test.ts`
**Effort**: ~2 days

1. `metrics.test.ts` additions:
   - Test exact cross-dim lookup when `by_team_and_repo` present
   - Test proportional fallback when `by_team_and_repo` absent
   - Test mixed weeks (some exact, some proportional)
   - Test zeroed result for empty intersection

2. `metrics.edge-cases.test.ts` additions:
   - Test multi-team overlap (sum > repo total)
   - Test all-teams + all-repos = global total
   - Test single team + single repo = exact lookup
   - Test aggregated `authors_count` is an upper bound (sum >= team total)

3. `rollup.test.ts` additions:
   - Test v2 rollup validates successfully
   - Test nested `by_team_and_repo` structure validation
   - Test unknown fields in nested breakdown produce warnings (permissive)
   - **Gated test**: `normalizeRollup()` preserves `by_team_and_repo` field

4. `synthetic-fixtures.test.ts` — **cross-stack round-trip test**:
   - Load a Python-generated fixture containing `by_team_and_repo`
   - Run it through `applyFiltersToRollups()` with team + repo filters
   - Assert the result matches known exact values from the fixture data
   - This validates the full Python→JSON→TypeScript→exact result pipeline

### Phase H: Documentation & Contract Update

**Files**: `dataset-contract.md`
**Effort**: ~0.5 day

1. Add v2 rollup schema with `by_team_and_repo` field
2. Document schema version bump (v1 → v2)
3. Document consumer compatibility matrix
4. Add `features.cross_dimensional` to manifest schema

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance regression (large orgs) | Medium | High | Groupby approach (not iterative) reduces worst-case; Phase B includes performance gate test; FR-017 enforces hard limits |
| Name-based key fragmentation (renames) | Medium | Medium | Documented as known limitation; dimensions.json already has IDs for future migration |
| Multi-team overlap confuses users | High | Low | FR-016 requires visible indicator; documented as expected behavior |
| Migration boundary in trend lines | High | Low | FR-014 requires per-week accuracy derivation; tooltip explains mixed data |
| Schema v2 breaks older consumers | Low | High | Consumers that reject v2 surface clear error; v1 consumers in permissive mode just warn |
| `normalizeRollup()` strips `by_team_and_repo` | Medium | High | Phase D requires explicit pass-through; gated test in Phase G validates field survives normalization |
| authors/reviewers count overcounting in aggregation | High | Medium | Documented as expected upper-bound behavior in SC-001, SC-005, contracts, and data model; not a bug |
| Small-sample percentiles mislead users | Medium | Medium | Minimum sample size threshold (n >= 5); null percentiles handled gracefully by frontend |
| Truncation breaks consistency invariant | Low | Medium | `_truncated` flag signals relaxed invariant; test validates truncation behavior |
| 500KB cap at theoretical boundary for dense orgs | Medium | Low | Validated empirically with stress dataset; compact JSON or reduced cap (4,000) as fallback |

## Dependencies

- **Team Filters** (95% complete): Required for team-repo cross-dimensional data
- **Author Contributor Filters** (0%): Required for author-repo (P3 story, deferred)
- No external dependencies or new packages required
