# Contract: Reviewer PR List Section

**Scope**: consumer (extension UI) — `extension/ui/modules/drilldown/reviewer-drilldown.ts` and its dashboard call site at `extension/ui/dashboard.ts`.

**Authoritative spec refs**: FR-001 through FR-014, FR-018, FR-019, FR-026, FR-027. Feature 060's contracts (`pr-record.md`, `pr-list-section.md`, `filter-support.md`) are inherited unchanged. Feature 361's contract (`cycle-time-pr-list.md`) is the structural template; this contract specifies only the reviewer-specific divergences.

> This contract governs the **consumer-side** behavior of the reviewer drill-down's PR list. The producer-side counterpart (per-(reviewer, week) emission, sort, cap, atomicity, strip semantics) is in [`per-reviewer-week-prs.md`](./per-reviewer-week-prs.md).

## 1. Install signature

`installReviewerDrilldown` MUST accept a third optional argument: a `ReviewerDrilldownOptions` bag. The current shape (declared at `reviewer-drilldown.ts:178-180`) has only `reviewersDimension` from #308; this feature extends it with the same field set as `ThroughputDrilldownOptions` (`throughput-drilldown.ts:70-85`) and `CycleTimeDrilldownOptions` (`cycle-time-drilldown.ts:194-203`):

```typescript
export interface ReviewerDrilldownOptions {
    // Existing — preserved unchanged from #308:
    readonly reviewersDimension?: readonly ReviewerEntry[] | null | undefined;
    // Feature 362 additions:
    readonly filters?: FilterState;
    readonly repositoriesDimension?:
        | readonly PrUrlRepositoryEntry[]
        | null
        | undefined;
    readonly webContext?: PrUrlWebContext;
    readonly authorsDimension?: readonly AuthorEntry[] | null | undefined;
    readonly commentsMetricsAvailable?: boolean;
}

export function installReviewerDrilldown(
    container: HTMLElement,
    rollups: readonly Rollup[],
    options?: ReviewerDrilldownOptions,
): { dispose(): void };
```

Existing two-argument and three-argument-with-only-`reviewersDimension` call sites continue to work — the new fields are all optional, and absent fields fall through to safe defaults equivalent to the current reviewer behavior (no PR list rendered when `webContext` or `filters` is absent — supported-empty branch).

