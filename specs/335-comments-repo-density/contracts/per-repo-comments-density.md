# Contract: Per-repo comments-density emission (Feature 335)

**Scope**: producer (`src/ado_git_repo_insights/transform/aggregators.py`) + consumer (`extension/ui/schemas/rollup.schema.ts`, `extension/ui/modules/charts/comments-repository-density.ts`).

**Authoritative spec refs**: [spec.md](../spec.md) — FR-1-01..FR-1-10, FR-2-01..FR-2-05, FR-3-01..FR-3-04, FR-4-01..FR-4-11, INV-3-01..INV-3-12, SC-1-01..SC-1-06. Sibling foundation: [`specs/333-comments-trend-chart/contracts/weekly-comments-aggregate.md`](../../333-comments-trend-chart/contracts/weekly-comments-aggregate.md), [`specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md`](../../333-comments-trend-chart/contracts/sc05-reconciliation-test.md), [`specs/334-comments-author-density/contracts/per-author-comments-density.md`](../../334-comments-author-density/contracts/per-author-comments-density.md).

**Inclusion rules**: the C1 inclusion rules that govern `thread_count`, `comment_count`, and `active_thread_count` are defined ONCE in [`specs/310-comments-visualization/spec.md`](../../310-comments-visualization/spec.md) "Shared inclusion-rule contract (C1)". This contract REFERENCES them; it does NOT re-declare (INV-3-03).

**Schema-parity gate scope**: this contract is **NOT** parsed by `scripts/check_pr_record_schema_parity.py` (per CL-08 + spec Out of Scope). Per-repo comments-density parity is enforced by the SC-05 reconciliation test extension (FR-2-04, see §4) and the cross-aggregate sum-coherence assertion (FR-2-03, see §6).

---

## §1 Canonical field declaration

The `by_repository_comments` outer dict lives at the rollup root: `rollup[W].by_repository_comments`. Outer dict keys are `repository_id` strings (FK-protected per CL-03 — no sentinel literal); inner values are 4-field entries. Optional at the rollup root level; atomic per entry when present (INV-3-08).

| Field | Python type (aggregator emission) | TypeScript type (schema declaration) | Required when entry exists | Computation reference |
|---|---|---|---|---|
| `thread_count` | `int` | `number` | yes | FR-1-05 + extracted-subset rule per repo |
| `comment_count` | `int` | `number` | yes | FR-1-05 + extracted-subset rule per repo |
| `active_thread_count` | `int` | `number` | yes | FR-1-05 + extracted-subset rule per repo |
| `coverage_partial` | `bool` | `boolean` | yes | FR-1-06 (`true` iff any of repo R's PRs in W's canonical throughput PR set has `comments_extracted_at IS NULL`) |

**Type compatibility**:

- All three numeric fields MUST be `int` Python ↔ `number` TypeScript (non-null on both sides; integer constraint enforced at validator level).
- The boolean MUST be `bool` Python ↔ `boolean` TypeScript.
- The wrapping outer dict (`by_repository_comments`) is OPTIONAL at the rollup root (`by_repository_comments?: Record<string, RepositoryCommentsDensityEntry>` in TS). Capability-off omits the entire key.

**Atomicity (INV-3-08)**:

