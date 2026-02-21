# Feature Specification: Realistic Demo Data

**Feature Branch**: `031-realistic-demo-data`
**Created**: 2026-02-21
**Status**: Draft
**Input**: User description: "Fix the demo data generator to produce complete, realistic demo data that showcases the cross-dimensional filter accuracy feature (029)."

## Governing Contracts

These five contracts govern the spec. Every FR and SC must trace to one of them. If an FR or SC conflicts with a contract, the contract wins.

### Contract 1: Single Authoritative Schema

The rollup schema definition in the TypeScript schema validator is the single source of truth for field names and types. The demo generator, the synthetic generator, the manifest, and all tests derive their field expectations from this one definition. No second copy of the field list may exist. The schema completeness guard reads the canonical list at test time, not from a hardcoded duplicate.

### Contract 2: Deterministic RNG

The generator MUST NOT use `random.lognormvariate()` or any stdlib distribution function whose implementation is not contractually stable across Python versions. Instead, it must use a locked RNG implementation: either inverse-CDF with explicit math on a stable `random.Random.random()` base, or a pinned NumPy `Generator` with a fixed algorithm (e.g., PCG64). The contract is: given the same seed, the same Python major.minor version (3.12+), the output is byte-identical. Cross-version stability is best-effort but not guaranteed.

### Contract 3: One Cycle-Time Threshold Rule

If a breakdown entry (at any level — rollup, repo, team, or team-repo intersection) has `pr_count < 5`, then `cycle_time_p50` and `cycle_time_p90` are both `null`. No exceptions. No "if 1 PR then p50=p90" special case. This matches the real pipeline's `_CROSS_DIM_MIN_SAMPLE = 5` convention.

### Contract 4: Cross-Dimensional Completeness

`by_team_and_repo[team]` MUST contain an entry for every repo where that team had >= 1 PR in that week. No repo may be silently omitted. The equality invariant (`sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count`) depends on this completeness. Repos with zero PRs for a team in a given week are omitted (sparse), but any repo with >= 1 PR MUST be present.

### Contract 5: Frozen Demo Invariants

The realism thresholds (top-3 repo share, growth ratio, holiday dip, idle repo-weeks, team affinity) are frozen demo invariants tied to the specific demo org configuration (23 repos, 4 teams, 50 users, 260 weeks). They are not general-purpose rules. If the demo org shape changes (more repos, more teams, different time range), the invariants MUST be updated to match. The invariant values and the org configuration they depend on are co-located in the generator source as named constants, so a change to one surfaces the other.

## User Scenarios & Testing

### User Story 1 - Complete Cross-Dimensional Demo Data (Priority: P1)

A prospective customer opens the demo dashboard, selects both a team and a repository filter, and sees exact filtered metrics — not an accuracy warning. The demo must showcase the product's flagship feature: precise cross-dimensional breakdowns.

**Why this priority**: The demo dashboard is the sales tool. If the demo can't demonstrate the core feature (cross-dimensional accuracy), the feature might as well not exist.

**Independent Test**: Generate demo data, load every rollup file, assert every file contains a `by_team_and_repo` field with a nested map of team -> repo -> BreakdownEntry. Verify cross-dimensional consistency invariant holds for every week.

**Acceptance Scenarios**:

1. **Given** a freshly generated demo dataset, **When** any weekly rollup file is loaded, **Then** it contains `by_team_and_repo` as a non-null map with at least one team entry, each containing at least one repo entry with valid `pr_count`, `authors_count`, `reviewers_count`, and nullable `cycle_time_p50`/`cycle_time_p90` fields.
2. **Given** any team in `by_team`, **When** summing `pr_count` across all repos in `by_team_and_repo[team]`, **Then** the sum equals the team's `pr_count` in `by_team` (per Contract 4).
3. **Given** any team in `by_team` with `pr_count >= 1` for a given week, **When** checking `by_team_and_repo[team]`, **Then** every repo where that team had >= 1 PR is present (per Contract 4).
4. **Given** any breakdown entry at any level, **When** `pr_count < 5`, **Then** `cycle_time_p50` and `cycle_time_p90` are both `null` (per Contract 3).
5. **Given** every generated rollup loaded and validated, **When** no rollup has `by_team_and_repo == null`, **Then** the dashboard's accuracy indicator logic will never trigger for any team+repo filter combination (data-level invariant, not UI test).

