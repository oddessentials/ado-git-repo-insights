---
description: "Tasks for 363 — Summary-Card Sparkline PR-Level Detail (Pass 2 hardened)"
---

# Tasks: Summary-Card Sparkline PR-Level Detail

**Input**: Design documents from `specs/363-summary-card-pr-drilldown/`
**Prerequisites**: `spec.md` (Pass 4 — planning-ready; 23 FRs, 8 SCs, 4 user stories) + `plan.md` + `research.md` + `data-model.md` + `contracts/sparkline-pr-list.md` + `quickstart.md`. Every task below traces to one or more FR / SC / Q-R / LD / G identifiers.

**Tests**: enterprise-coverage mandatory (QG-42); FR-010 / FR-013 / FR-015 / FR-016 / FR-022 / SC-005 / SC-007 each carry an explicit consumer-test or verification obligation; G6 mandates the floor-bump contract (one commit). Tests are authored alongside implementation — required by spec, not dictated by TDD ordering.

**Organization**: tasks grouped into the six phases the user explicitly directed (Phase 0 → Phase 5). Within phases, tasks carry `[US#]` labels mapping to the four user stories from `spec.md` (US1 throughput card, US2 cycle-time cards, US3 reviewers card preserved, US4 capability gate). Phase 5 lands the ratchet bump + reviewer-drilldown regression-lock verification + final preflight — all source + tests + fixture + floor bump MUST stage in the SAME commit per per-commit ratchet (G6, no marker waiver for extension drift).

