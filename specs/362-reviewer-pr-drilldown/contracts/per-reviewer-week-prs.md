# Contract: Per-(Reviewer, Week) PR-Level Detail Emission

**Scope**: producer (Python aggregator) — `src/ado_git_repo_insights/transform/aggregators.py` `_generate_reviewer_slice` (currently at `:2139-2201`) and the demo-generator parallel-path at `scripts/generate-demo-data.py` `_generate_reviewer_breakdown` (currently at `:1764-...`).

**Authoritative spec refs**: FR-016, FR-022, FR-023, FR-028, FR-029. Feature 060's `pr-record.md` contract governs the per-PR record shape; this contract specifies only the per-(reviewer, week) emission, sort, cap, atomicity, and strip semantics.

> This contract governs the **producer-side** emission of the per-(reviewer, week) `prs[]` field on each `by_reviewer[reviewerId]` entry. The consumer-side rendering contract is in [`reviewer-pr-list.md`](./reviewer-pr-list.md).

## 1. Emission shape

Each `by_reviewer[reviewerId]` entry on the rollup MUST carry the existing 5 fields plus the new atomic trio:

```json
{
  "reviewed_prs": <int>,
  "reviews_count": <int>,
  "approval_rate": <float | null>,
  "authors_count": <int>,
  "repositories_count": <int>,
  "prs": [<PrRecord>, ...],
  "_prs_truncated": <bool>,
  "_prs_cap": <int>
}
```

The trio (`prs`, `_prs_truncated`, `_prs_cap`) is **atomic**: present together or absent together. A reviewer entry that emits `prs` without the marker pair is a contract violation; the validator warns and the consumer renders `supported-empty`.

**When the trio is emitted**: every reviewer entry where the reviewer cast at least one non-zero vote in the week (the existing `outcome_group` filter at `aggregators.py:2177-2179`). This matches the existing `reviewed_prs > 0` precondition for emitting the entry at all.

**When the trio is absent**: never under normal producer operation. The trio is part of the entry's atomic shape. If a future producer change emits a reviewer entry WITHOUT the trio (e.g., for a "reviewer assigned but never voted" scenario that the existing aggregator already filters out), the consumer's permissive validator fails-soft to `supported-empty` per FR-011.

## 2. Scope (which PRs are included)

The per-(reviewer, week) `prs[]` array is the set of `PrRecord` objects for PRs the focused reviewer cast a non-zero vote on in the week. Specifically:

- For each PR in the week (`week_group` rows after the existing `closed_date IS NOT NULL AND status = 'completed'` filter at `aggregators.py:629-630`), if the reviewer's row in `reviewer_prs` (the merge of `week_reviewers` × `week_group`) has `vote.notna() AND vote != 0`, the PR is included.
- This matches the existing `outcome_group` derivation at `aggregators.py:2177-2179`. The new emission reuses the same filter — no divergence.

**Rationale for non-zero-vote scope**: matches the existing `reviewed_prs` count semantic ("Phase 1 reviewer activity only counts stored review outcomes" — `aggregators.py:2174-2176`). Including assigned-but-never-voted PRs would diverge from the panel's `PRs reviewed` stat-row value, breaking the "the panel's headline number matches the row count" coherence the user expects.

## 3. Sort order

The slice MUST be sorted by `cycle_time desc, id asc` BEFORE the cap is applied. Specifically:

```python
qualified_sorted = qualified.sort_values(
    by=["cycle_time_minutes", "pull_request_id"],
    ascending=[False, True],
    kind="stable",  # for cross-call deterministic tiebreak
)
```

(Exact column names map to the existing `week_group` columns: `cycle_time_minutes`, `pull_request_id` per `aggregators.py:613-624`.)

**Sort-before-truncate is a contract semantic**: when the slice is truncated, the retained 500 records MUST be the 500 records with the highest `cycle_time_minutes` (with `pull_request_id` ascending tiebreak). The truncated tail (the records dropped beyond the cap) MUST be the fastest records, NOT an arbitrary first-500 slice.

