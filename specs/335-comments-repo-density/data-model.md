# Data Model: Dashboard per-repo comment density breakdown

**Feature**: 335-comments-repo-density
**Phase**: 1 (design)
**Created**: 2026-04-28

## §1 Existing entities (referenced, not modified)

### Pull Request (`pull_requests` table)
Existing per Feature 058. Per-PR record with `pull_request_uid` primary key, `repository_id` foreign-keyed to `repositories(repository_id)`, plus `comments_extracted_at: TIMESTAMP | NULL`. The FK constraint at `src/ado_git_repo_insights/persistence/models.py` `pull_requests` table (`FOREIGN KEY (repository_id) REFERENCES repositories(repository_id)`) is the load-bearing invariant for CL-03's no-sentinel posture. Frozen — no schema changes.

### Repository (`repositories` table)
Existing per Feature 058. Per-repo record with `repository_id` primary key + `repository_name` field. Read by the renderer (via the `repositories` dimension entry in `dimensions.json`) for display label resolution per CL-04 / FR-4-11. Frozen — no schema changes.

### Comment Thread (`pr_threads` table) / Comment (`pr_comments` table)
Existing per Feature 058. Read by the per-repo aggregator under C1's inclusion rules. Frozen.

### Capability flag — `capabilities.comments_metrics`
Existing per Feature 310 + 333. Boolean field on the manifest. Producer-side: emitted by `aggregators.py:_has_comments()` evaluation. Consumer-side: surfaced via `loader.getCapabilityState()?.commentsMetricsAvailable === true` from BOTH `DatasetLoader` and `AuthenticatedDatasetLoader` (memory: `feedback_dataset_loader_method_parity.md`). **Both the new aggregator emission AND the new chart rendering MUST be gated on this flag** (INV-3-01).

### Throughput per-repo breakdown (`rollup[W].by_repository`)
Existing per Feature 060 / earlier. Per-(week, repo) `BreakdownEntry` with throughput-only fields (`pr_count`, `cycle_time_p50/p90`, etc.). **NOT modified by this feature.** This feature emits a parallel `by_repository_comments` namespace with comments-density fields only; the existing `by_repository` namespace remains unchanged.

### Weekly Comments Aggregate (`rollup[W].comments`) — 333
Existing per Feature 333. Per-week sub-object with `thread_count` / `comment_count` / `active_thread_count` / `coverage_partial`. **NOT modified by this feature.** The cross-aggregate sum-coherence contract (FR-2-03) verifies this sibling matches `SUM_repo by_repository_comments[r]`.

### Per-Author Comments-Density Emission (`rollup[W].by_author_comments`) — 334
Existing per Feature 334 (PR #349 merged on main). **NOT modified by this feature.** This feature's emission is a parallel sibling at the same rollup-root scope, named `by_repository_comments`.

### PrRecord (per-PR drill-down field set) / Throughput Rollup
Existing. **NOT modified by this feature.** This feature ADDS one new optional sibling field at the rollup root: `by_repository_comments` (§2).

### `repositories` dimension (`dimensions.json` `repositories` array)
Existing. Loaded via `loader.loadDimensions()`. Each entry is `{ repository_id, repository_name, ... }`. Consumed by the dashboard's existing repository-filter typeahead (`dashboard.ts:1917-1920`) and PR-URL resolution (`throughput-drilldown.ts:72`). This feature READS the dimension for display label resolution per CL-04 — `dashboard.ts` passes `repositoriesDimension = currentDimensions?.repositories?.map((r) => ({ repository_id, repository_name }))` to the chart module. NOT modified.

## §2 New entity — Per-Repo Comments-Density Emission

**Path**: `rollup[W].by_repository_comments[<repository_id>]` (sibling of `by_repository`, `comments`, `by_author_comments` on the rollup root). Outer dict keys are `repository_id` strings; inner values are 4-field entries.

**Optionality**: outer dict (`by_repository_comments`) is present only when `capabilities.comments_metrics === true` AND W has a non-empty canonical throughput PR set. Absent entirely (key omitted) when capability-off OR when the canonical PR set is empty (FR-3-03 + FR-1-10 — 4 omission failure modes gated).

**Atomicity (INV-3-08)**: when the `by_repository_comments` key is present, EVERY entry in the outer dict MUST contain ALL four fields below. No partial entries — never `{}`-valued, never partial-fielded.

**Field declarations** (the parity-gate-NOT-parseable shape contract is in `contracts/per-repo-comments-density.md`):

| Field | Type | Required when entry exists | Computation |
|---|---|---|---|
| `thread_count` | `number` (non-null integer ≥ 0) | yes | Sum over W's extracted-subset of repository R's per-PR `thread_count` (C1-applied per FR-1-04). Unextracted PRs of R contribute zero (FR-1-05). |
| `comment_count` | `number` (non-null integer ≥ 0) | yes | Sum over W's extracted-subset of repository R's per-PR `comment_count` (C1-applied). Unextracted PRs of R contribute zero. |
| `active_thread_count` | `number` (non-null integer ≥ 0) | yes | Sum over W's extracted-subset of repository R's per-PR `active_thread_count` (C1-applied). Unextracted PRs of R contribute zero. |
| `coverage_partial` | `boolean` | yes | `true` iff at least one of repository R's PRs in W's canonical throughput PR set has `comments_extracted_at IS NULL`. No threshold — even one such PR triggers `true` (FR-1-06). |

**Key (outer dict)**: the `pull_requests.repository_id` value. NO sentinel literal — `repository_id` is FK-protected per CL-03 / FR-1-03 / INV-3-12. FK-violation production-data edge is FAIL-LOUD per CL-03 (plan-level wiring decision in tasks).

**Set definitions** (per FR-1-05 / FR-1-09):

- **W's canonical throughput PR set** = the FULL set of `pull_request_uid` values the throughput aggregator attributes to week W (using throughput's week-attribution rule — same `closed_date → ISO-week` formula). NOT the drill-down's top-500-by-cycle-time slice.
- **W's extracted-subset (per repository R)** = subset of W's canonical PR set whose `repository_id == R` AND whose `pull_requests.comments_extracted_at IS NOT NULL`.

