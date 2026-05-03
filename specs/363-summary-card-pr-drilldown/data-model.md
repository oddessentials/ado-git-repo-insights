# Data Model: Summary-Card Sparkline PR-Level Detail (Issue #363)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Scope

This feature is consumer-only (LD-3). It introduces **zero new wire-level types** and **zero changes to any cross-surface data contract**. Every value the period-scoped PR list reads is already defined by feature 060 (`PrRecord`, `Rollup.prs`, `Rollup._prs_truncated`, `Rollup._prs_cap`) or by feature 310 (the optional `thread_count` / `comment_count` / `active_thread_count` fields on `PrRecord`). The PR-record schema-parity gate stays green by no-op.

What this document does describe:

1. The producer-side and consumer-side types being **read** (not modified) by the new code.
2. The **two** new local TypeScript artifacts introduced by this feature:
   a. The `SparklineDrilldownOptions` interface, parallel to `ThroughputDrilldownOptions` / `CycleTimeDrilldownOptions` / `ReviewerDrilldownOptions`.
   b. The `formatPeriodTitle(rollups)` helper added to `extension/ui/modules/drilldown/week-range.ts` (Q-R2 lock — see § "Period title contract" below).
3. The **Period-scoped Union Envelope** — the local accumulator shape produced by the cross-week union/cap/truncation walk inside the sparkline-driven path. Local to the call; not persisted.
4. The state machine the sparkline-navigator drives over the existing `PrListSection` discriminated union for the three eligible cards (throughput, cycle-time P50, cycle-time P90).

## 1. Reused producer-side types (NO CHANGE)

### `PrRecord` (extension consumer view)

Defined at `extension/ui/schemas/rollup.schema.ts:90-99`. Five locked fields plus three Feature-310 optional fields. The sparkline-driven panel reads all of them; it adds none.

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

Plus the period-aggregating field:

```typescript
pr_count: number;          // per-rollup count; summed across rollups for totalPeriodPrCount
```

### Producer-side ordering invariant

Per the `pr-record.md` contract from feature 060 (§ "Determinism invariants" and § "Behavior" step 2): the producer sorts the qualified set by `(-cycle_time_minutes, pull_request_id)` before truncation. Per-rollup `prs[]` arrays arrive at the consumer in `cycle_time desc, id asc` order.

The new sparkline-driven panel **re-sorts** the cross-week union by the same `cycle_time desc, id asc` order at the consumer (LD-1 step 6). This mirrors `reviewer-drilldown.ts:352-355`'s pattern: the cross-week union must be re-sorted because per-rollup slices are independent and concatenation does not preserve global order.

## 2. Reused consumer-side types (NO CHANGE)

| Type | File | Role in this feature |
|---|---|---|
| `PrListSection` | `extension/ui/modules/shared/detail-panel.ts:163` | Discriminated union the sparkline-navigator emits exactly as throughput / cycle-time / reviewer do. |
| `PrListSectionWithRows` | `detail-panel.ts:144` | The `pr-list` variant. |
| `PrListSectionMessage` | `detail-panel.ts:158` | The three message variants (`supported-empty`, `team-inline`, `reviewer-inline`). |
| `PrListRow` | `detail-panel.ts:92` | Per-row payload; reused unchanged. |
| `PanelSection` | `detail-panel.ts:165` | Includes `PrListSection` as one variant. |
| `DrillDownContext` | `detail-panel.ts:185` | New `sourceChart: "summary-card"` value will be added — see § 5 below. |
| `PanelContent` | `detail-panel.ts:171` | Title + subtitle + sections; the sparkline-driven panel emits this shape. |
| `FilterClassification` | `extension/ui/modules/drilldown/filter-support.ts:21` | Sealed union with the four states. |
| `NonComparisonFilterClassification` | `filter-support.ts:32` | Narrowed return when comparison short-circuits upstream. |
| `PrUrlRepositoryEntry` | `extension/ui/modules/shared/pr-url.ts` | Input to `resolvePrUrl`. |
| `PrUrlWebContext` | `extension/ui/modules/shared/pr-url.ts` | Input to `resolvePrUrl`. |
| `AuthorEntry` | `extension/ui/schemas/dimensions.schema.ts` | Threaded through for call-site uniformity (not consumed by sparkline render). |
| `FilterState` | `extension/ui/modules/filters.ts` | Input to `classifyFilterState`. |
| `Rollup` | `extension/ui/dataset-loader.ts` | Input to `formatPeriodTitle` and the period union walk. |

