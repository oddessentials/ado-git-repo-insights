# Implementation Plan: Cycle-Time Chart PR-Level Detail

**Branch**: `361-cycle-time-pr-drilldown` | **Date**: 2026-05-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/361-cycle-time-pr-drilldown/spec.md`

## Summary

Wire a `PrListSection` into the existing cycle-time drill-down panel so a manager investigating a slow week sees the actual pull requests that drove the metric, with one-click access to Azure DevOps. Reuses the regression-locked throughput drill-down primitives unchanged: the `PrListSection` discriminated union, `classifyFilterState`, `resolvePrUrl`, the `comparison-advisory` toast, and the producer's per-week `prs` array. No producer, schema, or PR-record contract changes.

Primary deliverables:
1. `installCycleTimeDrilldown` accepts a `CycleTimeDrilldownOptions` bag (parallel to `ThroughputDrilldownOptions`) and threads `filters`, `repositoriesDimension`, `webContext`, `authorsDimension`, `commentsMetricsAvailable` through to a new `buildPrListSection` helper.
2. `cycle-time-drilldown.ts::buildPanelContent` appends the `PrListSection` after the per-repository breakdown for `supported` filter classification; emits the `team-inline` / `reviewer-inline` / `supported-empty` message variants under their respective conditions, byte-identical to throughput's emissions.
3. `dashboard.ts` extends the existing `installCycleTimeDrilldown(...)` call site to pass the same options bag already constructed for `installThroughputDrilldown`.
4. New consumer-side Jest coverage on the cycle-time surface for the 20 functional requirements (notably: rendered-DOM order assertion per FR-019, accessible-section-identity stability per FR-012, keyboard activation + Tab reachability per FR-013).
5. `.test-floor-contract.json` `extension.min_collected` bumped by exactly the new test count in the same commit; Python floor unchanged.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (extension UI). Matches existing baseline. Python 3.12+ baseline applies repo-wide but is not exercised by this feature (no producer-side change).
**Primary Dependencies**: existing only — Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**
**Storage**: N/A. No database, schema, or rollup-shape changes.
**Testing**: Jest with jsdom for the new consumer-side coverage. Producer-side test floors (`python.min_collected`) untouched because no producer code path is modified.
**Target Platform**: Azure DevOps Marketplace extension running inside the ADO web iframe (Chromium-based) AND the published demo at `docs/data/`. Cross-platform CLI (Windows / macOS / Linux) inherited via the existing test pipeline; this feature adds no OS-specific code.
**Project Type**: existing dashboard extension; no new top-level modules.
**Performance Goals**: Panel opens with PR list rendered inside the open-animation (no distinct loading state, no extra round-trip), matching the throughput drill-down's existing UX. Per-week PR array (≤500 records, already capped by the producer) adds no measurable client-side work compared to today's throughput drill-down.
**Constraints**: cross-OS compatibility (QG-39); no `typing.Any` (QG-40); zero new suppressions (QG-41); 4-entry-point parity (QG-47 / QG-49); ratchet bump same commit (QG-43); local/CI parity (QG-35 — QG-38). No bypass markers used.
**Scale/Scope**: ≤500 PR records per week (existing producer cap). Real-seed peak measured under feature 060 was 464 PRs/week; demo peak is 151 PRs/week. Cycle-time consumer adds no scaling pressure beyond what throughput already exercises on the same underlying array.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

All 56 constitutional gates evaluated against this feature's scope. **No violations.**

### Gate disposition

| Gate | Relevance | Disposition |
|---|---|---|
| QG-01 — QG-08 (CSV / SQLite / persistence) | N/A | Feature does not touch CSV surface, SQLite, or pipeline persistence. |
| QG-09 — QG-12 (extraction) | N/A | No extraction changes. |
| QG-13 — QG-14 (identity) | YES (reuse only) | Uses existing `pull_request_id` + `repository_id` for URL composition via existing `resolvePrUrl`. No new keys. |
| QG-15 — QG-16 (runtime / secrets) | N/A | No agent-runtime or secret-handling changes. |
| QG-17 — QG-22 (release gates) | YES | All standard checks (ruff, mypy, pytest, Jest, coverage, build) must pass; no relaxation. |
| QG-23 — QG-24 (documentation) | N/A | No runbook, dataset-contract, or config-reference changes. |
| QG-25 — QG-29 (scalability) | YES (no-op) | Producer cap (`MAX_PRS_PER_WEEK = 500`) inherited from feature 060; cycle-time consumer adds no new caps. Existing scalability tests unchanged. |
| QG-30 — QG-34 (demo parity) | YES | Demo currently includes `prs` arrays (verified at HEAD); cycle-time renders PR list on demo identical to throughput. No demo workflow changes. QG-32 (`docs/data/` clean promoted mirror) and QG-34 (startup-state parity) untouched. |
| QG-35 — QG-38 (local/CI parity) | YES | All new tests run via the existing `pnpm test` / `test:ci` chain; same gates fire on pre-commit, pre-push, and CI. `--no-verify` forbidden (QG-38). |
| QG-39 (cross-OS) | YES (no-op) | TypeScript-only consumer change; no `path.sep`, shell, or filesystem assumptions added. |
| QG-40 (no `typing.Any`) | YES | New `CycleTimeDrilldownOptions` interface uses precise types. PR list type narrowing uses the existing `PrListSection` discriminated union. No `// @ts-ignore` or `Any` introduced. |
| QG-41 (zero suppressions) | YES | `.suppression-baseline.json` stays at 0 across all scopes (`typescript-extension`, `typescript-tests`). No `eslint-disable` / `ts-expect-error` introduced. |
| QG-42 (enterprise test coverage) | YES | New consumer-side Jest coverage for FR-001 through FR-015 plus FR-019 (rendered-order) and FR-012 / FR-013 cycle-time-specific a11y / keyboard tests. Every new code path tested. |
| QG-43 — QG-46 (test discipline) | YES | `.test-floor-contract.json` `extension.min_collected` bumped by exactly the new test count in the same commit; no marker waiver attempted (none available for extension). No `pytest.mark.skip` introduced; no platform-conditional collection changes. Cross-OS Python collection parity untouched (Python floor unchanged). |
| QG-47 — QG-49 (entry-point alignment) | YES | New tests live under `extension/tests/modules/drilldown/`, already a triggered scope for pre-commit `tsc` + ESLint + Jest. No new gates introduced. The shared primitives reused (`makePrListSection`, `classifyFilterState`, `resolvePrUrl`, `isPartialPrRow`) each have exactly one authoritative definition consumed identically by throughput, comments-trend, and now cycle-time. |
| QG-50 — QG-52 (change acknowledgement) | YES (N/A in practice) | No version bump, no threshold change, no ratchet realignment. Coverage stays within 2% of baseline (additive consumer code with full coverage). |
| QG-53 — QG-55 (build architecture) | YES | No tsconfig changes. New TypeScript code follows the existing split-tsconfig conventions (ES2022 type-check, esbuild owns `dist/ui/`). Prettier invoked only via `format:check` (unchanged invocation). |
| QG-56 (security scan) | YES | Gitleaks parity unchanged; new code is pure UI wiring + tests, no secrets surface. |

