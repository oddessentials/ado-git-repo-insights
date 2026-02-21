# Data Model: Realistic Demo Data

**Branch**: `031-realistic-demo-data` | **Date**: 2026-02-21

## Entities

### WeeklyRollup (existing — extended)

The weekly rollup is the top-level aggregation for one ISO week. The `by_team_and_repo` field is the new addition.

| Field | Type | Required | Source |
|-------|------|----------|--------|
| `week` | string (YYYY-Www) | yes | generated |
| `start_date` | string (ISO date) | yes | calculated |
| `end_date` | string (ISO date) | yes | calculated |
| `pr_count` | integer >= 0 | yes | generated |
| `cycle_time_p50` | float \| null | yes | generated (null if pr_count < 5) |
| `cycle_time_p90` | float \| null | yes | generated (null if pr_count < 5) |
| `authors_count` | integer >= 0 | yes | generated |
| `reviewers_count` | integer >= 0 | yes | generated |
| `by_repository` | map<string, BreakdownEntry> | yes | generated |
| `by_team` | map<string, BreakdownEntry> | yes | generated |
| `by_team_and_repo` | map<string, map<string, BreakdownEntry>> | **yes (NEW)** | generated |

**Canonical schema**: `extension/ui/schemas/rollup.schema.ts` (Contract 1)

### BreakdownEntry (existing — unchanged)

Metrics for a single dimension slice. Used in `by_repository`, `by_team`, and nested in `by_team_and_repo`.

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `pr_count` | integer >= 0 | yes | sum must equal parent level |
| `cycle_time_p50` | float \| null | yes | **null if pr_count < 5** (Contract 3) |
| `cycle_time_p90` | float \| null | yes | **null if pr_count < 5** (Contract 3) |
| `authors_count` | integer >= 1 | yes | <= team member count at team level |
| `reviewers_count` | integer >= 1 | yes | <= team member count at team level |

**Deprecated fields** (present in schema, out of scope):
- `review_time_p50` — not generated
- `review_time_p90` — not generated

### Cross-Dimensional Intersection (new structure within WeeklyRollup)

`by_team_and_repo[team_name][repo_name]` → BreakdownEntry

**Invariants** (Contract 4):
- For each team T in `by_team`: `sum(by_team_and_repo[T][*].pr_count) == by_team[T].pr_count`
- If team T has `pr_count >= 1`, then `by_team_and_repo[T]` exists
- If team T has 0 PRs for a repo R in this week, R is absent from `by_team_and_repo[T]` (sparse)
- If team T has >= 1 PR for repo R, R **must** be present in `by_team_and_repo[T]` (complete)

### DatasetManifest (existing — updated)

| Field | Type | Current Value | New Value | Notes |
|-------|------|---------------|-----------|-------|
| `aggregates_schema_version` | integer | 1 | **2** | Match dashboard expectation |
| `features.cross_dimensional` | boolean | absent | **true** | New feature flag |
| `features.predictions` | boolean | false→true | true | Set by predictions generator |
| `features.ai_insights` | boolean | false→true | true | Set by insights generator |

## Generator Configuration Constants (Contract 5)

These constants define the demo org shape. They are co-located with the frozen demo invariants they govern (FR-017).

### Org Shape Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `NUM_REPOS` | 23 | Total repositories (existing, updated from 20) |
| `NUM_TEAMS` | 4 | Total teams |
| `NUM_USERS` | 50 | Total users |
| `NUM_WEEKS` | 260 | Total ISO weeks (2021-W01 to 2025-W52) |
| `BASE_PR_COUNT` | 40 | Base weekly PR count before adjustments |
| `GROWTH_RATE_PER_YEAR` | 0.12 | Linear growth rate per year |

### Repository Weights (Power-Law, FR-004)