## 3. New consumer-side type: `SparklineDrilldownOptions`

Defined locally in `extension/ui/modules/drilldown/sparkline-navigator.ts`. Parallel to `ThroughputDrilldownOptions` (`throughput-drilldown.ts:70-85`), `CycleTimeDrilldownOptions` (`cycle-time-drilldown.ts:194-203`), and `ReviewerDrilldownOptions` (`reviewer-drilldown.ts:458-468`). Strict typing per QG-40 (no `Any`, no implicit-any).

```typescript
export interface SparklineDrilldownOptions {
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

**Field semantics** (all optional, all behave identically to their counterparts on the other three drilldown surfaces):

| Field | Purpose | When absent |
|---|---|---|
| `filters` | Source for `classifyFilterState`. | Treated as empty `FilterState` (`createEmptyFilterState()`); classification falls through to `supported`. |
| `repositoriesDimension` | Repository lookup for URL composition via `resolvePrUrl`. | URL composer falls back per existing `resolvePrUrl` rules. |
| `webContext` | Required upstream input for URL composition. | Triggers the `supported-empty` branch (no URL → no list). |
| `authorsDimension` | Reserved for parity with other drilldowns; **NOT consumed** by the period-scoped panel render path because the panel has no `By author` breakdown (Q-R3=OMIT). Threaded through so the dashboard-side options bag passes identically to all four installs. | Treated as empty Map; harmless. |
| `commentsMetricsAvailable` | Section-level capability gate for the three Feature-310 columns. | Defaults to `false` (capability-off DOM shape — byte-identical to pre-310). |

**Decision: do not unify the four drilldown options interfaces into a shared `DrilldownOptions` type at this time.** The four interfaces are structurally identical today (modulo `reviewersDimension` on the reviewer surface), but unifying them would couple chart-specific install signatures to a shared abstraction without a fifth caller to justify it. The shape divergence is currently zero; if a future surface needs different fields, the chart-local interfaces give us the room to diverge cleanly. This is consistent with `feedback_no_invented_abstractions.md` in user memory and with `feedback_drop_plan_ceremony_on_locked_tasks` (don't add abstractions until they're needed).

**Decision: `authorsDimension` is accepted but not consumed by the sparkline render.** Threading it through preserves call-site uniformity at `dashboard.ts` (one options bag, four installs) and avoids divergent signatures.

## 4. New consumer-side helper: `formatPeriodTitle` (Q-R2 lock)

Defined in `extension/ui/modules/drilldown/week-range.ts`. Co-located with `formatWeekTitle(rollup)`, `formatWeekRangeTitle(start, end)`, `weekRangeForAria(rollup)`, and the existing date primitives.

### Period title contract

```typescript
/**
 * Format a multi-rollup window as a "Period of {condensed range}" title.
 * Used by the summary-card sparkline drill-down to title the period-scoped
 * DetailPanel (#363).
 *
 * Single-rollup windows delegate to formatWeekTitle to preserve the existing
 * single-week wording; a one-week "Period of Mar 17 – Mar 17, 2025" would
 * read awkwardly even though it is technically correct.
 *
 * Empty input returns a stable fallback ("No period selected") so callers
 * never see undefined or an empty string. The classifier short-circuits
 * upstream on empty windows, so this branch is unreachable in production.
 */
