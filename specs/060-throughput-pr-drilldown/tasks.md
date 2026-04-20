---

description: "Tasks for 060 — Throughput chart PR-level drill-down (Pass 1 draft)"
---

# Tasks: Throughput chart PR-level drill-down

**Input**: Design documents from `specs/060-throughput-pr-drilldown/`
**Prerequisites**: `plan.md` + `spec.md` (28 FRs, 16 SCs — Pass 4 hardened, Codex-reviewed, plan Pass 2 hardened). Every FR anchored in `code-surface-map.md`. Every task below traces to one or more FR / SC identifiers.

**Tests**: TDD — write failing test first, then implement, then verify. Feature is enterprise-coverage mandatory (QG-42).

**Organization**: Tasks grouped by the 5 user stories from `spec.md`. Phase 2 Foundational carries the FR-014 ordering-gate prerequisite (privacy doc + test) so that no later task lands `prs`-producing code without the mechanized ordering gate already in place.

## Format: `- [ ] TxxxID [P?] [Story?] Description with file path`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks in the same phase)
- **[US#]**: user-story label (US1 / US2 / US3 / US4 / US5) — required for story-phase tasks; omitted elsewhere
- FR / SC refs in parentheses at the end of each description

## Path Conventions

- Python backend: `src/ado_git_repo_insights/`
- Python scripts: `scripts/`
- Python tests: `tests/unit/`, `tests/integration/`, `tests/demo/`
- Extension UI: `extension/ui/`
- Extension tests: `extension/tests/`
- Docs: `docs/`

All paths are repository-relative. Code-surface anchors are cited where the plan's Pass 3 mapping named them.

**Note on source-file line numbers**: line-number anchors cited in task descriptions (e.g., `aggregators.py:648`, `detail-panel.ts:70`, `metrics.ts:440`, `build-demo-dataset.py:1044`) are planning-time references. They MAY shift as earlier tasks land in the branch. Task validity depends on the filename plus surrounding function / symbol name; verify line positions at implementation time against the current file state. `code-surface-map.md` Pass 3 anchors have the same drift property.

## Cross-OS discipline (QG-39)

Every shell command, subprocess invocation, file operation, and path manipulation in this task plan MUST work on Windows (both PowerShell and `cmd.exe`), macOS, and Linux — not just bash. Implementation instructions MUST prefer language-native APIs (`pathlib`, `shutil`, Python subprocess with list-args, Node `path`) over shell tools. **Banned without an explicit cross-OS equivalent**: `mkdir -p`, `rm -rf`, `cp -r`, `rsync`, `robocopy`, `find ... -exec`, backtick command substitution, `/dev/null` redirects, forward-slash-only path comparisons, `cmd /c` wrappers. Authoritative entry points referenced by tasks (`python scripts/...`, `pnpm ...`, repo helpers like `promote_data`) are cross-OS-safe by construction and are preferred over bespoke shell idioms.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Orient the branch; confirm prerequisites; no new source code yet.

- [ ] T001 Verify local preflight baseline on branch tip: `python scripts/run_pr_preflight.py` returns 0 before any edits. (QG-29, QG-35, QG-36)
- [ ] T002 Confirm `.test-floor-contract.json` reflects current floor on `origin/main`; record baseline Python and Extension floor values in commit notes for use by the test-floor Δ protocol. (SC-016, QG-43, QG-44)
- [ ] T003 [P] Ensure the feature scratch dir `.tmp/060-verify` exists and is writable. Implementation MUST be OS-neutral — e.g., `python -c "from pathlib import Path; Path('.tmp/060-verify').mkdir(parents=True, exist_ok=True)"`. Do NOT use shell-specific idioms such as `mkdir -p` (fails on Windows `cmd.exe` and PowerShell). Runnable from any shell (bash, PowerShell, cmd.exe) — the Python one-liner is shell-neutral by design. No commit. (QG-39)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Land the FR-014 privacy-posture ordering gate **before** any commit in this branch touches aggregator producer code; establish shared data-type definitions and the stable-container schema that every user story depends on.

**⚠️ CRITICAL**: Phase 2 MUST complete (committed on this branch) before any user-story phase. The FR-014 mechanized ordering gate (T007) enforces this at pre-push and CI — commits that bring `prs` producer code without prior privacy-doc + gate will fail the build.

### 2a. Privacy posture + ordering gate (FR-014)

- [ ] T004 Add the "Tenant-sensitive fields and public-surface stripping" section to `docs/reference/dataset-contract.md`: (a) private tenant artifacts MAY contain `prs`, `_prs_truncated`, `_prs_cap`; (b) public/demo artifacts MUST NOT; (c) rule extends to future tenant-sensitive fields. Include a stable anchor string the ordering gate can grep for. (FR-014)
- [ ] T005 [P] Write failing test `tests/unit/test_privacy_posture_ordering.py` that asserts: if producer code path (detected by grep of `"prs"` output-dict emission in `src/ado_git_repo_insights/transform/aggregators.py` OR presence of `PrRecord` TypedDict in `src/ado_git_repo_insights/types.py`) is present in worktree AND the privacy-posture anchor string is absent from `docs/reference/dataset-contract.md`, the test MUST fail. (FR-014 enforcement, SC-015-style static check)
- [ ] T006 Implement the ordering-gate test body from T005 to pass once T004 is in tree (current state: T004 present, no `PrRecord` or aggregator `prs` emission yet → test passes vacuously; will start failing once Phase 3 T014 lands without the doc, correctly blocking). (FR-014)
- [ ] T007 Bump `.test-floor-contract.json` Python floor by +1 for T005/T006 in same commit as T005/T006. Verify `python scripts/check_ratchet_bump.py --base-ref origin/main` returns 0. (SC-016, QG-43)

### 2b. Shared types and schemas (FR-001 backward-compat)

- [ ] T008 [P] Add `PrRecord` TypedDict to `src/ado_git_repo_insights/types.py` alongside existing `RepositoryRecord` (types.py:215 house style). Five fields: `id: int`, `title: str`, `author_id: str`, `repository_id: str`, `cycle_time: float`. No `typing.Any`. (FR-001, QG-40)
- [ ] T009 [P] Add `PrRecord` interface to `extension/ui/schemas/rollup.schema.ts`. Extend `validateRollup` permissive validator to log warnings (not fail) on absent `prs` / `_prs_truncated` / `_prs_cap`. Permissive validator preserves backward-compat per FR-001 load-path clause. (FR-001, FR-013)
- [ ] T010 [P] Extend the `Rollup` interface in `extension/ui/dataset-loader.ts:113` with three optional fields: `prs?: readonly PrRecord[]`, `_prs_truncated?: boolean`, `_prs_cap?: number`. All `readonly`, all optional (FR-001 backward-compat). (FR-001)

### 2c. PR-detail stable container scaffolding (FR-020)

- [ ] T011 Add `PrListSection` variant to the sealed `PanelSection` union in `extension/ui/modules/shared/detail-panel.ts:70`. Interface carries `type: "pr-list"` discriminant plus internal `contentState: "pr-list" | "supported-empty" | "team-inline" | "reviewer-inline"` discriminant. Forbid sibling variants for the four content states; forbid conditional section omission. (FR-020, data-model §5, contracts/pr-list-section.md)
- [ ] T012 Add `makePrListSection(...)` construction helper to `detail-panel.ts` matching existing pattern (`makeBreakdownTable`, `makeStatRow`, `makeEmptyState`). Also stub `renderPrListSection` returning an always-same `<section id="pr-detail" class="detail-panel-section detail-panel-section--pr-detail">` with the stable ARIA identity; child content is a placeholder that later phases will swap. Add the `"pr-list"` case to the `renderSection` switch at `detail-panel.ts:260`. (FR-020, SC-010)

### 2d. Unsupported-filter authoritative predicate (FR-024, FR-026)

- [ ] T013 [P] Create `extension/ui/modules/drilldown/filter-support.ts` exporting `classifyFilterState(filters, comparisonActive) → FilterClassification`. Precedence: comparison > team > reviewer > supported (FR-026). Discriminated union `{ classification: "comparison" | "team" | "reviewer" | "supported" }`. Pure function; no side effects; no module state. (FR-024, FR-026, contracts/filter-support.md)

### 2e. Phase 2 test-floor bump

- [ ] T014 Write failing `extension/tests/modules/drilldown/filter-support.test.ts` covering the 8 comparison×team×reviewer combinations from `contracts/filter-support.md` plus multi-team and multi-reviewer cases (11 test cases). Tests run against the T013 module; all 11 MUST pass once T013 lands. (FR-024, FR-026, SC-015)
- [ ] T015 Add static-check test (e.g., `extension/tests/invariants/filter-classification-single-authority.test.ts`) asserting no other file under `extension/ui/modules/drilldown/` uses `filters.teams.length` / `filters.reviewers.length` patterns — all classification funnels through `filter-support.ts`. (FR-024, SC-015)
- [ ] T016 Bump `.test-floor-contract.json` Extension floor by +12 (T014: 11 + T015: 1) in same commit as T014/T015. (SC-016, QG-43)

**Checkpoint 2**: Phase 2 complete. Committed artifacts include: privacy-posture doc, ordering-gate test, `PrRecord` types (Python + TS), `Rollup` extension, `PrListSection` sealed-union variant + stub renderer, `classifyFilterState` predicate + 12 locked tests. Every downstream story builds on this foundation. `check_ratchet_bump` returns 0 across the Phase 2 commits.

---

## Phase 3: User Story 1 — Explain a weekly throughput spike with individual PRs (Priority: P1) 🎯 MVP

**Goal**: A user clicks any throughput bar under the unfiltered dashboard state and sees the individual PRs that contributed to that week, with title, cycle time, and a clickable ADO link. Top-500 truncation is aggregator-side; when truncation applied, the indicator shows both counts.

**Independent Test**: With no filter applied, click a throughput bar for a week with PRs → panel opens; PR section lists the PRs in cycle-time-desc order with working links. For a >500-PR week, exactly 500 rendered plus a truncation indicator.

### 3a. Tests for US1 (TDD — write first, expect failure until 3b lands)

- [ ] T017 [P] [US1] Write `tests/unit/test_aggregators_pr_records.py` with cases: PR array shape + field order; sort key `(-cycle_time, id)`; truncation to 500 + `_prs_truncated=true` at 501; no `_prs_truncated` at 500; exclusion of PRs with NULL `cycle_time_minutes`; `_prs_cap=500` always present when `prs` present. (FR-001, FR-002, FR-003, contracts/pr-record.md §producer)
- [ ] T018 [P] [US1] Extend `tests/integration/test_golden_outputs.py` with one new case: same DB state → byte-identical rollup JSON across two runs including `prs`/`_prs_truncated`/`_prs_cap` fields. Follows existing `test_golden_output_deterministic` pattern (test_golden_outputs.py:157). (FR-012, SC-005)
- [ ] T019 [P] [US1] Write `extension/tests/modules/shared/pr-url.test.ts`: URL composition correctness for known org/project/repo triple; fallback to numeric-id URL when repo name missing from mapping. (FR-005, FR-005a, SC-009)
- [ ] T020 [US1] Extend `extension/tests/modules/drilldown/throughput-drilldown.test.ts` with: unfiltered week → panel opens, PrListSection rendered with `contentState="pr-list"`, rows contain PR title / cycle time / URL; >500-PR week → truncation indicator visible with both counts. (FR-004, FR-006, FR-008, FR-017, SC-002, SC-007)
- [ ] T021 [US1] Extend `extension/tests/modules/shared/detail-panel.test.ts` with: `PrListSection` variant renders always-same `<section id="pr-detail">` across content state toggles (asserts FR-020 stable identity for the two rendered states reachable from US1: `"pr-list"` and `"supported-empty"` when the rollup has no `prs`). (FR-020, SC-010)

### 3b. Implementation for US1

- [ ] T022 [US1] Extend `_generate_weekly_rollups` in `src/ado_git_repo_insights/transform/aggregators.py:648` per-week groupby loop: compute qualified PR set (exclude NULL `cycle_time_minutes`), sort by `(-cycle_time_minutes, pull_request_id)`, compute `_prs_truncated = len(qualified) > _prs_cap`, truncate via `[:500]`, serialize to `PrRecord` dicts, attach `prs` + `_prs_truncated` + `_prs_cap=500` to rollup output dict at line ~697. (FR-001, FR-002, FR-003, FR-012, FR-025)
- [ ] T023 [P] [US1] Create `extension/ui/modules/shared/pr-url.ts` exporting `resolvePrUrl(pr, repositoriesDimension, webContext) → string`. Compose `https://dev.azure.com/{org}/{project}/_git/{repo-name}/pullrequest/{pr.id}` from the dimension map. Fallback path: numeric-id URL when repo name is unresolvable. No URL ever persisted; derivation-only. (FR-005, FR-005a)
- [ ] T024 [US1] Implement `renderPrListSection` content-state branch `"pr-list"` in `detail-panel.ts`: render heading + truncation indicator (when `renderedCount < actualFilteredCount`) + `<ol>` of PR rows. Each row: clickable `<a>` link (target=_blank, rel=noopener), PR title (escaped), formatted cycle time. Reuse `renderTruncationIndicator` from `extension/ui/modules/shared/chart-layout.ts:16` with `noun="PRs"`, `maxPoints=capValue`. (FR-004, FR-017, contracts/pr-list-section.md)
- [ ] T025 [US1] Extend `buildPanelContent` in `extension/ui/modules/drilldown/throughput-drilldown.ts:67`. After the Phase 1 `byAuthor` and `byRepository` sections, always append a third section: call `classifyFilterState(currentFilters, false)` (comparison branch already handled upstream by `activate` at line 144), then construct the appropriate `PrListSection` content state. For `"supported"` classification: if `rollup.prs` present and non-empty → `contentState="pr-list"` with rows built via `resolvePrUrl`; if absent or empty → `contentState="supported-empty"`. Scope note: this task covers the unfiltered / no-active-filter branch of FR-021 (filter integration into `applyFiltersToRollups` lands in T031 / Phase 4). (FR-006, FR-009, FR-011, FR-016, FR-018, FR-020, FR-021)
- [ ] T026 [US1] Verify T017–T021 all pass. Run `cd extension && pnpm test`. Run `python scripts/run_pytest.py tests/unit/test_aggregators_pr_records.py tests/integration/test_golden_outputs.py`. Additionally, add ONE assertion INSIDE the existing T020 test (no new test file, no new test case — preserves T027 floor delta): verify the throughput bar's Phase 1 affordance attributes (`tabindex`, `role`, `aria-label`, `cursor:pointer` via computed style check) are unchanged from a Phase 1 baseline snapshot. Simplest implementation: extract the bar element before and after 060 render paths, compare outerHTML / relevant attribute map. Enforces FR-011. (SC-001 partial, SC-005, SC-009, FR-011)
- [ ] T027 [US1] Bump `.test-floor-contract.json` Python floor by +2 (T017 + T018 net-new) and Extension floor by +3 (T019 + T020 + T021 net-new-cases — existing test files extended, may count differently; measure precisely via `scripts/check_ratchet_bump.py --preview`). Commit T022–T027 together (or in logical groups) with matching ratchet bumps. (SC-016, QG-43)

**Checkpoint US1 (MVP)**: Aggregator emits PR arrays; extension renders them under unfiltered state; PR links navigate to ADO; truncation indicator correct. Users can now explain a spike by seeing the PRs that drove it — **the core user value is shipped**. Phase 1 drill-down behavior unchanged (FR-015). Can ship as MVP; subsequent stories extend capability but are not required for baseline value.

---

## Phase 4: User Story 2 — Filtered drill-down agrees with the filtered count (Priority: P1)

**Goal**: With author-only, repository-only, or author+repository filters active, the rendered count of PR records equals `filtered_prs.length` produced by the single authoritative filter operation (FR-021). When `_prs_truncated=false` this also equals the filtered `pr_count`; when `_prs_truncated=true` it may be a documented strict subset of `filtered_pr_count` and the truncation indicator displays both values.

**Independent Test**: Apply a repo filter → click a bar → assert panel shows N pulls where N matches filtered pr_count on the chart. Repeat with author filter. Repeat combined.

### 4a. Tests for US2 (TDD)

- [ ] T028 [P] [US2] Write `extension/tests/modules/drilldown/pr-list-count-parity.test.ts`: for each fixture week × filter combination (unfiltered, author-only, repo-only, author+repo), assert `rendered_count === filtered_prs.length` (SC-002) AND truncation indicator visibility equals `rendered_count < actual_filtered_count`. Fixture MUST include both `_prs_truncated=true` and `_prs_truncated=false` weeks. (FR-008, FR-021, SC-002, SC-011)
- [ ] T029 [P] [US2] Write `extension/tests/parity/repo-mapping-parity.test.ts`: (i) dimensions artifact includes `repository_name` for every `repository_id` referenced by loaded rollup `prs`; (ii) mapping byte-identical across dashboard/settings/dataset-loader/artifact-client entry points (house parity pattern from `parity/prod-shape-edge-cases.test.ts`). (FR-005a, SC-009)
- [ ] T030 [P] [US2] Write single-authoritative-filter-operation static test (e.g., in `extension/tests/invariants/`): grep `extension/ui/modules/metrics.ts` for any pattern that filters `rollup.prs` outside the `applyFiltersToRollups` function body — MUST return zero matches. Prevents dual-path filter logic. (FR-021)

### 4b. Implementation for US2

- [ ] T031 [US2] Extend `applyFiltersToRollups` in `extension/ui/modules/metrics.ts:440` single-pass map callback to also filter the `prs` array using the SAME `author_id` / `repository_id` predicates that rebuild aggregate fields. Single invocation produces BOTH filtered `pr_count` and filtered `prs` against the same input rollup object. Forbid parallel function, cached intermediate, second invocation, conditional path, post-processing pass. (FR-021 ONE-input-to-ONE-output, data-model §4)
- [ ] T032 [US2] Verify T028–T030 pass. Confirm FR-021 subset semantics hold: when `_prs_truncated=true`, rendered set is subset of aggregate attribution; when `_prs_truncated=false`, element-wise identical. (FR-021, SC-002, SC-011)
- [ ] T033 [US2] Bump `.test-floor-contract.json` Extension floor by +3 (T028, T029, T030). Commit T028–T033 atomically. (SC-016, QG-43)

**Checkpoint US2**: Filter-identity locked at the single authoritative filter operation. Combined filters work. Parity across dashboard entry points verified. User Story 1 + User Story 2 together satisfy the "explain the spike under any supported filter" user value.

---

## Phase 5: User Story 3 — Clear inline explanation when PR-level detail is unavailable (Priority: P1)

**Goal**: Under team or reviewer filter, panel opens with Phase 1 aggregate sections intact PLUS an inline explanatory message in the PR-detail container (not a toast). Under comparison mode, Phase 1 toast-denial behavior is preserved unchanged.

**Independent Test**: Apply team filter → click bar → panel opens, aggregate sections render, PR-detail container shows "Clear the team filter to view PR-level detail." Same for reviewer filter. Comparison mode: panel does NOT open, comparison toast appears (unchanged Phase 1).

### 5a. Tests for US3 (TDD)

- [ ] T034 [P] [US3] Extend `extension/tests/modules/drilldown/throughput-drilldown.test.ts` with team-filter-active case: panel opens, Phase 1 aggregate sections render, PR-detail container's `contentState="team-inline"`, message text names team filter. (FR-007, FR-010, FR-011, FR-015, FR-026, SC-003)
- [ ] T035 [P] [US3] Extend `extension/tests/modules/drilldown/throughput-drilldown.test.ts` with reviewer-filter-active case: `contentState="reviewer-inline"`, message names reviewer filter. (FR-007, FR-010, FR-011, FR-015, FR-026, SC-003)
- [ ] T036 [P] [US3] Extend `extension/tests/modules/drilldown/throughput-drilldown.test.ts` with comparison-mode-active case: panel does NOT open, comparison advisory toast fires (Phase 1 contract preserved); PR-detail container is not constructed because `activate()` returns early. (FR-007a, FR-015, FR-026, SC-003, SC-006)
- [ ] T037 [P] [US3] Extend `detail-panel.test.ts` to assert stable container identity across all FOUR content states including `"team-inline"` and `"reviewer-inline"`. Snapshot-style test: same element id, class, tag, position, ARIA identity; only children swap. (FR-020, SC-010)

### 5b. Implementation for US3

- [ ] T038 [US3] Implement `renderPrListSection` content-state branch `"team-inline"` in `detail-panel.ts`: heading + `<p class="pr-detail-gated" aria-live="polite">Clear the team filter to view PR-level detail.</p>`. `aria-live="polite"` on the message element (not the container), announcement as status change per FR-010 (not alert). (FR-007, FR-010)
- [ ] T039 [US3] Implement `renderPrListSection` content-state branch `"reviewer-inline"` in `detail-panel.ts`: same pattern as T038, message names reviewer. (FR-007, FR-010)
- [ ] T040 [US3] Extend `buildPanelContent` in `throughput-drilldown.ts` switch to map `classification.classification === "team"` → `contentState: "team-inline"` and `classification.classification === "reviewer"` → `contentState: "reviewer-inline"`. (FR-007, FR-024, FR-026)
- [ ] T041 [US3] Verify `throughput-drilldown.ts:activate()` still short-circuits on `isDrilldownDisabledByComparison()` at the current line 144 location — DO NOT refactor that check; it preserves FR-007a toast-denial unchanged. (FR-007a, FR-015)
- [ ] T042 [US3] Bump `.test-floor-contract.json` Extension floor by +4 (T034, T035, T036, T037 — each a net-new test case in existing files, floor bumps by case count). Commit T034–T042 atomically. (SC-016, QG-43)

**Checkpoint US3**: All four drill-down filter states handled correctly. Phase 1 comparison-mode behavior preserved exactly. Team/reviewer unsupported filters gate only the PR-section, not the whole panel (the Pass-1 revision after Codex catch). Inline messages are persistent section content, not toasts.

---

## Phase 6: User Story 4 — Empty supported filter opens the panel with an empty state (Priority: P2)

**Goal**: When a supported filter yields zero matching PRs for a given week, the panel opens normally and the PR section shows an empty-state message — distinct in content from the unsupported-filter message.

**Independent Test**: Choose a fixture where a supported filter yields zero matches for a specific week → click that bar → panel opens with PR section showing "No PRs match the active filter in this week."

### 6a. Tests for US4 (TDD)

- [ ] T043 [P] [US4] Extend `throughput-drilldown.test.ts` with supported-filter-zero-match case: panel opens, PR-detail container `contentState="supported-empty"`, message text is distinct from team-inline / reviewer-inline copy. (FR-009, FR-018, SC-002 trivial case)

### 6b. Implementation for US4

- [ ] T044 [US4] Extend `renderPrListSection` content-state branch `"supported-empty"` in `detail-panel.ts` (if not already covered by T012 stub or T024): heading + `<p class="detail-panel-empty-detail">No PRs match the active filter in this week.</p>`. Copy is DISTINCT from team/reviewer inline copy (FR-018). (FR-009, FR-018)
- [ ] T045 [US4] Verify T043 passes. Bump `.test-floor-contract.json` Extension floor by +1 for T043. Commit T043–T045 atomically. (SC-016, QG-43)

**Checkpoint US4**: Empty-as-legitimate-state distinct from unsupported-gate. User can tell "we looked and found nothing" vs "this dimension isn't supported here." All four content states now implemented.

---

## Phase 7: User Story 5 — Public demo remains aggregate-only (Priority: P1)

**Goal**: The single production write boundary (`promote_data` at `build-demo-dataset.py:1044`) invokes the strip gate as its first step when destination equals `DOCS_DATA_DIR` — removing `prs` / `_prs_truncated` / `_prs_cap` and raising on residue. Standalone-bypass in `generate-demo-data.py` is closed separately via `DEFAULT_OUTPUT_DIR` change + early-exit guard. On gate failure, `docs/data/` is byte-identical to its pre-run state (gate runs before the copy step — see FR-023 privacy-safety invariant).

**Independent Test**: Run `python scripts/build-demo-dataset.py`; verify no `prs` / `_prs_truncated` / `_prs_cap` keys appear in any `docs/data/aggregates/weekly_rollups/*.json`. Inject a synthetic residue; re-run; verify build fails hard AND `docs/data/` remains intact.

### 7a. Tests for US5 (TDD)

- [ ] T046 [P] [US5] Write `tests/unit/test_strip_pr_arrays.py` with cases: directory-with-mixed-rollups → all three fields stripped; already-stripped input → no modifications, no error; non-existent dir → `FileNotFoundError`; synthetic residue injection after strip → `PrArrayResidueError` raised; per-contracts/demo-strip-gate.md positive + negative matrix. (FR-023, SC-013)
- [ ] T047 [P] [US5] Extend `tests/demo/test_demo_parity_pipeline.py` with: after `build-demo-dataset.py` run, assert zero `prs` / `_prs_truncated` / `_prs_cap` in every published rollup; synthetic-leak test asserts build fails hard AND `docs/data/` byte-identical to pre-run. (FR-013, FR-023 atomic, SC-004, SC-013)

### 7b. Implementation for US5

- [ ] T048 [P] [US5] Create `scripts/strip_pr_arrays.py`: pure helper per `contracts/demo-strip-gate.md`. Function `strip_pr_arrays_from_rollups(rollup_dir: Path) → StripReport`. Strip-and-re-verify semantics. Raises `PrArrayResidueError` on residue. Cross-OS safe (`pathlib`, no shell). (FR-023, QG-39)
- [ ] T049 [US5] Wire strip gate INSIDE `promote_data` (at `scripts/build-demo-dataset.py:1044`) as its first step: when destination is `DOCS_DATA_DIR` (or any future configured public-surface root), invoke `strip_pr_arrays_from_rollups(source_dir / "aggregates")` before the existing `shutil.copytree` call. On gate failure, raise and do NOT proceed to the copy step — `docs/data/` untouched. This is the single authoritative gate site; no separate gate at the call site. (FR-023 gate-inside-promote_data)
- [ ] T050 [US5] Close the `generate-demo-data.py` standalone-bypass path. Source-verified flow: in production, `generate-demo-data.py` is invoked only via `build-demo-dataset.py:run_generator` (line 1095) which passes `ARTIFACT_DATA_DIR` explicitly — the script's `DEFAULT_OUTPUT_DIR = docs/data/` (line 105) is NEVER exercised in production. However, a developer invoking the script standalone would bypass `promote_data` entirely and write directly to `docs/data/`, defeating the T049 gate.

   Required changes (both — defense in depth):
   1. Change `DEFAULT_OUTPUT_DIR` in `scripts/generate-demo-data.py` from `Path(__file__).parent.parent / "docs" / "data"` to a scratch location such as `Path(__file__).parent.parent / ".tmp" / "generate-demo-data-output"`. The orchestrated flow is unaffected because `build-demo-dataset.py` passes `ARTIFACT_DATA_DIR` explicitly and never uses the default.
   2. Add an early-exit guard near the top of `main()` (or immediately after `parse_args`) that raises a clear error when the resolved `--output-root` equals `DOCS_DATA_DIR`, with a message like "docs/data/ is managed by scripts/build-demo-dataset.py; use that script to publish." Rejects both the old default and any explicit `--output-root docs/data` invocation.

   **Do NOT** refactor the script for stage-then-promote semantics — that would break the orchestrated `run_generator(..., ARTIFACT_DATA_DIR)` contract. The gate lives at `promote_data` (T049), not inside `generate-demo-data.py`.

   A separate invariant test (added as a new T050a companion OR folded into T047) MUST grep `scripts/` and `.github/workflows/` for patterns that write to `docs/data/` outside of a `promote_data` call, and fail the build on any match. This prevents future reintroduction of bypass paths. (FR-023 bypass-prevention, QG-39)
- [ ] T051 [US5] Verify T046–T047 pass. Run `python scripts/build-demo-dataset.py --no-promote` against a fixture that includes PR arrays in the canonical root; confirm atomic-failure test passes. (FR-023, SC-004, SC-013)
- [ ] T052 [US5] Bump `.test-floor-contract.json` Python floor by +2 (T046 + T047 net-new test cases). Commit T046–T052 atomically. (SC-016, QG-43)

**Checkpoint US5**: Privacy posture mechanically enforced at every publish boundary. Synthetic leak test proves atomic failure. `docs/data/` cannot be corrupted by a partial strip. FR-014 ordering-gate test (T005/T006 from Phase 2) continues to pass throughout.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Remaining SCs + cross-story invariants + final verification.

### 8a. Cross-cutting tests

- [ ] T053 [P] Write `tests/integration/test_pr_record_snapshot_cadence.py`: (a) generate rollup via actual `cmd_generate_aggregates` CLI entrypoint; (b) SQL UPDATE a PR title in source DB; (c) re-run aggregator; (d) assert updated title in new rollup AND previous title absent. Real re-aggregation, not mocked. (FR-022, SC-012)
- [ ] T054 [P] Extend `tests/integration/test_golden_outputs.py` with cycle-time-tied fixture: two PRs with identical `cycle_time_minutes` in the same week; aggregate twice; byte-identical output; confirms `cycle_time desc, id asc` tie-break is stable in practice. (FR-025, SC-014)
- [ ] T055 [P] Add SC-001 measurability test in `extension/tests/modules/drilldown/throughput-drilldown-perf.test.ts`: fixture with 500 PRs; measure wall-clock between simulated `click` event and panel `is-open` class + PR rows in DOM; assert < 250ms; assert zero new `fetch`/`XMLHttpRequest`/SDK RPC calls during activation window (monkeypatch + spy pattern). (SC-001)
- [ ] T056 [P] Add keyboard-parity test in `throughput-drilldown.test.ts` covering Tab/Enter/Space activation across supported, team/reviewer unsupported, comparison-mode, and supported-empty states — outcomes match mouse-click parity per FR-016. (FR-016, SC-008)

### 8b. Documentation + quickstart

- [ ] T057 [P] Run the quickstart.md 10-step verification against the real-seed DB; update quickstart.md with any discrepancies between the documented commands and reality. (SC-001-SC-016 end-to-end)
- [ ] T058 [P] Review `code-surface-map.md` against landed code; tighten or correct any anchor that shifted during implementation. Non-contractual; housekeeping only. (N/A)

### 8c. Final gate checks (before PR)

- [ ] T059 Run `python scripts/run_pr_preflight.py` — full local PR gate returns 0. (QG-29, QG-35)
- [ ] T060 Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` — confirms `floor_delta == actual_delta` for every commit in the branch. (SC-016, QG-43, VR-30)
- [ ] T061 Run full Phase 1 drill-down test suite (059-chart-drill-down) — must be green unchanged. (FR-015, SC-006)
- [ ] T062 Bump `.test-floor-contract.json` for final Phase 8 additions (T053: +1 Python, T054: +1 Python integration case, T055: +1 Extension, T056: +1 Extension). Commit T053–T062 atomically OR across targeted sub-commits maintaining Δ protocol. (SC-016)

**Checkpoint Phase 8**: All 16 SCs verified via either an automated test or a quickstart step. All 4 Phase 1 hardening passes + plan-level Pass 2 invariants preserved. Branch is ready for `/speckit.analyze` cross-artifact audit, then PR creation.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: No code dependencies; verify baseline.
- **Phase 2 (Foundational)**: Depends on Phase 1. Blocks all user stories. FR-014 ordering gate (T004-T006) MUST land before any `prs`-producing code in any later task.
- **Phase 3 (US1)**: Depends on Phase 2. Can start immediately after Phase 2 commits land.
- **Phase 4 (US2)**: Depends on Phase 3 (US1 landed — specifically the aggregator `prs` emission from T022 and the throughput-drilldown `PrListSection` wiring from T025, since US2 tests exercise those paths under filters). Serial after US1.
- **Phase 5 (US3)**: Depends on Phase 3 (US1 landed — needs the `renderPrListSection` scaffolding and `classifyFilterState` integration in `buildPanelContent`). Can run in parallel with Phase 4 by a separate developer, though the test files overlap (`throughput-drilldown.test.ts`).
- **Phase 6 (US4)**: Depends on Phase 3 (US1 landed — supported-empty is a `contentState` value on the Phase 3 scaffolding). Can run in parallel with Phases 4 + 5.
- **Phase 7 (US5)**: Depends only on Phase 2 (PrRecord types) and optionally Phase 3 (aggregator emits `prs` so the strip gate has something to strip in integration tests). Can run in parallel with Phases 4-6 by a separate developer — no UI dependency.
- **Phase 8 (Polish)**: Depends on all prior phases. Some tasks (T057 quickstart, T059 preflight, T061 Phase 1 regression) are final-sign-off only.

### Parallel opportunities (single developer → serial; multi-dev → parallel)

**Within Phase 2**: T005/T008/T009/T010/T013 marked [P] — different files, no cross-dependency.

**Within Phase 3**: T017/T018/T019 tests are [P]. T023 `pr-url.ts` [P] with T022 aggregator. T024 renderer serial with T025 wiring. T026/T027 serial at tail.

**Cross-phase (after Phase 3 lands)**: A three-developer split:
- Developer A: US2 (Phase 4) — metrics.ts + parity tests.
- Developer B: US3 (Phase 5) — throughput-drilldown inline messages + detail-panel renderer.
- Developer C: US5 (Phase 7) — strip_pr_arrays + script wiring.

US4 (Phase 6) is small enough to tack onto whichever dev finishes earliest.

### Within each user story

- Tests (T017-T021 for US1, T028-T030 for US2, etc.) MUST be written and MUST FAIL before implementation.
- Models/helpers before integration (T008 `PrRecord` before T022 aggregator usage).
- Services before wiring (T024 renderer before T025 integration).
- Single-story verification (Txx6 "verify all pass" tasks) before committing.

---

## Parallel Example: User Story 1

```bash
# Three test files, different file paths, no shared state — run concurrently:
Task: "Write tests/unit/test_aggregators_pr_records.py covering PR shape, sort, truncation, field emission."
Task: "Write extension/tests/modules/shared/pr-url.test.ts covering URL composition + fallback."
Task: "Extend tests/integration/test_golden_outputs.py with byte-identical case for prs-bearing rollup."

# Two implementation tasks touching different files, no cross-dependency — can overlap:
Task: "Extend aggregators.py per-week groupby loop to emit prs + _prs_truncated + _prs_cap."
Task: "Create extension/ui/modules/shared/pr-url.ts with resolvePrUrl helper."
```

---

## Implementation Strategy

### MVP First (Phase 1 → 2 → 3 only)

1. Complete Phase 1: Setup (3 tasks, ~30 min).
2. Complete Phase 2: Foundational — privacy doc + ordering gate + types + stable-container scaffolding + predicate (13 tasks, ~2-3 hours with tests).
3. Complete Phase 3: User Story 1 — core MVP (11 tasks, ~1 day with tests + verification).
4. **STOP and VALIDATE**: manual + Jest tests confirm unfiltered drill-down renders PRs correctly; run Phase 1 regression suite. Demo to owner.
5. Ship MVP, collect feedback, prioritize next story based on real signal.

### Incremental delivery

- After MVP (Phase 3) ships: add Phases 4/5/6/7 in any order preferred. Each phase is independently shippable.
- Phase 7 (privacy/strip-gate) SHOULD land before any PR-level rollup is published to the demo surface in production — but tenant artifacts inside the extension are already safe because `docs/data/` is the only public surface.

### Parallel team strategy

Three-developer split after Phase 3 MVP lands (same-session or next-session):
- Dev A owns US2 (Phase 4); touches `metrics.ts` + new parity tests.
- Dev B owns US3 + US4 (Phases 5 + 6); touches `detail-panel.ts` + `throughput-drilldown.test.ts`.
- Dev C owns US5 (Phase 7); touches Python scripts only.

Merge order: US2 → US3/US4 → US5 → Phase 8 polish.

---

## FR / SC → Task cross-reference

| FR | Covered by tasks |
|---|---|
| FR-001 (prs field + backward-compat) | T008, T009, T010, T017, T022 |
| FR-002 (top-500 sort + tiebreak) | T017, T022 |
| FR-003 (4-field contract surface + immutability) | T017, T022 |
| FR-004 (section after Phase 1) | T020, T024, T025 |
| FR-005 (URL derivation) | T019, T023 |
| FR-005a (mapping availability + parity) | T019, T023, T029 |
| FR-006 (supported filter opens panel) | T020, T025 |
| FR-007 (team/reviewer inline) | T034, T035, T038, T039, T040 |
| FR-007a (comparison preserves Phase 1) | T036, T041 |
| FR-008 (rendered count criterion) | T020, T028 |
| FR-009 (supported-empty state) | T043, T044 |
| FR-010 (inline message pattern) | T038, T039 |
| FR-011 (affordance preserved) | T020, T034, T035 |
| FR-012 (byte-identical) | T018, T022 |
| FR-013 (public surface PR-free) | T047, T048, T049, T050 |
| FR-014 (privacy posture + ordering gate) | T004, T005, T006 |
| FR-015 (Phase 1 unchanged) | T026, T041, T061 |
| FR-016 (keyboard parity) | T056 |
| FR-017 (truncation indicator) | T020, T024 |
| FR-018 (classification by dimensions) | T044 |
| FR-019 (Phase 1 aggregates unchanged) | T025, T061 |
| FR-020 (stable container) | T011, T012, T021, T037 |
| FR-021 (single-pass filter identity) | T028, T030, T031 |
| FR-022 (snapshot cadence) | T053 |
| FR-023 (demo strip gate atomic) | T046, T047, T048, T049, T050 |
| FR-024 (single predicate) | T013, T014, T015, T040 |
| FR-025 (byte-stable tie-break) | T022, T054 |
| FR-026 (precedence) | T013, T014, T034, T035, T036, T040 |

| SC | Verified by tasks |
|---|---|
| SC-001 (250ms + no-fetch) | T055 |
| SC-002 (rendered count parity) | T020, T028 |
| SC-003 (inline/toast routing) | T034, T035, T036 |
| SC-004 (public surface PR-free) | T047 |
| SC-005 (byte-identical rollup) | T018 |
| SC-006 (Phase 1 regression clean) | T061 |
| SC-007 (unfiltered cap boundary) | T017, T020 |
| SC-008 (keyboard parity) | T056 |
| SC-009 (mapping + URL) | T019, T029 |
| SC-010 (stable container snapshot) | T021, T037 |
| SC-011 (combined-filter identity) | T028 |
| SC-012 (snapshot cadence) | T053 |
| SC-013 (demo leak-block) | T046, T047 |
| SC-014 (tie-break stability) | T054 |
| SC-015 (single predicate static check) | T015, T030 |
| SC-016 (test-floor Δ mechanized) | T002, T007, T016, T027, T033, T042, T045, T052, T060, T062 |

---

## Notes

- [P] = different files, no cross-task dependency within the same phase.
- [US#] = traceability to user stories; required in story phases only.
- Every task has an exact file path; every task traces to ≥1 FR or SC.
- TDD: tests written first, must fail, then implementation until green.
- Test-floor Δ: every commit that adds N tests MUST bump `.test-floor-contract.json` by exactly N in the SAME commit (SC-016). Pre-push gate will fail otherwise.
- Atomic commits recommended per phase; mandatory for Phase 2a (privacy-doc + ordering-gate must be visible before any `prs`-producer commit).
- Any deviation from the 28 FRs / 16 SCs requires reopening the spec — NOT a tasks-level decision.