**Validation rules**:

- INV-3-07: `active_thread_count <= thread_count` per entry.
- INV-3-08: schema-level atomicity — validator MUST treat partial entries as a violation. Either all four fields present per entry or the entire entry absent (and if all entries are absent for W, the outer `by_repository_comments` key for W MUST also be absent — never `{}`).
- INV-3-09 (capability-off byte-identity): when `capabilities.comments_metrics === false`, the entire `by_repository_comments` key MUST be absent. NOT present, NOT `null`-valued, NOT `{}`-valued, NOT present-with-partial-entries (FR-3-03 — 4 omission failure modes).
- INV-3-12 (no sentinel — FK protection): the outer dict key set is the set of `repository_id` values of PRs in W's canonical set; no reserved-literal entries.

**Cross-feature relationships**:

- **Per-PR ↔ per-(week, repo)** (FR-2-01): for every PR P in the drill-down's top-500 slice for W AND in W's extracted-subset, the per-PR drill-down value for P equals P's per-PR contribution to the corresponding numeric field of `rollup[W].by_repository_comments[P.repository_id]`.
- **Per-(week, repo) ↔ direct SQL** (FR-2-02): for each (W, repo) tuple, the aggregator's emission equals an independent re-computation grouped by `pull_requests.repository_id` against direct SQL on `pull_requests` + `pr_threads` + `pr_comments` (no LEFT JOIN `repositories` needed — FK guarantees the value).
- **Per-week sum-coherence** (FR-2-03 — NEW for this feature): for each W where both `comments` and `by_repository_comments` are emitted (non-empty), `SUM_repo by_repository_comments[r].numeric_field` EQUALS `comments.numeric_field` for each of the three numeric fields, AND `OR_repo by_repository_comments[r].coverage_partial` EQUALS `comments.coverage_partial`. Holds on truncated weeks (`_prs_truncated: true`) because both aggregates compute over W's full canonical extracted-subset, not the drill-down slice.

## §3 State transitions / lifecycle

**Aggregator emission lifecycle** (per rollup file generation):