| Category | Repos | Weight Range | Count |
|----------|-------|--------------|-------|
| High-traffic | user-service, react-shell, ios-app | 0.85–1.0 | 3 |
| Medium-traffic | auth-service, gateway-core, android-app, etl-jobs, model-training, dashboard-api, notification-service, design-system | 0.5–0.7 | 8 |
| Low-traffic | data-warehouse, stream-processor, feature-store, inference-service, report-generator, metrics-collector, shared-core | 0.15–0.3 | 7 |
| Idle | rate-limiter, ci-scripts, terraform-modules, monitoring-stack, forms-lib | 0.05–0.1 | 5 |

### Team-Repo Affinity Matrix (FR-007)

| Team | Primary Repos | Affinity Target |
|------|---------------|-----------------|
| Platform Team | user-service, auth-service, notification-service | >= 60% |
| Frontend Team | react-shell, design-system, ios-app | >= 60% |
| Data Team | etl-jobs, data-warehouse, stream-processor | >= 60% |
| ML Team | model-training, inference-service, feature-store | >= 60% |

### Cycle Time Category Multipliers (FR-008)

| Category | Repos | mu_factor | Effective mu |
|----------|-------|-----------|-------------|
| Utility/DevOps | ci-scripts, terraform-modules, monitoring-stack, rate-limiter | 0.5 | 3.0 |
| Frontend | react-shell, design-system, ios-app, android-app, forms-lib | 0.8 | 4.8 |
| Backend | user-service, auth-service, gateway-core, notification-service, dashboard-api | 1.0 | 6.0 |
| Data/ML | etl-jobs, data-warehouse, stream-processor, model-training, inference-service, feature-store, metrics-collector, report-generator | 1.3 | 7.8 |

### Frozen Demo Invariants (Contract 5)

| Invariant | Threshold | SC |
|-----------|-----------|-----|
| INV-001: Top-3 repo share | >= 40% of total PRs | SC-002 |
| INV-002: YoY growth ratio | final_year / first_year >= 1.3 | SC-003 |
| INV-003: Holiday dip | week 52 PR count <= 60% of year average | SC-008 |
| INV-004: Idle repo-weeks | >= 20% of possible repo-weeks have 0 PRs | SC-004 |
| INV-005: Team affinity | >= 60% of each team's PRs in primary repos | SC-009 |
| INV-006: Cycle time ratio | utility median / data-ML median <= 0.5 | FR-008 |
| INV-007: Determinism | two runs with same seed produce byte-identical output | SC-006 |

## Relationships

```text
WeeklyRollup
├── by_repository: { repo_name -> BreakdownEntry }
├── by_team: { team_name -> BreakdownEntry }
└── by_team_and_repo: { team_name -> { repo_name -> BreakdownEntry } }
         │                              │
         │  Contract 4 invariant:       │
         │  sum(repo.pr_count) ==       │
         │  by_team[team].pr_count      │
         │                              │
         └──────────────────────────────┘

DatasetManifest
├── aggregates_schema_version: 2 (from aggregators.py)
├── features.cross_dimensional: true
└── aggregate_index.weekly_rollups: [ { week, path, pr_count } ]
```

## Validation Rules

1. **Contract 3 (Cycle Time Threshold)**: At every level (rollup, repo, team, team-repo), if `pr_count < 5` then `cycle_time_p50 == null && cycle_time_p90 == null`. No exceptions.

2. **Contract 4 (Cross-Dim Completeness)**: For each team in `by_team` with `pr_count >= 1`:
   - `by_team_and_repo[team]` must exist
   - Every repo where that team had >= 1 PR must have an entry
   - `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count`

3. **FR-016 (Author/Reviewer Caps)**:
   - At team level: `authors_count <= team.member_count` and `reviewers_count <= team.member_count`
   - At team-repo level: `authors_count <= by_team[team].authors_count` and `reviewers_count <= by_team[team].reviewers_count`
   - Contributors in multiple repos counted once at team level (unique)

4. **Schema Completeness (Contract 1)**: Generated rollups must contain all non-deprecated fields from `KNOWN_ROOT_FIELDS` in `rollup.schema.ts`.
