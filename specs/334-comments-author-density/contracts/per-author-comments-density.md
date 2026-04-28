# Contract: Per-author comments-density emission (Feature 334)

**Scope**: producer (`src/ado_git_repo_insights/transform/aggregators.py`) + consumer (`extension/ui/schemas/rollup.schema.ts`, `extension/ui/modules/charts/comments-author-density.ts`).

**Authoritative spec refs**: [spec.md](../spec.md) — FR-1-01..FR-1-08, FR-2-01..FR-2-05, FR-3-01..FR-3-03, FR-4-01..FR-4-10, INV-2-01..INV-2-11, SC-1-01..SC-1-06. Sibling foundation: [`specs/333-comments-trend-chart/contracts/weekly-comments-aggregate.md`](../../333-comments-trend-chart/contracts/weekly-comments-aggregate.md) and [`specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md`](../../333-comments-trend-chart/contracts/sc05-reconciliation-test.md).

**Inclusion rules**: the C1 inclusion rules that govern `thread_count`, `comment_count`, and `active_thread_count` are defined ONCE in [`specs/310-comments-visualization/spec.md`](../../310-comments-visualization/spec.md) "Shared inclusion-rule contract (C1)". This contract REFERENCES them; it does NOT re-declare (INV-2-03 / DIRECTIVE 7).

**Schema-parity gate scope**: this contract is **NOT** parsed by `scripts/check_pr_record_schema_parity.py` (per CL-08 + spec Out of Scope: that gate covers per-PR PrRecord fields only). Per-author comments-density parity is enforced by the SC-05 reconciliation test extension (FR-2-04, see §4).

---

## §1 Canonical field declaration

The `by_author_comments` sub-object lives at the rollup root: `rollup[W].by_author_comments`. Outer dict keys are `author_id` strings (or the reserved sentinel literal); inner values are 4-field entries. Optional at the rollup root level; atomic per entry when present (INV-2-08).

| Field | Python type (aggregator emission) | TypeScript type (schema declaration) | Required when entry exists | Computation reference |
|---|---|---|---|---|
| `thread_count` | `int` | `number` | yes | FR-1-05 + extracted-subset rule per author |
| `comment_count` | `int` | `number` | yes | FR-1-05 + extracted-subset rule per author |
| `active_thread_count` | `int` | `number` | yes | FR-1-05 + extracted-subset rule per author |
| `coverage_partial` | `bool` | `boolean` | yes | FR-1-06 (`true` iff any of author A's PRs in W's canonical throughput PR set has `comments_extracted_at IS NULL`) |

**Type compatibility**:

- All three numeric fields MUST be `int` Python ↔ `number` TypeScript (non-null on both sides; integer constraint enforced at validator level).
- The boolean MUST be `bool` Python ↔ `boolean` TypeScript.
- The wrapping outer dict (`by_author_comments`) is OPTIONAL at the rollup root (`by_author_comments?: Record<string, AuthorCommentsDensityEntry>` in TS). Capability-off omits the entire key.

**Atomicity (INV-2-08)**:

- When the `by_author_comments` key is present on a rollup, EVERY entry in the sub-dict (including the sentinel-bucket entry) MUST contain ALL FOUR fields above, with non-null values.
- Partial entries (3 of 4 fields, or all 4 with nulls) are a contract violation.
- The schema validator (Phase 1 task: extend `extension/ui/schemas/rollup.schema.ts`) MUST detect partial-shape violations and report them as ERRORS in strict mode AND in permissive mode (matching ADR T003 — STRICT in both modes). This is one tier stricter than the per-PR `PrRecord` INV-08 validator's posture; rationale matches 333 ADR T004 (no legacy emissions to grandfather).

**Capability gating (FR-3-03)**:

- When `capabilities.comments_metrics === false` on the manifest, the entire `by_author_comments` key MUST be absent from every week's rollup. Not `{}`, not `null`, not present-with-partial-entries — absent.
- Capability-off byte-identity test gates this; see §5.

**Sentinel literal (CL-03 / FR-1-03)**:

- The reserved literal `__former_or_unavailable_author__` is a permitted key in the outer dict. It represents the SINGLE bucket aggregating ALL PRs whose `author_id` is absent from the `users` table.
- The leading-double-underscore namespace cannot collide with author_id UUID strings (32 hex chars + 4 hyphens per the existing extractor).
- The sentinel literal is a `Final[str]` constant in the producer code; renderer-side maps it to the fixed-string label `"Former / unavailable author"` (English-only for v1).

## §2 Producer contract (Python aggregator)

**Where it lives**: `src/ado_git_repo_insights/transform/aggregators.py`, inside the existing `_generate_weekly_rollups()` per-week emission loop (~line 590 in current base; line numbers to be confirmed at task-execution time).

