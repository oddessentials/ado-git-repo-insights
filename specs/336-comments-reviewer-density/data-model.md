# Data Model: Dashboard per-reviewer comment density breakdown

**Feature**: 336-comments-reviewer-density
**Phase**: 1 (design)
**Created**: 2026-04-29

## §1 Existing entities (referenced, not modified)

### Pull Request (`pull_requests` table)
Existing per Feature 058. Per-PR record with `pull_request_uid` primary key, `user_id` field for the PR's author (used for self-comment exclusion per CL-04), plus `comments_extracted_at: TIMESTAMP | NULL`. The aggregator INNER JOINs this table on `pull_request_uid` for the self-comment-exclusion filter (`pr_comments.author_id != pull_requests.user_id` per FR-1-04). Frozen — no schema changes.

### Comment Thread (`pr_threads` table)
Existing per Feature 058. Per-(PR, thread) record with PRIMARY KEY `(pull_request_uid, thread_id)` at `models.py:151`, FK to `pull_requests(pull_request_uid)` at `models.py:152`. Carries `status TEXT` field (`'active'` / `'fixed'` / `'closed'` / etc.) at `models.py:146` used for the `active_thread_count` filter (FR-1-05). Carries `is_deleted INTEGER DEFAULT 0` for C1 inclusion. The aggregator LEFT JOINs this table for the active-thread filter when computing per-reviewer `active_thread_count`. Frozen.

### Comment (`pr_comments` table)
Existing per Feature 058. Per-comment record with composite PRIMARY KEY `(pull_request_uid, thread_id, comment_id)` at `models.py:169`, FK to `pr_threads(pull_request_uid, thread_id)` at `models.py:170`, FK to `pull_requests(pull_request_uid)` at `models.py:171`, FK to `users(user_id)` via `author_id` at `models.py:172`. Carries `is_deleted INTEGER DEFAULT 0` for C1 inclusion. INDEX `idx_pr_comments_thread` at `models.py:174` (composite `(pull_request_uid, thread_id)`) makes COUNT(DISTINCT thread_id) per commenter efficient; INDEX `idx_pr_comments_author` at `models.py:176` makes GROUP BY commenter efficient. The aggregator iterates `pr_comments` rows (NOT `pull_requests` rows) per CL-13 / INV-4-13. Frozen.

### User (`users` table)
Existing per Feature 058. Per-user record with `user_id` primary key + `display_name` field. Read by the renderer (via the `users` dimension entry in `dimensions.json`) for display label resolution per CL-05. Read by the aggregator via LEFT JOIN for sentinel detection per CL-03 / FR-1-03 (when `pr_comments.author_id` does NOT match a `users` row, the bucket key resolves to the SENTINEL literal). The FK constraint at `pr_comments.author_id` (`models.py:172`) makes missing-user the rare-edge case under FK-enforced production data; the sentinel branch is the by-design fallback for FK-disabled scenarios. Frozen — no schema changes.

### Capability flag — `capabilities.comments_metrics`
Existing per Feature 310 + 333. Boolean field on the manifest. Producer-side: emitted by `aggregators.py:_has_comments()` evaluation. Consumer-side: surfaced via `loader.getCapabilityState()?.commentsMetricsAvailable === true` from BOTH `DatasetLoader` and `AuthenticatedDatasetLoader` (memory: `feedback_dataset_loader_method_parity.md`). **Both the new aggregator emission AND the new chart rendering MUST be gated on this flag** (INV-4-01).

### Throughput per-reviewer breakdown (`rollup[W].by_reviewer`)
Existing per Feature 060 / earlier. Per-(week, reviewer) `ReviewerBreakdownEntry` with throughput-only fields (`pr_count`, etc.). **NOT modified by this feature.** This feature emits a parallel `by_reviewer_comments` namespace with comments-density fields only; the existing `by_reviewer` namespace remains unchanged.