## Format: `- [ ] TXXX [P?] [US#?] Description with file path (refs)`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks in the same phase)
- **[US#]**: user-story label (US1 throughput card / US2 cycle-time cards / US3 reviewers preserved / US4 capability gate). Used within Phase 4 (test suite); omitted for Phase 0/1/2/3/5 tasks that are not story-scoped.
- Refs: FR / SC / Q-R / LD / G identifiers in parentheses at the end of each description.

## Path Conventions

- Extension UI source: `extension/ui/`
- Extension tests: `extension/tests/`
- Test-floor contract: `.test-floor-contract.json` (repo root)
- Spec & contract docs: `specs/363-summary-card-pr-drilldown/`

All paths are repository-relative.

## Cross-OS discipline (QG-39)

This feature is TypeScript-only and consumer-only. No shell idioms, no path-style assumptions, no `path.sep` dependence are introduced. Tests use `jsdom` (cross-platform). Tasks invoking scripts (preflight, ratchet-bump, schema-parity) use the project's standard cross-platform commands.

**Note on source-file line numbers**: line-number anchors cited in task descriptions are planning-time references taken at the start of this branch. They MAY shift as earlier tasks land. Task validity depends on filename plus surrounding function / symbol name; verify positions at implementation time against the current file state.

## Branch B / FR-022 regression-lock paths (DO NOT TOUCH)

Per LD-4 / Q-R4 / FR-022, none of the following six paths may be modified by ANY task in this file:

- `extension/ui/modules/drilldown/reviewer-drilldown.ts`
- `extension/tests/modules/drilldown/reviewer-drilldown.test.ts`
- `extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts`
- `extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts`
- `extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts`
- `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html`

T046 (Phase 5) verifies this by mechanical `git diff --stat`. Branch A (shared helper extraction) is "considered and rejected" historically; no task implements it.

---

## Phase 0: Pre-flight verification (no commits)

**Purpose**: Re-confirm Pass 3 evidence at HEAD before any edits. Establishes the baseline for SC-007 and the Phase 5 floor-bump comparison.

- [ ] T001 Verify clean local preflight baseline on branch tip: `python scripts/run_pr_preflight.py` returns exit 0 with no `--allow-local-degraded` flag, on a clean working tree (`git status --short` empty before running). Record the start-of-branch state for SC-007 final comparison. No commits in this phase. (SC-007, QG-29, QG-35, QG-36)
- [ ] T002 Record the current `extension.min_collected` value from `.test-floor-contract.json` (HEAD value: `3158`) and the matching `actual=N` reported by `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` (run after `cd extension && pnpm test:coverage` to produce the JUnit artifact). Confirm they match (parity invariant). The starting value is the baseline against which T045 computes the delta. No commits in this phase. (G6, QG-43, QG-44)
- [ ] T003 [P] Re-verify the four sparkline trigger emissions at `extension/ui/modules/charts/summary-cards.ts:158-161` against HEAD: `wrapSparklineTrigger(containers.totalPrsSparkline, "throughput")`, `(containers.cycleP50Sparkline, "cycle-time")`, `(containers.cycleP90Sparkline, "cycle-time")`, `(containers.reviewersSparkline, "reviewer")`. Verify `wrapSparklineTrigger` at L458-472 currently sets only `data-drilldown-target-chart` and `aria-label` — NO `data-drilldown-cycle-metric` attribute exists yet. Record the current bytes; T017 will modify them. No edits. (FR-005, contract § 9, G3)
- [ ] T004 [P] Verify Q-R2 pre-flight: read `extension/ui/modules/drilldown/week-range.ts` end-to-end (137 lines at HEAD); confirm existing exports are `parseIsoLocalDate`, `isoWeekRange`, `formatWeekRangeTitle`, `formatWeekTitle`, `weekRangeForAria`. Confirm NO multi-rollup `formatPeriodTitle` helper exists. T007 will add one. No edits. (Q-R2, contract § 2, G2)
- [ ] T005 [P] Verify Q-R1=R1-A pre-flight: read `extension/ui/dashboard.ts:1045` and confirm the call `applyFiltersToRollups(rawRollups, currentFilters)` runs BEFORE the drilldown installs at L1320-1345. Read `extension/ui/modules/metrics.ts:441-933` and confirm the function handles all four filter axes (repos, teams, reviewers, authors) including PR-level filtering at L906-924. This proves rollups arriving at the sparkline-navigator layer are already filter-applied. The new buildPeriodScopedEnvelope (T012) walks `rollup.prs ?? []` directly without a supplementary overlay. No edits. (Q-R1, FR-006, contract § 3, plan.md "Q-R2 Decision" / "R1")
- [ ] T006 [P] Verify the six FR-022 reviewer-drilldown regression-lock paths exist at HEAD and record their `git rev-parse HEAD:<path>` blob hashes (or `git ls-tree HEAD -- <paths>` output). T046 (Phase 5) compares against this baseline to assert zero hunks. No edits. (FR-022, G1, G5)

**Checkpoint**: Pass 3 evidence reconfirmed; baseline recorded; no source edits yet. Phase 1 may proceed.

---

## Phase 1: Helper additions (Q-R2 lock)

**Purpose**: Add the new `formatPeriodTitle` helper to `week-range.ts` ahead of the core implementation. Helper is independent of `sparkline-navigator.ts` so this phase runs before Phase 2.

- [ ] T007 Add `formatPeriodTitle(rollups: readonly Rollup[]): string` to `extension/ui/modules/drilldown/week-range.ts` after the existing `weekRangeForAria` function. Implementation MUST: (a) return `"No period selected"` for empty input; (b) delegate to `formatWeekTitle(rollups[0])` when `rollups.length === 1`; (c) for 2+ rollups, walk each rollup to derive `(start, end)` via `parseIsoLocalDate(rollup.start_date)` + `parseIsoLocalDate(rollup.end_date)` (with `isoWeekRange(rollup.week)` as the fallback when either date is missing or invalid), aggregate `earliestStart = min(allStarts)` and `latestEnd = max(allEnds)`, and return `"Period of " + formatWeekRangeTitle(earliestStart, latestEnd)`. The helper MUST NOT duplicate any date-format logic — it composes existing helpers (`parseIsoLocalDate`, `isoWeekRange`, `formatWeekRangeTitle`, `formatWeekTitle`). When no rollup contributes a valid date pair after the walk, return the empty-input fallback (`"No period selected"`). Strict typing — no `Any`. Add a JSDoc comment citing #363 / Q-R2 lock and pointing to `data-model.md` § 4 + `contracts/sparkline-pr-list.md` § 2 for the output-string enumeration. (Q-R2, FR-005 plumbing, contract § 2, data-model § 4, G2, plan.md "Q-R2 Decision")
- [ ] T008 [P] Add unit-test coverage for `formatPeriodTitle` covering all four output-string branches. **Placement decision (locked)**: place these tests in a NEW file `extension/tests/modules/drilldown/week-range.test.ts` rather than inline in `sparkline-navigator.test.ts`, because (a) `week-range.ts` is a shared utility consumed by throughput / cycle-time / reviewer / sparkline drilldowns — keeping its tests file-co-located makes future helper additions discoverable; (b) the existing repo has no `week-range.test.ts` so this is additive without disrupting any existing test file. Tests required: (1) `"empty rollups returns 'No period selected'"`; (2) `"single rollup delegates to formatWeekTitle"` (assert exact byte-equivalence to `formatWeekTitle(r)` for a sample rollup); (3) `"multi-rollup same year emits 'Period of Mar 17 – Apr 13, 2025'"` (use start_date/end_date pairs that span Mar 17 → Apr 13 within 2025); (4) `"multi-rollup cross-year emits 'Period of Dec 30, 2024 – Jan 26, 2025'"` (use start/end dates that cross the year boundary). Each test seeds a `Rollup[]` fixture and asserts the exact string. (Q-R2, contract § 2, data-model § 4, G2)

**Checkpoint**: `formatPeriodTitle` exported from `week-range.ts` with full unit coverage. Phase 2 may proceed; the helper is callable.

---

## Phase 2: Core implementation

**Purpose**: Wire the period-scoped panel content through `sparkline-navigator.ts` + add the cycle-metric attribute on summary-cards.ts. Multi-file phase; tasks within a single file are sequential, cross-file tasks may parallelize where indicated.

- [ ] T009 Extend the `DrillDownContext` interface in `extension/ui/modules/shared/detail-panel.ts:185` to add a fourth `sourceChart` literal value `"summary-card"` and a fourth `focusedData` arm: `{ kind: "summary-card"; targetCard: "totalPrs" | "cycleP50" | "cycleP90" }`. This is a discriminated-union extension — existing consumers of `DrillDownContext` continue to work because no existing arm is removed; the renderer's exhaustiveness check is preserved by adding the new arm and (if any switch statement on `focusedData.kind` exists in the renderer) extending it to handle `"summary-card"`. Add an inline JSDoc comment on the new `sourceChart` value pointing to `data-model.md` § 5 for rationale (panel API needs to disambiguate sparkline-driven retargets from chart-bar-driven retargets — both share `"throughput"` / `"cycle-time"` chart types but have different content shapes). Strict typing — no `Any`. (LD-3 boundary: this is a structural extension to a shared type, NOT a new type; FR-016 retarget-in-place uses this discriminator)
- [ ] T010 Add `SparklineDrilldownOptions` interface to `extension/ui/modules/drilldown/sparkline-navigator.ts` immediately above the existing `installSparklineNavigator` declaration. Five readonly optional fields, mirroring `ThroughputDrilldownOptions` (`throughput-drilldown.ts:70-85`), `CycleTimeDrilldownOptions` (`cycle-time-drilldown.ts:194-203`), `ReviewerDrilldownOptions` (`reviewer-drilldown.ts:458-468`): `filters?: FilterState`, `repositoriesDimension?: readonly PrUrlRepositoryEntry[] | null | undefined`, `webContext?: PrUrlWebContext`, `authorsDimension?: readonly AuthorEntry[] | null | undefined`, `commentsMetricsAvailable?: boolean`. Strict typing — no `Any`. JSDoc points to `data-model.md` § 3 for field semantics. Add the four type imports (`FilterState`, `PrUrlRepositoryEntry`, `PrUrlWebContext`, `AuthorEntry`) from `../filters`, `../shared/pr-url`, `../../schemas/dimensions.schema`. (FR-001 plumbing, contract § 1, data-model § 3, QG-40)
- [ ] T011 Update the `installSparklineNavigator` signature in `extension/ui/modules/drilldown/sparkline-navigator.ts:60` to: `installSparklineNavigator(container: HTMLElement, rollups: readonly Rollup[], options: SparklineDrilldownOptions = {}): { dispose(): void }`. **`rollups` is REQUIRED, not optional** (contract § 1 lock); only `options` defaults to `{}`. Capture `rollups` and `options` inside the closure. Add the `Rollup` type import from `../../dataset-loader`. Existing tests in `extension/tests/modules/drilldown/sparkline-navigator.test.ts` MUST be updated in this same task to pass `rollups: []` as the second argument at every call site (~18 invocations at L122, L151, L166, L180, L200, L230, L243, L254, L277, L296, L316, L332, L343, L372, L382, L398, L414, L427 — verify exact count at implementation time). The `[]` stub keeps T011 pure-mechanical: the rollups parameter is captured but not yet read by any code path (the existing activate() function is unchanged at this point — it still has its pre-T014 single-branch behavior of scroll-and-highlight for ALL three target charts). **Test status after T011 alone**: all 18 existing tests still pass (no behavior has changed). The T014 branching change is what triggers the test-suite impact; see T014's "Test impact of this branching change" sub-clause for the obsolescence rules that govern throughput / cycle-time existing tests. (FR-001, contract § 1)
- [ ] T012 Add the private helper `buildPeriodScopedEnvelope(rollups: readonly Rollup[]): EnvelopeResult` to `extension/ui/modules/drilldown/sparkline-navigator.ts` (Branch B — local duplication; NO shared module). The helper implements LD-1 steps 1-3 + the partial-trio supported-empty fall-through: walk every rollup, validate the trio (`prs` is array, `_prs_truncated` is boolean, `_prs_cap` is number), accumulate `collected: PrRecord[]`, `capValue = max(per-rollup _prs_cap)`, `totalPeriodPrCount = sum(rollup.pr_count)`, `anyTruncated = any(rollup._prs_truncated === true)`. Return `"supported-empty"` early if any participating rollup is missing the trio OR if `collected.length === 0` OR if `capValue === undefined`. Otherwise return the envelope object. Type signature locked in `data-model.md` § 6. Add `PrRecord` type import from `../schemas/rollup.schema` (or wherever the existing types/discriminator-union path lives — verify at implementation time). Strict typing. **The walk is structurally similar to reviewer-drilldown.ts:282-322 but reads rollup-level fields directly, not per-(reviewer, week) entries.** Branch A (shared helper extraction) was rejected at Q-R4 pre-flight; this is the locally-duplicated walk. (LD-1 steps 1-3, FR-006 / FR-007, contract § 3, data-model § 6, LD-4 / Q-R4 = Branch B, G1)
- [ ] T013 Add the private helper `buildPanelContent(targetChart, trigger, rollups, options): PanelContent` to `extension/ui/modules/drilldown/sparkline-navigator.ts`. The helper: (1) calls `buildPeriodScopedEnvelope(rollups)` from T012; (2) calls `classifyFilterState(filters, false)` per FR-011 (team → `team-inline`, reviewer → `reviewer-inline`, supported → continue); (3) on supported branch: re-sort the envelope's `collected` array by `cycle_time desc, id asc` (LD-1 step 6, mirrors `reviewer-drilldown.ts:352-355`); (4) maps each `PrRecord` to a `PrListRow` using the capability-aware shape from `throughput-drilldown.ts:155-173` byte-for-byte (capability-off omits comments triplet; capability-on includes `threadCount` / `commentCount` / `activeThreadCount`); (5) computes truncation envelope per LD-1 steps 7-8: `truncationDetected = anyTruncated || collected.length < totalPeriodPrCount`; `actualFilteredCount = truncationDetected ? totalPeriodPrCount : rows.length`; (6) constructs the section via `makePrListSection({ contentState: "pr-list", rows, renderedCount, actualFilteredCount, capValue, commentsMetricsAvailable })`; (7) builds the panel title per Q-R2: throughput → `formatPeriodTitle(rollups)`; cycle-time + `data-drilldown-cycle-metric === "p50"` → `` `${formatPeriodTitle(rollups)} — P50` ``; cycle-time + `"p90"` → `` `${formatPeriodTitle(rollups)} — P90` ``; (8) builds subtitle per data-model.md § 4: `${totalPeriodPrCount} ${totalPeriodPrCount === 1 ? "PR" : "PRs"}`; (9) returns `makePanelContent(title, subtitle, sections)` where sections is `[stats?, prList]` only — NO `byAuthor` / `byRepository` per Q-R3 = OMIT.

  **Comments stat row (FR-012) — locked to local duplication of `throughput-drilldown.ts:260-311 buildCommentsStatRow`**: when `commentsMetricsAvailable === true` AND the resolved content state is `pr-list`, prepend a comments stat row built by a private helper `buildCommentsStatRowLocal(rows: readonly PrListRow[]): PanelSection` co-located in `sparkline-navigator.ts`. The helper iterates `rows`, sums `row.threadCount ?? 0` / `row.commentCount ?? 0` / `row.activeThreadCount ?? 0`, counts partial rows via the shared `isPartialPrRow` helper, applies the same Pending / numeric / `(+N partial)` rendering rules as throughput-drilldown's helper, and returns a `StatRowSection` via `makeStatRow([...])`. **Reads `PrListRow.threadCount` / `commentCount` / `activeThreadCount` field names directly** — this is the trigger that requires `sparkline-navigator.ts` to be added to the spread-guard `ALLOWED_MODULES` constant in T043 (FR-022 invariant: only allowlisted modules may spread these field names).

  **Why local duplication, not shared import**: `buildCommentsStatRow` in throughput-drilldown.ts is module-private (not exported). Promoting it to a shared module would touch throughput-drilldown's source file and fall outside this slice's scope (Branch B principle: minimize cross-surface ownership churn). Importing it would require adding an `export` to throughput-drilldown.ts, which crosses into a sensitive shipped surface. Local duplication is the surgical Branch B-aligned choice — duplicates ~50 lines, accepts the duplication cost, leaves throughput-drilldown.ts byte-untouched.

  Add the imports: `formatPeriodTitle` from `./week-range`, `classifyFilterState` from `./filter-support`, `makePrListSection` / `makePanelContent` / `makeStatRow` / `openDetailPanel` / `PanelContent` / `PanelSection` / `PrListRow` / `isPartialPrRow` from `../shared/detail-panel`, `resolvePrUrl` from `../shared/pr-url`, `createEmptyFilterState` from `../filters`. **FR-018 (DetailPanel-open MUST NOT introduce new animation logic)**: this helper builds panel content via existing factory functions (`makePrListSection`, `makePanelContent`, `makeStatRow`) which the panel API already renders with reduced-motion-aware CSS transitions; T013 introduces NO new animation, transition, or `setTimeout`-driven visual logic. (LD-1 steps 4-8, FR-006 / FR-010 / FR-011 / FR-012 / FR-014 / FR-018, Q-R2, Q-R3, contract §§ 2-4 / 6, data-model §§ 4 / 6 / 7, G1, G2)
- [ ] T014 Update `activate(trigger)` in `extension/ui/modules/drilldown/sparkline-navigator.ts:97-141` to branch on `data-drilldown-target-chart`. Order of operations (FR-001 / FR-002 / FR-003 / FR-004): (1) `dismissAllTooltips()` (existing); (2) comparison-mode short-circuit via `isDrilldownDisabledByComparison()` (existing); (3) read `chart` attribute and validate it's `"throughput" | "cycle-time" | "reviewer"` (existing); (4) parent-null guard (existing); (5) target-element resolution + missing-target advisory (existing — `showAdvisoryIn` for missing target); (6) **NEW BRANCH**: if `chart === "throughput"` OR `chart === "cycle-time"`, build period-scoped panel content via `buildPanelContent(chart, trigger, rollups, options)`, construct the `DrillDownContext` (with `sourceChart: "summary-card"` per T009 and `focusedData: { kind: "summary-card", targetCard }`), call `openDetailPanel(context)`, register the panel observer (T015 below), set the active class + aria-expanded on the trigger; (7) **PRESERVED BRANCH**: if `chart === "reviewer"` (the else case), execute the EXISTING scroll-and-highlight code at L126-141 byte-equivalent — `prefersReducedMotion()` resolution, `targetEl.scrollIntoView({ behavior, block: "center" })`, `is-sparkline-highlight` class management, `setTimeout` cleanup. The reviewer-card path MUST NOT change in any observable way (FR-002 / SC-005 regression-lock). Add `isDrilldownDisabledByComparison`, `showComparisonAdvisoryToast` imports (already present); `openDetailPanel`, `DrillDownContext` imports; `dismissAllTooltips` already imported.

  **Test impact of this branching change (obsolescence rules)**: after T014 lands, the existing throughput-card and cycle-time-card scroll-and-highlight tests in `sparkline-navigator.test.ts` (those at L122-432 that assert scroll+highlight for `data-drilldown-target-chart="throughput"` or `"cycle-time"`) are OBSOLETE — their assertions test behavior that no longer exists per FR-001 / G3 (those targets now open the DetailPanel, not scroll). **Remove or replace those obsolete tests in this same task** so the test suite stays internally consistent. The new behavior coverage for throughput / cycle-time is added in Phase 4 (T021-T032 + T037-T040). The reviewer-card scroll-and-highlight tests in the same file are PRESERVED unchanged because the reviewer-branch code is byte-equivalent. After T014 + the obsolete-test removal/replacement, the test suite shape is: reviewer-card preservation tests still green (existing); throughput/cycle-time existing scroll+highlight tests gone (or rewritten as supported-empty trivial guards if useful); Phase 4 tests not yet present. T020's "no regression" claim is scoped accordingly — see T020 for the exact scope. (FR-001 / FR-002 / FR-003 / FR-004 / G3, contract §§ 1 / 7)
- [ ] T015 Add `registerPanelObserver` and `clearActive` private functions to `extension/ui/modules/drilldown/sparkline-navigator.ts`, structurally mirroring `throughput-drilldown.ts:340-365` and `cycle-time-drilldown.ts:221-244`. The MutationObserver watches `aside.detail-panel` for `class` attribute changes; when `is-open` is removed, fire `clearActive()` once, disconnect, and remove from the observer set. `clearActive()` removes `is-drilldown-active` from the active trigger AND sets `aria-expanded="false"` on it (FR-015 dismiss-path coverage). `dispose()` (existing at L165-173) MUST also disconnect any still-live observers and call `clearActive()` — extend the existing dispose function to add this cleanup. (FR-015, contract § 5)
- [ ] T016 Implement retarget-in-place ordering inside `activate(trigger)` per FR-016 4-step sequence: (1) before opening the panel for the new trigger, call `clearActive()` to remove `is-drilldown-active` and set `aria-expanded="false"` on the previously-active trigger; (2) build new panel content; (3) call `openDetailPanel(context)`; (4) set `is-drilldown-active` and `aria-expanded="true"` on the new trigger. The `activeTrigger` reference (mirrors `throughput-drilldown.ts:328`) tracks the currently-active trigger across activations; resetting it follows the 4-step ordering. The no-overlap invariant (no window with both triggers active simultaneously) is enforced by the ordering: step 1 clears the prior; step 4 sets the new. (FR-016, contract § 5)
- [ ] T017 Update `wrapSparklineTrigger` in `extension/ui/modules/charts/summary-cards.ts:458-472` to add the `data-drilldown-cycle-metric` attribute to the cycle-time triggers ONLY. Modify the function signature to accept an optional fourth parameter `cycleMetric?: "p50" | "p90"` (or use a separate parameter shape — implementer's call), and within the function body, set `button.setAttribute("data-drilldown-cycle-metric", cycleMetric)` only when `cycleMetric !== undefined`. Update the four call sites at L158-161 to pass the metric: `wrapSparklineTrigger(containers.totalPrsSparkline, "throughput")` (no metric), `wrapSparklineTrigger(containers.cycleP50Sparkline, "cycle-time", "p50")`, `wrapSparklineTrigger(containers.cycleP90Sparkline, "cycle-time", "p90")`, `wrapSparklineTrigger(containers.reviewersSparkline, "reviewer")` (no metric). Throughput and reviewer triggers MUST NOT carry the `data-drilldown-cycle-metric` attribute (asserted by Phase 4 tests). Preserve the existing `aria-label` text "Open full {chart} chart" (locked per contract § 9). (FR-005, contract § 9, G3)
- [ ] T018 Add an inline comment block in `extension/ui/modules/charts/summary-cards.ts` immediately before or inside the `wrapSparklineTrigger` function, explaining the LD-2 asymmetry. Comment text MUST cite Issue #363 + LD-2 and explain in 2-4 lines why the reviewer card preserves scroll-and-highlight while the other three cards open the panel (the reviewer card metric is "average unique reviewers per week" — not a PR set). Future readers MUST see the rationale at the trigger emission site, not only in the spec. (FR-020)

**Checkpoint**: Core implementation complete. `installSparklineNavigator` accepts `(container, rollups, options)`; activate() branches 3-in/1-out; period-scoped panel renders for throughput / cycle-time cards; reviewer card preserved; cycle-metric attribute emitted. Existing tests still pass with the stop-gap empty-rollups param from T011.

---

## Phase 3: Dashboard wiring

**Purpose**: Update the dashboard call site at `dashboard.ts:1339-1345` so the existing single-arg install becomes the new three-arg install with the canonical options bag and `currentRollups`.

- [ ] T019 Update the `installSparklineNavigator` call site in `extension/ui/dashboard.ts:1339-1345` to pass three arguments. Mechanical pattern — copy the same options-bag construction the existing cycle-time install uses at L1320-1337. New call: `installSparklineNavigator(summaryCardsContainer, rollups, { filters: {...}, repositoriesDimension: ..., webContext: ..., authorsDimension: ..., commentsMetricsAvailable: ... })`. The `rollups` variable is already in scope at the call site (the same `rollups` constant declared at L1045 and passed to all other drilldown installs). The options-bag fields use the same expressions: `filters` is a `{ repos, teams, reviewers, authors }` snapshot of `currentFilters`; `repositoriesDimension` is the `currentDimensions?.repositories?.map(...)` projection; `webContext` is `currentCollectionUri ? { collectionUri: currentCollectionUri } : undefined`; `authorsDimension` is `currentDimensions?.authors`; `commentsMetricsAvailable` is `loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false`. (FR-001 plumbing, contract § 1, memory: `feedback_dataset_loader_method_parity` — `getCapabilityState` is already implemented on both `DatasetLoader` and `AuthenticatedDatasetLoader` per Pass 3 verification of cycle-time install)
- [ ] T020 Verify the PRESERVED-behavior contract is intact after Phase 1-3. **"Preserved behavior" means** (FR-002 / FR-003 / FR-004 / FR-019 / SC-005 / SC-006 / SC-008): (a) reviewer-card scroll-and-highlight; (b) missing-target inline advisory (`renderNoData` adjacent to sparkline when target chart absent); (c) comparison-mode toast denial on every sparkline trigger. **NOT preserved**: throughput-card and cycle-time-card activation behavior — those INTENTIONALLY change from scroll-and-highlight to `openDetailPanel` per FR-001 / G3, and the existing tests for those targets were removed/replaced in T014 per its obsolescence-rules sub-clause. Run `cd extension && pnpm test --testPathPattern=sparkline-navigator`; assert the surviving reviewer-card preservation tests + missing-target advisory tests + comparison-toast tests still pass (the obsolete throughput/cycle-time scroll+highlight tests should be GONE per T014, not failing). Run `cd extension && pnpm test --testPathPattern=throughput-drilldown` to confirm throughput-drilldown's chart-bar tests stay green (Phase 2 does not touch its file). Run `pnpm run build:check` (`tsc --noEmit`) and confirm zero type errors with the new `SparklineDrilldownOptions` and the extended `DrillDownContext`. No commits at task-level — Phase 1-3 changes commit together with Phase 4-5 per the per-commit ratchet. (FR-002 / FR-003 / FR-004 / FR-019 / SC-005 / SC-006 / SC-008, QG-17, QG-18, G3)

**Checkpoint**: Foundation + dashboard wired; existing reviewer-card behavior preserved; existing tests still pass; new functionality untested. Phase 4 adds the test coverage.

---

## Phase 4: Test suite

**Purpose**: Author all new test scenarios + the capability-off DOM golden fixture + the spread-guard ALLOWED_MODULES extension. The four test files within Phase 4 can be authored in any order; tasks editing the same file are sequential.

### US1 — Throughput card opens period-scoped PR list (Priority: P1)

- [ ] T021 [US1] Add a test in `extension/tests/modules/drilldown/sparkline-navigator.test.ts` named `"throughput card sparkline opens DetailPanel with period-scoped PR list"`. Install with a multi-week rollup window fixture (3+ rollups carrying non-empty `prs` arrays), populated options bag (`filters: empty`, `repositoriesDimension: [...]`, `webContext: {...}`, `commentsMetricsAvailable: false`). Click the throughput sparkline trigger. Assert: (a) `openDetailPanel` was called; (b) the panel content has the correct title (matches `formatPeriodTitle(rollups)`); (c) the panel content has the correct subtitle (`{N} PRs` where N is the sum of `pr_count`); (d) the PR list section is rendered; (e) the section's `contentState` is `pr-list`. (FR-001 / FR-006, US1 acceptance scenario 1, contract § 3, G3)
- [ ] T022 [US1] Add a test named `"throughput card with team filter renders team-inline message"` to `sparkline-navigator.test.ts`. Install with `options.filters = { teams: ["t1"], ... }` and a rollup window that would otherwise render a PR list. Assert the section's `contentState` is `team-inline` and message text matches throughput-drilldown's team-inline message. (FR-011, US1 acceptance scenario 2, contract § 3)
- [ ] T023 [US1] Add a test named `"throughput card with reviewer filter renders reviewer-inline message"` to `sparkline-navigator.test.ts`. Install with `options.filters = { reviewers: ["r1"], ... }`. Assert the section's `contentState` is `reviewer-inline` and message text matches throughput-drilldown's reviewer-inline message. (FR-011, US1 acceptance scenario 3, contract § 3)
- [ ] T024 [US1] Add a test named `"throughput card in comparison mode fires toast and does not open panel"` to `sparkline-navigator.test.ts`. Set `isDrilldownDisabledByComparison()` to return true (via the existing test-side comparison-state setter). Click the throughput sparkline. Assert: (a) `openDetailPanel` was NOT called; (b) `showComparisonAdvisoryToast` WAS called with the trigger. (FR-004 / FR-019, US1 acceptance scenario 4, contract § 6)
- [ ] T025 [US1] Add a test named `"throughput card with missing target chart renders inline advisory"` to `sparkline-navigator.test.ts`. Set up the DOM such that `#throughput-chart` is absent. Click the throughput sparkline. Assert the inline advisory message is rendered adjacent to the sparkline; `openDetailPanel` was NOT called. (FR-003 / SC-008, US1 acceptance scenario 5)

### US2 — Cycle-time cards open period-scoped PR list with metric marker (Priority: P1)

- [ ] T026 [US2] Add a test named `"cycle-time P50 card sparkline opens panel with — P50 marker"` to `sparkline-navigator.test.ts`. Install with multi-week rollup fixture. Click the cycleP50 sparkline. Assert: (a) `openDetailPanel` was called; (b) the panel title contains `— P50` after the period-range; (c) PR list section rendered with the same content as the throughput-card panel for the same rollup window (cross-card content parity). (FR-005 / FR-006 / Q-R2, US2 acceptance scenario 1, contract § 2)
- [ ] T027 [US2] Add a test named `"cycle-time P90 card sparkline opens panel with — P90 marker"` to `sparkline-navigator.test.ts`. Mirror T026 with the cycleP90 trigger. Assert title contains `— P90`. (FR-005 / FR-006 / Q-R2, US2 acceptance scenario 1 (sibling), contract § 2)
- [ ] T028 [US2] Add a test named `"clicking cycleP50 then cycleP90 retargets in place with no flicker"` to `sparkline-navigator.test.ts`. Open the panel via cycleP50, capture initial PR row sequence + title. Click cycleP90 without dismissing. Assert: (a) the panel title swaps from `... — P50` to `... — P90`; (b) PR list rows are byte-identical (same period union); (c) panel `is-open` class never flips off (retarget-in-place, no close-then-reopen); (d) `is-drilldown-active` class moved from cycleP50 trigger to cycleP90 trigger; (e) `aria-expanded` is `true` on cycleP90 trigger and `false` on cycleP50 trigger; (f) at no observed point did BOTH triggers carry `is-drilldown-active` simultaneously. (FR-005 / FR-016 / SC-002, US2 acceptance scenario 2, contract § 5)
- [ ] T029 [US2] Add a test named `"clicking totalPrs then cycleP50 retargets across cards"` to `sparkline-navigator.test.ts`. Cross-card retarget verification: open panel via throughput, then click cycleP50. Assert the `sourceChart: "summary-card"` value is preserved across the swap; the panel title gains the P50 marker; active-class lifecycle moves cleanly between the two triggers. (FR-016, contract § 5)
- [ ] T030 [US2] Add a test named `"cycle-time cards with team filter render team-inline message"` to `sparkline-navigator.test.ts`. Mirror T022's logic for both cycleP50 and cycleP90 (parametrized). Assert both render `team-inline`. (FR-011, US2 acceptance scenario 3, contract § 3)
- [ ] T031 [US2] Add a test named `"cycle-time cards in comparison mode fire toast and do not open panel"` to `sparkline-navigator.test.ts`. Mirror T024's logic for both cycleP50 and cycleP90. (FR-004 / FR-019, US2 acceptance scenario 4, contract § 6)
- [ ] T032 [US2] Add a test named `"cycle-time cards with missing target chart render inline advisory"` to `sparkline-navigator.test.ts`. Mirror T025's logic for both cycleP50 and cycleP90 (with `#cycle-time-trend` absent). (FR-003 / SC-008, US2 acceptance scenario 5)
- [ ] T033 [US2] Add a test named `"cycle-time triggers carry data-drilldown-cycle-metric attribute; throughput and reviewer triggers do not"` to `extension/tests/modules/charts/summary-cards.test.ts`. **Placement locked: this file exists at HEAD** (verified during Pass 2 hardening) and is the right home for trigger-emission DOM-attribute tests since `wrapSparklineTrigger` is defined in `summary-cards.ts`. Drive the four `wrapSparklineTrigger` call sites (or invoke `renderSummaryCards` end-to-end) and assert the rendered `<button>` elements: `cycleP50` trigger → has `data-drilldown-cycle-metric="p50"`; `cycleP90` trigger → has `data-drilldown-cycle-metric="p90"`; `totalPrs` trigger → does NOT have the attribute; `reviewers` trigger → does NOT have the attribute. (FR-005, contract § 9, G3)

### US3 — Reviewers card preserves scroll-and-highlight (Priority: P2 — regression-lock)

- [ ] T034 [US3] Add a test named `"reviewers card sparkline scrolls + highlights, does NOT open DetailPanel"` to `sparkline-navigator.test.ts`. Install with multi-week fixture. Click the reviewers sparkline. Assert: (a) `openDetailPanel` was NOT called (the new DetailPanel branch must be skipped for reviewer); (b) `targetEl.scrollIntoView` was called with `block: "center"` (existing); (c) `is-sparkline-highlight` class was added to `#reviewer-activity` for ~1500ms (existing — exercise the existing test pattern in `sparkline-navigator.test.ts:151+`); (d) the existing scroll-and-highlight tests in `sparkline-navigator.test.ts` (currently at L122-432) pass byte-equivalent. **This task verifies the FR-002 regression-lock by inspection — the existing tests for the reviewers card MUST stay green without modification.** (FR-002 / SC-005 / FR-017, US3 acceptance scenarios 1-4, contract § 7, G3)
- [ ] T035 [US3] Verify the reviewer-card reduced-motion behavior is regression-locked by the EXISTING test at `extension/tests/modules/drilldown/sparkline-navigator.test.ts:136` (`it("uses scroll behavior 'auto' when prefers-reduced-motion is active", ...)`). **Placement locked: this test already exists at HEAD** (verified during Pass 2 hardening) and asserts the `prefers-reduced-motion` matchMedia mock + scrollIntoView `behavior: "auto"` call — exactly the FR-017 / US3 acceptance scenario 2 contract. **No new test is added in T035.** Implementer's responsibility: after T011's signature update lands (which updated the existing test's call sites to pass `rollups: []`), confirm the existing reduced-motion test still passes byte-equivalent on the reviewer-card branch. If the existing test ever turns red because of T014's branching change, the reviewer-card preservation has been broken and T014 must be re-examined. (FR-017, US3 acceptance scenario 2, regression-lock via existing test, G3)
- [ ] T036 [US3] Add a test named `"reviewers card in comparison mode fires toast and does NOT scroll"` to `sparkline-navigator.test.ts`. Set comparison-mode active. Click the reviewers sparkline. Assert: (a) `showComparisonAdvisoryToast` was called; (b) `targetEl.scrollIntoView` was NOT called. (FR-004 / FR-019 / SC-006, US3 acceptance scenario 4)

### US4 — Capability-aware DOM shape and stat row (Priority: P2)

- [ ] T037 [US4] Add a test named `"capability-on PR list rows include thread/comment/active counts"` to `sparkline-navigator.test.ts`. Install with `options.commentsMetricsAvailable = true` and a rollup window with PR records carrying the comments triplet. Click any of the three eligible cards. Assert: (a) PR list rows in the rendered DOM include thread / comment / unresolved-thread cells; (b) the comments stat row is prepended above the PR list (FR-012). (FR-012 / FR-014, US4 acceptance scenario 2, contract § 4)
- [ ] T038 [US4] Add a test named `"capability-off + team-inline state suppresses comments stat row"` to `sparkline-navigator.test.ts`. Install with `options.commentsMetricsAvailable = true` AND `options.filters = { teams: ["t1"], ... }` (so classifier returns `team-inline`). Click any eligible card. Assert: (a) the section is `team-inline`; (b) the comments stat row is NOT prepended (gate fires only for `pr-list` content state). (FR-012, US4 acceptance scenario 3)
- [ ] T039 [US4] [P] Create new test file `extension/tests/modules/drilldown/sparkline-pr-list-capability-off-baseline.test.ts`. Mirror the pattern in `extension/tests/modules/drilldown/cycle-time-pr-list-capability-off-baseline.test.ts`. Install the sparkline-navigator with `commentsMetricsAvailable: false` against a multi-week rollup window, click any eligible card, render the panel, and locate the rendered PR list section via the **stable selector `section#pr-detail`** (verified during Pass 2 hardening at `extension/ui/modules/shared/detail-panel.ts:1168-1175` — the `renderPrListSection` function emits a `<section id="pr-detail" class="detail-panel-section detail-panel-section--pr-detail" role="region" aria-labelledby="pr-detail-heading" data-content-state="pr-list">`). Compare its innerHTML byte-for-byte against the committed baseline file at `extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html` (created by T040). Assert byte-identical DOM. (FR-013 / SC-004, US4 acceptance scenario 1, contract § 10)
- [ ] T040 [US4] [P] Create the capability-off baseline fixture file at `extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html`. **Capture method**: after T013 + T019 land, run the implementation in a Jest test sandbox with `commentsMetricsAvailable: false` against a known-fixture rollup window (use the same fixture shape T039 will assert against — same rollups, same options bag, same trigger), invoke the rendering path that fires `renderPrListSection`, then `console.log(document.querySelector("section#pr-detail")?.innerHTML)` (or equivalent jsdom inspection). Capture the exact emitted bytes and write them to the fixture file. Verify the bytes start with `<h3 id="pr-detail-heading">Pull requests</h3>` (the constant heading per `detail-panel.ts:1176-1178`) and contain a `<ol class="detail-panel-pr-list">` (NOT `detail-panel-pr-list--with-comments` modifier — capability-off must NOT produce that class per FR-013). The fixture is committed; T039 asserts byte-equivalence on every test run. (FR-013, contract § 11)

### Period-scoped PR list shape lock

- [ ] T041 [P] Create new test file `extension/tests/modules/drilldown/sparkline-pr-list-order.test.ts`. Tests required: (1) seed a multi-week rollup window with PRs that, when unioned, are NOT already in `cycle_time desc, id asc` order (e.g., week 1 has [PR-id=5 / cycle=300m] [PR-id=3 / cycle=600m]; week 2 has [PR-id=7 / cycle=200m] [PR-id=2 / cycle=600m]); (2) drive the sparkline-navigator install + click + render; (3) assert the rendered `<li>` row sequence is in `cycle_time desc, id asc` order across the cross-week union (so the rendered sequence above must be PR-id=2 (cycle 600m), PR-id=3 (cycle 600m), PR-id=5 (cycle 300m), PR-id=7 (cycle 200m)). The test exercises BOTH cycle_time descending AND id-ascending tiebreak. **The assertion MUST inspect the rendered DOM, not the input array — FR-010 makes the rendered output the contract.** (FR-010 / SC-001, contract § 3, G2 indirect — this verifies the consumer's re-sort)
- [ ] T042 [P] Create new test file `extension/tests/modules/drilldown/sparkline-pr-list-count-parity.test.ts`. Mirror `extension/tests/modules/drilldown/cycle-time-pr-list-count-parity.test.ts`. Tests required: (1) under a supported state with un-truncated multi-week rollup window, the rendered row count equals the sum of per-rollup `prs.length` (`collected.length`); (2) under a supported state with at least one truncated rollup (`_prs_truncated: true`), the rendered row count equals `collected.length` AND the truncation cue text is rendered AND `actualFilteredCount === totalPeriodPrCount`; (3) under a supported state where collected count is strictly less than totalPeriodPrCount (defensive clause, even when `anyTruncated === false`), the truncation cue is rendered. (FR-007 / FR-008 / FR-009 / SC-003, contract § 3)

### Spread-guard parity

- [ ] T043 Update `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` to extend the `ALLOWED_MODULES` constant to include `sparkline-navigator.ts`. **REQUIRED, not conditional**: T013's local `buildCommentsStatRowLocal` helper directly references the comments-metrics field names `threadCount` / `commentCount` / `activeThreadCount` (sums them over `PrListRow[]` to produce the FR-012 stat row); the spread-guard test enforces that any module reading or writing those field names must appear in the allowlist (Feature-310 single-authority invariant per Constitution QG-49). Without this update, the spread-guard test fails as soon as T013's helper lands. The change is a single-line ALLOWED_MODULES entry addition; no new test scenarios are required, and no existing assertions need to change. (Constitution QG-49, contract § 12, FR-012 / FR-014 indirect via T013 helper)

**Checkpoint**: Test suite complete. New tests / fixtures / spread-guard extension all in place; existing reviewer-card tests preserved unchanged. Phase 5 stages and bumps the floor.

---

## Phase 5: Ratchet bump + final verification

**Purpose**: Compute the floor delta, bump `.test-floor-contract.json`, verify reviewer-drilldown regression-lock, run final preflight. **All Phase 1-5 changes MUST stage in the SAME commit** (per-commit ratchet — `floor_delta == test_delta`; no marker waiver for extension; G6).

### Ratchet bump (G6)

- [ ] T044 Run `cd extension && pnpm test:coverage` to produce `extension/test-results.xml` (the JUnit artifact). Verify the file is well-formed via `python scripts/check_test_floor_contract.py --contract .test-floor-contract.json --extension-junit extension/test-results.xml`. (G6, QG-44)
- [ ] T045 Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`. The output reports `actual=N` for the Extension dimension. Update `.test-floor-contract.json` `extension.min_collected` to exactly that `N`. The Python floor stays unchanged (no Python tests added — G4 forbids them). Re-run the ratchet-bump command to confirm exit 0 and zero drift. **All Phase 1-5 source changes + new tests + new fixture + spread-guard extension + this floor bump MUST be in the same git commit** — the per-commit ratchet enforces `floor_delta == actual_delta` per first-parent walk. There is no `[ratchet-realignment]` waiver for extension drift. (G6, QG-43, QG-44, FR-022 indirect via test-floor parity, memory `feedback_test_floor_contract_same_commit`)

### Reviewer-drilldown regression-lock verification (G5 / FR-022)

- [ ] T046 Verify reviewer-drilldown regression-lock: zero hunks across six paths. Run the following command and assert the output is empty (or shows only "(no changes)"):

```bash
git diff --stat HEAD -- \
  extension/ui/modules/drilldown/reviewer-drilldown.ts \
  extension/tests/modules/drilldown/reviewer-drilldown.test.ts \
  extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts \
  extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts \
  extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts \
  extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html
```

If output is non-empty (any changed lines or changed files reported), the implementation has touched a regression-locked path and MUST revert before commit. If output is empty / zero-changes, the regression-lock is satisfied. **This task cites FR-022 / Q-R4 = Branch B explicitly**: reviewer-drilldown's source / tests / fixture are byte-untouched. (FR-022, Q-R4 = Branch B, G1, G5, contract § 8)

### Cross-surface gate confirmations

- [ ] T047 [P] Confirm the cross-surface PR-record schema-parity gate is green: `python scripts/check_pr_record_schema_parity.py` returns exit 0. This MUST pass by no-op because no PR-record field is added or removed (LD-3, G4). (FR-022 indirect, QG-49, G4)
- [ ] T048 [P] Confirm zero suppression delta: `python scripts/audit-suppressions.py --diff` reports zero drift across every scope (`typescript-extension`, `typescript-tests`, etc.). `.suppression-baseline.json` stays at total=0. (QG-41)
- [ ] T049 [P] Confirm no producer / backend / schema changes (G4 / LD-3 verification, EXCLUDING managed UI artifacts). TypeScript-only feature: ESLint passes with no `any` introduced; `typing.Any` not applicable to extension code. **Producer-side diff check**: run

```bash
git diff origin/main -- src/ tests/ scripts/ .github/scripts/ ':(exclude)src/ado_git_repo_insights/ui_bundle/'
```

The Git pathspec `:(exclude)src/ado_git_repo_insights/ui_bundle/` excludes the managed UI bundle artifacts (`dashboard.js`, `artifact-client.js`, `dataset-loader.js`, `settings.js`) that the implementation commit IS expected to regenerate as part of the canonical bundle promotion (see 361/362 commits' "Generated artifact triplet" lines). The check protects against accidental Python / producer / schema / aggregator / CLI script work — the things G4 forbids — without falsely flagging the expected UI-bundle sync. Expected output: empty diff (zero lines, zero files). If the diff shows any change in `src/` outside `src/ado_git_repo_insights/ui_bundle/`, OR in `tests/` (Python tests), OR in `scripts/`, OR in `.github/scripts/`, the feature has overstepped its scope and the implementation MUST be reworked before delivery. (QG-40, G4, LD-3, plan.md "Files NOT touched")

### Final preflight

- [ ] T050 Run the authoritative local preflight: `python scripts/run_pr_preflight.py` — MUST return exit 0 with no `--allow-local-degraded` flag. Every CommandSpec passes: mypy on `src/ tests/ scripts/ .github/scripts/`, ruff check + format, pytest with coverage, Extension Jest CI (with the new tests), Extension type tests, Extension smoke (Playwright), PR-record schema parity, generated-artifact parity, test-floor contract validation, ratchet-bump guard, coverage-delta gate, gitleaks secret scan, suppression baseline gates (zero), CLI-reference drift, and every other CommandSpec. (SC-007, G6 indirect, VR-29)

### End-to-end verification

- [ ] T051 Run the `quickstart.md` walkthrough end-to-end against the published demo (`pnpm run serve:docs`): exercise every spec acceptance scenario manually. Confirm SC-001 (one-action PR list reach for throughput / cycle-time cards), SC-002 (single transition retarget between cycleP50 and cycleP90), SC-003 (truncation cue + period row bound), SC-004 (capability gate DOM shapes), SC-005 (reviewer-card preserved), SC-006 (comparison-mode + reduced-motion preserved on all four), SC-007 (reviewer-drilldown's existing tests + DOM goldens unchanged), SC-008 (missing-target advisory). **Also confirm no feature flag / rollout gate**: `grep -rE "featureFlag|getFeatureGate|isFeatureEnabled|rolloutGate" extension/ui/modules/drilldown/sparkline-navigator.ts extension/ui/dashboard.ts extension/ui/modules/charts/summary-cards.ts` MUST return zero hits in the new code. (SC-001 / SC-002 / SC-003 / SC-004 / SC-005 / SC-006 / SC-007 / SC-008, all User Stories)

**Checkpoint**: feature is delivery-ready. Branch is clean except for the new spec dir, source edits, new test files, fixture file, spread-guard extension, and `.test-floor-contract.json` bump — all in one implementation commit, ready for the standard review cycle.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0 (Pre-flight)**: T001 / T002 / T003 / T004 / T005 / T006 are independent of all source changes; can run in parallel. None block any later phase except providing baselines.
- **Phase 1 (Helper additions)**: T007 → T008 (sequential — T007 must add the helper before T008 tests it). Independent of Phase 2 (`week-range.ts` is consumed by Phase 2 but not part of `sparkline-navigator.ts`).
- **Phase 2 (Core implementation)**: T009 → T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018. Mostly sequential because most edit `sparkline-navigator.ts` (T010-T016 same file). T009 edits `detail-panel.ts`; T017 + T018 both edit `summary-cards.ts` and are therefore **sequential, not parallel** (per [P] = different files). Practical ordering: T009 first (independent file); then T010-T016 sequential in sparkline-navigator.ts; then T017 then T018 sequential in summary-cards.ts.
- **Phase 3 (Dashboard wiring)**: T019 → T020. Both edit `dashboard.ts` and verify Phase 1-3.
- **Phase 4 (Test suite)**:
  - T021-T032 + T034 + T036 + T037 + T038 edit `sparkline-navigator.test.ts` — sequential within that file.
  - **T033 edits `summary-cards.test.ts`** (different file; parallelizable with the sparkline-navigator.test.ts thread per Pass 2 lock).
  - **T035 is verification-only** (cites the existing test at sparkline-navigator.test.ts:136 per Pass 2 lock; no new test, no file edit).
  - T039 / T040 / T041 / T042 [P] amongst themselves and with the sparkline-navigator.test.ts thread (different new files).
  - T043 edits `pr-list-comments-spread-guard.test.ts` — independent of other test files.
- **Phase 5 (Ratchet + verification)**: T044 → T045 → T046 → (T047 / T048 / T049 [P]) → T050 → T051. Sequential except for the cross-surface confirmation triplet.

### Parallel Opportunities

- **Phase 0**: T001-T006 fully [P] — six different observations / file reads.
- **Phase 1**: T007 (source) → T008 (tests). T008 is [P] with Phase 2 work that doesn't touch `week-range.ts` (so T008 can start as soon as T007 lands and run in parallel with T009-T016).
- **Phase 4**: T039 / T040 / T041 / T042 [P] amongst themselves (four different new files). T043 is also [P] with the four (different file).
- **Phase 5**: T047 / T048 / T049 [P] amongst themselves (three independent gate checks).

### Within Each User Story (Phase 4)

- US1 tests T021-T025 are sequential within `sparkline-navigator.test.ts`.
- US2 tests T026-T032 are sequential within `sparkline-navigator.test.ts`. **T033 is locked to `summary-cards.test.ts`** (Pass 2 lock); it runs parallel with the sparkline-navigator.test.ts thread.
- US3 tests T034 + T036 are sequential within `sparkline-navigator.test.ts`. **T035 is verification-only** (no new test, no file edit; cites existing test at sparkline-navigator.test.ts:136 per Pass 2 lock).
- US4 tests T037-T038 are sequential within `sparkline-navigator.test.ts`; T039 / T040 are [P] with all other test tasks (different files).
- New-file tests T041 / T042 are [P] amongst themselves and with T021-T032 / T034 / T036 / T037 / T038.

### Parallel Example: Phase 4

```bash
# After Phase 1-3 lands, the new-file tests can be authored in parallel:
Task T039 [P]: "sparkline-pr-list-capability-off-baseline.test.ts (new file)"
Task T040 [P]: "sparkline-drilldown-capability-off-baseline.html (new fixture)"
Task T041 [P]: "sparkline-pr-list-order.test.ts (new file)"
Task T042 [P]: "sparkline-pr-list-count-parity.test.ts (new file)"

# Meanwhile, the same-file extensions in sparkline-navigator.test.ts are sequential:
Task T021 → T022 → T023 → T024 → T025 (US1)
  → T026 → T027 → T028 → T029 → T030 → T031 → T032 (US2; T033 NOT in this file)
  → T034 → T036 (US3; T035 is verification-only, no file action)
  → T037 → T038 (US4)

# T033 [P] in summary-cards.test.ts (parallel with the sparkline-navigator.test.ts thread above)
```

---

## Implementation Strategy

### Recommended commit plan (per memory `feedback_speckit_commit_plan_default`)

Two commits:

1. **Planning commit** (after `/speckit.analyze` passes): the contents of `specs/363-summary-card-pr-drilldown/` (spec, plan, research, data-model, contracts, quickstart, tasks, checklists). NO source changes. NO test additions. NO floor change. Speckit-artifact baseline.
2. **Implementation commit**: all of Phases 1 + 2 + 3 + 4 + 5 staged together — source edits to `week-range.ts` + `sparkline-navigator.ts` + `summary-cards.ts` + `dashboard.ts` + `detail-panel.ts`, all new tests across the 5 affected test files, the new capability-off baseline fixture, the spread-guard ALLOWED_MODULES extension, and the `.test-floor-contract.json` `extension.min_collected` bump. Single atomic implementation commit. Q-R5=R5-A locks NO `chore(demo)` commit.

### Per-commit ratchet rule (the non-negotiable constraint)

The project's per-commit ratchet (`scripts/check_ratchet_bump.py` + CI's `ratchet-bump-guard` job) walks first-parent history and asserts `floor_delta == test_delta` on every commit individually. There is no marker waiver for extension drift. The implication for commit boundaries:

- A commit that adds N new Jest tests MUST bump `.test-floor-contract.json` `extension.min_collected` by exactly N in the same commit.
- A commit that adds zero Jest tests MUST NOT change the floor.
- A commit that changes the floor without a matching test delta fails the gate.

The single implementation commit (above) keeps this trivially satisfied. Splitting into multiple commits requires each to be internally consistent.

### MVP definition (functional, not commit-bounded)

After the implementation commit, the feature's MVP is fully delivered:

- **Phase 1** delivers `formatPeriodTitle` (Q-R2 lock).
- **Phase 2** delivers the period-scoped panel-build logic with 3-in/1-out branching; reviewer-card preserved; cycle-metric attribute emitted.
- **Phase 3** wires the dashboard so the new install signature receives the correct args.
- **Phase 4** locks the user-visible behavior with regression tests (no impl change).
- **Phase 5** stages everything, bumps the floor, verifies the FR-022 regression-lock, runs final preflight.

There is no "shippable Phase 2 alone" intermediate state — the per-commit ratchet requires the floor to bump alongside any test additions, and the spec mandates new consumer tests for FR-005 / FR-013 / FR-022 (which sit in Phase 4). So the smallest functionally-complete and verification-complete deliverable is the full implementation commit.

### Parallel Team Strategy

This feature is sized for one developer end-to-end. Phase 4 has natural [P] opportunities (4 new files) that could split across two developers, but the implementation commit must merge before staging.

---

## Notes

- [P] tasks = different files, no shared file with other in-progress tasks.
- [US#] label maps task to specific user story for traceability (US1 throughput card / US2 cycle-time cards / US3 reviewers preserved / US4 capability gate).
- Each user story's behavior is independently *testable*; Phase 4 adds tests covering all four US's behaviors against a single cohesive implementation in Phases 1-3. Independent testability is the speckit invariant.
- The recommended path is one implementation commit with all source + tests + fixture + spread-guard extension + floor bump (Phases 1-5). The per-commit ratchet rule (above) governs any split.
- No marker waivers used (`[version-override-acknowledged]`, `[threshold-update]`, `[ratchet-realignment]`, `[ratchet-test-removal]` are all N/A for this feature).
- Per repo memory `feedback_run_full_gate_at_head_before_push.md`: run `python scripts/run_pr_preflight.py` at clean HEAD before any `git push` attempt.
- Per repo memory `feedback_never_push_without_explicit_command.md`: no `git push` is performed by these tasks; the user controls push timing.
- CLAUDE.md is gitignored at `.gitignore:76`; `update-agent-context.ps1` modifications are local-only ergonomics and don't appear in commits.
- Branch A (shared helper extraction) is "considered and rejected" per Q-R4 pre-flight; this tasks.md contains NO Branch A tasks. Reviewer-drilldown's six paths (FR-022) are byte-untouched throughout; T046 verifies this.
- The `applyFiltersToRollups` namespace mismatch at `metrics.ts:921` is OUT-OF-SCOPE per spec Non-goals; do NOT let this expand #363's PR (this tasks.md contains no task touching that file).
- After all tasks complete + clean preflight, the next steps are: `/speckit.analyze` (cross-artifact consistency check), then implementation commit, then user-driven push. `/speckit.analyze` runs AFTER tasks Pass 4 hardening per memory `feedback_speckit_cadence_applies_to_tasks`; the user explicitly directed deferring analyze until tasks are reviewed.

---

## Pass 2 hardening notes (what changed from Pass 1)

For traceability — diff summary of Pass 1 → Pass 2. Six locks landed per user directive; no new tasks added; no tasks removed.

1. **Frontmatter description** advanced to `Pass 2 hardened`.
2. **T011 — `rollups` strictness**: removed apologetic "revise" language. `rollups` is REQUIRED, not optional. Existing reviewer-card scroll-and-highlight tests get `installSparklineNavigator(container, [])` updates in this same task (~14 call sites to update); the empty-rollup stub keeps existing tests green because the reviewer-card branch never reads `rollups`.
3. **T013 — comments stat row locked to local duplication**: the FR-012 comments stat row is built via a local `buildCommentsStatRowLocal` private helper in `sparkline-navigator.ts`, mirroring `throughput-drilldown.ts:260-311 buildCommentsStatRow`. Rationale: `buildCommentsStatRow` is module-private to throughput-drilldown.ts (not exported); promoting it to a shared module would touch throughput-drilldown's source and exceed Branch B's scope. Local duplication is the surgical Branch B-aligned choice. The helper directly references `PrListRow.threadCount` / `commentCount` / `activeThreadCount` field names → triggers T043's spread-guard ALLOWED_MODULES requirement.
4. **T033 — placement locked to existing `summary-cards.test.ts`**: verified at HEAD that `extension/tests/modules/charts/summary-cards.test.ts` exists. The cycle-metric DOM-attribute test goes there because `wrapSparklineTrigger` lives in `summary-cards.ts`; adding the test next to its production code is the right factoring. No "verify at implementation time" hedge.
5. **T035 — locked to existing test citation, no duplicate**: verified at HEAD that `extension/tests/modules/drilldown/sparkline-navigator.test.ts:136` already covers `prefers-reduced-motion: reduce` → `scrollIntoView` `behavior: "auto"` for the reviewer card. The existing test already proves FR-017 / US3 acceptance scenario 2; no new test is added. Implementer's responsibility is regression-lock observation: the existing test must stay green after T014's branching change.
6. **T039 — DOM selector locked to `section#pr-detail`**: verified at HEAD that `detail-panel.ts:1168-1175 renderPrListSection` emits a `<section id="pr-detail" class="detail-panel-section detail-panel-section--pr-detail" role="region" aria-labelledby="pr-detail-heading" data-content-state="…">`. The fixture comparison selector is `section#pr-detail` (concrete, not "or equivalent stable selector").
7. **T040 — fixture capture method made explicit**: bytes are captured by running the implementation in a Jest test sandbox with `commentsMetricsAvailable: false` and querying `document.querySelector("section#pr-detail")?.innerHTML`. The expected bytes start with the constant `<h3 id="pr-detail-heading">Pull requests</h3>` heading and contain `<ol class="detail-panel-pr-list">` (NOT the `--with-comments` modifier — capability-off must NOT produce it per FR-013). Implementer captures these exact bytes; T039 asserts byte-equivalence per test run.
8. **T043 — spread-guard extension is REQUIRED**: changed from conditional ("IFF imports from shared/detail-panel") to REQUIRED. T013's local `buildCommentsStatRowLocal` helper reads `threadCount` / `commentCount` / `activeThreadCount` field names directly; QG-49's single-authority invariant requires every reading-or-writing module to be in the allowlist. The change is a single-line ALLOWED_MODULES update.
9. **T049 — producer-diff check excludes managed UI artifacts**: changed from `git diff origin/main -- src/ tests/ scripts/ .github/scripts/` to the same diff with the additional pathspec `:(exclude)src/ado_git_repo_insights/ui_bundle/`. The implementation commit IS expected to regenerate the UI bundle (`dashboard.js` / `artifact-client.js` / `dataset-loader.js` / `settings.js` under `src/ado_git_repo_insights/ui_bundle/`) per the 361/362 commit pattern; the producer-diff check should NOT flag this. The check still protects against accidental Python / aggregator / CLI script changes — exactly what G4 forbids.

**What did NOT change** (Pass 1 → Pass 2):

- Phase structure (6 phases, T001-T051) — unchanged.
- Total task count (51) — unchanged.
- Task-to-user-story mapping (US1: T021-T025; US2: T026-T033; US3: T034-T036; US4: T037-T040; cross-cutting: T041-T043) — unchanged.
- Branch B / Q-R4 lock (no Branch A tasks; reviewer-drilldown six-path regression-lock at T046) — unchanged.
- Demo-data scope (Q-R5=R5-A; no demo regen, no `chore(demo)` commit) — unchanged.
- Commit shape (1 planning + 1 implementation) — unchanged.
- Floor-bump protocol (T044 + T045 same commit per G6) — unchanged.

—

End of Pass 2 (hardened). Six user-directed locks landed; no behavioral or scope changes. Next step (per user direction): user review, then either Pass 3 hardening or `/speckit.analyze`.

---

## Pass 2 hardening corrections (post-Codex stop-hook)

Codex stop-hook caught nine cross-reference and behavior-claim contradictions remaining after the initial Pass 2 hardening pass. All corrections applied; no new tasks added, no tasks removed, no phase reorganization, total task count stays 51, commit shape unchanged.

1. **L46 + L59 (regression-lock paths section + T006)**: "T035 (Phase 5)" → **"T046 (Phase 5)"**. T046 is the actual reviewer-drilldown regression-lock verifier (six-path `git diff --stat`). T035 is a Phase-4 verification-only citation task. The misreference would have sent the implementer to the wrong file/task.
2. **L55 (T002)**: "T037 computes the delta" → **"T045 computes the delta"**. T045 is the Phase-5 ratchet-bump compute step; T037 is the Phase-4 capability-on rows test. Floor delta belongs to T045.
3. **L56 (T003)**: "T013 will modify them" → **"T017 will modify them"**. T017 is the `wrapSparklineTrigger` update in `summary-cards.ts` that adds `data-drilldown-cycle-metric`; T013 adds `buildPanelContent` in `sparkline-navigator.ts`. The trigger emissions are modified by T017.
4. **L58 (T005)**: "buildPeriodScopedEnvelope (T011)" → **"(T012)"**. T012 adds the helper; T011 is the install signature update.
5. **T011 / T014 / T020 behavior contradiction (substantive)**: T011's "all existing tests stay green" claim was inaccurate because T014's branching change INTENTIONALLY changes throughput / cycle-time activation behavior, making their existing scroll+highlight tests obsolete.
   - **T011 corrected**: now states the `[]` stub is pure-mechanical (rollups captured but unread); test status after T011 alone is "all 18 existing tests still pass" because activate() still has its pre-T014 single-branch behavior.
   - **T014 corrected**: explicit "Test impact of this branching change" sub-clause requires removing or replacing the obsolete throughput/cycle-time scroll+highlight tests as part of T014. Reviewer-card tests are PRESERVED unchanged because the reviewer-branch code is byte-equivalent.
   - **T020 corrected**: "no regression" claim explicitly scoped to PRESERVED behavior (reviewer-card scroll-and-highlight, missing-target inline advisory, comparison toast denial). Throughput/cycle-time activation INTENTIONALLY changes per FR-001 / G3; the obsolete tests are GONE per T014, not failing.
6. **L219 / L234-235 / L248-250 (stale Pass-2-superseded language)**:
   - L219 Phase 4 dependency block now correctly enumerates which tasks edit which file: T021-T032 + T034 + T036 + T037 + T038 in sparkline-navigator.test.ts; T033 in summary-cards.test.ts; T035 verification-only.
   - L234-235 Within Each User Story corrected: T033 is LOCKED to summary-cards.test.ts (Pass 2 lock); T035 is verification-only with no file action. The "may live ... verify at implementation time" hedge is gone.
   - L248-250 Parallel Example diagram split into two threads: sparkline-navigator.test.ts sequential (T033 NOT in it; T035 NOT in it); T033 [P] in summary-cards.test.ts (parallel with the main thread).
7. **T011 line count**: "~14 invocations" → **"~18 invocations"** (the 18 line numbers actually listed: L122, L151, L166, L180, L200, L230, L243, L254, L277, L296, L316, L332, L343, L372, L382, L398, L414, L427).
8. **L216 parallelism prose (Phase 2 dependency block)**: "T018 can be parallel with T017 (same file but different concern)" — corrected. T017 + T018 both edit `summary-cards.ts` and are therefore **sequential, not parallel** (per [P] = different files).
9. **No new contradictions introduced by these corrections**: the cross-reference chain T011→T012→T013→T014→T015→T016→T017→T018 is internally consistent; T020's scoped "no regression" claim aligns with T014's obsolescence-rules sub-clause; T033/T035 placement and [P] marking are coherent with the Phase 4 dependency block and the Parallel Example diagram.

—

End of Pass 2 hardening corrections. Tasks.md is now internally consistent for the next pass (`/speckit.analyze` per user direction).
