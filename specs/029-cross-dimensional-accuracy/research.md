# Research: Cross-Dimensional Filter Accuracy

**Feature**: 029-cross-dimensional-accuracy
**Date**: 2026-02-11

## Phase 0 Research Findings

### R-01: Current Keying Strategy (name-based vs ID-based)

**Decision**: Adopt a **dual-key migration approach** — cross-dimensional breakdowns
use `team_name` as the primary key (matching existing `by_team` convention) for
backward compatibility, but also include `team_id` in the dimensions data to enable
future migration to ID-based keys.

**Rationale**: The current codebase is deeply committed to name-based keys:
- `by_team` keys use `team_name` (aggregators.py:678)
- `by_repository` keys use `repository_name` (aggregators.py:610)
- Synthetic generator explicitly comments: "Keys must be team_name (not team_id) to
  match the dashboard contract — see dashboard.ts line 1119" (generate-synthetic-dataset.py:156)
- Dashboard filter dropdowns use `team_name` as option values (dashboard.ts:1101-1102)
- Frontend `resolveBreakdownEntries()` does direct string lookup against these names (metrics.ts:210-214)

Switching to GUID-based keys in `by_team_and_repo` while keeping `by_team` as name-based
would create an inconsistent contract. A full migration to ID-based keys across all
breakdowns is a separate feature scope.

**Alternatives considered**:
1. GUID-based keys for cross-dim only → rejected (inconsistent with by_team/by_repository)
2. Full ID migration across all breakdowns → rejected (scope creep, breaking change to
   CSV/dashboard contract, requires schema version bump for existing consumers)
3. Dual-key: name-based primary + ID lookup table → selected (forward-compatible without
   breaking existing consumers)

**Spec impact**: FR-015 should be amended to clarify that name-based keys are used for
backward compatibility in this phase. The dimensions data already exposes `team_id` and
`repository_id` alongside names, enabling a future ID-based migration without data loss.

---

### R-02: Schema Version Bump Strategy

**Decision**: Bump `AGGREGATES_SCHEMA_VERSION` from 1 to 2.

**Rationale**: The constitution (Core Principle II) requires explicit version bumps for
schema changes. While the new fields are additive, the dataset-contract.md (line 43)
states: "Reject if > supported" for `aggregates_schema_version`. Consumers that do not
understand v2 will reject the dataset, which is the correct behavior — they should not
silently ignore cross-dimensional data they cannot render.

Current version constants are at aggregators.py:34:
```python
AGGREGATES_SCHEMA_VERSION = 1
```

The frontend schema validator (rollup.schema.ts:69-82) uses `KNOWN_ROOT_FIELDS` to
warn on unknown fields. New fields like `by_team_and_repo` would produce warnings
(not errors) in permissive mode, but a version bump signals intent.

**Alternatives considered**:
1. No version bump (additive-only) → rejected per FR-007 revision and constitution
2. Bump all versions → rejected (only aggregates format changed)
3. Minor bump to 2 → selected

---

### R-03: Cross-Dimensional Aggregation Algorithm

**Decision**: Compute cross-dimensional slices using a **groupby approach** — tag each PR
with its team membership(s), then group by `(team_name, repository_name)` in a single
pass per week.

**Rationale**: The iterative approach (Cartesian product of teams × repos, filtering per
pair) was originally considered but rejected after review: the worst-case estimate of
~130 seconds (50×100×260) exceeds the SC-007 budget of 30 seconds by 4.3x. The groupby
approach is O(weeks × unique_team_repo_pairs) instead of O(weeks × teams × repos), which
is strictly better and aligns with the existing `_generate_repo_slice()` pattern that
already uses `groupby("repository_name")`.

**Algorithm**:
1. For each week's PR DataFrame, join against `team_members_df` to tag each PR with
   its team name(s). A multi-team author produces one row per team membership.
2. Group the tagged DataFrame by `(team_name, repository_name)`
3. For each group, compute metrics (pr_count, cycle_time_p50/p90, authors_count,
   reviewers_count)