### Weekly Comments Aggregate (`rollup[W].comments`) — 333
Existing per Feature 333. Per-week sub-object with `thread_count` / `comment_count` / `active_thread_count` / `coverage_partial`. **NOT modified by this feature.** The cross-aggregate parity contract (FR-2-03) verifies `OR_R(by_reviewer_comments[R].coverage_partial)` equals `comments.coverage_partial` (drift guard) but does NOT compare `SUM_R(comment_count)` to `comments.comment_count` (which would over-count by the self-comment delta).

### Per-Author Comments-Density Emission (`rollup[W].by_author_comments`) — 334
Existing per Feature 334 (PR #349 merged on main). **NOT modified by this feature.** This feature's emission is a parallel sibling at the same rollup-root scope, named `by_reviewer_comments`. The sentinel literal pattern + LEFT JOIN users SQL pattern is mirrored from #334.

### Per-Repo Comments-Density Emission (`rollup[W].by_repository_comments`) — 335
Existing per Feature 335 (PR #350 merged on main). **NOT modified by this feature.** This feature's emission is a parallel sibling at the same rollup-root scope. The all-zero-row filter pattern + week-agnostic truncation discovery pattern is mirrored from #335.

### PrRecord (per-PR drill-down field set) / Throughput Rollup
Existing. **NOT modified by this feature.** This feature ADDS one new optional sibling field at the rollup root: `by_reviewer_comments` (§2).

### `users` dimension (`dimensions.json` `users` array)
Existing. Loaded via `loader.loadDimensions()`. Each entry is `{ user_id, display_name, ... }`. Consumed by the dashboard's existing user-filter typeahead. This feature READS the dimension for display label resolution per CL-05 — `dashboard.ts` passes `usersDimension = currentDimensions?.users?.map((u) => ({ user_id, display_name }))` to the chart module. NOT modified.

### `FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL` constant
Existing per Feature 334 at `src/ado_git_repo_insights/transform/constants.py:27` — `Final[str] = "__former_or_unavailable_author__"`. Reused verbatim by this feature per CL-03. The literal's namespace safety (cannot collide with UUID-format `user_id` or `pr_comments.author_id` values) is asserted by `tests/unit/test_aggregators_author_comments.py:514` (`test_sentinel_literal_does_not_collide_with_real_author_ids`, T029 from #334). Per kickoff directive, this feature EXTENDS that test's assertion list to cover `pr_comments.author_id` UUIDs AS WELL — does NOT duplicate the test.

## §2 New entity — Per-Reviewer Comments-Density Emission

**Path**: `rollup[W].by_reviewer_comments[<commenter_id>]` (sibling of `by_reviewer`, `comments`, `by_author_comments`, `by_repository_comments` on the rollup root). Outer dict keys are commenter `user_id` strings OR the reserved sentinel literal `__former_or_unavailable_author__`; inner values are 4-field entries.

**Optionality**: outer dict (`by_reviewer_comments`) is present only when `capabilities.comments_metrics === true` AND W has a non-empty canonical throughput PR set AND at least one eligible-reviewer-comment row exists in W (a `pr_comments` row where `is_deleted = 0`, `pull_request_uid` is in the extracted-subset, and `author_id != pull_requests.user_id`). Absent entirely (key omitted) when capability-off OR when no eligible-reviewer-comment rows exist for W (FR-3-03 + FR-1-11 — 4 omission failure modes gated).

**Atomicity (INV-4-08)**: when the `by_reviewer_comments` key is present, EVERY entry in the outer dict (including the sentinel-bucket entry) MUST contain ALL four fields below. No partial entries — never `{}`-valued, never partial-fielded.

**Field declarations** (the parity-gate-NOT-parseable shape contract is in `contracts/per-reviewer-comments-density.md`):

| Field | Type | Required when entry exists | Computation |
|---|---|---|---|
| `thread_count` | `number` (non-null integer ≥ 0) | yes | COUNT(DISTINCT `thread_id`) per commenter R, where R has at least one row meeting `comment_count`'s filter (FR-1-05). **Distinct eligible threads with at least one non-self comment by R** — NOT raw row count. A thread where R commented N times contributes 1 to R's `thread_count`. |
| `comment_count` | `number` (non-null integer ≥ 0) | yes | COUNT of `pr_comments` rows where `author_id = R`, `pull_request_uid` ∈ W's extracted-subset, `author_id != pull_requests.user_id` (commenter ≠ PR author per CL-04), `is_deleted = 0` (C1). RAW ROW COUNT. |
| `active_thread_count` | `number` (non-null integer ≥ 0) | yes | COUNT(DISTINCT `thread_id`) where (i) R has at least one row meeting `comment_count`'s filter for that thread AND (ii) `pr_threads.status = 'active'` (FR-1-05). NOT raw row count. The active subset of `thread_count`. |
| `coverage_partial` | `boolean` | yes | `true` iff at least one PR in W's canonical throughput PR set has `comments_extracted_at IS NULL` (FR-1-07). **Same-W flag per CL-10** — every reviewer R emitted for W shares the same value, equal to `rollup[W].comments.coverage_partial` (333's flag). NOT bucket-specific. |

**Key (outer dict)**: the commenter's `pr_comments.author_id` value when present in `users`, OR the SENTINEL literal `__former_or_unavailable_author__` when absent (LEFT JOIN result is NULL on `users.user_id`). No raw NULL keys are emitted (defensive — the SQL CASE branch maps NULL to the sentinel literal).

**Set definitions** (per FR-1-04 / FR-1-06 / FR-1-10):

- **W's canonical throughput PR set** = the FULL set of `pull_request_uid` values the throughput aggregator attributes to week W (using throughput's week-attribution rule — same `closed_date → ISO-week` formula). NOT the drill-down's top-500-by-cycle-time slice.
- **W's extracted-subset** = subset of W's canonical PR set whose `pull_requests.comments_extracted_at IS NOT NULL`.
- **W's eligible-reviewer-comment rows** = rows in `pr_comments` where `pull_request_uid` ∈ W's extracted-subset AND `pr_comments.author_id != pull_requests.user_id` AND `pr_comments.is_deleted = 0`.