**Behavior**:

1. Read `_has_comments()` (existing helper, ~line 1701 in current base).
2. **If `_has_comments()` returns `False`**: serialize the rollup WITHOUT the `by_author_comments` key. Do NOT emit it as `{}` or `null`. STOP — rest of this contract does not apply.
3. **If `_has_comments()` returns `True`**: for each week W:
   a. Determine W's canonical throughput PR set using throughput's week-attribution rule (per ADR T005 — re-implemented same `closed_date → pd.to_datetime → .dt.isocalendar() → f"{year}-W{week:02d}"` formula; per-PR parity guard catches drift).
   b. For each PR P in W's canonical set: lookup P's author identifier in `users` table (LEFT JOIN). If present in `users`, use the author identifier as the bucket key. If absent, use the reserved sentinel literal `__former_or_unavailable_author__`.
   c. Group PRs by bucket key.
   d. For each bucket: filter to W's extracted-subset for that bucket (PRs by this author with `comments_extracted_at IS NOT NULL`); query `pr_threads` and `pr_comments` per PR with C1 inclusion rules applied; sum per-PR contributions to produce integer `thread_count`, `comment_count`, `active_thread_count`.
   e. For each bucket: compute `coverage_partial = (∃ PR by author A in W's canonical set with comments_extracted_at IS NULL)` — boolean. Each bucket has its OWN `coverage_partial` flag.
   f. Build the inner dict for each bucket: `{ "thread_count": ..., "comment_count": ..., "active_thread_count": ..., "coverage_partial": ... }`.
   g. Build the outer dict: `{ <author_id_or_sentinel>: <inner_dict>, ... }`.
   h. If the outer dict is empty (no authors with any extracted-subset contribution OR no canonical PR set for W), DO NOT emit the `by_author_comments` key (consistent with the FR-3-03 omission contract).
   i. Otherwise, emit `"by_author_comments": <outer_dict>` on the rollup root, atomically.

**SQL pattern reference**: similar to the per-PR query in 310's `pr-record-comments-fields.md` §2 and 333's `weekly-comments-aggregate.md` §2, but grouped by `(author_id_or_sentinel)` and joined with `users` to detect missing authors:

```sql
-- Pseudo-SQL (final form is task-level)
WITH author_resolution AS (
  SELECT
    pr.pull_request_uid,
    pr.comments_extracted_at,
    CASE
      WHEN u.user_id IS NULL THEN '__former_or_unavailable_author__'
      ELSE pr.<author_identifier_column>
    END AS author_or_sentinel
  FROM pull_requests pr
  LEFT JOIN users u ON u.user_id = pr.<author_identifier_column>
  WHERE pr.pull_request_uid IN (W's canonical throughput PR set)
),
extracted_subset AS (
  SELECT pull_request_uid, author_or_sentinel
  FROM author_resolution
  WHERE comments_extracted_at IS NOT NULL
),
canonical_per_author AS (
  SELECT author_or_sentinel,
         COUNT(*) FILTER (WHERE comments_extracted_at IS NULL) > 0 AS coverage_partial
  FROM author_resolution
  GROUP BY author_or_sentinel
),
sums AS (
  SELECT
    es.author_or_sentinel,
    COALESCE(SUM(t.thread_count), 0) AS thread_count,
    COALESCE(SUM(t.active_thread_count), 0) AS active_thread_count,
    COALESCE(SUM(c.comment_count), 0) AS comment_count
  FROM extracted_subset es
  LEFT JOIN (
    SELECT pull_request_uid,
           COUNT(*) AS thread_count,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_thread_count
    FROM pr_threads
    WHERE is_deleted = 0
    GROUP BY pull_request_uid
  ) t ON t.pull_request_uid = es.pull_request_uid
  LEFT JOIN (
    SELECT pull_request_uid, COUNT(*) AS comment_count
    FROM pr_comments
    WHERE is_deleted = 0
    GROUP BY pull_request_uid
  ) c ON c.pull_request_uid = es.pull_request_uid
  GROUP BY es.author_or_sentinel
)
SELECT
  cpa.author_or_sentinel,
  COALESCE(s.thread_count, 0) AS thread_count,
  COALESCE(s.comment_count, 0) AS comment_count,
  COALESCE(s.active_thread_count, 0) AS active_thread_count,
  cpa.coverage_partial
FROM canonical_per_author cpa
LEFT JOIN sums s ON s.author_or_sentinel = cpa.author_or_sentinel;
```

(Final SQL form locked at task time. Note: the `author_or_sentinel` resolution uses `u.user_id IS NULL` from a LEFT JOIN; the `<author_identifier_column>` placeholder is pinned at task time per the actual aggregator code.)

