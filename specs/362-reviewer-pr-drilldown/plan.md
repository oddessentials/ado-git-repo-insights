# Implementation Plan: Reviewer-Activity Chart PR-Level Detail

**Branch**: `362-reviewer-pr-drilldown` | **Date**: 2026-05-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/362-reviewer-pr-drilldown/spec.md`

## Summary

Wire a `PrListSection` into the existing reviewer drill-down panel after the Weekly activity breakdown table. Unlike #361 (consumer-only), this slice carries a real producer-side change locked at `/speckit.clarify` Q1 (Option A) and Q2 (cap = 500). Producer side: extend `_generate_reviewer_slice` (`src/ado_git_repo_insights/transform/aggregators.py:2139-2201`) with a per-(reviewer, week) `prs: list[PrRecord]` emission plus the truncation pair `_prs_truncated: bool` + `_prs_cap: int` on each `by_reviewer[reviewerId]` entry, sorted `cycle_time desc, id asc` BEFORE truncation, capped at `_PR_DETAIL_CAP_PER_REVIEWER_WEEK` (the producer-side alias for `_PR_DETAIL_CAP = 500` introduced by this feature). Consumer side: extend `installReviewerDrilldown` to accept a `ReviewerDrilldownOptions` bag mirroring `ThroughputDrilldownOptions` and `CycleTimeDrilldownOptions`; wire a `buildPrListSection` helper that uses a reviewer-stripped copy of the filter state when invoking the shared `classifyFilterState`. Demo + privacy posture: extend `scripts/strip_pr_arrays.py` `_strip_one` and `_verify_clean` to walk into `by_reviewer[*]` (verified at HEAD: `_strip_one:85-96` only pops the three `PR_LEVEL_FIELDS` from the rollup ROOT); update `scripts/generate-demo-data.py` to mirror the new sub-array. Spread guard: add `reviewer-drilldown.ts` to `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` `ALLOWED_MODULES` (verified at HEAD `:32-47` lists `throughput-drilldown.ts` + `cycle-time-drilldown.ts`). Both Python and Extension test floors bump in lockstep with their respective tests.

Primary deliverables:

1. Producer: `_generate_reviewer_slice` extension + `_PR_DETAIL_CAP_PER_REVIEWER_WEEK = _PR_DETAIL_CAP` alias + Python `ReviewerSliceMetrics` TypedDict extension at `src/ado_git_repo_insights/transform/types.py`.
2. Demo generator: `scripts/generate-demo-data.py` reviewer aggregation parallel-path mirror of the new sub-array.
3. Strip helper: `scripts/strip_pr_arrays.py` `_strip_one` + `_verify_clean` extended to walk `by_reviewer[*]` (the smallest-possible extension per CL-01 guardrail #4).
4. Schema: `extension/ui/schemas/rollup.schema.ts` `ReviewerBreakdownEntry` extended with `prs?: readonly PrRecord[]` + `_prs_truncated?: boolean` + `_prs_cap?: number`. PrRecord interface UNCHANGED. Schema-parity gate UNTOUCHED.
5. Consumer: `installReviewerDrilldown` accepts `ReviewerDrilldownOptions`; `buildPrListSection` helper appended after the existing weekly-activity table; reviewer-stripping wrapper around `classifyFilterState`.
6. Dashboard wire-up: `extension/ui/dashboard.ts` reviewer install gains the same options bag already constructed for throughput + cycle-time installs.
7. Spread guard: `reviewer-drilldown.ts` added to `ALLOWED_MODULES`.
8. Tests: Python (aggregator emission + cap-boundary 500/501 + strip-helper coverage + demo-generator coherence) + Extension (consumer-side rendering + filter overlay + truncation cue + supported-empty + capability-off DOM byte-identity + a11y + Tab reachability + comparison toast + retarget across reviewer change).
9. Both test floors bumped in same commit; no marker waiver attempted.
10. Implementation commit message body includes the SC-014 byte-budget before/after fixture-size report.

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline (per CLAUDE.md `Recent Changes` for #361 / 060 / 310 / 333 / 334 / 335).
**Primary Dependencies**: existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**
**Storage**: SQLite via existing `DatabaseManager`. **No schema changes; no migrations.** The producer reads from the same `reviewers` / `pull_requests` / `repositories` tables `_generate_reviewer_slice` already queries; the per-(reviewer, week) `prs[]` emission is derived from the existing `reviewer_prs` merged frame at `aggregators.py:2157-2163`.
**Testing**: pytest (Python — new aggregator emission tests, cap-boundary regression at 500/501, strip-helper coverage assertion, demo-generator parallel-path coherence) + Jest with jsdom (TypeScript — new consumer-side coverage for the PR list section across all reachable filter overlays + capability gates). **Both floors bump per FR-020.** Producer-side test floor (`python.min_collected`) gets ~+8 to +12 new tests; Extension floor (`extension.min_collected`) gets ~+10 to +14 new tests.
**Target Platform**: Azure DevOps Marketplace extension running inside the ADO web iframe (Chromium-based) AND the published demo at `docs/data/`. Cross-platform CLI (Windows / macOS / Linux) inherited via the existing test pipeline; this feature adds no OS-specific code.
**Project Type**: existing dashboard extension; no new top-level modules.
**Performance Goals**: Panel opens with PR list rendered inside the open-animation (no distinct loading state, no extra round-trip), matching the throughput + cycle-time drill-downs' UX. Per-(reviewer, week) PR array (≤500 records, capped by FR-016) adds no measurable client-side work compared to today's reviewer drill-down. The chart's existing 8-week display window (`MAX_REVIEWER_WEEKS = 8` at `extension/ui/modules/charts/reviewer-activity.ts:22`) bounds the consumer-side work to ≤8 weeks × ≤500 records = 4000 records max; in practice typical reviewers work in <100 records range.
**Constraints**: cross-OS compatibility (QG-39); no `typing.Any` (QG-40); zero new suppressions (QG-41); 4-entry-point parity (QG-47 / QG-49); per-commit ratchet bumps in same commit as tests (QG-43); local/CI parity (QG-35 — QG-38). No bypass markers used. `[ratchet-realignment]` Python-floor marker is permitted ONLY with explicit user authorization per FR-021; default plan is lockstep tests + same-commit floor bump (no marker).
**Scale/Scope**: per-(reviewer, week) `prs[]` capped at 500 records. Byte cost per PR record (5+3 PrRecord shape, JSON-encoded with whitespace) ≈150 bytes. With N≈3.3 reviewers per PR (memory `project_per_reviewer_multi_count_semantic.md`), the per-week duplication factor is ~3.3× the existing per-week `prs[]`. Over 26 weeks, the rollup grows by approximately the existing per-week-prs total × 3.3. **The exact before/after byte delta is captured in the implementation commit per SC-014; the spec does not pre-commit to a budget number, only to the measurement obligation.**

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

All 56 constitutional gates evaluated against this feature's scope. **No violations.**

### Gate disposition

| Gate                                       | Relevance              | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QG-01 — QG-08 (CSV / SQLite / persistence) | N/A                    | Feature does not touch CSV surface, SQLite schema, or pipeline persistence — the producer reads the existing `reviewers` / `pull_requests` / `repositories` tables and emits a new field set on the existing weekly-rollup JSON artifact, which is an aggregate, not a CSV.                                                                                                                                                                       |
| QG-09 — QG-12 (extraction)                 | N/A                    | No extraction changes.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| QG-13 — QG-14 (identity)                   | YES (reuse only)       | Uses existing `pull_request_id` + `repository_id` for URL composition via existing `resolvePrUrl`. The per-(reviewer, week) entry key continues to be `reviewer_id` (the stable `user_id` per `aggregators.py:2146-2148` comment). No new keys.                                                                                                                                                                                                   |
| QG-15 — QG-16 (runtime / secrets)          | N/A                    | No agent-runtime or secret-handling changes.                                                                                                                                                                                                                                                                                                                                                                                                      |
| QG-17 — QG-22 (release gates)              | YES                    | All standard checks (ruff, mypy, pytest, Jest, coverage, build) MUST pass; no relaxation.                                                                                                                                                                                                                                                                                                                                                         |
| QG-23 — QG-24 (documentation)              | YES (audit-trail line) | Per FR-022, an audit-trail line MAY be added to `docs/reference/dataset-contract.md` documenting that "covered-fields applies wherever the named field appears, including nested under `by_reviewer[*]`"; this is best-practice but not gate-enforced. The runbook and config-reference are unchanged.                                                                                                                                            |
| QG-25 — QG-29 (scalability)                | YES                    | New cap `_PR_DETAIL_CAP_PER_REVIEWER_WEEK = _PR_DETAIL_CAP = 500` integrates with existing MAX\_\*\_POINTS family. Dashboard render time unchanged — the per-(reviewer, week) PR array is processed client-side only on drill-down open (not on initial dashboard load). The 8-week display window bounds total client-side work.                                                                                                                 |
| QG-30 — QG-34 (demo parity)                | YES                    | Demo generator (`scripts/generate-demo-data.py`) extended via parallel-path mirroring (FR-023) to emit per-(reviewer, week) `prs[]` consistent with the demo's reviewer-cast-vote events. Strip helper (`scripts/strip_pr_arrays.py`) extended (FR-028) so demo/public artifacts contain no per-(reviewer, week) `prs` data. QG-32 (`docs/data/` clean promoted mirror) and QG-34 (startup-state parity) preserved by the strip extension.        |
| QG-35 — QG-38 (local/CI parity)            | YES                    | All new tests run via the existing `pnpm test` / `test:ci` chain + `pytest` chain; same gates fire on pre-commit, pre-push, and CI. `--no-verify` forbidden (QG-38).                                                                                                                                                                                                                                                                              |
| QG-39 (cross-OS)                           | YES (no-op)            | Producer change is `pandas` operations + dict construction; no `path.sep`, shell, or filesystem assumptions. Strip helper extension uses `pathlib` only (matches existing `_strip_one` style at `:85-96`). Consumer change is TypeScript-only.                                                                                                                                                                                                    |
| QG-40 (no `typing.Any`)                    | YES                    | New `ReviewerDrilldownOptions` interface uses precise types (mirroring `CycleTimeDrilldownOptions` field-for-field). The new Python `ReviewerSliceMetrics` extension uses `list[PrRecord]` / `bool` / `int` — all precise. The strip-helper extension uses `dict[str, object]` (matching `_load_rollup` return type). No `typing.Any` introduced.                                                                                                 |
| QG-41 (zero suppressions)                  | YES                    | `.suppression-baseline.json` stays at 0 across all scopes. No `eslint-disable` / `ts-expect-error` / `# type: ignore` introduced.                                                                                                                                                                                                                                                                                                                 |
| QG-42 (enterprise test coverage)           | YES                    | New consumer-side Jest coverage for FR-001 through FR-015 plus FR-019 (rendered-order). New producer-side pytest coverage for FR-016 (aggregator emission), FR-029 (cap-boundary at 500/501), FR-028 (strip-helper coverage). Every new code path tested.                                                                                                                                                                                         |
| QG-43 — QG-46 (test discipline)            | YES                    | `.test-floor-contract.json` `extension.min_collected` AND `python.min_collected` BOTH bumped by exactly the new test count in the same commit. No marker waiver attempted by default. Cross-OS Python collection parity preserved (new producer-side tests are platform-agnostic — pure pandas + sqlite, no platform-conditional file-name patterns introduced).                                                                                  |
| QG-47 — QG-49 (entry-point alignment)      | YES                    | New tests live under `tests/unit/test_aggregators_*` (already a triggered scope for pre-commit ruff + mypy + pytest) and `extension/tests/modules/drilldown/` (already a triggered scope for pre-commit `tsc` + ESLint + Jest). No new gates introduced. The shared primitives reused (`makePrListSection`, `classifyFilterState`, `resolvePrUrl`, `isPartialPrRow`) each have exactly one authoritative definition; no parallel implementations. |
| QG-50 — QG-52 (change acknowledgement)     | YES (N/A in practice)  | No version bump, no threshold change. `[ratchet-realignment]` marker is the only conditional acknowledgement in scope, AND its use is forbidden by default per FR-021 — the default plan is lockstep tests + same-commit floor bump. Coverage stays within 2% of baseline (additive code with full coverage).                                                                                                                                     |
| QG-53 — QG-55 (build architecture)         | YES                    | No tsconfig changes. New TypeScript code follows the existing split-tsconfig conventions. Prettier invoked only via `format:check` (unchanged).                                                                                                                                                                                                                                                                                                   |
| QG-56 (security scan)                      | YES                    | Gitleaks parity unchanged; new code is pure aggregator + UI wiring + tests, no secrets surface.                                                                                                                                                                                                                                                                                                                                                   |

