# Research: Cycle-Time Chart PR-Level Detail

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Phase**: 0 (research) — verifying every assumption that informs the plan and the spec, against live code.

## Approach

Every research unknown for this feature reduces to "is the existing throughput drill-down's machinery reusable on the cycle-time surface, exactly as-is?". The 5-point review cycle on the spec forced direct verification of each link in that chain. This document records each finding with the file path and line range that supports it, so a reader can confirm the basis without re-running the search.

No `[NEEDS CLARIFICATION]` markers remain in the spec; nothing here is a deferred decision.

## R1 — Throughput drill-down's PR list flow is the reusable model

**Decision**: Mirror throughput's classification → state-mapping → render pipeline on the cycle-time surface. Keep the four content states (`pr-list`, `supported-empty`, `team-inline`, `reviewer-inline`) intact; do not invent new variants.

**Evidence**:
- `extension/ui/modules/drilldown/throughput-drilldown.ts:119-184` — `buildPrListSection(rollup, options)` calls `classifyFilterState(filters, false)` then switches on `classification`:
  - `"team"` → `makePrListSection({ contentState: "team-inline" })`
  - `"reviewer"` → `makePrListSection({ contentState: "reviewer-inline" })`
  - `"supported"` → either `supported-empty` (when `rawPrs.length === 0 || !webContext || capValue === undefined`) or `pr-list` with rows
- `extension/ui/modules/shared/detail-panel.ts:144-282` — `PrListSection` is a discriminated union (`PrListSectionWithRows` | `PrListSectionMessage`); `makePrListSection` is the single factory for both branches.

**Rationale**: the four-state union is regression-locked across multiple consumer surfaces (throughput, comments-trend) and is exhaustively tested by the existing `pr-list-*.test.ts` suite. Reusing it means cycle-time inherits all of that behavior without duplicating the union, the factory, or the renderer.

**Alternatives considered**:
- *Cycle-time-specific PR list union*: rejected — duplicates a regression-locked contract; would require parallel test coverage for behavior already proven on throughput.
- *Inline boolean conditionals at the cycle-time call site*: rejected — sidesteps `classifyFilterState`, violating QG-49 ("each gate defined exactly once and invoked by name") and the static-authority invariant in `extension/tests/invariants/`.

## R2 — Producer order is reusable; the rendered DOM is the contract

**Decision**: The cycle-time consumer trusts the producer's existing PR array order (`cycle_time desc, id asc`). No re-sort at the consumer. Test FR-019 asserts the rendered DOM order, not the input array's order.

**Evidence**:
- `extension/ui/modules/drilldown/throughput-drilldown.ts:135` — `const rawPrs = rollup.prs ?? []`
- `extension/ui/modules/drilldown/throughput-drilldown.ts:155` — `const rows: PrListRow[] = rawPrs.map((pr): PrListRow => ...)` — `.map()` preserves order; no `.sort(...)` anywhere in `buildPrListSection`.
- `specs/060-throughput-pr-drilldown/contracts/pr-record.md` — producer contract step 2: "Sort qualified set by `(-cycle_time_minutes, pull_request_id)` (cycle_time desc, id asc tiebreak)".

**Rationale**: throughput already accepts producer order; the order matches the cycle-time intent (slowest first); duplicating the sort at the consumer is wasted work AND would mask a future producer drift instead of surfacing it. The rendered-DOM assertion (FR-019) covers both implementation paths: if a future change re-orders the producer array, the test fires; if a future implementer chooses to sort at the consumer instead, the same test still passes. The contract is the user-visible output, not the implementation path.

