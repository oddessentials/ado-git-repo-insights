# Implementation Plan: Summary-Card Sparkline PR-Level Detail (Issue #363)

**Branch**: `363-summary-card-pr-drilldown` | **Date**: 2026-05-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/363-summary-card-pr-drilldown/spec.md` (Pass 4 — planning-ready)

## Summary

Wire `PrListSection` into the existing summary-card sparkline navigator so activating one of the three eligible cards (`totalPrs`, `cycleP50`, `cycleP90`) opens the shared `DetailPanel` directly, with a single period-scoped PR list (the union of the active rollup window's `prs[]` arrays, sorted `cycle_time desc, id asc`, capped at `max(per-week _prs_cap)`). The fourth card (`reviewers`) preserves its existing scroll-and-highlight behavior. This is the final slice of #318; #365 (cycle-time PR drilldown) and #362/#366 (reviewer PR drilldown) shipped first and supply the contracts this slice reuses.

This is a **consumer-only** slice: no producer-side changes, no schema changes, no new `PrRecord` fields. Implementation reuses the regression-locked primitives (`PrListSection` discriminated union, `classifyFilterState`, `resolvePrUrl`, `comparison-advisory` toast, `is-drilldown-active` MutationObserver lifecycle, capability-off DOM byte-shape) and **duplicates locally** the cross-week union/cap/truncation accumulator pattern (Branch B per Q-R4 lock; reviewer-drilldown's existing walk at `reviewer-drilldown.ts:282-322` stays untouched).

Primary deliverables:

1. `installSparklineNavigator` signature gains `(container, rollups, options)` — a `SparklineDrilldownOptions` bag parallel to `ThroughputDrilldownOptions` / `CycleTimeDrilldownOptions` / `ReviewerDrilldownOptions`. Existing single-arg call site (Pass 3-verified at `dashboard.ts:1343`) is updated to pass the canonical bag.
2. `sparkline-navigator.ts::activate()` branches on `data-drilldown-target-chart`: `"throughput"` and `"cycle-time"` paths build a period-scoped `PrListSection` and call `openDetailPanel(...)`; `"reviewer"` and missing-target paths preserve today's scroll-and-highlight / inline-advisory behavior verbatim. Comparison-mode short-circuit and reduced-motion handling live ahead of the branch and apply to all four card paths.
3. `summary-cards.ts::wrapSparklineTrigger` adds the `data-drilldown-cycle-metric="p50"|"p90"` attribute to the two cycle-time triggers; throughput and reviewer triggers stay attribute-free. An inline comment cites #363 LD-2 explaining the reviewer-card asymmetry.
4. New helper `formatPeriodTitle(rollups: readonly Rollup[]): string` added to `extension/ui/modules/drilldown/week-range.ts` (Q-R2 lock — see "Q-R2 Decision" below). Single-rollup window delegates to existing `formatWeekTitle(rollup)`; multi-rollup window emits `Period of {earliest start} – {latest end}, {year}` using existing `formatWeekRangeTitle(start, end)` building block.
5. Period-scoped union/cap/truncation walk implemented as a private helper inside the sparkline-driven path (Branch B). Reviewer-drilldown's six paths (1 source + 4 tests + 1 fixture, FR-022 enumeration) regression-locked: implementation commit's `git diff` MUST show zero hunks under those paths.
6. New consumer-side Jest coverage: extended `sparkline-navigator.test.ts` (DetailPanel-open scenarios, classifier branches, capability gate, reviewer-card preservation, comparison toast, missing-target advisory, reduced-motion, keyboard); new `sparkline-pr-list-order.test.ts` (FR-010 rendered-DOM order); new `sparkline-pr-list-count-parity.test.ts` (FR-007/FR-009 cap and truncation envelope); new `sparkline-pr-list-capability-off-baseline.test.ts` (FR-013 byte-identical DOM golden) + a new `extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html` fixture.
7. `.test-floor-contract.json` `extension.min_collected` bumped by exactly the new test count in the same commit; Python floor unchanged.
8. **Spread-guard `ALLOWED_MODULES`** (`extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts`) extended to include `sparkline-navigator.ts` IFF the navigator imports from `shared/detail-panel` — which it will, to call `openDetailPanel` and `makePrListSection`.

## Q-R2 Decision (locked during this plan run)

**Decision**: Add a new helper `formatPeriodTitle(rollups: readonly Rollup[]): string` to `extension/ui/modules/drilldown/week-range.ts`. Do **not** overload `formatWeekTitle(rollup)` to accept an array; do **not** add a multi-week branch inside the existing single-rollup helper. Single-purpose helpers are easier to test and easier to reason about; overloading `formatWeekTitle` would couple two distinct title shapes inside one function and silently affect throughput / cycle-time / reviewer drilldowns that read it for the per-week panel.

**Helper signature and shape**:

```typescript
/**
 * Format a multi-rollup window as a "Period of {condensed range}" title.
 * Used by the summary-card sparkline drill-down to title the period-scoped
 * DetailPanel (#363).
 *
 * Single-rollup windows delegate to formatWeekTitle to preserve the
 * existing single-week wording ("Week of Mar 17 – 23, 2025"); a one-week
 * "Period of Mar 17 – Mar 17, 2025" would read awkwardly even though it
 * is technically correct.
 *
 * Empty input returns a stable fallback ("No period selected") so callers
 * never see undefined or an empty string. The classifier short-circuits
 * upstream on empty windows, so this branch is unreachable in production.
 */