---

### User Story 2 - Realistic Data Distributions (Priority: P2)

An evaluator browsing the demo dashboard sees data that looks like a real engineering organization — not uniform synthetic noise. Repo activity follows a power-law distribution. PR volume grows year-over-year. Holiday weeks show dips. Teams have affinities to specific repos. Cycle times vary by repo type.

**Why this priority**: Credible demo data is what makes the difference between "this looks like a real tool" and "this is obviously fake."

**Independent Test**: Generate demo data, run programmatic assertions against the frozen demo invariants (per Contract 5). All thresholds are co-located with the org configuration constants in the generator.

**Acceptance Scenarios**:

1. **Given** all generated weekly rollups, **When** counting total PRs per repository across all weeks, **Then** the top 3 repositories account for at least 40% of total PRs.
2. **Given** all generated weekly rollups, **When** comparing total PRs in the final year vs the first year, **Then** the final year total is at least 1.3x the first year total.
3. **Given** any year's weekly rollups, **When** checking the PR count for week 52, **Then** it is at most 60% of that year's average weekly PR count.
4. **Given** all weekly rollups, **When** counting repo-weeks where a repo appears in `by_repository`, **Then** at least 20% of all possible repo-weeks show zero PRs.
5. **Given** each team's PR distribution across repos, **When** checking affinity, **Then** at least 60% of each team's PRs land in its designated primary repos.
6. **Given** different repo categories (utility, frontend, backend, data/ML), **When** comparing median cycle times across all weeks, **Then** utility repos have shorter median cycle times than data/ML repos by at least 2x.

---

### User Story 3 - Schema Completeness Guard (Priority: P3)

A developer adds a new field to the rollup schema. The CI pipeline catches that the demo data generator does not produce this field, before the change ships. This prevents the `by_team_and_repo` gap from ever recurring.

**Why this priority**: The systemic failure was that two generators drifted apart with no test catching it. The guard makes the fix durable.

**Independent Test**: Add a dummy field to the canonical schema's known fields list, run the guard test, confirm it fails naming the missing field.

**Acceptance Scenarios**:

1. **Given** the canonical schema definition (per Contract 1), **When** a new non-deprecated field is added, **Then** a test fails naming the missing field until the demo generator is updated to produce it.
2. **Given** the demo data generator produces a rollup, **When** the schema completeness guard runs, **Then** it reads the field list from the canonical schema definition at test time (not from a hardcoded duplicate) and asserts all required fields are present.
3. **Given** the manifest's `aggregates_schema_version`, **When** compared to the version expected by the dashboard, **Then** they match. The dashboard's expected version is the single authoritative value (per Contract 1).

---

### User Story 4 - Reliable Generation Pipeline (Priority: P4)

A developer changes the demo data generator script. The pipeline regenerates all demo data in the correct order, deterministically, and CI verifies the output is complete and consistent.

**Why this priority**: Three separate generators with no orchestrator, stale manifests, and no auto-regeneration created the conditions for every gap found.

**Independent Test**: Run the full pipeline twice, compare all output files byte-for-byte. Modify the generator script, run CI, confirm regeneration is triggered.

**Acceptance Scenarios**:

1. **Given** a single orchestrator command, **When** executed twice with the same seed, **Then** all output files are byte-identical (per Contract 2).
2. **Given** the regeneration pipeline completes, **When** checking the manifest, **Then** `features.predictions`, `features.ai_insights`, and `features.cross_dimensional` are all `true`, and `aggregates_schema_version` matches the dashboard's expected version.
3. **Given** a change to any generator script, **When** CI runs, **Then** the pipeline regenerates demo data and verifies the committed output matches.
4. **Given** the three generators (data, predictions, insights), **When** orchestrated, **Then** they run in dependency order (data first, then predictions, then insights) and all use binary-mode file I/O (per Contract 2).

