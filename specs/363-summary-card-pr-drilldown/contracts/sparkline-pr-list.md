# Contract: Summary-Card Sparkline PR List Section

**Scope**: consumer (extension UI) — `extension/ui/modules/drilldown/sparkline-navigator.ts`, its support helper in `extension/ui/modules/drilldown/week-range.ts` (new `formatPeriodTitle`), the trigger emission in `extension/ui/modules/charts/summary-cards.ts`, and the dashboard call site at `extension/ui/dashboard.ts:1320-1345`.

**Authoritative spec refs**: FR-001 through FR-023, SC-001 through SC-008, LD-1 through LD-5. Feature 060's contracts (`pr-record.md`, `pr-list-section.md`, `filter-support.md`) are inherited unchanged. Feature 361's `cycle-time-pr-list.md` and Feature 362's `reviewer-pr-list.md` are the structural templates; this contract specifies only the sparkline-driven divergences.

> This contract governs the **consumer-side** behavior of the summary-card sparkline drill-down's period-scoped PR list. There is no producer-side counterpart — the producer fields (`prs`, `_prs_truncated`, `_prs_cap`, `pr_count`) are governed by `specs/060-throughput-pr-drilldown/contracts/pr-record.md` and reused as-is.

## 1. Install signature

`installSparklineNavigator` MUST accept three arguments: the container element, the active rollup window, and an optional `SparklineDrilldownOptions` bag with the same field shape as `ThroughputDrilldownOptions` / `CycleTimeDrilldownOptions` / `ReviewerDrilldownOptions` (see `data-model.md` § 3). Existing single-argument call sites are updated; the new signature has the rollups + options as required arguments after the container.

```typescript
export function installSparklineNavigator(
  container: HTMLElement,
  rollups: readonly Rollup[],
  options?: SparklineDrilldownOptions,
): { dispose(): void };
```

The `dashboard.ts` call site (currently at L1343) MUST pass the same options bag the existing cycle-time / reviewer installs build at L1320-1337, plus `currentRollups` as the second argument. Single options bag construction across all four drilldown installs.

## 2. Period title formatter (Q-R2 lock)

The new helper `formatPeriodTitle(rollups: readonly Rollup[]): string` MUST be added to `extension/ui/modules/drilldown/week-range.ts` and exported. **Do NOT** overload `formatWeekTitle(rollup)`; do NOT add the multi-rollup branch inside the existing single-rollup helper.

### Output strings (locked enumeration)

| Window shape | Output |
|---|---|
| `[]` (0 rollups, unreachable in production) | `"No period selected"` |
| `[r]` (1 rollup) | `formatWeekTitle(r)` — e.g. `"Week of Mar 17 – 23, 2025"` (delegates to existing helper) |
| `[r1, r2, ...]` (2+ rollups, same year) | `"Period of {earliest start_month} {earliest start_day} – {latest end_month} {latest end_day}, {year}"` — e.g. `"Period of Mar 17 – Apr 13, 2025"` |
| `[r1, r2, ...]` (2+ rollups, cross-year) | `"Period of {earliest start_month} {start_day}, {start_year} – {latest end_month} {end_day}, {end_year}"` — e.g. `"Period of Dec 30, 2024 – Jan 26, 2025"` |

### Earliest start / latest end resolution

For each rollup in the array:
1. Try `parseIsoLocalDate(rollup.start_date)` and `parseIsoLocalDate(rollup.end_date)`. Both must be non-null.
2. If either is null, fall back to `isoWeekRange(rollup.week)` and use its `{ start, end }` pair.
3. If both fail, skip that rollup from the period-range computation.

After walking, `earliestStart = min(allStarts)` and `latestEnd = max(allEnds)`. If after the walk no rollup contributed a valid date pair, return `"No period selected"`.

The same-year vs cross-year branching delegates to existing `formatWeekRangeTitle(start, end)` (`week-range.ts:80-97`); the helper does NOT duplicate year-handling logic.

### Per-card title concatenation (call-site ownership)

The `— P50` / `— P90` marker concatenation lives at the call site inside `sparkline-navigator.ts`'s `buildPanelContent`, NOT inside `formatPeriodTitle`:

| Card | Panel title construction |
|---|---|
| `totalPrs` (throughput) | `formatPeriodTitle(rollups)` |
| `cycleP50` (cycle-time) | `` `${formatPeriodTitle(rollups)} — P50` `` |
| `cycleP90` (cycle-time) | `` `${formatPeriodTitle(rollups)} — P90` `` |