export function formatPeriodTitle(rollups: readonly Rollup[]): string;
```

**Output strings** (locked here, encoded in `contracts/sparkline-pr-list.md` § 2):

| Window shape | Output |
|---|---|
| 0 rollups (unreachable) | `No period selected` |
| 1 rollup | `formatWeekTitle(rollups[0])` — e.g. `Week of Mar 17 – 23, 2025` |
| 2+ rollups (same year) | `Period of {earliest start_month} {earliest start_day} – {latest end_month} {latest end_day}, {year}` — e.g. `Period of Mar 17 – Apr 13, 2025` |
| 2+ rollups (cross-year) | `Period of {earliest start_month} {start_day}, {start_year} – {latest end_month} {end_day}, {end_year}` — e.g. `Period of Dec 30, 2024 – Jan 26, 2025` |

The earliest start and latest end dates are derived by walking each rollup's `start_date` / `end_date` (or falling back to `isoWeekRange(rollup.week)` when those fields are absent — same fallback `formatWeekTitle` already uses). Reuses existing `formatWeekRangeTitle(start, end)` building block — does not duplicate date-format logic.

**Per-card title concatenation** (call-site ownership):

Throughput card panel title: `formatPeriodTitle(rollups)` — no metric marker.

Cycle-time P50 card panel title: `formatPeriodTitle(rollups) + " — P50"` — em-dash separator.

Cycle-time P90 card panel title: `formatPeriodTitle(rollups) + " — P90"`.

The `— P50` / `— P90` concatenation lives at the call site inside `sparkline-navigator.ts`'s `buildPanelContent`, NOT inside `formatPeriodTitle`. This keeps `formatPeriodTitle` single-purpose and mirrors `cycle-time-drilldown.ts:165`'s pattern (`${formatWeekTitle(rollup)} — ${metric.toUpperCase()}`).

**Subtitle** (separate from title, mirroring throughput/cycle-time): `${totalPeriodPrCount} ${totalPeriodPrCount === 1 ? "PR" : "PRs"}`. `totalPeriodPrCount = sum(rollup.pr_count)` per LD-1 step 3.

**Reviewer card excluded** from panel title scope per LD-2 / FR-002 — the reviewer card never opens the panel, so no reviewer-card title shape needs to be defined.

**Why a helper, not inline at the call site**: three call sites would need the same period-range computation (one per eligible card) AND the helper's correctness depends on the same `parseIsoLocalDate` / `formatWeekRangeTitle` / `isoWeekRange` building blocks already factored in `week-range.ts`. Co-locating the period logic alongside the existing single-week logic gives a future maintainer one file to audit when title behavior changes; a future cross-year off-by-one fix would land in one place, not three.

**Why same year vs cross-year branching**: this is the same shape `formatWeekRangeTitle(start, end)` already enforces today (`week-range.ts:80-97`); we delegate to it rather than duplicating the year-handling logic.

**Alternatives considered and rejected**:

- **Overload `formatWeekTitle(rollup | readonly Rollup[])`**: rejected per user directive #1. Would couple two title shapes in one function; would force the existing per-week drilldowns to compile against a wider parameter type for no behavioral benefit; would invite drift across surfaces.
- **Inline period-title computation inside `sparkline-navigator.ts`**: rejected because the period-range computation has its own correctness invariants (impossible-date rejection, cross-year handling, condensed-month formatting) that already live inside `week-range.ts`. Inlining duplicates testable invariants three times.
- **Add the helper to `extension/ui/modules/shared/format.ts`**: rejected because `format.ts` is for primitive value formatters (durations, pluralization); rollup-shape-aware helpers belong in `drilldown/week-range.ts`, which already exposes `weekRangeForAria(rollup)` and `formatWeekTitle(rollup)`. Co-locating the multi-rollup variant alongside its single-rollup counterpart is the clean factoring.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (extension UI). Matches existing baseline. Python 3.12+ baseline applies repo-wide but is not exercised by this feature (no producer-side change).
**Primary Dependencies**: existing only — Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**
**Storage**: N/A. No database, schema, or rollup-shape changes.
**Testing**: Jest with jsdom for the new consumer-side coverage. Producer-side test floors (`python.min_collected`) untouched because no Python code path is modified.
**Target Platform**: Azure DevOps Marketplace extension running inside the ADO web iframe (Chromium-based) AND the published demo at `docs/data/`. Cross-platform CLI (Windows / macOS / Linux) inherited via the existing test pipeline; this feature adds no OS-specific code.
**Project Type**: existing dashboard extension; no new top-level modules.
**Performance Goals**: Panel opens with PR list rendered inside the open-animation (no distinct loading state, no extra round-trip), matching the existing per-chart drilldowns. Period union typically spans 8–52 weekly rollups, each capped at 500 PRs (producer cap from feature 060), so the unioned `collected[]` array is bounded at ≤26,000 records — well within the existing renderer's capacity. Real-seed peak measured under feature 060 was 464 PRs/week; demo peak is 151 PRs/week (verified via `docs/data/aggregates/weekly_rollups/2025-W40.json` Pass 3 sample).
**Constraints**: cross-OS compatibility (QG-39); no `typing.Any` (QG-40); zero new suppressions (QG-41); 4-entry-point parity (QG-47 / QG-49); ratchet bump same commit (QG-43); local/CI parity (QG-35 — QG-38); no bypass markers used.
**Scale/Scope**: ≤500 PR records per week × ≤52 weeks ≈ ≤26,000 PRs in the worst-case period union. Each per-rollup contribution is bounded by its own `_prs_cap` (producer cap from feature 060, ≤500); the period union is bounded by `sum(per-rollup _prs_cap)` across contributing rollups, NOT by `max`. The renderer emits the truncation cue when `renderedCount < actualFilteredCount` (LD-1 step 7) — independent of the `capValue` field's value. The `capValue` field reported to the renderer is `max(per-rollup _prs_cap)` per the inherited reviewer-drilldown contract; this is the field semantics, NOT the rendered-count bound. No new cap mechanism introduced.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

All 56 constitutional gates evaluated against this feature's scope. **No violations.**

### Gate disposition

| Gate | Relevance | Disposition |
|---|---|---|
| QG-01 — QG-08 (CSV / SQLite / persistence) | N/A | Feature does not touch CSV surface, SQLite, or pipeline persistence. |
| QG-09 — QG-12 (extraction) | N/A | No extraction changes. |
| QG-13 — QG-14 (identity) | YES (reuse only) | Uses existing `pull_request_id` + `repository_id` for URL composition via existing `resolvePrUrl`. No new keys. |
| QG-15 — QG-16 (runtime / secrets) | N/A | No agent-runtime or secret-handling changes. |
| QG-17 — QG-22 (release gates) | YES | All standard checks (ruff, mypy, pytest, Jest, coverage, build) must pass; no relaxation. |
| QG-23 — QG-24 (documentation) | N/A | No runbook, dataset-contract, or config-reference changes. |
| QG-25 — QG-29 (scalability) | YES (no-op) | Producer cap (`MAX_PRS_PER_WEEK = 500`) inherited from feature 060; period union is bounded by per-week cap × week count, with the existing truncation cue handling overflow. No new caps. |
| QG-30 — QG-34 (demo parity) | YES (verified Q-R5=R5-A) | Demo's weekly rollups carry `prs[]`, `_prs_cap`, `_prs_truncated` (sample 2025-W40.json: pr_count=106, prs.length=106, _prs_cap=500, _prs_truncated=false). The new sparkline-driven panel renders the PR list on demo without regen. No demo workflow changes. QG-32 (`docs/data/` clean promoted mirror) and QG-34 (startup-state parity) untouched. |
| QG-35 — QG-38 (local/CI parity) | YES | All new tests run via the existing `pnpm test` / `test:ci` chain; same gates fire on pre-commit, pre-push, and CI. `--no-verify` forbidden (QG-38). |
| QG-39 (cross-OS) | YES (no-op) | TypeScript-only consumer change; no `path.sep`, shell, or filesystem assumptions added. New `formatPeriodTitle` uses pure JavaScript Date math (LOCAL midnight, same as existing helpers) — no OS-conditional code paths. |
| QG-40 (no `typing.Any`) | YES | New `SparklineDrilldownOptions` interface uses precise types. `formatPeriodTitle` signature is fully typed (`readonly Rollup[]` → `string`). PR list type narrowing uses the existing `PrListSection` discriminated union. No `// @ts-ignore` or `Any` introduced. |
| QG-41 (zero suppressions) | YES | `.suppression-baseline.json` stays at 0 across all scopes (`typescript-extension`, `typescript-tests`). No `eslint-disable` / `ts-expect-error` introduced. |
| QG-42 (enterprise test coverage) | YES | New consumer-side Jest coverage for FR-001 through FR-023, including capability gate (FR-012/013/014), classifier branches (FR-011), period union sort (FR-010), truncation envelope (FR-007/008/009), reviewer-card preservation (FR-002 / SC-005), comparison toast (FR-004), reduced-motion (FR-017), keyboard activation, missing-target advisory (FR-003). Every new code path tested. |
| QG-43 — QG-46 (test discipline) | YES | `.test-floor-contract.json` `extension.min_collected` bumped by exactly the new test count in the same commit; no marker waiver attempted (none available for extension). No `pytest.mark.skip` introduced; no platform-conditional collection changes. Cross-OS Python collection parity untouched (Python floor unchanged at HEAD). |
| QG-47 — QG-49 (entry-point alignment) | YES | New tests live under `extension/tests/modules/drilldown/`, already a triggered scope for pre-commit `tsc` + ESLint + Jest. The shared primitives reused (`makePrListSection`, `classifyFilterState`, `resolvePrUrl`, `isPartialPrRow`, `formatWeekRangeTitle`, `formatWeekTitle`) each have exactly one authoritative definition consumed identically by throughput, cycle-time, reviewer, and now sparkline-navigator. The new `formatPeriodTitle` helper has one authoritative definition in `week-range.ts`; spread-guard ALLOWED_MODULES includes `sparkline-navigator.ts` (since the navigator now imports from `shared/detail-panel` to access `openDetailPanel` / `makePrListSection`). |
| QG-50 — QG-52 (change acknowledgement) | YES (N/A in practice) | No version bump, no threshold change, no ratchet realignment. Coverage stays within 2% of baseline (additive consumer code with full coverage). |
| QG-53 — QG-55 (build architecture) | YES | No tsconfig changes. New TypeScript code follows existing split-tsconfig conventions (ES2022 type-check, esbuild owns `dist/ui/`). Prettier invoked only via `format:check` (unchanged invocation). |
| QG-56 (security scan) | YES | Gitleaks parity unchanged; new code is pure UI wiring + tests, no secrets surface. |