**Validation rules**:

- INV-4-07: `active_thread_count <= thread_count` per entry (the active subset cannot exceed the full distinct-thread set).
- INV-4-08: schema-level atomicity — validator MUST treat partial entries as a violation. Either all four fields present per entry or the entire entry absent (and if all entries are absent for W, the outer `by_reviewer_comments` key for W MUST also be absent — never `{}`).
- INV-4-09 (capability-off byte-identity): when `capabilities.comments_metrics === false`, the entire `by_reviewer_comments` key MUST be absent. NOT present, NOT `null`-valued, NOT `{}`-valued, NOT present-with-partial-entries (FR-3-03 — 4 omission failure modes).
- INV-4-12 (sentinel applies): the SENTINEL literal `__former_or_unavailable_author__` is a permitted outer-dict key. It represents the SINGLE bucket aggregating ALL eligible-reviewer-comment rows whose `pr_comments.author_id` is absent from `users`.

**Cross-feature relationships**:

- **Per-PR ↔ per-(week, reviewer)** (FR-2-01): for every PR P in the drill-down's top-500 slice for W AND in W's extracted-subset, P's per-PR drill-down `comment_count` value is coherent with P's distributed contribution to per-(week, reviewer) buckets per the comment_count-distribution rule in spec FR-2-01: `P.comment_count_drilldown - count_self_comments(P) == SUM_R(comment_count contribution from P)`. FR-2-01 does NOT assert `thread_count` or `active_thread_count` distribution coherence at the per-PR level — the "PR with mixed self-only and non-self threads" edge case in spec.md Edge Cases makes the per-PR bound non-closed-form for those metrics (P's self-only threads contribute to drill-down `thread_count` but 0 to any reviewer bucket, with no per-PR-recorded self-only-thread count to close the bound). FR-2-02's per-bucket independent re-computation covers thread_count / active_thread_count correctness.
- **Per-(week, reviewer) ↔ direct SQL** (FR-2-02): for each (W, reviewer) tuple, the aggregator's emission equals an independent re-computation grouped by commenter `pr_comments.author_id` against direct SQL on `pr_comments` + `pull_requests` (INNER JOIN for self-comment exclusion) + `pr_threads` (LEFT JOIN for active filter) + `users` (LEFT JOIN for sentinel detection).
- **Per-week sum-coherence vs INDEPENDENT count** (FR-2-03 — NEW shape for this feature): for each W where both `comments` and `by_reviewer_comments` are emitted (non-empty), `SUM_R(by_reviewer_comments[R].comment_count)` EQUALS the count of eligible-reviewer-comment rows in W (computed INDEPENDENTLY by direct SQL). NOT vs `comments.comment_count` (which over-counts by self-comment delta). `thread_count` / `active_thread_count` sum NOT asserted (multi-counting; FR-2-02 covers per-bucket correctness). `OR_R(coverage_partial)` EQUALS `comments.coverage_partial` (drift guard against CL-10 same-W lock breakage).

## §3 New entities (demo-internal — NOT serialized)

Per CL-14, the demo generator gains two new internal per-week parallel lists alongside `synthetic_prs_full`. These are consumed only by the new demo aggregator helper `_aggregate_by_reviewer_comments_for_week()`; they are NOT serialized to rollup files (privacy posture; only the aggregated `by_reviewer_comments` keys ship in `docs/data/aggregates/weekly_rollups/*.json`).

### `synthetic_pr_threads` (demo-internal)

```python
class SyntheticPrThread(TypedDict):
    pull_request_uid: str
    thread_id: str
    status: str           # "active" or "fixed" (or other non-active value)
    is_deleted: int       # always 0 per C1
```

**Generation rule** (per CL-14 step 1 / ADR R002): for each PR P with non-NULL `thread_count`, emit `P.thread_count` synthetic thread records. Mark `P.active_thread_count` of them with `status='active'` (chosen deterministically by sorted `thread_id`). Remaining threads get `status='fixed'`. All threads have `is_deleted=0`.

### `synthetic_pr_comments` (demo-internal)

```python
class SyntheticPrComment(TypedDict):
    pull_request_uid: str
    thread_id: str        # FK to synthetic_pr_threads
    author_id: str        # commenter UUID; NEVER == PR's author_id
    is_deleted: int       # always 0 per C1
```

**Generation rule** (per CL-14 step 2 / ADR R002): for each PR P with non-NULL `comment_count`, emit `P.comment_count` synthetic comment records distributed across P's threads such that each thread has ≥1 comment. Sample `author_id` deterministically from `author_pool` (excluding P's `author_id`); use the existing `init_random` seed for reproducibility. ≥1 demo week MUST sample from a synthetic ghost pool (UUIDs absent from seeded `users`) so the per-reviewer sentinel reconciliation branch is exercised non-vacuously.