**Gate evaluation: PASS.** No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/362-reviewer-pr-drilldown/
├── spec.md                         # Hardened spec (Pass 1 + Pass 2 + Pass 3 + clarify Q1+Q2 locked)
├── plan.md                         # This file
├── research.md                     # Phase 0 — verification log against HEAD
├── data-model.md                   # Phase 1 — types reused + types extended + new options interface
├── contracts/
│   ├── per-reviewer-week-prs.md    # Phase 1 — producer contract for the new aggregator emission
│   └── reviewer-pr-list.md         # Phase 1 — consumer contract for the reviewer PR list section
├── quickstart.md                   # Phase 1 — verify-the-feature walkthrough
├── checklists/
│   └── requirements.md             # Spec quality checklist
└── tasks.md                        # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

Feature is producer + consumer. Touched files:

```text
src/ado_git_repo_insights/transform/
├── aggregators.py                  # EXTEND: _generate_reviewer_slice emits prs[] + _prs_truncated + _prs_cap;
│                                   # add _PR_DETAIL_CAP_PER_REVIEWER_WEEK = _PR_DETAIL_CAP alias near :84
└── types.py                        # EXTEND: ReviewerSliceMetrics TypedDict gains prs / _prs_truncated / _prs_cap

scripts/
├── strip_pr_arrays.py              # EXTEND: _strip_one (currently at :85-96) and _verify_clean (:99-102)
│                                   # walk into payload["by_reviewer"][*] and pop the same PR_LEVEL_FIELDS
└── generate-demo-data.py           # EXTEND: reviewer aggregation parallel-path emits the new sub-array

extension/ui/schemas/
└── rollup.schema.ts                # EXTEND: ReviewerBreakdownEntry (currently :58-64) gains prs?: readonly PrRecord[]
                                    # + _prs_truncated?: boolean + _prs_cap?: number; PrRecord interface UNCHANGED;
                                    # validateReviewerBreakdownEntry path extended with permissive warnings for the
                                    # new fields; PrRecord schema-parity gate UNTOUCHED

extension/ui/modules/drilldown/
└── reviewer-drilldown.ts           # EXTEND: install signature gains options bag; buildPanelContent appends
                                    # PrListSection AFTER buildWeeklyTable; new buildPrListSection helper
                                    # invoking classifyFilterState({...filters, reviewers: []}, false);
                                    # reviewer-stripping wrapper co-located here for reviewability

extension/ui/dashboard.ts           # EXTEND: existing installReviewerDrilldown(...) call site at the same
                                    # construction point as installCycleTimeDrilldown gains the same options bag
                                    # already built for throughput + cycle-time installs

extension/tests/modules/drilldown/
├── pr-list-comments-spread-guard.test.ts  # EXTEND: ALLOWED_MODULES (:32-47) gains "reviewer-drilldown.ts"
│                                          # with a comment block matching the existing 361 entry pattern
├── reviewer-drilldown.test.ts             # EXTEND: PR list rendering scenarios; team-overlay → team-inline;
│                                          # author/repo overlay → PR list with intersection; comparison toast;
│                                          # truncation cue; supported-empty triggers; capability on/off shape;
│                                          # accessible-name stability across 3 content states (FR-012);
│                                          # keyboard activation + Tab reachability (FR-013)
├── reviewer-pr-list-order.test.ts          # NEW: FR-019 — assert rendered DOM order is cycle_time desc, id asc
│                                           # AFTER cross-week concatenation of per-(reviewer, week) prs slices
├── reviewer-pr-list-count-parity.test.ts   # NEW: rendered count vs sum of per-(reviewer, week) reviewed_prs
│                                           # under supported state (mirrors throughput's pr-list-count-parity)
└── reviewer-pr-list-capability-off-baseline.test.ts  # NEW: golden capability-off DOM byte-identity
                                                       # with a committed baseline at fixtures/

extension/tests/fixtures/
└── reviewer-drilldown-capability-off-baseline.html   # NEW: golden DOM baseline for capability-off rendering

tests/unit/
├── test_aggregators_reviewer_pr_detail.py            # NEW: producer-side tests for the new emission +
│                                                     # cap-boundary regression at 500/501 (FR-029) +
│                                                     # sort-before-truncate invariant + duplication invariant +
│                                                     # reviewed_prs == prs.length coherence
├── test_strip_pr_arrays_reviewer_nested.py           # NEW: FR-028 strip-helper coverage assertion
└── test_demo_generator_reviewer_pr_detail.py         # NEW: demo generator parallel-path coherence

.test-floor-contract.json           # BUMP: extension.min_collected += new Jest test count
                                    # AND python.min_collected += new pytest test count (same commit)
```

