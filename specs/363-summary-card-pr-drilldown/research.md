# Research: Summary-Card Sparkline PR-Level Detail (Issue #363)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Phase**: 0 (research) — verifying every assumption that informs the plan and the spec, against live code.

## Approach

Pass 3 code-validation already resolved Q-R1 / Q-R4 / Q-R5 by source / artifact inspection. Pass 4 left Q-R2 (panel-title formatter shape) as the sole plan-time decision. This research document consolidates Pass 3's evidence into a canonical write-up and adds the Q-R2 pre-flight performed during this plan run.

No `[NEEDS CLARIFICATION]` markers remain in the spec; nothing here is a deferred decision.

## R1 — Dashboard pre-filters rollups before drilldown installs (Q-R1 = R1-A)

**Decision**: The new sparkline-driven panel consumes already-filtered `rollup.prs` arrays directly. **No supplementary client-side overlay** is applied at the sparkline-navigator layer.

**Evidence**:

- `extension/ui/dashboard.ts:1045`:
  ```typescript
  const rollups = applyFiltersToRollups(rawRollups, currentFilters);
  ```
  This runs **before** the drilldown installs at L1320-1345.
- `extension/ui/modules/metrics.ts:441` — `applyFiltersToRollups(rollups, filters): Rollup[]`. Function handles all four filter axes (repos, teams, reviewers, authors), per L454-461 emit-zero-rollup short-circuit.
- `extension/ui/modules/metrics.ts:906-924` — per-PR filtering walks `rollup.prs`, filters by `authorFilters.includes(pr.author_id)` and `filters.repos.includes(pr.repository_id)`, emits `filteredPrs` along with `_prs_truncated` and `_prs_cap` passthrough at L926-931.
- `extension/ui/modules/drilldown/throughput-drilldown.ts:135` reads `rollup.prs ?? []` directly with no overlay re-application — confirming the throughput path also relies on dashboard pre-filtering.

**Rationale**: every drilldown layer at HEAD treats `rollup.prs` as already-filtered. The new sparkline-driven panel inherits the same contract. Overlay re-application at this layer would be redundant work that no other consumer does, and would risk diverging from the existing per-week panel behavior.

