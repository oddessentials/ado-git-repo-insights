---

description: "Implementation tasks for #333 — Dashboard weekly discussion-volume trend chart + SC-05 cross-feature reconciliation"
---

# Tasks: Dashboard weekly discussion-volume trend chart + SC-05 cross-feature reconciliation

**Input**: Design documents from `specs/333-comments-trend-chart/`
**Prerequisites**: spec.md (8 rounds locked + round-9 tightening), plan.md, research.md (11 decisions), data-model.md, contracts/{weekly-comments-aggregate,sc05-reconciliation-test}.md, quickstart.md
**Branch**: `feat/333-comments-trend-chart`
**Single PR scope**: foundation PR for the #322 dashboard block. No decomposition.
**Tests**: REQUIRED — the spec mandates explicit tests for FR-2-04, FR-2-05, FR-2-06 (cases i–vi), and FR-3-03. Test-driven ordering: write tests first, expect failure, then implement.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to user stories from spec.md (US1 = P1 chart trend visibility, US2 = P2 drill-down click-through, US3 = P3 capability-off byte-identity)
- Setup, Foundational, and Polish phases have NO story label

## Path Conventions

This repo has both Python backend and TypeScript extension:

- **Backend**: `src/ado_git_repo_insights/`, `tests/` at repo root
- **Extension**: `extension/ui/`, `extension/tests/`
- **Demo data**: `docs/data/`
- **Specs**: `specs/333-comments-trend-chart/`

## Constitution gates that bind every commit

- **QG-43** (per-commit ratchet bump): every commit that adds N tests MUST bump `.test-floor-contract.json` by exactly N in the SAME commit. Tasks below note the bump explicitly where tests are added.
- **QG-49** (single command, many callers): the SC-05 reconciliation test is invoked by the standard `pytest tests/integration/` path used by pre-push preflight + CI; no new dedicated CommandSpec needed.
- **QG-39 / QG-40 / QG-41**: cross-OS, no `typing.Any`, zero new inline suppressions. See `reference_s608_refactor_pattern.md` for dynamic-SQL pattern.
- **QG-38**: `--no-verify` forbidden.

---

## Phase 1: Setup (Investigation + ADRs to pin open implementation questions)

**Purpose**: resolve the 5 open implementation pin-points from `research.md` BEFORE writing code, so subsequent tasks have a deterministic execution path. Each ADR is a 1-page rationale + decision pinned in the relevant contract or research doc.

- [ ] T001 [P] Investigate which existing test file gates capability-off variants today and pin the FR-3-03 byte-identity extension target. Candidates: `tests/integration/test_demo_variants_byte_identity.py` (referenced in issue body) and `tests/demo/test_demo_parity_pipeline.py` (Explore-flagged as the existing locked-shape gate). Read both, identify which one currently asserts byte-identity between capability-on and capability-off variants, and pick the one to extend. Update `specs/333-comments-trend-chart/contracts/weekly-comments-aggregate.md` §5 and `quickstart.md` §8 with the pinned file path.
- [ ] T002 [P] Decide and document the FR-2-04 (b) round-9 import-block isolation mechanism. Options: (a) AST-based test that walks transitive imports and asserts `src/ado_git_repo_insights/transform/aggregators.py` is NOT in the set; (b) module-boundary configuration via Python import hook in a sub-package. Recommendation: option (a). Document in `specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md` §2 with the pinned mechanism + rationale.
- [ ] T003 [P] Investigate `aggregators.py` to confirm whether throughput exposes a callable week-attribution helper (FR-2-03 (a) "shared canonical function" path) or whether the comments aggregator must implement its own + a per-PR parity test against throughput's emission (FR-2-03 (b) path). Read `src/ado_git_repo_insights/transform/aggregators.py` `_generate_weekly_rollups()` and any helper it uses for week assignment. Document the decision in `specs/333-comments-trend-chart/research.md` Decision 7. Note: round-9 forces FR-2-03 (b) shape on the FR-2-04 (b) reconciliation test side regardless — this ADR only covers the production-code side.
- [ ] T004 [P] Decide INV-1-08 schema validator atomicity posture: error vs. warning when the `comments` sub-object has partial fields. Per spec FR-2-06 + INV-1-08 the contract says "atomicity violation" — pin between strict error (validator returns invalid) vs. warning + permissive accept. Recommendation: STRICT ERROR in both strict and permissive modes (atomicity is non-negotiable per INV-1-08). Document in `specs/333-comments-trend-chart/contracts/weekly-comments-aggregate.md` §3.
- [ ] T005 [P] Decide partial-coverage visual qualifier exact rendering for FR-1-04: hatched bar fill / dimmed color / both. Per `feedback_visual_example_iteration.md` this is a tuning iteration — pin a starting point and document that round-1 implementation may iterate based on stop-time review. Recommendation: hatched fill (CSS `repeating-linear-gradient`) + slightly dimmed segment colors + tooltip-explained legend item. Document in `specs/333-comments-trend-chart/research.md` Open Implementation Questions.