**Files NOT touched** (per FR-017 / FR-018 / FR-024 / FR-025):

- `extension/ui/schemas/rollup.schema.ts` PrRecord interface (`:90-99`) — UNCHANGED
- `extension/ui/schemas/rollup.schema.ts` `validatePrRecordArray` (`:571+`) — UNCHANGED
- `src/ado_git_repo_insights/types.py` PrRecord TypedDict (`:289+`) — UNCHANGED
- `extension/ui/schemas/rollup.schema.ts` `PR_RECORD_REQUIRED_FIELDS` array — UNCHANGED
- `specs/310-comments-visualization/contracts/pr-record-comments-fields.md` §1 table — UNCHANGED
- `scripts/check_pr_record_schema_parity.py` — UNCHANGED (no PrRecord field added; gate's array-acceptance posture stays out of scope per CL-01 guardrail #2)
- `extension/ui/modules/charts/reviewer-activity.ts` — UNCHANGED (chart already emits `data-drilldown-reviewer-id` + `tabindex=0` + `role=button` + `aria-expanded` + accessible name on each row when `filterReviewerId !== null`, verified at `:206-208`)
- `extension/ui/modules/shared/detail-panel.ts` — UNCHANGED (reuses existing `PrListSection` union + `makePrListSection` factory + `isPartialPrRow` discriminator)
- `extension/ui/modules/shared/pr-url.ts` — UNCHANGED (reused for URL composition)
- `extension/ui/modules/drilldown/filter-support.ts` — UNCHANGED (the reviewer-stripping wrapper invokes the existing `classifyFilterState` with a stripped-filter copy; no helper change)
- `extension/ui/modules/drilldown/comparison-advisory.ts` — UNCHANGED (already wired into reviewer-drilldown.ts at `:232-235`)
- `extension/ui/modules/drilldown/throughput-drilldown.ts` — UNCHANGED (FR-018 regression-locked)
- `extension/ui/modules/drilldown/cycle-time-drilldown.ts` — UNCHANGED (FR-018 regression-locked)
- `docs/reference/dataset-contract.md` privacy-posture anchor (`:100`) and Covered Fields list (`:105-110`) — UNCHANGED at the structural level (FR-022); an optional audit-trail line MAY be added below the existing list documenting nested-coverage semantics, but no anchor change and no test change.
- `tests/unit/test_privacy_posture_ordering.py` — UNCHANGED (FR-022 + SC-012 — gate stays green by no-op)
- `PARITY_CONSTRAINTS.md` — UNCHANGED (FR-024 + SC-013 — 4-entry-point parity preserved by no-op)
- `DatasetLoader` / `AuthenticatedDatasetLoader` — UNCHANGED (no new `IDatasetLoader` optional-method introduced)
- Any `.github/workflows/*` — no CI gate changes
- `.specify/memory/constitution.md`, `agents/INVARIANTS.md`, `LOCAL_CI_PARITY_INVARIANTS.md` — no governance changes

**Structure Decision**: producer + consumer + demo-generator + strip-helper change, all additive. No directory restructuring. The new test files mirror the existing throughput / cycle-time naming convention (`reviewer-pr-list-*.test.ts`) so a future maintainer searching for "reviewer PR list tests" sees the family side by side with throughput and cycle-time.

## Test-floor Δ protocol (mechanized per QG-43 / FR-020 / FR-021)

Every commit that adds N tests MUST bump the corresponding `.test-floor-contract.json` floor by exactly N in the same commit. Drift is detected per-commit by `scripts/check_ratchet_bump.py` and CI's `ratchet-bump-guard` job. **Both Python AND Extension floors bump under this feature.**

### Per-commit protocol

1. **Author new tests** under `extension/tests/modules/drilldown/` (Jest) AND `tests/unit/` (pytest).
2. **Run both test suites** to produce JUnit output:
    - `cd extension && pnpm test:coverage` — produces `extension/test-results.xml`
    - `python scripts/run_pytest.py` (project's coverage-safe launcher) — produces `pytest-results.xml` (or whatever the project's standard JUnit path is; verified at `scripts/run_pytest.py` during Pass 3)
3. **Calculate Δ mechanically** (not by manual count):
    - `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml --junit-python pytest-results.xml`
    - The command reports `actual=N` for both Extension AND Python dimensions.
4. **Update `.test-floor-contract.json`** by setting `extension.min_collected = N_extension` AND `python.min_collected = N_python`.
5. **Stage all together**: producer code + consumer code + new tests + demo-generator + strip-helper + spread-guard ALLOWED_MODULES + `.test-floor-contract.json` floor bump in ONE commit.
6. **Verify before push**: `python scripts/check_ratchet_bump.py --base-ref origin/main ...` returns exit 0 on both dimensions.

### Anti-patterns (will fail CI)

- Test additions split across two commits where the first commit doesn't bump the floor (per-commit gate flags it as drift on either dimension).
- Floor bumped by fewer or more than the actual delta on either dimension.
- Attempting `[ratchet-realignment]` for the Python floor without explicit user authorization (per FR-021 — the default plan is lockstep tests + no marker; using the marker requires user approval recorded before the commit lands).
- Attempting `[ratchet-realignment]` for the Extension floor at all (no marker waiver is honored for extension drift; documented in `docs/development/ratchets.md`).

### Expected delta for this feature

Approximately **+8 to +12** new pytest tests AND **+10 to +14** new Jest tests. Distribution:

**Python (pytest):**

- `test_aggregators_reviewer_pr_detail.py`: +5 to +7 (basic emission shape, sort-before-truncate at exactly 500, sort-before-truncate at 501 — the FR-029 cap-boundary lock, atomic emission `_prs_cap` always present alongside `prs`, duplication invariant — N reviewers × 1 PR → N entries, `reviewed_prs == prs.length` coherence under non-truncation, missing-cap-marker malformed-rollup graceful-degradation)
- `test_strip_pr_arrays_reviewer_nested.py`: +2 to +3 (top-level strip still works after extension, nested-under-`by_reviewer[*]` strip works, residue-on-incomplete-walk fails-loud per FR-028)
- `test_demo_generator_reviewer_pr_detail.py`: +1 to +2 (demo emits per-(reviewer, week) prs, sort + cap invariants hold on demo seeds)

**Extension (Jest):**

- `reviewer-drilldown.test.ts` extension: +5 to +7 (PR list render, team-overlay → team-inline, author-overlay → PR list, repo-overlay → PR list, comparison toast, capability on / off shape, retarget across reviewer change)
- `reviewer-pr-list-order.test.ts`: +1 (FR-019 rendered DOM order)
- `reviewer-pr-list-count-parity.test.ts`: +1 (rendered count vs sum of per-(reviewer, week) reviewed_prs under supported state)
- `reviewer-pr-list-capability-off-baseline.test.ts`: +1 (FR-026 capability-off DOM byte-identity)
- A11y / keyboard scenarios under `reviewer-drilldown.test.ts`: +1 to +2 (FR-012 stable accessible name, FR-013 Tab reachability)
- 310 spread-guard ALLOWED_MODULES sanity: 0 (the spread-guard test scans the directory; adding `reviewer-drilldown.ts` to the allowlist requires no new test, only an entry in the Set)

Final counts are whatever the ratchet-bump command reports; the estimates above exist for planning only and MUST NOT be hardcoded.

## Phase 0: Research

See [`research.md`](./research.md). Summary:

- **R1** — Throughput + cycle-time drill-down's PR list flow: classification → state mapping → render. Both shipped; both available as references. Confirmed via direct read of `throughput-drilldown.ts:119-184`, `cycle-time-drilldown.ts:107-156`, `detail-panel.ts:144-282`.
- **R2** — Reviewer aggregator's existing emission shape and source data. `_generate_reviewer_slice` at `aggregators.py:2139-2201` already merges `week_reviewers` × `week_group` and groups by `reviewer_id`; the new `prs[]` slice can be derived by collecting `outcome_group["pull_request_uid"]` and joining with the per-PR fields the existing per-week `prs[]` emission already builds (lines 850-872 — sort + truncate logic). Verified.
- **R3** — Strip helper's current scope. Verified at HEAD: `scripts/strip_pr_arrays.py:85-96` `_strip_one` only walks the rollup ROOT — it pops `prs` / `_prs_truncated` / `_prs_cap` only at depth 0. The new per-(reviewer, week) sub-array at `payload["by_reviewer"][*]["prs"]` is at depth 2 and would NOT be stripped. FR-028's "smallest extension" is therefore confirmed required, not optional.
- **R4** — 310 spread-guard's current ALLOWED_MODULES. Verified at HEAD: `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts:32-47` lists exactly two entries (`throughput-drilldown.ts`, `cycle-time-drilldown.ts`); the test fails for any drilldown module that references comments-metrics identifiers OR sets `commentsMetricsAvailable` to a truthy value unless on the allowlist. Adding `reviewer-drilldown.ts` is a single-Set-entry edit.
- **R5** — Reviewer chart click hooks. Verified at HEAD: `reviewer-activity.ts:206-208` emits `data-drilldown-reviewer-id` + `tabindex=0` + `role=button` + `aria-expanded` + accessible label on each row when `filterReviewerId !== null`. No chart change required.
- **R6** — Existing reviewer-drilldown test coverage. Verified at HEAD: `reviewer-drilldown.test.ts` is 859 lines; all current tests must continue passing without modification when the install signature gains a third optional `options` argument (default `{}`) — the existing two-arg invocations at `:170, 189, 234, 247, 260, 293, 319, 332, 391, ...` all continue to work because `options: ReviewerDrilldownOptions = {}` is the default.
- **R7** — Demo generator's reviewer aggregation parallel-path. Verified at HEAD: `scripts/generate-demo-data.py` has its own `_aggregate_reviewer_for_week` helper (or equivalent — exact line numbers to be pinned in Pass-3 test-authoring) that mirrors production's `_generate_reviewer_slice`. Per repo memory `feedback_demo_generator_parallel_path.md`, this requires explicit mirroring of the new `prs[]` field on each per-(reviewer, week) entry.

No `[NEEDS CLARIFICATION]` markers remain in the spec or this plan. Phase 0 declared **COMPLETE**.

## Phase 1: Design & Contracts

See Phase 1 deliverables:

- [`data-model.md`](./data-model.md) — types reused + the extended `ReviewerBreakdownEntry` interface + the new `ReviewerDrilldownOptions` interface; emphasizes that the PrRecord shape is reused unchanged and the schema-parity gate stays untouched.
- [`contracts/per-reviewer-week-prs.md`](./contracts/per-reviewer-week-prs.md) — producer contract for the new aggregator emission: scope (PRs where the reviewer cast a non-zero vote), sort (`cycle_time desc, id asc` BEFORE truncation), cap (`_PR_DETAIL_CAP_PER_REVIEWER_WEEK = 500`), atomicity (`_prs_cap` always present alongside `prs`; `_prs_truncated` semantics — `false` at exactly 500, `true` at 501+), coherence invariants (`reviewed_prs == prs.length` under non-truncation; `prs.length == _prs_cap` under truncation), boundary regression at 500/501.
- [`contracts/reviewer-pr-list.md`](./contracts/reviewer-pr-list.md) — consumer contract for the reviewer PR list section: install signature, section ordering (after weekly-activity table), filter classification under the reviewer-stripping wrapper (3 reachable content states: `pr-list`, `supported-empty`, `team-inline` — NOT `reviewer-inline`), row construction (mirrors throughput byte-for-byte), URL composition, capability gating, accessible-name stability, keyboard reachability, comparison-mode regression lock.
- [`quickstart.md`](./quickstart.md) — verify-the-feature walkthrough mapped to spec acceptance scenarios + SC-001..SC-014.

### Re-evaluation of Constitution Check (post-design)

No new violations introduced during Phase 1 design. All new artifacts align with existing conventions:

- Producer contracts live under `contracts/` (inherited from feature 060 / 310 / 333 / 334 / 335 / 361)
- Consumer contracts live alongside producer contracts in the same directory
- Data model documented in `data-model.md` (standard speckit artifact)
- Quickstart verifies end-user-visible behavior (every spec SC mapped to concrete steps)
- The feature consumes the existing locked PrRecord contract unchanged; the new fields are added to a different (non-parity-locked) interface (`ReviewerBreakdownEntry`)

Post-design gate evaluation: **PASS**.

## Phase 2: Not generated by /speckit.plan

`tasks.md` is produced by `/speckit.tasks` after this plan. Per the user's discipline (memory: "Speckit cadence applies to tasks.md too"), `/speckit.tasks` will undergo a 4-pass hardening before being handed off to `/speckit.analyze` and then paused for the user's review.

## Complexity Tracking

_This section filled only if Constitution Check has violations that must be justified._

No violations. No entries.
