# Code-Surface Map (Pass 3 validation)

**Purpose**: Anchor every functional requirement in `spec.md` to a concrete module / function / file (existing or newly named). Per the user's Pass 3 discipline: if any FR cannot be pointed to a concrete code surface, the planner is blocked until the anchor is resolved.

This is an implementation-handoff artifact, not the contract. The spec remains authoritative.

## Conventions

- **Existing anchor**: host module + function + line number as of this branch's base.
- **New anchor**: module + function name the planner is expected to create under the project's house conventions.
- **Gap**: FR has no viable anchor and cannot be planned as written.

## FR → anchor matrix

| FR | Concern | Anchor (existing) | Anchor (new) |
|---|---|---|---|
| FR-001 | `prs` field on weekly rollup artifact | `src/ado_git_repo_insights/types.py` (TypedDict house style line 215–221 — `RepositoryRecord`) + `src/ado_git_repo_insights/transform/aggregators.py:85` (`WeeklyRollup` dataclass) | New `PrRecord` TypedDict in `types.py`; new optional field on `WeeklyRollup` (dataclass) — either a field holding a list, or serialized outside the dataclass in the inner loop at `aggregators.py:648` (per-week groupby block) |
| FR-002 | Top-500 sort + tie-break | — | Sort-and-truncate step inserted in `aggregators.py` per-week groupby loop (before the `rollup_dict = asdict(rollup)` assembly around line 697). Sort key: `(-cycle_time_minutes, pull_request_id)` |
| FR-003 | Truncation marker | — | `_prs_truncated: True` added to the rollup dict at the same assembly point as FR-002 |
| FR-004 | PR-list section after Phase 1 sections | `extension/ui/modules/drilldown/throughput-drilldown.ts:67` (`buildPanelContent`) — sections array is returned to `makePanelContent` on line 82 | Append a fourth section (new `PrListSection`) to the array at line 82-85 |
| FR-005 | URL composition (not persisted) | VSS web context via ADO SDK; used elsewhere in codebase | New helper `extension/ui/modules/shared/pr-url.ts` — `resolvePrUrl(pr, repositoriesDimension, webContext) → string` |
| FR-005a | `repository_id → repository_name` mapping availability + parity | `extension/ui/dataset-loader.ts:642` (`loadDimensions`); `DimensionsData.repositories` shape in `extension/ui/types.ts`; producer at `aggregators.py:486+` (`_generate_dimensions`) + `_df_to_repository_records` line 130-140 | New parity test in `tests/parity/` (or `extension/tests/parity/`) asserting byte-identical mapping across entry points and mapping-coverage vs any `repository_id` in a PR record |
| FR-006 | Panel opens under supported filters | `extension/ui/modules/drilldown/throughput-drilldown.ts:134` (`activate`) — already opens the panel | Unchanged for supported states (extend, not replace) |
| FR-007 | Team/reviewer → panel opens, PR section gated | Same `activate` function | PR-section gating logic in the new `buildPanelContent` fork (section content state selection) |
| FR-007a | Comparison mode preserved exactly | `throughput-drilldown.ts:144` (`isDrilldownDisabledByComparison()` check) | Unchanged — DO NOT refactor this branch |
| FR-008 | Rendered count = `min(filtered_pr_count, cap)` + truncation visibility | `extension/ui/modules/metrics.ts:440` (`applyFiltersToRollups`) | Extend `applyFiltersToRollups` to also filter the `prs` array using identical predicates. Panel consumes filtered length; does NOT recompute. Test in `extension/tests/modules/drilldown/pr-list-count-parity.test.ts` |
| FR-009 | Supported filter zero matches → empty-state content | `detail-panel.ts:143` (`makeEmptyState` helper as a pattern, but NOT the same variant) | New content state inside the PR-detail container; not a new `EmptyStateSection` instance — the container is always the PR-detail section |
| FR-010 | Inline message (persistent, polite, section-scoped) | Phase 1 `comparison-advisory.ts` pattern for toast — NOT reused here | New render branch inside `renderPrDetailSection` in `detail-panel.ts`; ARIA pattern matches Phase 1's `EmptyStateSection` semantics (status, not alert) |
| FR-011 | Bar affordance preserved | `extension/ui/modules/charts/throughput.ts:104` (bar template with `tabindex`/`aria-label`/`role`) | Unchanged |
| FR-012 | Byte-identical rollup output | Existing golden pattern in `tests/integration/test_golden_outputs.py:157` (`test_golden_output_deterministic`) | New golden case covering rollups with `prs` arrays — same pattern |
| FR-013 | Public publish MUST NOT contain `prs` | `scripts/build-demo-dataset.py` is the canonical rollup → `docs/data/` promotion (DOCS_DATA_DIR line 45; promote_dir logic line 1045+); other demo writers: `scripts/generate-demo-data.py` DEFAULT_OUTPUT_DIR line 105 | New strip step invoked before promotion in `build-demo-dataset.py`. Ideal location: a new helper `scripts/strip_pr_arrays.py` (or function inside build-demo-dataset) that processes rollups in the canonical artifact root before `atomic_replace_docs_data` runs |
| FR-014 | Written privacy posture | `docs/reference/dataset-contract.md` (existing contract doc) | New section in that file titled "Tenant-sensitive fields and public-surface stripping" |
| FR-015 | Phase 1 behavior preserved | All four Phase 1 drill-down consumers: `cycle-time-drilldown.ts`, `reviewer-drilldown.ts`, `sparkline-navigator.ts`, `throughput-drilldown.ts` (pre-this-slice behavior) | Enforced by existing Phase 1 test suite running green unchanged |
| FR-016 | Keyboard parity | `throughput-drilldown.ts:178-188` (keydown handler) | Unchanged — both click and keydown paths call the same `activate()` |
| FR-017 | Truncation indicator on PR list | `extension/ui/modules/shared/chart-layout.ts:16-23` (`renderTruncationIndicator(truncated, maxPoints, noun)`) | Call with `noun="PRs", maxPoints=500` inside the new PR-list content state |
| FR-018 | Filter classification by active dimensions, not match count | `extension/ui/modules/metrics.ts` filter logic; `extension/ui/modules/filters.ts:30` (`hasActiveFilters`) — too coarse, only "any" | The new predicate (see FR-024) |
| FR-019 | Phase 1 aggregates unchanged | `throughput-drilldown.ts:70-81` (`buildPanelContent` uses `rollup.by_author` / `rollup.by_repository` verbatim) | Unchanged — DO NOT change these calls |
| FR-020 | Stable PR-detail container | `detail-panel.ts` renderSection switch lines 260-269 | New always-rendered `renderPrDetailSection` returning a stable `<section id="pr-detail" class="detail-panel-section detail-panel-section--pr-detail">` whose children swap among four content states |
| FR-021 | Combined-filter PR list uses same code path as filtered `pr_count` | `metrics.ts:440` (`applyFiltersToRollups`); repo-filter branch at line 496; author-filter branch at line 515; combined uses `by_author_and_repo` at line 553 | PR-array filter plugs into the SAME path that resolves `pr_count` — one extension of `applyFiltersToRollups`, no parallel filter function. Parity test asserts element-wise equality |
| FR-022 | Snapshot-cadence integration test | `tests/integration/test_golden_outputs.py` house style | New `tests/integration/test_pr_record_snapshot_cadence.py`: uses real `cmd_generate_aggregates` CLI entrypoint, mutates DB via SQL, re-runs, asserts updated title |
| FR-023 | Demo-publish enforcement gate | Publish entry points: `scripts/build-demo-dataset.py` (promotion), `scripts/generate-demo-data.py` (direct write), `.github/workflows/{ci,demo,release}.yml` (orchestration) | New strip-and-assert step — fails if any rollup in promoted output contains `prs` / `_prs_truncated` / any PR-level field. Same authoritative command invoked from every write-path (currently three). Gate `assert_no_pr_arrays_in(rollup_dir)` function called as the last step before `atomic_replace_docs_data` |
| FR-024 | Single authoritative unsupported-filter predicate | `comparison-advisory.ts:60` (`isDrilldownDisabledByComparison`); `filters.ts:30` (`hasActiveFilters` — too coarse); none for team/reviewer classification | New `extension/ui/modules/drilldown/filter-support.ts` module: exports `classifyFilterState(filters, comparisonActive) → {supported: boolean, reason: "team"|"reviewer"|"comparison"|null}`. Consumed by `throughput-drilldown.ts` and by tests |
| FR-025 | Byte-stable sort tie-break determinism test | `tests/integration/test_golden_outputs.py:157` pattern | New test adds a fixture with two PRs at identical `cycle_time_minutes`; asserts byte-identical JSON across two aggregator runs |