- When the `by_repository_comments` key is present on a rollup, EVERY entry in the outer dict MUST contain ALL FOUR fields above, with non-null values.
- Partial entries (3 of 4 fields, or all 4 with nulls) are a contract violation.
- The schema validator (Phase 1 task: extend `extension/ui/schemas/rollup.schema.ts`) MUST detect partial-shape violations and report them as ERRORS in strict mode AND in permissive mode (mirroring 334's `validateAuthorCommentsDensity` posture). One tier stricter than the per-PR `PrRecord` INV-08 validator's posture; rationale matches 334 ADR T003 (no legacy emissions to grandfather).

**Capability gating (FR-3-03)**:

- When `capabilities.comments_metrics === false` on the manifest, the entire `by_repository_comments` key MUST be absent from every week's rollup. Not `{}`, not `null`, not present-with-partial-entries — absent.
- Capability-off byte-identity test gates this; see §5.

**No sentinel literal (CL-03 / FR-1-03 / INV-3-12)**:

- `repository_id` is FK-protected (`pull_requests.repository_id REFERENCES repositories(repository_id)` at `src/ado_git_repo_insights/persistence/models.py:88`); unknown-to-`repositories` IDs cannot exist in a well-formed production database.
- The aggregator MUST NOT emit a sentinel bucket. The renderer MUST NOT carry a fixed-string sentinel label-mapping branch. There is NO producer-side collision-safety unit test (334 T029 equivalent is intentionally NOT carried over).
- FK-violation production-data edge: aggregator MUST surface the violation per CL-03's FAIL-LOUD posture (raise vs. structured warning at build-time gate — plan-level wiring decision in tasks).

## §2 Producer contract (Python aggregator)

**Where it lives**: `src/ado_git_repo_insights/transform/aggregators.py`, inside the existing `_generate_weekly_rollups()` per-week emission loop. New helper `_compute_weekly_by_repository_comments(week_pr_uids: set[str])` paralleling existing `_compute_weekly_by_author_comments` at `aggregators.py:1088`.

**Behavior**:

1. Read `_has_comments()` (existing helper).
2. **If `_has_comments()` returns `False`**: serialize the rollup WITHOUT the `by_repository_comments` key. Do NOT emit it as `{}` or `null`. STOP — rest of this contract does not apply.
3. **If `_has_comments()` returns `True`**: for each week W:
   a. Determine W's canonical throughput PR set using throughput's week-attribution rule (same `closed_date → ISO-week` formula 333 / 334 / throughput use; per-PR parity guard at `tests/integration/test_week_attribution_parity.py` covers drift).
   b. For each PR P in W's canonical set: read `P.repository_id` directly. NO LEFT JOIN-style sentinel detection (CL-03 — repository_id is FK-protected).
   c. Group PRs by `repository_id`.
   d. For each bucket: filter to W's extracted-subset for that bucket (PRs in repo R with `comments_extracted_at IS NOT NULL`); query `pr_threads` and `pr_comments` per PR with C1 inclusion rules applied; sum per-PR contributions to produce integer `thread_count`, `comment_count`, `active_thread_count`.
   e. For each bucket: compute `coverage_partial = (∃ PR in repo R in W's canonical set with comments_extracted_at IS NULL)` — boolean. Each bucket has its OWN `coverage_partial` flag.
   f. Build the inner dict for each bucket: `{ "thread_count": ..., "comment_count": ..., "active_thread_count": ..., "coverage_partial": ... }`.
   g. Build the outer dict: `{ <repository_id>: <inner_dict>, ... }`.
   h. If the outer dict is empty (no PRs in W's canonical set), DO NOT emit the `by_repository_comments` key (FR-1-10 + FR-3-03 omission contract).
   i. Otherwise, emit `"by_repository_comments": <outer_dict>` on the rollup root, atomically.

**SQL pattern reference**: parallel to 334's `_compute_weekly_by_author_comments` at `aggregators.py:1088`, simplified by removing the `LEFT JOIN users` + sentinel-CASE branch:

```sql
-- Pseudo-SQL (final form is task-level)
SELECT
  pr.repository_id AS repository_id,
  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL THEN t.thread_count ELSE 0 END), 0) AS thread_count,
  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL THEN c.comment_count ELSE 0 END), 0) AS comment_count,
  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL THEN t.active_thread_count ELSE 0 END), 0) AS active_thread_count,
  MAX(CASE WHEN pr.comments_extracted_at IS NULL THEN 1 ELSE 0 END) AS coverage_partial
FROM pull_requests pr
INNER JOIN _aggr_week_by_repository_comments_slice s
  ON s.pull_request_uid = pr.pull_request_uid
LEFT JOIN (
  SELECT pull_request_uid,
         COUNT(*) AS thread_count,
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
GROUP BY pr.repository_id
ORDER BY pr.repository_id ASC;
```

(Final SQL form locked at task time; uses the same temp-table-join pattern 334 uses for the `week_pr_uids` slice — S608 compliance per `reference_s608_refactor_pattern.md`.)

**Determinism (QG-05)**:

- Stable bucket-key set (deterministic GROUP BY result).
- Inner dict field order matches §1 declaration: `thread_count`, `comment_count`, `active_thread_count`, `coverage_partial`.
- **Outer dict key order: ascending by `repository_id`** — the stable identity string. Display name MUST NOT be the producer's sort key (display names can collide; only `repository_id` is guaranteed unique per the FK). UI tie-break (FR-4-05) is the renderer's responsibility.

**Failure modes**:

- If `pr_threads` or `pr_comments` tables do not exist on a legacy DB: `_has_comments()` returns `False`; no `by_repository_comments` key emitted. Capability flag reads `False` in the manifest. Renderer shows no breakdown surface.
- If a week W has zero PRs in its canonical throughput PR set: the outer dict is empty → `by_repository_comments` key NOT emitted (FR-1-10).
- If a bucket's extracted-subset is empty (all PRs in repo R in W are unextracted): the bucket's three numeric fields are 0; `coverage_partial` is `true`. Bucket IS emitted (one entry with all zeros + partial flag) — required so the renderer's range-total reduction can propagate the partial signal.
- If a PR's `repository_id` is missing from the `repositories` table (FK-violation production data — should never occur per CL-03): aggregator MUST surface the violation FAIL-LOUD per CL-03; plan-level wiring decision on the exact mechanism.

**Cross-bucket atomicity (INV-3-08)**: every emitted entry has all four fields. The aggregator achieves this by emitting each bucket as a single dict literal — atomic at the dict construction site.

**Ordering (INV-3-07)**: every entry satisfies `active_thread_count <= thread_count`.

## §3 Consumer contract (TypeScript schema + chart)

**Schema declaration** (in `extension/ui/schemas/rollup.schema.ts`):

```ts
export interface RepositoryCommentsDensityEntry {
  thread_count: number;
  comment_count: number;
  active_thread_count: number;
  coverage_partial: boolean;
}

export interface Rollup {
  // ... existing fields unchanged ...
  by_repository_comments?: Record<string, RepositoryCommentsDensityEntry>;
}
```

**KNOWN_ROOT_FIELDS update**: add `"by_repository_comments"` to the existing `KNOWN_ROOT_FIELDS` set (currently at `rollup.schema.ts:201` — the existing entry for `"by_author_comments"` from #334 was added next to where `"comments"` was added by 333). This satisfies both the strict-mode "FAIL on unknown fields" path and the permissive-mode warnings path.

**Atomicity validator** (`validateRepositoryCommentsDensity`): new function alongside the existing `validateAuthorCommentsDensity` (`rollup.schema.ts:832`) and `validateCommentsAggregate` (`rollup.schema.ts:671`). Asserts:

- When `by_repository_comments` key present: outer value must be a non-null object; non-empty (empty `{}` violates FR-1-10).
- For each entry in the outer object: all 4 fields present with correct types per §1.
  - Numeric fields: `number`, non-null, non-negative integer.
  - `coverage_partial`: strict boolean.
  - Partial shape → ERROR (strict in both modes — mirrors 334 / 333 STRICT-ERROR posture).
- Ordering (INV-3-07): `active_thread_count <= thread_count` per entry → ERROR if violated.

**Atomicity posture (STRICT ERROR in both modes)**: same rationale as 333's `validateCommentsAggregate` and 334's `validateAuthorCommentsDensity`. INV-3-08 atomicity is a NEW contract introduced by this feature with no existing emissions to be lenient toward. A partial-shape regression slipping through as a warning would force every renderer to add defensive null-checks per field, defeating the contract's purpose.

**Schema test extension** (`extension/tests/schema/rollup.test.ts`): add cases verifying:

- Valid 4-field entry passes.
- Partial entry (missing one field) fails validation.
- Entry with null values fails validation.
- Rollup without `by_repository_comments` key passes (capability-off scenario).
- Wrong-typed fields (e.g., `thread_count` is a string) fail.
- `active_thread_count > thread_count` per entry fails (INV-3-07).
- Empty `{}` outer dict fails (FR-1-10 — key MUST be omitted entirely when no buckets).

**Chart module display-label resolution** (FR-4-11 / CL-04):

```ts
// In comments-repository-density.ts — directory pattern
function buildRepositoriesDirectory(
  repositoriesDimension: readonly RepoDirectoryEntry[] | undefined,
): Map<string, string> | null {
  if (!repositoriesDimension) return null;
  const map = new Map<string, string>();
  for (const entry of repositoriesDimension) {
    if (typeof entry.repository_id === "string" && typeof entry.repository_name === "string") {
      map.set(entry.repository_id, entry.repository_name);
    }
  }
  return map;
}

function resolveDisplayLabel(repositoryId: string, directory: Map<string, string> | null): string {
  // CL-04 + FR-4-11: dimension lookup first, raw ID fallback
  return directory?.get(repositoryId) ?? repositoryId;
}
```

The fallback path (`?? repositoryId`) MUST be exercised by a unit test in `comments-repository-density.test.ts` — fixture with one bucket whose `repository_id` is absent from the `repositoriesDimension` array; assert the rendered row label equals the raw ID.

## §4 Schema-parity gate scope (explicit non-extension)

Per CL-08 + spec Out of Scope: the existing per-PR `PrRecord` schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is **NOT** extended to cover this contract.

The decision is locked. The SC-05 reconciliation test extension (FR-2-04, in-place to `tests/integration/test_comments_trend_reconciliation.py` per CL-05) plus the FR-2-03 cross-aggregate sum-coherence assertion are the sole authority for per-repo comments-density parity — they verify values, which is strictly stronger than schema-shape parity drift detection would be.

## §5 Demo dataset gating (FR-3-03)

The capability-off demo variant MUST emit rollups WITHOUT the `by_repository_comments` key. The byte-identity test at `tests/integration/test_demo_variants_byte_identity.py` MUST be extended to gate the new key across all four omission failure modes (key absent, `null`-valued, `{}`-valued, partial-fielded).

**Extension target locked**: add `"by_repository_comments"` to the existing `_GATED_*` namespace strip set (333 added `"comments"`; 334 added `"by_author_comments"`; this feature adds the per-repo sibling). The 4 omission failure modes gate individually per the existing pattern.

## §6 Reconciliation contract reference + cross-aggregate sum-coherence (NEW for this feature)

The SC-05 reconciliation extension (FR-2-04) extends `tests/integration/test_comments_trend_reconciliation.py` in-place per CL-05. The new assertions:

- **FR-2-01 (per-repo parity — pairwise on extracted-subset)**: For every PR P in the drill-down's top-500-by-cycle-time slice for W AND in W's extracted-subset, the per-PR drill-down values equal P's per-PR contribution to `rollup[W].by_repository_comments[P.repository_id]`'s corresponding numeric fields.
- **FR-2-02 (independent re-computation)**: For each (W, repo) tuple, the test independently re-computes the expected values by direct SQL against `pull_requests` (grouped by `repository_id`) + `pr_threads` + `pr_comments`, applies C1, sums per-PR contributions, re-derives `coverage_partial`, asserts equality with the aggregator's emission.
- **FR-2-03 (cross-aggregate sum-coherence — NEW for this feature)**: For every week W where both `rollup[W].comments` and `rollup[W].by_repository_comments` are emitted (non-empty), the test asserts:
  - `SUM_repo by_repository_comments[r].thread_count` EQUALS `comments.thread_count`.
  - `SUM_repo by_repository_comments[r].comment_count` EQUALS `comments.comment_count`.
  - `SUM_repo by_repository_comments[r].active_thread_count` EQUALS `comments.active_thread_count`.
  - `OR_repo by_repository_comments[r].coverage_partial` EQUALS `comments.coverage_partial`.

  The truncated W26 demo fixture (`docs/data/aggregates/weekly_rollups/2025-W26.json` — `_prs_truncated: true`) is the WITNESS that this contract holds even when the per-PR drill-down is truncated. Both `comments` (333) and `by_repository_comments` (this feature) compute over the FULL canonical extracted-subset per FR-1-09 / 333 FR-2-03 / 334 INV-2-10. The test is week-agnostic — it iterates every week W where both aggregates are emitted; W26 is the current witness but the assertion survives demo regeneration if truncation shifts to a different week per A-11.

The 333 round-9 import-block isolation (`tests/integration/test_comments_trend_reconciliation_isolation.py`) covers the extension automatically — the `aggregators.py` import is forbidden by FILE, not by dimension or test-function scope.

The 333 / 334 failure-mode meta-test (`tests/integration/test_comments_trend_meta_failure.py`) is extended per FR-2-05 with TWO injections:
- Per-repo INV-3-07 violation (e.g., a bucket with `active_thread_count > thread_count`); meta-test asserts FR-2-04 reconciliation FAILS on the mutated dataset.
- Per-week sum-coherence violation (mutate one bucket's `thread_count` to break FR-2-03); meta-test asserts FR-2-04 reconciliation FAILS on the mutated dataset.

## §7 What this contract does NOT govern

- **Per-PR `PrRecord` schema** — that's 310's contract. Frozen.
- **Weekly comments aggregate `rollup[W].comments`** — that's 333's contract. Not modified (verified via FR-2-03 sum-coherence on the consumer side).
- **Per-author comments-density `rollup[W].by_author_comments`** — that's 334's contract. Not modified.
- **Existing throughput `rollup[W].by_repository`** — `BreakdownEntry` shape (throughput-only fields). Not modified.
- **Per-team / per-reviewer breakdowns** — out of scope per #321 / #336.
- **Click-through behavior on rendered rows** — FR-4-09 NO click-through; future feature owns any per-repo drill-down.
- **i18n of repository names** — out of scope (dimension provides `repository_name` as-published).
- **Lifting 310 INV-02 top-500 cap** — out of scope; both aggregates compute over W's full canonical extracted-subset per Spec Background.
- **CSV / extractor changes** — INV-3-04 / INV-3-05 frozen.

## §8 Example emitted rollup excerpt (capability-on)

```jsonc
{
  "week": "2026-W17",
  "pr_count": 47,
  "by_repository": { /* existing throughput-only fields, unchanged */ },
  "by_author_comments": { /* existing 334 per-author aggregate, unchanged */ },
  "comments": { /* existing 333 weekly aggregate, unchanged */
    "thread_count": 312,
    "comment_count": 1248,
    "active_thread_count": 41,
    "coverage_partial": false
  },
  "by_repository_comments": {
    "abc-123-def-456-...": {
      "thread_count": 184,
      "comment_count": 720,
      "active_thread_count": 22,
      "coverage_partial": false
    },
    "xyz-789-...": {
      "thread_count": 128,
      "comment_count": 528,
      "active_thread_count": 19,
      "coverage_partial": true
    }
  }
}
```

(Note: `184 + 128 == 312`, `720 + 528 == 1248`, `22 + 19 == 41`, `(false OR true) == true === comments.coverage_partial`. The example weeks are illustrative; demo dataset values come from `scripts/build-demo-dataset.py`.)

## §9 Example emitted rollup excerpt (capability-off)

Identical to the pre-feature shape; no `by_repository_comments` key at all.

```jsonc
{
  "week": "2026-W17",
  "pr_count": 47,
  "by_repository": { /* existing throughput-only fields */ }
  // no `comments` key (333 also omits under capability-off)
  // no `by_author_comments` key (334 also omits under capability-off)
  // no `by_repository_comments` key (this feature also omits)
}
```
