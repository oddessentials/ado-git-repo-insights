# Contract: Per-reviewer comments-density emission (Feature 336)

**Scope**: producer (`src/ado_git_repo_insights/transform/aggregators.py`) + consumer (`extension/ui/schemas/rollup.schema.ts`, `extension/ui/modules/charts/comments-reviewer-density.ts`).

**Authoritative spec refs**: [spec.md](../spec.md) — FR-1-01..FR-1-12, FR-2-01..FR-2-05, FR-3-01..FR-3-04, FR-4-01..FR-4-12, INV-4-01..INV-4-13, SC-1-01..SC-1-07. Sibling foundations: [`specs/333-comments-trend-chart/contracts/weekly-comments-aggregate.md`](../../333-comments-trend-chart/contracts/weekly-comments-aggregate.md), [`specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md`](../../333-comments-trend-chart/contracts/sc05-reconciliation-test.md), [`specs/334-comments-author-density/contracts/per-author-comments-density.md`](../../334-comments-author-density/contracts/per-author-comments-density.md), [`specs/335-comments-repo-density/contracts/per-repo-comments-density.md`](../../335-comments-repo-density/contracts/per-repo-comments-density.md).

**Inclusion rules**: the C1 inclusion rules that govern the underlying `pr_comments` row inclusion are defined ONCE in [`specs/310-comments-visualization/spec.md`](../../310-comments-visualization/spec.md) "Shared inclusion-rule contract (C1)". The C2 reviewer-semantics contract (commenter ≠ PR author) is defined ONCE at the same authoritative site under "Reviewer activity (C2)". This contract REFERENCES them; it does NOT re-declare (INV-4-03).

**Schema-parity gate scope**: this contract is **NOT** parsed by `scripts/check_pr_record_schema_parity.py` (per CL-09 + spec Out of Scope). Per-reviewer comments-density parity is enforced by the SC-05 reconciliation test extension (FR-2-04, see §4) AND the cross-aggregate parity-vs-INDEPENDENT-count assertion (FR-2-03, see §6).

---

## §1 Canonical field declaration