**S608 compliance**: dynamic IN-clause construction (`pr.pull_request_uid IN (W's canonical throughput PR set)`) MUST follow the pattern at `reference_s608_refactor_pattern.md` (use `" ".join([...])` or temp-table-join, never `# noqa: S608`).

**Determinism (QG-05)**:

- Stable bucket-key set (deterministic LEFT JOIN result per pandas / SQL).
- Inner dict field order matches §1 declaration: `thread_count`, `comment_count`, `active_thread_count`, `coverage_partial`.
- **Outer dict key order: ascending by author key** — the stable identity string for each entry, including the reserved sentinel literal `__former_or_unavailable_author__` (which sorts deterministically among UUID-shaped real keys at the leading-`__` position). Display name MUST NOT be the producer's sort key — display names can collide (duplicate names, sentinel/real-name collision); only the author key is guaranteed unique per the producer's invariants. UI tie-break (FR-4-05) is the renderer's responsibility and adds display-name → author-key as a final tie-breaker.

**Failure modes**:

- If `pr_threads` or `pr_comments` tables do not exist on a legacy DB: `_has_comments()` returns `False` (existing catch in aggregators.py); no `by_author_comments` key emitted. Capability flag reads `False` in the manifest. Renderer shows no breakdown surface. SC-1-03 byte-identical baseline holds.
- If a week W has zero PRs in its canonical throughput PR set: the outer dict for that week is empty → `by_author_comments` key NOT emitted (per step h above).
- If a bucket's extracted-subset is empty (all of that author's PRs in W are unextracted): the bucket's three numeric fields are 0; `coverage_partial` is `true`. Bucket IS emitted (one entry with all zeros + partial flag) — required so the renderer can show "we don't know yet" signal for that author.
- If a PR's author identifier is absent from `users`: the PR is bucketed under the sentinel literal. ALL such PRs collapse into one bucket per W.

**Cross-bucket atomicity (INV-2-08)**:

- For every emitted entry: ALL four fields present. No mixed emission per bucket.
- The aggregator implementation achieves this by emitting each bucket as a single dict literal (`{"thread_count": ..., "comment_count": ..., "active_thread_count": ..., "coverage_partial": ...}`) — atomic at the dict construction site.

**Ordering (INV-2-07)**:

- For every entry: `active_thread_count <= thread_count` MUST hold. Sentinel bucket: same constraint, since the sums derive from constituent PRs each satisfying the constraint at the per-PR level (which holds because `pr_threads.status = 'active'` is a subset of all included threads after C1 inclusion rules).

## §3 Consumer contract (TypeScript schema + chart)

**Schema declaration** (in `extension/ui/schemas/rollup.schema.ts`):

```ts
// New optional sub-object on the Rollup interface
export interface AuthorCommentsDensityEntry {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

export interface Rollup {
  // ... existing fields unchanged ...
  by_author_comments?: Record<string, AuthorCommentsDensityEntry>;
}
```

**KNOWN_ROOT_FIELDS update**: add `"by_author_comments"` to the existing `KNOWN_ROOT_FIELDS` set (currently at `rollup.schema.ts` `KNOWN_ROOT_FIELDS` constant, near where `"comments"` was added by 333). This satisfies both the strict-mode "FAIL on unknown fields" path and the permissive-mode warnings path.

**Atomicity validator** (`validateAuthorCommentsDensity`): new function alongside the existing `validateCommentsAggregate` (333). Asserts:

- When `by_author_comments` key present: outer value must be a non-null object.
- For each entry in the outer object: all 4 fields present with correct types per §1.
  - Numeric fields: `number`, non-null, non-negative integer (`Number.isInteger(value) && value >= 0`).
  - `coverage_partial`: strict boolean (`typeof value === "boolean"`), not null/undefined/string.
  - Partial shape (3 of 4 fields, or all 4 with nulls) → ERROR (strict in both modes per ADR T003).
- Ordering (INV-2-07): `active_thread_count <= thread_count` per entry → ERROR if violated. The sentinel-bucket entry satisfies the same check.
- Sentinel literal `__former_or_unavailable_author__` is permitted as a key (no special handling — just another string).

**ADR T003 — atomicity posture (STRICT ERROR in both modes)**: same rationale as 333 ADR T004. INV-2-08 is a NEW contract introduced by this feature with no existing emissions to be lenient toward. A partial-shape regression slipping through as a warning would force every renderer to add defensive null-checks per field, defeating the contract's purpose.

**Schema test extension** (`extension/tests/schema/rollup.test.ts`): add cases verifying:

- Valid 4-field entry passes.
- Partial entry (missing one field) fails validation.
- Entry with null values fails validation.
- Rollup without `by_author_comments` key passes (capability-off scenario).
- Wrong-typed fields (e.g., `thread_count` is a string) fail.
- `active_thread_count > thread_count` per entry fails (INV-2-07).
- Entry with `__former_or_unavailable_author__` as key passes.

