---

description: "Implementation tasks for #335 — Dashboard per-repo comment density breakdown"
---

# Tasks: Dashboard per-repo comment density breakdown

**Input**: Design documents from `specs/335-comments-repo-density/`
**Prerequisites**: spec.md (10 CL-axes locked Path B 2026-04-28), plan.md, research.md (ADRs R001–R003), data-model.md, contracts/per-repo-comments-density.md, quickstart.md
**Branch**: `feat/335-comments-repo-density`
**Single PR scope**: second sibling Cap-2 dimension PR after #334 (per-author, PR #349 merged); inherits the visual + interaction pattern duplicated from 334 per A-08 (abstraction extraction deferred to #336).
**Tests**: REQUIRED — the spec mandates explicit tests for FR-1-* (producer unit), FR-2-04 / FR-2-05 (reconciliation + meta-failure extensions including the NEW FR-2-03 cross-aggregate sum-coherence assertion), FR-3-03 (byte-identity extension), FR-3-04 (F3 live-loader regression), FR-4-01..11 (chart unit + lifecycle including the FR-4-11 raw-ID fallback unit test), schema validator extension. Test-driven ordering: write tests first, expect failure, then implement.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to user stories from spec.md (US1 = P1 chart MVP, US2 = P2 sort toggle, US3 = P3 capability-off byte-identity, US4 = P3 filter-not-supported posture). NO US5 — the per-author dimension's sentinel-rendering story (334 US4) does NOT apply to per-repo per CL-03.
- Setup, Foundational, and Polish phases have NO story label

## Path Conventions

- **Backend**: `src/ado_git_repo_insights/`, `tests/` at repo root
- **Extension**: `extension/ui/`, `extension/tests/`
- **Demo data**: `docs/data/`, `scripts/generate-demo-data.py`
- **Specs**: `specs/335-comments-repo-density/`

## Constitution gates that bind every commit

- **QG-43** (per-commit ratchet bump): every commit that adds N tests MUST bump `.test-floor-contract.json` by exactly N in the SAME commit. Tasks below note the bump explicitly where tests are added.
- **QG-49** (single command, many callers): the SC-05 reconciliation extension is invoked via the standard `pytest tests/integration/` path used by pre-push preflight + CI; no new dedicated CommandSpec needed. The schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38) is intentionally NOT extended (CL-08 = follow 333 Decision 5 / 334 CL-08).
- **QG-39 / QG-40 / QG-41 / QG-42**: cross-OS, no `typing.Any`, zero new inline suppressions, enterprise test coverage. See `reference_s608_refactor_pattern.md` for any dynamic-SQL pattern.
- **QG-38**: `--no-verify` forbidden.
- **Partial-branches ratchet gate** (`.coverage-partial-branches-baseline.json`): NOT permitted to grow. Apply the same tie-break-ternary collapse 334 used to keep the ratchet at zero, OR cover defensive branches with mutation-based tests.

---

## Phase 1: Setup (ADRs R001–R003 pre-pinned in research.md)

**Purpose**: Confirm the 3 ADRs from research.md are still applicable. No code changes in this phase — the ADR decisions are authoritative; this phase is a per-task confirmation gate.