**Gate evaluation: PASS.** No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/361-cycle-time-pr-drilldown/
├── spec.md                         # Hardened spec (iteration 2 incorporates 5-point review)
├── plan.md                         # This file
├── research.md                     # Phase 0 — verification log
├── data-model.md                   # Phase 1 — types reused + new options interface
├── contracts/
│   └── cycle-time-pr-list.md       # Phase 1 — consumer contract for the cycle-time PR list section
├── quickstart.md                   # Phase 1 — verify-the-feature walkthrough
├── checklists/
│   └── requirements.md             # Spec quality checklist (iteration 2 validation)
└── tasks.md                        # Phase 2 output (/speckit.tasks — NOT generated here)
```

### Source Code (repository root)

Feature is additive, consumer-only, and TypeScript-only.

```text
extension/ui/modules/drilldown/
└── cycle-time-drilldown.ts             # EXTEND: install signature gains options bag; buildPanelContent appends PrListSection;
                                        # adds buildPrListSection helper that mirrors throughput's classification + state mapping

extension/ui/dashboard.ts                # EXTEND: existing installCycleTimeDrilldown(...) call gains the same options bag
                                        # already constructed and passed to installThroughputDrilldown

extension/tests/modules/drilldown/
├── cycle-time-drilldown.test.ts         # EXTEND: PR list rendering scenarios, filter classifications,
                                        # truncation cue, supported-empty triggers, capability on/off, retarget,
                                        # accessible-name stability across 4 content states (FR-012),
                                        # keyboard activation + Tab reachability (FR-013), comparison toast (FR-009)