---

### Edge Cases

- What happens when a team has zero PRs in a given week? That team is omitted from `by_team`, `by_team_and_repo`, and all cross-dim maps for that week (sparse representation).
- What happens when a repo has zero PRs in a given week? It is absent from `by_repository` and from all `by_team_and_repo` entries.
- What happens when a team-repo intersection has 1-4 PRs? `pr_count` is set, `cycle_time_p50` and `cycle_time_p90` are `null` (per Contract 3, no exceptions).
- What happens when the generation seed changes? All downstream tests use the seed, not hardcoded expected values. The frozen invariants (Contract 5) are statistical properties that hold regardless of seed.
- What happens on different Python versions? The locked RNG implementation (Contract 2) guarantees identical output on the target Python version (3.12+). Cross-version stability is not guaranteed.
- What happens when parallel feature branches both change the generator? The committed demo data will conflict. The defined workflow is: regeneration happens on the feature branch, conflicts are resolved by re-running the orchestrator on the merge target. This is no different from any other generated artifact (compiled bundles, lock files).

## Requirements

### Functional Requirements

- **FR-001**: The demo data generator MUST produce `by_team_and_repo` in every weekly rollup file as a nested map of team name to repo name to breakdown entry.
- **FR-002**: For each team in `by_team_and_repo`, the map MUST contain an entry for every repo where that team had >= 1 PR in that week, and the sum of `pr_count` across all repos MUST equal that team's `pr_count` in `by_team` (per Contract 4).
- **FR-003**: Any breakdown entry at any level with `pr_count < 5` MUST have `null` for both `cycle_time_p50` and `cycle_time_p90` (per Contract 3, no exceptions).
- **FR-004**: Repository PR distribution MUST follow a power-law pattern where the top 3 repositories account for at least 40% of total PRs across all weeks (frozen demo invariant per Contract 5).
- **FR-005**: Total PR volume MUST show year-over-year growth with the final year at least 1.3x the first year (frozen demo invariant per Contract 5).
- **FR-006**: Holiday weeks (week 52 at minimum) MUST show suppressed PR counts at most 60% of the year's average (frozen demo invariant per Contract 5).
- **FR-007**: Each team MUST have a defined set of primary repositories, and at least 60% of that team's PRs MUST land in those repos (frozen demo invariant per Contract 5).
- **FR-008**: Different repository categories (utility, frontend, backend, data/ML) MUST have distinct cycle time distributions with utility repos at least 2x faster than data/ML repos.
- **FR-009**: At least 20% of all possible repo-weeks MUST show zero PRs (frozen demo invariant per Contract 5).
- **FR-010**: The manifest MUST set `aggregates_schema_version` to match the dashboard's expected version, and `features.cross_dimensional`, `features.predictions`, and `features.ai_insights` to `true` after the full pipeline runs.
- **FR-011**: A schema completeness test MUST read the known field list from the canonical schema definition (per Contract 1) at test time and assert every non-deprecated field is present in the generated demo data. It MUST fail with a message naming any missing field.
- **FR-012**: A single orchestrator command MUST regenerate all demo data (data, predictions, insights) in the correct dependency order.
- **FR-013**: The full generation pipeline MUST be deterministic using a locked RNG implementation (per Contract 2). Two runs with the same seed on the same Python version MUST produce byte-identical output.
- **FR-014**: All generators MUST use binary-mode file I/O to prevent platform-specific line ending differences.
- **FR-015**: All existing realism invariants (INV-001 through INV-007) MUST continue to pass with the new data.
- **FR-016**: Author and reviewer counts MUST scale sub-linearly with PR count. Counts are per-week per-breakdown-level (rollup, repo, team, team-repo). At the team level, `authors_count` and `reviewers_count` MUST NOT exceed the team's member count for that time period. At the team-repo level, they MUST NOT exceed the team-level counts. Contributors who appear in multiple repos within the same team are counted once at the team level (unique contributors), not summed.
- **FR-017**: The frozen demo invariant thresholds and the org configuration constants they depend on (repo count, team count, user count, week count) MUST be co-located as named constants in the generator source, so a change to the org shape surfaces the invariants for review (per Contract 5).
- **FR-018**: If the dashboard's expected schema version and the manifest's `aggregates_schema_version` disagree, the dashboard is authoritative. The generator MUST read or reference the dashboard's version constant, not maintain a separate hardcoded value.