The em-dash separator and uppercase `P50` / `P90` exactly mirror `cycle-time-drilldown.ts:165`'s pattern (`${formatWeekTitle(rollup)} — ${metric.toUpperCase()}`).

### Subtitle (separate from title)

Subtitle for all three eligible cards MUST be:

```typescript
const totalPeriodPrCount = rollups.reduce((sum, r) => sum + r.pr_count, 0);
const subtitle = `${totalPeriodPrCount} ${totalPeriodPrCount === 1 ? "PR" : "PRs"}`;
```

Pluralization rule mirrors `throughput-drilldown.ts:191` and `cycle-time-drilldown.ts:166`. The capValue is exposed via the truncation cue (§ 3 below), separately from subtitle.

### Reviewer card excluded

The reviewer card never opens the panel (LD-2 / FR-002). `formatPeriodTitle` is NOT called for reviewer card activation. The reviewer card's existing scroll-and-highlight branch never produces a panel title.

## 3. Period-scoped PR list shape (LD-1 envelope)

For the `pr-list` content state, the consumer:

1. **Walks the rollup window** via the private accumulator helper inside `sparkline-navigator.ts`:

```typescript
function buildPeriodScopedEnvelope(rollups: readonly Rollup[]):
  | { collected: PrRecord[]; capValue: number; anyTruncated: boolean; totalPeriodPrCount: number }
  | "supported-empty"
{
  let capValue: number | undefined;
  let totalPeriodPrCount = 0;
  let anyTruncated = false;
  const collected: PrRecord[] = [];
  for (const rollup of rollups) {
    const prsArray = rollup.prs;
    const truncated = rollup._prs_truncated;
    const cap = rollup._prs_cap;
    if (!Array.isArray(prsArray) || typeof truncated !== "boolean" || typeof cap !== "number") {
      return "supported-empty";  // FR-007: any participating rollup missing the trio fires supported-empty
    }
    capValue = capValue === undefined ? cap : Math.max(capValue, cap);
    totalPeriodPrCount += rollup.pr_count;
    if (truncated) anyTruncated = true;
    for (const pr of prsArray) collected.push(pr);
  }
  if (collected.length === 0 || capValue === undefined) {
    return "supported-empty";
  }
  return { collected, capValue, anyTruncated, totalPeriodPrCount };
}
```

2. **Re-sorts** `collected` by `cycle_time desc, id asc` (LD-1 step 6, mirrors `reviewer-drilldown.ts:352-355`):

```typescript
const sorted = collected.slice().sort((a, b) => {
  if (b.cycle_time !== a.cycle_time) return b.cycle_time - a.cycle_time;
  return a.id - b.id;
});
```

3. **Maps each `PrRecord` to a `PrListRow`** byte-for-byte the same way throughput / cycle-time / reviewer do (`throughput-drilldown.ts:155-173`, `cycle-time-drilldown.ts:127-145`, `reviewer-drilldown.ts:360-378`):