## Gaps and risks identified (Pass 3) — all resolved in Pass 4 spec lock-down

1. **FR-023 entry-point wording**: resolved in Pass 4 — FR-023 now enumerates the exact write-paths (`scripts/build-demo-dataset.py`, `scripts/generate-demo-data.py`, and the three CI workflows that invoke them) and declares any future new path MUST invoke the same gate or fail.

2. **No existing client-side `.sort()` on PR-shaped arrays** (verified via grep across `extension/ui/`). The existing `.sort()` calls in drill-down modules are on aggregate breakdown entries (pr_count-keyed) and on ISO week strings — not on per-PR arrays. The "no client-side re-sort" invariant (FR-025 / supporting assumption) is vacuously satisfied today; planner should codify it with a grep-based invariant test specifically forbidding `.sort(` on the new PR-array field name. This is a planning-phase implementation hint — the behavioral contract is in the spec.

3. **Helper-extraction shape inside the aggregator**: resolved in Pass 4 — explicitly declared non-contractual. Out-of-scope section now says the helper shape is an implementation choice, not a spec contract. The spec anchors behavior (sort order, truncation, payload fields, determinism); it does not mandate internal function boundaries.

4. **Stable container refactor**: resolved in Pass 4 — FR-020 now locks the pattern precisely: SINGLE new `PanelSection` variant with an internal `contentState` discriminant; four values; branching only on that discriminant; multiple-variant and conditional-inclusion patterns explicitly FORBIDDEN.

