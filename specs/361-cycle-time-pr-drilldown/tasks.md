---
description: "Tasks for 361 — Cycle-Time Chart PR-Level Detail (Pass 1 draft)"
---

# Tasks: Cycle-Time Chart PR-Level Detail

**Input**: Design documents from `specs/361-cycle-time-pr-drilldown/`
**Prerequisites**: `plan.md` + `spec.md` (20 FRs, 13 SCs — iteration-2 hardened) + `research.md` + `data-model.md` + `contracts/cycle-time-pr-list.md` + `quickstart.md`. Every task below traces to one or more FR / SC identifiers.

**Tests**: enterprise-coverage mandatory (QG-42); FR-019 / FR-012 / FR-013 / FR-015 each carry an explicit cycle-time-specific consumer-test obligation; FR-020 mandates the floor-bump contract. Tests can be authored before or alongside implementation — they are required by spec, not dictated by TDD ordering.

**Organization**: tasks grouped by user story from `spec.md` (P1 → P2 → P3). Phase 2 (Foundational) lands the install-signature scaffolding so every later phase has a stable extension surface to target. Phase 6 (Polish) carries the test-floor bump and final preflight verification — all tests + code MUST be staged in the SAME commit as the floor bump (per-commit ratchet, no marker waiver for extension drift).