```typescript
const rows: PrListRow[] = sorted.map((pr): PrListRow => {
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

4. **Computes truncation envelope** (LD-1 step 7-8):

```typescript
const truncationDetected = anyTruncated || collected.length < totalPeriodPrCount;
const actualFilteredCount = truncationDetected ? totalPeriodPrCount : rows.length;
```

Per Q-R1=R1-A lock, there is no supplementary client-side overlay at this layer; the "pure-overlay reduction does not fire the cue" branch is unreachable in #363's scope (FR-008 forward-compat note).

5. **Constructs the section** via the shared factory (`makePrListSection`):

```typescript
return makePrListSection({
  contentState: "pr-list",
  rows,
  renderedCount: rows.length,
  actualFilteredCount,
  capValue,
  commentsMetricsAvailable,
});
```

The message variants MUST be constructed via the same factory:

```typescript
makePrListSection({ contentState: "supported-empty" });
makePrListSection({ contentState: "team-inline" });
makePrListSection({ contentState: "reviewer-inline" });
```

No alternative factory function may be introduced for the sparkline-driven panel.

### Content-state mapping

| Trigger | Content state |
|---|---|
| Comparison mode active (handled upstream by `isDrilldownDisabledByComparison()` short-circuit; panel does NOT open) | (no panel; toast denial only) |
| `data-drilldown-target-chart === "reviewer"` (handled before classifier; preserves scroll-and-highlight) | (no panel; existing scroll behavior) |
| Target chart element missing (handled before classifier; existing inline advisory) | (no panel; inline `renderNoData` message) |
| `classifyFilterState(filters, false) === "team"` | `team-inline` |
| `classifyFilterState(filters, false) === "reviewer"` | `reviewer-inline` |
| `classifyFilterState(filters, false) === "supported"` AND `buildPeriodScopedEnvelope` returned `"supported-empty"` (any participating rollup missing trio, OR `collected.length === 0`, OR `!webContext`, OR `capValue === undefined`) | `supported-empty` |
| `classifyFilterState(filters, false) === "supported"` AND envelope produced; `webContext` and `capValue` available | `pr-list` |

The classifier MUST be the shared `classifyFilterState(filters, false)` (the narrowed-return overload, since comparison is short-circuited upstream). Reconstructing the precedence from inline boolean checks at the call site is FORBIDDEN per the static-authority invariant (`extension/tests/invariants/`). Mirrors throughput / cycle-time.

### Panel section ordering

Per Q-R3 = OMIT lock, the sparkline-driven panel structure is:

| Section | When |
|---|---|
| Stats row (Feature-310 comments stat row) | `commentsMetricsAvailable: true` AND content state is `pr-list` |
| PR list section | Always |

`buildPanelContent` MUST emit panel sections in this order: `[stats?, prList]`. **No `byAuthor` or `byRepository` cross-week breakdowns.** This diverges from throughput's `[stats?, byAuthor, byRepository, prList]` and cycle-time's `[stats, byRepository, prList]` per LD-1 / Q-R3 lock — the period-scoped panel's user value is the PR list itself; cross-week breakdowns are duplicated work the user can already see in the full charts.

The relative ordering of stats?-then-prList is regression-locked by an order assertion in the sparkline test suite.

## 4. Capability-state propagation (Feature-310 gate)

The `commentsMetricsAvailable` flag (sourced from the dashboard via `loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false`) drives:

1. **Stat row presence** (FR-012): when `true` AND content state is `pr-list`, prepend the comments stat row built by the existing `buildCommentsStatRow` helper from throughput-drilldown.ts (or a duplicated equivalent for the sparkline-driven path — TBD in tasks). When `false` or content state is not `pr-list`, omit the stat row entirely.
2. **Per-row comments triplet** (FR-014): when `true`, each row carries `threadCount` / `commentCount` / `activeThreadCount`. When `false`, each row omits those fields entirely.
3. **DOM byte-identity** (FR-013): when `false`, the rendered DOM is byte-identical to a pre-310 shape — no comments columns, no comments stat row, no `--with-comments` modifier classes. Locked by a new capability-off baseline DOM golden fixture at `extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html` mirroring 361 / 362.

## 5. Active-trigger lifecycle (FR-015 / FR-016)

When the DetailPanel opens from a sparkline trigger:

1. Add the `is-drilldown-active` class to the activated trigger.
2. Set `aria-expanded="true"` on the activated trigger.
3. Register a `MutationObserver` on the panel root's `class` attribute (single observer, mirroring `throughput-drilldown.ts:355-365`).

When the panel closes (via any dismiss path — Escape, outside-click, close button, filters-changed, tab-changed, comparison-toggled, retarget):

1. The observer fires once.
2. Remove `is-drilldown-active` from the still-tracked trigger.
3. Set `aria-expanded="false"` on the still-tracked trigger.
4. Disconnect the observer; remove from the install's observer set.
5. Clear the active-trigger reference.

**Retarget-in-place ordering** (FR-016 4-step explicit sequence):

1. Remove `is-drilldown-active` and set `aria-expanded="false"` on the previously-active trigger.
2. Build new panel content for the new trigger (calling `buildPanelContent(rollups, options, targetCard, metricMarker)` or equivalent).
3. Call `openDetailPanel(...)` (which retargets the open panel without close-reopen flicker).
4. Add `is-drilldown-active` and set `aria-expanded="true"` on the new trigger.

**No-overlap invariants**:
- No window in this sequence may have BOTH triggers showing `is-drilldown-active` simultaneously.
- No window may have the new trigger displaying stale `aria-expanded="false"` after panel content has rendered.

## 6. Reduced-motion and comparison

### Reduced-motion (FR-017 / FR-018)

The reviewer-card scroll-and-highlight branch (preserved unchanged) MUST resolve `prefers-reduced-motion: reduce` to choose `scrollIntoView` behavior `auto` vs `smooth` — the existing `prefersReducedMotion()` helper at `sparkline-navigator.ts:92-95` is reused verbatim.

The DetailPanel-open branch MUST NOT introduce new animation logic. The panel's existing reduced-motion-aware CSS transition is sufficient; no new CSS or JS animation is added by this slice.

### Comparison mode (FR-004 / FR-019)

For every sparkline trigger (all four cards), when `isDrilldownDisabledByComparison()` returns `true`:

1. The system MUST fire the existing `showComparisonAdvisoryToast(trigger)`.
2. The system MUST NOT execute the scroll-and-highlight branch (reviewer card).
3. The system MUST NOT execute the DetailPanel-open branch (throughput / cycle-time cards).
4. The system MUST NOT execute the inline-advisory branch (missing-target).

Comparison gate runs BEFORE all other branches. Mirrors throughput / cycle-time / reviewer drilldowns.

## 7. Reviewer-card asymmetry preservation (LD-2 / FR-002 / FR-020)

The activate() function MUST branch on `data-drilldown-target-chart`:

```typescript
function activate(trigger: HTMLElement): void {
  dismissAllTooltips();

  if (isDrilldownDisabledByComparison()) {
    showComparisonAdvisoryToast(trigger);
    return;
  }

  const chart = trigger.getAttribute("data-drilldown-target-chart");
  if (chart !== "throughput" && chart !== "cycle-time" && chart !== "reviewer") return;

  const parent = trigger.parentElement;
  if (!parent) return;

  const targetEl = document.getElementById(targetIdFor(chart));
  if (!targetEl) {
    showAdvisoryIn(parent, chartLabel(chart));
    return;
  }
  clearAdvisoryIn(parent);

  if (chart === "throughput" || chart === "cycle-time") {
    // NEW: build period-scoped panel content and openDetailPanel(...)
    const panelContent = buildPanelContent(chart, trigger, rollups, options);
    const context: DrillDownContext = {
      sourceChart: "summary-card",
      focusedData: { kind: "summary-card", targetCard: targetCardFromTrigger(trigger) },
      triggerElement: trigger,
      content: panelContent,
    };
    openDetailPanel(context);
    // active-trigger lifecycle setup (FR-015)
    return;
  }

  // chart === "reviewer" — preserved scroll-and-highlight (FR-002)
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  targetEl.scrollIntoView({ behavior, block: "center" });
  // ... existing highlight class + setTimeout cleanup (sparkline-navigator.ts:132-140)
}
```

The reviewer-card branch is **byte-equivalent** to the existing implementation at `sparkline-navigator.ts:126-141`. Existing `sparkline-navigator.test.ts` tests that exercise the reviewer card stay green by construction.

`summary-cards.ts:wrapSparklineTrigger` MUST carry an inline comment block citing #363 / LD-2, explaining that the reviewer card preserves scroll-and-highlight while the other three cards open the panel — so future readers see the asymmetry rationale where the trigger is wired (FR-020).

## 8. Branch B helper-extraction posture (LD-4 / Q-R4 / FR-022 regression-lock)

Per Q-R4 = Branch B (Pass 3 lock), the cross-week union/cap/truncation walk is implemented as a **private helper inside the sparkline-driven path** (in `sparkline-navigator.ts` or a sibling module scoped to that file's imports). **No shared helper extraction.**

### Reviewer-drilldown regression-lock

The implementation commit's `git diff` MUST show **zero hunks** under each of the following six paths:

- `extension/ui/modules/drilldown/reviewer-drilldown.ts`
- `extension/tests/modules/drilldown/reviewer-drilldown.test.ts`
- `extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts`
- `extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts`
- `extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts`
- `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html`

Any modification to any of those six paths in a #363 commit is out of scope and MUST be reverted before merge. Pre-commit verification: `git diff --stat` against those paths SHOULD return zero changes; if any hunk appears, abort the commit, identify the cause, and revert.

### Branch A (rejected — preserved as historical reference)

Branch A (shared helper extraction consumed by both reviewer-drilldown and sparkline-navigator) was **considered and rejected during Pass 3 Q-R4 pre-flight** because:

1. Reviewer-drilldown's walk reads from per-(reviewer, week) `entry.{prs, _prs_truncated, _prs_cap, reviewed_prs}`; the sparkline walk reads from `rollup.{prs, _prs_truncated, _prs_cap, pr_count}`. A unifying helper requires a callback to abstract per-rollup extraction — adding indirection without saving meaningful code (~20 lines duplicated vs ~15 lines callback definition + result destructuring).
2. Reviewer-drilldown has 1 source file + 4 test files + 1 DOM-golden fixture in scope. Even with zero functional changes, callback-based restructure invites diff churn and forces re-verification of all five test files.
3. The duplication cost is acceptable: ~25 lines of accumulator walk in `sparkline-navigator.ts` with the same shape as reviewer-drilldown's walk. Documented and accepted; a future cross-surface refactor would need its own slice.

Plan / contracts / tasks MUST NOT include any task that imports from a hypothetical shared module; data-model / contracts MUST NOT specify a shared helper signature; tasks MUST NOT include an "extract helper" step. (FR-023.)

## 9. DOM contract

The sparkline-driven panel uses the existing `<aside.detail-panel>` shape with the existing `is-open` class lifecycle and the existing `data-content-state` attribute mirroring `section.contentState` (`detail-panel.ts:1174` for the existing renderer behavior).

Trigger DOM (emitted by `summary-cards.ts:wrapSparklineTrigger`):

```html
<button type="button"
        class="sparkline-trigger"
        data-drilldown-target-chart="throughput|cycle-time|reviewer"
        data-drilldown-cycle-metric="p50|p90"  <!-- cycle-time only; throughput and reviewer omit -->
        aria-label="Open full {chart} chart"   <!-- existing wording preserved -->
        aria-expanded="false">                  <!-- toggles to true when panel is open and trigger is the active source -->
  <svg>...</svg>
