---
description: "Tasks for 362 — Reviewer-Activity Chart PR-Level Detail (Pass 1 draft)"
---

# Tasks: Reviewer-Activity Chart PR-Level Detail

**Input**: Design documents from `specs/362-reviewer-pr-drilldown/`
**Prerequisites**: `plan.md` + `spec.md` (28 FRs, 14 SCs — Pass 1 + Pass 2 + Pass 3 hardened, /speckit.clarify Q1 (Option A) + Q2 (cap = 500) locked) + `research.md` + `data-model.md` + `contracts/per-reviewer-week-prs.md` + `contracts/reviewer-pr-list.md` + `quickstart.md`. Every task below traces to one or more FR / SC identifiers.

**Tests**: enterprise-coverage mandatory (QG-42); FR-019 / FR-012 / FR-013 / FR-026 / FR-028 / FR-029 each carry an explicit consumer-side or producer-side test obligation; FR-020 mandates the dual-floor-bump contract. Tests can be authored before or alongside implementation — they are required by spec, not dictated by TDD ordering.

**Organization**: tasks grouped by user story from `spec.md` (P1 → P2 → P3). Phase 2 (Foundational) lands the producer-side scaffolding (types extension + constant alias) so every later phase has a stable extension surface to target. Phase 6 (Polish) carries BOTH the Python AND Extension test-floor bumps + final preflight verification — all source + tests + fixtures + floor bump MUST be staged in the SAME commit (per-commit ratchet, no marker waiver for Extension drift; Python `[ratchet-realignment]` requires explicit user authorization per FR-021).

