# Data Model: Cycle-Time Chart PR-Level Detail

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Scope

This feature is consumer-only. It introduces **zero new wire-level types** and **zero changes to any cross-surface data contract**. Every value the cycle-time PR list reads is already defined by feature 060 (`PrRecord`, `Rollup.prs`, `Rollup._prs_truncated`, `Rollup._prs_cap`) or by feature 310 (the optional `thread_count` / `comment_count` / `active_thread_count` fields on `PrRecord`). The PR-record schema-parity gate (`scripts/check_pr_record_schema_parity.py`, gate row 38 in `LOCAL_CI_PARITY_INVARIANTS.md`) stays green by no-op.

What this document does describe:
1. The producer-side and consumer-side types being **read** (not modified) by the new code.
2. The **one** new local TypeScript interface introduced by this feature: `CycleTimeDrilldownOptions`, parallel to the existing `ThroughputDrilldownOptions`.
3. The state machine the cycle-time consumer drives over the existing `PrListSection` discriminated union.

## 1. Reused producer-side types (NO CHANGE)

### `PrRecord` (extension consumer view)

Defined at `extension/ui/schemas/rollup.schema.ts:90-99`. Five locked fields plus three Feature-310 optional fields. The cycle-time consumer reads all of them; it adds none.

```typescript
export interface PrRecord {
  readonly id: number;
  readonly title: string;
  readonly author_id: string;
  readonly repository_id: string;
  readonly cycle_time: number;                  // minutes; finite float
  readonly thread_count?: number | null;        // Feature 310 capability
  readonly comment_count?: number | null;       // Feature 310 capability
  readonly active_thread_count?: number | null; // Feature 310 capability
}
```

### Producer-side trio on `Rollup`

Defined at `extension/ui/schemas/rollup.schema.ts:206-208`. Reused unchanged.

```typescript
prs?: readonly PrRecord[];
_prs_truncated?: boolean;
_prs_cap?: number;
```

### Producer-side ordering invariant

Per the `pr-record.md` contract from feature 060 (§ "Determinism invariants" and § "Behavior" step 2): the producer sorts the qualified set by `(-cycle_time_minutes, pull_request_id)` before truncation. The cycle-time consumer trusts this order; FR-019 makes the *rendered DOM order* the contract.

## 2. Reused consumer-side types (NO CHANGE)

