---

description: "Implementation tasks for #334 — Dashboard per-author comment density breakdown"
---

# Tasks: Dashboard per-author comment density breakdown

**Input**: Design documents from `specs/334-comments-author-density/`
**Prerequisites**: spec.md (8 CL-axes locked Path B 2026-04-27 + post-plan directives 1–4), plan.md, research.md (ADRs T001–T006), data-model.md, contracts/per-author-comments-density.md, quickstart.md
**Branch**: `feat/334-comments-author-density`
**Single PR scope**: foundation PR for the per-author dimension; siblings #335 (per-repo) and #336 (per-reviewer) inherit the visual + interaction pattern locked here.
**Tests**: REQUIRED — the spec mandates explicit tests for FR-1-* (producer unit), FR-2-04 / FR-2-05 (reconciliation + meta-failure extensions), FR-3-03 (byte-identity extension), FR-4-01..10 (chart unit + lifecycle), schema validator extension. Test-driven ordering: write tests first, expect failure, then implement.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to user stories from spec.md (US1 = P1 chart MVP, US2 = P2 sort toggle, US3 = P3 capability-off byte-identity, US4 = P3 sentinel rendering, US5 = P3 filter-not-supported posture)
- Setup, Foundational, and Polish phases have NO story label

## Path Conventions

- **Backend**: `src/ado_git_repo_insights/`, `tests/` at repo root
- **Extension**: `extension/ui/`, `extension/tests/`
- **Demo data**: `docs/data/`
- **Specs**: `specs/334-comments-author-density/`

## Constitution gates that bind every commit

- **QG-43** (per-commit ratchet bump): every commit that adds N tests MUST bump `.test-floor-contract.json` by exactly N in the SAME commit. Tasks below note the bump explicitly where tests are added.
- **QG-49** (single command, many callers): the SC-05 reconciliation extension is invoked via the standard `pytest tests/integration/` path used by pre-push preflight + CI; no new dedicated CommandSpec needed. The schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38) is intentionally NOT extended (CL-08 = follow 333 Decision 5).
- **QG-39 / QG-40 / QG-41 / QG-42**: cross-OS, no `typing.Any`, zero new inline suppressions, enterprise test coverage. See `reference_s608_refactor_pattern.md` for any dynamic-SQL pattern.
- **QG-38**: `--no-verify` forbidden.

---

## Phase 1: Setup (ADRs T001–T006 pre-pinned in research.md)

**Purpose**: Confirm the 6 ADRs from research.md are still applicable. No code changes in this phase — the ADR decisions are authoritative; this phase is a per-task confirmation gate so the implementer reads + acknowledges each ADR before downstream work begins.