## §4 Schema-parity gate scope (explicit non-extension)

Per CL-08 + spec Out of Scope: the existing per-PR `PrRecord` schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is **NOT** extended to cover this contract.

The decision is locked. The SC-05 reconciliation test extension (FR-2-04, in-place to `tests/integration/test_comments_trend_reconciliation.py` per CL-04) is the sole authority for per-author comments-density parity — it verifies values, not just field shapes, which is strictly stronger than schema-parity drift detection would be.

## §5 Demo dataset gating (FR-3-03)

The capability-off demo variant MUST emit rollups WITHOUT the `by_author_comments` key. The byte-identity test at `tests/integration/test_demo_variants_byte_identity.py` (the locked-shape gate per 333 ADR T001) MUST be extended to gate the new key across all four omission failure modes (key absent, `null`-valued, `{}`-valued, partial-fielded), so a future regression that emits the `by_author_comments` object under capability-off is caught at CI rather than at the dashboard render layer.

**Extension target locked**: `tests/integration/test_demo_variants_byte_identity.py`. Add `"by_author_comments"` to the existing `_GATED_*` namespace strip set (333 added `"comments"`; this feature adds the per-author sibling). The 4 omission failure modes (absent / null / {} / partial) gate individually per the existing pattern.

## §6 Reconciliation contract reference

The SC-05 reconciliation extension (FR-2-04) is documented in `specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md`; this feature extends that test in-place per CL-04. The new assertions:

- **FR-2-01 (per-author parity — pairwise on extracted-subset)**: For every PR P in the drill-down's top-500-by-cycle-time slice for W AND in W's extracted-subset, the per-PR drill-down values equal P's per-PR contribution to `rollup[W].by_author_comments[P's author OR sentinel]`'s corresponding numeric fields.
- **FR-2-02 (independent re-computation)**: For each (W, author) tuple, the test independently re-computes the expected values by direct SQL against `pull_requests` + `users` (LEFT JOIN for sentinel detection) + `pr_threads` + `pr_comments`, applies C1, sums per-PR contributions, re-derives `coverage_partial`, asserts equality with the aggregator's emission.
- **FR-2-03 (sentinel parity)**: For each W, the sentinel bucket's metrics equal the SUM of contributions from ALL PRs whose `author_id` is absent from `users` in W's extracted-subset.

The 333 round-9 import-block isolation (`tests/integration/test_comments_trend_reconciliation_isolation.py`) covers the extension automatically — the `aggregators.py` import is forbidden by FILE, not by dimension scope.

The 333 failure-mode meta-test (`tests/integration/test_comments_trend_meta_failure.py`) is extended per FR-2-05 with a per-author INV-2-07 violation injection (e.g., a sentinel bucket with `active_thread_count > thread_count`); the meta-test asserts the FR-2-04 reconciliation test FAILS on the mutated dataset.

## §7 What this contract does NOT govern

- **Per-PR `PrRecord` schema** — that's 310's contract (`pr-record-comments-fields.md`). Frozen.
- **Weekly comments aggregate `rollup[W].comments`** — that's 333's contract (`weekly-comments-aggregate.md`). Not modified.
- **Existing throughput `rollup[W].by_author`** — `BreakdownEntry` shape (throughput-only fields). Not modified.
- **Per-team / per-repo / per-reviewer breakdowns** — out of scope per #321 / #335 / #336.
- **Click-through behavior on rendered rows** — FR-4-09 NO click-through; future feature owns any per-author drill-down.
- **i18n of sentinel label** — out of scope per CL-03 informed default; English-only for v1.
- **Lifting 310 INV-02 top-500 cap** — out of scope; chart aggregates over W's full extracted-subset per Spec Background.
- **CSV / extractor changes** — INV-2-04 / INV-2-05 frozen.

## §8 Example emitted rollup excerpt (capability-on)

```jsonc
{
  "week": "2026-W17",
  "pr_count": 47,
  "by_author": { /* existing throughput-only fields, unchanged */ },
  "comments": { /* existing 333 weekly aggregate, unchanged */
    "thread_count": 312,
    "comment_count": 1248,
    "active_thread_count": 41,
    "coverage_partial": false
  },
  "by_author_comments": {
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
      "coverage_partial": true
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

## §9 Example emitted rollup excerpt (capability-off)

Identical to the pre-feature shape; no `by_author_comments` key at all.

```jsonc
{
  "week": "2026-W17",
  "pr_count": 47,
  "by_author": { /* existing throughput-only fields */ }
  // no `comments` key (333 also omits under capability-off)
  // no `by_author_comments` key (this feature also omits)
}
```