</button>
```

The `data-drilldown-cycle-metric` attribute is locked contract per FR-005; alternative names require re-spec.

The `aria-label` text remains "Open full {chart} chart" for backwards compatibility with existing accessibility testing — even though throughput / cycle-time card paths now open a panel rather than scrolling. The label refers to the affordance's intent (drill into PR detail) and the existing assistive-tech announcement remains accurate.

When the active class is on:

```html
<button class="sparkline-trigger is-drilldown-active" aria-expanded="true" ...>
  <svg>...</svg>
</button>
```

When the panel closes (any dismiss path), the class is removed and `aria-expanded="false"` is restored before any subsequent panel render (FR-015).

## 10. Capability-off DOM byte-shape (FR-013 lock)

When `commentsMetricsAvailable: false`, the rendered panel DOM MUST be byte-identical to a pre-310 shape:

- No `detail-panel-pr-list--with-comments` modifier class on the `<ol>`.
- No `detail-panel-pr-list-header--with-comments` modifier class on the `<header>`.
- No comments columns in the per-row markup.
- No comments stat row prepended above the PR list.
- No `data-content-state` value changes vs the existing pre-310 rendering — only `pr-list` / `team-inline` / `reviewer-inline` / `supported-empty`.

This invariant is locked by a new capability-off baseline DOM golden fixture at `extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html`, byte-compared by a new test in `extension/tests/modules/drilldown/sparkline-pr-list-capability-off-baseline.test.ts` (mirroring `cycle-time-drilldown-capability-off-baseline.test.ts` and `reviewer-drilldown-capability-off-baseline.test.ts`).

## 11. Test fixture requirements

### New fixture

`extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html` — byte-stable DOM golden produced by rendering the sparkline-driven panel with capability-off settings, an active-period rollup window with a non-trivial PR count, and the `pr-list` content state. Mirrors:
- `extension/tests/fixtures/cycle-time-drilldown-capability-off-baseline.html` (361)
- `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html` (362)

### Test files

| File | New / Extend | Coverage |
|---|---|---|
| `extension/tests/modules/drilldown/sparkline-navigator.test.ts` | EXTEND | DetailPanel-open scenarios for throughput / cycleP50 / cycleP90 cards (FR-001 / FR-005 / FR-006); reviewer-card preservation (FR-002 / SC-005); classifier branches per card (FR-011); capability gate (FR-012 / FR-014); comparison toast on all four (FR-004 / FR-019); reduced-motion (FR-017 / FR-018); keyboard activation (Enter / Space); missing-target advisory (FR-003 / SC-008); retarget-in-place between eligible cards (FR-016 / SC-002); active-trigger lifecycle (FR-015) |
| `extension/tests/modules/drilldown/sparkline-pr-list-order.test.ts` | NEW | FR-010 rendered-DOM order = `cycle_time desc, id asc` after cross-week union; multi-week unioned PR rows in correct order |
| `extension/tests/modules/drilldown/sparkline-pr-list-count-parity.test.ts` | NEW | FR-007 `capValue` field (= `max(per-rollup _prs_cap)`) + period row bound (= `sum(per-rollup _prs_cap)`); FR-008 truncation cue gating (`anyTruncated || collected.length < totalPeriodPrCount`); FR-009 `actualFilteredCount` correctness |
| `extension/tests/modules/drilldown/sparkline-pr-list-capability-off-baseline.test.ts` | NEW | FR-013 byte-identical DOM golden against the new baseline fixture |
| `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` | EXTEND | ALLOWED_MODULES extension (see § 12) |

`formatPeriodTitle` unit-test coverage is locked to a NEW `extension/tests/modules/drilldown/week-range.test.ts` file created by tasks.md T008 (Pass 2 lock). The four output-string branches (empty, single-rollup, same-year, cross-year) are tested there. No inline-in-sparkline-navigator.test.ts alternative.

## 12. Spread-guard `ALLOWED_MODULES` extension

`extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` — IFF `sparkline-navigator.ts` imports from `shared/detail-panel` (which it WILL, to call `openDetailPanel` and `makePrListSection`), the spread-guard's `ALLOWED_MODULES` constant MUST include `sparkline-navigator.ts`.

If the implementation deviates and avoids the import (e.g., by extracting the panel-build logic to a separate file), the spread-guard extension is NOT needed. Tasks MUST encode the conditional explicitly so the implementer makes the decision visible.

## 13. Edge cases (per spec § Edge Cases)

The sparkline-driven panel MUST handle all 11 edge cases enumerated in `spec.md` § Edge Cases. The contract-relevant subset:

- **Empty period** (every rollup has `pr_count: 0` and `prs: []`): `buildPeriodScopedEnvelope` returns `"supported-empty"` (collected.length === 0). Content state: `supported-empty`. (Same fall-through as throughput's empty-week case.)
- **Missing `_prs_cap` on a contributing rollup**: `buildPeriodScopedEnvelope` returns `"supported-empty"` from the trio-validation guard. Content state: `supported-empty`.
- **Missing `webContext`**: links can't be composed; the consumer MUST treat this as `supported-empty` regardless of envelope outcome (mirrors throughput / cycle-time guard).
- **Pure-overlay reduction (forward-compat note only, unreachable in #363's scope per Q-R1=R1-A)**: preserved here as documentation only; no current code path exercises this.
- **Keyboard activation on the reviewers card**: Enter/Space trigger the same scroll-and-highlight path as click; no DetailPanel opens (FR-002 invariant).
- **Retarget-in-place across cards**: clicking `totalPrs` then `cycleP50` retargets the same panel; the active class + aria-expanded MUST swap atomically per FR-016 4-step ordering.
- **Comparison toggled WHILE panel open**: existing dismiss-path observer fires; the panel closes, the active class clears.
- **Sparkline trigger missing entirely** (sparkline rendered as plain SVG due to insufficient data): no trigger to listen on; activation never fires. No new behavior.
- **Reduced-motion on the DetailPanel branch**: the panel-open path does not introduce new animation; the panel's existing CSS handles reduced-motion.
- **Touch activation**: relies on synthesized `click`. No new pointer handling.
- **Cross-source retarget** (e.g., cycle-time chart dot → throughput sparkline while panel is open): retarget-in-place handles this; the new `sourceChart: "summary-card"` value disambiguates from `"throughput"` (chart-bar source) so the panel API can clean up correctly.

## 14. Out-of-scope

Per spec Non-goals and Pass 3 / Pass 4 verification:

- PR-level detail on the cycle-time chart or reviewer chart — those are #365 and #362/#366; already shipped, separate surfaces.
- Comparison-mode drill-down behavior changes.
- New `PrRecord` fields, schema changes, or any producer-side work.
- Replacing the scroll-and-highlight navigator entirely; reviewer-card path preserved verbatim.
- Demo-data work (LD-5; Q-R5=R5-A confirmed).
- A "View all PRs" deferral link (LD-1's rejected Option C).
- Per-week sectioned panel layout (LD-1's rejected Option B).
- Cross-week aggregate breakdowns (`byAuthor` / `byRepository`) — locked OMIT per Q-R3.
- Shared helper extraction (`shared/period-pr-list.ts` or similar) — locked Branch B per Q-R4; reviewer-drilldown regression-locked.
- **Fixing pre-existing potential namespace mismatch in `applyFiltersToRollups` at `metrics.ts:921`** — `filters.repos.includes(repoId)` may compare repository_name strings against repository_id GUIDs in the per-PR filter step. This affects the existing throughput-drilldown / cycle-time-drilldown / sparkline-driven read path identically; #363 inherits the same behavior. Out of #363's scope; recorded as a separate triage item. **Do not let this expand #363's PR.**