## Format: `- [ ] TXXX [P?] [Story?] Description with file path (FR-XXX, SC-XXX)`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks in the same phase)
- **[US#]**: user-story label (US1 / US2 / US3) — required for story-phase tasks; omitted for Setup, Foundational, and Polish phases
- FR / SC refs in parentheses at the end of each description

## Path Conventions

- Extension UI source: `extension/ui/`
- Extension tests: `extension/tests/`
- Test-floor contract: `.test-floor-contract.json` (repo root)
- Spec & contract docs: `specs/361-cycle-time-pr-drilldown/`

All paths are repository-relative.

## Cross-OS discipline (QG-39)

This feature is TypeScript-only and consumer-only. No shell idioms, no path-style assumptions, no `path.sep` dependence are introduced. Tests use `jsdom` (cross-platform). Tasks that invoke scripts (preflight, ratchet-bump, schema-parity) use the project's standard cross-platform commands as documented in `CONTRIBUTING.md`.

**Note on source-file line numbers**: line-number anchors cited in task descriptions (e.g., `cycle-time-drilldown.ts:84`, `dashboard.ts:1279`, `throughput-drilldown.ts:119`) are planning-time references taken at the start of this branch. They MAY shift as earlier tasks land. Task validity depends on filename plus surrounding function / symbol name; verify positions at implementation time against the current file state.

---

## Phase 1: Setup (Sanity)

**Purpose**: Confirm the branch baseline before any edits — preflight clean, floor recorded.

- [ ] T001 Verify clean local preflight baseline on branch tip: `python scripts/run_pr_preflight.py` returns exit 0 with no `--allow-local-degraded` flag, on a clean working tree. Record the start-of-branch state for SC-007 final comparison. No commits in this phase. (SC-007, QG-29, QG-35, QG-36)
- [ ] T002 Record the current `extension.min_collected` value from `.test-floor-contract.json` and the matching `actual=N` reported by `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` (run after `cd extension && pnpm test:coverage` to produce the JUnit artifact). Confirm they match (parity invariant). The starting value is the baseline against which T029 computes the delta. No commits in this phase. (SC-010, QG-43, QG-44)

---

## Phase 2: Foundational (Backward-Compat Scaffolding)

**Purpose**: Land the install-signature and dashboard call-site changes so every later phase has a stable surface to target. **No behavior change in this phase** — `installCycleTimeDrilldown` continues to render exactly what it does at HEAD when the new options bag is unused, because `buildPanelContent` does not yet read `options`.

**⚠️ CRITICAL**: Phase 2 MUST complete before any Phase 3 task lands. Phase 3 tasks read the foundational scaffolding (interface, signature) — landing them out of order causes type-check failures.

- [ ] T003 Add `CycleTimeDrilldownOptions` interface to `extension/ui/modules/drilldown/cycle-time-drilldown.ts` immediately above the existing `installCycleTimeDrilldown` declaration. Five readonly optional fields, mirroring `ThroughputDrilldownOptions` at `throughput-drilldown.ts:70`: `filters?: FilterState`, `repositoriesDimension?: readonly PrUrlRepositoryEntry[] | null | undefined`, `webContext?: PrUrlWebContext`, `authorsDimension?: readonly AuthorEntry[] | null | undefined`, `commentsMetricsAvailable?: boolean`. Strict typing — no `Any`, no `unknown` widening. Include a JSDoc comment that points to `data-model.md` § 3 for field semantics. Add the four type imports (`FilterState`, `PrUrlRepositoryEntry`, `PrUrlWebContext`, `AuthorEntry`) from their existing locations: `../filters`, `../shared/pr-url`, `../../schemas/dimensions.schema`. (FR-001 plumbing, QG-40, data-model § 3)
- [ ] T004 Update the `installCycleTimeDrilldown` signature in `extension/ui/modules/drilldown/cycle-time-drilldown.ts:99` to accept a third optional argument: `options: CycleTimeDrilldownOptions = {}`. Inside the function body, no behavior change yet — `options` is captured but not yet read by `buildPanelContent`. Existing tests in `extension/tests/modules/drilldown/cycle-time-drilldown.test.ts` MUST continue to pass with no modification (they call the install with two args and the third arg defaults to `{}`). (FR-001, contract § 1)
- [ ] T005 Update the cycle-time install call site in `extension/ui/dashboard.ts:1279-1284` to construct and pass the same options bag the throughput install constructs at `dashboard.ts:1211-1237`. Mechanical mirroring — copy the same `filters`, `repositoriesDimension`, `webContext`, `authorsDimension`, and `commentsMetricsAvailable` field expressions verbatim. Specifically: `filters` is a fresh `{ repos, teams, reviewers, authors }` snapshot of `currentFilters` (spread arrays so the panel sees a stable read); `repositoriesDimension` is the same `currentDimensions?.repositories?.map((r) => ({ repository_id, repository_name, project_name: r.project_name ?? "", organization_name }))` projection; `webContext` is `currentCollectionUri ? { collectionUri: currentCollectionUri } : undefined`; `authorsDimension` is `currentDimensions?.authors`; `commentsMetricsAvailable` is `loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false`. The `loader?.getCapabilityState?.()` chain is already implemented on both `DatasetLoader` and `AuthenticatedDatasetLoader` (verified — used by the throughput install and the comments-coverage banner) so no loader-side change is required. (FR-001 plumbing, contract § 1, memory: IDatasetLoader optional-method parity)
- [ ] T006 Verify Phase 2 introduces no behavioral regression: run `cd extension && pnpm test` (or the more targeted `pnpm test --testPathPatterns=cycle-time` to focus on the existing cycle-time suite). All existing cycle-time tests MUST pass without modification. Run `pnpm run build:check` (`tsc --noEmit`) and `pnpm run lint:tests` to confirm zero type errors and zero new lint warnings. No commits at task-level — Phase 2 changes commit together with later phases per the per-commit ratchet rules. (FR-018, QG-17, QG-18)

**Checkpoint**: Foundation ready — `installCycleTimeDrilldown` accepts options, dashboard passes them, and existing behavior is unchanged. User-story phases can now proceed.

---

## Phase 3: User Story 1 — See the slow PRs behind a slow week (Priority: P1) 🎯 MVP

**Goal**: Clicking a P50 or P90 dot with no filter blocks renders a list of PRs for that week — slowest first, click-through to ADO. The entire user-visible value of #361.

**Independent Test**: Open the dashboard with no filters. Click any P50 or P90 dot on a week with at least one qualified PR. Verify a list of PRs appears in the side panel below the per-repo breakdown, with the highest cycle times at the top, and that clicking any row opens that PR in Azure DevOps in a new tab.

### Implementation for User Story 1

- [ ] T007 [US1] Add the `buildPrListSection(rollup, options)` helper function in `extension/ui/modules/drilldown/cycle-time-drilldown.ts`, structurally mirroring `throughput-drilldown.ts:119-184`. It MUST: (a) read `options.filters` (defaulting to `createEmptyFilterState()` when absent); (b) call `classifyFilterState(filters, false)` to obtain the non-comparison classification; (c) switch on `classification` and emit the appropriate `PrListSection` variant via `makePrListSection(...)` — `team` → `{ contentState: "team-inline" }`, `reviewer` → `{ contentState: "reviewer-inline" }`, `supported` → either `{ contentState: "supported-empty" }` (when `rawPrs.length === 0 || !webContext || capValue === undefined`) or `{ contentState: "pr-list", rows, renderedCount, actualFilteredCount, capValue, commentsMetricsAvailable }`. Row construction MUST match throughput's pattern at `throughput-drilldown.ts:155-173` byte-for-byte (capability-off omits `threadCount` / `commentCount` / `activeThreadCount` entirely; capability-on attaches them). NO re-sort on `rawPrs` — the producer's sort is trusted (FR-019 makes the rendered DOM the contract, not the input array). Add the new imports at the top of the file: `createEmptyFilterState`, `FilterState` from `../filters`; `isPartialPrRow`, `makePrListSection`, `PrListRow`, `PrListSection` from `../shared/detail-panel`; `resolvePrUrl`, `PrUrlRepositoryEntry`, `PrUrlWebContext` from `../shared/pr-url`; `AuthorEntry` from `../../schemas/dimensions.schema`; `classifyFilterState` from `./filter-support`. (FR-001, FR-005, FR-006, FR-007, FR-008, FR-010, FR-011, FR-015, contract §§ 3-7, data-model § 4)
- [ ] T008 [US1] Wire `buildPrListSection` into `buildPanelContent` at `cycle-time-drilldown.ts:84-97`. The new section MUST be appended AFTER the existing `buildRepositoryBreakdown(rollup.by_repository)` call, so the panel section order becomes: stat row → per-repo breakdown → PR list. The function signature changes to `buildPanelContent(rollup, metric, options)` so `options` is threaded through; update the single call site inside `activate()` (line 160) to pass `options`. (FR-001, FR-002, FR-014, contract § 2)

### Tests for User Story 1

- [ ] T009 [US1] Add a test in `extension/tests/modules/drilldown/cycle-time-drilldown.test.ts` named `"renders a PR list section under the supported filter classification"` — installs with a fixture rollup carrying a non-empty `prs` array and a populated options bag (`filters: empty`, `repositoriesDimension: [...]`, `webContext: {...}`, `commentsMetricsAvailable: false`), simulates a click on the P90 dot, and asserts the panel contains a section with `data-section="pr-list"` (or whatever attribute the renderer uses — match throughput's existing tests for the exact selector) AND that the section's `contentState`-derived class or marker is `pr-list`. (FR-001, US1 acceptance scenario 1)
- [ ] T010 [US1] Add a test named `"renders panel sections in stat-row → per-repo-breakdown → pr-list order"` — installs with the same supported-state fixture, clicks the dot, queries the panel for the three sections in document order, and asserts the third section is the PR list. Pin the relative ordering so a future reorder regression fires immediately. (FR-002)
- [ ] T011 [P] [US1] Create a new test file `extension/tests/modules/drilldown/cycle-time-pr-list-order.test.ts`. The test seeds a rollup whose `prs` array order is intentionally NOT `cycle_time desc, id asc` (e.g., randomized or reverse-sorted by `id`), drives the install + click, and asserts the rendered `<li>` (or equivalent row element) sequence in the panel is exactly `cycle_time` descending with `id` ascending as the tiebreak. The assertion MUST inspect the rendered DOM, not the input array. Cover at least: (a) two rows with different cycle times — slower first; (b) two rows with the same cycle time and different ids — lower id first; (c) one row with a NaN/Infinity cycle time excluded by the producer (verify it does not appear at the top via reverse-coercion). (FR-019, contract § 8)
- [ ] T012 [US1] Add a test named `"PR row click opens the URL in a new browser tab and does not disturb panel state"` to `cycle-time-drilldown.test.ts`. With the panel open and PR list rendered, simulate a click on the first row and assert: (a) `window.open` (or the equivalent target=_blank anchor) was called with the URL composed by `resolvePrUrl(...)`; (b) the panel's `is-open` class is still present; (c) no new dismiss event fires. (FR-004, US1 acceptance scenario 3)
- [ ] T013 [US1] Add a test named `"P50 and P90 on the same week share the same PR list set, only the metric headline swaps"` to `cycle-time-drilldown.test.ts`. Open the panel via the P90 dot, capture the rendered PR row sequence, then (without dismissing) click the P50 dot for the same week. Assert: (a) the panel's metric headline updates from "P90" to "P50"; (b) the rendered PR row sequence is byte-identical to the captured P90 sequence; (c) no panel close-then-reopen occurs (test for retarget-in-place via the lifecycle observer not firing the dismiss callback). (FR-005, FR-014, US1 acceptance scenario 2)
- [ ] T014 [P] [US1] Create a new test file `extension/tests/modules/drilldown/cycle-time-pr-list-count-parity.test.ts`, mirroring the pattern at `extension/tests/modules/drilldown/pr-list-count-parity.test.ts`. Two assertions: (a) under a supported state with an un-truncated rollup, the rendered row count equals `rollup.pr_count`; (b) under a supported state with a truncated rollup (`_prs_truncated: true`), the rendered row count equals `rollup.prs.length` (i.e., the cap-bounded slice) AND the rendered row count is strictly less than `rollup.pr_count`. Use the same fixture-builder pattern the throughput equivalent uses — adjust only the install function, the chart trigger, and the section selector. (FR-008, SC-003, contract § 12)

**Checkpoint**: User Story 1 is fully functional — clicking any P50/P90 dot with no filter blocks renders the PR list with correct ordering, click-through, and same-week sharing. This is the MVP. Stop here and demo if needed.

---

## Phase 4: User Story 2 — Sensible behavior under team and reviewer filters (Priority: P2)

**Goal**: Filter awareness — applying a team or reviewer filter replaces the PR list with the appropriate `clear-filter` message; comparison mode preserves the existing toast denial; author/repo filters render the PR list normally.

**Independent Test**: Apply a single team filter, click any cycle-time dot. Verify the panel shows the `team-inline` "clear the team filter" message. Repeat with reviewer filter and comparison mode. Apply author or repo filters and verify the PR list still renders.

**Note**: implementation is already covered by T007 (the `buildPrListSection` helper handles all four classifications). This phase adds the regression-lock tests.

### Tests for User Story 2

- [ ] T015 [US2] Add a test named `"team-only filter renders the team-inline message and not the PR list"` to `cycle-time-drilldown.test.ts`. Install with `filters: { teams: ["t1"], ... }` and a rollup that would otherwise render a PR list. Assert: (a) the panel contains the PR list section; (b) the section's content-state marker indicates `team-inline`; (c) no `<li>` row elements are rendered; (d) the inline message text MATCHES the message rendered by the throughput drill-down under the same filter shape (use a snapshot import or text-match against a shared string constant if the throughput tests expose one; otherwise assert the exact text from the message renderer). (FR-006, SC-004a, US2 acceptance scenario 1, contract § 3)
- [ ] T016 [US2] Add a test named `"reviewer-only filter renders the reviewer-inline message and not the PR list"` to `cycle-time-drilldown.test.ts`, mirroring T015 with `filters: { reviewers: ["r1"], ... }` and asserting the `reviewer-inline` content state + message text parity with throughput. (FR-007, SC-004b, US2 acceptance scenario 2, contract § 3)
- [ ] T017 [US2] Add a test named `"author-only filter, repo-only filter, and author+repo filter all render the PR list"` to `cycle-time-drilldown.test.ts`. Three sub-cases (parametrized): each sets one of the three filter combinations on `options.filters`, leaves `teams` and `reviewers` empty, and asserts the panel renders the `pr-list` content state with at least one row. (FR-008, US2 acceptance scenario 3)
- [ ] T018 [US2] Add a test named `"comparison mode active denies the panel and fires the existing toast"` to `cycle-time-drilldown.test.ts`. Set `isDrilldownDisabledByComparison()` to return true (via the existing test-side comparison-state setter the throughput tests already use), simulate a click, and assert: (a) `openDetailPanel` was NOT called; (b) `showComparisonAdvisoryToast` WAS called with the trigger element; (c) no panel `is-open` class is added. This is a regression-lock for existing behavior — the comparison short-circuit at `cycle-time-drilldown.ts:147-149` is unchanged by this feature. (FR-009, SC-004d, US2 acceptance scenario 4, contract § 13)

**Checkpoint**: User Story 2 verified — all four filter classifications produce the correct panel state, identical to throughput's behavior. Combined with US1, the panel is fully filter-aware.

---

## Phase 5: User Story 3 — Honest signaling for high-volume and unavailable-data states (Priority: P3)

**Goal**: Honest signaling — when the PR set is truncated, the user sees the same cue throughput shows; when per-PR detail is unavailable (zero PRs, no `webContext`, no cap marker), the user sees the same `supported-empty` message throughput shows.

**Independent Test**: Construct (or seed via fixture) a truncated rollup, click the dot, verify the truncation cue. Construct a rollup with zero qualified PRs, verify the `supported-empty` message. Construct a fixture with `webContext` undefined, verify the same `supported-empty` message.

**Note**: implementation is already covered by T007. This phase adds the data-state regression-lock tests.

### Tests for User Story 3

- [ ] T019 [US3] Add a test named `"truncation cue renders when _prs_truncated is true"` to `cycle-time-drilldown.test.ts`. Seed a rollup with `prs.length === 500`, `_prs_truncated: true`, `_prs_cap: 500`, and `pr_count: 850` (representing a week the producer truncated). Assert: (a) the panel renders the PR list; (b) the truncation cue text is present in the rendered output; (c) the cue text MATCHES throughput's truncation cue under the same condition. (FR-010, SC-006, US3 acceptance scenario 1, contract § 6)
- [ ] T020 [US3] Add a test named `"supported-empty renders for a week with zero qualified PRs"` to `cycle-time-drilldown.test.ts`. Seed a rollup with `prs: []` (or `prs` absent), `_prs_truncated: false`, `_prs_cap: 500`, and `pr_count: 0`. Assert the section renders the `supported-empty` content state and that the rendered message is verbally distinct from the team-inline and reviewer-inline messages (text inequality assertions). (FR-011, SC-004c, US3 acceptance scenario 2, contract § 3)
- [ ] T021 [US3] Add a test named `"supported-empty renders when webContext is absent"` to `cycle-time-drilldown.test.ts`. Seed a rollup with a non-empty `prs` array but install with `options.webContext: undefined`. Assert the section renders the `supported-empty` content state — proving URL-composer absence triggers the empty state, not a half-built list. (FR-011, SC-004c, US3 acceptance scenario 3, contract § 3)
- [ ] T022 [US3] Add a test named `"supported-empty renders when _prs_cap is missing from the rollup"` to `cycle-time-drilldown.test.ts`. Seed a rollup with non-empty `prs` but `_prs_cap` undefined (a malformed-rollup case the validator warns on but does not reject — see `rollup.schema.ts:1762`). Assert the section renders the `supported-empty` content state. (FR-011, SC-004c, contract § 3)
- [ ] T023 [US3] Add a test named `"current published demo dataset renders the PR list, not an empty state"` to `cycle-time-drilldown.test.ts`. Use the published demo rollup as a fixture (read directly from `docs/data/aggregates/weekly_rollups/2025-W28.json` via a test-side `JSON.parse(readFileSync(...))`), install with the demo's expected options shape, click the P50 dot for that week, and assert the panel renders the `pr-list` content state with 151 rows (the verified count at HEAD). This test pins the spec's iteration-2 verification — if the demo strip work (#315) ever lands, this test will fail and force a deliberate update; if it does not land, the test continues to pass. (FR-001, US3 acceptance scenario 4, spec Edge Cases / Assumptions § 4)

**Checkpoint**: User Story 3 verified — truncation, three flavors of supported-empty, and the current demo state all behave correctly. Combined with US1 and US2, the feature is functionally complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Capability-off DOM byte-identity, accessibility, keyboard, test-floor bump, final preflight verification. **All Phase 6 changes MUST be staged in the SAME commit as the Phase 2-5 changes** (per-commit ratchet — `extension.min_collected` floor delta must equal the test count added in the commit; no marker waiver available for extension).

### Capability-off DOM lock (FR-015)

- [ ] T024 [P] Create a new test file `extension/tests/modules/drilldown/cycle-time-pr-list-capability-off-baseline.test.ts`, mirroring `extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts`. Install the cycle-time drill-down against a fixture rollup with `commentsMetricsAvailable: false` and a non-empty `prs` array, render the panel, and compare the resulting `<section data-section="pr-list">` (or equivalent stable selector) innerHTML byte-for-byte against a committed baseline file at `extension/tests/fixtures/cycle-time-drilldown-capability-off-baseline.html`. The baseline file MUST be created by the implementer in the same commit, generated from a known fixture and verified to match the post-implementation render — capture the exact bytes the test expects so a reviewer can diff against the throughput equivalent. (FR-015, SC-006, contract § 11)

### Accessibility & keyboard (FR-012, FR-013)

- [ ] T025 Add a test named `"PR list section accessible name is identical across pr-list, supported-empty, team-inline, reviewer-inline"` to `cycle-time-drilldown.test.ts` (placed under a dedicated `describe("accessible name stability across content states", ...)` block). For each of the four content states: drive the install, render the panel, query the section element, read its accessible name (via `aria-label`, or `aria-labelledby` + the referenced element's text content, or the element's first descendant heading). Assert all four computed accessible names are equal. Citing a throughput equivalent does NOT satisfy this test — the assertion MUST run against the cycle-time-rendered DOM. (FR-012, SC-005, contract § 9)
- [ ] T026 Add a test named `"keyboard Enter on a focused cycle-time dot opens the panel with the PR list"` to `cycle-time-drilldown.test.ts`. Render the chart, focus a P90 dot via `.focus()`, dispatch a `KeyboardEvent("keydown", { key: "Enter", bubbles: true })`, and assert: (a) the panel opens (`is-open` class on the panel root); (b) the PR list section is rendered. Add a parallel sub-test for `key: " "` (Space) that additionally asserts `event.preventDefault()` was called (matching throughput's pattern at `throughput-drilldown.test.ts:403`). (FR-013, SC-005, contract § 10)
- [ ] T027 Add a test named `"PR list rows are reachable via Tab in DOM order inside the cycle-time panel"` to `cycle-time-drilldown.test.ts`. With the panel open and the PR list rendered (3+ rows in the fixture), assert each row element is focusable (`tabindex` attribute or natively focusable via `<a>`/`<button>`) and that Tab traversal — simulated via successive `.focus()` calls following DOM order, or via the focus-trap inspection helpers the existing detail-panel tests use — visits the rows first-to-last. (FR-013, SC-005, contract § 10)

### Test-floor bump (FR-020 / QG-43)

- [ ] T028 Run `cd extension && pnpm test:coverage` to produce `extension/test-results.xml` (the JUnit artifact). Verify the file is well-formed via `python scripts/check_test_floor_contract.py --contract .test-floor-contract.json --extension-junit extension/test-results.xml`. (FR-020, SC-010)
- [ ] T029 Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`. The output reports `actual=N` for the Extension dimension. Update `.test-floor-contract.json` `extension.min_collected` to exactly that `N`. The Python floor stays unchanged (no Python tests added). Re-run the ratchet-bump command to confirm exit 0 and zero drift. **All Phase 2-6 source changes + new tests + new fixtures + this floor bump MUST be in the same git commit** — the per-commit ratchet enforces `floor_delta == actual_delta` per first-parent walk. There is no `[ratchet-realignment]` waiver for extension drift. (FR-020, SC-010, QG-43, QG-44)

### Cross-surface gate confirmations

- [ ] T030 Confirm the cross-surface PR-record schema-parity gate is green: `python scripts/check_pr_record_schema_parity.py` returns exit 0. This MUST pass by no-op because no PR-record field is added or removed; failure indicates an unexpected schema-surface drift. (SC-011, FR-017, QG-49)
- [ ] T031 Confirm zero suppression delta: `python scripts/audit-suppressions.py --diff` reports zero drift across every scope (`typescript-extension`, `typescript-tests`, etc.). `.suppression-baseline.json` stays at total=0. (QG-41)
- [ ] T032 Confirm zero `typing.Any` delta: `python scripts/check_no_any_types.py src/ tests/ scripts/` returns exit 0. No new Python `Any` types; the new TypeScript code uses `any` nowhere (verified by ESLint). (QG-40)
- [ ] T032a Confirm FR-016 by positive verification: `git diff origin/main -- src/ tests/ scripts/ .github/scripts/` MUST report zero changes. This proves the negative requirement "no producer-side change" by mechanical evidence rather than only by absence of Python tasks. If the diff shows any change in those paths, the feature has overstepped its scope and the implementation must be reworked before delivery. (FR-016, SC-007)

### Final preflight

- [ ] T033 Run the authoritative local preflight: `python scripts/run_pr_preflight.py` — MUST return exit 0 with no `--allow-local-degraded` flag. Every CommandSpec passes: mypy on `src/ tests/ scripts/ .github/scripts/`, ruff check + format, pytest with coverage, Extension Jest CI (with the new tests), Extension type tests, Extension smoke (Playwright), PR-record schema parity, generated-artifact parity, test-floor contract validation, ratchet-bump guard, coverage-delta gate, gitleaks secret scan, suppression baseline gates (zero), CLI-reference drift, and every other CommandSpec. (SC-007, FR-020, VR-29)

### End-to-end verification

- [ ] T034 Run the `quickstart.md` walkthrough end-to-end against the published demo (`pnpm run serve:docs`): exercise every spec acceptance scenario manually (US1 P50/P90 click + row click; US2 team / reviewer / author+repo / comparison; US3 truncation via fixture + supported-empty via fixture + demo PR list visible). Confirm SC-001 (under 30 seconds to identify slow PRs), SC-002 (exactly two clicks to ADO), SC-005 (screen-reader stable identity), and SC-009 (manager-readability check). **Also confirm SC-008 by code-review check**: `grep -rE "featureFlag|getFeatureGate|isFeatureEnabled|rolloutGate" extension/ui/modules/drilldown/cycle-time-drilldown.ts extension/ui/dashboard.ts` MUST return zero hits in the new code, proving the feature ships behind no flag and no rollout gate. (SC-001, SC-002, SC-005, SC-008, SC-009, all User Stories)

**Checkpoint**: feature is delivery-ready. Branch is clean except for the new spec dir, source edits, new test files, fixture file, and `.test-floor-contract.json` bump — all in one commit, ready for the standard review cycle.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 / T002 are independent of all source changes; can run any time; do not block any later phase.
- **Foundational (Phase 2)**: T003 → T004 → T005 → T006 (sequential — same file or dependent type). MUST complete before Phase 3.
- **User Stories (Phases 3-5)**: All depend on Phase 2 completion (`buildPrListSection` references the options interface).
  - **US1 (P1)**: T007 → T008 (sequential, both edit `cycle-time-drilldown.ts`); T009 / T010 / T012 / T013 sequential within `cycle-time-drilldown.test.ts` but [P] with the dedicated-file tests (T011, T014); T011 / T014 [P] amongst themselves and with each other.
  - **US2 (P2)**: T015 / T016 / T017 / T018 sequential within `cycle-time-drilldown.test.ts`; can start as soon as T007 lands.
  - **US3 (P3)**: T019 / T020 / T021 / T022 / T023 sequential within `cycle-time-drilldown.test.ts`; can start as soon as T007 lands.
- **Polish (Phase 6)**: T024 [P] with US1/US2/US3 once T007 lands; T025 / T026 / T027 sequential within `cycle-time-drilldown.test.ts`; T028 / T029 / T030 / T031 / T032 / T032a / T033 / T034 sequential at the very end (each depends on the prior one's clean completion).

### Within Each User Story

- Single-file tests (in `cycle-time-drilldown.test.ts`) are sequential because they share a file.
- Cross-file tests (`cycle-time-pr-list-order.test.ts`, `cycle-time-pr-list-count-parity.test.ts`, `cycle-time-pr-list-capability-off-baseline.test.ts`) are [P] amongst themselves.
- All tests for a story must pass before the polish phase verifies the floor.

### Parallel Opportunities

- T011 (FR-019 order), T014 (count parity), T024 (capability-off baseline) — three new test files, three [P] tasks, no shared file with each other.
- T025 / T026 / T027 — share `cycle-time-drilldown.test.ts` with US2/US3 tests, so cannot be [P] with them.

---

## Parallel Example: User Story 1

```bash
# After T007 (impl) lands, the new-file tests can be authored in parallel:
Task T011 [P]: "FR-019 rendered DOM order assertion in cycle-time-pr-list-order.test.ts"
Task T014 [P]: "FR-008/SC-003 count parity in cycle-time-pr-list-count-parity.test.ts"

# Meanwhile, the same-file tests must be sequential:
Task T009 → T010 → T012 → T013 in cycle-time-drilldown.test.ts
```

---

## Implementation Strategy

### Recommended commit plan (simple)

Two commits is the recommended path:

1. **Planning commit** (after `/speckit.analyze` passes): the contents of `specs/361-cycle-time-pr-drilldown/` (spec, plan, research, data-model, contracts, quickstart, tasks, checklists). NO source changes. NO test additions. NO floor change. This is the speckit-artifact baseline that downstream phases extend.
2. **Implementation commit**: all of Phases 2 + 3 + 4 + 5 + 6 staged together — source edits to `cycle-time-drilldown.ts` + `dashboard.ts`, all new tests across `cycle-time-drilldown.test.ts` + `cycle-time-pr-list-order.test.ts` + `cycle-time-pr-list-count-parity.test.ts` + `cycle-time-pr-list-capability-off-baseline.test.ts`, the capability-off baseline fixture, and the `.test-floor-contract.json` `extension.min_collected` bump. This is the MVP commit — after it lands, every spec acceptance scenario passes.

This is the recommended path because the implementation is small, the test additions all serve the same user-visible surface, and a single atomic commit makes review and rollback trivial.

### Per-commit ratchet rule (the non-negotiable constraint)

The project's per-commit ratchet (`scripts/check_ratchet_bump.py` + CI's `ratchet-bump-guard` job) walks first-parent history and asserts `floor_delta == test_delta` on every commit individually. There is no marker waiver for extension drift. The implication for commit boundaries:

- A commit that adds N new Jest tests MUST bump `.test-floor-contract.json` `extension.min_collected` by exactly N in the same commit.
- A commit that adds zero Jest tests MUST NOT change the floor.
- A commit that changes the floor without a matching test delta fails the gate.

Multiple commits are fine as long as each is internally consistent. The "single implementation commit" recommendation above is a convenience choice, not a ratchet requirement.

### Alternative: incremental delivery (allowed but discouraged for this feature)

If a developer prefers to split work, every commit must be self-consistent on the ratchet. For example:

- Commit 1 (planning artifacts only) — no tests, no floor change. Safe.
- Commit 2 (Phase 2 only — interface + signature + dashboard wire-up) — no tests, no floor change. Safe.
- Commit 3 (Phase 3 — impl + 6 tests + floor +6) — internally consistent. Safe.
- Commit 4 (Phase 4 — 4 tests + floor +4) — internally consistent. Safe.
- Commit 5 (Phase 5 — 5 tests + floor +5) — internally consistent. Safe.
- Commit 6 (Phase 6 — 4 tests + floor +4 + verification) — internally consistent. Safe.

**This is not recommended for this feature** because the test additions all serve the same user-visible surface and the implementation is small. Use a single implementation commit unless there is a specific reason to split (e.g., multi-developer concurrent work, which this feature does not warrant).

### MVP definition (functional, not commit-bounded)

After the implementation commit (Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6), the feature's MVP is fully delivered:

- **Phase 3 (US1)** delivers the entire user-visible value: clicking any P50/P90 dot under no/author/repo filters renders the PR list with click-through to ADO. Under team / reviewer / comparison the user sees the appropriate gating message — because `buildPrListSection` is one cohesive function that handles all four classifications (T007 implements all of them at once).
- **Phase 4 (US2)** locks the filter-classification behavior with regression tests (no impl change).
- **Phase 5 (US3)** locks truncation + supported-empty behavior with regression tests (no impl change).
- **Phase 6 (Polish)** adds capability-off byte-identity, a11y, keyboard, the floor bump, and final preflight verification.

There is no "shippable Phase 3 alone" intermediate state — the per-commit ratchet requires the floor to bump alongside any test additions, and the spec mandates cycle-time-specific tests for FR-012 / FR-013 / FR-015 / FR-019 (which sit in Phases 3 / 6). So the smallest functionally-complete and verification-complete deliverable is the full implementation commit.

### Parallel Team Strategy

This feature is too small to justify a multi-developer split. One developer carrying it end-to-end is the expected pattern.

---

## Notes

- [P] tasks = different files, no shared file with other in-progress tasks.
- [US#] label maps task to specific user story for traceability.
- Each user story is independently *testable*; Phases 4 / 5 add tests that lock behavior already implemented in Phase 3 (because `buildPrListSection` is cohesive). Independent testability is the speckit invariant; independent commit-ability is not required by this feature.
- The recommended path is one implementation commit with all source + tests + fixture + floor bump (Phases 2-6). The per-commit ratchet rule (above) governs any split.
- No marker waivers used (`[version-override-acknowledged]`, `[threshold-update]`, `[ratchet-realignment]`, `[ratchet-test-removal]` are all N/A for this feature).
- Per repo memory (`feedback_run_full_gate_at_head_before_push.md`): run `python scripts/run_pr_preflight.py` at clean HEAD before any `git push` attempt.
- Per repo memory (`feedback_never_push_without_explicit_command.md`): no `git push` is performed by these tasks; the user controls push timing.
- CLAUDE.md was modified by the speckit.plan workflow's `update-agent-context.ps1` step — this added a TypeScript 6.0.3 entry for feature 361 plus a "Recent Changes" line. Since this feature introduces no new technologies (TypeScript 6.0.3 + Jest 30.x + jsdom 28.x are already documented for prior features 060 / 310 / 333 / 334 / 335 / 336), the new tech-list line is functionally a duplicate. The "Recent Changes" line is a legitimate trail marker. The implementer should review the diff before staging — keep the "Recent Changes" line; consider removing the duplicate tech-list lines unless the project convention favors keeping them.