├── cycle-time-pr-list-count-parity.test.ts          # NEW: rendered count vs filtered pr_count under supported state
                                                     # (mirror of pr-list-count-parity.test.ts pattern)
├── cycle-time-pr-list-order.test.ts                 # NEW: FR-019 — assert rendered DOM order is cycle_time desc, id asc
└── cycle-time-pr-list-capability-off-baseline.test.ts  # NEW: golden capability-off DOM byte-identity
                                                         # (mirror of pr-list-capability-off-baseline.test.ts pattern)

.test-floor-contract.json                 # BUMP: extension.min_collected += exact new test count (same commit)
```

**Files NOT touched** (per FR-016 / FR-017 / FR-018):

- `src/ado_git_repo_insights/transform/aggregators.py` — no producer change
- `src/ado_git_repo_insights/types.py` — no PrRecord change
- `extension/ui/schemas/rollup.schema.ts` — no schema change
- `extension/ui/dataset-loader.ts` — no Rollup interface change
- `extension/ui/modules/charts/cycle-time.ts` — chart already emits the click hooks (`data-drilldown-week` + `data-drilldown-metric` on each P50/P90 dot)
- `extension/ui/modules/shared/detail-panel.ts` — no detail-panel API change; reuses existing `PrListSection` union
- `extension/ui/modules/shared/pr-url.ts` — reused unchanged
- `extension/ui/modules/drilldown/filter-support.ts` — reused unchanged
- `extension/ui/modules/drilldown/comparison-advisory.ts` — reused unchanged (already wired into cycle-time module)
- `extension/ui/modules/drilldown/throughput-drilldown.ts` — no behavior change (FR-018 regression-locked)
- `scripts/strip_pr_arrays.py` — no demo strip change
- `scripts/build-demo-dataset.py` — no demo workflow change
- Any `.github/workflows/*` — no CI gate changes
- `.specify/memory/constitution.md`, `agents/INVARIANTS.md`, `LOCAL_CI_PARITY_INVARIANTS.md` — no governance changes

**Structure Decision**: additive consumer-only changes. No directory restructuring. The new test files mirror the existing `pr-list-*.test.ts` naming convention (`cycle-time-pr-list-*.test.ts`) so a future maintainer searching for "PR list tests" sees both surfaces side by side. No new shared modules are introduced — every primitive needed already exists under `extension/ui/modules/shared/` or `extension/ui/modules/drilldown/`.

## Test-floor Δ protocol (mechanized per QG-43 / FR-020)

Every commit that adds N tests MUST bump the `.test-floor-contract.json` `extension.min_collected` floor by exactly N in the same commit. Drift is detected per-commit by `scripts/check_ratchet_bump.py` and CI's `ratchet-bump-guard` job. To prevent drift:

### Per-commit protocol

1. **Author new tests** under `extension/tests/modules/drilldown/`.
2. **Run the extension test suite** to produce JUnit output:
   - `cd extension && pnpm test:coverage` — produces `extension/test-results.xml`
3. **Calculate Δ mechanically** (not by manual count):
   - `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`
   - The output line `actual=N` for the Extension dimension is the authoritative count.
4. **Update `.test-floor-contract.json`** by setting `extension.min_collected` to `N`.
5. **Stage all together**: new test files + extended `cycle-time-drilldown.ts` + extended `dashboard.ts` + `.test-floor-contract.json` in ONE commit.
6. **Verify before push**: `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` returns exit 0.

### Anti-patterns (will fail CI)

- Test additions split across two commits where the first commit doesn't bump the floor (per-commit gate flags it as drift).
- Floor bumped by fewer or more than the actual delta.
- Attempting `[ratchet-realignment]` for the extension floor (no marker waiver is honored for extension drift; documented in `docs/development/ratchets.md`).

### Expected delta for this feature

Approximately **+8 to +12** new Jest tests, distributed:

- `cycle-time-drilldown.test.ts` extension: +5 to +7 (PR list render, team-inline, reviewer-inline, supported-empty, comparison toast, retarget P50→P90, capability on/off shape)
- `cycle-time-pr-list-order.test.ts`: +1 (FR-019 rendered-DOM order assertion)
- `cycle-time-pr-list-count-parity.test.ts`: +1 (FR-008 / SC-003 rendered count vs filtered pr_count)
- `cycle-time-pr-list-capability-off-baseline.test.ts`: +1 (FR-015 capability-off byte-identity)
- A11y / keyboard scenarios under `cycle-time-drilldown.test.ts`: +1 to +2 (FR-012 stable accessible name, FR-013 Tab reachability)

Final count is whatever the ratchet-bump command reports; the estimates above exist for planning only and MUST NOT be hardcoded.

## Phase 0: Research

See [`research.md`](./research.md). Summary:

The 5-point review cycle on the spec already verified every research unknown the planner would otherwise have to resolve:

- **R1** — Throughput drill-down's PR list flow: classification → state mapping → render. Confirmed via direct read of `throughput-drilldown.ts:119-184` and `detail-panel.ts:92-282`.
- **R2** — Producer order vs consumer order: throughput's consumer is `rawPrs.map(...)` (preserves order, no re-sort). The cycle-time consumer can do the same; FR-019 makes the rendered output the contract.
- **R3** — Demo per-PR field state: every weekly rollup under `docs/data/aggregates/weekly_rollups/*.json` carries `prs`, `_prs_truncated`, `_prs_cap` at HEAD. Demo will render the PR list, not the empty state.
- **R4** — Cycle-time chart click hooks: each P50/P90 dot emits `data-drilldown-week` + `data-drilldown-metric` + `role="button"` + `tabindex="0"` + `aria-expanded` (verified at `cycle-time.ts:310-311`). No chart change needed.
- **R5** — Existing test coverage gap: throughput's keyboard / button-role / tabindex tests cover throughput's bars, not cycle-time's dots. Cycle-time-specific consumer tests are mandatory for FR-012 / FR-013.

No `[NEEDS CLARIFICATION]` markers remain in the spec or this plan. Phase 0 declared **COMPLETE**.

## Phase 1: Design & Contracts

See Phase 1 deliverables:

- [`data-model.md`](./data-model.md) — types reused + the new `CycleTimeDrilldownOptions` interface; emphasizes that no new `PrRecord`-shaped types are introduced.
- [`contracts/cycle-time-pr-list.md`](./contracts/cycle-time-pr-list.md) — consumer contract for the cycle-time PR list section: section ordering, four content states, sort assertion, URL composition, capability gating.
- [`quickstart.md`](./quickstart.md) — verify-the-feature walkthrough, mapped to spec acceptance scenarios and SC-001..SC-011.

### Re-evaluation of Constitution Check (post-design)

No new violations introduced during Phase 1 design. All new artifacts align with existing conventions:

- Contracts live under `contracts/` (inherited from feature 059 / 060)
- Data model documented in `data-model.md` (standard speckit artifact)
- Quickstart verifies end-user-visible behavior (every spec SC mapped to concrete steps)
- The feature consumes only previously-locked contracts; no new cross-surface schema obligations created

Post-design gate evaluation: **PASS**.

## Phase 2: Not generated by /speckit.plan

`tasks.md` is produced by `/speckit.tasks` after this plan. Per the user's discipline (memory: "Speckit cadence applies to tasks.md too"), `/speckit.tasks` will itself undergo a 4-pass hardening before being handed off to `/speckit.analyze` and then to implementation.

## Complexity Tracking

*This section filled only if Constitution Check has violations that must be justified.*

No violations. No entries.