**Alternatives considered**:
- *Sort at the consumer (defensive double-sort)*: rejected as wasted CPU and a behavior-hider — a defensive consumer sort would mask producer-side regressions that the test is designed to catch.
- *Skip the order assertion and document "trust the producer"*: rejected — the user explicitly required an order test "independent of throughput's likely merge/order semantics" (review point #3); FR-019 makes that requirement first-class.

## R3 — Demo currently includes `prs` arrays; feature is data-state-driven

**Decision**: The cycle-time drill-down on the demo will render the PR list (not the empty-state), identical to throughput's current behavior on the demo. No demo-side workflow change. The feature stays correct under either outcome of the separate #315 tracking work.

**Evidence**:
- Direct read: `docs/data/aggregates/weekly_rollups/2025-W28.json` carries `prs` (151 records), `_prs_cap=500`, `_prs_truncated=false`. Verified by `python -c "...json.load(open(...))"` during spec drafting.
- `scripts/strip_pr_arrays.py:1-10` — strip helper exists with the documented contract (FR-023 of feature 060) but the script's own docstring confirms it is "flow-neutral" and only strips when invoked. The current published `docs/data/` was clearly published without the strip step (every rollup retains all three PR-level fields).
- Issue #315 — referenced in this spec's Edge Cases and Assumptions as the open tracking question for whether the demo SHOULD strip; this feature is independent of the answer.

**Rationale**: a feature whose acceptance criteria depend on the *current* demo posture would silently break the moment #315 is resolved (in either direction). FR-011's `supported-empty` trigger is `rawPrs.length === 0 || !webContext || capValue === undefined` — purely state-driven. If the demo ever begins stripping, the same code path takes over without any spec or implementation change.

**Alternatives considered**:
- *Force-strip the demo as part of this feature*: rejected — that's #315's scope, not this feature's. Forcing the strip would be a producer-side workflow change in violation of FR-016.
- *Block this feature until #315 is resolved*: rejected — the two are independent; this feature is correct under both outcomes of #315.

## R4 — Cycle-time chart already emits all needed click hooks

**Decision**: No change to `extension/ui/modules/charts/cycle-time.ts` required.

**Evidence**:
- `extension/ui/modules/charts/cycle-time.ts:310` — P90 dot emits `<g role="button" tabindex="0" data-drilldown-week="..." data-drilldown-metric="p90" aria-expanded="false" aria-label="...">`
- `extension/ui/modules/charts/cycle-time.ts:311` — symmetric P50 dot emission with `data-drilldown-metric="p50"`
- `extension/ui/modules/drilldown/cycle-time-drilldown.ts:111-112` — `resolveTrigger` already reads `[data-drilldown-metric]`; `activate` (lines 139-170) already routes the click to the panel via `openDetailPanel`.

**Rationale**: every primitive the new PR list requires is already on the wire from the chart. The work is consumer-side wiring inside `cycle-time-drilldown.ts`, not chart-side rendering.

**Alternatives considered**:
- *Add new data attributes for the PR list*: rejected — the existing attributes are sufficient; adding more is FR-016 territory (chart change) and unjustified.

## R5 — Existing a11y / keyboard tests cover throughput, not cycle-time

**Decision**: Add cycle-time-specific consumer tests for FR-012 (accessible-name stability) and FR-013 (keyboard activation + Tab reachability). Citing throughput's tests does not satisfy the FRs.

**Evidence**:
- `extension/tests/modules/drilldown/throughput-drilldown.test.ts:386` — `"keyboard Enter on a focused bar opens the panel"` — exercises throughput's bars, not cycle-time's dots.
- `extension/tests/modules/drilldown/throughput-drilldown.test.ts:403` — `"keyboard Space ... calls preventDefault"` — same scope.
- `extension/tests/modules/drilldown/throughput-drilldown.test.ts:555` — `"bars expose a button-role focusable surface (tabindex=0, role=button, focus() works)"` — same scope.
- `extension/tests/modules/drilldown/cycle-time-drilldown.test.ts` — exists but has no PR-list rendering coverage today (the module currently doesn't render a PR list).

**Rationale**: the throughput tests assert behavior on throughput-rendered DOM. Cycle-time's panel is rendered by `cycle-time-drilldown.ts` (a different module), so its DOM is not what those tests cover. Citing them as proof would be a false equivalence.

**Alternatives considered**:
- *Refactor throughput's tests to share a parameterized suite with cycle-time*: rejected for this feature — that's a test-architecture refactor with its own scoping decisions, and the issue's parent catalog (#318) does not authorize it under #361. Pure consumer-side test additions in the cycle-time test files are the right scope here.

## Cross-cutting findings

- **No new dependencies.** Everything reused: `PrListSection`, `makePrListSection`, `PrListRow`, `isPartialPrRow`, `classifyFilterState`, `resolvePrUrl`, `comparison-advisory`, `formatWeekTitle`, `dismissAllTooltips`, `openDetailPanel`. Verified via grep.
- **No producer-side test floor delta.** Python tests are not added because no Python code path is touched. `python.min_collected` stays at its current value.
- **No suppression delta.** `.suppression-baseline.json` stays at zero across `typescript-extension` and `typescript-tests`.
- **No tsconfig change.** New tests fall under the existing `tsconfig.test.json` compilation scope (`extension/tests/**/*.ts`); pre-commit `tsc --noEmit -p tsconfig.test.json` already triggers on changes there.

## Open items: none

No clarifications, no deferred decisions, no follow-ups for the planner. Phase 0 declared **COMPLETE**.
