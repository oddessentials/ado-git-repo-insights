# Contract: Weekly comments aggregate object (Feature 333)

**Scope**: producer (`src/ado_git_repo_insights/transform/aggregators.py`) + consumer (`extension/ui/schemas/rollup.schema.ts`, `extension/ui/modules/charts/comments-trend.ts`).

**Authoritative spec refs**: [spec.md](../spec.md) — FR-1-04, FR-2-03, FR-2-06, FR-3-03, INV-1-06, INV-1-07, INV-1-08. Sibling contract: [`sc05-reconciliation-test.md`](./sc05-reconciliation-test.md).

**Inclusion rules**: the C1 inclusion rules that govern `thread_count`, `comment_count`, and `active_thread_count` are defined ONCE in [`specs/310-comments-visualization/spec.md`](../../310-comments-visualization/spec.md) lines 75–87. This contract REFERENCES them; it does NOT re-declare (INV-1-03 / DIRECTIVE 7).

**Schema-parity gate scope**: this contract is **NOT** parsed by `scripts/check_pr_record_schema_parity.py` (per FR-3-03 + Out of Scope: that gate covers per-PR PrRecord fields only). Weekly-comments-aggregate parity is enforced by the SC-05 reconciliation test (see sibling contract).

---

## §1 Canonical field declaration

The `comments` sub-object lives at the rollup root: `rollup[W].comments`. Optional at the rollup root level; atomic when present (INV-1-08).