- [ ] T001 [P] Confirm ADR R001 (chart module file name + display-label-fallback wiring) per `specs/335-comments-repo-density/research.md` § ADR R001 — chart module is `extension/ui/modules/charts/comments-repository-density.ts`, modeled on `extension/ui/modules/charts/comments-author-density.ts` (PR #349) with sentinel branch removed (CL-03) and `repositoriesDimension`-fed label resolution with raw `repository_id` fallback (CL-04 / FR-4-11). If the inheritance reference has shifted, update research.md and re-trigger /speckit.tasks before proceeding.
- [ ] T002 [P] Confirm ADR R002 (cross-aggregate sum-coherence test placement, NEW for this feature) — extend `tests/integration/test_comments_trend_reconciliation.py` in-place; sum-coherence assertion is week-agnostic (auto-discovers truncated weeks via `_prs_truncated: true` introspection, so it survives demo regeneration if W26 truncation shifts).
- [ ] T003 [P] Confirm ADR R003 (failure-mode meta-test extension) — extend `tests/integration/test_comments_trend_meta_failure.py` in-place with TWO injections: (a) per-(week, repo) `active_thread_count > thread_count` violation, (b) per-week sum-coherence violation (mutate one repo's `thread_count` to break FR-2-03).

**Checkpoint**: All 3 ADRs confirmed. Subsequent tasks have deterministic targets.

---

## Phase 2: Foundational (Blocking prerequisites for all user stories)

**Purpose**: aggregator emission + schema extension + demo generator parallel path + reconciliation test scaffolding. All 4 user stories depend on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### 2.1 — Test-first scaffolding (TDD: write tests, expect FAIL, then implement)

- [ ] T004 Add producer unit tests at `tests/unit/test_aggregators_repo_comments.py`. Cover FR-1-* cases per data-model.md and quickstart §2: (i) all-extracted week → all entries `coverage_partial=false`, full sums; (ii) mixed-extraction repo → `coverage_partial=true`, sums equal extracted-subset only; (iii) all-unextracted repo → `coverage_partial=true`, all numeric=0 (bucket still emitted with atomic 4-field shape); (iv) capability-off → no `by_repository_comments` key emitted; (v) atomicity (FR-1-07) → entry has all 4 fields or absent; (vi) ordering (FR-1-08) → `active_thread_count <= thread_count` per entry; (vii) full extracted-subset scope (FR-1-09) → emission covers W's full canonical PR set, not the drill-down slice. NOT included: sentinel collision-safety test (334 T029 equivalent — explicitly omitted per CL-03). Tests MUST currently FAIL (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 7 in same commit (QG-43).
- [ ] T005 Add producer determinism unit test at `tests/unit/test_aggregators_repo_comments.py` (extending T004's file). Verify the aggregator's outer `by_repository_comments` dict key order is ascending by `repository_id`. Display name MUST NOT influence the producer's sort order (per contracts §2 Determinism). Test MUST currently FAIL. Bump `.test-floor-contract.json` Python floor by 1 in same commit.
- [ ] T006 Extend the SC-05 reconciliation test in-place at `tests/integration/test_comments_trend_reconciliation.py` with per-repo parity assertions per CL-05. Three new assertions: (a) **FR-2-01 per-repo pairwise** — for every PR P in the drill-down's top-500-by-cycle-time slice ∩ extracted-subset, P's per-PR PrRecord values equal P's contribution to `rollup[W].by_repository_comments[<P.repository_id>]`'s corresponding fields; (b) **FR-2-02 independent re-computation** — for each (W, repo) tuple, aggregator emission equals an independent re-computation grouped by `repository_id` against direct SQL (333 round-9 / 334 import-block isolation extends automatically — constraint is by-FILE not by-dimension); (c) **FR-2-03 cross-aggregate sum-coherence (NEW)** — for every week W where both `comments` and `by_repository_comments` are emitted, SUM_repo of each numeric field EQUALS `comments.numeric_field`, AND OR_repo of `coverage_partial` EQUALS `comments.coverage_partial`. The sum-coherence assertion auto-discovers truncated weeks via `_prs_truncated: true` introspection (week-agnostic per A-11). **Pre-loop fixture guard**: assert that at least ONE week W in the demo dataset satisfies "both `comments` AND `by_repository_comments` are emitted (non-empty)" — otherwise the sum-coherence loop iterates zero weeks and silently passes (no positive control). The guard fails loudly with a clear message identifying that demo regeneration has shifted the witness; A-11 documents the spec-level assumption this guard enforces. Tests MUST currently FAIL on demo (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 3 in same commit.
- [ ] T007 Extend the FR-2-05 failure-mode meta-test at `tests/integration/test_comments_trend_meta_failure.py` with TWO new injections per ADR R003: (a) per-(week, repo) INV-3-07 violation — mutate one bucket's emission so `active_thread_count > thread_count`; assert FR-2-04 reconciliation test (T006) FAILS on the mutated copy; (b) per-week sum-coherence violation — mutate one bucket's `thread_count` so the per-repo sum no longer matches `comments.thread_count`; assert FR-2-04 reconciliation test (T006) FAILS on the mutated copy. Tests MUST currently SKIP / XFAIL until T006 + T011 land green on clean demo (use `xfail(strict=False, reason="depends on T006 + T011")` for collection-stability per Principle XXVI). Bump `.test-floor-contract.json` Python floor by 2 in same commit.
- [ ] T008 Extend `tests/integration/test_demo_variants_byte_identity.py` `_GATED_*` set per FR-3-03. Add `"by_repository_comments"` to the existing rollup-level gated namespace strip set (333 added `"comments"`; 334 added `"by_author_comments"`; this feature adds the per-repo sibling). The 4 omission failure modes (key absent / `null`-valued / `{}`-valued / partial-fielded) gate individually per the existing pattern; each mode is a parameterized test row. Tests MUST currently FAIL until T011 emission emits-and-omits correctly. Bump `.test-floor-contract.json` Python floor by 4 in same commit.
- [ ] T009 [P] Add schema validator tests at `extension/tests/schema/rollup.test.ts` (extending the existing 333 / 334 schema test file). Cases: (a) valid 4-field entry passes; (b) partial entry (missing one field) → atomicity error in BOTH strict and permissive modes (mirrors 334 T012 / ADR R001 STRICT-ERROR posture); (c) null-valued numeric fields fail; (d) rollup without `by_repository_comments` key passes (capability-off scenario); (e) wrong-typed fields fail (e.g., `thread_count` is a string); (f) `active_thread_count > thread_count` per entry → ordering error (INV-3-07); (g) empty `{}` outer dict fails (FR-1-10 — key MUST be omitted entirely when no buckets). Tests MUST currently FAIL (validator not extended yet). Bump `.test-floor-contract.json` Extension floor by 7 in same commit.
- [ ] T010 [P] Add F3 live-loader regression test at `extension/tests/artifact-client.test.ts` per FR-3-04 (mirrors the by_author_comments regression added for #334 in PR #349). Test asserts `AuthenticatedDatasetLoader.getCapabilityState()?.commentsMetricsAvailable === true` resolves correctly on a dataset variant containing the `by_repository_comments` key — guards against another #347-style live-loader gate regression on the new chart's capability path. Test MUST currently PASS (capability gate already exists from #334; this test adds coverage for the new namespace). Bump `.test-floor-contract.json` Extension floor by 1 in same commit.

**Checkpoint 2.1**: Test infrastructure exists. All FR-1 / FR-2 / FR-3-03 + schema + F3 tests are RED (T010 may pass — its test target already exists from #334). The 333 import-block isolation test (`tests/integration/test_comments_trend_reconciliation_isolation.py`) automatically covers T006 since aggregator imports remain forbidden by file.

### 2.2 — Aggregator emission (FR-1-01..10 + INV-3-07/08/12)

- [ ] T011 Implement `by_repository_comments` emission in `src/ado_git_repo_insights/transform/aggregators.py`. Add a new helper `_compute_weekly_by_repository_comments(week_pr_uids: set[str])` paralleling the existing `_compute_weekly_by_author_comments` at `aggregators.py:1088`. SQL pattern per `contracts/per-repo-comments-density.md` §2 — group by `pr.repository_id` (NO LEFT JOIN `users` or sentinel CASE branch per CL-03 / FR-1-03 / INV-3-12); use the same `_aggr_week_by_repository_comments_slice` temp-table pattern 334 uses for the `week_pr_uids` slice (S608 compliance per `reference_s608_refactor_pattern.md`); ORDER BY `pr.repository_id ASC` for deterministic outer-dict key order. Add the call site in `_generate_weekly_rollups()` immediately after the `by_author_comments` emission (`aggregators.py:725-729` pattern); if the helper returns a non-empty dict, emit `rollup_dict["by_repository_comments"] = ...`; if empty / None, omit the key entirely (FR-1-10 + FR-3-03 omission contract). FK-violation handling: if any PR in the canonical set carries a `repository_id` value missing from `repositories`, surface FAIL-LOUD per CL-03 (plan-level wiring decision pinned here: raise `RuntimeError` from the aggregator with a clear message identifying the offending PR; the `repositories` dimension validation step is NOT load-bearing for this — the aggregator is authoritative because it sees actual production data). Verify: T004 cases (i)–(vii) PASS; T005 determinism PASSES; T006 reconciliation PASSES; T007 meta-test xfail flips to xpass-strict-False on green demo, then fails on mutated demo as designed; T008 byte-identity PASSES.

### 2.3 — Schema extension (rollup.schema.ts)

- [ ] T012 [P] Extend `extension/ui/schemas/rollup.schema.ts` with: (a) new `RepositoryCommentsDensityEntry` interface (`thread_count: number; comment_count: number; active_thread_count: number; coverage_partial: boolean`); (b) optional `by_repository_comments?: Record<string, RepositoryCommentsDensityEntry>` field on the existing `Rollup` interface (add right after the existing `by_author_comments` field at `rollup.schema.ts:166`); (c) `"by_repository_comments"` added to the `KNOWN_ROOT_FIELDS` set (right after the existing `"by_author_comments"` at `rollup.schema.ts:201`); (d) new `validateRepositoryCommentsDensity(value, path)` validator function alongside existing `validateAuthorCommentsDensity` (`rollup.schema.ts:832`) — STRICT ERROR atomicity in both modes; numeric fields integer + non-negative; INV-3-07 ordering check per entry; empty-`{}` outer dict → ERROR per FR-1-10. Wire the validator at the rollup-root validation site (`rollup.schema.ts:1213-1221` pattern). DO NOT extend the per-PR `PrRecord` declarations (locked by 310's schema-parity gate; CL-08 = follow 333 / 334 non-extension). Also extend the `Rollup` interface in `extension/ui/dataset-loader.ts:220-228` to add the matching `by_repository_comments?: Record<string, { thread_count: number; comment_count: number; active_thread_count: number; coverage_partial: boolean }>` field. Verify: T009 schema tests PASS.

### 2.4 — Demo generator parallel path (per memory `feedback_demo_generator_parallel_path.md` / A-09)

- [ ] T013 Add `_aggregate_by_repository_comments_for_week()` helper in `scripts/generate-demo-data.py` paralleling the existing `_aggregate_by_author_comments_for_week` at `scripts/generate-demo-data.py:567`. Group by `repository_id` over the FULL week's PR set (INV-3-10 — same scope choice 333 `comments` and 334 `by_author_comments` use; partial-week / capped-week semantics MUST match those siblings exactly). Add the call site in the rollup-builder path that already emits `by_author_comments`; emit `by_repository_comments` immediately after. Without this mirror, the byte-identity test (T008) passes vacuously because the demo path emits no key at all (Codex caught this on #334).

### 2.5 — Test floor accounting

- [ ] T014 Verify `.test-floor-contract.json` matches actual added test count after T004–T013. Sum: T004 (+7), T005 (+1), T006 (+3), T007 (+2), T008 (+4) = +17 Python; T009 (+7), T010 (+1) = +8 Extension. Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` locally to verify floor==actual on both Python and Extension suites. If actual differs from sum, reconcile by either correcting the floor or auditing T004–T013 for unintended test additions.

**Checkpoint 2 (Foundational complete)**: `rollup[W].by_repository_comments` is emitted by the aggregator under capability-on; demo generator emits the same namespace via parallel path; schema validator accepts the new outer dict; reconciliation extension + meta-failure + byte-identity + F3 live-loader tests are GREEN. **All user stories can now begin.**

---

## Phase 3: User Story 1 — Identify highest-load repositories at a glance (Priority: P1) 🎯 MVP

**Goal**: dashboard renders the new per-repo comment-density breakdown surface on the Metrics tab below the per-author breakdown; team lead identifies the top-`comment_count` repository with no interaction beyond visual scan; partial-coverage qualifier prevents misreading partial-repo rows; raw-`repository_id` fallback ensures rows are never blank when the dimension entry is missing.

**Independent Test** (per spec): Open a demo dashboard with `capabilities.comments_metrics` enabled and ≥10 distinct repositories with mixed comment-load. Confirm a chart titled with repository / density vocabulary renders below the 334 per-author breakdown on the Metrics tab. Confirm rows are ordered by `comment_count` desc. Confirm the date-range filter narrows the visible set when changed. (US2 / US3 / US4 are NOT required for this test.)

### 3.1 — Chart-module test scaffolding (TDD)

- [ ] T015 [US1] Add `extension/tests/modules/charts/comments-repository-density.test.ts` chart unit tests. Cover FR-4-01..06, FR-4-11, idempotency: (a) chart renders rows for the top-50-by-`comment_count`-desc on a 12-repo fixture; each row shows repository display label + 3 numeric metrics; (b) chart re-renders correctly when range filter narrows; (c) chart renders truncation indicator when input exceeds the cap (53-repo fixture → 50 visible + truncation indicator); (d) FR-4-03 partial-coverage qualifier on rows where reduced `coverage_partial` is `true`; (e) deterministic UI tie-break per FR-4-05 — chosen-metric desc → `repository_name` asc → `repository_id` asc as final tie-breaker (covers a duplicate-display-name fixture from rename / fallback collision); (f) FR-4-09 no click-through (rows have no `data-drilldown-*` attribute or click handler); (g) FR-4-10 a11y — rows expose metrics via screen-reader-readable text; sort-selector buttons keyboard-activatable per WAI-ARIA Toolbar pattern; (h) chart-layer idempotency — calling render twice produces ONE chart, not two; (i) **FR-4-11 raw-`repository_id` fallback** — fixture with one bucket whose `repository_id` is absent from the `repositoriesDimension` array; assert the rendered row label equals the raw ID (no blank, no row omission); (j) **FR-4-08 no-data-in-range empty state** — fixture with `capabilities.comments_metrics: true` but visible date range yields zero contributions (all rollups missing `by_repository_comments` OR all entries reduce to zero); assert the chart renders the no-data-in-range empty state with a DOM marker visibly distinct from filter-not-supported (FR-4-07). Tests MUST currently FAIL (chart module doesn't exist). Bump `.test-floor-contract.json` Extension floor by 10 in same commit.

### 3.2 — Chart module implementation

- [ ] T016 [US1] Create new chart module at `extension/ui/modules/charts/comments-repository-density.ts` modeled on `extension/ui/modules/charts/comments-author-density.ts` (PR #349). Reads `Rollup[]` and accesses `rollup[W].by_repository_comments` per week. Reduces per-repo across visible weeks: sums the 3 numeric fields; OR-reduces `coverage_partial` per FR-1-06 reduction rule. Accepts a `repositoriesDimension?: readonly RepoDirectoryEntry[]` option; build a `Map<string, string>` directory via a `buildRepositoriesDirectory` helper paralleling 334's `buildAuthorsDirectory`. Display label resolution: `directory?.get(repository_id) ?? repository_id` (FR-4-11 / CL-04 — raw-ID fallback). NO `FORMER_OR_UNAVAILABLE_*` constants, NO label-mapping branch (CL-03 simplification). Display cap: declare `MAX_COMMENTS_REPO_DENSITY_ROWS = 50`. Truncation indicator via shared `renderTruncationIndicator` from `chart-layout` with noun "repositories". Does NOT add click-through. Verify: T015 cases (a)–(c), (e)–(i) PASS.
- [ ] T017 [US1] Implement partial-coverage visual qualifier in `comments-repository-density.ts` — reuse 333 / 334's `.coverage-partial` CSS class hook (no new class). Apply ONLY to rows where the row's reduced range-total `coverage_partial` is `true` (FR-4-03). Verify: T015 case (d) PASS.
- [ ] T018 [US1] Implement the sort-selector UI control in `comments-repository-density.ts` per FR-4-05 — WAI-ARIA Toolbar pattern (`role="toolbar"` wrapper + plain `<button>` elements with default `tabindex=0` and `aria-pressed`); three buttons (`comment_count` / `thread_count` / `active_thread_count`); default selection `comment_count`. Each button is independently Tab-reachable; Enter / Space activates. (Sort behavior wiring — the click handler that re-renders with the new metric — is T024 in US2; this task covers ONLY the UI scaffold.) Apply the same tie-break-ternary collapse 334 applied to keep `.coverage-partial-branches-baseline.json` at zero growth.
- [ ] T019 [US1] Implement no-data and dimension-filter short-circuits at the top of the chart's render function. Filter-not-supported (FR-4-07): if any of `filters.{repos, teams, authors, reviewers}` is non-empty, render `renderNoData(container, "...filter-not-supported...", "...")` with a message visibly distinct from no-data-in-range. No-data-in-range (FR-4-08): when reduced rows are empty (capability-on but zero contributions), render distinct empty state. (Tests for these in T025 / T026 — US3 / US4 phases.)
- [ ] T020 [US1] Add CSS styles for the new chart in `extension/ui/styles.css` — minimal additions only. Reuse 334's row-table layout rules + sort-selector button-group rules + active-button visual indicator (the 334 chart's CSS already covers these patterns; the new chart's element IDs may require selector-list extensions only, no new rules). Reuse 333 / 334's `.coverage-partial` rule for the partial qualifier. If no CSS additions are needed (selectors already cover via class composition), this task is a no-op confirmation.
- [ ] T021 [US1] Register the new chart in `extension/ui/modules/charts/index.ts` barrel export. Add a one-line export for `comments-repository-density`.

### 3.3 — Dashboard wiring

- [ ] T022 [US1] Wire the new chart into `extension/ui/dashboard.ts` with two helper functions, mirroring 334's `ensureCommentsAuthorDensityContainer` / `removeCommentsAuthorDensityContainer` pattern (`dashboard.ts:1671-1721`): (1) `ensureCommentsRepositoryDensityContainer(): HTMLElement | null` — returns existing element if present (REUSE — no duplicate insertion); else builds the chart row from scratch via `document.createElement` chain, tags the row with `data-comments-repository-density-row="true"` for cleanup discoverability, AND ANCHORS the insertion against the per-author row at `[data-comments-author-density-row="true"]` (CL-10 — looks up the per-author row, inserts the new row immediately after via `parentElement.insertBefore(newRow, perAuthorRow.nextSibling)`); (2) `removeCommentsRepositoryDensityContainer(): void` — finds any element matching `[data-comments-repository-density-row="true"]` and removes it (no-op if absent). On Metrics tab render: if `capabilityState?.commentsMetricsAvailable === true`, call `ensureCommentsRepositoryDensityContainer()` → invoke the chart module's render function passing both the dashboard's `FilterState` AND `repositoriesDimension = currentDimensions?.repositories?.map((r) => ({ repository_id: r.repository_id, repository_name: r.repository_name }))` (mirrors `dashboard.ts:1134-1138` pattern). If capability-off, call `removeCommentsRepositoryDensityContainer()`. At any moment when capability is off, Metrics tab DOM MUST be byte-identical to pre-feature (FR-3-01 + SC-1-03 + FR-3-02 lifecycle parity; tests in T025 below).

**Checkpoint US1**: per-repo breakdown chart renders on the Metrics tab below the 334 per-author row when capability-on; rows ordered by `comment_count` desc; sort selector visible (default `comment_count` active); partial-coverage qualifier on partial rows; raw-ID fallback honored; range filter honored; T015 all green. US1 deliverable is INDEPENDENTLY verifiable per the spec's Independent Test.

---

## Phase 4: User Story 2 — Toggle the chosen sort metric (Priority: P2)

**Goal**: clicking each of the three sort-metric buttons re-orders rows; deterministic tie-break is reproducible across reloads (`repository_name` asc → `repository_id` asc as final tie-breaker per FR-4-05).

**Independent Test**: With the chart rendered (US1), activate each sort-metric option. Confirm rows re-order and the active metric is visually indicated. Tie-break order is reproducible across reloads.

### 4.1 — Sort toggle test scaffolding

- [ ] T023 [US2] Add tests to `extension/tests/modules/charts/comments-repository-density.test.ts` (extending T015's file). Cases: (a) clicking the `thread_count` button re-orders rows by `thread_count` desc; the `aria-pressed` indicator updates to mark `thread_count` as the active button; (b) clicking the `active_thread_count` button re-orders by `active_thread_count` desc; (c) tie-break is reproducible across page reloads under the same dataset (use a fixture with deliberate ties on `comment_count` AND on `repository_name`; verify final order is determined by `repository_id` per FR-4-05); (d) keyboard activation (Enter / Space on a focused button) re-orders correctly. Tests MUST currently FAIL (T018 wired the UI skeleton but not the toggle behavior). Bump `.test-floor-contract.json` Extension floor by 4 in same commit.

### 4.2 — Sort toggle implementation

- [ ] T024 [US2] Wire the three sort-selector buttons in `comments-repository-density.ts` (extending T018's UI scaffold) to update the chart's selected metric and re-render rows. Tie-break order: chosen metric desc → `repository_name` asc → `repository_id` asc as the final deterministic tie-breaker. Apply the same tie-break-ternary collapse 334 used. Verify: T023 cases (a)–(d) PASS.

**Checkpoint US2**: sort toggle works with deterministic tie-break. T023 green.

---

## Phase 5: User Story 3 — Capability-off renders byte-identical to the prior baseline (Priority: P3)

**Goal**: datasets without `capabilities.comments_metrics` MUST see the dashboard render identically to the pre-feature baseline — no per-repo breakdown container, no shifted layout, no new banner. Capability flips on / off MUST clean up correctly.

**Independent Test**: Load a dataset variant with `capabilities.comments_metrics: false`. Confirm the Metrics tab renders identically to the pre-feature baseline (existing chart surfaces including the 334 per-author row at pre-feature positions; no per-repo breakdown container).

### 5.1 — Dashboard lifecycle test (extension-side capability-off byte-identity)

- [ ] T025 [US3] Add an extension dashboard-lifecycle test at `extension/tests/dashboard/comments-repository-density-lifecycle.test.ts`. Test 4 scenarios per FR-3-01 + FR-3-02 + SC-1-03: (a) **Initial capability-off**: with `capabilities.comments_metrics: false` from the start, no element with `id="comments-repository-density"` is mounted; no element with `[data-comments-repository-density-row="true"]` is mounted; the existing chart surfaces (333 comments-trend + 334 per-author also omitted per their respective FR-3-01) occupy the same layout positions; the Metrics tab DOM is byte-identical to the pre-feature baseline. (b) **On→off transition**: render dashboard once with capability-on (chart row inserted via `ensureCommentsRepositoryDensityContainer`), reload with capability-off, assert `removeCommentsRepositoryDensityContainer` cleaned up — no `id="comments-repository-density"`, no `[data-...]` attribute, layout pristine. (c) **Off→on transition**: render with capability-off, reload with capability-on, assert chart row inserted exactly once, positioned BELOW the 334 per-author row (assert `[data-comments-repository-density-row]`'s previous sibling is `[data-comments-author-density-row]`). (d) **On→on re-render idempotency**: render the FULL DASHBOARD render path twice consecutively with capability-on. Assert exactly ONE `[data-comments-repository-density-row="true"]` element exists; exactly ONE `<div id="comments-repository-density">` exists; rows inside the chart are not duplicated from the first render. Bump `.test-floor-contract.json` Extension floor by 4 in same commit.

(Capability-off byte-identity at the rollup / manifest level is already covered by T008 in Phase 2.)

**Checkpoint US3**: capability-off renders pre-feature baseline; FR-3-03 byte-identity test (T008) green; FR-3-02 lifecycle test (T025) green.

---

## Phase 6: User Story 4 — Filter-not-supported posture (Priority: P3)

**Goal**: when ANY dashboard dimension filter is active (`repos` / `teams` / `authors` / `reviewers`), the breakdown surface shows a self-explanatory filter-not-supported empty state instead of rows. Disappears cleanly when filters are cleared. The `repos` filter explicitly triggers this empty state — narrowing to a single repository hides the multi-repo comparison surface per spec design.

**Independent Test**: With the chart rendered (US1), apply any dashboard dimension filter. Confirm filter-not-supported empty state appears (visibly distinct from no-data-in-range); clear filter, confirm rows reappear.

### 6.1 — Filter-not-supported tests

- [ ] T026 [US4] Add tests to `extension/tests/modules/charts/comments-repository-density.test.ts` (extending T015 / T023): (a) any of `filters.{repos, teams, authors, reviewers}` non-empty → render shows filter-not-supported empty state; (b) clearing the filter restores the rows; (c) filter-not-supported empty state is visibly distinct from no-data-in-range (FR-4-08) — different message text, different DOM marker. Bump `.test-floor-contract.json` Extension floor by 3 in same commit.

(Filter-not-supported short-circuit logic was implemented in T019. T026 adds the tests proving it works.)

**Checkpoint US4**: filter-not-supported empty state renders correctly when any filter is active.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: regenerate every managed artifact via the canonical sync + rebuild docs/data/ via build-demo-dataset.py, verify ratchet + coverage parity. Per memory `feedback_canonical_artifact_sync_one_task.md`, the canonical sync drives ALL managed outputs in ONE task — no per-managed-path manual regenerate tasks.

- [ ] T027 Regenerate ALL managed artifacts via the canonical commands (run sequentially in this single task): (1) `python scripts/manage_generated_artifacts.py sync --scope all --stage` — drives `extension/ui/dist/` esbuild rebuilds (for the new chart module), `docs/` shell, broken-docs fixtures, and any sibling managed paths the canonical sync touches; (2) `uv run --python 3.12 python scripts/build-demo-dataset.py` — rebuilds `docs/data/` per memory `feedback_managed_artifacts_excludes_demo_data.md` (NOT covered by sync; demo dataset gains the `by_repository_comments` namespace under capability-on); (3) `python scripts/manage_generated_artifacts.py verify` — confirms working tree clean against the index post-stage. The `--stage` flag is REQUIRED (without it, the verify gate fails).
- [ ] T028 [P] Ratchet bump sanity check: `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`. Confirm floor == actual on both Python and Extension. Cumulative target across all phases: +17 Python (T004 +7, T005 +1, T006 +3, T007 +2, T008 +4) + +29 Extension (T009 +7, T010 +1, T015 +10, T023 +4, T025 +4, T026 +3). If drift detected, reconcile (correct the floor or audit task commits for unintended test additions). NO `[ratchet-realignment]` marker should be needed for a clean foundation PR.
- [ ] T029 [P] Coverage delta check: `python scripts/check_coverage_delta.py`. Confirm ≤ 2% drop vs `.coverage-baseline.json` per QG-52. NO `[threshold-update]` marker should be needed.
- [ ] T030 [P] Partial-branches ratchet sanity check: `pnpm --dir extension run test:partial-branches`. Confirm zero growth vs `.coverage-partial-branches-baseline.json`. The tie-break-ternary collapse applied in T018 + T024 keeps the chart-module's branches at zero growth; if the baseline shows growth, audit the chart module for defensive branches that need either elimination via refactor or coverage via mutation-based tests (NOT a baseline bump).

**Checkpoint**: All managed artifacts staged + clean; ratchet + coverage + partial-branches gates green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: ADRs R001–R003 already pinned in research.md — confirmation only; no dependencies.
- **Foundational (Phase 2)**: BLOCKS all user stories. Test scaffolding (T004–T010) → Aggregator emission (T011) → Schema extension (T012) → Demo generator helper (T013) → Floor accounting (T014).
- **US1 (Phase 3, MVP)**: Depends on Foundational complete.
- **US2 (Phase 4)**: Depends on Foundational + US1 (chart module + sort-selector UI scaffold from T018).
- **US3 (Phase 5)**: Depends on Foundational + US1 (dashboard wiring from T022).
- **US4 (Phase 6)**: Depends on Foundational + US1 (filter-not-supported short-circuit from T019).
- **Polish (Phase 7)**: Depends on all of the above being complete.

### User Story Dependencies

- **US1 (P1, MVP)**: First user story; all others depend on its chart module + dashboard wiring.
- **US2–US4 (P2, P3)**: All depend on US1's chart module. Can run in parallel with each other after US1 completes (different test cases within shared test files; the `.test-floor-contract.json` bump per commit is the synchronization point, not the source files).

### Within Each User Story

- Tests (T015, T023, T025, T026) MUST be written and FAIL before implementation.
- Chart module skeleton (T016) before partial qualifier (T017) before sort-selector UI scaffold (T018) before short-circuits (T019).
- Sort toggle implementation (T024) extends T018's UI scaffold.
- Story complete before moving to next priority.

### Parallel Opportunities

- ADR confirmation (T001–T003): all parallel within Setup.
- T009 (extension schema tests) + T010 (F3 live-loader regression) parallel with T004–T008 (Python tests) within Phase 2.1 (different files / runtimes).
- T012 (schema extension) parallel with T011 (aggregator emission) + T013 (demo generator helper) within Phase 2 (different files).
- US2 / US3 / US4 phases: can run in parallel after US1 completes (different test cases within `extension/tests/...` test files).
- T028 / T029 / T030 (ratchet + coverage + partial-branches checks) parallel within Polish.

---

## Parallel Example: Foundational Phase

```bash
# Test-first scaffolding — launch in parallel where files differ:
Task: T004 producer unit tests at tests/unit/test_aggregators_repo_comments.py
Task: T006 reconciliation extension at tests/integration/test_comments_trend_reconciliation.py
Task: T008 byte-identity extension at tests/integration/test_demo_variants_byte_identity.py
Task: T009 schema validator tests at extension/tests/schema/rollup.test.ts
Task: T010 F3 live-loader regression at extension/tests/artifact-client.test.ts

# After tests are written + failing, implementation in parallel where files differ:
Task: T011 aggregator emission at src/ado_git_repo_insights/transform/aggregators.py
Task: T012 schema extension at extension/ui/schemas/rollup.schema.ts
Task: T013 demo generator helper at scripts/generate-demo-data.py
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
5. US4 (filter-not-supported posture) → Test independently → Deploy / Demo.
6. Polish → Final cohesive check + canonical artifact sync + demo rebuild.

### Parallel Team Strategy

After Foundational completes:
- Developer A: US1 (chart module + dashboard wiring, the MVP).
- Developer B: US2 (sort toggle — can start once US1 chart module skeleton + UI scaffold exist).
- Developer C: US3 (capability-off lifecycle test — can start once US1 dashboard wiring exists).
- Developer D: US4 (filter-not-supported tests — once US1 short-circuit T019 exists).

---

## Notes

- **Cumulative test additions**: Phase 2 +17 Python +8 Extension; Phase 3 +10 Extension; Phase 4 +4 Extension; Phase 5 +4 Extension; Phase 6 +3 Extension. **Cumulative target**: +17 Python + +29 Extension across the PR. Verified at task time via `scripts/check_ratchet_bump.py` (T028).
- **Constitution gates**: every commit honors QG-38 (no `--no-verify`), QG-39 (cross-OS), QG-40 (no `typing.Any`), QG-41 (zero new suppressions), QG-43 (per-commit ratchet bump). The QG-50 bypass markers are subject-line-only; no markers are expected for a clean foundation PR.
- **Schema-parity gate (CL-08)**: NOT extended for the new namespace. The reconciliation test (T006) is the parity authority for `by_repository_comments`.
- **Import-block isolation (333 round-9 / 334 propagation)**: extends automatically for T006 / T007 since the `aggregators.py` import-forbid is by-FILE not by-dimension. There is no sentinel constants module to source — the sentinel concept is intentionally absent per CL-03.
- **Demo generator parallel path (T013)**: required per memory `feedback_demo_generator_parallel_path.md` / A-09. Without T013, the byte-identity test (T008) passes vacuously because the demo path emits no `by_repository_comments` key at all (Codex caught this on #334).
- **Canonical artifact sync (T027)**: the SINGLE task for regenerating managed artifacts. Drives `extension/ui/dist/` (esbuild) + `docs/` shell via `manage_generated_artifacts.py sync --scope all --stage`, plus `docs/data/` via `scripts/build-demo-dataset.py` (the latter is required separately per memory `feedback_managed_artifacts_excludes_demo_data.md`). Per-managed-path manual regenerate tasks are explicitly forbidden by user directive.
- **NO sentinel infrastructure**: per user directive + CL-03, this feature does NOT carry over 334's `__former_or_unavailable_*__` literal pattern, the renderer-side label-mapping branch, or the producer-side collision-safety unit test (334 T029 equivalent).
- **NO abstraction extraction**: per A-08, the chart module is a duplicated-then-extract candidate; the abstraction will be informed by all THREE concrete instances (per-author + per-repo + per-reviewer) at #336, not by two-instance extraction now.
- **NO new wall-clock performance assertions**: chart-render budget is governed by QG-28's existing 1000ms / 156-week scalability gate; aggregator runtime is governed by existing producer test-suite wall-clock budgets only. Single-run wall-clock assertions are CI-flake bait and are NOT generated.
- **Partial-branches ratchet (T030)**: zero growth enforced. T018 + T024 apply 334's tie-break-ternary collapse pattern proactively to avoid the ratchet trap memory `feedback_no_invented_abstractions.md` warns about.