**Gate evaluation: PASS.** No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/363-summary-card-pr-drilldown/
├── spec.md                         # Hardened spec (Pass 4 — planning-ready)
├── plan.md                         # This file (/speckit.plan output)
├── research.md                     # Phase 0 — verification log + Q-R2 pre-flight (this run)
├── data-model.md                   # Phase 1 — types reused + new SparklineDrilldownOptions interface + period title contract
├── contracts/
│   └── sparkline-pr-list.md        # Phase 1 — consumer contract for the period-scoped PR list section
├── quickstart.md                   # Phase 1 — verify-the-feature walkthrough
├── checklists/
│   └── requirements.md             # Spec quality checklist (Iterations 1-4 validation)
└── tasks.md                        # Phase 2 output (/speckit.tasks — NOT generated here)
```

### Source Code (repository root)

Feature is additive, consumer-only, and TypeScript-only.

```text
extension/ui/modules/drilldown/
├── sparkline-navigator.ts          # EXTEND: install signature gains (rollups, options) bag;
│                                   # activate() branches on data-drilldown-target-chart;
│                                   # period-scoped buildPanelContent (private) for throughput|cycle-time;
│                                   # private union/cap/truncation accumulator (Branch B duplication)
└── week-range.ts                   # EXTEND: add formatPeriodTitle(rollups) helper (Q-R2 lock)