| Type | File | Role in this feature |
|---|---|---|
| `PrListSection` | `extension/ui/modules/shared/detail-panel.ts:163` | Discriminated union the cycle-time module emits exactly as throughput does. |
| `PrListSectionWithRows` | `extension/ui/modules/shared/detail-panel.ts:144` | The `pr-list` variant. |
| `PrListSectionMessage` | `extension/ui/modules/shared/detail-panel.ts:158` | The three message variants (`supported-empty`, `team-inline`, `reviewer-inline`). |
| `PrListRow` | `extension/ui/modules/shared/detail-panel.ts:92` | Per-row payload; reused unchanged. |
| `PanelSection` | `extension/ui/modules/shared/detail-panel.ts:165` | Includes `PrListSection` as one variant. |
| `DrillDownContext` | `extension/ui/modules/shared/detail-panel.ts:185` | `sourceChart: "cycle-time"` and `focusedData.kind: "cycle-time"` are already declared. |
| `FilterClassification` | `extension/ui/modules/drilldown/filter-support.ts:21` | Sealed union with the four states. |
| `NonComparisonFilterClassification` | `extension/ui/modules/drilldown/filter-support.ts:32` | Narrowed return when comparison short-circuits upstream. |
| `PrUrlRepositoryEntry` | `extension/ui/modules/shared/pr-url.ts` | Input to `resolvePrUrl`. |
| `PrUrlWebContext` | `extension/ui/modules/shared/pr-url.ts` | Input to `resolvePrUrl`. |
| `AuthorEntry` | `extension/ui/schemas/dimensions.schema.ts` | For the existing per-author breakdown row labeling (currently only relevant on throughput; cycle-time doesn't render `By author`, so this dimension is *threaded through* but not consumed in the new code path). |
| `FilterState` | `extension/ui/modules/filters.ts` | Input to `classifyFilterState`. |

## 3. New consumer-side type (one interface)

### `CycleTimeDrilldownOptions`

Defined locally in `extension/ui/modules/drilldown/cycle-time-drilldown.ts`. Parallel to `ThroughputDrilldownOptions` at `throughput-drilldown.ts:70`. Strict typing per QG-40 (no `Any`, no implicit-any).

```typescript
export interface CycleTimeDrilldownOptions {
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

**Field semantics** (all optional, all behave identically to their throughput counterparts):

| Field | Purpose | When absent |
|---|---|---|
| `filters` | Source for `classifyFilterState`. | Treated as empty `FilterState` (`createEmptyFilterState()`); classification falls through to `supported`. |
| `repositoriesDimension` | Repository-name lookup for URL composition via `resolvePrUrl`. | URL composer falls back per existing `resolvePrUrl` rules. |
| `webContext` | Required upstream input for URL composition. | Triggers the `supported-empty` branch (no URL → no list). |
| `authorsDimension` | Reserved for parity with throughput's options shape; **NOT consumed** by cycle-time's render path because cycle-time has no `By author` breakdown. Threaded through so the dashboard-side options bag can be passed identically to both installs. | Treated as empty Map; harmless. |
| `commentsMetricsAvailable` | Section-level capability gate for the three Feature-310 columns. | Defaults to `false` (capability-off DOM shape — byte-identical to pre-310). |

**Decision: do not unify `CycleTimeDrilldownOptions` with `ThroughputDrilldownOptions` into a shared `DrilldownOptions` type at this time.** The two interfaces are structurally identical today, but the throughput options are owned by feature 060's contracts and unifying them would couple a chart-specific install signature to a shared abstraction without a third caller to justify it. The shape divergence is currently zero; if a future chart needs different fields (e.g., reviewer drill-down with `reviewersDimension`), the chart-local interfaces give us the room to diverge cleanly. This is consistent with `feedback_no_invented_abstractions.md` in user memory.

**Decision: `authorsDimension` is accepted but not consumed by the cycle-time render.** Threading it through preserves call-site uniformity at `dashboard.ts` (one options bag, two installs) and avoids a divergent install signature. The unused field has zero behavioral impact and is ergonomic for the maintainer.

## 4. State machine (REUSED, NO CHANGE)

The cycle-time `buildPrListSection` emits exactly the same `PrListSection` discriminant the throughput module emits. The transitions are upstream-driven (filter state + data state); there is no intra-panel state.

```text
                           classifyFilterState
                                 │
                ┌────────────────┼────────────────┬───────────────┐
                ▼                ▼                ▼               ▼
          comparison           team           reviewer          supported
                │                │                │               │
       (handled upstream     team-inline    reviewer-inline       │
        by comparison-                                            │
        advisory toast;                                           │
        panel never opens)                                        │
                                                                  │
                                          rawPrs = rollup.prs ?? []
                                                                  │
                       ┌──────────────────────────────────────────┴────┐
                       │                                               │
                       ▼                                               ▼
              rawPrs.length === 0                              rawPrs.length > 0
              || !webContext                                   && webContext present
              || capValue === undefined                        && capValue defined
                       │                                               │
                       ▼                                               ▼
                 supported-empty                                    pr-list
                                                                       │
                                                       capability gate (commentsMetricsAvailable)
                                                                       │
                                                ┌──────────────────────┴────────────────┐
                                                ▼                                       ▼
                              capability OFF: rows omit thread/comment/        capability ON: rows include
                              active fields entirely (byte-identical            thread/comment/active counts
                              to pre-310 DOM)                                   (with partial-coverage handling
                                                                                via isPartialPrRow)
```

**Same set of PRs for both metrics.** A given week's P50 and P90 dots map to the same `rollup.prs` array. The state machine above runs once per click; switching between P50 and P90 on the same week retargets the panel content without re-running data state — only the metric headline above the section swaps. (`detail-panel.ts` retarget-in-place behavior; FR-014.)

## 5. Validation rules

This feature inherits all schema validation from feature 060's permissive `validatePrRecordArray` (defined in `rollup.schema.ts:571+`) and from feature 310's atomicity rules (INV-08 / INV-09 / INV-10). The cycle-time consumer reads validated data and adds **no** new validators.

The contract assertions added by this feature are at the **rendered-DOM level**, not the data level:

- FR-019 → consumer-side test asserts rendered DOM order = `cycle_time desc, id asc`.
- FR-012 → consumer-side test asserts the rendered section's accessible name is content-state-stable.
- FR-013 → consumer-side test asserts keyboard activation + Tab reachability.

These are tests, not runtime validators. They ride on top of the existing schema validation pipeline.

## 6. State transitions (panel-level, REUSED)

The cycle-time panel inherits all four dismissal reasons from `detail-panel.ts:177` (`escape-key` / `outside-click` / `filters-changed` / `tab-changed` / `comparison-toggled` / `explicit-close-button`). When dismissed, the cycle-time module's `MutationObserver` on the panel root fires once, removes the active class on the dot, disconnects, and exits — exactly as throughput does today (`cycle-time-drilldown.ts:125-137`).

This feature does NOT add any new dismissal reason. FR-014 (retarget-in-place between P50 and P90) is also inherited unchanged — `openDetailPanel` already handles content swap when called while open.

## Out of scope for this data model

- New `PrRecord` fields → spec FR-017 forbids it; out of scope per #318 catalog.
- Per-team or per-reviewer PR slices → out of scope per #318.
- Comparison-mode PR detail → out of scope per #318.
- Producer-side aggregator changes → spec FR-016 forbids it.