### Key Entities

- **Weekly Rollup**: Top-level aggregation for one ISO week. Contains global metrics plus breakdown maps (`by_repository`, `by_team`, `by_team_and_repo`).
- **Breakdown Entry**: Metrics for a single dimension slice: `pr_count`, `cycle_time_p50` (null when `pr_count < 5`), `cycle_time_p90` (null when `pr_count < 5`), `authors_count`, `reviewers_count`.
- **Team-Repo Intersection**: A breakdown entry for a specific team + repository combination within `by_team_and_repo`. Sparse — only present when the intersection has >= 1 PR. Complete — every repo with >= 1 PR for that team in that week MUST be present (per Contract 4).
- **Dataset Manifest**: Top-level metadata file declaring schema versions, feature flags, file indices, and coverage statistics. Version fields derive from the dashboard's authoritative constants (per Contract 1).
- **Generation Pipeline**: Ordered execution of three generators (data -> predictions -> insights) producing a consistent dataset via a single orchestrator command.
- **Frozen Demo Invariants**: Statistical thresholds tied to the specific demo org shape (23 repos, 4 teams, 50 users, 260 weeks). Co-located with org configuration as named constants (per Contract 5). Not portable to different org shapes.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For every generated rollup, `by_team_and_repo` is non-null and satisfies the completeness and sum-equality invariant from Contract 4 (data-level test, not UI test).
- **SC-002**: The top 3 repositories account for >= 40% of total PRs across all generated weeks (frozen demo invariant).
- **SC-003**: PR volume in the final year is >= 1.3x PR volume in the first year (frozen demo invariant).
- **SC-004**: At least 20% of possible repo-weeks have zero PRs (frozen demo invariant).
- **SC-005**: A new schema field added to the canonical schema definition without updating the generator causes a test failure naming the missing field.
- **SC-006**: The full generation pipeline produces byte-identical output on consecutive runs on the same Python version (per Contract 2).
- **SC-007**: All existing tests (968+ Python, 1560+ JS) continue to pass after the changes.
- **SC-008**: Week 52 in any year shows PR count <= 60% of that year's average (frozen demo invariant).
- **SC-009**: Each team's PR distribution shows >= 60% affinity to its designated repos (frozen demo invariant).
- **SC-010**: No breakdown entry at any level with `pr_count < 5` has non-null cycle time values (per Contract 3).

## Assumptions

- The demo data simulates a single mid-size engineering organization (~50 developers, 23 repos, 4 teams) over 5 years. These parameters are frozen for this demo configuration (per Contract 5).
- The existing 260-week time range (2021-W01 to 2025-W52) is preserved.
- The existing entity names (repos, teams, users) are preserved for backward compatibility with any references.
- Python 3.12+ is the target runtime. The locked RNG implementation (Contract 2) guarantees determinism on 3.12+. Cross-version stability with 3.11 is not guaranteed and not required.
- The `generate-synthetic-dataset.py` (used for scalability tests) is a separate concern and not modified by this feature.
- Review time fields (`review_time_p50`, `review_time_p90`) are out of scope — they are optional and not currently used by the dashboard.
- Merge conflicts in committed demo data are handled the same way as any other generated artifact (compiled bundles, lock files): re-run the orchestrator on the merge target.
