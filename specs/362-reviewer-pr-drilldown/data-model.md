# Data Model: Reviewer-Activity Chart PR-Level Detail

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Scope

This feature is producer + consumer. Unlike #361 (consumer-only) it introduces:

1. **One extended interface** on the existing `ReviewerBreakdownEntry` (TypeScript) / `ReviewerSliceMetrics` (Python TypedDict) — adds three optional fields: `prs`, `_prs_truncated`, `_prs_cap`.
2. **One new local TypeScript interface** `ReviewerDrilldownOptions`, mirroring `CycleTimeDrilldownOptions` field-for-field plus the existing `reviewersDimension` field.
3. **One reused producer-side constant alias** `_PR_DETAIL_CAP_PER_REVIEWER_WEEK = _PR_DETAIL_CAP` introduced in `src/ado_git_repo_insights/transform/aggregators.py` near line 84 (the existing `_PR_DETAIL_CAP` declaration).

The cross-surface PR-record schema-parity gate (`scripts/check_pr_record_schema_parity.py`) stays green by no-op — the `PrRecord` interface is reused unchanged, and the new fields are added to a different (non-parity-locked) interface (`ReviewerBreakdownEntry`). This is a deliberate guardrail of the Option A lock.

## 1. Reused producer-side types (NO CHANGE)

### `PrRecord` (extension consumer view)

Defined at `extension/ui/schemas/rollup.schema.ts:90-99`. Five locked fields plus three Feature-310 optional fields. The reviewer drill-down's PR list renders rows from this exact shape; **no field added, no field removed**.

```typescript
export interface PrRecord {
    readonly id: number;
    readonly title: string;
    readonly author_id: string;
    readonly repository_id: string;
    readonly cycle_time: number; // minutes; finite float
    readonly thread_count?: number | null; // Feature 310 capability
    readonly comment_count?: number | null; // Feature 310 capability
    readonly active_thread_count?: number | null; // Feature 310 capability
}
```

Cross-surface schema parity at `scripts/check_pr_record_schema_parity.py` — UNCHANGED. The gate's `_TS_ACCEPTED_TYPES` set, `_TS_FIELD` regex, `PYTHON_VALUE_TYPES` set, `PY_TO_TS` mapping, `_canon_python_type` AST traversal, and contract-§1 markdown-table parser all stay unmodified per FR-025 + CL-01 guardrail #2.

### `PrRecord` (Python TypedDict)