export function formatPeriodTitle(rollups: readonly Rollup[]): string;
```

### Output strings (locked enumeration)

| Window shape | Output |
|---|---|
| 0 rollups (unreachable) | `"No period selected"` |
| 1 rollup | `formatWeekTitle(rollup)` — e.g. `"Week of Mar 17 – 23, 2025"` (delegates to existing helper) |
| 2+ rollups (same year) | `"Period of {earliest start_month} {earliest start_day} – {latest end_month} {latest end_day}, {year}"` — e.g. `"Period of Mar 17 – Apr 13, 2025"` |
| 2+ rollups (cross-year) | `"Period of {earliest start_month} {earliest start_day}, {start_year} – {latest end_month} {latest end_day}, {end_year}"` — e.g. `"Period of Dec 30, 2024 – Jan 26, 2025"` |

### Earliest start / latest end resolution

For each rollup in the array:
1. Try `parseIsoLocalDate(rollup.start_date)` and `parseIsoLocalDate(rollup.end_date)`. Both must be non-null.
2. If either is null, fall back to `isoWeekRange(rollup.week)` and use its `{ start, end }` pair.
3. If both fail, skip that rollup from the period-range computation.

After walking, `earliestStart = min(allStarts)` and `latestEnd = max(allEnds)`. If after the walk no rollup contributed a valid date pair, return the empty-input fallback (`"No period selected"`) — same defensive treatment.

### Per-card title concatenation (call-site ownership)

The `— P50` / `— P90` marker concatenation lives at the call site inside `sparkline-navigator.ts`'s panel-content builder, NOT inside `formatPeriodTitle`. This keeps `formatPeriodTitle` single-purpose:

| Card | Panel title |
|---|---|
| `totalPrs` (throughput) | `formatPeriodTitle(rollups)` |
| `cycleP50` (cycle-time) | `formatPeriodTitle(rollups) + " — P50"` |
| `cycleP90` (cycle-time) | `formatPeriodTitle(rollups) + " — P90"` |

The em-dash separator and uppercase `P50` / `P90` exactly mirror `cycle-time-drilldown.ts:165`'s pattern.

### Subtitle (separate from title)

Subtitle for all three eligible cards: `${totalPeriodPrCount} ${totalPeriodPrCount === 1 ? "PR" : "PRs"}`. `totalPeriodPrCount = sum(rollup.pr_count)` per LD-1 step 3. Pluralization rule mirrors `throughput-drilldown.ts:191` and `cycle-time-drilldown.ts:166`.

### Reviewer card excluded

Per LD-2 / FR-002, the reviewer card never opens the panel. No reviewer-card title shape is defined; `formatPeriodTitle` is not called for reviewer card activation.

## 5. New consumer-side type: extended `DrillDownContext` source / focusedData

The shared `DrillDownContext` interface at `detail-panel.ts:185` already declares `sourceChart: "throughput" | "cycle-time" | "reviewer"` and a discriminated `focusedData` union. This feature requires a new value `sourceChart: "summary-card"` and a corresponding `focusedData` arm to disambiguate retarget paths and active-trigger lifecycle tracking.

**Proposed extension** (LD-3 says no new types; this is a tagged-union extension to an existing type, not a new type — and it is the minimal extension required for the panel API to track the new source):

```typescript
// In extension/ui/modules/shared/detail-panel.ts (existing file)

