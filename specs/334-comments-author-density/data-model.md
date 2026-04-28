# Data Model: Dashboard per-author comment density breakdown

**Feature**: 334-comments-author-density
**Phase**: 1 (design)
**Created**: 2026-04-27

## §1 Existing entities (referenced, not modified)

### Pull Request (`pull_requests` table)
- Existing per Feature 058. Per-PR record with `pull_request_uid` primary key, plus the `comments_extracted_at: TIMESTAMP | NULL` column that this feature reads to determine the per-(week, author) extracted-subset and the per-(week, author) `coverage_partial` value. Frozen — no schema changes.

### Comment Thread (`pr_threads` table)
- Existing per Feature 058. Per-PR thread record with `status` ∈ {`active`, `fixed`, `wontFix`, `closed`, `byDesign`, `pending`, `unknown`} and `is_deleted` flag. Read by the per-author aggregator under C1's inclusion rules (per `specs/310-comments-visualization/spec.md` "Shared inclusion-rule contract (C1)"). Frozen.

### Comment (`pr_comments` table)
- Existing per Feature 058. Per-thread comment record with `comment_type` (including `system`), `is_deleted`, `author_id`. Read by the per-author aggregator under C1. Frozen.

### User (`users` table)
- Existing. Referenced by `pr_comments.author_id` and the throughput author identifier (`pull_requests.created_by_user_id` or equivalent). The per-author aggregator performs a LEFT JOIN against `users` to detect authors absent from the table; absent authors are bucketed under the sentinel literal per FR-1-03 / CL-03. Frozen.

### Capability flag — `capabilities.comments_metrics`
- Existing per Feature 310 + Feature 333. Boolean field on the manifest. Producer-side: emitted by `aggregators.py:_has_comments()` evaluation. **Both the new aggregator emission AND the new chart rendering MUST be gated on this flag** (INV-2-01).

### Throughput per-author breakdown (`rollup[W].by_author`)
- Existing per Feature 060 / earlier. Per-(week, author) `BreakdownEntry` with throughput-only fields (`pr_count`, `cycle_time_p50/p90`, `review_time_p50/p90`, `authors_count`, `reviewers_count`). **NOT modified by this feature.** This feature emits a parallel `by_author_comments` namespace with comments-density fields only; the existing `by_author` namespace remains unchanged in either capability state.

### Weekly Comments Aggregate (`rollup[W].comments`)
- Existing per Feature 333. Per-week sub-object on rollup root with `thread_count` / `comment_count` / `active_thread_count` / `coverage_partial`. Locked by 333's reconciliation contract (FR-2-04 / SC-05 closure). **NOT modified by this feature.** This feature emits a per-(week, author) sibling namespace at the same rollup-root scope.

### PrRecord (per-PR drill-down field set)
- Existing per Feature 310 + Feature 060. Lives at `extension/ui/schemas/rollup.schema.ts` `PrRecord` interface. Locked by 310's schema-parity gate. **NOT modified by this feature.**

### Throughput Rollup (existing weekly emission)
- Existing per Feature 060 + earlier. Emitted per week to `docs/data/aggregates/weekly_rollups/YYYY-Www.json` by `aggregators.py:_generate_weekly_rollups()`. Already carries fields like `pr_count`, `cycle_time_p50`, `cycle_time_p90`, `by_repository`, `by_author`, `by_team`, `by_reviewer`, `by_author_and_repo`, `by_team_and_repo`, `prs[]` (per-PR records, tenant-only), `comments` (per Feature 333). **This feature ADDS one new optional sibling field at the rollup root: the `by_author_comments` sub-object (§2).**

## §2 New entity — Per-Author Comments-Density Emission

**Path**: `rollup[W].by_author_comments[<author_id>]` (sibling of `by_author`, `comments`, etc. on the rollup root). Outer dict keys are `author_id` strings (or the reserved sentinel literal); inner values are 4-field entries.

**Optionality**: outer dict (`by_author_comments`) is present only when `capabilities.comments_metrics === true`. Absent entirely (key omitted) when capability-off (FR-3-03 — 4 omission failure modes gated).

**Atomicity (INV-2-08)**: when the `by_author_comments` key is present, EVERY entry in the sub-dict (including the sentinel-bucket entry) MUST contain ALL four fields below. No partial entries — never `{}`-valued, never partial-fielded.