**Checkpoint**: All 5 open implementation questions are pinned. Subsequent tasks have deterministic targets.

---

## Phase 2: Foundational (Blocking prerequisites for all user stories)

**Purpose**: aggregator emission + schema extension + reconciliation test infrastructure. The chart (US1), drill-down click-through (US2), and capability-off byte-identity (US3) all depend on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### 2.1 — Test-first scaffolding (TDD: write tests, expect FAIL, then implement)

- [ ] T006 Add FR-2-06 test cases (i)–(iv) to `tests/unit/test_aggregators.py`: case (i) all-full week → `coverage_partial=false`, full sums; case (ii) mixed week (one or more PRs missing extraction, one or more PRs extracted) → `coverage_partial=true`, numeric totals equal sum over EXTRACTED-SUBSET ONLY (positive assertion that unextracted PRs contribute zero); case (iii) all-unextracted week → `coverage_partial=true`, all numeric=0; case (iv) capability-off → `comments` key absent. Tests MUST currently FAIL (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 4 in same commit (QG-43).
- [ ] T007 Add FR-2-04 reconciliation test scaffold at `tests/integration/test_comments_trend_reconciliation.py`. Implements assertions (a) cross-surface coherence on extracted-subset of drill-down ∩ aggregator intersection per FR-2-01 (including the round-9 positive assertion that unextracted PRs render with 310's per-PR partial sentinel), and (b) end-to-end aggregator correctness via independent re-computation (DIRECT SQL against `pull_requests`, no imports from `src/ado_git_repo_insights/transform/aggregators.py`, re-derives `coverage_partial` independently). Iterates every week W in the demo dataset. Tests MUST currently FAIL on demo (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 1 in same commit.
- [ ] T008 Add FR-2-04 (b) round-9 import-block isolation test at `tests/integration/test_comments_trend_reconciliation_isolation.py` per the T002-pinned mechanism. AST-based: walks the transitive import graph rooted at `tests/integration/test_comments_trend_reconciliation.py` and asserts `src.ado_git_repo_insights.transform.aggregators` is NOT in the import set (covers BOTH the comments aggregator AND throughput aggregator since both live in that file). Test MUST currently PASS (T007 was authored without aggregator imports). Bump `.test-floor-contract.json` Python floor by 1 in same commit.
- [ ] T009 Add FR-2-05 failure-mode meta-test at `tests/integration/test_comments_trend_meta_failure.py`. Loads the demo manifest into `tmp_path`, mutates one week's `rollup[W].comments` to violate INV-1-06 (`active_thread_count > thread_count`), invokes T007's reconciliation test against the mutated manifest, asserts pytest reports failure. Test MUST currently SKIP or XFAIL (T007 doesn't pass yet so the meta-assertion can't be evaluated cleanly). Add an `xfail(strict=False, reason="depends on T007 + T012 making the reconciliation test green on clean demo")` marker to make this collection-stable per Principle XXVI. Bump `.test-floor-contract.json` Python floor by 1 in same commit.
- [ ] T010 [P] Add `extension/tests/schema/rollup.test.ts` cases for the new `comments` sub-object: valid 4-field object passes; partial object (missing one field) fails per T004 atomicity posture (STRICT ERROR); null-valued numeric fields fail; rollup without `comments` key passes (capability-off path); wrong-typed fields fail. Tests MUST currently FAIL (schema not extended yet). Bump `.test-floor-contract.json` Extension floor by ~5 in same commit.

**Checkpoint 2.1**: Test infrastructure exists. All FR-2-04/05/06 + schema tests are red. Reconciliation isolation test is green (proves T007 stays import-isolated from the start).

### 2.2 — Aggregator emission (FR-2-06 + FR-2-03 + INV-1-06/07/08)

- [ ] T011 Implement comments-aggregate emission in `src/ado_git_repo_insights/transform/aggregators.py` `_generate_weekly_rollups()`. When `_has_comments()` returns true: for each week W, determine W's canonical throughput PR set via the T003-pinned week-attribution path; filter to extracted-subset (`comments_extracted_at IS NOT NULL`); query `pr_threads` + `pr_comments` per PR; sum to produce the four `rollup[W].comments` fields atomically. SQL pattern per `contracts/weekly-comments-aggregate.md` §2 — use `" ".join([...])` for any dynamic-SQL parts (S608 compliance per `reference_s608_refactor_pattern.md`); never `# noqa: S608`. Verify: T006 (i)–(iii) PASS; T006 (iv) still passes (capability-off path unchanged); T007 reconciliation test PASSES on demo dataset.
- [ ] T012 If T003 chose FR-2-03 (b) (comments-aggregator implements its own week-attribution + per-PR parity test against throughput): implement the per-PR week-attribution parity test at `tests/integration/test_week_attribution_parity.py`. For every PR in the demo dataset, asserts `comments-aggregator-week(P) == throughput-aggregator-week(P)`. If T003 chose FR-2-03 (a) (shared canonical helper), this task is a NO-OP — close it with a one-line note in `tasks.md` referencing T003's outcome. Bump `.test-floor-contract.json` Python floor by 1 if test added; no bump if no-op.

### 2.3 — Schema extension (rollup.schema.ts)

- [ ] T013 [P] Extend `extension/ui/schemas/rollup.schema.ts` Rollup interface with optional `comments` sub-object: `comments?: { thread_count: number; comment_count: number; active_thread_count: number; coverage_partial: boolean; }`. Add `"comments"` to `KNOWN_ROOT_FIELDS` set. Implement validator function (alongside existing per-PR INV-08 validator at `:564`) enforcing INV-1-08 atomicity per the T004-pinned posture (STRICT ERROR for partial shape in both modes). DO NOT modify the per-PR PrRecord declarations at `:96–98` (those are locked by 310's schema-parity gate — round-6 shadowing prevention). Verify: T010 schema tests PASS.

### 2.4 — Test floor accounting

- [ ] T014 Verify `.test-floor-contract.json` matches actual added test count after T006–T013. Sum (foundational only — chart and US-phase tests are bumped by their own tasks): T006 (+4), T007 (+1), T008 (+1), T009 (+1) Python = +7 Python; T010 (+~5) Extension; T012 (+1 if FR-2-03 b). Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` locally to verify floor==actual on both Python and Extension. If actual differs from sum, reconcile by either correcting the floor or auditing T006–T013 for unintended test additions. (Total cumulative across the PR: ~12 Python + ~20 Extension after all phases per the bottom-of-file Notes — round-12 added +1 to T015 (8 instead of 7) for chart-layer idempotency and +2 to T025 (3 instead of 1) for on/off-transition coverage; round-13 added +1 to T025 (4 instead of 3) for the dashboard-layer on→on re-render idempotency that round-12 had introduced as a fix-claim but never tested.)

**Checkpoint 2 (Foundational complete)**: `rollup[W].comments` is emitted by the aggregator under capability-on; schema validator accepts the new sub-object; reconciliation + meta + isolation + unit tests are GREEN; capability-off path unchanged. **All user stories can now begin.**

---

## Phase 3: User Story 1 — Spot the conversation-volume trend at a glance (Priority: P1) 🎯 MVP

**Goal**: dashboard renders the new comments-trend chart on the Metrics tab; team lead can identify the highest known review-conversation volume in the visible range with no interaction beyond visual scan, and the partial-coverage qualifier prevents misreading partial weeks.

**Independent Test** (per spec): open a demo dashboard with `capabilities.comments_metrics` enabled and at least 8 weeks of data. Confirm a chart titled with conversation/comment vocabulary renders below the existing four charts on the Metrics tab. Confirm each week renders as a stacked bar + overlaid line. Confirm the chart honors the dashboard's existing date-range filter. (US2 click-through is NOT required for this test.)

### 3.1 — Chart-module test scaffolding (TDD)

- [ ] T015 [US1] Add `extension/tests/modules/charts/comments-trend.test.ts` chart unit tests covering FR-1-01..06 + idempotency: (a) chart renders 12 stacked bars + overlaid line + 3-series legend on a 12-week fixture; (b) chart re-renders correctly when range filter narrows; (c) chart renders truncation indicator when input exceeds the cap; (d) FR-2-06 case (v) — mixed partial/non-partial weeks → qualifier applied ONLY to partial-marked; (e) FR-2-06 case (vi) round-9 — all-unextracted week → bar element MUST be present in DOM with explicit zero-height segments AND the partial-coverage qualifier applied (no silent omission); (f) bar carries `data-drilldown-week` attribute (US2 wires the click handler later); (g) bar `aria-expanded`, `aria-label`, `tabindex`, `role="button"` per the throughput chart accessibility convention; (h) **round-12 idempotency** — calling `renderCommentsTrendChart(container, rollups, options)` twice on the same container produces ONE chart, not two (no duplicated bars / no duplicated line / no duplicated legend); content is replaced via the throughput-style `renderTrustedHtml` pattern. Tests MUST currently FAIL (chart module doesn't exist). Bump `.test-floor-contract.json` Extension floor by 8 in same commit.

### 3.2 — Chart implementation

- [ ] T016 [US1] Create new chart module at `extension/ui/modules/charts/comments-trend.ts` modeled on `extension/ui/modules/charts/throughput.ts` (202-line structural template). Reads `Rollup[]` and accesses `rollup[W].comments` per week. Renders stacked bar (lower = `thread_count - active_thread_count` resolved, upper = `active_thread_count` unresolved) + SVG-overlaid line for `comment_count`. Honors range-filter via `FilterState` parameter. Display cap modeled on throughput's `MAX_THROUGHPUT_POINTS = 104` (declare own `MAX_COMMENTS_TREND_POINTS` constant). Truncation indicator via shared `renderTruncationIndicator` from `chart-layout`. Tooltip via shared `addChartTooltips` from `charts/index`. Bar carries `data-drilldown-week`, `tabindex`, `role="button"`, `aria-expanded`, `aria-label`. Verify: T015 (a)–(c) and (f)/(g) PASS.
- [ ] T017 [US1] Implement partial-coverage visual qualifier in `comments-trend.ts` per T005 pinned approach (hatched fill + dimmed color). Apply ONLY to bars where `rollup[W].comments.coverage_partial === true`. For all-unextracted weeks (round-9 case (vi)): bar MUST render with explicit zero-height segments (height 0), MUST be present in DOM (not optimized away), MUST carry the qualifier, comment-line MUST connect through the zero point. Add the qualifier explanation as a legend item gated on "any partial week visible." Verify: T015 (d) and (e) PASS.
- [ ] T018 [US1] Add CSS styles for the new chart in `extension/ui/styles.css`: stacked-bar segment colors (high-contrast, distinguishable in light + dark themes), comment-line color, partial-coverage qualifier (hatched-fill `repeating-linear-gradient` + dimmed segment colors per T005), legend item styles. Reuse existing chart-layout CSS variables where applicable. Cross-OS verified by Linux Chromium smoke test (per project memory's CSS contract approach).
- [ ] T019 [US1] Register the new chart in `extension/ui/modules/charts/index.ts` barrel export. Add a one-line export for `comments-trend`.
- [ ] T020 [US1] Lock chart container insertion pattern: **PURE DYNAMIC INSERTION via `document.createElement` only, IDEMPOTENT, with capability-flip cleanup**. `extension/ui/index.html` MUST NOT be modified by this feature — no `<div id="comments-trend">`, no `<template id="comments-trend-template">`, no comment-anchor marker. Per FR-3-01 + SC-1-04, the **served `index.html` (and therefore the document's DOM tree) under capability-off MUST be byte-identical to the pre-feature baseline at any moment in time**. A `<template>` element was considered (round 10) and REJECTED (round 11): although `<template>` content is parsed-but-not-rendered, the `<template>` element itself IS in the DOM tree and visible to a baseline-comparison DOM-diff. Round 12 added the idempotency + cleanup requirement: dashboard re-renders fire on dataset reload, filter change, tab switch — naive `createElement + appendChild` per render would stack duplicates. Document the pattern + rejections with a comment in `dashboard.ts` referencing FR-3-01 + SC-1-04 + FR-3-02 + T025 next to the insertion-point code.
- [ ] T021 [US1] Wire the chart into `extension/ui/dashboard.ts` with two helper functions: (1) `ensureCommentsTrendContainer(): HTMLElement | null` — checks if `document.getElementById('comments-trend')` already exists; if so, returns it (REUSE — no duplicate insertion); if not AND capability-on, builds the chart row from scratch via `document.createElement` chain (`.charts-row` > `.chart-container` > `<div id="comments-trend" class="chart">`), tags the row with `data-comments-trend-row="true"` for cleanup discoverability, appends after the existing `cycle-distribution` row's parent `.charts-row`, returns the new container. (2) `removeCommentsTrendContainer(): void` — finds any element matching `[data-comments-trend-row="true"]` and removes it from its parent (no-op if absent). Then on Metrics tab render: **if** `capabilityState?.commentsMetricsAvailable === true`, call `ensureCommentsTrendContainer()` → if non-null, instantiate `renderCommentsTrendChart(container, rollups, options)` with the dashboard's `FilterState` (the chart module clears its own content via the `renderTrustedHtml` pattern, so re-rendering into an existing container is content-idempotent). **If capability-off**, call `removeCommentsTrendContainer()` (no-op when never inserted; cleanup when transitioning from on→off per FR-3-02). At any moment in time when capability is off, the Metrics tab DOM MUST be byte-identical to pre-feature (FR-3-01 + SC-1-04 + T025) — holds for both (a) initial capability-off and (b) after on→off cleanup. Multiple capability-on re-renders MUST NOT produce duplicate rows (round-12 idempotency). Capability-on initial render MUST insert the row exactly once (FR-3-02 off→on transition).

**Checkpoint US1**: comments-trend chart renders on the Metrics tab when capability-on; stacked bars + line + qualifier all present; range filter honored; T015 all green. US1 deliverable is INDEPENDENTLY verifiable per the spec's Independent Test.

---

## Phase 4: User Story 2 — Drill into a specific week directly from the chart (Priority: P2)

**Goal**: clicking a bar (or activating it via keyboard) opens the existing Feature 060 drill-down panel for that week.

**Independent Test**: with the chart rendered (US1 complete), click any bar; the drill-down panel opens for the corresponding week showing the per-PR comment-metric columns from Feature 310.

### 4.1 — Click-through wiring

- [ ] T022 [US2] Wire the bar-click + keyboard-activation handlers in `extension/ui/modules/charts/comments-trend.ts`: bind `click` and `keydown` (Enter/Space) on bar elements to invoke the existing throughput-drilldown activation path (via `data-drilldown-week` attribute, same convention throughput uses). Update `aria-expanded` to reflect panel state per the throughput chart accessibility contract. NO new drill-down code added — the existing 060 panel + 310 columns already render whatever week is requested.
- [ ] T023 [US2] Add a chart-test case in `extension/tests/modules/charts/comments-trend.test.ts` verifying: (a) clicking a bar invokes the drill-down activation handler with the correct week; (b) keyboard Enter/Space on a focused bar invokes the same handler; (c) `aria-expanded` toggles correctly. Bump `.test-floor-contract.json` Extension floor by 3 in same commit.

**Checkpoint US2**: bar click + keyboard activation open the drill-down panel for the right week. T023 green.

---

## Phase 5: User Story 3 — Capability-off renders byte-identical to the prior baseline (Priority: P3)

**Goal**: datasets without `capabilities.comments_metrics` MUST see the dashboard render identically to the pre-feature baseline — no comments-trend chart container, no shifted layout, no new banner.

**Independent Test**: load a dataset variant with `capabilities.comments_metrics: false`. Confirm the Metrics tab renders identically to the pre-feature baseline (4 charts in 2x2; no comments-trend container).

### 5.1 — Capability-off byte-identity gating

- [ ] T024 [US3] Extend the T001-pinned capability-off byte-identity test (likely `tests/integration/test_demo_variants_byte_identity.py`) to gate the new `comments` key per FR-3-03 across all four omission failure modes individually: (a) key NOT present, (b) key NOT present-with-`null`-value, (c) key NOT present-with-`{}`-empty-object, (d) key NOT present-with-partial-fields. A regression that produces ANY of these four under capability-off MUST fail the test. Bump `.test-floor-contract.json` Python floor by 4 in same commit.
- [ ] T025 [US3] Add an extension dashboard-lifecycle test at `extension/tests/dashboard/comments-trend-dashboard-lifecycle.test.ts` (or similar — pin file name at task time; the prior "capability-off" name is too narrow now that round-12 added on/off transitions and round-13 added on→on re-render) verifying FOUR scenarios per FR-3-01 + FR-3-02 + SC-1-04 + round-12 idempotency:

  - **(a) Initial capability-off**: with `capabilities.comments_metrics: false` from the start, no element with `id="comments-trend"` is mounted, no element with `[data-comments-trend-row="true"]` is mounted, the four pre-existing charts occupy the same layout positions, the Metrics tab DOM is byte-identical to pre-feature baseline.
  - **(b) On→off transition (round-12 cleanup)** per FR-3-02: render dashboard once with capability-on (chart row inserted via `ensureCommentsTrendContainer`), reload with capability-off, assert `removeCommentsTrendContainer` cleaned up — no `id="comments-trend"`, no `[data-comments-trend-row="true"]`, Metrics tab DOM byte-identical to pre-feature.
  - **(c) Off→on transition** per FR-3-02: render dashboard with capability-off, reload with capability-on, assert chart row inserted exactly once.
  - **(d) On→on re-render idempotency (round-13 addition — closes the round-12 test gap)**: render the FULL DASHBOARD render path twice consecutively with capability-on (this calls `ensureCommentsTrendContainer()` + `renderCommentsTrendChart()` each time, simulating the dataset-reload / filter-change / tab-switch-back paths that fire dashboard re-renders in production). Assert exactly ONE `.charts-row` element with `[data-comments-trend-row="true"]` exists in the DOM (no duplicate row from the second render — verifies `ensureCommentsTrendContainer`'s check-first idempotency at the DASHBOARD layer). Assert exactly ONE `<div id="comments-trend">` exists. Assert the chart's bars/legend inside the container are not concatenated/duplicated from the first render (verifies the chart module's `renderTrustedHtml`-style content replacement at the CHART layer). NOTE: this scenario is the load-bearing test for round-12's fix — T015 (h) tests chart-layer content idempotency only, NOT dashboard-layer row-insertion idempotency, which is the actual failure mode round-12 set out to fix.

  Bump `.test-floor-contract.json` Extension floor by 4 in same commit (round-13: was +3 before adding scenario (d)).

**Checkpoint US3**: capability-off renders pre-feature baseline; FR-3-03 byte-identity test green; capability-off render test green.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: regenerate demo data so the new chart has a payload to render, run the full preflight gate, visual sign-off, and ensure all CLAUDE.md / docs references are current.

- [ ] T026 Regenerate demo data via the canonical command per `reference_managed_artifacts_sync.md`: `python scripts/manage_generated_artifacts.py sync --scope all --stage`. The `--stage` flag is REQUIRED (without it, the verify gate fails). Output: rebuilds `extension/ui/dist/` (esbuild) + republishes to `docs/data/` + stages managed paths via `git add`. Verify: `docs/data/aggregates/weekly_rollups/*.json` files now carry the `comments` sub-object on every week (capability-on demo); `docs/data/dataset-manifest.json` carries `capabilities.comments_metrics: true`. Run `python scripts/manage_generated_artifacts.py verify` to confirm working tree is clean against the index post-stage.
- [ ] T027 [P] Quick test floor + ratchet sanity check: run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` and confirm floor == actual on both Python and Extension suites. If drift is detected, reconcile via either correcting `.test-floor-contract.json` or identifying unintended test changes. NO `[ratchet-realignment]` marker should be needed for a clean foundation PR.
- [ ] T028 [P] Verify QG-49 single-command invocation parity: confirm the new SC-05 reconciliation tests are picked up by the standard `pytest tests/integration/` invocation used in pre-push preflight (`scripts/run_pr_preflight.py`) AND CI (`.github/workflows/ci.yml`) — no new dedicated CommandSpec needed (per the SC-05 contract §4). Confirm chart unit tests are picked up by `pnpm test:ci`.
- [ ] T029 Run the authoritative pre-push preflight: `.venv/Scripts/python.exe scripts/run_pr_preflight.py`. Expected: GREEN. Runs lint, type-check, suppression audit, partial-branch ratchet, schema parity (PrRecord scope only), golden outputs, demo parity, gitleaks, and all new tests added in this PR. Per `reference_venv_python_for_preflight.md`: MUST invoke via `.venv/Scripts/python.exe` (not system Python) so the pandas-version-policy gate doesn't trip.
- [ ] T030 Visual sign-off per `quickstart.md` §9: serve the demo locally (`python scripts/serve_dashboard.py` or `python -m http.server 8000` from repo root navigating to `http://localhost:8000/docs/`); open the dashboard; confirm the comments-trend chart renders below the existing 2x2 grid; confirm stacked bars + line + partial qualifier all visible; click a bar → drill-down opens. Capability-off variant: load with `capabilities.comments_metrics: false` (or use the capability-off demo variant), confirm the chart container is absent from DOM. Document any visual tuning needed and apply per `feedback_visual_example_iteration.md` (iterate before declaring done).
- [ ] T031 [P] Update CLAUDE.md Recent Changes entry if the round-9 additions altered the technologies-or-dependencies one-liner. (Likely no change — round-9 was contract tightening only.)
- [ ] T032 Confirm SC-05 closure obligation is met per `quickstart.md` §11: SC-05 test exists (T007), passes (T011 made it green), is future-proofed (T008 isolation guard + T009 meta-test). 310's deferred SC-05 / INV-07 cross-feature coherence is now CLOSED.

**Checkpoint Polish**: demo data refreshed; preflight green; visual sign-off complete; SC-05 closure documented.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: independent investigations; can start immediately. T001–T005 all parallel.
- **Phase 2 (Foundational)**: BLOCKS all user stories. T006–T010 are TDD test-scaffolding (parallel within phase). T011 implementation depends on T003 (week-attribution decision) and T006/T007/T009 (tests must exist first). T013 schema extension depends on T004 (atomicity posture decision) and T010 (tests must exist first). T012 conditional on T003. T014 depends on all of T006–T013.
- **Phase 3 (US1)**: depends on Phase 2 (especially T011 aggregator emission + T013 schema extension). T015 first (TDD), then T016–T021 in roughly the listed order (T016 chart impl → T017 qualifier → T018 styles → T019 barrel → T020 HTML container → T021 dashboard wiring). Several can be parallelized once T016 lands.
- **Phase 4 (US2)**: depends on Phase 3 (chart must exist before click-through can wire). T022 + T023.
- **Phase 5 (US3)**: depends on Phase 2 (T011 aggregator's capability-off path). T024 + T025 parallel.
- **Phase 6 (Polish)**: depends on Phases 2–5 all green. T026 first (regenerates demo data → other tasks read the regenerated state); T027/T028 parallel; T029 sequential; T030 sequential after T029; T031/T032 parallel.

### User Story Independence

- **US1 (P1)** is the MVP: the chart renders honestly under capability-on; without US2/US3 it's still useful (just no click-through, capability-off path is the existing dashboard).
- **US2 (P2)** adds click-through; can be deferred to a follow-up PR if scope pressure forced a split (NOT recommended per the locked single-PR scope, but technically independent).
- **US3 (P3)** is a safety property; verified by tests but no new production code beyond what FR-3-03 already mandates in the aggregator.

### Within Each User Story

- TDD: tests in 2.1 / 3.1 / 5.1 MUST be authored BEFORE the implementation tasks they verify. Implementation tasks PASS the tests.
- The reconciliation test (T007) and the chart unit tests (T015, T023) all expect the test floor to be bumped in the same commit (QG-43).
- The schema extension (T013) has zero impact on the per-PR PrRecord interface (locked by 310 schema-parity gate). T013 ONLY adds the `comments` sub-object — no edits to lines 96–98 of `rollup.schema.ts`.

### Parallel Opportunities

- All Phase 1 setup tasks marked [P] can run in parallel (5-way split on the 5 ADRs).
- Within Phase 2, T010 [P] runs alongside T006/T007/T008/T009 (different file). T013 [P] runs alongside T011/T012 (different file).
- Within Phase 3, T018 / T019 / T020 can be parallelized once T016 chart module is committed (T018 styles file, T019 barrel index, T020 HTML container — three different files).
- Phase 5 T024 + T025 parallel (Python integration + Extension dashboard test = different files).
- Phase 6 T027 + T028 + T031 + T032 parallel.

---

## Parallel Example: Phase 2 test scaffolding

```bash
# Launch all foundational TDD test scaffolding in parallel (different files):
Task: "T006 — Add FR-2-06 unit tests in tests/unit/test_aggregators.py"
Task: "T007 — Add FR-2-04 reconciliation test scaffold in tests/integration/test_comments_trend_reconciliation.py"
Task: "T008 — Add FR-2-04 (b) import-block isolation test in tests/integration/test_comments_trend_reconciliation_isolation.py"
Task: "T009 — Add FR-2-05 failure-mode meta-test in tests/integration/test_comments_trend_meta_failure.py"
Task: "T010 — Add schema validation tests in extension/tests/schema/rollup.test.ts"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup (T001–T005) — pin the 5 ADRs.
2. Phase 2 Foundational (T006–T014) — aggregator emits, schema accepts, reconciliation test green.
3. Phase 3 US1 (T015–T021) — chart renders.
4. **STOP and VALIDATE**: open the dashboard, confirm the chart appears, qualifier renders for partial weeks. MVP demo-able here. (Drill-down click-through and capability-off rigor are not yet in.)

### Incremental delivery (full PR scope)

5. Phase 4 US2 (T022–T023) — click-through.
6. Phase 5 US3 (T024–T025) — byte-identity verification.
7. Phase 6 Polish (T026–T032) — demo refresh + preflight + visual sign-off + SC-05 closure documentation.

### Single-developer pace

This is a foundation-PR with tight contracts; estimated effort ~2–3 days end-to-end for a familiar developer:
- Day 1: Phases 1 + 2 (investigation + foundational; ~14 tasks, mostly contract work).
- Day 2: Phase 3 (chart module; ~7 tasks, focused).
- Day 3: Phases 4 + 5 + 6 (click-through + capability-off + polish; ~10 tasks).

### Parallel team strategy

If staffed by two developers post-Phase-2:
- Developer A: Phase 3 (US1 chart implementation).
- Developer B: Phase 5 (US3 capability-off tests + Phase 4 US2 wiring once chart skeleton lands).
- Developer C / merge-back: Phase 6 polish + preflight.

---

## Notes

- Total task count: **32 tasks**.
- Per phase: Setup 5 / Foundational 9 / US1 7 / US2 2 / US3 2 / Polish 7.
- Test floor bumps (cumulative across the PR): roughly +12 Python (T006: +4, T007: +1, T008: +1, T009: +1, T012: +1 conditional, T024: +4) + ~20 Extension (T010: +5, T015: +8, T023: +3, T025: +4) — round-12 added +1 to T015 (chart-layer content idempotency) and +2 to T025 (FR-3-02 on/off-transition cleanup); round-13 added +1 more to T025 (dashboard-layer on→on re-render idempotency — closes the test gap left by round-12).
- Branch: `feat/333-comments-trend-chart` (already on it; conventional-commit prefix per `feedback_branch_naming_no_claude_prefix.md`).
- After all tasks complete and preflight is green, the user authorizes push (per `feedback_no_remote_push.md`); then `gh pr create` with the locked spec body. Do NOT push or PR-create without explicit per-action authorization.
- Codex stop-time review will fire on each commit per repo policy. Be prepared for round-10+ findings during implementation; treat each as a learning opportunity (the spec went 9 rounds; the implementation may surface additional contract gaps).
- `.specify/feature.json` already pins `feature_directory` to `specs/333-comments-trend-chart`; downstream commands will use that path.