1. `_generate_weekly_rollups()` enters per-week emission for week W.
2. `_has_comments()` evaluated → if `false`, emit rollup WITHOUT the `by_repository_comments` key. STOP.
3. If `true`:
   a. Determine W's canonical throughput PR set using throughput's week-attribution rule.
   b. For each PR P in W's canonical set: read `P.repository_id` directly (no LEFT JOIN `users`-style logic — repository_id is FK-protected).
   c. Group PRs by `repository_id`; for each bucket: filter to W's extracted-subset (PRs with `comments_extracted_at IS NOT NULL`); query `pr_threads` / `pr_comments` per PR with C1 inclusion rules applied; sum per-PR contributions to produce integer `thread_count`, `comment_count`, `active_thread_count`.
   d. For each bucket: compute `coverage_partial = (∃ PR by repository R in W's canonical set with comments_extracted_at IS NULL)` — boolean. Each bucket has its OWN `coverage_partial` flag.
   e. Build the dict `{repository_id: { thread_count, comment_count, active_thread_count, coverage_partial }, ...}`; emit on rollup root as `by_repository_comments`. If the dict is empty (no PRs in W's canonical set), DO NOT emit the key (consistent with FR-1-10 / FR-3-03).
   f. **FK-violation FAIL-LOUD**: if any PR in W's canonical set carries a `repository_id` value missing from the `repositories` table at aggregation time, the aggregator MUST surface the violation per CL-03 — plan-level wiring decision (raise vs. structured warning at build-time gate). The `dimensions.json` snapshot validation step is the natural seat; tasks pin the exact mechanism.

**Renderer consumption lifecycle** (per chart render):

1. `comments-repository-density.ts` reads `rollup[W].by_repository_comments` for each week in the visible date range.
2. If `by_repository_comments` key absent → SKIP that week (capability-off OR empty canonical set). The dashboard-level capability gate (FR-3-01) ensures the chart container itself doesn't render when capability-off; this branch is for forward-compat / mid-range gaps.
3. If present: reduce per-repo across the visible weeks:
   - For each repository R appearing in any week's `by_repository_comments`: sum `thread_count`, `comment_count`, `active_thread_count` across W's where R appears.
   - `coverage_partial` reduction: range-total `coverage_partial[R]` is `true` iff any constituent week's per-(week, R) `coverage_partial` is `true` (FR-1-06 reduction rule).
4. Sort the resulting per-repo rows by chosen metric (default `comment_count` desc); secondary sort by repository display name asc; tertiary sort by `repository_id` asc as the final deterministic tie-breaker (handles duplicate display names from rename or fallback collisions per FR-4-05).
5. Truncate to top-50 (`MAX_COMMENTS_REPO_DENSITY_ROWS = 50`); render truncation indicator if more repositories with non-zero contributions exist (FR-4-06).
6. Render rows: each row shows repository display label (`repositoriesDimension.get(repository_id)?.repository_name ?? repository_id` per CL-04 / FR-4-11) + 3 numeric metrics. If the row's `coverage_partial` is `true`, apply the partial-coverage qualifier (hatched + dimmed via existing `.coverage-partial` CSS class hook).
7. If filters are active: short-circuit at the top of render — show filter-not-supported empty state (FR-4-07).
8. If no repositories in range yield non-zero contributions: short-circuit — show no-data-in-range empty state (FR-4-08).

## §4 Demo dataset interaction

The demo dataset (managed at `docs/data/`, regenerated via `scripts/build-demo-dataset.py` per memory `feedback_managed_artifacts_excludes_demo_data.md`) has two variants:

- **Capability-on demo** (`comments_metrics: true`): every week's rollup emits `by_repository_comments` with one entry per repository with at least one PR in the canonical set that week.
- **Capability-off demo** (`comments_metrics: false`): no week's rollup emits the `by_repository_comments` key. Byte-identity test gates this (FR-3-03).

Per A-03, the demo MUST contain ≥10 distinct repositories with mixed comment-load (US1 acceptance) and at least one repository with mixed extraction so the per-row `coverage_partial` qualifier (FR-4-03) is exercised. Per A-11, at least one truncated week (`_prs_truncated: true`) MUST be present so FR-2-03 sum-coherence has a witness; the test discovers the truncated week dynamically rather than hard-coding W26.

## §5 Test entities (informational — pinned at task time)

- `tests/unit/test_aggregators_repo_comments.py` — new producer unit tests (FR-1-* cases i–vii).
- `tests/integration/test_comments_trend_reconciliation.py` — extended in-place per CL-05 with per-repo parity (FR-2-01 / FR-2-02) AND the new cross-aggregate sum-coherence assertion (FR-2-03).
- `tests/integration/test_comments_trend_meta_failure.py` — extended with two injections (per-repo INV-3-07 violation + per-week sum-coherence violation per FR-2-05).
- `tests/integration/test_demo_variants_byte_identity.py` — extended `_GATED_*` set per FR-3-03 (4 omission failure modes for `by_repository_comments` key).
- `extension/tests/schema/rollup.test.ts` — extended schema validator tests for the new outer dict.
- `extension/tests/modules/charts/comments-repository-density.test.ts` — new chart unit tests (FR-4-01..11, including FR-4-11 raw-ID fallback).
- `extension/tests/dashboard/comments-repository-density-lifecycle.test.ts` — new lifecycle parity tests (FR-3-02 — initial-off / on→off / off→on / on→on idempotency).
- `extension/tests/artifact-client.test.ts` — extended F3 live-loader regression for `by_repository_comments` (FR-3-04).