extension/ui/modules/charts/
└── summary-cards.ts                # EXTEND: wrapSparklineTrigger emits data-drilldown-cycle-metric on cycle-time triggers;
                                    # inline comment on reviewer-card asymmetry (FR-020)

extension/ui/dashboard.ts            # EXTEND: existing installSparklineNavigator(...) call gains the same options bag
                                    # already constructed for installCycleTimeDrilldown / installReviewerDrilldown;
                                    # currentRollups is already in scope at the call site

extension/tests/modules/drilldown/
├── sparkline-navigator.test.ts             # EXTEND: DetailPanel-open scenarios for throughput / cycleP50 / cycleP90 cards;
│                                           # reviewer-card scroll-and-highlight preservation; classifier branches;
│                                           # capability gate; comparison toast; reduced-motion; keyboard activation;
│                                           # missing-target advisory; retarget-in-place; activeTrigger lifecycle
├── sparkline-pr-list-order.test.ts          # NEW: FR-010 rendered-DOM order = cycle_time desc, id asc
├── sparkline-pr-list-count-parity.test.ts   # NEW: FR-007 / FR-009 cap envelope; truncation cue gating
├── sparkline-pr-list-capability-off-baseline.test.ts  # NEW: FR-013 capability-off DOM byte-identity
└── pr-list-comments-spread-guard.test.ts    # EXTEND: ALLOWED_MODULES includes sparkline-navigator.ts