5. **FR-005a parity test location**: `extension/tests/parity/` per the existing 4-entry-point enforcement surface (matching the house-style location of fixtures like `parity/prod-shape-edge-cases.test.ts`). This is a planning hint; FR-005a itself is locked.

## Pass 4 resolutions applied

- **FR-026 added**: locks comparison > team > reviewer > supported precedence; locks discriminated-result shape for the unsupported-filter predicate; forbids call-site reconstruction.
- **FR-021 tightened**: locks same-invocation production of filtered PR array and filtered `pr_count`; handles truncated-array subset semantics explicitly (rendered set is subset of aggregate-attribution set when `_prs_truncated=true`; element-wise identical when `_prs_truncated=false`).
- **FR-005a tightened**: declares "non-demo load paths" explicitly; demo paths never exercise URL composition; mapping guaranteed on every path where PR records can appear.
- **FR-003 rewritten as four-field contract surface**: `_prs_truncated`, `_prs_cap` (new rollup fields), `rendered_count`, `actual_filtered_count` (derived at display). Consumers read from payload; never recompute.
- **FR-008 + SC-002 aligned with FR-003**: rendered count = `filtered_prs.length` from the single authoritative filter op; truncation indicator surfaces both counts when they differ. Divergence under aggregator-truncation is documented behavior, not a violation.
- **FR-020 tightened**: single variant with `contentState` discriminant; sibling variants and conditional-section inclusion explicitly forbidden.
- **FR-023 tightened**: three enumerated write-paths + future-path requirement; single authoritative helper; strip-and-re-verify (not strip-or-verify).
- **FR-014 tightened**: exact privacy posture content (private-may / public-must-not / future-extensibility); ordering constraint (posture landed in same commit as or before first PR-array-producing code).
- **Helper extraction declared non-contract** in Out-of-scope section: any `_build_pr_records(group)` suggestion in this map is a non-contractual planning hint.

## All FRs anchored — no blocking gaps

Every FR has a concrete module+function anchor (existing or named new). The five risks above are planning-phase refinements, not missing anchors. Pass 3 validation passes.

## Addressed user verification items

| User Pass 3 item | Resolution |
|---|---|
| Truncation count enforced in code, not UI recompute | FR-008 + FR-002/FR-003: aggregator sorts + truncates + sets flag; `applyFiltersToRollups` produces filtered array; UI consumes length. Test at `extension/tests/modules/drilldown/pr-list-count-parity.test.ts`. |
| Mapping sourced from same artifact as aggregates | FR-005a: `loadDimensions` reads `aggregates/dimensions.json` — same artifact producer as rollups. Parity test compares resolution across entry points. |
| PR array attached to same rollup, filtered via same path | FR-021: `prs` is a field ON the rollup object; `applyFiltersToRollups` is extended to filter it with the same predicates. No parallel structure, no post-filter attachment. |
| Sort server-side only, no client re-sort | FR-025 + existing verification: no current `.sort()` on PR arrays in extension. Add grep-invariant test locking `rollup.prs.sort(` forbidden. |
| Demo-strip gate runs before every publish | FR-023 tightened to list actual write paths (three workflow entry points + build-demo-dataset + generate-demo-data). See Gap #1 for planner follow-up. |
| Shared unsupported-filter predicate | FR-024: new `filter-support.ts`. Import-analysis test forbids forked classification. |
| Stable container across four states | FR-020: new `renderPrDetailSection` always returns same `<section>` with stable identity; children swap. |
| Snapshot semantics via real re-aggregation | FR-022: integration test uses actual `cmd_generate_aggregates` CLI, not a mocked mutation. |