## Format: `- [ ] TXXX [P?] [Story?] Description with file path (FR-XXX, SC-XXX)`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks in the same phase)
- **[US#]**: user-story label (US1 / US2 / US3) — required for story-phase tasks; omitted for Setup, Foundational, and Polish phases
- FR / SC refs in parentheses at the end of each description

## Path Conventions

- Producer source: `src/ado_git_repo_insights/transform/`, `src/ado_git_repo_insights/types.py`, `scripts/`
- Producer tests: `tests/unit/`
- Extension source: `extension/ui/`
- Extension tests: `extension/tests/`
- Extension fixtures: `extension/tests/fixtures/`
- Test-floor contract: `.test-floor-contract.json` (repo root)
- Spec & contract docs: `specs/362-reviewer-pr-drilldown/`

All paths are repository-relative.

## Cross-OS discipline (QG-39)

This feature is producer + consumer; both surfaces use cross-platform constructs only. Producer: `pandas` operations + `pathlib` + dict construction. Consumer: TypeScript-only inside the existing extension. Tests use `pytest` + `jsdom` (cross-platform). Tasks that invoke scripts use the project's standard cross-platform commands as documented in `CONTRIBUTING.md`.

**Note on source-file line numbers**: line-number anchors cited in task descriptions (e.g., `aggregators.py:2139-2201`, `reviewer-drilldown.ts:75-148`, `pr-list-comments-spread-guard.test.ts:32-47`) are planning-time references taken at the start of this branch and confirmed during Pass-3 plan validation. They MAY shift as earlier tasks land. Task validity depends on filename plus surrounding function / symbol name; verify positions at implementation time against the current file state.

---

## Phase 1: Setup (Sanity)

**Purpose**: Confirm the branch baseline before any edits — preflight clean, both floors recorded.

- [X] T001 Verify clean local preflight baseline on branch tip: `python scripts/run_pr_preflight.py` returns exit 0 with no `--allow-local-degraded` flag, on a clean working tree. Record the start-of-branch state for SC-007 final comparison. No commits in this phase. (SC-007, QG-29, QG-35, QG-36)
- [X] T002 Record both starting floor values from `.test-floor-contract.json` (`extension.min_collected` AND `python.min_collected`). Run `cd extension && pnpm test:coverage` to produce `extension/test-results.xml`, AND run `python scripts/run_pytest.py` to produce the Python JUnit artifact. Confirm `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml --junit-python <pytest-junit-path>` reports floor == actual on BOTH dimensions (parity invariant). The starting values are the baseline against which T044 / T045 compute the deltas. No commits in this phase. (SC-010, QG-43, QG-44, FR-020)

---

## Phase 2: Foundational (Backward-Compat Scaffolding)

**Purpose**: Land the producer-side type extensions + constant alias so every later phase has a stable producer-side surface to target. **No producer behavior change in this phase** — `_generate_reviewer_slice` continues to emit exactly what it does at HEAD when the new fields are read by no consumer; the constant alias is a no-op until referenced by T010.

**⚠️ CRITICAL**: Phase 2 MUST complete before any Phase 3 task lands. Phase 3 tasks read the foundational scaffolding (interface, signature, constant alias) — landing them out of order causes type-check failures and aggregator runtime errors.

- [X] T003 Extend `extension/ui/schemas/rollup.schema.ts` `ReviewerBreakdownEntry` interface (currently `:58-64`) with three optional fields: `prs?: readonly PrRecord[]`, `_prs_truncated?: boolean`, `_prs_cap?: number`. Strict typing — no `Any`, no `unknown` widening. Include a JSDoc comment block above the new fields pointing to `contracts/per-reviewer-week-prs.md` § 1 for atomicity semantics. Update the existing reviewer-validator path in the same file to permissively warn (NOT error) on: `prs` present but not an array; `prs` element shape mismatching `PrRecord` (reuse the per-element checks from `validatePrRecordArray` at `:571+`); `_prs_truncated` present but not a boolean; `_prs_cap` present but not a number; atomicity violation (any one of the three present without the other two). The validator MUST NOT reject malformed entries — match the permissive posture of `validatePrRecordArray`. (FR-016 plumbing, data-model § 2)
- [X] T004 Extend the Python `ReviewerSliceMetrics` TypedDict in `src/ado_git_repo_insights/transform/types.py` (exact location pinned during Pass-3) with three optional (`NotRequired`) fields matching T003's TypeScript shape: `prs: NotRequired[list[PrRecord]]`, `_prs_truncated: NotRequired[bool]`, `_prs_cap: NotRequired[int]`. Add a docstring referencing `contracts/per-reviewer-week-prs.md`. (FR-016 plumbing, data-model § 2)
- [X] T005 Add the `_PR_DETAIL_CAP_PER_REVIEWER_WEEK = _PR_DETAIL_CAP` constant alias in `src/ado_git_repo_insights/transform/aggregators.py` immediately below the existing `_PR_DETAIL_CAP: Final[int] = 500` declaration at `:84`. Include a docstring tying the alias to the user's CL-02 single-source-of-truth guardrail. The alias is unreferenced at this point; T010 wires it. (FR-016, data-model § 5, CL-02)
- [X] T006 Extend `extension/ui/modules/drilldown/reviewer-drilldown.ts` `ReviewerDrilldownOptions` interface (currently `:178-180` with only `reviewersDimension`) with the five Feature-362 additions: `filters?: FilterState`, `repositoriesDimension?: readonly PrUrlRepositoryEntry[] | null | undefined`, `webContext?: PrUrlWebContext`, `authorsDimension?: readonly AuthorEntry[] | null | undefined`, `commentsMetricsAvailable?: boolean`. Add the four new type imports (`FilterState`, `PrUrlRepositoryEntry`, `PrUrlWebContext`, `AuthorEntry`) from their existing locations: `../filters`, `../shared/pr-url`, `../../schemas/dimensions.schema`. Strict typing — no `Any`. Update the JSDoc comment to point to `data-model.md` § 4 for field semantics. (FR-001 plumbing, QG-40, data-model § 4)
- [X] T007 Update the reviewer install call site in `extension/ui/dashboard.ts` (search for `installReviewerDrilldown` to locate the existing 2-or-3-arg call) to pass the same options bag the throughput + cycle-time installs construct. Mechanical mirroring — copy the same `filters`, `repositoriesDimension`, `webContext`, `authorsDimension`, `commentsMetricsAvailable` field expressions verbatim from the cycle-time call site (#361 already constructs them). The existing `reviewersDimension` field is preserved unchanged. The `loader?.getCapabilityState?.()` chain is already implemented on both `DatasetLoader` and `AuthenticatedDatasetLoader` (verified — used by throughput + cycle-time + comments-coverage banner). (FR-001 plumbing, contract `reviewer-pr-list.md` § 1, memory: IDatasetLoader optional-method parity)
- [X] T008 Verify Phase 2 introduces no behavioral regression: run `cd extension && pnpm test --testPathPatterns=reviewer-drilldown` (focus on the existing 859-line reviewer suite). All existing reviewer tests MUST pass without modification — the optional default `options: ReviewerDrilldownOptions = {}` keeps two-arg and `{ reviewersDimension: ... }` invocations working. Run `pnpm run build:check` (`tsc --noEmit`) and `pnpm run lint:tests`. Run `python -m pytest tests/unit/` to confirm no Python regression. Zero type errors and zero new lint warnings. No commits at task-level. (FR-018, QG-17, QG-18)

**Checkpoint**: Foundation ready — `installReviewerDrilldown` accepts options, dashboard passes them, the producer-side TypedDict / interface / constant alias are scaffolded, and existing behavior is unchanged. User-story phases can now proceed.

---

## Phase 3: User Story 1 — See which PRs a reviewer actually reviewed (Priority: P1) 🎯 MVP

**Goal**: Filter to one reviewer; click their bar row in the reviewer-activity chart; the side panel renders a list of PRs that reviewer reviewed in the period — slowest first, click-through to ADO. The entire user-visible value of #362.

**Independent Test**: Filter the dashboard to a single reviewer with at least one qualified review in the period (private-tenant build). Click any bar row for that reviewer. Verify a list of PRs appears in the side panel below the existing "Weekly activity" table, with the highest cycle times at the top, and that clicking any row opens that PR in Azure DevOps in a new tab.

### Producer implementation for User Story 1

- [X] T009 [US1] Extend `_generate_reviewer_slice` (`src/ado_git_repo_insights/transform/aggregators.py:2139-2201`) to compute the per-(reviewer, week) `prs[]` slice. Inside the `for reviewer_id, reviewer_group in reviewer_prs.groupby("reviewer_id")` loop (line `:2170`), AFTER the existing `outcome_group` filter (`:2177-2179`) and `reviewed_prs` count (`:2181`) AND inside the existing `if reviewed_prs == 0: continue` guard (`:2182-2183`): collect the qualifying `pull_request_uid` set from `outcome_group`; join back to the per-PR fields the existing per-week `prs[]` emission pipeline already builds (re-use the same per-PR DataFrame the per-week emission at `:850-872` builds from `df` at `:613-624`); sort by `(-cycle_time_minutes, pull_request_id)` BEFORE truncation; head to `_PR_DETAIL_CAP_PER_REVIEWER_WEEK` (the alias added at T005); detect truncation at the pre-truncation length (`pre_truncation_count > _PR_DETAIL_CAP_PER_REVIEWER_WEEK`); serialize each surviving record into a `PrRecord` dict (5 locked fields + 3 capability-310 fields when capability is on, matching the existing `_PR_DETAIL_CAP` per-week emission pattern at `:850-900` for the 5+3 shape). (FR-016, contract `per-reviewer-week-prs.md` §§ 1-5, data-model § 2)
- [X] T010 [US1] Extend the `_generate_reviewer_slice` emission dict (currently `:2191-2199`) to include the new trio under the existing `repositories_count` field. The atomicity invariant is enforced by ALWAYS emitting all three together: `"prs": <list>`, `"_prs_truncated": <bool>`, `"_prs_cap": _PR_DETAIL_CAP_PER_REVIEWER_WEEK`. Capability-310 fields (`thread_count`, `comment_count`, `active_thread_count`) are included on each `PrRecord` when the existing capability is on, omitted when off — match the per-week emission pattern. (FR-016, contract `per-reviewer-week-prs.md` § 1)

### Consumer implementation for User Story 1

- [X] T011 [US1] Add the `buildPrListSection(rollups, reviewerId, options)` helper function in `extension/ui/modules/drilldown/reviewer-drilldown.ts`, structurally mirroring `cycle-time-drilldown.ts:107-156`. The signature differs from cycle-time's because the reviewer surface unions per-(reviewer, week) slices across the active period rather than reading one week's `rollup.prs`. Logic: (a) read `options.filters` (defaulting to `createEmptyFilterState()` when absent); (b) call `classifyFilterState({...filters, reviewers: []}, false)` — the reviewer-stripping wrapper per FR-008; (c) switch on `classification` and emit the appropriate `PrListSection` variant — `team` → `{ contentState: "team-inline" }`, `supported` → either `{ contentState: "supported-empty" }` (when the union of per-(reviewer, week) `prs[]` slices is empty OR `!webContext` OR any participating week's `_prs_cap` is missing) or `{ contentState: "pr-list", rows, renderedCount, actualFilteredCount, capValue, commentsMetricsAvailable }`; the `reviewer` branch is unreachable by construction (FR-008). Union construction: iterate `rollups`; for each rollup, read `rollup.by_reviewer?.[reviewerId]?.prs ?? []` and concatenate; sort the union by `cycle_time desc, id asc`; apply author/repo overlay filter from `options.filters` if present. Row construction MUST match throughput's pattern at `throughput-drilldown.ts:155-173` byte-for-byte (capability-off omits `threadCount` / `commentCount` / `activeThreadCount` entirely; capability-on attaches them via `pr.thread_count` / `pr.comment_count` / `pr.active_thread_count`). Add the new imports at the top of the file: `createEmptyFilterState`, `FilterState` from `../filters`; `isPartialPrRow`, `makePrListSection`, `PrListRow`, `PrListSection` from `../shared/detail-panel`; `resolvePrUrl`, `PrUrlRepositoryEntry`, `PrUrlWebContext` from `../shared/pr-url`; `AuthorEntry` from `../../schemas/dimensions.schema`; `classifyFilterState` from `./filter-support`. (FR-001, FR-002, FR-003, FR-005, FR-006, FR-007, FR-008, FR-010, FR-011, contract `reviewer-pr-list.md` §§ 3-7)
- [X] T012 [US1] Wire `buildPrListSection` into `buildPanelContent` at `reviewer-drilldown.ts:150-162`. The new section MUST be appended AFTER the existing `buildWeeklyTable(rollups, reviewerId)` call (currently at line 160), so the panel section order becomes: stat row → weekly activity table (or its empty-state branch) → PR list. The function signature changes to `buildPanelContent(rollups, reviewerId, reviewerNameByKey, options)` so `options` is threaded through; update the single call site inside `activate()` (line 245) to pass `options`. (FR-001, FR-002, FR-014, contract `reviewer-pr-list.md` § 2)

### Producer tests for User Story 1

- [X] T013 [P] [US1] Create `tests/unit/test_aggregators_reviewer_pr_detail.py`. Test the basic emission shape: a synthetic week with 3 reviewers and 5 PRs (each PR reviewed by 2 reviewers, deterministic cycle-times) produces `by_reviewer[*]` entries each carrying `prs` (sorted `cycle_time desc, id asc`), `_prs_truncated: false`, `_prs_cap: 500`. Assert `len(prs) == reviewed_prs` for each reviewer (non-truncation coherence per contract § 7). Assert atomicity: every reviewer entry has all three fields together, never one without the others. (FR-016, contract `per-reviewer-week-prs.md` §§ 1-7)
- [X] T014 [P] [US1] Add a duplication-invariant test to `test_aggregators_reviewer_pr_detail.py`: with N=3 reviewers each reviewing all K=4 PRs in a fixture week, assert `sum(len(by_reviewer[r].prs) for r in reviewers) == N * K` (a PR reviewed by N reviewers appears in N per-(reviewer, week) entries; this is the byte-cost trade-off acknowledged in CL-01). (FR-016, contract `per-reviewer-week-prs.md` § 7)

### Consumer tests for User Story 1

- [X] T015 [US1] Add a test in `extension/tests/modules/drilldown/reviewer-drilldown.test.ts` named `"renders a PR list section under the supported filter classification with reviewer-only filter active"` — installs with a fixture rollup carrying non-empty per-(reviewer, week) `prs[]` for the focused reviewer AND a populated options bag (`filters: { reviewers: [REVIEWER_ID], teams: [], authors: [], repos: [] }`, `repositoriesDimension: [...]`, `webContext: {...}`, `commentsMetricsAvailable: false`), simulates a click on the focused reviewer's row, and asserts the panel contains a section with the PR list selector AND the section's content-state marker is `pr-list`. (FR-001, FR-008, US1 acceptance scenario 1)
- [X] T016 [US1] Add a test named `"renders panel sections in stat-row → weekly-table → pr-list order"` — installs with the same supported-state fixture, clicks the row, queries the panel for the three sections in document order, and asserts the third section is the PR list. Pin the relative ordering so a future reorder regression fires immediately. (FR-002)
- [X] T017 [P] [US1] Create a new test file `extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts`. Seed a fixture rollup set with multiple weeks each carrying per-(reviewer, week) `prs[]` for the focused reviewer (cycle-times spread across weeks so the cross-week union has a non-trivial order — e.g., week W10 has [60min, 30min] and week W11 has [45min, 25min] ⇒ union sorted should be [60, 45, 30, 25]). Drive the install + click; assert the rendered `<li>` (or equivalent row element) sequence in the panel preserves `cycle_time desc, id asc` order. The assertion MUST inspect the rendered DOM, not the input array. Cover at least: (a) two rows with different cycle times — slower first; (b) two rows with the same cycle time and different ids — lower id first; (c) cross-week ordering (rows from two different participating weeks unioned and sorted). (FR-019, contract `reviewer-pr-list.md` § 8)
- [X] T018 [US1] Add a test named `"PR row click opens the URL in a new browser tab and does not disturb panel state"` to `reviewer-drilldown.test.ts`. With the panel open and PR list rendered, simulate a click on the first row and assert: (a) `window.open` (or the equivalent target=\_blank anchor) was called with the URL composed by `resolvePrUrl(...)`; (b) the panel's `is-open` class is still present; (c) no new dismiss event fires. (FR-004, US1 acceptance scenario 3)
- [X] T019 [US1] Add a test named `"reviewer-filter change between two reviewers re-opens the panel with the new reviewer's PR list"` to `reviewer-drilldown.test.ts`. Open the panel via reviewer X's row, capture the rendered PR row sequence; change the reviewer filter to reviewer Y; the chart re-renders for Y; click Y's row; assert the rendered PR row sequence is reviewer Y's set, not stale rows from X. This validates FR-014 + the existing panel-dismiss-on-filter-change lifecycle (which is preserved unchanged). (FR-014, US1 acceptance scenario 2)
- [X] T020 [P] [US1] Create a new test file `extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts`. Two assertions: (a) under a supported state with a reviewer participating in 3 weeks (each contributing K_i records with `_prs_truncated: false`), the rendered row count equals `sum(K_i)`; (b) under a supported state with at least one truncated week (`_prs_truncated: true`, `_prs_cap: 500`, that week's `len(prs) == 500`), the rendered row count equals `sum(min(K_i, 500))` (i.e., the cap-bounded slice union) AND the truncation cue is present in the rendered output. Use the fixture-builder pattern the throughput equivalent uses. (FR-008, FR-010, contract `reviewer-pr-list.md` § 12)

**Checkpoint**: User Story 1 is fully functional — clicking any reviewer row with a single reviewer filter, no team filter, no comparison gate, on private-tenant data renders the PR list with correct cross-week ordering, click-through, and reviewer-change reload. This is the MVP. Stop here and demo if needed.

---

## Phase 4: User Story 2 — Sensible behavior under filter overlays (Priority: P2)

**Goal**: Filter overlay awareness — applying a team filter on top of the reviewer filter replaces the PR list with the team-inline message; author/repo overlays render the PR list with intersection; comparison mode preserves the existing toast denial.

**Independent Test**: With a reviewer filter active, apply a team filter on top, click the row. Verify the panel shows the `team-inline` "clear the team filter" message. Repeat with author and repository filters and verify the PR list renders with intersection. Toggle comparison mode and verify the toast denial.

**Note**: implementation is already covered by T011 (the `buildPrListSection` helper handles all three reachable classifications via the reviewer-stripping wrapper). This phase adds the regression-lock tests.

### Tests for User Story 2

- [X] T021 [US2] Add a test named `"team-filter overlay renders the team-inline message and not the PR list"` to `reviewer-drilldown.test.ts`. Install with `filters: { reviewers: [REVIEWER_ID], teams: ["t1"], authors: [], repos: [] }` and a rollup that would otherwise render a PR list. Assert: (a) the panel contains the PR list section; (b) the section's content-state marker indicates `team-inline`; (c) no `<li>` row elements are rendered; (d) the inline message text MATCHES the message rendered by the throughput drill-down under the same filter shape (use a snapshot import or text-match against a shared string constant if the throughput tests expose one; otherwise assert the exact text from the message renderer). (FR-006, SC-004a, US2 acceptance scenario 1, contract `reviewer-pr-list.md` § 3)
- [X] T022 [US2] Add a test named `"reviewer-only filter (no team overlay) renders the PR list — reviewer-stripping wrapper exercise"` to `reviewer-drilldown.test.ts`. Install with `filters: { reviewers: [REVIEWER_ID], teams: [], authors: [], repos: [] }` and assert the PR list renders with the `pr-list` content state. This locks the reviewer-stripping wrapper — without the wrapper, classifyFilterState would return `"reviewer"` and the PR list would never show. (FR-007, FR-008, contract `reviewer-pr-list.md` § 3)
- [X] T023 [US2] Add a test named `"reviewer + author overlay renders the PR list with author intersection"` to `reviewer-drilldown.test.ts`. Install with `filters: { reviewers: [REVIEWER_ID], teams: [], authors: ["author-a"], repos: [] }` and a fixture where the focused reviewer's per-(reviewer, week) `prs[]` includes PRs by `author-a` AND other authors. Assert the rendered PR list includes ONLY the `author-a` PRs, sorted `cycle_time desc, id asc`. (FR-007, US2 acceptance scenario 2)
- [X] T024 [US2] Add a test named `"reviewer + repo overlay renders the PR list with repo intersection"` to `reviewer-drilldown.test.ts`, mirroring T023 with `filters.repos: ["repo-x"]` instead of `filters.authors`. Assert intersection. (FR-007, US2 acceptance scenario 3)
- [X] T025 [US2] Add a test named `"reviewer + author + repo overlay renders the PR list with three-way intersection"` to `reviewer-drilldown.test.ts`. Install with all three filters set + the reviewer; assert the rendered PR list shows ONLY rows matching all three constraints. (FR-007, US2 acceptance scenario 4)
- [X] T026 [US2] Add a test named `"comparison mode active denies the panel and fires the existing toast on reviewer-row click"` to `reviewer-drilldown.test.ts`. Set `isDrilldownDisabledByComparison()` to return true (via the existing test-side comparison-state setter the throughput / cycle-time / existing reviewer tests already use), simulate a click on a reviewer row, and assert: (a) `openDetailPanel` was NOT called; (b) `showComparisonAdvisoryToast` WAS called with the trigger element; (c) no panel `is-open` class is added; (d) the PR list section is therefore NOT rendered. This is a regression-lock for existing behavior — the comparison short-circuit at `reviewer-drilldown.ts:232-235` is unchanged by this feature. The existing test at `reviewer-drilldown.test.ts:492-502` covers the toast routing; this new test additionally locks the PR-list-NOT-rendered consequence. (FR-009, SC-004c, US2 acceptance scenario 5, contract `reviewer-pr-list.md` § 13)

**Checkpoint**: User Story 2 verified — all three reachable filter overlays produce the correct panel state. The reviewer-stripping wrapper at FR-008 is exercise-locked by T022. Combined with US1, the panel is fully overlay-aware.

---

## Phase 5: User Story 3 — Honest signaling for high-volume and unavailable-data states (Priority: P3)

**Goal**: Honest signaling — when any participating week's per-(reviewer, week) `prs[]` is truncated, the user sees the same cue throughput shows; when per-PR detail is unavailable for the reviewer (zero qualifying PRs, no `webContext`, malformed cap marker), the user sees the same `supported-empty` message.

**Independent Test**: Construct (or seed via fixture) a reviewer-week with `_prs_truncated: true`, click the row, verify the truncation cue. Construct a reviewer with zero qualifying PRs in the period, verify the `supported-empty` message. Construct a fixture with `webContext` undefined, verify the same `supported-empty` message.

**Note**: implementation is already covered by T011. This phase adds the data-state regression-lock tests AND the producer-side cap-boundary regression at 500/501 (FR-029).

### Producer test for User Story 3 (the regression lock)

- [X] T027 [P] [US3] Add the cap-boundary regression test at FR-029 to `tests/unit/test_aggregators_reviewer_pr_detail.py`. Two sub-tests: (a) **at exactly 500 PRs**: construct a synthetic week where the focused reviewer has exactly 500 qualifying votes (deterministic cycle-times, e.g. evenly spaced from 100.0 to 599.0 minutes); assert the emitted entry has `_prs_cap == 500`, `_prs_truncated == false`, `len(prs) == 500`, and the slice contains all 500 records sorted `cycle_time desc, id asc`. (b) **at exactly 501 PRs**: add one more record with `cycle_time_minutes = 50.0` (the fastest); assert the emitted entry has `_prs_cap == 500`, `_prs_truncated == true`, `len(prs) == 500`, the slice contains the 500 records with the highest `cycle_time` (with `id` ascending tiebreak), AND the dropped record is the fastest one (the 50.0 record). This locks the sort-before-truncate semantic; without it the test fails. (FR-029, contract `per-reviewer-week-prs.md` § 6, CL-02 guardrail #4)
- [X] T028 [P] [US3] Add a `prs.length == _prs_cap` invariant test to `test_aggregators_reviewer_pr_detail.py` for the truncation case (built on the T027 fixture): assert the emitted slice's length equals `_prs_cap` exactly under truncation. (FR-016, contract `per-reviewer-week-prs.md` § 7)
- [X] T029 [P] [US3] Add a `_prs_cap` always-present-when-`prs`-present atomicity test to `test_aggregators_reviewer_pr_detail.py`: assert that for every reviewer entry where `prs` is present, `_prs_cap` and `_prs_truncated` are also present. (FR-016 atomicity, contract `per-reviewer-week-prs.md` § 5)

### Consumer tests for User Story 3

- [X] T030 [US3] Add a test named `"truncation cue renders when any participating week is truncated"` to `reviewer-drilldown.test.ts`. Seed a fixture where the focused reviewer participates in 3 weeks: week W10 has `_prs_truncated: false` with 30 PRs; week W11 has `_prs_truncated: true` with 500 PRs; week W12 has `_prs_truncated: false` with 20 PRs. Assert: (a) the panel renders the PR list; (b) the truncation cue text is present in the rendered output; (c) the cue text MATCHES throughput's truncation cue under the same condition. (FR-010, SC-006, US3 acceptance scenario 1, contract `reviewer-pr-list.md` § 6)
- [X] T031 [US3] Add a test named `"supported-empty renders for a reviewer with zero qualifying PRs in the period"` to `reviewer-drilldown.test.ts`. Seed a fixture where the focused reviewer has no `by_reviewer` entry in any rollup (or all `by_reviewer` entries have empty `prs[]` — note the existing `if reviewed_prs == 0: continue` at `aggregators.py:2182-2183` means in practice the reviewer entry is omitted entirely; this test exercises the consumer's handling of that). Assert the section renders the `supported-empty` content state and that the rendered message is verbally distinct from the team-inline message (text inequality assertion). (FR-011, SC-004b, US3 acceptance scenario 2, contract `reviewer-pr-list.md` § 3)
- [X] T032 [US3] Add a test named `"supported-empty renders when webContext is absent"` to `reviewer-drilldown.test.ts`. Seed a fixture with non-empty per-(reviewer, week) `prs[]` arrays but install with `options.webContext: undefined`. Assert the section renders the `supported-empty` content state — proving URL-composer absence triggers the empty state, not a half-built list. (FR-011, SC-004b, US3 acceptance scenario 3, contract `reviewer-pr-list.md` § 3)
- [X] T033 [US3] Add a test named `"supported-empty renders when any participating week's _prs_cap is missing from the rollup"` to `reviewer-drilldown.test.ts`. Seed a fixture where the focused reviewer participates in 2 weeks but week W10's `by_reviewer[reviewerId]` entry is missing `_prs_cap` (a malformed-rollup case the validator warns on but does not reject — see T003). Assert the section renders the `supported-empty` content state. (FR-011, SC-004b, contract `reviewer-pr-list.md` § 3)
- [X] T034 [US3] Add a test named `"current published demo dataset renders supported-empty for the reviewer drill-down PR list"` to `reviewer-drilldown.test.ts`. Use the published demo rollup as a fixture (read directly from `docs/data/aggregates/weekly_rollups/2025-W28.json` via a test-side `JSON.parse(readFileSync(...))`), install with the demo's expected options shape AND a reviewer filter set to a reviewer that DOES exist in the demo's `by_reviewer` map, click the row, and assert the panel renders the `supported-empty` content state — because the public demo strips per-(reviewer, week) `prs[]` per FR-022 + FR-028. This pins the demo behavior under the strip-helper extension. (FR-022, US3 demo verification — see quickstart.md § 5d)

**Checkpoint**: User Story 3 verified — truncation, three flavors of supported-empty, the cap-boundary regression at 500/501, and the public-demo strip behavior all behave correctly. Combined with US1 and US2, the feature is functionally complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Capability-off DOM byte-identity, accessibility, keyboard, strip-helper extension + coverage, demo-generator parallel-path, 310 spread-guard ALLOWED_MODULES, BOTH test floors bumped, byte-budget report, final preflight verification. **All Phase 6 changes MUST be staged in the SAME commit as the Phase 2-5 changes** (per-commit ratchet — both `extension.min_collected` AND `python.min_collected` deltas must equal the test counts added in the commit; no Extension marker waiver; Python `[ratchet-realignment]` requires explicit user authorization).

### Capability-off DOM lock (FR-026)

- [X] T035 [P] Create `extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts`, mirroring `extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts` for throughput AND `cycle-time-pr-list-capability-off-baseline.test.ts` for cycle-time. Install the reviewer drill-down against a fixture rollup with `commentsMetricsAvailable: false` and non-empty per-(reviewer, week) `prs[]` arrays for the focused reviewer, render the panel, and compare the resulting `<section data-section="pr-list">` (or equivalent stable selector) innerHTML byte-for-byte against a committed baseline file at `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html`. The baseline file MUST be created by the implementer in the same commit, generated from a known fixture and verified to match the post-implementation render. (FR-026, contract `reviewer-pr-list.md` § 11)

### Accessibility & keyboard (FR-012, FR-013)

- [X] T036 Add a test named `"PR list section accessible name is identical across pr-list, supported-empty, team-inline"` to `reviewer-drilldown.test.ts` (placed under a dedicated `describe("accessible name stability across content states", ...)` block). For each of the three reachable content states: drive the install, render the panel, query the section element, read its accessible name (via `aria-label`, or `aria-labelledby` + the referenced element's text content, or the element's first descendant heading). Assert all three computed accessible names are equal. The assertion MUST run against the reviewer-rendered DOM. (FR-012, SC-005, contract `reviewer-pr-list.md` § 9)
- [X] T037 Add a test named `"keyboard Enter on a focused reviewer row opens the panel with the PR list"` to `reviewer-drilldown.test.ts`. Render the chart with a reviewer filter active, focus a reviewer's bar row via `.focus()`, dispatch a `KeyboardEvent("keydown", { key: "Enter", bubbles: true })`, and assert: (a) the panel opens (`is-open` class on the panel root); (b) the PR list section is rendered with `pr-list` content state. The existing `reviewer-drilldown.test.ts:508-538` test covers the keyboard event handler routing; this new test additionally locks the PR list rendering consequence. Add a parallel sub-test for `key: " "` (Space) that additionally asserts `event.preventDefault()` was called. (FR-013, SC-005, contract `reviewer-pr-list.md` § 10)
- [X] T038 Add a test named `"PR list rows are reachable via Tab in DOM order inside the reviewer panel"` to `reviewer-drilldown.test.ts`. With the panel open and the PR list rendered (3+ rows in the fixture), assert each row element is focusable (`tabindex` attribute or natively focusable via `<a>` / `<button>`) and that Tab traversal — simulated via successive `.focus()` calls following DOM order — visits the rows first-to-last. (FR-013, SC-005, contract `reviewer-pr-list.md` § 10)

### Strip-helper extension + coverage test (FR-028)

- [X] T039 Extend `scripts/strip_pr_arrays.py` `_strip_one` (currently `:85-96`) and `_verify_clean` (currently `:99-102`) per the FR-028 codified extension in `contracts/per-reviewer-week-prs.md` § 8. Smallest-possible patch: after the existing rollup-root strip loop, additionally walk `payload.get("by_reviewer", {})` and pop the same `PR_LEVEL_FIELDS` from each value. Mirror the verification logic in `_verify_clean`. The `PR_LEVEL_FIELDS` constant (`:26-27`) is reused unchanged. Type-precise: `dict[str, object]` matches `_load_rollup`'s return type; no `Any` introduced. (FR-028, contract `per-reviewer-week-prs.md` § 8)
- [X] T040 [P] Create `tests/unit/test_strip_pr_arrays_reviewer_nested.py`. Three tests: (a) **top-level strip preserved**: a rollup fixture with rollup-root `prs` / `_prs_truncated` / `_prs_cap` AND empty `by_reviewer` has all rollup-root fields removed by `_strip_one`; (b) **nested strip works**: a rollup fixture with rollup-root fields AND `by_reviewer[*]` entries carrying the trio has BOTH levels stripped; `_verify_clean` returns empty list; (c) **residue-on-incomplete-walk fails-loud**: monkey-patch `_strip_one` to NOT walk into `by_reviewer[*]` (simulating a regression). `strip_pr_arrays_from_rollups` MUST raise `PrArrayResidueError` referencing the per-(reviewer, week) residue path. (FR-028, contract `per-reviewer-week-prs.md` § 8)

### Demo-generator parallel-path (FR-023)

- [X] T041 Extend `scripts/generate-demo-data.py` `_generate_reviewer_breakdown` (currently `:1764-...`) to populate the new per-(reviewer, week) `prs[]` field on each `ReviewerSliceMetrics` entry. Source the PR records by selecting from the demo's per-week synthesized PR set, scoped to the reviewer's allocated `reviewed_prs` count, sorted `cycle_time desc, id asc`, with `_prs_truncated: false` and `_prs_cap: 500` (demo seeds are bounded well below 500, so demo never exhibits truncation). The function signature does not change; the new field is added to the dict literal that constructs each entry. (FR-023, contract `per-reviewer-week-prs.md` § 9)
- [X] T042 [P] Create `tests/unit/test_demo_generator_reviewer_pr_detail.py`. Run the demo generator on a deterministic seed; assert: (a) every `by_reviewer[*]` entry has `prs`, `_prs_truncated: false`, `_prs_cap: 500`; (b) the demo's per-(reviewer, week) `prs[]` is sorted `cycle_time desc, id asc`; (c) `len(prs) == reviewed_prs` for every entry (demo never truncates, so coherence holds always); (d) the duplication invariant: a PR reviewed by N reviewers in the demo appears in N per-(reviewer, week) entries. (FR-023, contract `per-reviewer-week-prs.md` § 9)

### 310 spread-guard ALLOWED_MODULES (FR-027)

- [X] T043 Extend the `ALLOWED_MODULES` Set in `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts:32-47` to add `"reviewer-drilldown.ts"` as the third entry. Match the existing 361 entry's comment block pattern at `:38-46`: include a paragraph-comment block above the new entry citing FR-005 + contract `reviewer-pr-list.md` § 14 as authorization, noting that the reviewer consumer reuses the shared `PrListSection` discriminated union and the shared renderer, and that this allowlist entry is the 310-spread-guard's acknowledgement of 362's authorized scope expansion. The forbidden-identifiers list at `:61-71` and the `COMMENTS_METRICS_AVAILABLE_TRUTHY_PATTERN` regex at `:73-74` MUST stay unchanged. The spread-guard's existing assertion at `:100-102` ("every allowlist entry MUST correspond to a real file") will pass because `reviewer-drilldown.ts` is present in the directory. (FR-027, contract `reviewer-pr-list.md` § 14)

### Test-floor bump (FR-020 / QG-43, both dimensions)

- [X] T044 Run `cd extension && pnpm test:coverage` to produce `extension/test-results.xml` (the JUnit artifact). Run `python scripts/run_pytest.py` (the project's coverage-safe launcher) to produce the Python JUnit artifact at the project's standard path. Verify both artifacts via `python scripts/check_test_floor_contract.py --contract .test-floor-contract.json --extension-junit extension/test-results.xml --python-junit <pytest-junit-path>`. (FR-020, SC-010)
- [X] T045 Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml --junit-python <pytest-junit-path>`. The output reports `actual=N_extension` AND `actual=N_python`. Update `.test-floor-contract.json`: set `extension.min_collected = N_extension` AND `python.min_collected = N_python`. Re-run the ratchet-bump command to confirm exit 0 and zero drift on BOTH dimensions. **All Phase 2-6 source changes + new tests + new fixture + this floor bump MUST be in the same git commit** — the per-commit ratchet enforces `floor_delta == actual_delta` per first-parent walk on both dimensions. There is no `[ratchet-realignment]` waiver for Extension drift; the Python `[ratchet-realignment]` marker is forbidden by default per FR-021 (requires explicit user authorization recorded before the commit). (FR-020, FR-021, SC-010, QG-43, QG-44)

### Cross-surface gate confirmations (no-op verifications)

- [X] T046 Confirm the cross-surface PR-record schema-parity gate is green: `python scripts/check_pr_record_schema_parity.py` returns exit 0. This MUST pass by no-op because no PrRecord field is added or removed under Option A; failure indicates an unexpected schema-surface drift. (SC-011, FR-017, FR-025, QG-49)
- [X] T047 Confirm zero suppression delta: `python scripts/audit-suppressions.py --diff` reports zero drift across every scope (`typescript-extension`, `typescript-tests`, Python scopes). `.suppression-baseline.json` stays at total=0. (QG-41)
- [X] T048 Confirm zero `typing.Any` delta: `python scripts/check_no_any_types.py src/ tests/ scripts/` returns exit 0. No new Python `Any` types; the new TypeScript code uses `any` nowhere (verified by ESLint). (QG-40)
- [X] T049 Confirm the privacy-posture ordering gate is green: `python -m pytest tests/unit/test_privacy_posture_ordering.py` returns exit 0. This passes by no-op per FR-022 + SC-012 — the existing anchor at `docs/reference/dataset-contract.md:100` and the producer-code-emitting-prs check both remain true. (FR-022, SC-012)
- [X] T050 Confirm the 4-entry-point parity invariant: run the relevant parity test (the existing `tests/...` test invoked by `run_pr_preflight.py`'s parity CommandSpec). Stays green by no-op per FR-024 + SC-013 — no new IDatasetLoader optional-method added. (FR-024, SC-013)

### SC-014 byte-budget report

- [X] T051 Generate the SC-014 byte-budget before/after fixture-size report. Step 1: identify a representative ~26-week private-tenant fixture (e.g., the `artifacts/demo-enterprise/data/aggregates/weekly_rollups/` build from a fresh `python scripts/build-demo-dataset.py` BEFORE T009/T010 land — this requires checking out the pre-T009 state; OR use a checked-in fixture path; OR build at the implementation-commit's parent commit). Measure the total byte size via `python -c "from pathlib import Path; print(sum(p.stat().st_size for p in Path('<fixture>').glob('*.json')))"`. Step 2: with T009-T012 applied, regenerate the same fixture; measure again. Step 3: write the report into the implementation commit message body (or alternatively into a follow-up artifact at `specs/362-reviewer-pr-drilldown/byte-budget-report.md`) with the format documented in `quickstart.md` § 9: fixture path, period (26 weeks), before-bytes, after-bytes, absolute delta, relative delta, per-week average growth. (SC-014, CL-01 guardrail #5)

### Final preflight

- [ ] T052 Run the authoritative local preflight: `python scripts/run_pr_preflight.py` — MUST return exit 0 with no `--allow-local-degraded` flag. Every CommandSpec passes: mypy on `src/ tests/ scripts/ .github/scripts/`, ruff check + format, pytest with coverage, Extension Jest CI (with the new tests), Extension type tests, Extension smoke (Playwright), PR-record schema parity (green by no-op), privacy-posture ordering (green by no-op), generated-artifact parity, test-floor contract validation (BOTH dimensions), ratchet-bump guard (BOTH dimensions), coverage-delta gate, gitleaks secret scan, suppression baseline gates (zero), CLI-reference drift, and every other CommandSpec. (SC-007, FR-020, VR-29)

### End-to-end verification

- [ ] T053 Run the `quickstart.md` walkthrough end-to-end. **Producer side**: run `python -m pytest tests/unit/test_aggregators_reviewer_pr_detail.py tests/unit/test_strip_pr_arrays_reviewer_nested.py tests/unit/test_demo_generator_reviewer_pr_detail.py -v` and confirm all pass. Run `python scripts/build-demo-dataset.py` and confirm the demo build succeeds. Run the post-build strip-verification script from `quickstart.md` § 1 and confirm the public artifact's `by_reviewer[*]` entries do NOT carry `prs` / `_prs_truncated` / `_prs_cap`. **Consumer side**: `pnpm run serve:docs`; exercise every spec acceptance scenario (US1 reviewer-row click on private-tenant data + row click; US2 team / author / repo overlays + comparison; US3 truncation via fixture + supported-empty via fixture + demo-side supported-empty rendering). Confirm SC-001 (under 30 seconds to identify reviewer's PRs), SC-002 (exactly two clicks to ADO), SC-005 (screen-reader stable identity), SC-009 (manager-readability). **Also confirm SC-008 by code-review check**: `grep -rE "featureFlag|getFeatureGate|isFeatureEnabled|rolloutGate" extension/ui/modules/drilldown/reviewer-drilldown.ts extension/ui/dashboard.ts src/ado_git_repo_insights/transform/aggregators.py scripts/strip_pr_arrays.py scripts/generate-demo-data.py` MUST return zero hits in the new code, proving the feature ships behind no flag and no rollout gate. (SC-001, SC-002, SC-005, SC-008, SC-009, SC-014, all User Stories)

**Checkpoint**: feature is delivery-ready. Branch is clean except for the new spec dir, source edits (producer + consumer + scripts), new test files, fixture file, and `.test-floor-contract.json` bump on BOTH dimensions — all in one commit, ready for the standard review cycle.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 / T002 are independent of all source changes; can run any time; do not block any later phase.
- **Foundational (Phase 2)**: T003 + T006 are independent (different files — TypeScript schema vs TypeScript drilldown options); T004 depends on T003 conceptually (same atomic emission posture) but they're different files so can be authored in parallel; T005 is independent (Python aggregator constant); T007 depends on T006 (call site reads the extended interface); T008 is the verification gate at the end of Phase 2 — depends on T003 + T004 + T005 + T006 + T007 all being authored.
    - Sequence: (T003 ∥ T004 ∥ T005 ∥ T006) → T007 → T008
    - All MUST complete before Phase 3.
- **User Stories (Phases 3-5)**: All depend on Phase 2 completion.
    - **US1 (P1)**: T009 → T010 (sequential — same file aggregators.py); T011 → T012 (sequential — same file reviewer-drilldown.ts); T013 / T014 [P] amongst themselves once T009 + T010 land; T017 / T020 [P] amongst themselves once T011 + T012 land; T015 / T016 / T018 / T019 sequential within reviewer-drilldown.test.ts.
    - **US2 (P2)**: T021 / T022 / T023 / T024 / T025 / T026 sequential within reviewer-drilldown.test.ts; can start as soon as T011 + T012 land.
    - **US3 (P3)**: T027 / T028 / T029 [P] amongst themselves once T009 + T010 land (different test file or different test sections within `test_aggregators_reviewer_pr_detail.py`); T030 / T031 / T032 / T033 / T034 sequential within reviewer-drilldown.test.ts.
- **Polish (Phase 6)**:
    - T035 [P] with US1/US2/US3 once T011 + T012 land.
    - T036 / T037 / T038 sequential within reviewer-drilldown.test.ts (cannot be [P] with US2/US3 sub-tests in the same file).
    - T039 [P] with anything (different file scripts/strip_pr_arrays.py); T040 [P] with T039 (different file tests/unit/test_strip_pr_arrays_reviewer_nested.py).
    - T041 [P] with T039 (different file scripts/generate-demo-data.py); T042 [P] with T041 (different file tests/unit/test_demo_generator_reviewer_pr_detail.py).
    - T043 [P] with anything (different file pr-list-comments-spread-guard.test.ts).
    - T044 → T045 (T045 depends on T044's JUnit artifacts).
    - T046 / T047 / T048 / T049 / T050 [P] amongst themselves (each is an independent gate verification).
    - T051 depends on the producer changes (T009 / T010 / T041) being applied.
    - T052 → T053 (T053 needs the preflight to be green first).

### Within Each User Story

- Single-file tests (in `reviewer-drilldown.test.ts`) are sequential because they share a file.
- Cross-file tests (`reviewer-pr-list-order.test.ts`, `reviewer-pr-list-count-parity.test.ts`, `reviewer-pr-list-capability-off-baseline.test.ts`) are [P] amongst themselves and amongst single-file tests.
- Producer-side tests in `test_aggregators_reviewer_pr_detail.py` can be [P] amongst themselves IF organized as separate test functions; T013 / T014 / T027 / T028 / T029 are all in this single file but address distinct invariants — file-level the writes are sequential, but the tests themselves can run in parallel under pytest's collection.
- Producer-side tests in `test_strip_pr_arrays_reviewer_nested.py` and `test_demo_generator_reviewer_pr_detail.py` are in separate files; [P] with each other.
- All tests for a story must pass before the polish phase verifies the floors.

### Parallel Opportunities

- T003 / T004 / T005 / T006 — four independent foundational scaffolding edits across four files; can be authored in parallel.
- T013 / T014 — basic emission + duplication invariant tests in `test_aggregators_reviewer_pr_detail.py` — [P] (same file, different test functions).
- T017 / T020 / T035 — three new test files under `extension/tests/modules/drilldown/`; [P] with each other.
- T027 / T028 / T029 — cap-boundary regression + atomicity invariants — [P] within `test_aggregators_reviewer_pr_detail.py` test functions.
- T039 / T041 / T043 — three independent file edits (strip helper, demo generator, spread-guard ALLOWED_MODULES) — [P] amongst themselves.
- T040 / T042 — two new producer-side test files — [P] with each other.
- T046 / T047 / T048 / T049 / T050 — five independent gate verification commands — [P] amongst themselves.

---

## Parallel Example: User Story 1

```bash
# After T009 + T010 (producer impl) and T011 + T012 (consumer impl) land, the new-file tests can be authored in parallel:
Task T013 [P]: "Basic emission shape + atomicity in tests/unit/test_aggregators_reviewer_pr_detail.py"
Task T014 [P]: "Duplication invariant in tests/unit/test_aggregators_reviewer_pr_detail.py"
Task T017 [P]: "FR-019 rendered DOM order in extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts"
Task T020 [P]: "Count parity in extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts"

# Meanwhile, the same-file tests must be sequential:
Task T015 → T016 → T018 → T019 in extension/tests/modules/drilldown/reviewer-drilldown.test.ts
```

---

## Implementation Strategy

### Recommended commit plan (simple)

Two commits is the recommended path:

1. **Planning commit** (after `/speckit.analyze` passes): the contents of `specs/362-reviewer-pr-drilldown/` (spec, plan, research, data-model, contracts, quickstart, tasks, checklists) PLUS the CLAUDE.md cleanup. NO source changes. NO test additions. NO floor change. This is the speckit-artifact baseline that downstream phases extend.
2. **Implementation commit**: all of Phases 2 + 3 + 4 + 5 + 6 staged together — producer source edits to `aggregators.py` + `types.py`, consumer source edits to `reviewer-drilldown.ts` + `dashboard.ts` + `rollup.schema.ts`, script edits to `strip_pr_arrays.py` + `generate-demo-data.py`, ALLOWED_MODULES extension to `pr-list-comments-spread-guard.test.ts`, all new tests across 3 new Python files + 3 new TypeScript files + extensions to `reviewer-drilldown.test.ts`, the capability-off baseline fixture, the SC-014 byte-budget report (in commit message body or as a separate artifact), and the `.test-floor-contract.json` BOTH-floors bump. This is the MVP commit — after it lands, every spec acceptance scenario passes.

This is the recommended path because the implementation is cohesive (the producer + consumer + demo + strip changes all serve one user-visible feature) and a single atomic commit makes review and rollback trivial. The producer change alone would create a wire-shape that no consumer reads; the consumer change alone would have no data to render.

### Per-commit ratchet rule (the non-negotiable constraint)

The project's per-commit ratchet (`scripts/check_ratchet_bump.py` + CI's `ratchet-bump-guard` job) walks first-parent history and asserts `floor_delta == test_delta` on every commit individually, on BOTH Python and Extension dimensions. The implication for commit boundaries:

- A commit that adds N_p new pytest tests AND N_e new Jest tests MUST bump `python.min_collected` by N_p AND `extension.min_collected` by N_e in the same commit.
- A commit that adds zero tests on a dimension MUST NOT change that dimension's floor.
- A commit that changes either floor without a matching test delta on that dimension fails the gate.
- The Extension dimension has NO marker waiver. The Python dimension's `[ratchet-realignment]` marker is permitted ONLY with explicit user authorization per FR-021.

Multiple commits are fine as long as each is internally consistent on BOTH dimensions. The "single implementation commit" recommendation above is a convenience choice, not a ratchet requirement.

### Alternative: incremental delivery (allowed but discouraged for this feature)

If a developer prefers to split work, every commit must be self-consistent on BOTH ratchets. For example:

- Commit 1 (planning artifacts only) — no tests, no floor change. Safe.
- Commit 2 (Phase 2 only — types extension + constant alias + dashboard wire-up) — no tests, no floor change. Safe.
- Commit 3 (Phase 3 — producer impl + consumer impl + 8 tests + Python floor +5 + Extension floor +3) — internally consistent. Safe.
- Commit 4 (Phase 4 — 6 tests + Extension floor +6, Python floor unchanged) — internally consistent. Safe.
- Commit 5 (Phase 5 — 8 tests + Python floor +3 + Extension floor +5) — internally consistent. Safe.
- Commit 6 (Phase 6 — 8 tests + Python floor +2 + Extension floor +6 + verification) — internally consistent. Safe.

**This is not recommended for this feature** because the producer + consumer + demo + strip changes are mutually-dependent; splitting them creates intermediate states where the producer emits data the consumer can't render, OR the demo emits sub-arrays the strip helper doesn't remove. Use a single implementation commit unless there is a specific reason to split.

### MVP definition (functional, not commit-bounded)

After the implementation commit (Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6), the feature's MVP is fully delivered:

- **Phase 3 (US1)** delivers the entire user-visible value: clicking any reviewer row with a single reviewer filter on private-tenant data renders the PR list with click-through to ADO. Under team / comparison the user sees the appropriate gating message — because `buildPrListSection` is one cohesive function that handles all reachable classifications (T011 implements all of them at once).
- **Phase 4 (US2)** locks the filter-overlay-classification behavior with regression tests (no impl change).
- **Phase 5 (US3)** locks truncation + supported-empty behavior with regression tests AND adds the producer-side cap-boundary regression at 500/501 (T027 — the FR-029 lock).
- **Phase 6 (Polish)** adds capability-off byte-identity, a11y, keyboard, the strip-helper extension + its coverage assertion (FR-028), demo-generator parallel-path, 310 spread-guard ALLOWED_MODULES extension, BOTH floors bump, byte-budget report, and final preflight.

There is no "shippable Phase 3 alone" intermediate state — the per-commit ratchet requires both floors to bump alongside any test additions, the producer change alone breaks the strip helper coverage (a private-tenant-only emission would leak to public if the strip extension lands separately), and the spec mandates surface-specific tests for FR-012 / FR-013 / FR-026 / FR-028 / FR-029 (which sit in Phases 3 / 5 / 6). So the smallest functionally-complete and verification-complete deliverable is the full implementation commit.

### Parallel Team Strategy

This feature is too small to justify a multi-developer split. One developer carrying it end-to-end is the expected pattern. If two developers are available, one can take the producer side (T009 / T010 / T013 / T014 / T027 / T028 / T029 / T039 / T040 / T041 / T042) and the other can take the consumer side (T011 / T012 / T015 / T016 / T017 / T018 / T019 / T020 / T021 / T022 / T023 / T024 / T025 / T026 / T030 / T031 / T032 / T033 / T034 / T035 / T036 / T037 / T038 / T043). Polish tasks (T044 onwards) coordinate at the end.

---

## Notes

- [P] tasks = different files, no shared file with other in-progress tasks.
- [US#] label maps task to specific user story for traceability.
- Each user story is independently _testable_; Phases 4 / 5 add tests that lock behavior already implemented in Phase 3 (because `buildPrListSection` is cohesive). Independent testability is the speckit invariant; independent commit-ability is not required by this feature.
- The recommended path is one implementation commit with all source + tests + fixture + BOTH floor bumps (Phases 2-6). The per-commit ratchet rule (above) governs any split.
- No marker waivers used by default. `[ratchet-realignment]` on the Python floor is permitted only with explicit user authorization per FR-021.
- Per repo memory (`feedback_run_full_gate_at_head_before_push.md`): run `python scripts/run_pr_preflight.py` at clean HEAD before any `git push` attempt.
- Per repo memory (`feedback_never_push_without_explicit_command.md`): no `git push` is performed by these tasks; the user controls push timing.
- Per repo memory (`feedback_show_plan_before_edits.md`): show the user this tasks.md before any code edit lands; this tasks.md IS the show-plan artifact.
- CLAUDE.md was modified by the speckit.plan workflow's `update-agent-context.ps1` step — already cleaned up per `reference_speckit_plan_claude_md_update.md`: removed duplicate tech-stack lines (no-new-tech feature), kept Recent Changes, fixed SPECKIT pointer to point at `specs/362-reviewer-pr-drilldown/plan.md`. The cleanup is staged with the planning commit.