Defined at `src/ado_git_repo_insights/types.py:289+`. Same shape as the TS interface (per the schema-parity gate's enforcement). UNCHANGED.

## 2. Extended producer-side types

### `ReviewerBreakdownEntry` (TypeScript)

Defined at `extension/ui/schemas/rollup.schema.ts:58-64`. Currently has 5 fields (2 required, 3 optional). The extension adds 3 optional fields:

```typescript
export interface ReviewerBreakdownEntry {
    reviewed_prs: number;
    reviews_count: number;
    approval_rate?: number | null;
    authors_count?: number;
    repositories_count?: number;
    // Feature 362 — per-(reviewer, week) PR-level detail (private-tenant artifacts only;
    // stripped from public/demo artifacts via the extended scripts/strip_pr_arrays.py).
    // All three fields are atomic: present together or absent together.
    prs?: readonly PrRecord[];
    _prs_truncated?: boolean;
    _prs_cap?: number;
}
```

**Atomicity invariant** (mirrors feature 060's per-week trio): `prs`, `_prs_truncated`, `_prs_cap` are present together or absent together. When absent, the consumer renders `supported-empty` for the focused reviewer (FR-011). When present, the consumer renders the PR list with rows derived from the slice (FR-001).

**Validator update**: the existing schema validator at `rollup.schema.ts` validates `by_reviewer` entries via the existing `validateReviewerBreakdownEntry` path (or equivalent — exact line numbers will be confirmed during implementation). The validator MUST be extended to permissively warn (not error) on:

- `prs` present but not an array
- `prs` element shape mismatching `PrRecord` (each element's `id` / `title` / `cycle_time` / `author_id` / `repository_id` types — same checks `validatePrRecordArray` at `:571+` already does for the rollup-root `prs` array)
- `_prs_truncated` present but not a boolean
- `_prs_cap` present but not a number
- Atomicity violation: any one of the three fields present without the other two

The validator MUST NOT reject malformed entries; it MUST warn and treat the entry as if the fields were absent (consumer renders `supported-empty`). This matches the permissive-validation posture established by feature 060 / 310 / 333 / 334 / 335 / 336 for sibling rollup keys.

### `ReviewerSliceMetrics` (Python TypedDict)

Defined in `src/ado_git_repo_insights/transform/types.py` (exact location to be pinned during Pass-3 implementation read; the spec cites it conditionally because the file's TypedDict layout was not directly read during plan drafting). Currently has the same 5 fields as the TS interface. The extension adds 3 fields:

```python
class ReviewerSliceMetrics(TypedDict):
    reviewed_prs: int
    reviews_count: int
    approval_rate: float | None  # or NotRequired[float | None] depending on existing shape
    authors_count: NotRequired[int]
    repositories_count: NotRequired[int]
    # Feature 362 — per-(reviewer, week) PR-level detail.
    prs: NotRequired[list[PrRecord]]
    _prs_truncated: NotRequired[bool]
    _prs_cap: NotRequired[int]
```

The exact `NotRequired` posture for the new fields mirrors the TypeScript optional fields. Atomicity invariant mirrors the TS interface above.

## 3. Reused consumer-side types (NO CHANGE)

| Type                                | File                                                  | Role in this feature                                                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PrListSection`                     | `extension/ui/modules/shared/detail-panel.ts`         | Discriminated union the reviewer module emits exactly as throughput / cycle-time do.                                                                                                                                                             |
| `PrListSectionWithRows`             | `extension/ui/modules/shared/detail-panel.ts`         | The `pr-list` variant.                                                                                                                                                                                                                           |
| `PrListSectionMessage`              | `extension/ui/modules/shared/detail-panel.ts`         | The two reachable message variants on this surface (`supported-empty`, `team-inline`); the `reviewer-inline` variant is unreachable on the reviewer drill-down by construction (FR-008).                                                         |
| `PrListRow`                         | `extension/ui/modules/shared/detail-panel.ts`         | Per-row payload; reused unchanged.                                                                                                                                                                                                               |
| `PanelSection`                      | `extension/ui/modules/shared/detail-panel.ts`         | Includes `PrListSection` as one variant.                                                                                                                                                                                                         |
| `DrillDownContext`                  | `extension/ui/modules/shared/detail-panel.ts`         | `sourceChart: "reviewer"` and `focusedData.kind: "reviewer"` are already declared.                                                                                                                                                               |
| `FilterClassification`              | `extension/ui/modules/drilldown/filter-support.ts:21` | Sealed union with the four states.                                                                                                                                                                                                               |
| `NonComparisonFilterClassification` | `extension/ui/modules/drilldown/filter-support.ts:32` | Narrowed return when comparison short-circuits upstream.                                                                                                                                                                                         |
| `PrUrlRepositoryEntry`              | `extension/ui/modules/shared/pr-url.ts`               | Input to `resolvePrUrl`.                                                                                                                                                                                                                         |
| `PrUrlWebContext`                   | `extension/ui/modules/shared/pr-url.ts`               | Input to `resolvePrUrl`.                                                                                                                                                                                                                         |
| `AuthorEntry`                       | `extension/ui/schemas/dimensions.schema.ts`           | Reserved for parity with throughput's options shape; **NOT consumed** by reviewer's render path because reviewer has no `By author` breakdown. Threaded through so the dashboard can pass the same options bag to all three drill-down installs. |
| `ReviewerEntry`                     | `extension/ui/schemas/dimensions.schema.ts:99-...`    | Existing input to `installReviewerDrilldown` for display-name resolution; preserved unchanged.                                                                                                                                                   |
| `FilterState`                       | `extension/ui/modules/filters.ts`                     | Input to `classifyFilterState` (with the reviewer-stripping wrapper).                                                                                                                                                                            |

## 4. New consumer-side type (one interface)

### `ReviewerDrilldownOptions`

Extends the existing `ReviewerDrilldownOptions` interface declared at `extension/ui/modules/drilldown/reviewer-drilldown.ts:178-180` (the current shape has only `reviewersDimension`; the existing field is preserved). Strict typing per QG-40 (no `Any`, no implicit-any).

```typescript
export interface ReviewerDrilldownOptions {
    // Existing field — preserved unchanged from #308:
    readonly reviewersDimension?: readonly ReviewerEntry[] | null | undefined;
    // Feature 362 additions — mirror ThroughputDrilldownOptions / CycleTimeDrilldownOptions field-for-field:
    readonly filters?: FilterState;
    readonly repositoriesDimension?:
        | readonly PrUrlRepositoryEntry[]
        | null
        | undefined;
    readonly webContext?: PrUrlWebContext;
    readonly authorsDimension?: readonly AuthorEntry[] | null | undefined;
    readonly commentsMetricsAvailable?: boolean;
}
```

**Field semantics** (Feature 362 additions, all optional, all behave identically to their throughput / cycle-time counterparts):

| Field                      | Purpose                                                                                                                                                                  | When absent                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `filters`                  | Source for the reviewer-stripped `classifyFilterState` invocation.                                                                                                       | Treated as empty `FilterState` (`createEmptyFilterState()`); after reviewer-stripping, classification falls through to `supported`. |
| `repositoriesDimension`    | Repository-name lookup for URL composition via `resolvePrUrl`.                                                                                                           | URL composer falls back per existing `resolvePrUrl` rules.                                                                          |
| `webContext`               | Required upstream input for URL composition.                                                                                                                             | Triggers the `supported-empty` branch (no URL → no list).                                                                           |
| `authorsDimension`         | Reserved for parity with throughput / cycle-time options shape; **NOT consumed** by reviewer's render path. Threaded through for call-site uniformity at `dashboard.ts`. | Treated as empty Map; harmless.                                                                                                     |
| `commentsMetricsAvailable` | Section-level capability gate for the three Feature-310 columns.                                                                                                         | Defaults to `false` (capability-off DOM shape — byte-identical to pre-310).                                                         |

**Decision: do not unify `ReviewerDrilldownOptions` with `ThroughputDrilldownOptions` / `CycleTimeDrilldownOptions` into a shared `DrilldownOptions` type at this time.** The three interfaces will be structurally identical for the Feature-362-introduced fields, but each is owned by its respective feature's contracts. Unifying them would couple chart-specific install signatures to a shared abstraction without sufficient justification beyond a third caller's existence; a future fourth chart (sparkline) might genuinely diverge. This is consistent with `feedback_no_invented_abstractions.md` in user memory.

**Decision: `authorsDimension` is accepted but not consumed by the reviewer render**, mirroring cycle-time's same posture per #361 data-model.md § 3. Threading it through preserves call-site uniformity at `dashboard.ts` (one options bag, three installs).

## 5. New producer-side constant alias

`_PR_DETAIL_CAP_PER_REVIEWER_WEEK = _PR_DETAIL_CAP` declared in `src/ado_git_repo_insights/transform/aggregators.py` immediately below the existing `_PR_DETAIL_CAP = 500` at `:84`.

```python
_PR_DETAIL_CAP: Final[int] = 500
_PR_DETAIL_CAP_PER_REVIEWER_WEEK: Final[int] = _PR_DETAIL_CAP
"""Per-(reviewer, week) PR-detail cap (Feature 362).

Aliased to ``_PR_DETAIL_CAP`` so the per-week and per-(reviewer, week) caps
share a single source of truth. Future divergence is a one-line edit at this
declaration; downstream call sites read the alias by name and need no change.
"""
```

The alias is the user's CL-02 guardrail — "the cap is the same number regardless of which slice you're looking at" — encoded as code, not as a docstring or wiki note. The producer emission at `_generate_reviewer_slice` references the alias by name; a future per-(reviewer, week)-specific divergence (if ever required) is a one-line edit.

## 6. State machine (REUSED on the consumer side, NO CHANGE)

The reviewer `buildPrListSection` emits exactly the same `PrListSection` discriminant the throughput / cycle-time modules emit. The transitions are upstream-driven (filter state + data state). On this surface, comparison is short-circuited before the classifier runs (existing behavior at `reviewer-drilldown.ts:232-235`), and the reviewer-stripping wrapper at FR-008 reduces the four-state classifier to three reachable states.

```text
                       reviewer-stripped classifyFilterState
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
          comparison           team           supported
                │                │                │
       (handled upstream     team-inline       │
        by comparison-                          │
        advisory toast;                         │
        panel never opens —                     │
        existing behavior)                      │
                                                │
                                  rawPrs = union of
                                  by_reviewer[reviewerId].prs
                                  across active period weeks
                                                │
                       ┌────────────────────────┴────┐
                       │                             │
                       ▼                             ▼
              rawPrs.length === 0           rawPrs.length > 0
              || !webContext                && webContext present
              || every per-week              && every per-week
              by_reviewer entry              by_reviewer entry
              missing _prs_cap               has _prs_cap
                       │                             │
                       ▼                             ▼
                supported-empty                  pr-list
                                                       │
                                       capability gate (commentsMetricsAvailable)
                                                       │
                                ┌──────────────────────┴────────────────┐
                                ▼                                       ▼
                    capability OFF: rows omit                capability ON: rows include
                    thread/comment/active                    thread/comment/active counts
                    fields entirely (byte-identical          (with partial-coverage handling
                    to pre-310 DOM)                          via isPartialPrRow)
```

**Author/repo overlay**: applied client-side AFTER the union of per-(reviewer, week) `prs[]` slices is built. The PrRecord's `author_id` and `repository_id` fields drive the filter; the rendered DOM order assertion (FR-019) operates on the post-filter slice.

**Cross-week sort**: the producer's per-(reviewer, week) sort is preserved within each week's slice, but the cross-week union MUST be re-sorted at the consumer by `cycle_time desc, id asc`. FR-019's rendered DOM order assertion verifies the sort holds on the rendered output, regardless of whether the implementation re-sorts at the consumer or relies on stable cross-week merge.

## 7. Validation rules

**Producer side** — atomic emission. The aggregator MUST NOT emit `prs` without the matching `_prs_truncated` + `_prs_cap`. Producer-side tests assert atomicity per FR-016 + FR-029.

**Consumer side** — permissive validation. The schema validator extension treats malformed `by_reviewer[*]` entries (missing one of the trio, wrong types, etc.) as warnings and renders `supported-empty`. This mirrors feature 060's permissive validatePrRecordArray.

**Boundary regression lock** — FR-029 producer-side test asserts:

- At exactly 500 pre-truncation: `_prs_cap == 500`, `_prs_truncated == false`, `prs.length == 500`, slice contains all 500 records sorted `cycle_time desc, id asc`.
- At exactly 501 pre-truncation: `_prs_cap == 500`, `_prs_truncated == true`, `prs.length == 500`, slice contains the 500 highest-cycle-time records (with `id` ascending tiebreak), the 1 dropped record is the fastest by cycle-time.

## 8. State transitions (panel-level, REUSED)

The reviewer panel inherits all dismissal reasons from `detail-panel.ts` (`escape-key` / `outside-click` / `filters-changed` / `tab-changed` / `comparison-toggled` / `explicit-close-button`). When dismissed, the reviewer module's `MutationObserver` on the panel root fires once, removes the active class on the bar row, disconnects, and exits — exactly as today (`reviewer-drilldown.ts:212-224`).

This feature does NOT add any new dismissal reason. FR-014 (panel re-open after filter change to a different reviewer) is inherited unchanged — the chart re-renders for the new reviewer, the user clicks again, the panel opens with the new reviewer's content.

## Out of scope for this data model

- Per-(reviewer, week) cycle-time aggregate metrics. Per the aggregator comment at `aggregators.py:2150-2152`, those require a richer persisted review event model than the current reviewers table provides. Out of scope per #318.
- `reviewer_ids: string[]` on `PrRecord`. Excluded by `/speckit.clarify` Q1 (Option A locked, not Option B).
- Separate `aggregates/by_reviewer_prs/` artifact. Excluded by `/speckit.clarify` Q1 (Option A locked, not Option C).
- Comparison-mode PR detail. Out of scope per #318.
- Per-team or cross-dimension aggregates inside the panel. Out of scope per #318.
- Producer-side reviewer cycle-time / review-latency aggregates. Out of scope per #318 + the existing aggregator's Phase-1 boundary.