export interface DrillDownContext {
  readonly sourceChart: "throughput" | "cycle-time" | "reviewer" | "summary-card"; // NEW value
  readonly focusedData:
    | { kind: "throughput"; weekIso: string }
    | { kind: "cycle-time"; weekIso: string; metric: "p50" | "p90" }
    | { kind: "reviewer"; reviewerId: string }
    | { kind: "summary-card"; targetCard: "totalPrs" | "cycleP50" | "cycleP90" }; // NEW arm
  readonly triggerElement: HTMLElement;
  readonly content: PanelContent;
}
```

**Why this is acceptable under LD-3** ("no new types"): the `DrillDownContext` interface is already a union over per-source variants (its existing `focusedData` union has 3 arms). Adding a 4th arm is structurally additive — no existing consumer of `DrillDownContext` reads the new arm; type narrowing in the renderer (via `switch (context.focusedData.kind) { ... }`) preserves exhaustiveness checking. The `sourceChart` literal type widens from a 3-tuple to a 4-tuple union.

**Alternative considered**: omit the new `sourceChart` value and reuse `"throughput"` / `"cycle-time"` for sparkline activations. **Rejected** because it would prevent retarget-in-place from disambiguating between (a) clicking the throughput chart's per-week bar and (b) clicking the throughput-card sparkline. Both produce different panel content (per-week vs period-scoped) but share `sourceChart: "throughput"` — the panel API's MutationObserver lifecycle would not know which source the active class belongs to. A new `sourceChart` value gives the panel API clean discriminator.

This is the only structural extension to a shared type in this feature. Plan / contracts encode it; tasks will land it as a non-trivial discriminated-union extension with full TypeScript exhaustiveness coverage.

## 6. Period-scoped Union Envelope (local accumulator, not persisted)

The cross-week union/cap/truncation walk inside `sparkline-navigator.ts` produces a local accumulator shape. **Local to the call**; not exported, not persisted, not part of any wire contract.

```typescript
interface PeriodScopedUnionEnvelope {
  readonly collected: PrRecord[];           // unioned PRs across all rollups in window
  readonly capValue: number | undefined;    // max(rollup._prs_cap) across contributing rollups; undefined if no contributing rollup
  readonly anyTruncated: boolean;           // any(rollup._prs_truncated === true)
  readonly totalPeriodPrCount: number;      // sum(rollup.pr_count) across all rollups in window
}
```

Walk shape (sketch, final form encoded in tasks):

```typescript
function buildPeriodScopedEnvelope(rollups: readonly Rollup[]): PeriodScopedUnionEnvelope | "supported-empty" {
  let capValue: number | undefined;
  let totalPeriodPrCount = 0;
  let anyTruncated = false;
  const collected: PrRecord[] = [];
  for (const rollup of rollups) {
    const prsArray = rollup.prs;
    const truncated = rollup._prs_truncated;
    const cap = rollup._prs_cap;
    if (!Array.isArray(prsArray) || typeof truncated !== "boolean" || typeof cap !== "number") {
      // Partial / missing trio — fall through to supported-empty (FR-007, mirrors reviewer-drilldown.ts:312-315)
      return "supported-empty";
    }
    capValue = capValue === undefined ? cap : Math.max(capValue, cap);
    totalPeriodPrCount += rollup.pr_count;
    if (truncated) anyTruncated = true;
    for (const pr of prsArray) collected.push(pr);
  }
  return { collected, capValue, anyTruncated, totalPeriodPrCount };
}
```

After the walk, the consumer:
1. Re-sorts `collected` by `cycle_time desc, id asc` (LD-1 step 6).
2. Computes `truncationDetected = anyTruncated || collected.length < totalPeriodPrCount` (LD-1 step 7).
3. Computes `actualFilteredCount = truncationDetected ? totalPeriodPrCount : rows.length` (LD-1 step 8).
4. Maps each `PrRecord` to a `PrListRow` (capability-aware shape per FR-014).

### Helper extraction posture (LD-4 / Q-R4 lock)

Per Q-R4 = Branch B (Pass 3 lock), this walk is implemented as a **private helper inside `sparkline-navigator.ts`** (or a sibling module scoped to its imports). **Not extracted to a shared module.** Reviewer-drilldown's existing accumulator walk at `reviewer-drilldown.ts:282-322` reads from per-(reviewer, week) entries, not rollup-level fields, and a unifying helper would require restructuring its loop body — exceeding the FR-022 abort criterion. See plan.md "Considered and rejected: Branch A" subsection for the full rationale.

## 7. State machine

The sparkline-navigator emits exactly the same `PrListSection` discriminant the throughput / cycle-time modules emit. Transitions are upstream-driven (filter state + data state); no intra-panel state.

```text
                              activate()
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              comparison?    target el      targetChart?
                  │          missing?           │
                  ▼              │     ┌────────┼────────┐
              toast,             ▼     ▼        ▼        ▼
              no panel       advisory  throughput cycle-time reviewer
                              no panel    │        │        │
                                          │        │        ▼
                                          │        │   scroll +
                                          │        │   highlight
                                          │        │   (NO panel)
                                          ▼        ▼
                                  classifyFilterState(filters, false)
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
                     team             reviewer            supported
                       │                  │                  │
                  team-inline       reviewer-inline   buildPeriodScopedEnvelope
                  (no panel rows;   (no panel rows;          │
                   inline message)   inline message)         │
                                                  ┌──────────┼──────────┐
                                                  ▼                     ▼
                                            "supported-empty"     PeriodScopedUnionEnvelope
                                            (returned from walk;        │
                                             trio missing OR             │
                                             collected empty OR          │
                                             !webContext)                │
                                                                         │
                                          re-sort by cycle_time desc, id asc
                                                                         │
                                                            commentsMetricsAvailable?
                                                                         │
                                                ┌────────────────────────┴────────────────┐
                                                ▼                                         ▼
                                         capability OFF: rows omit                 capability ON: rows include
                                         thread/comment/active fields              thread/comment/active counts
                                         (byte-identical pre-310 DOM)              (with isPartialPrRow handling)