4. Return sparse nested dict (skip groups with pr_count == 0)

**Performance estimate** (revised):
- Per week: O(PRs × avg_teams_per_author) for the join + O(unique_pairs) for groupby
- Typical org: ~500 unique team-repo pairs per week (not 5,000)
- 260 weeks × ~500 pairs = ~130K group computations
- Estimated: <10 seconds for typical orgs, <30 seconds for dense enterprise orgs

**Alternatives considered**:
1. Iterative Cartesian product → rejected (130s worst case exceeds 30s budget)
2. Pre-computed materialized view in SQLite → rejected (adds persistence complexity,
   violates stateless computation model)

---

### R-04: Proportional Fallback Detection

**Decision**: Use presence of the `by_team_and_repo` field in the rollup as the
accuracy flag. When present, the frontend uses exact data. When absent, it falls
back to proportional intersection.

**Rationale**: This is the simplest signal that requires no per-week metadata changes.
The existing `by_team` field already uses this pattern — it's only present when team
data is available.

For FR-014 (per-week accuracy flag), the frontend can derive the flag:
- `rollup.by_team_and_repo !== undefined` → exact
- Otherwise → estimated

This avoids adding a separate metadata field to the rollup schema.

**Alternative considered**: Explicit `accuracy: "exact" | "estimated"` field per rollup
→ rejected (adds a new required field that complicates schema, when presence of the
breakdown itself is sufficient signal).

---

### R-05: Multi-Team Overlap in Cross-Dimensional Context

**Decision**: Cross-dimensional data is computed per-team independently, matching the
existing `_generate_team_slice()` semantics. A PR by an author in multiple teams appears
in each team's cross-dimensional breakdown for the relevant repo.

**Rationale**: This matches the existing convention documented in aggregators.py:632-637:
"Authors in multiple teams will have their PRs counted in each team's slice. This is
intentional." Changing this for cross-dimensional data would create inconsistency.

**User communication (FR-016)**: The dashboard should include a tooltip when multi-team
overlap is detected (sum of team cross-dim entries > repo total). This can be computed
client-side by comparing `sum(by_team_and_repo[*][repo]) > by_repository[repo].pr_count`.

---

### R-06: Three-Way Filter Resolution Order

**Decision**: When team + repo + author filters are all active:
1. Use `by_team_and_repo` for the team-repo intersection (exact)
2. Apply proportional estimation for the author dimension on top

**Rationale**: Per FR-018, team-by-repository is the highest-priority pair because:
- It's the P1 user story
- Team data is 95% complete
- Author filters don't exist yet (0% complete)

Once author-by-repository is available, the resolution order for team + repo + author
would be: use team-by-repo exact data, then apply author proportional on top. The
author-by-repo pair is only preferred when the team filter is not active.

---

### R-07: Performance Testing Dataset Requirements

**Decision**: Define a "stress dataset" configuration for CI:
- 50 teams, 100 repos, 200 authors
- 260 weeks (5 years)
- ~500 sparse cross-dim entries per week average
- ~5,000 max entries per week (dense org)

**Rationale**: This matches the upper bounds defined in FR-017 and the existing
scalability constitution gates (QG-25 through QG-29).

The existing synthetic generator (generate-synthetic-dataset.py) currently produces
only 2 teams and 5-10 repos. It needs enhancement to support parameterized team/repo
counts for cross-dimensional testing.

---

### R-08: Existing Frontend Filter Architecture

**Decision**: Add cross-dimensional lookup as a priority path in `applyFiltersToRollups()`
before the proportional intersection fallback.

**Rationale**: The current filter pipeline in metrics.ts (lines 265-368) follows this
structure:
1. Check if repo filter active → compute `repoSlice`
2. Check if team filter active → compute `teamSlice`
3. If both active → proportional intersection (`combinedRatio = repoShare * teamShare`)

The cross-dimensional change inserts a step between 2 and 3:
- If both active AND `rollup.by_team_and_repo` exists → look up exact intersection
- Else → fall through to existing proportional logic

This preserves 100% backward compatibility and requires minimal code change.