The `by_reviewer_comments` outer dict lives at the rollup root: `rollup[W].by_reviewer_comments`. Outer dict keys are commenter `user_id` strings OR the reserved sentinel literal `__former_or_unavailable_author__` (per CL-03 / FR-1-03 / INV-4-12 — sentinel applies, divergence from #335's no-sentinel posture). Inner values are 4-field entries. Optional at the rollup root level; atomic per entry when present (INV-4-08).

| Field | Python type (aggregator emission) | TypeScript type (schema declaration) | Required when entry exists | Computation reference |
|---|---|---|---|---|
| `thread_count` | `int` | `number` | yes | FR-1-05 — COUNT(DISTINCT thread_id) per commenter R: distinct eligible threads with at least one non-self comment by R. NOT raw row count. |
| `comment_count` | `int` | `number` | yes | FR-1-05 — RAW row count of `pr_comments` rows where `author_id = R`, `pull_request_uid` ∈ W's extracted-subset, commenter ≠ PR author, `is_deleted = 0`. |
| `active_thread_count` | `int` | `number` | yes | FR-1-05 — COUNT(DISTINCT thread_id) where R has ≥1 row meeting comment_count's filter for that thread AND `pr_threads.status = 'active'`. The active subset of thread_count. |
| `coverage_partial` | `bool` | `boolean` | yes | FR-1-07 (same-W flag per CL-10) — `true` iff at least one PR in W's canonical throughput PR set has `comments_extracted_at IS NULL`. Every reviewer in W shares the same value, equal to `rollup[W].comments.coverage_partial`. NOT bucket-specific. |

**Type compatibility**:

- All three numeric fields MUST be `int` Python ↔ `number` TypeScript (non-null on both sides; integer constraint enforced at validator level).
- The boolean MUST be `bool` Python ↔ `boolean` TypeScript.
- The wrapping outer dict (`by_reviewer_comments`) is OPTIONAL at the rollup root (`by_reviewer_comments?: Record<string, ReviewerCommentsDensityEntry>` in TS). Capability-off omits the entire key.

**Atomicity (INV-4-08)**:

- When the `by_reviewer_comments` key is present on a rollup, EVERY entry in the outer dict (including the sentinel-bucket entry) MUST contain ALL FOUR fields above, with non-null values.
- Partial entries (3 of 4 fields, or all 4 with nulls) are a contract violation.
- The schema validator (Phase 2 task: extend `extension/ui/schemas/rollup.schema.ts`) MUST detect partial-shape violations and report them as ERRORS in strict mode AND in permissive mode (mirrors 334's `validateAuthorCommentsDensity` at `rollup.schema.ts:868` and 335's `validateRepositoryCommentsDensity` posture). One tier stricter than the per-PR `PrRecord` INV-08 validator's posture; rationale matches 334 ADR T003 / 335 inheritance (no legacy emissions to grandfather).

**Capability gating (FR-3-03)**:

- When `capabilities.comments_metrics === false` on the manifest, the entire `by_reviewer_comments` key MUST be absent from every week's rollup. Not `{}`, not `null`, not present-with-partial-entries — absent.
- Capability-off byte-identity test gates this; see §5.

**Sentinel literal (CL-03 / FR-1-03 / INV-4-12)**:

- The reserved literal `__former_or_unavailable_author__` (`FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL` from `src/ado_git_repo_insights/transform/constants.py:27`) is a permitted key in the outer dict. It represents the SINGLE bucket aggregating ALL eligible-reviewer-comment rows whose `pr_comments.author_id` is absent from `users` (LEFT JOIN result is NULL).
- The leading-double-underscore namespace cannot collide with `pr_comments.author_id` UUID strings (32 hex chars + 4 hyphens per the existing extractor; FK at `models.py:172` further constrains real data to `users.user_id` UUIDs).
- The sentinel literal is reused verbatim from #334's pattern at `transform/constants.py:27`. Renderer-side maps it to the fixed-string label `"Former / unavailable author"` (English-only for v1, reuse 334's label literal per cross-feature consistency directive — NOT a new "Former / unavailable reviewer" string).
- Sentinel-branch fires only under FK enforcement-disabled scenarios (the FK constraint at `models.py:172` would otherwise prevent missing users in well-formed production data); the branch is by-design fallback, NOT FAIL-LOUD per CL-15.

**No FK-violation handling at the per-reviewer dimension** — divergence from #335's repository_id FK posture: #335 uses no-sentinel + FAIL-LOUD on FK violation. #336 uses sentinel + by-design fallback on missing-user (which is the same scenario as FK violation, but mapped to the sentinel rather than raised). The substantive difference is renderer consistency: the same fixed-string label "Former / unavailable author" surfaces across per-author + per-reviewer dimensions, simplifying the renderer's user model.

## §2 Producer contract (Python aggregator)

**Where it lives**: `src/ado_git_repo_insights/transform/aggregators.py`. New helper `_compute_weekly_by_reviewer_comments(week_pr_uids: set[str])` paralleling existing `_compute_weekly_by_author_comments` at `aggregators.py:1104` and `_compute_weekly_by_repository_comments` at `aggregators.py:1239`.

**Behavior**:

1. Read `_has_comments()` (existing helper).
2. **If `_has_comments()` returns `False`**: serialize the rollup WITHOUT the `by_reviewer_comments` key. Do NOT emit it as `{}` or `null`. STOP — rest of this contract does not apply.
3. **If `_has_comments()` returns `True`**: for each week W:
   a. Determine W's canonical throughput PR set using throughput's week-attribution rule (same `closed_date → ISO-week` formula 333 / 334 / 335 / throughput use; per-PR parity guard at `tests/integration/test_week_attribution_parity.py` covers drift).
   b. Materialize `week_pr_uids` in a temp table mirroring 334 / 335's pattern: `_aggr_week_by_reviewer_comments_slice` with PRIMARY KEY `pull_request_uid`. INSERT all uids; the subsequent SELECT joins against this table for S608 compliance per `reference_s608_refactor_pattern.md`.
   c. Compute the same-W `coverage_partial` flag (per FR-1-07 / CL-10) by querying for any PR in W's canonical set with `comments_extracted_at IS NULL`. This single boolean applies to ALL reviewer buckets in W.
   d. Iterate `pr_comments` rows joined with `pull_requests` (INNER JOIN for self-comment exclusion) + `pr_threads` (LEFT JOIN for active-thread filter) + `users` (LEFT JOIN for sentinel detection); GROUP BY commenter_or_sentinel; compute aggregates per FR-1-05.
   e. For each row of the cursor result: validate `pr_comments.author_id` shape (NULL or non-UUID-format → raise `RuntimeError` per FR-1-12 / CL-15).
   f. Build the inner dict for each bucket: `{ "thread_count": ..., "comment_count": ..., "active_thread_count": ..., "coverage_partial": <same-W flag from step c> }`.
   g. Build the outer dict: `{ <commenter_id_or_sentinel>: <inner_dict>, ... }`.
   h. If the outer dict is empty (no eligible-reviewer-comment rows in W's extracted-subset), DO NOT emit the `by_reviewer_comments` key (consistent with FR-1-11 + FR-3-03 omission contract).
   i. Otherwise, emit `"by_reviewer_comments": <outer_dict>` on the rollup root, atomically.

**SQL pattern reference**: parallel to 334's `_compute_weekly_by_author_comments` at `aggregators.py:1104` (for the LEFT JOIN users + sentinel CASE pattern) and 335's `_compute_weekly_by_repository_comments` at `aggregators.py:1239` (for the temp-table-join + ORDER BY pattern). Substantive divergence: iterates `pr_comments` rows (NOT `pull_requests` rows) and uses COUNT(DISTINCT thread_id) for `thread_count` / `active_thread_count`:

```sql
-- Pseudo-SQL (final form locked at task time per T011)
SELECT
  CASE WHEN u.user_id IS NULL THEN ? ELSE pc.author_id END AS commenter_or_sentinel,
  COUNT(*) AS comment_count,
  COUNT(DISTINCT pc.thread_id) AS thread_count,
  COUNT(DISTINCT CASE WHEN t.status = 'active' THEN pc.thread_id ELSE NULL END) AS active_thread_count
FROM pr_comments pc
INNER JOIN _aggr_week_by_reviewer_comments_slice s
  ON s.pull_request_uid = pc.pull_request_uid
INNER JOIN pull_requests pr
  ON pr.pull_request_uid = pc.pull_request_uid
LEFT JOIN users u
  ON u.user_id = pc.author_id
LEFT JOIN pr_threads t
  ON t.pull_request_uid = pc.pull_request_uid
  AND t.thread_id = pc.thread_id
WHERE pr.comments_extracted_at IS NOT NULL
  AND pc.is_deleted = 0
  AND pc.author_id != pr.user_id  -- self-comment exclusion per CL-04
GROUP BY commenter_or_sentinel
ORDER BY commenter_or_sentinel ASC;
```

(Final SQL form locked at task time. Note: the sentinel literal is bound via parameter (the `?` in the CASE branch) — NOT f-string interpolation. S608 compliance per `reference_s608_refactor_pattern.md`. The `coverage_partial` flag is computed in a separate query per step c above and applied uniformly to every bucket in the result.)

**Determinism (QG-05)**:

- Stable bucket-key set (deterministic LEFT JOIN result per SQLite's defined behavior).
- Inner dict field order matches §1 declaration: `thread_count`, `comment_count`, `active_thread_count`, `coverage_partial`.
- **Outer dict key order: ascending by commenter key** — the stable identity string for each entry, including the reserved sentinel literal `__former_or_unavailable_author__` (which sorts deterministically among UUID-shaped real keys at the leading-`__` position; `_` is ASCII 0x5F and sorts before lowercase letters but after uppercase; UUID hex strings start with digits 0-9 + `a-f` so the sentinel's `_` sorts after all hex starts). Display name MUST NOT be the producer's sort key — display names can collide (duplicate names, sentinel/real-name collision); only the commenter key is guaranteed unique per the producer's invariants. UI tie-break (FR-4-05) is the renderer's responsibility and adds display-name → bucket-key as a final tie-breaker.

**Failure modes**:

- If `pr_threads` or `pr_comments` tables do not exist on a legacy DB: `_has_comments()` returns `False` (existing catch in aggregators.py); no `by_reviewer_comments` key emitted. Capability flag reads `False` in the manifest. Renderer shows no breakdown surface. SC-1-03 byte-identical baseline holds.
- If a week W has zero PRs in its canonical throughput PR set: the outer dict for that week is empty → `by_reviewer_comments` key NOT emitted (per step h above).
- If a week W has zero eligible-reviewer-comment rows (every PR's only comments are self-comments OR every PR has `comments_extracted_at IS NULL`): the outer dict is empty → key NOT emitted.
- If a `pr_comments.author_id` is NULL (DB integrity violation): aggregator raises `RuntimeError` per FR-1-12 / CL-15. NOT silently skipped (divergence from 334's defensive `continue` at `aggregators.py:1224` — for #336, FAIL-LOUD on shape corruption per kickoff directive).
- If a `pr_comments.author_id` is non-UUID-format (extractor regression): aggregator raises `RuntimeError` per FR-1-12 / CL-15.
- If a commenter's `pr_comments.author_id` is absent from `users` (FK enforcement disabled or migration edge): the row's bucket is the sentinel literal per CL-03. ALL such rows collapse into one bucket per W. NOT FAIL-LOUD (this is the by-design fallback path).

**Cross-bucket atomicity (INV-4-08)**:

- For every emitted entry: ALL four fields present. No mixed emission per bucket.
- The aggregator implementation achieves this by emitting each bucket as a single dict literal (`{"thread_count": ..., "comment_count": ..., "active_thread_count": ..., "coverage_partial": ...}`) — atomic at the dict construction site.

**Ordering (INV-4-07)**:

- For every entry: `active_thread_count <= thread_count` MUST hold. The active subset of distinct threads cannot exceed the full distinct-thread set; SQL's `COUNT(DISTINCT CASE WHEN t.status = 'active' THEN pc.thread_id ELSE NULL END)` is structurally a subset of `COUNT(DISTINCT pc.thread_id)` so the constraint holds at the SQL level.

**Sentinel namespace safety (A-07 / T029 extension)**:

- The reserved literal `__former_or_unavailable_author__` cannot collide with `pr_comments.author_id` UUIDs per the existing extractor's UUID format (32 hex chars + 4 hyphens; the sentinel's leading `_` does not appear in valid UUIDs).
- The existing #334 collision-safety scan (`tests/unit/test_aggregators_author_comments.py:514`, `test_sentinel_literal_does_not_collide_with_real_author_ids`) MUST be EXTENDED in-place per kickoff directive — widen the assertion list to ALSO assert no real `pr_comments.author_id` collides with the literal. NO new test file, NO duplicated test function.

## §3 Consumer contract (TypeScript schema + chart)

**Schema declaration** (in `extension/ui/schemas/rollup.schema.ts`):

```ts
export interface ReviewerCommentsDensityEntry {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

export interface Rollup {
  // ... existing fields unchanged ...
  by_reviewer_comments?: Record<string, ReviewerCommentsDensityEntry>;
}
```

**KNOWN_ROOT_FIELDS update**: add `"by_reviewer_comments"` to the existing `KNOWN_ROOT_FIELDS` set (currently at `rollup.schema.ts:204` — the existing entries for `"by_author_comments"` from #334 and `"by_repository_comments"` from #335 were added next to where `"comments"` was added by 333). This satisfies both the strict-mode "FAIL on unknown fields" path and the permissive-mode warnings path.

**Atomicity validator** (`validateReviewerCommentsDensity`): new function alongside the existing `validateAuthorCommentsDensity` (`rollup.schema.ts:868`), `validateRepositoryCommentsDensity` (post-#350), and `validateCommentsAggregate` (333). Asserts:

- When `by_reviewer_comments` key present: outer value must be a non-null object; non-empty (empty `{}` violates FR-1-11).
- For each entry in the outer object: all 4 fields present with correct types per §1.
  - Numeric fields: `number`, non-null, non-negative integer (`Number.isInteger(value) && value >= 0`).
  - `coverage_partial`: strict boolean (`typeof value === "boolean"`), not null/undefined/string.
  - Partial shape (3 of 4 fields, or all 4 with nulls) → ERROR (strict in both modes per ADR R001 / 334 / 335 STRICT-ERROR posture).
- Ordering (INV-4-07): `active_thread_count <= thread_count` per entry → ERROR if violated. The sentinel-bucket entry satisfies the same check.
- Sentinel literal `__former_or_unavailable_author__` is permitted as a key (no special handling — just another string).

**Atomicity posture (STRICT ERROR in both modes)**: same rationale as 333's `validateCommentsAggregate`, 334's `validateAuthorCommentsDensity`, and 335's `validateRepositoryCommentsDensity`. INV-4-08 atomicity is a NEW contract introduced by this feature with no existing emissions to be lenient toward. A partial-shape regression slipping through as a warning would force every renderer to add defensive null-checks per field, defeating the contract's purpose.

**Schema test extension** (`extension/tests/schema/rollup.test.ts`): add cases verifying:

- Valid 4-field entry passes.
- Partial entry (missing one field) fails validation.
- Entry with null values fails validation.
- Rollup without `by_reviewer_comments` key passes (capability-off scenario).
- Wrong-typed fields (e.g., `thread_count` is a string) fail.
- `active_thread_count > thread_count` per entry fails (INV-4-07).
- Empty `{}` outer dict fails (FR-1-11 — key MUST be omitted entirely when no buckets).
- Entry with `__former_or_unavailable_author__` as key passes.

**Chart module display-label resolution** (FR-4-11 / FR-4-12 / CL-05):

```ts
// In comments-reviewer-density.ts — three-step lookup precedence
const FORMER_OR_UNAVAILABLE_AUTHOR_KEY = "__former_or_unavailable_author__";
const FORMER_OR_UNAVAILABLE_AUTHOR_LABEL = "Former / unavailable author";

function buildUsersDirectory(
  usersDimension: readonly UserDirectoryEntry[] | undefined,
): Map<string, string> | null {
  if (!usersDimension) return null;
  const map = new Map<string, string>();
  for (const entry of usersDimension) {
    if (typeof entry.user_id === "string" && typeof entry.display_name === "string") {
      map.set(entry.user_id, entry.display_name);
    }
  }
  return map;
}

function resolveDisplayName(
  reviewerKey: string,
  directory: Map<string, string> | null,
): string {
  // CL-05 step 1: sentinel branch (highest precedence) — fixed label
  // regardless of whether usersDimension contains an entry under the
  // sentinel literal (defensive — the producer guarantees the literal
  // does not collide with real user_id UUIDs per A-07, but the renderer
  // keeps the contract one-sided).
  if (reviewerKey === FORMER_OR_UNAVAILABLE_AUTHOR_KEY) {
    return FORMER_OR_UNAVAILABLE_AUTHOR_LABEL;
  }
  // CL-05 step 2: users-dimension lookup
  if (directory) {
    const found = directory.get(reviewerKey);
    if (typeof found === "string" && found.length > 0) {
      return found;
    }
  }
  // CL-05 step 3: raw-`user_id` fallback
  return reviewerKey;
}
```

The fallback path (step 3) MUST be exercised by a unit test in `comments-reviewer-density.test.ts` — fixture with one bucket whose `user_id` is absent from the `usersDimension` array; assert the rendered row label equals the raw ID. The sentinel branch (step 1) MUST be exercised by a separate unit test — fixture with a sentinel-keyed bucket; assert the rendered row label equals "Former / unavailable author" regardless of dimension contents.

## §4 Schema-parity gate scope (explicit non-extension)

Per CL-09 + spec Out of Scope: the existing per-PR `PrRecord` schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is **NOT** extended to cover this contract.

The decision is locked. The SC-05 reconciliation test extension (FR-2-04, in-place to `tests/integration/test_comments_trend_reconciliation.py` per CL-06) plus the FR-2-03 cross-aggregate parity-vs-INDEPENDENT-count assertion are the sole authority for per-reviewer comments-density parity — they verify values, which is strictly stronger than schema-shape parity drift detection would be.

## §5 Demo dataset gating (FR-3-03)

The capability-off demo variant MUST emit rollups WITHOUT the `by_reviewer_comments` key. The byte-identity test at `tests/integration/test_demo_variants_byte_identity.py` MUST be extended to gate the new key across all four omission failure modes (key absent, `null`-valued, `{}`-valued, partial-fielded).

**Extension target locked**: add `"by_reviewer_comments"` to the existing `_GATED_*` namespace strip set (333 added `"comments"`; 334 added `"by_author_comments"`; 335 added `"by_repository_comments"`; this feature adds the per-reviewer sibling). The 4 omission failure modes gate individually per the existing pattern.

## §6 Reconciliation contract reference + cross-aggregate parity (NEW shape for this feature)

The SC-05 reconciliation extension (FR-2-04) extends `tests/integration/test_comments_trend_reconciliation.py` in-place per CL-06. The new assertions:

- **FR-2-01 (per-PR drill-down ↔ per-reviewer aggregator `comment_count` distribution coherence)**: For every PR P in the drill-down's top-500-by-cycle-time slice for W AND in W's extracted-subset, the test asserts:
  - `comment_count` distribution: `P.comment_count_drilldown - count_self_comments(P)` EQUALS the SUM over non-self commenters R of `(count of pr_comments rows for P where author_id = R AND is_deleted = 0)`.
  - `thread_count` / `active_thread_count` distribution NOT asserted at FR-2-01 level: the per-PR drill-down's `thread_count` counts ALL distinct threads on P (including threads where only P's author commented — self-only threads). Self-only threads contribute 0 to the per-reviewer aggregator (no non-self commenter). Therefore `SUM_R(thread_count contribution from P) ≤ count_threads_with_non_self_comments(P) ≤ P.thread_count_drilldown`, with strict-less when P has ≥1 self-only thread. No clean closed-form per-PR bound (the gap depends on P's self-only-thread count, which the per-PR drill-down does not record separately). Per-bucket correctness is covered by FR-2-02's independent re-computation. The "PR with mixed self-only and non-self threads" edge case in spec.md Edge Cases is the witness that this narrowing is structural (per-reviewer dimension excludes self-only threads by design per CL-04), not a defect.
- **FR-2-02 (independent re-computation per (W, R))**: For each (W, reviewer) tuple, the test independently re-computes the expected values by direct SQL against `pr_comments` + `pull_requests` (INNER JOIN for self-comment exclusion) + `pr_threads` (LEFT JOIN for active-thread filter) + `users` (LEFT JOIN for sentinel detection), applies C1, computes thread_count via COUNT(DISTINCT thread_id), re-derives `coverage_partial` from the same-W rule, asserts equality with the aggregator's emission.
- **FR-2-03 (cross-aggregate parity — NEW shape)**: For every week W where both `comments` and `by_reviewer_comments` are emitted (non-empty), the test asserts:
  - `SUM_R(by_reviewer_comments[R].comment_count)` EQUALS the count of `pr_comments` rows in W's extracted-subset where `pr_comments.author_id != pull_requests.user_id` AND `pr_comments.is_deleted = 0`. This count MUST be computed INDEPENDENTLY by direct SQL — NOT by referencing `rollup[W].comments.comment_count` (which over-counts by self-comment delta).
  - `OR_R(by_reviewer_comments[R].coverage_partial)` EQUALS `rollup[W].comments.coverage_partial` (drift guard against CL-10 same-W lock breakage).
  - `thread_count` / `active_thread_count` sum-coherence NOT asserted (multi-counting metrics; FR-2-02 covers per-bucket correctness).

  The truncated W26 demo fixture (`docs/data/aggregates/weekly_rollups/2025-W26.json` — `_prs_truncated: true`) is the WITNESS that this contract holds even when the per-PR drill-down is truncated. The aggregator computes over the FULL canonical extracted-subset per FR-1-10; the drill-down truncation does not affect aggregator scope. The test is week-agnostic — it iterates every week W where both aggregates are emitted; W26 is the current witness but the assertion survives demo regeneration if truncation shifts to a different week per A-11.

The 333 round-9 import-block isolation (`tests/integration/test_comments_trend_reconciliation_isolation.py`) covers the extension automatically — the `aggregators.py` import is forbidden by FILE, not by dimension or test-function scope.

The 333 / 334 / 335 failure-mode meta-test (`tests/integration/test_comments_trend_meta_failure.py`) is extended per FR-2-05 with THREE injections per ADR R004:
- Per-(week, reviewer) INV-4-07 violation (e.g., a bucket with `active_thread_count > thread_count`); meta-test asserts FR-2-04 reconciliation FAILS on the mutated dataset.
- Per-week sum-coherence violation (mutate one bucket's `comment_count` to break FR-2-03); meta-test asserts FR-2-04 reconciliation FAILS on the mutated dataset.
- Self-comment-leak violation (inject a synthetic bucket whose key equals the PR author's own `user_id`); meta-test asserts FR-2-04 reconciliation FAILS on the mutated dataset (FR-2-02 or FR-2-03 catches the leak).

## §7 What this contract does NOT govern

- **Per-PR `PrRecord` schema** — that's 310's contract. Frozen.
- **Weekly comments aggregate `rollup[W].comments`** — that's 333's contract. Not modified (verified via FR-2-03 OR-coherence on the consumer side).
- **Per-author comments-density `rollup[W].by_author_comments`** — that's 334's contract. Not modified (the SENTINEL literal is REUSED but 334's emission shape is unchanged).
- **Per-repo comments-density `rollup[W].by_repository_comments`** — that's 335's contract. Not modified.
- **Existing throughput `rollup[W].by_reviewer`** — `ReviewerBreakdownEntry` shape (throughput-only fields). Not modified.
- **Per-team breakdown** — out of scope per #321.
- **Click-through behavior on rendered rows** — FR-4-09 NO click-through; future feature owns any per-reviewer drill-down.
- **i18n of sentinel label** — out of scope (reuse 334's English-only label literal verbatim per CL-03 / cross-feature consistency).
- **Lifting 310 INV-02 top-500 cap** — out of scope; both aggregates compute over W's full canonical extracted-subset per Spec Background.
- **CSV / extractor changes** — INV-4-04 / INV-4-05 frozen.
- **Demo synthetic stream serialization** — `synthetic_pr_threads` + `synthetic_pr_comments` are demo-internal per CL-14 step 5; only aggregated `by_reviewer_comments` keys ship in rollup files.

## §8 Example emitted rollup excerpt (capability-on)

```jsonc
{
  "week": "2026-W17",
  "pr_count": 47,
  "by_reviewer": { /* existing throughput-only fields, unchanged */ },
  "by_author_comments": { /* existing 334 per-author aggregate, unchanged */ },
  "by_repository_comments": { /* existing 335 per-repo aggregate, unchanged */ },
  "comments": { /* existing 333 weekly aggregate, unchanged */
    "thread_count": 312,
    "comment_count": 1248,
    "active_thread_count": 41,
    "coverage_partial": false
  },
  "by_reviewer_comments": {
    "abc-123-def-456-...": {
      "thread_count": 28,
      "comment_count": 132,
      "active_thread_count": 5,
      "coverage_partial": false
    },
    "xyz-789-...": {
      "thread_count": 17,
      "comment_count": 64,
      "active_thread_count": 3,
      "coverage_partial": false
    },
    "__former_or_unavailable_author__": {
      "thread_count": 4,
      "comment_count": 9,
      "active_thread_count": 1,
      "coverage_partial": false
    }
  }
}
```

(Note: SUM_R(comment_count) = 132 + 64 + 9 = 205. This is the count of `pr_comments` rows in W17's extracted-subset where commenter ≠ PR author; it is LESS THAN `comments.comment_count = 1248` by the self-comment delta of 1248 - 205 = 1043 self-comments. SUM_R(thread_count) = 28 + 17 + 4 = 49 > comments.thread_count = 41 — multi-counting confirmed at the demo level. coverage_partial is uniformly `false` for every reviewer in W17, matching `comments.coverage_partial`. The example values are illustrative; demo dataset values come from `scripts/build-demo-dataset.py`.)

## §9 Example emitted rollup excerpt (capability-off)

Identical to the pre-feature shape; no `by_reviewer_comments` key at all.

```jsonc
{
  "week": "2026-W17",
  "pr_count": 47,
  "by_reviewer": { /* existing throughput-only fields */ }
  // no `comments` key (333 also omits under capability-off)
  // no `by_author_comments` key (334 also omits under capability-off)
  // no `by_repository_comments` key (335 also omits under capability-off)
  // no `by_reviewer_comments` key (this feature also omits)
}
```