The `dashboard.ts` call site MUST pass an options bag built from the same sources `installThroughputDrilldown` and `installCycleTimeDrilldown` read (already constructed at the dashboard's existing options-building site that #361 set up).

## 2. Section ordering

`buildPanelContent` MUST emit panel sections in this order:

1. **Title + subtitle** — reviewer display name + "N PRs reviewed" (existing).
2. **StatRow** — Total reviews, PRs reviewed, Approval rate, Peak repositories (existing — `buildStatRow` at `:75-107`).
3. **Weekly activity breakdown table OR EmptyState** — per-week reviewer activity (existing — `buildWeeklyTable` at `:109-148`, with the `EmptyStateSection` empty branch at `:131-142`).
4. **PR list section** — the new section. NEW.

The PR list section MUST appear **after** the weekly-activity table (or its empty-state branch) so a top-to-bottom reader sees aggregate context first (stat row → weekly table), then specific PRs (FR-002).

The relative ordering of stat-row → weekly-table → PR-list is regression-locked by an order assertion in the reviewer test suite.

**When the weekly table renders empty AND the PR list renders supported-empty**: BOTH empty-state sections appear stacked. This matches the throughput pattern (per-author + per-repo + PR list can all empty independently). Two empty states is honest signaling: the user hears "no weekly activity" and "no PR list" as separate section identities.

## 3. Content-state mapping (filter-shape inversion from #361)

The reviewer PR list section MUST emit one of three content-state values, derived via the **reviewer-stripped classifier**:

```typescript
// Reviewer-stripping wrapper around the shared classifyFilterState predicate.
// Co-located in reviewer-drilldown.ts so the divergence from cycle-time/
// throughput's literal reuse is reviewable in one place.
const filtersForClassifier: FilterState = {
    ...(options.filters ?? createEmptyFilterState()),
    reviewers: [],
};
const { classification } = classifyFilterState(filtersForClassifier, false);
```

| Trigger                                                                                                                                                                                            | Content state                 | Notes                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `comparisonActive === true` (handled upstream by `isDrilldownDisabledByComparison()` short-circuit at `:232-235`; panel does NOT open)                                                             | (no panel; toast denial only) | Existing behavior, regression-locked.                                             |
| Reviewer-stripped `classification === "team"` (the user has a team filter overlay on top of the required reviewer filter)                                                                          | `team-inline`                 | Verbally and visually identical to the throughput / cycle-time team-only message. |
| Reviewer-stripped `classification === "supported"` AND data-state-empty (union of per-(reviewer, week) `prs[]` slices is empty OR `!webContext` OR any participating week's `_prs_cap` is missing) | `supported-empty`             |                                                                                   |
| Reviewer-stripped `classification === "supported"` AND data-state-non-empty                                                                                                                        | `pr-list`                     | Rows scoped to (reviewer ∩ author/repo overlay).                                  |

**The `reviewer-inline` content state is unreachable on this surface** by construction (FR-008). The reviewer-stripping wrapper guarantees the classifier never returns `"reviewer"` because the input's `reviewers` is always `[]`.

## 4. Row construction

For the `pr-list` content state, the consumer:

1. Concatenates each week's `by_reviewer[reviewerId].prs` array across the active period (the rollups slice the chart received) into a single working set.
2. Applies the author / repo filter overlay (if `options.filters` carries `authors` and/or `repos`) by filtering each working-set row's `author_id` / `repository_id` against the active set.
3. Sorts the filtered set by `cycle_time desc, id asc` (cross-week re-sort at the consumer per data-model.md § 6 — the producer's per-(reviewer, week) sort is preserved within each week, but the cross-week union must be re-sorted because per-(reviewer, week) slices are independent).
4. Maps each `PrRecord` to a `PrListRow` byte-for-byte the same way throughput / cycle-time do (`throughput-drilldown.ts:155-173`, `cycle-time-drilldown.ts:127-145`):

```typescript
const rows: PrListRow[] = sortedFilteredSet.map((pr): PrListRow => {
    if (!commentsMetricsAvailable) {
        return {
            id: pr.id,
            title: pr.title,
            cycleTimeMinutes: pr.cycle_time,
            url: resolvePrUrl(pr, options.repositoriesDimension, webContext),
        };
    }
    return {
        id: pr.id,
        title: pr.title,
        cycleTimeMinutes: pr.cycle_time,
        url: resolvePrUrl(pr, options.repositoriesDimension, webContext),
        threadCount: pr.thread_count,
        commentCount: pr.comment_count,
        activeThreadCount: pr.active_thread_count,
    };
});
```

This is byte-for-byte the same construction throughput + cycle-time use. The reviewer consumer MUST NOT add per-row fields beyond this shape, and MUST NOT omit fields the capability gate dictates.

## 5. Section construction

The `pr-list` variant MUST be constructed via the existing factory:

```typescript
return makePrListSection({
  contentState: "pr-list",
  rows,
  renderedCount: rows.length,
  actualFilteredCount: <sum-of-per-(reviewer,week)-reviewed_prs-after-overlay>,
  capValue: <max-of-participating-weeks-_prs_cap>,
  commentsMetricsAvailable,
});
```

The message variants MUST be constructed via the same factory:

```typescript
makePrListSection({ contentState: "supported-empty" });
makePrListSection({ contentState: "team-inline" });
// reviewer-inline is unreachable on this surface; do NOT emit it.
```

No alternative factory function may be introduced for reviewer.

## 6. Truncation cue

When the consumer constructs a `pr-list` section, the `capValue` (= 500, the per-(reviewer, week) cap) and `actualFilteredCount` fields drive the truncation cue rendering inside the shared `PrListSection` renderer in `detail-panel.ts`. The cue appears whenever:

- ANY participating week's `by_reviewer[reviewerId]._prs_truncated` is `true`, OR
- the rendered count is strictly less than the sum of `reviewed_prs` across participating weeks (defensive — would only fire if the producer drops to truncation after emission, which is a contract violation).

The reviewer consumer MUST NOT emit its own truncation cue. The shared renderer is the single owner. (FR-010 parity.)

## 7. URL composition

PR URLs MUST be composed via the existing `resolvePrUrl(pr, repositoriesDimension, webContext)` helper. The reviewer consumer MUST NOT build URLs ad-hoc. (FR-004 parity.)

## 8. Rendered-DOM order assertion (FR-019)

A consumer-side automated test (`reviewer-pr-list-order.test.ts`) MUST exist that:

1. Constructs a fixture rollup set where multiple weeks each carry per-(reviewer, week) `prs[]` slices for the focused reviewer, with cycle-times spread so the cross-week union has a non-trivial order.
2. Drives the reviewer install, simulates a click on the focused reviewer's bar, and inspects the rendered `<ol>` (or equivalent list element) inside the panel.
3. Asserts the rendered DOM order is exactly `cycle_time` descending, with `id` ascending as the tiebreak.

The assertion MUST operate on the rendered output, not on the input array, so the contract holds whether the implementation re-sorts at the consumer or relies on cross-week stable merge.

**Coverage of multi-week scenarios is mandatory** — single-week-input tests are insufficient because the cross-week sort is the new contract this feature introduces (the producer's per-(reviewer, week) sort is per-week, so the cross-week union needs explicit handling).

## 9. Accessible-name stability assertion (FR-012)

A consumer-side automated test MUST exist that:

1. Drives the reviewer install with three fixture inputs that triggers each of the three reachable content states (`pr-list`, `supported-empty`, `team-inline`).
2. Inspects the rendered PR list section element (the stable `<section>` shell) and reads its accessible name (e.g., `aria-label` or `aria-labelledby`).
3. Asserts the accessible name is identical across all three states.

Citing the throughput or cycle-time equivalent does NOT satisfy this requirement — those tests cover differently-rendered DOM. The reviewer drill-down is rendered by `reviewer-drilldown.ts` (a different module), so its DOM is not covered by other modules' tests.

**Three states, not four** — the reviewer surface does not reach the `reviewer-inline` content state by construction (FR-008).

## 10. Keyboard / Tab reachability assertion (FR-013)

Consumer-side automated tests MUST exist that:

1. Render the reviewer-activity chart with a focusable bar row, simulate `Enter` (and separately `Space`) keypresses on the focused row, and assert the panel opens with a `pr-list` content state. The existing reviewer-drilldown keyboard tests at `reviewer-drilldown.test.ts:508-538` cover the event handler; the new tests assert the PR list ALSO renders.
2. With the panel open and the PR list rendered, assert each PR row is reachable via `Tab` traversal in the same focus order the throughput PR list establishes (rows in DOM order — first row first).

These tests MUST be co-located with `reviewer-drilldown.test.ts` (or a sibling reviewer-named test file). Throughput's and cycle-time's keyboard tests do NOT satisfy this requirement.

## 11. Capability-off DOM byte-identity (FR-026)

A golden test (`reviewer-pr-list-capability-off-baseline.test.ts`) MUST exist that:

1. Renders the reviewer drill-down PR list with `commentsMetricsAvailable = false` against a fixed fixture.
2. Compares the resulting `<section>` innerHTML byte-for-byte to a committed baseline file at `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html` (created by the implementer in the same commit, generated from a known fixture and verified to match the post-implementation render).
3. Fails on any drift in tag, attribute order, class set, or whitespace.

This mirrors the existing `pr-list-capability-off-baseline.test.ts` for throughput AND `cycle-time-pr-list-capability-off-baseline.test.ts` for cycle-time. The three baselines are necessarily different files (different surrounding panel sections in the rendered output), but all three are byte-identity locks against unintended DOM changes when the comments-metrics capability is off.

## 12. Rendered-count parity test

A consumer-side automated test (`reviewer-pr-list-count-parity.test.ts`) MUST exist that, under the `pr-list` content state:

- Asserts the count of rendered `<li>` (or equivalent) row elements equals the sum of `len(by_reviewer[reviewerId].prs)` across participating weeks (under non-truncation).
- Asserts no row is hidden, no row is duplicated, no row is rendered outside the cap union.

This mirrors the existing `pr-list-count-parity.test.ts` for throughput. The reviewer test runs against the reviewer consumer (a different render path) and does not share fixtures or assertions with the throughput / cycle-time equivalents.

## 13. Comparison-mode toast (FR-009 parity)

The reviewer module already short-circuits comparison via `isDrilldownDisabledByComparison()` followed by `showComparisonAdvisoryToast(trigger)` (verified at `reviewer-drilldown.ts:232-235`, locked by `reviewer-drilldown.test.ts:492-502`). This contract specifies only that the existing behavior MUST remain unchanged — no new toast text, no new policy, no new code path. A regression-lock test asserting "comparison mode → no panel + toast fires" is already present at `reviewer-drilldown.test.ts:492-502` and continues passing unchanged.

A new test MUST be added that asserts: when comparison mode is active AND the user has a single reviewer filter set AND the user clicks the row, the panel does NOT open AND the PR list section is therefore not rendered. This is a regression lock confirming the new PR list section does not bypass the existing comparison short-circuit.

## 14. 310 spread-guard ALLOWED_MODULES (FR-027)

Per FR-027, `extension/ui/modules/drilldown/reviewer-drilldown.ts` MUST be added to the `ALLOWED_MODULES` Set declared at `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts:32-47`:

```typescript
const ALLOWED_MODULES: ReadonlySet<string> = new Set([
    "throughput-drilldown.ts",
    "cycle-time-drilldown.ts",
    // Feature 362 (FR-005 + contract § 4): reviewer drill-down's PR
    // list MUST display the same per-row thread / comment / unresolved
    // counts when the host data carries the comments-metrics capability.
    // The reviewer consumer reuses the shared `PrListSection` discriminated
    // union and the shared renderer; this allowlist entry is the
    // 310-spread-guard's acknowledgement of 362's authorized scope expansion.
    // The guard remains active for every other drill-down module.
    "reviewer-drilldown.ts",
]);
```

The comment block matches the existing 361 entry's pattern at `:38-46` so a future maintainer reading the allowlist sees the three authorized scope expansions in parallel form.

## 15. Floor-bump contract (FR-020 / QG-43)

The set of new tests added under this contract MUST be staged in the same commit as the producer + consumer + demo-generator + strip-helper changes. **Both `.test-floor-contract.json` floors bump in the same commit.**

- `extension.min_collected` MUST be updated to the count `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` reports for that commit.
- `python.min_collected` MUST be updated to the count the same command reports for the Python dimension.

No `[ratchet-realignment]` marker is honored for extension drift; the floor must equal the actual. The Python `[ratchet-realignment]` marker is permitted ONLY with explicit user authorization per FR-021; the default plan adds tests in lockstep with implementation in the same commit (no marker).

## Tests that assert this contract

- `extension/tests/modules/drilldown/reviewer-drilldown.test.ts` (extended) — install signature, panel ordering, classification → state mapping under the reviewer-stripping wrapper, comparison toast, retarget across reviewer change, capability on/off shape, accessible-name stability across 3 reachable content states.
- `extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts` (NEW) — § 8 rendered-DOM order assertion (cross-week union sort).
- `extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts` (NEW) — § 12 rendered-count parity (sum of per-(reviewer, week) reviewed_prs).
- `extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts` (NEW) — § 11 capability-off DOM byte-identity.
- `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` (extended ALLOWED_MODULES Set) — § 14.
- (a11y / keyboard tests for §§ 9–10 live in the main `reviewer-drilldown.test.ts`.)

## What this contract does NOT cover

- The shape of `PrRecord` / `PrListSection` / `PrListRow` / `FilterClassification` — owned by feature 060's contracts.
- The producer's per-(reviewer, week) sort, truncation, and emission logic — owned by [`per-reviewer-week-prs.md`](./per-reviewer-week-prs.md).
- The detail-panel's overall lifecycle (open / close / retarget / dismiss reasons) — owned by feature 059's `detail-panel-api.md`.
- The chart-side click hooks — owned by `extension/ui/modules/charts/reviewer-activity.ts`, which already emits `data-drilldown-reviewer-id` + `tabindex=0` + `role=button` + `aria-expanded` + accessible label (verified at `:206-208`).
- The reviewer-stripping wrapper's exact code location. The contract specifies the SEMANTIC (`{...filters, reviewers: []}` before `classifyFilterState`); whether it's a free function inside `reviewer-drilldown.ts` or an inline expression at the call site is an implementation choice. Either form satisfies the static-authority invariant (the predicate IS the shared `classifyFilterState`; only the input is adjusted).
