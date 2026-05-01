# Contract: Cycle-Time PR List Section

**Scope**: consumer (extension UI) — `extension/ui/modules/drilldown/cycle-time-drilldown.ts` and its dashboard call site at `extension/ui/dashboard.ts`.

**Authoritative spec refs**: FR-001 through FR-020. Feature 060's contracts (`pr-record.md`, `pr-list-section.md`, `filter-support.md`) are inherited unchanged; this contract specifies only the cycle-time-specific additions and parity obligations.

> This contract governs the **consumer-side** behavior of the cycle-time drill-down's PR list. There is no producer-side counterpart — the producer fields (`prs`, `_prs_truncated`, `_prs_cap`) are governed by `specs/060-throughput-pr-drilldown/contracts/pr-record.md` and are reused here as-is.

## 1. Install signature

`installCycleTimeDrilldown` MUST accept an optional third argument: a `CycleTimeDrilldownOptions` bag with the same field shape as `ThroughputDrilldownOptions` (see `data-model.md` § 3). Existing two-argument call sites (if any) MUST continue to work — the options bag is fully optional, and absent fields fall through to safe defaults equivalent to the current cycle-time behavior (no PR list rendered when no options are passed).

```typescript
export function installCycleTimeDrilldown(
  container: HTMLElement,
  rollups: readonly Rollup[],
  options?: CycleTimeDrilldownOptions,
): { dispose(): void };
```

The `dashboard.ts` call site MUST pass an options bag built from the same sources `installThroughputDrilldown` reads: the active filter state, the repositories dimension, the cached `webContext`, the authors dimension, and the `commentsMetricsAvailable` capability flag.

## 2. Section ordering

`buildPanelContent` MUST emit panel sections in this order:

1. **Stat row** — metric-specific headline (`P50`, `P90` row). Existing.
2. **By repository breakdown** — sorted by `pr_count desc`, with P50 / P90 columns. Existing.
3. **PR list section** — the new section. NEW.

The PR list section MUST appear **after** the per-repository breakdown so a top-to-bottom reader sees aggregate context first, then specific PRs (FR-002).