- [ ] T001 [P] Confirm ADR T001 (chart module file name + structural template) per `specs/334-comments-author-density/research.md` § ADR T001 — chart module is `extension/ui/modules/charts/comments-author-density.ts`, modeled on 333's `comments-trend.ts` adapted for table/row rendering (no SVG bars/line). If the inheritance reference has shifted, update research.md and re-trigger /speckit.tasks before proceeding.
- [ ] T002 [P] Confirm ADR T002 (sort selector UI pattern) — button group, radio-style, three buttons (`comment_count` / `thread_count` / `active_thread_count`), keyboard-accessible per WAI-ARIA radio-group convention.
- [ ] T003 [P] Confirm ADR T003 (schema validator atomicity posture) — STRICT ERROR in both strict and permissive modes, mirrors 333 ADR T004. New validator function `validateAuthorCommentsDensity` lives alongside existing `validateCommentsAggregate` in `extension/ui/schemas/rollup.schema.ts`.
- [ ] T004 [P] Confirm ADR T004 (partial-coverage qualifier visual) — reuse 333 ADR T005's CSS conventions (hatched fill via `repeating-linear-gradient` + dimmed text + tooltip-explained legend item). The `.coverage-partial` class hook is shared with 333.
- [ ] T005 [P] Confirm ADR T005 (week-attribution rule reuse) — comments-author aggregator implements its own week-attribution using the same `closed_date → pd.to_datetime → .dt.isocalendar() → f"{year}-W{week:02d}"` formula throughput / 333 use. The existing per-PR week-attribution parity test (333's `tests/integration/test_week_attribution_parity.py` if 333 created it; pin path at task-execution time) catches drift between this aggregator and throughput.
- [ ] T006 [P] Confirm ADR T006 (sentinel literal name + label) — aggregator-side reserved Python `Final[str]` constant `__former_or_unavailable_author__`; renderer-side fixed-string label `"Former / unavailable author"` (English-only for v1). Constant declaration site is pinned by T014 below (must be in a module *other than* `aggregators.py` so the reconciliation test T009 can import it without violating 333 round-9 import-block isolation).

**Checkpoint**: All 6 ADRs confirmed. Subsequent tasks have deterministic targets.

---

## Phase 2: Foundational (Blocking prerequisites for all user stories)

**Purpose**: aggregator emission + schema extension + reconciliation test scaffolding. All 5 user stories depend on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### 2.1 — Test-first scaffolding (TDD: write tests, expect FAIL, then implement)

- [ ] T007 Add producer unit tests at `tests/unit/test_aggregators_author_comments.py`. Cover FR-1-* cases per data-model.md and quickstart §2: (i) all-extracted week → all entries `coverage_partial=false`, full sums; (ii) mixed-extraction author → `coverage_partial=true`, sums equal extracted-subset only; (iii) all-unextracted author → `coverage_partial=true`, all numeric=0 (sentinel and real authors alike); (iv) capability-off → no `by_author_comments` key emitted; (v) sentinel bucketing → unknown-to-`users` authors collapse into one entry keyed by `__former_or_unavailable_author__`; (vi) atomicity (FR-1-07) → entry has all 4 fields or absent; (vii) ordering (FR-1-08) → `active_thread_count <= thread_count` per entry including sentinel. Tests MUST currently FAIL (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 7 in same commit (QG-43).
- [ ] T008 Add producer determinism unit test at `tests/unit/test_aggregators_author_comments.py` (extending T007's file). Verify the aggregator's outer `by_author_comments` dict key order is ascending by author key — the stable identity string, including the reserved sentinel literal which sorts at the leading-`__` position. Display name MUST NOT influence the producer's sort order (per directive 3 + plan.md QG-05 row + contracts §2 Determinism). Test MUST currently FAIL (aggregator not implemented). Bump `.test-floor-contract.json` Python floor by 1 in same commit.
- [ ] T009 Extend the SC-05 reconciliation test in-place at `tests/integration/test_comments_trend_reconciliation.py` with per-author parity assertions (CL-04 = extend in-place). New assertions: (a) **FR-2-01 per-author pairwise** — for every PR P in the drill-down's top-500-by-cycle-time slice ∩ extracted-subset, P's per-PR PrRecord values equal P's contribution to `rollup[W].by_author_comments[<P's author OR sentinel>]`'s corresponding fields; (b) **FR-2-02 independent re-computation** — for each (W, author) tuple, aggregator emission equals the result of an independent re-computation that grounds outside `aggregators.py` (333 round-9 import-block isolation extends automatically — constraint is by-FILE, not by-dimension; the test imports the sentinel literal from the T014 constants module, not from `aggregators.py`); (c) **FR-2-03 sentinel parity** — for each W, the sentinel bucket's metrics equal the SUM of contributions from ALL PRs whose `author_id` is absent from `users`. Tests MUST currently FAIL on demo (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 3 in same commit.
- [ ] T010 Extend the FR-2-05 failure-mode meta-test at `tests/integration/test_comments_trend_meta_failure.py` with a per-author INV-2-07 violation injection. Mutate one week's `rollup[W].by_author_comments[<some author OR sentinel>]` entry to violate INV-2-07 (`active_thread_count > thread_count`) in a `tmp_path` working copy of the manifest; assert that the FR-2-04 reconciliation test (T009) FAILS on the mutated dataset. Test MUST currently SKIP / XFAIL (T009 + T013 must land before this can evaluate cleanly). Add `xfail(strict=False, reason="depends on T009 + T013 making the per-author reconciliation green on clean demo")` marker for collection-stability per Principle XXVI. Bump `.test-floor-contract.json` Python floor by 1 in same commit.
- [ ] T011 Extend `tests/integration/test_demo_variants_byte_identity.py` `_GATED_*` set per FR-3-03. Add `"by_author_comments"` to the existing rollup-level gated namespace strip set (333 added `"comments"`; this feature adds the per-author sibling). The 4 omission failure modes (key absent / `null`-valued / `{}`-valued / partial-fielded) gate individually per the existing pattern; each mode is a parameterized test row. Tests MUST currently FAIL until T013 emission emits-and-omits correctly. Bump `.test-floor-contract.json` Python floor by 4 in same commit.
- [ ] T012 [P] Add schema validator tests at `extension/tests/schema/rollup.test.ts` (extending the existing 333 schema test file). Cases: (a) valid 4-field entry passes; (b) partial entry (missing one field) → atomicity error in BOTH strict and permissive modes per ADR T003; (c) null-valued numeric fields fail; (d) rollup without `by_author_comments` key passes (capability-off scenario); (e) wrong-typed fields fail (e.g., `thread_count` is a string); (f) `active_thread_count > thread_count` per entry → ordering error (INV-2-07); (g) entry with `__former_or_unavailable_author__` as key passes. Tests MUST currently FAIL (validator not extended yet). Bump `.test-floor-contract.json` Extension floor by 7 in same commit.

**Checkpoint 2.1**: Test infrastructure exists. All FR-1 / FR-2 / FR-3-03 + schema tests are RED. The 333 import-block isolation test (`tests/integration/test_comments_trend_reconciliation_isolation.py`) automatically covers T009 since aggregator imports remain forbidden by file (no further isolation work needed).

### 2.2 — Sentinel constant declaration (ADR T006)

- [ ] T014 Declare the sentinel literal as a single Python `Final[str]` constant per ADR T006. **Decoupling requirement**: the constant MUST live in a module OTHER than `src/ado_git_repo_insights/transform/aggregators.py` so the reconciliation test (T009) can import it without violating 333 round-9 import-block isolation. Pin at task time: prefer `src/ado_git_repo_insights/transform/__init__.py` (already exists) OR a new `src/ado_git_repo_insights/transform/constants.py` module. Constant name: `FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL`. Value: `"__former_or_unavailable_author__"`. Used by T013 emission code AND by T009 reconciliation test's independent re-computation.

### 2.3 — Aggregator emission (FR-1-01..08 + INV-2-07/08)

- [ ] T013 Implement `by_author_comments` emission in `src/ado_git_repo_insights/transform/aggregators.py` `_generate_weekly_rollups()`. When `_has_comments()` returns true: for each week W, determine W's canonical throughput PR set via the ADR T005-pinned week-attribution path; for each PR resolve its author identifier with LEFT JOIN to `users` (PRs absent from `users` map to the sentinel constant from T014); group by author-or-sentinel; for each bucket: filter to extracted-subset (`comments_extracted_at IS NOT NULL`), apply C1 inclusion rules to `pr_threads` + `pr_comments`, sum to produce `thread_count` / `comment_count` / `active_thread_count`, derive `coverage_partial` per FR-1-06 (true iff any of that author's PRs in W's canonical set has `comments_extracted_at IS NULL`); build outer dict with keys ascending by author key (per directive 3 + contracts §2 Determinism); emit on rollup root atomically; if outer dict empty, omit the `by_author_comments` key entirely (FR-3-03 omission contract). SQL pattern per `contracts/per-author-comments-density.md` §2 — use `" ".join([...])` for any dynamic-SQL parts (S608 compliance per `reference_s608_refactor_pattern.md`); never `# noqa: S608`. Verify: T007 cases (i)–(vii) PASS; T008 determinism PASSES; T009 reconciliation PASSES; T010 meta-test passes (xfail flips to xpass-strict-False on green demo, then fails on mutated demo as designed); T011 byte-identity PASSES.

### 2.4 — Schema extension (rollup.schema.ts)

- [ ] T015 [P] Extend `extension/ui/schemas/rollup.schema.ts` with: (a) new `AuthorCommentsDensityEntry` interface (`thread_count: number; comment_count: number; active_thread_count: number; coverage_partial: boolean`); (b) optional `by_author_comments?: Record<string, AuthorCommentsDensityEntry>` field on the existing `Rollup` interface; (c) `"by_author_comments"` added to the `KNOWN_ROOT_FIELDS` set; (d) new `validateAuthorCommentsDensity(value, path)` validator function alongside existing `validateCommentsAggregate` (333) — STRICT ERROR atomicity in both modes per ADR T003; numeric fields integer + non-negative; INV-2-07 ordering check per entry; sentinel literal as key permitted (no special handling — just another string). DO NOT extend the per-PR `PrRecord` declarations (locked by 310's schema-parity gate; CL-08 = follow 333 non-extension). Verify: T012 schema tests PASS.

### 2.5 — Test floor accounting

- [ ] T016 Verify `.test-floor-contract.json` matches actual added test count after T007–T015. Sum: T007 (+7), T008 (+1), T009 (+3), T010 (+1), T011 (+4) = +16 Python; T012 (+7) Extension. Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` locally to verify floor==actual on both Python and Extension suites. If actual differs from sum, reconcile by either correcting the floor or auditing T007–T015 for unintended test additions.

**Checkpoint 2 (Foundational complete)**: `rollup[W].by_author_comments` is emitted by the aggregator under capability-on; schema validator accepts the new sub-object; reconciliation extension + meta + byte-identity tests are GREEN; sentinel constant is available for downstream code. **All user stories can now begin.**

---

## Phase 3: User Story 1 — Identify highest-load authors at a glance (Priority: P1) 🎯 MVP

**Goal**: dashboard renders the new per-author comment-density breakdown surface on the Metrics tab; team lead identifies the top-`comment_count` author with no interaction beyond visual scan; partial-coverage qualifier prevents misreading partial-author rows.

**Independent Test** (per spec): Open a demo dashboard with `capabilities.comments_metrics` enabled and ≥10 distinct authors with mixed comment-load. Confirm a chart titled with author/density vocabulary renders below the 333 comments-trend chart on the Metrics tab. Confirm rows are ordered by `comment_count` desc. Confirm the date-range filter narrows the visible set when changed. (US2 / US3 / US4 / US5 are NOT required for this test.)

### 3.1 — Chart-module test scaffolding (TDD)

- [ ] T017 [US1] Add `extension/tests/modules/charts/comments-author-density.test.ts` chart unit tests. Cover FR-4-01..06 + idempotency: (a) chart renders rows for the top-50-by-`comment_count`-desc on a 12-author fixture; each row shows author display name + 3 numeric metrics; (b) chart re-renders correctly when range filter narrows; (c) chart renders truncation indicator when input exceeds the cap (53-author fixture → 50 visible + truncation indicator); (d) FR-4-03 partial-coverage qualifier on rows where reduced `coverage_partial` is `true`; (e) deterministic UI tie-break per directive 3 — chosen-metric desc → display name asc → author key asc as final tie-breaker (covers a duplicate-display-name fixture); (f) FR-4-09 no click-through (rows have no `data-drilldown-*` attribute or click handler); (g) FR-4-10 a11y — rows expose metrics via screen-reader-readable text; sort-selector buttons are keyboard-activatable per WAI-ARIA radio-group; (h) **chart-layer idempotency** — calling the chart module's render function twice on the same container produces ONE chart, not two (no duplicated rows / no duplicated legend); content is replaced via the throughput / 333-style `renderTrustedHtml` pattern. Tests MUST currently FAIL (chart module doesn't exist). Bump `.test-floor-contract.json` Extension floor by 8 in same commit.

### 3.2 — Chart module implementation

- [ ] T018 [US1] Create new chart module at `extension/ui/modules/charts/comments-author-density.ts` modeled on `extension/ui/modules/charts/comments-trend.ts` (333). Reads `Rollup[]` and accesses `rollup[W].by_author_comments` per week. Reduces per-author across visible weeks: sums for the 3 numeric fields; OR-reduces `coverage_partial` per FR-1-06 reduction rule (range-total `true` if any constituent week's per-(week, author) `coverage_partial` is `true`). Renders rows in a table-equivalent semantic structure (HTML `<table>` or list role-table — pin at task time per FR-4-10 a11y). Display cap: declare `MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50` constant (modeled on 333's `MAX_COMMENTS_TREND_POINTS`). Truncation indicator via shared `renderTruncationIndicator` from `chart-layout`. Does NOT add click-through (FR-4-09 — rows are not clickable). Verify: T017 cases (a)–(c) and (e)–(h) PASS.
- [ ] T019 [US1] Implement partial-coverage visual qualifier in `comments-author-density.ts` per ADR T004 (hatched fill + dimmed + tooltip — reuse 333's `.coverage-partial` CSS class hook). Apply ONLY to rows where the row's reduced range-total `coverage_partial` is `true` (FR-4-03). Verify: T017 case (d) PASS.
- [ ] T020 [US1] Implement the sort-selector UI control in `comments-author-density.ts` per ADR T002 — three `<button>` elements with `role="radio"` + `aria-checked`, wrapped in a container with `role="radiogroup"`; tab focus enters the group, arrow keys move within, Enter / Space activates; default selection `comment_count`. (Sort behavior wiring — i.e., the click handler that re-renders rows with the new metric — is T026 in US2; this task covers ONLY the UI scaffold.)
- [ ] T021 [US1] Implement no-data and dimension-filter short-circuits at the top of the chart's render function. Filter-not-supported short-circuit (FR-4-07): if any of `filters.{repos, teams, authors, reviewers}` is non-empty, render `renderNoData(container, "...filter-not-supported...", "...")` with a message visibly distinct from no-data-in-range. No-data-in-range (FR-4-08): when reduced rows are empty (capability-on but zero contributions), render distinct empty state. (Tests for these in T027 / T031 below — US3 / US5 phases.)
- [ ] T022 [US1] Add CSS styles for the new chart in `extension/ui/styles.css`: row-table layout (high-contrast text in light + dark themes) + sort-selector button group + active-button visual indicator. Reuse 333's `.coverage-partial` rule for the partial qualifier (the class hook is shared); add only per-row variant rules if the existing class doesn't render correctly for table rows.
- [ ] T023 [US1] Register the new chart in `extension/ui/modules/charts/index.ts` barrel export. Add a one-line export for `comments-author-density`.

### 3.3 — Dashboard wiring

- [ ] T024 [US1] Wire the new chart into `extension/ui/dashboard.ts` with two helper functions, mirroring 333's lifecycle pattern: (1) `ensureCommentsAuthorDensityContainer(): HTMLElement | null` — returns existing element if present (REUSE — no duplicate insertion); else builds the chart row from scratch via `document.createElement` chain (`.charts-row > .chart-container > <div id="comments-author-density" class="chart">`), tags the row with `data-comments-author-density-row="true"` for cleanup discoverability, appends below the comments-trend row's parent `.charts-row`. (2) `removeCommentsAuthorDensityContainer(): void` — finds any element matching `[data-comments-author-density-row="true"]` and removes it (no-op if absent). On Metrics tab render: if `capabilityState?.commentsMetricsAvailable === true`, call `ensureCommentsAuthorDensityContainer()` → invoke the chart module's render function with the dashboard's `FilterState`. If capability-off, call `removeCommentsAuthorDensityContainer()`. At any moment when capability is off, Metrics tab DOM MUST be byte-identical to pre-feature (FR-3-01 + SC-1-03 + FR-3-02 lifecycle parity; tests in T027 below).

**Checkpoint US1**: per-author breakdown chart renders on the Metrics tab when capability-on; rows ordered by `comment_count` desc; sort selector visible (default `comment_count` active); partial-coverage qualifier on partial rows; range filter honored; T017 all green. US1 deliverable is INDEPENDENTLY verifiable per the spec's Independent Test.

---

## Phase 4: User Story 2 — Toggle the chosen sort metric (Priority: P2)

**Goal**: clicking each of the three sort-metric buttons re-orders rows; deterministic tie-break is reproducible across reloads (display name asc → author key asc as final tie-breaker per directive 3).

**Independent Test**: With the chart rendered (US1), activate each sort-metric option. Confirm rows re-order and the active metric is visually indicated. Tie-break order is reproducible across reloads.

### 4.1 — Sort toggle test scaffolding

- [ ] T025 [US2] Add tests to `extension/tests/modules/charts/comments-author-density.test.ts` (extending T017's file). Cases: (a) clicking the `thread_count` button re-orders rows by `thread_count` desc; the `aria-checked` indicator updates to mark `thread_count` as the active button; (b) clicking the `active_thread_count` button re-orders by `active_thread_count` desc; (c) tie-break is reproducible across page reloads under the same dataset (use a fixture with deliberate ties on `comment_count` AND on display name; verify final order is determined by author key per directive 3); (d) keyboard activation (Enter / Space on a focused button) re-orders correctly. Tests MUST currently FAIL (T020 wired the UI skeleton but not the toggle behavior). Bump `.test-floor-contract.json` Extension floor by 4 in same commit.

### 4.2 — Sort toggle implementation

- [ ] T026 [US2] Wire the three sort-selector buttons in `comments-author-density.ts` (extending T020's UI scaffold) to update the chart's selected metric and re-render rows. Tie-break order: (1) chosen metric desc, (2) display name asc, (3) author key asc as the final deterministic tie-breaker (per directive 3 + FR-4-05). Verify: T025 cases (a)–(d) PASS.

**Checkpoint US2**: sort toggle works with deterministic tie-break. T025 green.

---

## Phase 5: User Story 3 — Capability-off renders byte-identical to the prior baseline (Priority: P3)

**Goal**: datasets without `capabilities.comments_metrics` MUST see the dashboard render identically to the pre-feature baseline — no per-author breakdown container, no shifted layout, no new banner. Capability flips on / off MUST clean up correctly (333 T021 / T025 lifecycle parity).

**Independent Test**: Load a dataset variant with `capabilities.comments_metrics: false`. Confirm the Metrics tab renders identically to the pre-feature baseline (existing chart surfaces at pre-feature positions; no per-author breakdown container).

### 5.1 — Dashboard lifecycle test (extension-side capability-off byte-identity)

- [ ] T027 [US3] Add an extension dashboard-lifecycle test at `extension/tests/dashboard/comments-author-density-lifecycle.test.ts`. Test 4 scenarios per FR-3-01 + FR-3-02 + SC-1-03: (a) **Initial capability-off**: with `capabilities.comments_metrics: false` from the start, no element with `id="comments-author-density"` is mounted; no element with `[data-comments-author-density-row="true"]` is mounted; the existing chart surfaces (333 comments-trend container also omitted per 333 FR-3-01) occupy the same layout positions; the Metrics tab DOM is byte-identical to the pre-feature baseline. (b) **On→off transition**: render dashboard once with capability-on (chart row inserted via `ensureCommentsAuthorDensityContainer`), reload with capability-off, assert `removeCommentsAuthorDensityContainer` cleaned up — no `id="comments-author-density"`, no `[data-...]` attribute, layout pristine. (c) **Off→on transition**: render with capability-off, reload with capability-on, assert chart row inserted exactly once. (d) **On→on re-render idempotency**: render the FULL DASHBOARD render path twice consecutively with capability-on (this calls `ensureCommentsAuthorDensityContainer()` + the chart module's render function each time, simulating dataset-reload / filter-change / tab-switch-back paths). Assert exactly ONE `[data-comments-author-density-row="true"]` element exists; exactly ONE `<div id="comments-author-density">` exists; rows inside the chart are not concatenated / duplicated from the first render. Bump `.test-floor-contract.json` Extension floor by 4 in same commit.

(Capability-off byte-identity at the rollup / manifest level is already covered by T011 in Phase 2.)

**Checkpoint US3**: capability-off renders pre-feature baseline; FR-3-03 byte-identity test (T011) green; FR-3-02 lifecycle test (T027) green.

---

## Phase 6: User Story 4 — Sentinel rendering for "Former / unavailable author" (Priority: P3)

**Goal**: datasets containing ≥1 unknown-to-`users` author render exactly ONE row labeled "Former / unavailable author" aggregating ALL such PRs' contributions; sentinel row participates in sort like real authors.

**Independent Test**: Load a demo dataset with ≥1 PR whose `author_id` is absent from `users`. Open the breakdown. Confirm exactly ONE sentinel row, summed metrics, sort participation.

### 6.1 — Sentinel rendering tests

- [ ] T028 [US4] Add tests to `extension/tests/modules/charts/comments-author-density.test.ts` (extending T017 / T025): (a) the rendered row for the sentinel key uses the fixed-string label `"Former / unavailable author"` (NOT the raw key string `__former_or_unavailable_author__`); (b) sentinel row participates in sort by metric value (NOT pinned to top / bottom); (c) dataset with zero unknown-to-`users` PRs in range → no sentinel row appears. Bump `.test-floor-contract.json` Extension floor by 3 in same commit.

### 6.2 — Sentinel safety unit test

- [ ] T029 [US4] [P] Add a Python sentinel-safety unit test at `tests/unit/test_aggregators_author_comments.py` (extending T007 / T008's file). Asserts the sentinel literal `__former_or_unavailable_author__` does NOT appear as an `author_id` value across the demo + golden test fixtures (verify via grep / scan over the test fixture directory + any seeded SQLite fixtures the existing 333 tests use). Catches the failure mode where a real author_id collides with the sentinel literal. Bump `.test-floor-contract.json` Python floor by 1 in same commit.

### 6.3 — Sentinel rendering implementation

- [ ] T030 [US4] Wire the sentinel-key → sentinel-label mapping in `comments-author-density.ts`'s row-rendering code. When iterating rows: `if (row.key === "__former_or_unavailable_author__") displayLabel = "Former / unavailable author"; else displayLabel = <existing authorsDimension display-name lookup>`. Pin the existing `authorsDimension` lookup API at task time (the implementer reads `extension/ui/dataset-loader.ts` / `extension/ui/types.ts` to confirm the shape). The sentinel literal is hard-coded as a TS constant in the chart module (NOT imported from a shared module — keep the renderer self-contained per ADR T006). Verify: T028 cases (a)–(c) PASS.

**Checkpoint US4**: sentinel row renders correctly; safety test green.

---

## Phase 7: User Story 5 — Filter-not-supported posture (Priority: P3)

**Goal**: when ANY dashboard dimension filter is active (`repos` / `teams` / `authors` / `reviewers`), the breakdown surface shows a self-explanatory filter-not-supported empty state instead of rows. Disappears cleanly when filters are cleared.

**Independent Test**: With the chart rendered (US1), apply any dashboard dimension filter. Confirm filter-not-supported empty state appears (visibly distinct from no-data-in-range); clear filter, confirm rows reappear.

### 7.1 — Filter-not-supported tests

- [ ] T031 [US5] Add tests to `extension/tests/modules/charts/comments-author-density.test.ts` (extending T017 / T025 / T028): (a) any of `filters.{repos, teams, authors, reviewers}` non-empty → render shows filter-not-supported empty state; (b) clearing the filter restores the rows; (c) filter-not-supported empty state is visibly distinct from no-data-in-range (FR-4-08) — different message text, different DOM marker. Bump `.test-floor-contract.json` Extension floor by 3 in same commit.

(Filter-not-supported short-circuit logic was implemented in T021. T031 adds the tests proving it works.)

**Checkpoint US5**: filter-not-supported empty state renders correctly when any filter is active.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: regenerate every managed artifact via the canonical sync, verify ratchet + coverage parity. Per directive 4, the canonical sync drives ALL managed outputs in ONE task — no per-managed-path manual regenerate tasks.

- [ ] T032 Regenerate ALL managed artifacts via the canonical command per directive 4 + `reference_managed_artifacts_sync.md`: `python scripts/manage_generated_artifacts.py sync --scope all --stage`. The `--stage` flag is REQUIRED (without it, the verify gate fails). The canonical sync drives `extension/ui/dist/` rebuilds (esbuild bundles for the new chart module) + `docs/data/aggregates/weekly_rollups/*.json` (rollup JSONs gain the `by_author_comments` namespace under capability-on) + `docs/data/dataset-manifest.json` + any sibling managed paths. Then run `python scripts/manage_generated_artifacts.py verify` to confirm working tree clean against the index post-stage.
- [ ] T033 [P] Ratchet bump sanity check: `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`. Confirm floor == actual on both Python and Extension. Cumulative target across all phases: +17 Python (T007 +7, T008 +1, T009 +3, T010 +1, T011 +4, T029 +1) + +29 Extension (T012 +7, T017 +8, T025 +4, T027 +4, T028 +3, T031 +3). If drift detected, reconcile (correct the floor or audit task commits for unintended test additions). NO `[ratchet-realignment]` marker should be needed for a clean foundation PR.
- [ ] T034 [P] Coverage delta check: `python scripts/check_coverage_delta.py`. Confirm ≤ 2% drop vs `.coverage-baseline.json` per QG-52. NO `[threshold-update]` marker should be needed.

**Checkpoint**: All managed artifacts staged + clean; ratchet + coverage gates green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: ADRs T001–T006 already pinned in research.md — confirmation only; no dependencies.
- **Foundational (Phase 2)**: BLOCKS all user stories. Test scaffolding (T007–T012) → Sentinel constant (T014) → Aggregator emission (T013) → Schema extension (T015) → Floor accounting (T016).
- **US1 (Phase 3, MVP)**: Depends on Foundational (Phase 2 complete).
- **US2 (Phase 4)**: Depends on Foundational + US1 (chart module + sort-selector UI scaffold from T020).
- **US3 (Phase 5)**: Depends on Foundational + US1 (dashboard wiring from T024).
- **US4 (Phase 6)**: Depends on Foundational + US1 (chart module from T018). Sentinel safety test (T029) is independent and can run in parallel with anything.
- **US5 (Phase 7)**: Depends on Foundational + US1 (filter-not-supported short-circuit from T021).
- **Polish (Phase 8)**: Depends on all of the above being complete.

### User Story Dependencies

- **US1 (P1, MVP)**: First user story; all others depend on its chart module + dashboard wiring.
- **US2–US5 (P2, P3)**: All depend on US1's chart module. Can run in parallel with each other after US1 completes (different test cases within the same test files, different implementation surfaces).

### Within Each User Story

- Tests (T017, T025, T027, T028, T029, T031) MUST be written and FAIL before implementation.
- Chart module skeleton (T018) before partial qualifier (T019) before sort-selector UI scaffold (T020) before short-circuits (T021).
- Sort toggle implementation (T026) extends T020's UI scaffold.
- Sentinel mapping (T030) extends T018's row-rendering code.
- Story complete before moving to next priority.

### Parallel Opportunities

- ADR confirmation (T001–T006): all parallel within Setup.
- T012 (extension schema tests) parallel with T007–T011 (Python tests) within Phase 2.1 (different files / runtimes).
- T015 (schema extension) parallel with T013–T014 (aggregator emission) within Phase 2 (different files).
- US2 / US3 / US4 / US5 phases: can run in parallel after US1 completes (different test cases within `extension/tests/...` test files; the `.test-floor-contract.json` bump per commit is the synchronization point, not the source files).
- T029 (sentinel safety unit test) parallel with anything in Phases 3–7.
- T033 / T034 (ratchet + coverage check) parallel within Polish.

---

## Parallel Example: Foundational Phase

```bash
# Test-first scaffolding — launch in parallel where files differ:
Task: T007 producer unit tests at tests/unit/test_aggregators_author_comments.py
Task: T009 reconciliation extension at tests/integration/test_comments_trend_reconciliation.py
Task: T011 byte-identity extension at tests/integration/test_demo_variants_byte_identity.py
Task: T012 schema validator tests at extension/tests/schema/rollup.test.ts

# After tests are written + failing, implementation in parallel where files differ:
Task: T013 aggregator emission at src/ado_git_repo_insights/transform/aggregators.py
Task: T014 sentinel constant at src/ado_git_repo_insights/transform/__init__.py (or constants.py)
Task: T015 schema extension at extension/ui/schemas/rollup.schema.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (ADRs already pinned — confirmation only).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1 — chart renders.
4. **STOP and VALIDATE**: Test US1 independently per the spec's Independent Test.
5. Deploy / demo if ready.

### Incremental Delivery

1. Setup + Foundational → Foundation ready.
2. US1 → Test independently → Deploy / Demo (MVP).
3. US2 (sort toggle) → Test independently → Deploy / Demo.
4. US3 (capability-off lifecycle) → Test independently → Deploy / Demo.
5. US4 (sentinel rendering) → Test independently → Deploy / Demo.
6. US5 (filter-not-supported posture) → Test independently → Deploy / Demo.
7. Polish → Final cohesive check + canonical artifact sync.

### Parallel Team Strategy

After Foundational completes:
- Developer A: US1 (chart module + dashboard wiring, the MVP).
- Developer B: US2 (sort toggle — can start once US1 chart module skeleton + UI scaffold exist).
- Developer C: US3 (capability-off lifecycle test — can start once US1 dashboard wiring exists).
- Developer D: US4 (sentinel rendering — once US1 chart module exists; sentinel safety unit test T029 is fully independent) + US5 (filter-not-supported tests — once US1 short-circuit T021 exists).

---

## Notes

- **Cumulative test additions**: Phase 2 +16 Python +7 Extension; Phase 3 +8 Extension; Phase 4 +4 Extension; Phase 5 +4 Extension; Phase 6 +1 Python +3 Extension; Phase 7 +3 Extension. **Cumulative target**: +17 Python + +29 Extension across the PR. Verified at task time via `scripts/check_ratchet_bump.py` (T033).
- **Constitution gates**: every commit honors QG-38 (no `--no-verify`), QG-39 (cross-OS), QG-40 (no `typing.Any`), QG-41 (zero new suppressions), QG-43 (per-commit ratchet bump). The QG-50 bypass markers are subject-line-only; no markers are expected for a clean foundation PR.
- **Schema-parity gate (CL-08)**: NOT extended for the new namespace. The reconciliation test (T009) is the parity authority for `by_author_comments`.
- **Import-block isolation (333 round-9)**: extends automatically for T009 / T010 since the `aggregators.py` import-forbid is by-FILE not by-dimension. T014 places the sentinel constant outside `aggregators.py` to keep the test's import path clean.
- **Sentinel literal (ADR T006)**: declared as a single Python `Final[str]` constant in T014; aggregator emission (T013) and reconciliation test (T009) both import the constant from the same module. The renderer-side TS string in T030 is hard-coded (the chart module is renderer-self-contained per ADR T006).
- **Canonical artifact sync (directive 4)**: T032 is the SINGLE task for regenerating managed artifacts. It drives `extension/ui/dist/` (esbuild) + `docs/data/` (demo rollups + manifest) + any sibling managed paths via `manage_generated_artifacts.py sync --scope all --stage` followed by `verify`. Per-managed-path manual regenerate tasks are explicitly forbidden by user directive.
- **NO new wall-clock performance assertions** (per directive 2): chart-render budget is governed by QG-28's existing 1000ms / 156-week scalability gate; aggregator runtime is governed by existing producer test-suite wall-clock budgets only. Single-run wall-clock assertions are CI-flake bait and are NOT generated.