**Field declarations** (the parity-gate-NOT-parseable shape contract is in `contracts/per-author-comments-density.md`):

| Field | Type | Required when entry exists | Computation |
|---|---|---|---|
| `thread_count` | `number` (non-null integer ≥ 0) | yes | Sum over W's extracted-subset of author A's per-PR `thread_count` (C1-applied per FR-1-04). Unextracted PRs of A contribute zero (FR-1-05). |
| `comment_count` | `number` (non-null integer ≥ 0) | yes | Sum over W's extracted-subset of author A's per-PR `comment_count` (C1-applied). Unextracted PRs of A contribute zero. |
| `active_thread_count` | `number` (non-null integer ≥ 0) | yes | Sum over W's extracted-subset of author A's per-PR `active_thread_count` (C1-applied). Unextracted PRs of A contribute zero. |
| `coverage_partial` | `boolean` | yes | `true` iff at least one of author A's PRs in W's canonical throughput PR set has `comments_extracted_at IS NULL`. No threshold — even one such PR triggers `true` (FR-1-06). |

**Key (outer dict)**:
- For real authors (present in `users` table): the author's identifier — same value used in the existing throughput `by_author` namespace (`pull_requests.created_by_user_id` or equivalent; pinned in tasks against the actual aggregator code).
- For unknown-to-`users` authors: the reserved sentinel literal `__former_or_unavailable_author__`. ALL such authors (across all unknown-to-`users` PRs in W) collapse into ONE entry per W (FR-1-03 / CL-03).

**Set definitions** (per FR-1-05):

- **W's canonical throughput PR set** = the set of `pull_request_uid` values the throughput aggregator attributes to week W (using throughput's week-attribution rule — re-implemented per ADR T005 with per-PR parity guard).
- **W's extracted-subset** (per author A) = subset of W's canonical throughput PR set whose author is A AND whose `pull_requests.comments_extracted_at IS NOT NULL`.

**Validation rules**:

- INV-2-07: `active_thread_count <= thread_count` per entry (a subset relationship — propagation of 310 INV-09 / 333 INV-1-06 to per-author scope).
- INV-2-08: schema-level atomicity — validator MUST treat partial entries as a violation. Either all four fields present per entry or the entire entry absent (and if all entries are absent, the outer `by_author_comments` key MUST also be absent — never `{}`).
- INV-2-09 (capability-off byte-identity): when `capabilities.comments_metrics === false`, the entire `by_author_comments` key MUST be absent. NOT present, NOT `null`-valued, NOT `{}`-valued (empty object), NOT present-with-partial-entries (FR-3-03 — 4 omission failure modes).

**Cross-feature relationship**:

- The per-PR `thread_count` / `comment_count` / `active_thread_count` fields on PrRecord (310 contract), the per-week `rollup[W].comments.{thread_count, comment_count, active_thread_count}` fields (333 contract), and the per-(week, author) `rollup[W].by_author_comments[<author_id>].{thread_count, comment_count, active_thread_count}` fields (this feature) are RELATED via FR-2-01:
  - For every PR P in the drill-down's top-500-by-cycle-time slice for W AND in W's extracted-subset, the per-PR drill-down value for P equals P's per-PR contribution to the corresponding numeric field of `rollup[W].by_author_comments[author_of_P_or_sentinel]` as computed by the aggregator.
  - Sentinel parity: for each W, the sentinel bucket's value equals the SUM of contributions from ALL PRs in W's extracted-subset whose `author_id` is absent from `users` (FR-2-03).
  - The independent re-computation (FR-2-02) verifies this end-to-end against direct SQL against `pull_requests` + `pr_threads` + `pr_comments` + `users`.

## §3 State transitions / lifecycle

**Aggregator emission lifecycle** (per rollup file generation):