This preserves the user-visible "slowest first" contract across the truncation boundary: when truncation fires, the user is seeing the highest-cycle-time PRs the reviewer reviewed, which is precisely what the "slowest first" reading promises.

## 4. Cap value and constant alias

Cap value is **500**, exposed as a producer-side constant alias in `src/ado_git_repo_insights/transform/aggregators.py` near the existing `_PR_DETAIL_CAP = 500` declaration at `:84`:

```python
_PR_DETAIL_CAP: Final[int] = 500
_PR_DETAIL_CAP_PER_REVIEWER_WEEK: Final[int] = _PR_DETAIL_CAP
```

The alias provides:

1. A single source of truth — future divergence between per-week and per-(reviewer, week) caps requires a one-line edit at the alias declaration, not a grep across call sites.
2. Self-documentation — call sites that read `_PR_DETAIL_CAP_PER_REVIEWER_WEEK` are visibly per-(reviewer, week) scope; call sites that read `_PR_DETAIL_CAP` are visibly per-week scope.
3. Backward compatibility — the existing `_PR_DETAIL_CAP` is unchanged, so the existing per-week emission at `aggregators.py:870-872` continues working without edit.

**`_prs_cap` value emitted**: always 500. The cap is constant under this contract; it does not vary by week, reviewer, or any other axis.

## 5. Atomicity invariant

The trio (`prs`, `_prs_truncated`, `_prs_cap`) is emitted atomically:

| Pre-truncation slice size                                                                                                                   | `prs` length           | `_prs_truncated` | `_prs_cap` |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------- | ---------- |
| 0 (reviewer cast no qualifying votes — entry would not be emitted at all per the existing `if reviewed_prs == 0: continue` at `:2182-2183`) | N/A                    | N/A              | N/A        |
| 1 to 500 inclusive                                                                                                                          | == pre-truncation size | `false`          | 500        |
| 501 or more                                                                                                                                 | 500                    | `true`           | 500        |

**Boundary semantic at exactly 500**: `_prs_truncated` is `false`. The slice is at the cap but NOT past it; nothing was dropped. This matches the user's CL-02 guardrail #2: "\_prs_truncated: true only when the slice exceeded 500 BEFORE truncation."

**Boundary semantic at 501**: `_prs_truncated` is `true`. The slice was 501 records before truncation; the producer dropped 1 record (the fastest by cycle-time) to fit the cap. The retained 500 records contain the 500 highest-cycle-time PRs.

## 6. Atomicity test (FR-029 cap-boundary regression)

A producer-side test MUST exist (`tests/unit/test_aggregators_reviewer_pr_detail.py` per the plan) that locks the boundary semantics:

1. **At exactly 500 PRs reviewed**: assert `_prs_cap == 500`, `_prs_truncated == false`, `len(prs) == 500`, and the slice contains all 500 records sorted by `cycle_time desc, id asc`.
2. **At exactly 501 PRs reviewed**: assert `_prs_cap == 500`, `_prs_truncated == true`, `len(prs) == 500`, the slice contains the 500 records with the highest `cycle_time` (with `id` ascending tiebreak), AND the 1 dropped record is the fastest record by `cycle_time` (with `id` ascending tiebreak).

The test fixture MUST construct synthetic PR data deterministically (e.g., 500 PRs with `cycle_time_minutes` evenly spaced from 100.0 to 599.0, plus a 501st PR with `cycle_time_minutes = 50.0`) so the boundary case is exact, not statistical.

The test fails if any future producer change drifts into "truncate first 500 in arrival order" or "truncate when count >= cap" semantics. This is the regression lock the user explicitly requested at CL-02 guardrail #4.

## 7. Coherence invariants

A producer-side test MUST assert:

1. **Under non-truncation** (`_prs_truncated == false`): `len(prs) == reviewed_prs`. The PR list size matches the headline count — the user sees N PRs in the list when the panel says "N PRs reviewed."

2. **Under truncation** (`_prs_truncated == true`): `len(prs) == _prs_cap == 500` AND `reviewed_prs > 500`. The PR list is at the cap; the headline count is the true (uncapped) count.