**Precondition (per CL-14 + Codex stop-time review fix)**: PrRecord shapes consumed by the synthesizer MUST satisfy `comment_count > 0 ⇒ thread_count > 0`. The demo generator at `scripts/generate-demo-data.py:486-493` enforces this by setting `comment_count = 0` when `thread_count = 0` (the historical "drive-by system comments" abstraction is dropped because it violated the production schema FK at `models.py:170`). The synthesizer relies on this precondition to avoid the unsatisfiable `(thread_count=0, comment_count>0)` case; it MUST NOT special-case PrRecord shapes that violate the precondition (instead, the demo generator's PrRecord-construction loop is the single seat for the production-schema invariant).

**Coherence guard** (per CL-14 step 3 / A-12): for every PR P, re-aggregating both lists MUST yield P's pre-existing PrRecord aggregate counts:
- `len([t for t in synthetic_pr_threads if t.pull_request_uid == P.pull_request_uid])` == `P.thread_count`
- `len([t for t in synthetic_pr_threads if t.pull_request_uid == P.pull_request_uid and t.status == 'active'])` == `P.active_thread_count`
- `len([c for c in synthetic_pr_comments if c.pull_request_uid == P.pull_request_uid])` == `P.comment_count`
- Every thread in `synthetic_pr_threads` has ≥1 comment in `synthetic_pr_comments` (no orphan threads)
- Every commenter `author_id` in `synthetic_pr_comments` ≠ corresponding PR's `author_id` (self-comment exclusion enforced at synthesis time per CL-04)

A unit test at `tests/unit/test_demo_synthetic_pr_comments.py` asserts the coherence guard.

## §4 State transitions / lifecycle

**Aggregator emission lifecycle** (per rollup file generation):

1. `_generate_weekly_rollups()` enters per-week emission for week W.
2. `_has_comments()` evaluated → if `false`, emit rollup WITHOUT the `by_reviewer_comments` key. STOP.
3. If `true`:
   a. Determine W's canonical throughput PR set using throughput's week-attribution rule.
   b. For each `pr_comments` row whose `pull_request_uid` is in W's canonical extracted-subset AND `is_deleted = 0`:
      - INNER JOIN `pull_requests` on `pull_request_uid` for the PR's `user_id` (PR author).
      - Filter out rows where `pr_comments.author_id == pull_requests.user_id` (self-comments per CL-04).
      - LEFT JOIN `users` on `pr_comments.author_id = users.user_id` for sentinel detection per CL-03.
      - LEFT JOIN `pr_threads` on `(pull_request_uid, thread_id)` for the `status` field.
      - FAIL-LOUD per FR-1-12 / CL-15 if `pr_comments.author_id` is NULL or non-UUID-format.
   c. Group rows by bucket key (commenter `user_id` if present in `users`, else SENTINEL literal).
   d. For each bucket: compute `comment_count` (raw row count), `thread_count` (COUNT(DISTINCT thread_id)), `active_thread_count` (COUNT(DISTINCT thread_id) where pr_threads.status='active').
   e. For each bucket: compute `coverage_partial` = (∃ PR in W's canonical throughput PR set with `comments_extracted_at IS NULL`) — same-W flag per CL-10. Every bucket in W has the SAME `coverage_partial` value, equal to `rollup[W].comments.coverage_partial`.
   f. Build the dict `{commenter_or_sentinel: { thread_count, comment_count, active_thread_count, coverage_partial }, ...}`; emit on rollup root as `by_reviewer_comments`. If the dict is empty (no eligible-reviewer-comment rows in W's extracted-subset), DO NOT emit the key (consistent with FR-1-11 / FR-3-03).

**Renderer consumption lifecycle** (per chart render):

1. `comments-reviewer-density.ts` reads `rollup[W].by_reviewer_comments` for each week in the visible date range.
2. If `by_reviewer_comments` key absent → SKIP that week (capability-off OR empty eligible-reviewer-comment set). The dashboard-level capability gate (FR-3-01) ensures the chart container itself doesn't render when capability-off; this branch is for forward-compat / mid-range gaps.
3. If present: reduce per-reviewer across the visible weeks:
   - For each commenter R appearing in any week's `by_reviewer_comments`: sum `thread_count`, `comment_count`, `active_thread_count` across W's where R appears. (Note: summing thread_count this way is multi-counting at the cross-week level — a thread where R commented in W1 and again in W2 contributes 1 to W1's thread_count AND 1 to W2's thread_count, hence 2 to the range total; this is intentional because the per-week DISTINCT thread count is correct, and multi-week aggregation is the user-facing range-total semantic.)
   - `coverage_partial` reduction: range-total `coverage_partial[R]` is `true` iff any constituent week's per-(week, R) `coverage_partial` is `true`.
4. **All-zero filter BEFORE sort/truncate** (FR-4-02 critical per kickoff lesson): exclude rows where `thread_count == 0 AND comment_count == 0 AND active_thread_count == 0`. Run this filter BEFORE the sort step AND BEFORE the top-50 cap.
5. Sort the resulting per-reviewer rows by chosen metric (default `comment_count` desc); secondary sort by reviewer display name asc; tertiary sort by bucket key asc as the final deterministic tie-breaker (handles duplicate display names AND sentinel/real-name collisions per FR-4-05 / CL-05).
6. Truncate to top-50 (`MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50`); render truncation indicator if more reviewers with non-zero contributions exist (FR-4-06).
7. Render rows: each row shows reviewer display label per CL-05 lookup precedence (sentinel branch → users-dimension lookup → raw `user_id` fallback) + 3 numeric metrics. If the row's `coverage_partial` is `true`, apply the partial-coverage qualifier (hatched + dimmed via existing `.coverage-partial` CSS class hook) with tooltip text emphasizing **week-level** uncertainty per CL-10 directive.
8. If filters are active: short-circuit at the top of render — show filter-not-supported empty state (FR-4-07).
9. If no reviewers in range yield non-zero contributions: short-circuit — show no-data-in-range empty state (FR-4-08).

## §5 Demo dataset interaction

The demo dataset (managed at `docs/data/`, regenerated via `scripts/build-demo-dataset.py` per memory `feedback_managed_artifacts_excludes_demo_data.md`) has two variants:

- **Capability-on demo** (`comments_metrics: true`): every week's rollup emits `by_reviewer_comments` with one entry per commenter with at least one eligible-reviewer-comment row that week. The synthetic streams `synthetic_pr_threads` + `synthetic_pr_comments` are populated per CL-14 and consumed by `_aggregate_by_reviewer_comments_for_week()` to produce the emitted `by_reviewer_comments` dict.
- **Capability-off demo** (`comments_metrics: false`): no week's rollup emits the `by_reviewer_comments` key. Byte-identity test gates this (FR-3-03).

Per A-03, the demo MUST contain ≥10 distinct commenters with mixed comment-load on PRs they didn't author (US1 acceptance), at least one week with mixed extraction so the per-row `coverage_partial` qualifier (FR-4-03) is exercised, AND ≥1 week with synthetic ghost commenters for US4 sentinel exercise (per CL-14 step 4). Per A-11, at least one truncated week (`_prs_truncated: true`) MUST be present so FR-2-03 parity-vs-INDEPENDENT-count has a witness; the test discovers the truncated week dynamically rather than hard-coding W26.

## §6 Test entities (informational — pinned at task time)

- `tests/unit/test_aggregators_reviewer_comments.py` — new producer unit tests (FR-1-* cases i–xiv).
- `tests/unit/test_demo_synthetic_pr_comments.py` — NEW demo coherence guard test per CL-14 step 3 / A-12 / ADR R005. Re-aggregates the new synthetic streams per PR; asserts equality with PrRecord aggregate counts. The FIRST test written in Phase 2 (T004) per ADR R005.
- `tests/integration/test_comments_trend_reconciliation.py` — extended in-place per CL-06 with per-reviewer parity (FR-2-01 / FR-2-02) AND the new cross-aggregate parity-vs-INDEPENDENT-count assertion (FR-2-03).
- `tests/integration/test_comments_trend_meta_failure.py` — extended with three injections (per-reviewer INV-4-07 violation + per-week sum-coherence violation + self-comment-leak violation per FR-2-05 / ADR R004).
- `tests/integration/test_demo_variants_byte_identity.py` — extended `_GATED_*` set per FR-3-03 (4 omission failure modes for `by_reviewer_comments` key).
- `tests/unit/test_aggregators_author_comments.py:514` — EXTENDED (NOT duplicated) per kickoff directive: the existing `test_sentinel_literal_does_not_collide_with_real_author_ids` (T029 from #334) widens its assertion list to ALSO cover `pr_comments.author_id` UUIDs.
- `extension/tests/schema/rollup.test.ts` — extended schema validator tests for the new outer dict.
- `extension/tests/modules/charts/comments-reviewer-density.test.ts` — new chart unit tests (FR-4-01..12, including FR-4-11 raw-`user_id` fallback + FR-4-12 sentinel rendering + non-vacuous sort fixture + exhaustive empty-state markers per A-13/A-14/A-15 kickoff lessons).
- `extension/tests/dashboard/comments-reviewer-density-lifecycle.test.ts` — new lifecycle parity tests (FR-3-02 — initial-off / on→off / off→on / on→on idempotency; source-parse binding per A-13).
- `extension/tests/artifact-client.test.ts` — extended F3 live-loader regression for `by_reviewer_comments` (FR-3-04).
