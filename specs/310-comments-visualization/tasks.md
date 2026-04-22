# Tasks: Comment visualization — Drill-down extension (Capabilities 3 + 4)

**Input**: Design documents from `/specs/310-comments-visualization/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED. Enterprise test coverage (QG-42) + user's standing "Enterprise test coverage" invariant require every new code path + invariant + gate to have pytest / Jest coverage. Each test-adding task bumps `.test-floor-contract.json` in the same commit (QG-43).

**Organization**: Tasks grouped by user story (US1 = Capability 3 P1, US2 = Capability 4 P2) to enable independent testing. Note: US1 and US2 ship together per INV-08 atomicity (the rendered contract is indivisible), but tests and acceptance criteria remain story-scoped.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1 / US2); omitted for Setup, Foundational, and Polish phases
- Every task includes an exact file path

## Path Conventions

Single project. Paths are repo-relative.

- Python backend: `src/ado_git_repo_insights/`, `tests/`
- Extension UI: `extension/ui/`, `extension/tests/`
- Scripts: `scripts/`
- Specs / contracts: `specs/310-comments-visualization/`, `specs/060-throughput-pr-drilldown/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding for the parity gate + test:ci wiring before any schema expansion lands.

- [ ] T001 Create skeleton `scripts/check_pr_record_schema_parity.py` — argparse + `main(argv)` returning 0 (stub body to be filled in T011); cross-OS compatible (`python scripts/check_pr_record_schema_parity.py` from repo root)
- [ ] T002 [P] Add `"test:schema-parity": "python ../scripts/check_pr_record_schema_parity.py"` pnpm script in `extension/package.json`; chain it into the existing `test:ci` script definition immediately before `test:smoke` (mirrors `test:partial-branches` precedent at `extension/package.json:34`)
- [ ] T003 [P] Integrate the parity gate into `scripts/run_repo_hook.py` pre-commit handler following the existing predicate-plus-runner pattern (there is NO `CommandSpec` abstraction in `run_repo_hook.py` — that dataclass lives only in `run_pr_preflight.py:71`): (a) add `is_pr_record_parity_trigger(path: str) -> bool` predicate alongside `is_ui_trigger` / `is_test_trigger` (around `run_repo_hook.py:625` and `:893`); the predicate returns `True` for exactly three paths — `src/ado_git_repo_insights/types.py`, `extension/ui/schemas/rollup.schema.ts`, `specs/310-comments-visualization/contracts/pr-record-comments-fields.md`; (b) add `run_pr_record_schema_parity_check()` runner function (alongside existing runners like `run_extension_typecheck()` at `run_repo_hook.py:888`) that invokes `run_command([sys.executable, "scripts/check_pr_record_schema_parity.py"])`; (c) wire into the existing `run_pre_commit_hook()` body (defined at `run_repo_hook.py:1041`; trigger-collection block at `:1060-1067`) by making **two** surgical insertions: **first**, insert `parity_triggers = [path for path in staged if is_pr_record_parity_trigger(path)]` into the existing trigger-collection block — reusing the `staged` variable already assigned at line 1060 (do NOT call `staged_paths()` a second time); place the new line immediately after `test_triggers = ...` at line 1062 (before `tsconfig_triggers = ...` at 1063); **second**, insert the `if parity_triggers: ... require_clean_pr_record_parity_scope(); run_pr_record_schema_parity_check()` dispatch BEFORE the existing early-return at `:1069-1070` (`if not ui_triggers and not test_triggers: return`). Rationale: commits staging only `types.py` or only the 310 contract md (neither matches `is_ui_trigger` nor `is_test_trigger`) would otherwise hit the early-return and silently skip the gate. The existing `ui_triggers` / `test_triggers` / `tsconfig_triggers` dispatch blocks at `:1072-1094` remain untouched
- [ ] T004 [P] Add a new `CommandSpec` to `scripts/run_pr_preflight.py`'s preflight command list (existing `CommandSpec` `@dataclass(frozen=True)` at `run_pr_preflight.py:71-76` has exactly five fields: `name`, `command`, `cwd`, `extra_env`, `show_output_on_success` — use only those; no `triggers_any_of`, no `degraded_fallback`). Minimal form: `CommandSpec(name="PR-record schema parity", command=("python", "scripts/check_pr_record_schema_parity.py"))`; `cwd` defaults to `REPO_ROOT`, `extra_env` defaults to `None`, `show_output_on_success` defaults to `False`. Append it to the existing preflight CommandSpec list and follow the sequential-execution pattern used for every other preflight gate. Same command string as T003's runner → QG-49 parity (identical invocation across pre-commit / pre-push / `pnpm test:ci` / CI)
- [ ] T005 [P] Add CI step "PR-record schema parity" in `.github/workflows/ci.yml` — runs on both Ubuntu and Windows Python lanes (QG-45 cross-OS)
- [ ] T006 Add `require_clean_pr_record_parity_scope()` function in `scripts/run_repo_hook.py` (alongside existing `require_clean_ui_sources()` / `require_clean_test_compilation_scope()` / `require_clean_tsconfigs()` at lines 644 / 659 / 686) — clean-worktree guard covering the three trigger paths from T003 (QG-48); invoked from `run_pre_commit_hook()` (at `run_repo_hook.py:1041`) immediately before `run_pr_record_schema_parity_check()` (T003's runner) when parity triggers are detected — placement MUST precede the existing early-return at `:1069` per T003 notes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Atomic schema expansion across the 4 surfaces (DIRECTIVE 1) + parity gate implementation + demo-variant infrastructure (R-08). Blocks all user-story work because US1 and US2 both depend on the extended PrRecord schema and the real capability-off artifact.

- [ ] T007 [P] Expand Python `PrRecord` TypedDict in `src/ado_git_repo_insights/types.py`: add `thread_count: NotRequired[int | None]`, `comment_count: NotRequired[int | None]`, `active_thread_count: NotRequired[int | None]`; import `typing.NotRequired`; update the class docstring to cite `specs/310-comments-visualization/contracts/pr-record-comments-fields.md` §1 as the authoritative expansion record
- [ ] T008 [P] Expand TypeScript `PrRecord` interface in `extension/ui/schemas/rollup.schema.ts`: add `thread_count?: number | null`, `comment_count?: number | null`, `active_thread_count?: number | null` (presence-optional + value-nullable, matching Python's `NotRequired[int | None]`)
- [ ] T009 Extend `validatePrRecordArray` in `extension/ui/schemas/rollup.schema.ts` with permissive type checks for the 3 optional fields: warn (not error) when a field is present but not of type number/null; warn on INV-08 atomicity violations (one or two of three present without the others); warn on INV-10 mixed-null-numeric violations; warn on INV-09 ordering violations. `PR_RECORD_REQUIRED_FIELDS` stays at 5 entries — do not add new fields to it
- [ ] T010 [P] Add `extension/tests/schemas/pr-record-comments-fields.test.ts`: test each permissive warning case from T009 (type mismatch, INV-08, INV-09, INV-10); verify loads still succeed (permissive never errors); bump `.test-floor-contract.json` extension floor in the same commit
- [ ] T011 Implement `scripts/check_pr_record_schema_parity.py` body — **Python-only; no node/TypeScript runtime dependency** (must stay green under `pre-commit run --all-files` in the Python test matrix, which has no `extension/node_modules`, per `feedback_hook_env_parity_across_all_ci_jobs`): (a) parse `types.py` via Python `ast` — collect PrRecord TypedDict fields + distinguish `NotRequired[X]` from plain `X`; (b) parse `rollup.schema.ts` via Python regex against tightly-locked source shapes — extract the `export interface PrRecord { ... }` body and split field lines with a regex accepting exactly `<ident>(\??):\s*(<type-expr>);` where `<type-expr>` is one of a fixed closed set (`number`, `string`, `boolean`, `number | null`, `string | null`, `boolean | null`); extract the `PR_RECORD_REQUIRED_FIELDS` array literal with a regex matching the `const PR_RECORD_REQUIRED_FIELDS: ... = [ ... ];` block and collecting the bareword string entries; **fail closed** with a diagnostic pointing at any source construct the regexes don't accept — callers adjust either the source or the parser, no silent permissive branches; (c) parse the `## §1 Canonical field declaration` section in `specs/310-comments-visualization/contracts/pr-record-comments-fields.md` — fail hard if the anchor heading is missing (prevents silent-pass drift); collect Field + Python type + TypeScript type columns; (d) assert: all 4 surfaces enumerate identical field name sets; types match the presence-specific compatibility rules per `contracts/schema-parity-gate.md`; Python non-`NotRequired` fields equal `PR_RECORD_REQUIRED_FIELDS` (5 = 5). Exit 0 on parity; non-zero with human-readable diff on drift
- [ ] T012 [P] Add `tests/unit/test_pr_record_schema_parity.py`: pytest wrapper that imports `scripts.check_pr_record_schema_parity` and asserts `main([])` returns 0 on the current tree; bump `.test-floor-contract.json` Python floor in the same commit
- [ ] T013 Add `--comments-metrics {true,false}` flag to `scripts/generate-demo-data.py` (default `true`; strictly serialization-layer — zero branching in generation entrypoints per R-08 user-added constraint). Flag sets `EMIT_COMMENTS_METRICS` boolean. **Serialization-layer (flag-gated)**: when `EMIT_COMMENTS_METRICS=false`, omit `manifest.capabilities.comments_metrics` + omit `manifest.features.comments` + emit `manifest.coverage.comments = "disabled"` + omit the three per-PR fields from every `prs[*]` entry. **Generation-layer (flag-independent, single code path, runs unconditionally for both variants)**: synthesize a `(thread_count, comment_count, active_thread_count)` triplet per PR using the existing fixed-seed RNG discipline — either a new dedicated `comments_metrics_rng = random.Random(SEED + _COMMENTS_METRICS_SEED_OFFSET)` alongside the existing `pr_record_rng` / `rt_rng` streams, OR a controlled extension of `pr_record_rng` that does NOT shift any downstream consumer's draws (existing `RNG` / `pr_record_rng` / `rt_rng` consumption patterns stay byte-stable). Synthesis MUST: (a) satisfy INV-09 at draw time (`0 ≤ active_thread_count ≤ thread_count`); (b) produce sufficient variety across PRs for SC-01 / SC-02 acceptance walks (heavy and light PRs both present in a typical week; unresolved and fully-resolved PRs both present); (c) consume the RNG identically regardless of the flag (the flag influences ONLY the serializer's emit/omit decision, never the draw sequence — this is what makes R-08's byte-identity contract provable via T015's three subtests). Attach the synthesized triplet on every `prs[*]` entry at the generation site; the serialization-layer gate above decides whether the emitted JSON carries or drops the three keys
- [ ] T014 Update `scripts/build-demo-dataset.py` to orchestrate both variants: existing path produces `artifacts/demo-enterprise/` unchanged (capability-on); new path invokes `generate-demo-data.py --comments-metrics=false --output-root artifacts/demo-enterprise-comments-off/`. Ensure both variants run deterministically off seed=42 and the orchestration does not introduce any generation-layer branching
- [ ] T015 [P] Add `tests/integration/test_demo_variants_byte_identity.py` with three ordered subtests per R-08: (a) `test_sorted_key_equality_excluding_gated_set` — for every JSON file in both trees, key sets at every path (minus the 5 gated keys) are identical; (b) `test_canonicalized_byte_equality_after_gated_removal` — strip gated keys from both, re-serialize canonical (sorted keys, stable numeric formatting), compare byte-for-byte; (c) `test_array_order_parity_including_prs` — explicit position + content parity on `prs[]` and any other ordering-sensitive array (fails if any non-gated element moves or changes). Bump `.test-floor-contract.json` Python floor in the same commit
- [ ] T016 Build `artifacts/demo-enterprise-comments-off/` by running `python scripts/build-demo-dataset.py` and commit the produced tree (real pipeline-built artifact, not synthetic-stripped). Verification: `python scripts/run_pytest.py tests/integration/test_demo_variants_byte_identity.py` passes all three subtests
- [ ] T017 Update `specs/060-throughput-pr-drilldown/contracts/pr-record.md` with a one-line pointer: "The 5 fields declared here are extended by three additional fields in the [310 sibling contract](../../310-comments-visualization/contracts/pr-record-comments-fields.md) when `capabilities.comments_metrics=true`." Human-continuity documentation only; NOT a parity-gate-checked surface (not added to T003/T004/T005 triggers)

**Checkpoint**: Parity gate runs green; both demo variants build deterministically; byte-identity test passes; capability-off artifact committed. All prerequisites for user-story work are in place.

---

## Phase 3: User Story 1 - Discussion-depth indicators on the PR drill-down (Capability 3, Priority: P1) 🎯 MVP

**Goal**: Per-PR `thread_count` and `comment_count` rendered in the Feature 060 throughput drill-down, gated on `capabilities.comments_metrics`, with sort + filter mechanics.

**Independent Test**: Load the capability-on demo (`artifacts/demo-enterprise/`), open the throughput drill-down for a week with varied discussion depth, verify per-PR thread_count and comment_count columns appear, sort by each column, apply a threshold filter. (Per spec Independent Test, Capability 4 does NOT need to be present for US1 acceptance; but per INV-08 the schema emits all three fields atomically — US2's `active_thread_count` rendering + tests arrive in Phase 4.)

### Producer (Python aggregator)

- [ ] T018 [US1] Implement per-week join in `src/ado_git_repo_insights/transform/aggregators.py`: after the existing qualified→sorted→capped(500) slice build (around `aggregators.py:771-796`), collect `pull_request_uid` values from the capped slice only (INV-02 + user constraint "top-500 only before join"); issue the SQL from `contracts/pr-record-comments-fields.md` (LEFT JOINs on `pr_threads` and `pr_comments` with C1 inclusion rules: `pr_threads.is_deleted=0`, `pr_comments.is_deleted=0`, `SUM(CASE WHEN status='active' THEN 1 ELSE 0 END)` for active count); build `by_uid: dict[int, tuple[int | None, int | None, int | None]]` — `None` triplet when `pull_requests.comments_extracted_at IS NULL`, integer triplet otherwise. Guard the whole branch on `self._has_comments()`; when `False`, emit the existing 5-field PrRecord unchanged (INV-01 / FR-3-06)
- [ ] T019 [US1] Attach all three fields atomically to each PR record in the serialization loop (after `aggregators.py:822-830`): read the PR's uid explicitly via `uid = getattr(row, "pull_request_uid", None)` — mirrors the existing `pr_id = getattr(row, "pull_request_id", None)` pattern at `aggregators.py:799` (`pull_request_uid` is already a column on the `group` / `qualified` DataFrame; see references at `aggregators.py:667, 863`); look up via `counts = by_uid.get(uid, (None, None, None))` and set `prs[-1]["thread_count"] = counts[0]`, `prs[-1]["comment_count"] = counts[1]`, `prs[-1]["active_thread_count"] = counts[2]`. Preserve the deterministic key order documented in `data-model.md §1` (id → title → author_id → repository_id → cycle_time → thread_count → comment_count → active_thread_count)

### Producer tests

- [ ] T020 [P] [US1] Add `tests/unit/test_aggregators_pr_records_comments.py` with these named tests: `test_no_fields_when_capability_off` (INV-01), `test_join_scoped_to_capped_slice` (INV-02 — mock a week with >500 qualifying PRs, assert SQL only touches the top-500), `test_c1_inclusion_rules_applied` (INV-07 — seed pr_threads/pr_comments with every toggle state from spec's C1 subsection, assert counts match the rule set), `test_field_atomicity_capability_on` (INV-08 — all three fields present on every emitted PR), `test_field_atomicity_capability_off` (INV-08 — none of the three fields present), `test_partial_state_triplet_null` (INV-10 — comments_extracted_at IS NULL → all three fields null), `test_partial_state_no_mixed_null_numeric` (INV-10 — producer MUST NOT emit mixed null/numeric within a single record). Bump `.test-floor-contract.json` Python floor in the same commit
- [ ] T021 [US1] Extend `tests/integration/test_golden_outputs.py` with a comments-data fixture (DB seeded with pr_threads + pr_comments for known PRs) and assert byte-stable rollup JSON with the three new fields across two runs. Update the existing golden baseline in the same commit if the test framework requires it (follow the existing `test_golden_outputs.py` pattern)

### Consumer (extension UI)

- [ ] T022 [US1] Extend `PrListRow` interface in `extension/ui/modules/shared/detail-panel.ts`: add `readonly threadCount?: number | null`, `readonly commentCount?: number | null`, `readonly activeThreadCount?: number | null` (optional + nullable, matching the PrRecord wire shape)
- [ ] T023 [US1] Extend `PrListSectionWithRows` in `detail-panel.ts` with required field `readonly commentsMetricsAvailable: boolean` — the section-level discriminator that gates column rendering. Update `PrListSectionInput` union's `"pr-list"` variant to carry the same field
- [ ] T024 [US1] Update `makePrListSection` factory in `detail-panel.ts` to accept and pass through `commentsMetricsAvailable` on the `"pr-list"` variant
- [ ] T025 [US1] Update `renderPrListSection` in `detail-panel.ts` (around line 438): when `section.contentState === "pr-list"` AND `section.commentsMetricsAvailable === true`, append three `<span>` nodes per `<li>` for thread_count, comment_count, active_thread_count (partial sentinel renders distinguishably from a true zero per FR-3-05); when `false`, DOM is byte-identical to the pre-310 shape (do NOT emit new spans or headers — SC-03). US1 covers thread + comment spans; US2 adds the active-thread span in Phase 4 using the same conditional
- [ ] T026 [US1] Add `readonly commentsMetricsAvailable?: boolean` to `ThroughputDrilldownOptions` interface in `extension/ui/modules/drilldown/throughput-drilldown.ts` (default `false` when absent for back-compat)
- [ ] T027 [US1] Update `buildPrListSection` in `throughput-drilldown.ts`: when `options.commentsMetricsAvailable === true`, map each `PrRecord` to `PrListRow` including `threadCount: pr.thread_count ?? null`, `commentCount: pr.comment_count ?? null`, `activeThreadCount: pr.active_thread_count ?? null`; when `false`, omit all three from the row. Pass `commentsMetricsAvailable` through to `makePrListSection`
- [ ] T028 [US1] Wire `capabilityState?.commentsMetricsAvailable ?? false` into the `installThroughputDrilldown` call in `extension/ui/dashboard.ts` (around `dashboard.ts:1085-1102`); `capabilityState` is already computed at `dashboard.ts:2329` for the banner — reuse the existing value
- [ ] T029 [P] [US1] Implement sort mechanics for `thread_count` and `comment_count` columns in `detail-panel.ts` rendering: column headers become click handlers that sort the row array numerically (partial-sentinel nulls sort to a consistent position — implementation detail, but document the choice in code comment)
- [ ] T030 [P] [US1] Implement filter mechanics for `thread_count` and `comment_count` columns in `detail-panel.ts`: threshold input UI + filter predicate; partial-sentinel rows excluded from numeric comparisons (presentation detail per FR-3-05)

### Consumer tests

- [ ] T031 [P] [US1] Add `extension/tests/modules/drilldown/pr-list-comments-columns.test.ts`: render tests for capability-on path (thread_count + comment_count spans present per row; sort descending shows highest-first; filter `threads >= N` narrows the list; explicit-zero case per Acceptance Scenario 2.2; partial-sentinel renders distinguishably from zero per FR-3-05). Jest + jsdom
- [ ] T032 [US1] Extend `extension/tests/modules/drilldown/pr-list-count-parity.test.ts`: assert `renderedCount` and `actualFilteredCount` are unchanged by the addition of the new columns (the truncation indicator continues to read "Showing N of M matching PRs")
- [ ] T033 [US1] Bump `.test-floor-contract.json` extension floor by the total count of new tests added in T031 + T032 in the same commit
- [ ] T033a [US1-close] Rebuild **both** demo artifacts once the Phase 3 producer changes (T018 / T019) have landed: re-run `python scripts/build-demo-dataset.py` and commit the updated trees at `artifacts/demo-enterprise/` (capability-on — now carrying `thread_count`, `comment_count`, `active_thread_count` on every `prs[*]` entry) and `artifacts/demo-enterprise-comments-off/` (capability-off — regenerated through the same orchestration for parity). Required because T016's initial build ran BEFORE the aggregator emitted the three new fields; without this rebuild the committed capability-on tree would still carry 5-field `prs[*]` entries, which would cause (a) `tests/integration/test_demo_variants_byte_identity.py` to pass vacuously (both variants trivially match pre-310 shape), and (b) the Phase 5 baseline fixture generation (T041) and byte-identity / capability-off snapshot tests (T040, T044) to snapshot a stale shape. Verification: (a) spot-check any weekly rollup under `artifacts/demo-enterprise/data/aggregates/weekly_rollups/` and confirm `prs[*]` entries carry the three new fields with real (non-null for covered PRs) numeric triplets; (b) `python scripts/run_pytest.py tests/integration/test_demo_variants_byte_identity.py` stays green (T015's three subtests); (c) re-running `build-demo-dataset.py` a second time produces zero git-diff (determinism from seed=42). Bumping `.test-floor-contract.json` is NOT required — this task adds no new tests

**Checkpoint**: Capability-on drill-down renders thread_count + comment_count columns with sort and filter. Capability-off drill-down renders byte-identical to pre-310 (SC-03; locked in Phase 5 by T037). INV-07 / INV-08 / INV-10 assertions pass. US1 acceptance scenarios validated. Both demo artifacts (T016 capability-off + capability-on) reflect the Phase 3 producer shape after T033a.

---

## Phase 4: User Story 2 - Per-PR unresolved-thread indicator (Capability 4, Priority: P2)

**Goal**: Per-PR `active_thread_count` column rendered alongside US1's columns, with the same sort + filter mechanics. INV-09 (`active_thread_count <= thread_count`) property-tested.

**Independent Test**: With `capabilities.comments_metrics` enabled and a dataset containing threads across all status values (`active`, `fixed`, `wontFix`, `closed`, `byDesign`, `pending`, `unknown`), open the drill-down and confirm each PR row shows an unresolved-thread count reflecting only `status='active'` rows after applying C1 inclusion rules.

Note: US2's implementation reuses the aggregator logic from T018/T019 (which already emits all three fields atomically per INV-08) and extends the renderer to add the third column. No new SQL, no new producer logic.

- [ ] T034 [US2] Extend `renderPrListSection` in `extension/ui/modules/shared/detail-panel.ts` to emit the third `<span>` for `active_thread_count` in the same capability-gated conditional introduced by T025. Column header labelled "unresolved" (or equivalent; exact UI text is implementation detail per FR-4-01)
- [ ] T035 [P] [US2] Implement sort mechanic for `active_thread_count` column in `detail-panel.ts` (reuses the sort pattern from T029)
- [ ] T036 [P] [US2] Implement filter mechanic for `active_thread_count` column in `detail-panel.ts` (reuses the filter pattern from T030)
- [ ] T037 [P] [US2] Extend `extension/tests/modules/drilldown/pr-list-comments-columns.test.ts` (from T031) with US2 cases: `active_thread_count` column rendered when capability-on; sort descending on unresolved column works; filter `unresolved >= 1` narrows correctly; Acceptance Scenario 2.2 — PR with all threads resolved renders explicit `0`, NOT blank or `—` (distinguishable from the partial-sentinel null state per FR-3-05)
- [ ] T038 [P] [US2] Add INV-09 property test to `tests/unit/test_aggregators_pr_records_comments.py` (from T020): `test_active_bounded_by_total` — parametrize over multiple seeded PR+thread shapes (e.g., 0/0, 5/0, 5/3, 5/5, 10/10 for `thread_count`/`active_thread_count`); assert `active_thread_count <= thread_count` holds for every emitted record; include an adversarial fixture seeded to attempt `active > total` (e.g., manually constructed data) and assert the aggregator never emits such a record. Bump `.test-floor-contract.json` Python floor in the same commit
- [ ] T039 [US2] Bump `.test-floor-contract.json` extension floor by the count of new Jest cases added in T037 in the same commit

**Checkpoint**: All three columns (thread_count, comment_count, active_thread_count) render when capability is on. US2 acceptance scenarios pass. INV-09 verified at producer level.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: SC-03 byte-identical baseline verification against the real capability-off artifact + cross-drilldown spread guard + quickstart validation.

- [ ] T040 [P] Add `extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts`: jsdom renders `installThroughputDrilldown` against the real capability-off artifact at `artifacts/demo-enterprise-comments-off/data/aggregates/weekly_rollups/*.json` (NOT a synthetic-stripped fixture — per R-08 user constraint); compare the resulting `<section id="pr-detail">` innerHTML byte-for-byte to the committed golden at `extension/tests/fixtures/throughput-drilldown-capability-off-baseline.html`. Test fails on any drift from the pre-310 baseline (SC-03 lockbox)
- [ ] T041 Generate and commit `extension/tests/fixtures/throughput-drilldown-capability-off-baseline.html` — produced one-time by running the renderer against the T016 capability-off artifact with the Phase 3 code in place; the resulting DOM is the SC-03 baseline
- [ ] T042 [P] Add `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts`: structural Jest test that scans every file under `extension/ui/modules/drilldown/*.ts` (using `fs.readFileSync` + regex, or the TypeScript AST for robustness); FAILS if any file outside `throughput-drilldown.ts` references `threadCount`, `commentCount`, `activeThreadCount`, `thread_count`, `comment_count`, or `active_thread_count`, OR constructs `makePrListSection({contentState: "pr-list", ...})` with a truthy `commentsMetricsAvailable`. User-added constraint: prevents accidental spread to cycle-time-drilldown.ts, reviewer-drilldown.ts, or any future drill-down without capability gating
- [ ] T043 Bump `.test-floor-contract.json` (both Python and Extension floors as applicable) for the tests added in T040 + T042 in the same commit
- [ ] T044 [P] Run `python scripts/run_pytest.py tests/unit/test_aggregators_pr_records_comments.py tests/unit/test_pr_record_schema_parity.py tests/integration/test_demo_variants_byte_identity.py tests/integration/test_golden_outputs.py` — all tests green
- [ ] T045 [P] Run `pnpm --dir extension test -- pr-list-comments-columns pr-list-capability-off-baseline pr-list-comments-spread-guard pr-list-count-parity pr-record-comments-fields` — all Jest tests green
- [ ] T046 Run `python scripts/check_pr_record_schema_parity.py` manually — exits 0 on the full tree; confirm pre-commit hook fires the same command
- [ ] T047 Walk through `specs/310-comments-visualization/quickstart.md` Steps 1-7 end-to-end on a local build; record any drift from the quickstart text as follow-up issues, not as task edits

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies; can start immediately
- **Phase 2 (Foundational)**: depends on Phase 1 completion; BLOCKS all user-story phases
- **Phase 3 (US1)**: depends on Phase 2 completion
- **Phase 4 (US2)**: depends on Phase 3's T025 (renderer gating conditional) — US2 only adds the third span to that conditional; all other US2 work is [P] against US1's remaining polish
- **Phase 5 (Polish)**: depends on all of Phase 3 + Phase 4 (SC-03 baseline requires US1+US2 rendering complete; spread guard requires all drilldown surfaces stable)

### User Story Dependencies

- **US1 (P1)**: depends on Phase 2 foundational completion (schema expansion + parity gate + demo variants)
- **US2 (P2)**: the producer work is already complete in US1's T018/T019 (INV-08 forces atomic emission); US2's renderer addition (T034) depends on T025's conditional being in place; US2's INV-09 property test (T038) depends on the producer work from T018

### Within Each Story

- Producer (aggregator) tasks before producer tests
- Consumer (extension UI) type/shape extensions before renderer updates before wiring in dashboard
- Sort/filter mechanics can land [P] with the render work (different code concerns)
- Tests land same-commit as the code they test (ratchet bump discipline)

### Parallel Opportunities

- Setup T002 / T003 / T004 / T005 are all [P] (distinct files: extension/package.json, scripts/run_repo_hook.py, scripts/run_pr_preflight.py, .github/workflows/ci.yml)
- Foundational T007 + T008 + T010 are [P] (Python types.py, TS rollup.schema.ts, TS test file — all different files, independent authoring)
- T012 [P] authored alongside T011 (pytest wrapper; imports the script at test runtime, so authoring is independent of script body)
- T015 [P] authored alongside T013 + T014 (test file independent of generator/orchestrator)
- US1 renderer-side (T025-T028) is [P] against producer-side (T018-T021) — distinct processes, distinct files
- US2 tests (T037 + T038) are [P] with the US2 implementation (T034-T036)
- Polish tests (T040 + T042) are [P]

---

## Parallel Example: Phase 2 Foundational

```bash
# Three independent authoring tracks can run in parallel once Phase 1 is done:
# Track A — Python schema:
Task: "Expand Python PrRecord TypedDict in src/ado_git_repo_insights/types.py (T007)"

# Track B — TypeScript schema:
Task: "Expand TypeScript PrRecord interface in extension/ui/schemas/rollup.schema.ts (T008)"
Task: "Extend validatePrRecordArray with permissive type checks (T009)"
Task: "Add extension/tests/schemas/pr-record-comments-fields.test.ts (T010)"

# Track C — Demo variants:
Task: "Add --comments-metrics flag to scripts/generate-demo-data.py (T013)"
Task: "Update scripts/build-demo-dataset.py orchestration (T014)"
Task: "Add tests/integration/test_demo_variants_byte_identity.py (T015)"

# Convergence: T011 (parity gate body) depends on T007 + T008 landing.
# T016 (commit capability-off artifact) depends on T013 + T014 + T015 landing.
```

---

## Parallel Example: Phase 3 User Story 1

```bash
# Producer and consumer can progress in parallel:
Task: "Implement aggregator join in aggregators.py (T018)"
Task: "Attach three fields atomically in aggregators.py serialization loop (T019)"
Task: "Add producer tests in tests/unit/test_aggregators_pr_records_comments.py (T020)"
Task: "Extend tests/integration/test_golden_outputs.py (T021)"

# Renderer work (different files from producer):
Task: "Extend PrListRow interface in detail-panel.ts (T022)"
Task: "Extend PrListSectionWithRows (T023)"
Task: "Update makePrListSection factory (T024)"
Task: "Update renderPrListSection with gating conditional (T025)"
```

---

## Implementation Strategy

### MVP Definition

**Minimum shippable increment**: Phase 1 + Phase 2 + Phase 3 + T040 + T041 + T046 (Phase 5 baseline + parity-gate smoke).

US1 alone produces a valid MVP because INV-08 forces atomic emission — by the time T018+T019 ship, all three fields are emitted by the aggregator; T025 introduces the renderer conditional; T034 (US2's third-column render) is the only delta between US1-only render and full-feature render. If shipping US1 alone, the drill-down renders two of three columns — this is an INVARIANT VIOLATION (INV-08 "indivisible unit in the rendered contract"). Therefore **US1 and US2 MUST ship together**; "MVP" conceptually stops at US1 only for testing / review purposes, not for release.

### Incremental Delivery

1. Complete Setup (Phase 1) — parity-gate wiring ready, no schema changes yet
2. Complete Foundational (Phase 2) — schema expanded, parity gate green, both demo variants built, byte-identity locked
3. Complete US1 (Phase 3) — producer emits all three fields, renderer shows thread_count + comment_count
4. Complete US2 (Phase 4) — renderer adds active_thread_count; INV-09 property verified
5. Complete Polish (Phase 5) — SC-03 baseline DOM locked, spread guard in place, quickstart walked

### Parallel Team Strategy

With multiple developers:

- Phase 1 + Phase 2 are single-developer-friendly (many files, mostly independent edits — Phase 2 Track A/B/C above enable parallelism if 2-3 developers are available)
- Phase 3 producer track and consumer track can run in parallel (one developer on aggregator + tests, another on UI + tests)
- Phase 4 is narrow (one developer) — US2's third column + sort/filter is small surface
- Phase 5 is [P]-heavy; tests and guard can be authored concurrently

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks
- `[Story]` label (US1 / US2) maps task to specific user story for traceability; omitted for Setup, Foundational, and Polish
- US1 and US2 ship together per INV-08; testing and acceptance are story-scoped, but release is atomic
- Every test-adding task bumps `.test-floor-contract.json` in the same commit (QG-43; user's standing ratchet-bump-same-commit rule)
- No `typing.Any` anywhere (QG-40); no inline suppressions (`# noqa`, `# type: ignore`, `// eslint-disable`, `// @ts-ignore`) anywhere (QG-41)
- Every new test file defined unconditionally at module scope (QG-46 + user's collection-stable rule)
- Cross-OS (QG-39) — all code + tests must run on Windows, macOS, Linux; no OS-specific assumptions
- Commit boundary: atomic schema expansion across the 4 surfaces (DIRECTIVE 1) lands as ONE commit (T007 + T008 + T009 + T011 + T017 together or closely coordinated) to keep the parity gate green at every commit in the range
- Per the standing "Never push without explicit command" rule: task-level commits are local; no push unless explicitly directed

---

## Out of Scope (preserved from spec)

- Capability 1 (weekly discussion-volume trend chart) — #322's follow-on feature
- Capability 2 (per-author / per-repo / per-reviewer density breakdowns) — #322
- SC-05 cross-feature reconciliation test — #322 (per DIRECTIVE 6 / R-07; not this feature's CI)
- Team-dimension surfaces (per-team breakdowns, team-level unresolved indicator) — #321, blocked on team-at-time-of-PR history modeling
- Changes to the core PowerBI CSV contract (INV-05)
- Changes to the comment extractor (INV-06)
- Lifting the Feature 060 top-500-per-week cap (INV-02)
- AI summarization of review discussions
- Privacy-posture framing around comment body text