```

## 8. Validation rules

This feature inherits all schema validation from feature 060's permissive `validatePrRecordArray` (defined in `rollup.schema.ts:571+`) and from feature 310's atomicity rules (INV-08 / INV-09 / INV-10). The sparkline-driven consumer reads validated data and adds **no** new validators.

The contract assertions added by this feature are at the **rendered-DOM level** and the **helper-output level**, not the data level:

- FR-010 → consumer-side test asserts rendered DOM order = `cycle_time desc, id asc` after cross-week union.
- FR-013 → consumer-side test asserts capability-off DOM byte-identity to a baseline fixture.
- FR-022 → repo-level invariant: `git diff` against six reviewer-drilldown paths shows zero hunks (regression-lock).
- `formatPeriodTitle` unit tests assert the four output-string branches (empty, single-rollup, same-year, cross-year).

These are tests, not runtime validators. They ride on top of the existing schema validation pipeline.

## 9. State transitions (panel-level, REUSED)

The sparkline-driven panel inherits all dismissal reasons from `detail-panel.ts:177` (`escape-key` / `outside-click` / `filters-changed` / `tab-changed` / `comparison-toggled` / `explicit-close-button` / retarget). When dismissed, the sparkline-navigator's `MutationObserver` on the panel root fires once, removes the active class on the trigger, disconnects, and exits — exactly as throughput / cycle-time / reviewer do today.

This feature does NOT add any new dismissal reason. **Retarget-in-place** between two eligible cards (e.g. `totalPrs` → `cycleP50` while panel is open) is also inherited unchanged — `openDetailPanel` already handles content swap when called while open. The active-trigger lifecycle ordering is locked by FR-016 (4-step sequence with no-overlap invariants).

## Out of scope for this data model

- New `PrRecord` fields → spec LD-3 forbids it.
- Per-team or per-reviewer PR slices on the period-scoped panel → out of scope per LD-1 (reject Option B).
- Cross-week `byAuthor` / `byRepository` aggregate breakdowns → Q-R3 = OMIT (Pass 3 reaffirmation; see research.md R5).
- Comparison-mode PR detail → out of scope per spec Non-goals.
- Producer-side aggregator changes → spec LD-3 forbids it.
- Shared helper extraction module (`shared/period-pr-list.ts` or similar) → Q-R4 = Branch B locked; see plan.md "Considered and rejected: Branch A".
- Demo data regeneration → Q-R5 = R5-A locked; LD-5 holds.
- `applyFiltersToRollups` namespace mismatch at `metrics.ts:921` → recorded in spec Non-goals as a separate triage item; do not let this expand #363's scope.