| Field | Python type (aggregator emission) | TypeScript type (schema declaration) | Required when `comments` exists | Computation reference |
|---|---|---|---|---|
| `thread_count` | `int` | `number` | yes | FR-2-06 + extracted-subset rule (FR-2-03) |
| `comment_count` | `int` | `number` | yes | FR-2-06 + extracted-subset rule (FR-2-03) |
| `active_thread_count` | `int` | `number` | yes | FR-2-06 + extracted-subset rule (FR-2-03) |
| `coverage_partial` | `bool` | `boolean` | yes | FR-2-06 (`true` iff any PR in W's canonical throughput PR set has `comments_extracted_at IS NULL`) |

**Type compatibility**:

- All three numeric fields MUST be `int` Python ↔ `number` TypeScript (non-null on both sides).
- The boolean MUST be `bool` Python ↔ `boolean` TypeScript.
- The wrapping `comments` object itself is OPTIONAL at the rollup root (`comments?: { ... }` in TS, `NotRequired[CommentsAggregate]` in Python TypedDict if a TypedDict shape is defined).

**Atomicity (INV-1-08)**:

- When the `comments` key is present on a rollup, ALL FOUR fields above MUST be present, with non-null values.
- Partial `comments` objects (3 of 4 fields, or all 4 with nulls) are a contract violation.
- The schema validator (Phase 1 task: extend `extension/ui/schemas/rollup.schema.ts`) MUST detect partial-shape violations and report them as ERRORS in strict mode (matching the existing PrRecord INV-08 atomicity validator at `rollup.schema.ts:564`).

**Capability gating (FR-3-03)**:

- When `capabilities.comments_metrics === false` on the manifest, the entire `comments` key MUST be absent from every week's rollup. Not `{}`, not `null` — absent.
- Capability-off byte-identity test gates this; see §3 below.

## §2 Producer contract (Python aggregator)

**Where it lives**: `src/ado_git_repo_insights/transform/aggregators.py`, inside the existing `_generate_weekly_rollups()` per-week emission loop (~line 590 in current base; line numbers to be confirmed at task-execution time).

**Behavior**:

1. Read `_has_comments()` (existing helper, ~line 1485 in current base).
2. **If `_has_comments()` returns `False`**: serialize the rollup WITHOUT the `comments` key. Do NOT emit it as `{}` or `null`. STOP — rest of this contract does not apply.
3. **If `_has_comments()` returns `True`**: for each week W:
   a. Determine W's canonical throughput PR set using throughput's week-attribution rule (per FR-2-03 (a) shared canonical helper OR (b) per-PR parity test — task-level decision).
   b. Filter to W's extracted-subset: `WHERE pull_requests.comments_extracted_at IS NOT NULL`.
   c. For each PR in the extracted-subset, query `pr_threads` and `pr_comments` and apply C1 inclusion rules.
   d. Sum per-PR contributions → integer values for `thread_count`, `comment_count`, `active_thread_count`.
   e. `coverage_partial` = `(|W's canonical set| != |W's extracted-subset|)` — boolean.
   f. Emit `"comments": { "thread_count": ..., "comment_count": ..., "active_thread_count": ..., "coverage_partial": ... }` on the rollup root, atomically.

**SQL pattern reference**: similar to the per-PR query in 310's `pr-record-comments-fields.md` §2, but unscoped from the top-500 cap and aggregated to per-week sums with the extracted-subset filter:

```sql
-- Pseudo-SQL (final form is task-level)
SELECT
  COALESCE(SUM(t.thread_count), 0)        AS thread_count,
  COALESCE(SUM(c.comment_count), 0)       AS comment_count,
  COALESCE(SUM(t.active_thread_count), 0) AS active_thread_count,
  EXISTS (
    SELECT 1 FROM pull_requests pr
    WHERE pr.pull_request_uid IN (W's canonical throughput PR set)
      AND pr.comments_extracted_at IS NULL
  ) AS coverage_partial
FROM pull_requests pr
LEFT JOIN (
  SELECT pull_request_uid,
         COUNT(*)                                   AS thread_count,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_thread_count
  FROM pr_threads
  WHERE is_deleted = 0
  GROUP BY pull_request_uid
) t ON t.pull_request_uid = pr.pull_request_uid
LEFT JOIN (
  SELECT pull_request_uid, COUNT(*) AS comment_count
  FROM pr_comments
  WHERE is_deleted = 0
  GROUP BY pull_request_uid
) c ON c.pull_request_uid = pr.pull_request_uid
WHERE pr.pull_request_uid IN (W's canonical throughput PR set)
  AND pr.comments_extracted_at IS NOT NULL;
```

(SQL form locked at task time. Note the `EXISTS` for `coverage_partial` runs a separate query at the canonical-set scope, not the extracted-subset scope — that's the intent.)

**S608 compliance**: dynamic IN-clause construction MUST follow the pattern at `reference_s608_refactor_pattern.md` (use `" ".join([...])` or temp-table-join, never `# noqa: S608`).

## §3 Consumer contract (TypeScript schema + chart)

**Schema declaration** (in `extension/ui/schemas/rollup.schema.ts`):

```ts
// New optional sub-object on the Rollup interface
export interface Rollup {
  // ... existing fields unchanged ...
  comments?: {
    thread_count: number;
    comment_count: number;
    active_thread_count: number;
    coverage_partial: boolean;
  };
}
```

**KNOWN_ROOT_FIELDS update**: add `"comments"` to the existing `KNOWN_ROOT_FIELDS` set (currently at `rollup.schema.ts:132`). This satisfies the existing `should FAIL in strict mode when unknown fields present` test path AND the `should produce warnings for unknown fields in nested breakdown (permissive mode)` test path. The validator will accept the new key.

**Atomicity validator**: extend the validator (alongside the existing per-PR INV-08 check at `rollup.schema.ts:564`) to assert the `comments` sub-object's atomicity:

- When `comments` key present: all four fields MUST be present with the correct types. Partial shape = error in both strict and permissive mode (this is INV-1-08, and unlike the PrRecord-level INV-08 it is NOT a "warning" condition).
- Numeric fields: integer or floating-point `number`, not null.
- Boolean field: strict `boolean`, not null/undefined/string.

**ADR T004 — atomicity posture**

- **Decision**: STRICT ERROR in both strict and permissive modes (per INV-1-08). The validator MUST push to the result's `errors` array (not `warnings`) when the `comments` sub-object is present with partial shape; the `strict` parameter is irrelevant for this check.
- **Why**:
  - (a) The per-PR INV-08 validator's "warning" posture exists for backward-compat with pre-310 emissions that may legitimately have partial shape. INV-1-08 is a NEW contract introduced by Feature 333 with no existing emissions to be lenient toward — there is nothing to be backward-compatible with.
  - (b) Renderers (the new `comments-trend.ts` chart, plus any future consumer) see `rollup[W].comments` and reasonably trust atomicity per this contract; a partial-shape regression slipping through as a warning would force every renderer to add defensive null-checks per field, defeating the contract's purpose.
  - (c) The per-PR INV-08 validator at `rollup.schema.ts:560-567` is observed to push partial-shape violations to the `warnings` array unconditionally — the `strict` parameter is not branched on inside the atomicity check, so a partial shape emits the same warning in both modes (mode-independent warning). INV-1-08's strict-in-both-modes posture is one tier stricter (error vs. warning), justified by being a fresh contract with no legacy emissions to grandfather.
- **Rejected alternative**: warning + permissive accept (mirroring per-PR INV-08). Rejected because it would silently allow partial-shape regressions to ship to consumers, undermining INV-1-08 as a contract — the whole point of INV-1-08 is that renderers can trust atomicity without per-field defensive checks.

**Schema test extension** (`extension/tests/schema/rollup.test.ts`): add cases verifying:
- Valid `comments` object passes.
- Partial `comments` (missing one field) fails validation.
- `comments` with null values fails validation.
- Rollup without `comments` key passes (capability-off scenario).
- Wrong types in `comments` fields fail.

## §4 Schema-parity gate scope (explicit non-extension)

Per FR-3-03 + spec Out of Scope: the existing per-PR PrRecord schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is **NOT** extended to cover this contract.

The decision is locked. The SC-05 reconciliation test (FR-2-04, see sibling contract `sc05-reconciliation-test.md`) is the sole authority for weekly-comments-aggregate parity — it verifies values, not just field shapes, which is strictly stronger than schema-parity drift detection would be.

## §5 Demo dataset gating (FR-3-03)

The capability-off demo variant MUST emit rollups WITHOUT the `comments` key. The byte-identity test at `tests/integration/test_demo_variants_byte_identity.py` MUST be tightened to gate the new key across all four omission failure modes (key absent, `null`-valued, `{}`-valued, partial-fielded), so a future regression that emits the `comments` object under capability-off is caught at CI rather than at the dashboard render layer.

**ADR T001 — byte-identity test extension target**

- **Pinned**: `tests/integration/test_demo_variants_byte_identity.py`.
- **Why**: this file already implements the capability-on-vs-capability-off variant comparison via a module-scoped `variant_trees` fixture that runs `scripts/generate-demo-data.py` twice (`--comments-metrics true` and `--comments-metrics false`) into sibling scratch dirs, then compares the trees with explicit gated-key strip (`_GATED_MANIFEST_PATHS = frozenset({("capabilities", "comments_metrics"), ("features", "comments"), ("coverage", "comments")})` and `_GATED_PR_FIELDS = frozenset({"thread_count", "comment_count", "active_thread_count"})`). Adding the new rollup-level `comments` key to the gated set is a 1-line extension of the existing assertion model — exactly the "rollup-level key absent in capability-off variant" gate FR-3-03 needs.
- **Rejected**: `tests/demo/test_demo_parity_pipeline.py`. This file tests `build-demo-dataset.py` build/promote pipeline correctness against a single canonical artifact root (capability-matrix, startup-parity, reviewer-fixture validation, strip-gate atomicity) — it has no capability-on-vs-off variant comparison and no gated-key strip mechanism. Hosting the FR-3-03 extension here would require inventing a brand new comparison harness, defeating the "extend existing locked-shape gate" intent.