1. `_generate_weekly_rollups()` enters per-week emission for week W.
2. `_has_comments()` evaluated → if `false`, emit rollup WITHOUT the `by_author_comments` key. STOP for this feature's emission (333's `comments` and existing throughput `by_author` namespaces are unchanged here).
3. If `true`:
   a. Determine W's canonical throughput PR set using throughput's week-attribution rule (per ADR T005 — re-implemented same formula + per-PR parity guard).
   b. For each PR P in W's canonical set: lookup P's `author_id` in `users` table (LEFT JOIN). If present, use the author's identifier as the bucket key; if absent, use the reserved sentinel literal `__former_or_unavailable_author__`.
   c. Group PRs by bucket key; for each bucket: filter to W's extracted-subset (PRs with `comments_extracted_at IS NOT NULL`); query `pr_threads` / `pr_comments` per PR with C1 inclusion rules applied; sum per-PR contributions to produce integer `thread_count`, `comment_count`, `active_thread_count`.
   d. For each bucket: compute `coverage_partial = (∃ PR by author A in W's canonical set with comments_extracted_at IS NULL)` — boolean. Each bucket has its OWN `coverage_partial` flag, independent of other buckets in the same week.
   e. Build the dict `{author_or_sentinel: { thread_count, comment_count, active_thread_count, coverage_partial }, ...}`; emit on rollup root as `by_author_comments`. If the dict is empty (no authors with any extracted-subset contribution), DO NOT emit the `by_author_comments` key (consistent with FR-3-03 omission contract).

**Renderer consumption lifecycle** (per chart render):

1. `comments-author-density.ts` reads `rollup[W].by_author_comments` for each week in the visible date range.
2. If `by_author_comments` key absent → SKIP that week (capability flag must be off, OR no extracted-subset contribution). The capability-gate at the dashboard level (FR-3-01) ensures the chart container itself doesn't render when capability-off, so this branch is only for forward-compat / mid-range gaps.
3. If present: reduce per-author across the visible weeks:
   - For each author A appearing in any week's `by_author_comments`: sum `thread_count`, `comment_count`, `active_thread_count` across W's where A appears.
   - `coverage_partial` reduction: range-total `coverage_partial[A]` is `true` iff any constituent week's per-(week, A) `coverage_partial` is `true` (FR-1-06 reduction rule).
4. Sort the resulting per-author rows by chosen metric (default `comment_count` desc); secondary sort by author display name asc for ties; tertiary sort by author key asc as the final deterministic tie-breaker (handles duplicate display names + sentinel/real-name collisions per FR-4-05).
5. Truncate to top-50 (`MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50`); render truncation indicator if more authors with non-zero contributions exist (FR-4-06).
6. Render rows: each row shows author display name (or "Former / unavailable author" sentinel label per CL-03) + 3 numeric metrics. If the row's `coverage_partial` is `true`, apply the partial-coverage qualifier per ADR T004 (hatched + dimmed + tooltip).
7. If filters are active: short-circuit at the top of render — show filter-not-supported empty state (FR-4-07).
8. If no authors in range yield non-zero contributions: short-circuit — show no-data-in-range empty state (FR-4-08).

## §4 Demo dataset interaction

The demo dataset (managed at `docs/data/`, regenerated via `manage_generated_artifacts.py sync --scope all --stage`) has two variants:

- **Capability-on demo** (`comments_metrics: true`): every week's rollup emits `by_author_comments` with one entry per author who has at least one extracted-subset contribution that week. Sentinel bucket appears for weeks that include unknown-to-`users` authors.
- **Capability-off demo** (`comments_metrics: false`): no week's rollup emits the `by_author_comments` key. Byte-identity test gates this (FR-3-03).

Per A-03, the demo MUST contain ≥10 distinct authors with mixed comment-load (US1 acceptance), ≥1 unknown-to-`users` author with non-zero PRs (US4 sentinel acceptance), and at least one author with mixed extraction so the per-row `coverage_partial` qualifier (FR-4-03) is exercised. These fixture choices are tasks-level.

## §5 Test entities (informational — pinned at task time)

- `tests/unit/test_aggregators_author_comments.py` — new producer unit tests (FR-1-* cases i–vii).
- `tests/integration/test_comments_trend_reconciliation.py` — extended in-place per CL-04 with per-author parity (FR-2-01 / FR-2-02 / FR-2-03 / SC-1-06).
- `tests/integration/test_comments_trend_meta_failure.py` — extended with per-author INV-2-07 violation injection (FR-2-05).
- `tests/integration/test_demo_variants_byte_identity.py` — extended `_GATED_*` set per FR-3-03 (4 omission failure modes for `by_author_comments` key).
- `extension/tests/schema/rollup.test.ts` — extended schema validator tests for the new sub-object.
- `extension/tests/modules/charts/comments-author-density.test.ts` — new chart unit tests (FR-4-01..10).
- `extension/tests/dashboard/comments-author-density-lifecycle.test.ts` — new lifecycle parity tests (FR-3-02 — initial-off / on→off / off→on / on→on idempotency).