3. **Duplication semantic** (mirrors the byte-cost trade-off acknowledged in the user's CL-01 acceptance): for a fixture week with N PRs each reviewed by exactly K distinct reviewers, the sum of `len(by_reviewer[r].prs)` across all R reviewers equals N × K. A PR reviewed by K reviewers appears in K per-(reviewer, week) entries.

These invariants encode the producer-side contract that the consumer's `reviewer-pr-list-count-parity.test.ts` mirrors at the rendered-DOM level.

## 8. Privacy posture (FR-022, FR-028)

The per-(reviewer, week) `prs[]` sub-array carries the same tenant-sensitive fields as the rollup-root `prs[]`: PR titles, author IDs, repository IDs, cycle times, and (capability-on) per-row comments-metrics. Per the existing privacy-posture covered-fields list at `docs/reference/dataset-contract.md:105-110`, these fields are STRIPPED from public/demo artifacts.

**Strip enforcement** is at `scripts/build-demo-dataset.py` `promote_data` (`:1309-1376`), which calls `strip_pr_arrays_from_rollups` (`:1345`) which calls `_strip_one` (`:85-96` in `scripts/strip_pr_arrays.py`).

**Verified at HEAD**: `_strip_one` only walks the rollup ROOT (depth 0). The new sub-array is at depth 2 (`payload["by_reviewer"][reviewer_id]["prs"]`). Without the FR-028 extension, the strip helper would NOT remove the new sub-array, and demo/public artifacts would leak per-(reviewer, week) PR detail.

**Smallest-possible extension** (FR-028, codified):

```python
# scripts/strip_pr_arrays.py
def _strip_one(path: Path, fields_removed: dict[str, int]) -> bool:
    payload = _load_rollup(path)
    modified = False
    # Existing: rollup-root strip (depth 0).
    for key in PR_LEVEL_FIELDS:
        if key in payload:
            payload.pop(key, None)
            fields_removed[key] += 1
            modified = True
    # NEW (Feature 362): per-(reviewer, week) strip (depth 2).
    by_reviewer = payload.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        for reviewer_entry in by_reviewer.values():
            if not isinstance(reviewer_entry, dict):
                continue
            for key in PR_LEVEL_FIELDS:
                if key in reviewer_entry:
                    reviewer_entry.pop(key, None)
                    fields_removed[key] += 1
                    modified = True
    if modified:
        _write_rollup(path, payload)
    return modified

def _verify_clean(path: Path) -> list[str]:
    payload = _load_rollup(path)
    remaining: list[str] = []
    # Existing: rollup-root verification.
    for key in PR_LEVEL_FIELDS:
        if key in payload:
            remaining.append(key)
    # NEW (Feature 362): per-(reviewer, week) verification.
    by_reviewer = payload.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        for reviewer_id, reviewer_entry in by_reviewer.items():
            if not isinstance(reviewer_entry, dict):
                continue
            for key in PR_LEVEL_FIELDS:
                if key in reviewer_entry:
                    remaining.append(f"by_reviewer[{reviewer_id}].{key}")
    return remaining
```

The `PR_LEVEL_FIELDS` constant (currently at `:26-27`) is reused unchanged — the same three field names (`prs`, `_prs_truncated`, `_prs_cap`) cover both depth-0 and depth-2 emission sites because the contract is name-based, not depth-based.

**Strip-helper coverage test (FR-028)** (`tests/unit/test_strip_pr_arrays_reviewer_nested.py`):

1. **Top-level strip preserved**: a rollup fixture with rollup-root `prs` / `_prs_truncated` / `_prs_cap` AND with empty `by_reviewer` has all rollup-root fields removed by `_strip_one`. (Regression lock — the existing strip MUST keep working.)
2. **Nested strip works**: a rollup fixture with rollup-root fields AND with `by_reviewer[*]` entries carrying the trio has BOTH levels stripped after `_strip_one`. `_verify_clean` returns empty list.
3. **Residue-on-incomplete-walk fails-loud**: monkey-patch `_strip_one` to NOT walk into `by_reviewer[*]` (simulating a regression). `strip_pr_arrays_from_rollups` MUST raise `PrArrayResidueError` referencing the per-(reviewer, week) residue path. (This is the fail-loud guardrail: a future strip-helper regression is caught at the demo-build gate, not silently grandfathered.)

## 9. Demo-generator parallel-path (FR-023)

`scripts/generate-demo-data.py` `_generate_reviewer_breakdown` (verified at HEAD `:1764-...`) MUST be extended to emit the new per-(reviewer, week) `prs[]` field on each `ReviewerSliceMetrics` entry it returns.

The demo's PR records already exist as part of the demo's per-week `prs[]` synthesis. The reviewer breakdown's new field is sourced by selecting from the same demo synthesis layer, scoped to the reviewer's allocated PR count. Specifically:

- For each reviewer slice the demo allocates `reviewed_prs` PRs (per the existing `review_allocations` logic at `:1804-1807`).
- The new emission selects exactly `reviewed_prs` PrRecord objects from the demo's per-week synthesized PR set, sorts them by `cycle_time desc, id asc`, and assigns them to `prs`.
- Demo seeds are bounded well below 500, so `_prs_truncated` is always `false` and `_prs_cap` is always 500. Demo never exhibits truncation under typical seeds.

A producer-side test MUST assert the demo's per-(reviewer, week) emission satisfies the same atomicity / sort / coherence invariants as production. This prevents the demo from passing the consumer-rendering tests vacuously (e.g., the demo emitting empty `prs[]` arrays while production emits real data).

## 10. Public/demo artifact verification (SC-007 + SC-014)

After the producer change + demo-generator extension + strip-helper extension all land:

1. **Private-tenant artifact** (e.g., the production Pipeline Artifact): `by_reviewer[*]` entries carry the new trio. The implementation commit's SC-014 fixture-size report compares one representative ~26-week artifact's byte size before/after; the report cites the absolute and relative size delta.
2. **Public/demo artifact** (after `promote_data` runs to `docs/data/`): `by_reviewer[*]` entries do NOT carry the trio. The strip-helper extension (FR-028) ensures this; the FR-028 coverage test ensures the strip-helper extension stays correct under future changes.
3. **Synthetic-shape gate** (`scripts/build-demo-dataset.py` `assert_synthetic_shape`): unchanged for this feature. The synthetic-authorization sentinel path (per `promote_data:1334-1339`) preserves PR-level fields when authorized, but the synthetic-shape gate only validates rollup-root `prs` shape. If the synthetic-shape gate needs extension to validate per-(reviewer, week) `prs` shape too, that's a follow-up and is OUT OF SCOPE of this feature unless evidence emerges in Pass-3 / implementation that the gate breaks on the new shape.

## 11. Tests that assert this contract

- `tests/unit/test_aggregators_reviewer_pr_detail.py` — basic emission, sort-before-truncate, cap-boundary 500/501 (FR-029), atomicity (`_prs_cap` always present alongside `prs`), duplication invariant, `reviewed_prs == prs.length` coherence under non-truncation.
- `tests/unit/test_strip_pr_arrays_reviewer_nested.py` — top-level strip preserved, nested strip works, residue-on-incomplete-walk fails-loud (FR-028).
- `tests/unit/test_demo_generator_reviewer_pr_detail.py` — demo-generator parallel-path coherence (FR-023).
- (A repo-wide existing test `tests/unit/test_privacy_posture_ordering.py` continues to pass by no-op per FR-022 + SC-012.)

## What this contract does NOT cover

- The shape of `PrRecord` — owned by feature 060's contract (and the schema-parity gate at `scripts/check_pr_record_schema_parity.py`). Feature 362 reuses unchanged.
- The cross-surface PR-record schema-parity gate. Stays untouched per CL-01 guardrail #2.
- Comments-metrics atomicity / coverage-partial / ordering invariants (INV-08 / INV-09 / INV-10). Owned by feature 310's contract; reused unchanged for the per-row capability gate.
- Public/demo strip ordering enforcement (`tests/unit/test_privacy_posture_ordering.py`). Stays green by no-op per FR-022.
- The per-week rollup-root `prs[]` emission. Owned by feature 060's contract; unchanged.