extension/tests/fixtures/
└── sparkline-drilldown-capability-off-baseline.html   # NEW: golden capability-off DOM fixture

.test-floor-contract.json            # BUMP: extension.min_collected += exact new test count (same commit)
```

**Files NOT touched** (per LD-3 / LD-4 / LD-5 / FR-002 / FR-022):

- `src/ado_git_repo_insights/transform/aggregators.py` — no producer change (LD-3)
- `src/ado_git_repo_insights/types.py` — no `PrRecord` change (LD-3)
- `extension/ui/schemas/rollup.schema.ts` — no schema change (LD-3)
- `extension/ui/dataset-loader.ts` — no Rollup interface change (LD-3)
- `extension/ui/modules/charts/throughput.ts` — chart already emits its own `data-drilldown-week` triggers (separate surface)
- `extension/ui/modules/charts/cycle-time.ts` — chart already emits its own `data-drilldown-week` + `data-drilldown-metric` triggers (separate surface)
- `extension/ui/modules/charts/reviewer-activity.ts` — chart already emits its own `data-drilldown-reviewer-id` triggers (separate surface)
- `extension/ui/modules/shared/detail-panel.ts` — no detail-panel API change; reuses existing `PrListSection` union, `makePrListSection`, `openDetailPanel`
- `extension/ui/modules/shared/pr-url.ts` — reused unchanged
- `extension/ui/modules/drilldown/filter-support.ts` — reused unchanged (uses existing narrowed-return overload)
- `extension/ui/modules/drilldown/comparison-advisory.ts` — reused unchanged
- `extension/ui/modules/drilldown/throughput-drilldown.ts` — no behavior change (separate surface, regression-locked by existing tests)
- `extension/ui/modules/drilldown/cycle-time-drilldown.ts` — no behavior change (separate surface; this slice does NOT modify the per-week panel)
- `extension/ui/modules/drilldown/reviewer-drilldown.ts` — **Branch B regression-lock** (FR-022): zero hunks under this path or its 4 test files / 1 fixture
- `extension/tests/modules/drilldown/reviewer-drilldown.test.ts` — Branch B regression-lock
- `extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts` — Branch B regression-lock
- `extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts` — Branch B regression-lock
- `extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts` — Branch B regression-lock
- `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html` — Branch B regression-lock
- `scripts/strip_pr_arrays.py` — no demo strip change (Q-R5=R5-A; demo unaffected)
- `scripts/build-demo-dataset.py` — no demo workflow change (Q-R5=R5-A; LD-5)
- `scripts/generate-demo-data.py` — no demo workflow change (LD-5)
- Any `.github/workflows/*` — no CI gate changes
- `.specify/memory/constitution.md`, `agents/INVARIANTS.md`, `LOCAL_CI_PARITY_INVARIANTS.md` — no governance changes
- `extension/ui/modules/shared/format.ts` — `formatPeriodTitle` belongs in `week-range.ts` (Q-R2 alternatives rejected)
- `metrics.ts:921` — pre-existing `applyFiltersToRollups` namespace mismatch is OUT-OF-SCOPE for #363 (recorded in spec Non-goals; do not let scope expand)

**Structure Decision**: additive consumer-only changes. No directory restructuring. The new test files mirror the existing `pr-list-*.test.ts` and `cycle-time-pr-list-*.test.ts` / `reviewer-pr-list-*.test.ts` naming convention (`sparkline-pr-list-*.test.ts`) so a future maintainer searching for "PR list tests" sees all four surfaces side by side. No new shared modules introduced — every primitive needed already exists under `extension/ui/modules/shared/` or `extension/ui/modules/drilldown/`, except the single new `formatPeriodTitle` helper which is co-located in the existing `week-range.ts` next to `formatWeekTitle`.

## Test-floor Δ protocol (mechanized per QG-43 / FR-022 / FR-023)

Every commit that adds N tests MUST bump the `.test-floor-contract.json` `extension.min_collected` floor by exactly N in the same commit. Drift is detected per-commit by `scripts/check_ratchet_bump.py` and CI's `ratchet-bump-guard` job.

### Per-commit protocol

1. **Author new tests** under `extension/tests/modules/drilldown/`.
2. **Run the extension test suite** to produce JUnit output:
   - `cd extension && pnpm test:coverage` — produces `extension/test-results.xml`
3. **Calculate Δ mechanically** (not by manual count):
   - `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`
   - Output line `actual=N` for the Extension dimension is the authoritative count.
4. **Update `.test-floor-contract.json`** by setting `extension.min_collected` to `N`.
5. **Stage all together**: new test files + extended source files + `.test-floor-contract.json` in ONE commit.
6. **Verify before push**: `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` returns exit 0.

### Anti-patterns (will fail CI)

- Test additions split across two commits where the first commit doesn't bump the floor (per-commit gate flags it as drift).
- Floor bumped by fewer or more than the actual delta.
- Attempting `[ratchet-realignment]` for the extension floor (no marker waiver is honored for extension drift; documented in `docs/development/ratchets.md`).

### Expected delta for this feature

Approximately **+25 to +35** new Jest tests (preliminary projection, NOT a contract — final number is whatever `check_ratchet_bump.py` reports), distributed:

- `sparkline-navigator.test.ts` extension: +15 to +20 (DetailPanel open for 3 cards, classifier team/reviewer/supported branches × 3 cards, capability on/off shape × 3 cards, comparison toast × 4 cards, reduced-motion × 4 cards, keyboard activation × 3 cards, missing-target advisory × 4 cards, retarget-in-place between cards, activeTrigger lifecycle, dispose cleans up timers)
- `sparkline-pr-list-order.test.ts`: +1 to +3 (FR-010 rendered-DOM order, multi-week union sort)
- `sparkline-pr-list-count-parity.test.ts`: +2 to +4 (FR-007 cap envelope, FR-008 truncation cue, FR-009 actualFilteredCount)
- `sparkline-pr-list-capability-off-baseline.test.ts`: +1 to +2 (FR-013 byte-identical DOM golden)
- `pr-list-comments-spread-guard.test.ts` extension (likely +1 to verify sparkline-navigator's import is registered) — may be 0 if the spread-guard updates without new test additions, just an `ALLOWED_MODULES` entry update.
- +1 to +3 for `formatPeriodTitle` helper unit tests under a NEW `extension/tests/modules/drilldown/week-range.test.ts` file. Placement locked to this new file per tasks.md T008 (Pass 2 lock); the file does not exist at HEAD and is created by T008. No inline-in-sparkline-navigator alternative.

The final count is whatever the ratchet-bump command reports; the estimates above exist for planning only and MUST NOT be hardcoded.

## Phase 0: Research

See [`research.md`](./research.md). Summary:

Pass 3 code-validation already verified the 10 "Verified Inputs at HEAD" claims and resolved Q-R1 / Q-R4 / Q-R5 from source / artifact inspection. Pass 4 confirmed Q-R2 was the sole plan-time decision; this plan run resolves it.

- **R1** — Dashboard rollup pre-filtering (Q-R1 lock): confirmed at `dashboard.ts:1045` calls `applyFiltersToRollups(rawRollups, currentFilters)` BEFORE drilldown installs at L1320-1345. `metrics.ts:441-933` covers all four filter axes including PR-level filtering at L906-924. **No supplementary client-side overlay needed at the sparkline-navigator layer.**
- **R2** — Q-R2 panel-title formatter pre-flight (this run): read `extension/ui/modules/drilldown/week-range.ts` end-to-end (137 lines). Existing helpers: `parseIsoLocalDate`, `isoWeekRange`, `formatWeekRangeTitle(start, end)`, `formatWeekTitle(rollup)`, `weekRangeForAria(rollup)`. **No multi-rollup helper exists at HEAD.** Decision (per user directives): add `formatPeriodTitle(rollups: readonly Rollup[]): string` co-located in `week-range.ts`. Output strings enumerated in plan.md "Q-R2 Decision" section above and in `data-model.md` § "Period title contract" + `contracts/sparkline-pr-list.md` § 2.
- **R3** — Reviewer-drilldown union pattern (reuse-only check, Q-R4 lock): confirmed Branch B (local duplication). The reviewer walk at `reviewer-drilldown.ts:282-322` reads from per-(reviewer, week) entries; the new sparkline walk reads rollup-level fields directly. A unifying helper would require a callback-based loop body restructure in reviewer-drilldown, exceeding the single-mechanical-call-site-swap criterion.
- **R4** — Demo data exercises the path (Q-R5 lock): `docs/data/aggregates/weekly_rollups/2025-W40.json` carries pr_count=106, prs.length=106, _prs_cap=500, _prs_truncated=false, with PR records carrying every field the period-scoped panel reads. **No demo regen needed.**
- **R5** — Q-R3 panel section ordering reaffirmation: source inspection confirms `breakdownSection` in `throughput-drilldown.ts:93-110` is per-rollup; producing a cross-week aggregate would require a new accumulator walk + new tests. All three Pass 2 cheap-reuse conditions fail. **Panel structure locked to `[stats?, prList]` only.**

No `[NEEDS CLARIFICATION]` markers remain in the spec or this plan. Phase 0 declared **COMPLETE**.

## Phase 1: Design & Contracts

See Phase 1 deliverables:

- [`data-model.md`](./data-model.md) — types reused + the new `SparklineDrilldownOptions` interface + Period Title Contract (Q-R2 enumerated strings) + Period-scoped Union Envelope shape + State machine for the four content states.
- [`contracts/sparkline-pr-list.md`](./contracts/sparkline-pr-list.md) — multi-section consumer contract covering install signature (§ 1), Period title formatter (§ 2 — Q-R2 strings), Period-scoped PR list shape (§ 3 — LD-1 envelope), Capability-state propagation (§ 4), Active-trigger lifecycle (§ 5), Reduced-motion + comparison (§ 6), Reviewer-card asymmetry preservation (§ 7), Branch B helper-extraction posture (§ 8 — citing FR-022 regression-lock), DOM contract (§ 9), Capability-off DOM byte-shape (§ 10), Test fixture requirements (§ 11), Spread-guard ALLOWED_MODULES extension (§ 12), Edge cases (§ 13), Out-of-scope (§ 14).
- [`quickstart.md`](./quickstart.md) — verify-the-feature walkthrough mapped to spec acceptance scenarios and SC-001 through SC-008.

### Re-evaluation of Constitution Check (post-design)

No new violations introduced during Phase 1 design. All new artifacts align with existing conventions:

- Contracts live under `contracts/` (inherited from features 059 / 060 / 361 / 362)
- Data model documented in `data-model.md` (standard speckit artifact)
- Quickstart verifies end-user-visible behavior (every spec SC mapped to concrete steps)
- The feature consumes only previously-locked contracts; no new cross-surface schema obligations created
- Q-R2 lock adds one new helper (`formatPeriodTitle`) co-located in an existing file — no new cross-cutting abstractions

Post-design gate evaluation: **PASS**.

## Considered and rejected: Branch A (shared helper extraction)

Per LD-4 / FR-021 / FR-022 / FR-023 + Pass 3 Q-R4 pre-flight, Branch A (extracting the cross-week union/cap/truncation walk into a shared helper consumed by both this slice and `reviewer-drilldown.ts:282-322`) was **considered and rejected**.

**Pre-flight evidence**:

Reviewer-drilldown's walk at `reviewer-drilldown.ts:282-322` reads from per-(reviewer, week) entries (`entry = reviewerEntry(rollup, reviewerId)`, then trio extraction from `entry.{prs, _prs_truncated, _prs_cap, reviewed_prs}`). The new sparkline-driven walk reads from rollup-level fields directly (`rollup.{prs, _prs_cap, _prs_truncated, pr_count}`). A unifying helper would require a callback-based loop body restructure in reviewer-drilldown — replacing ~20 lines of inline loop with a callback definition + result destructuring.

This restructure exceeds the abort criterion "Reviewer-drilldown's source file requires NO modification beyond a single mechanical change at the helper's call site." Branch A is therefore disqualified at Q-R4 pre-flight, before any code is written.

**Branch A rejected because**:
1. The two walks read structurally different shapes (per-(reviewer, week) entry vs rollup-level fields). Unifying them requires a callback-based abstraction that adds indirection without saving meaningful code (~20 lines duplicated vs ~15 lines callback definition + result destructuring).
2. Reviewer-drilldown has 1 source file + 4 test files + 1 DOM-golden fixture in scope. Even with zero functional changes, callback-based restructure invites diff churn and forces re-verification of all five test files.
3. The duplication cost is acceptable: ~25 lines of accumulator walk in `sparkline-navigator.ts`, with the same shape as reviewer-drilldown's walk. Documented and accepted; future cross-surface refactor would need its own slice.
4. Implementation MUST NOT include any task that imports from a hypothetical shared module; Plan / contracts / tasks encode Branch B as the chosen path (FR-023).

This rejection is preserved in `data-model.md` § "Helper extraction posture" and `contracts/sparkline-pr-list.md` § 8 so future readers see why duplication was chosen instead of extraction.

## Phase 2: Not generated by /speckit.plan

`tasks.md` is produced by `/speckit.tasks` after this plan. Per memory `feedback_speckit_cadence_applies_to_tasks`, `/speckit.tasks` will itself undergo a 4-pass hardening before being handed off to `/speckit.analyze` and then to implementation. Per memory `feedback_speckit_commit_plan_default`, the implementation will land in **1 planning + 1 implementation commit** (Q-R5=R5-A locks no `chore(demo)`).

## Complexity Tracking

*This section filled only if Constitution Check has violations that must be justified.*

No violations. No entries.