**Out-of-scope flag** (recorded in spec Non-goals, NOT in #363's scope): `metrics.ts:921` reads `filters.repos.includes(repoId)` directly. Per `reviewer-drilldown.ts:99-100`, `filters.repos` carries `repository_name` strings and `pr.repository_id` is a GUID — these are different namespaces. The throughput / cycle-time / reviewer drilldowns and the new sparkline-driven panel all inherit this potential pre-existing bug. Triage in a separate PR. **Do not let this expand #363's scope.**

**Alternatives considered**:
- *Apply repo-name → repo-id translation overlay at the sparkline layer*: rejected — would diverge from the throughput / cycle-time existing read paths and would mask the pre-existing `metrics.ts:921` issue. Fixing the namespace mismatch is its own concern.
- *Treat the rollup window as un-filtered and re-apply filters at the drilldown layer*: rejected — duplicates work the dashboard already did; would also miss the team / reviewer aggregation that the dashboard does via `by_team` / `by_reviewer` slices.

## R2 — Q-R2 panel-title formatter pre-flight (this run)

**Decision**: Add a new helper `formatPeriodTitle(rollups: readonly Rollup[]): string` to `extension/ui/modules/drilldown/week-range.ts`. Output strings enumerated in plan.md "Q-R2 Decision" and in `contracts/sparkline-pr-list.md` § 2. Single-purpose helper; the `— P50` / `— P90` marker concatenation lives at the call site (mirroring `cycle-time-drilldown.ts:165`).

**Evidence**: read `extension/ui/modules/drilldown/week-range.ts` end-to-end (137 lines) during this plan run. Existing helpers exposed:

| Helper | Signature | Use |
|---|---|---|
| `parseIsoLocalDate` | `(iso: string) => Date \| null` | Parses `YYYY-MM-DD` to LOCAL-midnight Date with impossible-date rejection |
| `isoWeekRange` | `(week: string) => { start: Date; end: Date } \| null` | Computes Monday–Sunday range from ISO week key (fallback) |
| `formatWeekRangeTitle` | `(start: Date, end: Date) => string` | Condensed range formatter — same-month / cross-month / cross-year branching |
| `formatWeekTitle` | `(rollup: Rollup) => string` | "Week of {condensed range}" for single rollup |
| `weekRangeForAria` | `(rollup: Rollup) => string` | Parameterized aria-label string (no "Week of " prefix) |

**No multi-rollup helper exists at HEAD.** This confirms the Q-R2 decision: add a new `formatPeriodTitle` helper. Co-locating it in `week-range.ts` next to the single-rollup variants gives one file to audit when title behavior changes.

**Helper behavior** (locked here, mirrored in data-model.md § "Period title contract" and contracts/sparkline-pr-list.md § 2):

| Input | Output | Reuses |
|---|---|---|
| `[]` (0 rollups) | `"No period selected"` (unreachable in production; classifier rejects empty windows upstream) | n/a |
| `[r]` (1 rollup) | `formatWeekTitle(r)` — e.g. `"Week of Mar 17 – 23, 2025"` | `formatWeekTitle` |
| `[r1, r2, ...]` (2+ rollups, same year) | `"Period of {earliest start_month} {earliest start_day} – {latest end_month} {latest end_day}, {year}"` — e.g. `"Period of Mar 17 – Apr 13, 2025"` | `parseIsoLocalDate`, `formatWeekRangeTitle` |
| `[r1, r2, ...]` (2+ rollups, cross-year) | `"Period of {earliest start_month} {start_day}, {start_year} – {latest end_month} {end_day}, {end_year}"` — e.g. `"Period of Dec 30, 2024 – Jan 26, 2025"` | `parseIsoLocalDate`, `formatWeekRangeTitle` |

**Earliest start / latest end** are derived per-rollup by walking each rollup's `start_date` / `end_date` (or `isoWeekRange(rollup.week)` fallback). The helper takes the minimum across earliest starts and the maximum across latest ends; condensed formatting via `formatWeekRangeTitle` gets the year branching and month/day formatting for free.

**Rationale**:
1. **Single-purpose helper** — adding the period-range computation alongside the existing single-week computation in `week-range.ts` keeps title behavior auditable in one place.
2. **Single-rollup window delegates to existing `formatWeekTitle`** — preserves the existing wording ("Week of …") for 1-week selections; a "Period of Mar 17 – Mar 17, 2025" for a single week would read awkwardly.
3. **Reuses existing `formatWeekRangeTitle` building block** — does not duplicate same-month / cross-month / cross-year branching.
4. **Metric marker concatenation at the call site** — `formatPeriodTitle(rollups) + " — P50"` for cycle-time P50 mirrors `cycle-time-drilldown.ts:165`'s pattern and keeps `formatPeriodTitle` single-purpose.

**Alternatives considered and rejected**:
- *Overload `formatWeekTitle(rollup | readonly Rollup[])` with array-arm branching*: rejected per user directive #1. Would couple two title shapes in one function; would force the existing per-week drilldowns to compile against a wider parameter type for no behavioral benefit.
- *Inline period-title computation inside `sparkline-navigator.ts`*: rejected because the same-month / cross-month / cross-year branching already lives in `formatWeekRangeTitle`. Inlining duplicates testable invariants.
- *Add to `extension/ui/modules/shared/format.ts`*: rejected because `format.ts` is for primitive value formatters (durations, pluralization); rollup-shape-aware helpers belong in `drilldown/week-range.ts` next to `weekRangeForAria(rollup)` and `formatWeekTitle(rollup)`.

## R3 — Reviewer-drilldown union pattern is structurally distinct (Q-R4 = Branch B)

**Decision**: Local duplication of the cross-week union/cap/truncation accumulator walk inside the sparkline-driven path. **Reviewer-drilldown's six paths stay byte-untouched** (FR-022 regression-lock). No shared helper extraction.

**Evidence**:

Reviewer-drilldown walk at `extension/ui/modules/drilldown/reviewer-drilldown.ts:282-322` (verified during Pass 3):

```typescript
let capValue: number | undefined;
let totalReviewedPrs = 0;
let anyTruncated = false;
const collected: PrRecord[] = [];
for (const rollup of rollups) {
  const entry = reviewerEntry(rollup, reviewerId);
  if (!entry) continue;
  const prsArray = entry.prs;
  const truncated = entry._prs_truncated;
  const cap = entry._prs_cap;
  if (!Array.isArray(prsArray) || typeof truncated !== "boolean" || typeof cap !== "number") {
    return makePrListSection({ contentState: "supported-empty" });
  }
  capValue = capValue === undefined ? cap : Math.max(capValue, cap);
  totalReviewedPrs += entry.reviewed_prs;
  if (truncated) anyTruncated = true;
  for (const pr of prsArray) collected.push(pr);
}
```

The walk reads from **per-(reviewer, week)** entries — each rollup's `by_reviewer[reviewerId]` slice carries the trio (`prs`, `_prs_truncated`, `_prs_cap`) plus a `reviewed_prs` per-week count.

The new sparkline-driven walk reads from **rollup-level** fields directly:
```typescript
// (sketch — final implementation in tasks)
let capValue: number | undefined;
let totalPeriodPrCount = 0;
let anyTruncated = false;
const collected: PrRecord[] = [];
for (const rollup of rollups) {
  const prsArray = rollup.prs;
  const truncated = rollup._prs_truncated;
  const cap = rollup._prs_cap;
  if (!Array.isArray(prsArray) || typeof truncated !== "boolean" || typeof cap !== "number") {
    return makePrListSection({ contentState: "supported-empty" });
  }
  capValue = capValue === undefined ? cap : Math.max(capValue, cap);
  totalPeriodPrCount += rollup.pr_count;
  if (truncated) anyTruncated = true;
  for (const pr of prsArray) collected.push(pr);
}
```

A unifying helper requires a callback to abstract the per-rollup extraction:

```typescript
function unionPrsAcrossRollups(
  rollups: readonly Rollup[],
  extract: (r: Rollup) =>
    | { prs: PrRecord[]; cap: number; truncated: boolean; perWeekCount: number }
    | null     // skip rollup
    | "incomplete"  // abort to supported-empty
): { collected: PrRecord[]; capValue: number | undefined; anyTruncated: boolean; totalCount: number } | "supported-empty";
```

Reviewer-drilldown's call-site after extraction would replace ~20 lines of inline loop with ~15 lines of callback definition + result destructuring. **This is a structural refactor of the loop body, not a "single mechanical call-site swap."**

Per FR-022's hard abort criterion ("Reviewer-drilldown's source file requires NO modification beyond a single mechanical change at the helper's call site"), Branch A is disqualified at Q-R4 pre-flight.

**Rationale**: the duplication cost is ~25 lines of accumulator walk in `sparkline-navigator.ts`. The alternative (Branch A) requires a callback-based loop body restructure in reviewer-drilldown that:
1. Adds indirection without saving meaningful code.
2. Forces re-verification of 4 test files + 1 DOM-golden fixture even with zero functional changes.
3. Couples reviewer-drilldown's already-shipped contract to a future cross-surface abstraction without a third caller to justify it (consistent with `feedback_no_invented_abstractions.md`).

**Branch A rejected**. Branch B locked.

**Alternatives considered**:
- *Branch A — extract shared helper consumed by both surfaces*: rejected per Q-R4 pre-flight (above).
- *Refactor reviewer-drilldown's walk to match sparkline's rollup-level walk by pre-projecting per-(reviewer, week) entries*: rejected — would change reviewer-drilldown's source semantics and tests, violating FR-022 regression-lock.

## R4 — Demo data exercises the period PR-list path (Q-R5 = R5-A)

**Decision**: No demo regen needed. The period-scoped panel renders against existing demo data without modification. **No `chore(demo)` commit.**

**Evidence**: sample of `docs/data/aggregates/weekly_rollups/2025-W40.json` (Pass 3 inspection):

```text
pr_count: 106
prs.length: 106 (matches pr_count exactly — full list, not truncated)
_prs_cap: 500
_prs_truncated: false
PR record keys: active_thread_count, author_id, comment_count, cycle_time, id, repository_id, thread_count, title
```

All required fields present. The `pr-list` content state is exercisable on demo data with capability-on; truncation-cue branches remain testable via Jest fixtures (mirroring throughput / cycle-time / reviewer slices' existing test coverage of truncation).

**Rationale**: a feature whose demo coverage depended on regenerated artifacts would silently break when #315 is resolved (in either direction). LD-1's `supported-empty` trigger is purely state-driven (`rawPrs.length === 0 || !webContext || capValue === undefined`); demo data state is sufficient.

**Alternatives considered**:
- *Force-regenerate the demo to include a multi-week truncated rollup*: rejected — adds scope, requires `chore(demo)` commit per `feedback_separate_source_artifact_concerns`. Truncation testing happens in Jest fixtures, not in published demo data.
- *Block this feature until #315 resolves*: rejected — independent.

## R5 — Q-R3 panel section ordering: OMIT cross-week breakdowns reaffirmed

**Decision**: Panel structure is `[stats?, prList]` only. NO cross-week `byAuthor` / `byRepository` aggregates.

**Evidence**: `breakdownSection` helper at `extension/ui/modules/drilldown/throughput-drilldown.ts:93-110` is per-rollup — it reads `rollup.by_author` or `rollup.by_repository` and produces a `PanelSection` with rows sorted by `pr_count desc`. Producing a **cross-week** aggregate would require:

1. A new accumulator walk that merges per-rollup breakdown entries by key, with arithmetic on `pr_count` summation and identity-resolution conflicts (a single `author_id` may appear in multiple rollups with different display-name resolutions).
2. New tests for: cross-week merge correctness, ordering invariant, emptiness / single-key fallthroughs, identity-resolution under multi-rollup name shifts.
3. New (or updated) baseline fixture coverage to lock the rendered DOM bytes for the new sections.

All three Pass 2 cheap-reuse conditions fail. Adding cross-week breakdowns is not "cheap reuse"; it would be a new contract surface inside #363.

**Rationale**: the period-scoped PR list itself is the user value of this slice. The full charts already render period-scoped breakdowns in their own surfaces (throughput chart's per-author/per-repo legends, cycle-time chart's per-repo P50/P90 series). Adding cross-week breakdowns to the sparkline-driven panel would duplicate information the user can already see, at the cost of new accumulator walk + new tests + new fixtures.

**Alternatives considered**:
- *Add cross-week `byRepository` only* (skip `byAuthor`): rejected — same reasoning, smaller scope but still violates cheap-reuse conditions.
- *Add a "View all PRs" link that opens the full chart*: rejected per LD-1 Option C (defers user value).

## R6 — All other Verified Inputs at HEAD claims (Pass 3 re-verification, no drift)

The following Pass 2 / Pass 3 verifications stand at HEAD and require no further investigation in this plan:

| File | Claim | Verified |
|---|---|---|
| `extension/ui/modules/drilldown/sparkline-navigator.ts` | container-only signature; scroll-and-highlight via `is-sparkline-highlight` for 1500ms; target id map | ✓ Pass 3 |
| `extension/ui/modules/drilldown/throughput-drilldown.ts` | per-week PR list from `rollup.prs`; classifier branches; capability-on stat row | ✓ Pass 3 |
| `extension/ui/modules/drilldown/cycle-time-drilldown.ts` | panel title `Week of … — P50 / — P90` | ✓ Pass 3 |
| `extension/ui/modules/drilldown/reviewer-drilldown.ts:257-411` | cross-week union accumulator pattern; `capValue = max(per-week _prs_cap)`; truncation envelope `anyTruncated || collected.length < totalReviewedPrs` | ✓ Pass 3 |
| `extension/ui/modules/charts/summary-cards.ts:158-161, 449-472` | four sparkline triggers: `totalPrs`/`cycleP50`/`cycleP90`/`reviewers` → `throughput`/`cycle-time`/`cycle-time`/`reviewer` | ✓ Pass 3 |
| `extension/ui/dashboard.ts:1320-1345` | cycle-time options bag construction; sparkline-navigator install with container only | ✓ Pass 3 |
| `extension/ui/modules/shared/detail-panel.ts` | `PrListSection` discriminated union, `makePrListSection`, content states, `commentsMetricsAvailable` | ✓ Pass 3 |
| `extension/ui/modules/drilldown/filter-support.ts` | `classifyFilterState` with narrowed-return overload | ✓ Pass 3 |
| `extension/ui/modules/drilldown/comparison-advisory.ts` | `isDrilldownDisabledByComparison`; summary-cards in `setChartDisabled` set at L144 | ✓ Pass 3 |
| `.test-floor-contract.json` | extension `min_collected: 3158` | ✓ Pass 3 |

## Cross-cutting findings

- **No new dependencies.** Everything reused: `PrListSection`, `makePrListSection`, `PrListRow`, `isPartialPrRow`, `classifyFilterState`, `resolvePrUrl`, `comparison-advisory`, `formatWeekTitle`, `formatWeekRangeTitle` (newly used by `formatPeriodTitle`), `parseIsoLocalDate`, `isoWeekRange`, `dismissAllTooltips`, `openDetailPanel`, `dismissDetailPanel`. Verified via grep + direct read.
- **No producer-side test floor delta.** Python tests are not added because no Python code path is touched. `python.min_collected` stays at its current value.
- **No suppression delta.** `.suppression-baseline.json` stays at zero across `typescript-extension` and `typescript-tests`.
- **No tsconfig change.** New tests fall under the existing `tsconfig.test.json` compilation scope (`extension/tests/**/*.ts`); pre-commit `tsc --noEmit -p tsconfig.test.json` already triggers on changes there.
- **Spread-guard `ALLOWED_MODULES` extension required.** `sparkline-navigator.ts` will import from `shared/detail-panel` (to call `openDetailPanel` and `makePrListSection`); per QG-49 / LOCAL_CI_PARITY_INVARIANTS.md the spread-guard at `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` MUST list `sparkline-navigator.ts` in its `ALLOWED_MODULES` constant. Tasks will encode the update.

## Open items: none

No clarifications, no deferred decisions, no follow-ups for the planner. Phase 0 declared **COMPLETE**.