The relative ordering of stat-row → breakdown → PR-list is regression-locked by an order assertion in the cycle-time test suite. (Mirroring the lock that exists for throughput's stat-row → byAuthor → byRepository → prList ordering at `throughput-drilldown.ts:228-234`.)

## 3. Content-state mapping (parity with throughput)

The cycle-time PR list section MUST emit exactly the same four content-state values as the throughput PR list section, under exactly the same triggering conditions:

| Trigger | Content state | Throughput parity |
|---|---|---|
| `comparisonActive === true` (handled upstream by `isDrilldownDisabledByComparison()` short-circuit; panel does NOT open) | (no panel; toast denial only) | identical to throughput's `activate()` short-circuit |
| `classification === "team"` | `team-inline` | identical |
| `classification === "reviewer"` | `reviewer-inline` | identical |
| `classification === "supported"` AND `rawPrs.length === 0` OR `!webContext` OR `capValue === undefined` | `supported-empty` | identical |
| `classification === "supported"` AND none of the above | `pr-list` | identical |

The classifier MUST be the shared `classifyFilterState(filters, false)` (the narrowed-return overload, since comparison is short-circuited upstream). Reconstructing the precedence from inline boolean checks at the call site is FORBIDDEN per the static-authority invariant (`extension/tests/invariants/`). This mirrors the throughput rule.

## 4. Row construction

For the `pr-list` content state, rows MUST be constructed via:

```typescript
const rows: PrListRow[] = rawPrs.map((pr): PrListRow => {
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

This is byte-for-byte the same construction throughput uses (`throughput-drilldown.ts:155-173`). The cycle-time consumer MUST NOT add per-row fields beyond this shape, and MUST NOT omit fields the capability gate dictates.

**`rawPrs` ordering invariant**: `rawPrs = rollup.prs ?? []`. The producer guarantees this array is sorted `cycle_time desc, id asc`. The cycle-time consumer trusts that order and does NOT re-sort. FR-019 ensures this trust is verified at the rendered-DOM level.

## 5. Section construction

The `pr-list` variant MUST be constructed via the existing factory:

```typescript
return makePrListSection({
  contentState: "pr-list",
  rows,
  renderedCount: rows.length,
  actualFilteredCount: rollup.pr_count,
  capValue,                     // = rollup._prs_cap (asserted defined by the supported-state guard above)
  commentsMetricsAvailable,
});
```

The message variants MUST be constructed via the same factory:

```typescript
makePrListSection({ contentState: "supported-empty" });
makePrListSection({ contentState: "team-inline" });
makePrListSection({ contentState: "reviewer-inline" });
```

No alternative factory function may be introduced for cycle-time.

## 6. Truncation cue

When the consumer constructs a `pr-list` section, the `capValue` and `actualFilteredCount` fields drive the truncation cue rendering inside the shared `PrListSection` renderer (in `detail-panel.ts`). The cue appears whenever `actualFilteredCount > capValue` — i.e., whenever the producer flagged the week as truncated.

The cycle-time consumer MUST NOT emit its own truncation cue. The shared renderer is the single owner. (FR-010 parity.)

## 7. URL composition

PR URLs MUST be composed via the existing `resolvePrUrl(pr, repositoriesDimension, webContext)` helper. The cycle-time consumer MUST NOT build URLs ad-hoc. (FR-004 parity.)

## 8. Rendered-DOM order assertion (FR-019)

A consumer-side automated test MUST exist that:

1. Constructs a fixture `rollup.prs` array where the input order does not trivially match the contract order (e.g., shuffled by `id` or random).
2. Drives the cycle-time install, simulates a click on the relevant week's dot, and inspects the rendered `<ol>` (or equivalent list element) inside the panel.
3. Asserts the rendered DOM order is exactly `cycle_time` descending, with `id` ascending as the tiebreak.

The assertion MUST operate on the rendered output, not on the input array, so the contract holds whether the implementation trusts the producer's pre-sort or sorts in the consumer.

## 9. Accessible-name stability assertion (FR-012)

A consumer-side automated test MUST exist that:

1. Drives the cycle-time install with four fixture inputs that triggers each of the four content states (`pr-list`, `supported-empty`, `team-inline`, `reviewer-inline`).
2. Inspects the rendered PR list section element (the stable `<section>` shell) and reads its accessible name (e.g., `aria-label` or `aria-labelledby`).
3. Asserts the accessible name is identical across all four states.

Citing the throughput equivalent (`detail-panel.test.ts` or similar) does NOT satisfy this requirement — those tests cover throughput-rendered DOM, not cycle-time-rendered DOM.

## 10. Keyboard / Tab reachability assertion (FR-013)

Consumer-side automated tests MUST exist that:

1. Render the cycle-time chart with a focusable dot, simulate `Enter` (and separately `Space`) keypresses on the focused dot, and assert the panel opens with a `pr-list` content state.
2. With the panel open and the PR list rendered, assert each PR row is reachable via `Tab` traversal in the same focus order the throughput PR list establishes (rows in DOM order — first row first).

These tests MUST be co-located with `cycle-time-drilldown.test.ts` (or a sibling cycle-time-named test file). Throughput's keyboard tests do NOT satisfy this requirement.

## 11. Capability-off DOM byte-identity (FR-015)

A golden test MUST exist that:

1. Renders the cycle-time PR list with `commentsMetricsAvailable = false` against a fixed fixture.
2. Compares the resulting `<section>` innerHTML byte-for-byte to a committed baseline file at `extension/tests/fixtures/cycle-time-drilldown-capability-off-baseline.html` (or equivalent path).
3. Fails on any drift in tag, attribute order, class set, or whitespace.

This mirrors the existing `pr-list-capability-off-baseline.test.ts` for throughput. The two baselines are necessarily different files (different surrounding panel sections in the rendered output), but both are byte-identity locks against unintended DOM changes when the comments-metrics capability is off.

## 12. Rendered-count parity (mirrors throughput's contract)

A consumer-side automated test MUST exist that, under the `pr-list` content state:

- Asserts the count of rendered `<li>` (or equivalent) row elements equals `min(actualFilteredCount, capValue)` exactly.
- Asserts no row is hidden, no row is duplicated, no row is rendered outside the cap.

This mirrors the existing `pr-list-count-parity.test.ts` for throughput. The cycle-time test runs against the cycle-time consumer (a different render path) and does not share fixtures or assertions with the throughput equivalent.

## 13. Comparison-mode toast (FR-009 parity)

The cycle-time module already short-circuits comparison via `isDrilldownDisabledByComparison()` followed by `showComparisonAdvisoryToast(trigger)` (verified at `cycle-time-drilldown.ts:147-149`). This contract specifies only that the existing behavior MUST remain unchanged — no new toast text, no new policy, no new code path. A regression-lock test asserting "comparison mode → no panel + toast fires" MUST exist in the cycle-time consumer test file.

## 14. Floor-bump contract (FR-020 / QG-43)

The set of new tests added under this contract MUST be staged in the same commit as the implementation. `.test-floor-contract.json` `extension.min_collected` MUST be updated to the count `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` reports for that commit. No `[ratchet-realignment]` marker is honored for extension drift; the floor must equal the actual.

## Tests that assert this contract

- `extension/tests/modules/drilldown/cycle-time-drilldown.test.ts` (extended) — install signature, panel ordering, classification → state mapping, comparison toast, retarget-in-place, capability on/off shape.
- `extension/tests/modules/drilldown/cycle-time-pr-list-order.test.ts` (NEW) — § 8 rendered-DOM order assertion.
- `extension/tests/modules/drilldown/cycle-time-pr-list-count-parity.test.ts` (NEW) — § 12 rendered-count parity.
- `extension/tests/modules/drilldown/cycle-time-pr-list-capability-off-baseline.test.ts` (NEW) — § 11 capability-off DOM byte-identity.
- (a11y / keyboard tests for §§ 9–10 may live in the main `cycle-time-drilldown.test.ts` or in a sibling file depending on size; both options satisfy the contract.)

## What this contract does NOT cover

- The shape of `PrRecord` / `PrListSection` / `PrListRow` / `FilterClassification` — owned by feature 060's contracts.
- The producer's per-week sort, truncation, and emission logic — owned by `specs/060-throughput-pr-drilldown/contracts/pr-record.md`.
- The detail-panel's overall lifecycle (open / close / retarget / dismiss reasons) — owned by feature 059's `detail-panel-api.md`.
- The chart-side click hooks — owned by `extension/ui/modules/charts/cycle-time.ts`, which already emits `data-drilldown-week` + `data-drilldown-metric` (verified at `cycle-time.ts:310-311`).
