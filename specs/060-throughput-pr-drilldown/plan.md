# Implementation Plan: Throughput chart PR-level drill-down

**Branch**: `060-throughput-pr-drilldown` | **Date**: 2026-04-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/060-throughput-pr-drilldown/spec.md`

## Summary

Extend the existing throughput drill-down panel (shipped in Phase 1 / #205) with inline per-PR detail. Spec is hardened through four passes plus a Codex-caught follow-up; 28 functional requirements locked; every requirement anchored to an existing or new code surface in `code-surface-map.md`. No behavioral choices remain for the planner. This plan maps the locked contract onto the existing architecture, records the phase-by-phase deliverables, and validates constitutional gate compliance.

Primary deliverables:
1. Aggregator emits an inline per-week `prs` array (top-500 by `cycle_time desc`, id-asc tiebreak) with two new marker fields (`_prs_truncated`, `_prs_cap`).
2. Extension renders the array inside a new single-variant `PrListSection` in the existing detail panel, with a content-state discriminant covering the four states locked by FR-020.
3. A single authoritative filter-support predicate classifies filter state under fixed precedence (FR-024 / FR-026).
4. A single authoritative strip-gate helper is invoked INSIDE `promote_data` (the single production write boundary to `docs/data/`) as its first step when the destination is `DOCS_DATA_DIR` (FR-023), failing the write if any PR-level residue remains. Standalone-bypass in `generate-demo-data.py` is closed separately via `DEFAULT_OUTPUT_DIR` change + early-exit guard; a static invariant test forbids any direct write to `docs/data/` outside `promote_data`.
5. Dataset-contract doc gains a first privacy-posture section (FR-014) that must land in or before the commit that first produces a `prs` field.

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing invariants.
**Primary Dependencies**: existing. Backend: `argparse`, `sqlite3`, `pandas`, `pytest`. Extension: `@types/node`, Jest 30.x, jsdom 28.x, VSS SDK (`azure-devops-extension-sdk`). No new third-party runtime dependencies.
**Storage**: SQLite via existing `DatabaseManager`. No schema changes; no migrations. All PR fields already present on `pull_requests` table (models.py:72-90).
**Testing**: pytest (Python) + Jest with jsdom (TypeScript). New tests described in `contracts/` and spec SC-002 through SC-015.
**Target Platform**: Azure DevOps extension (Chromium-based inside iframe), and cross-platform CLI (Windows / macOS / Linux) for the aggregator + demo publish scripts.
**Project Type**: existing dashboard extension + CLI aggregator; no new top-level modules.
**Performance Goals**: SC-001 — panel opens with PR list rendered inside the open-animation (no distinct loading state, no additional round-trip) for ≥99% of activations. Matches existing Phase 1 drill-down instant-open behavior.
**Constraints**: 500 KB per-week rollup JSON cap (existing dataset contract); cross-OS compatibility (QG-39); no `typing.Any` (QG-40); zero suppressions (QG-41); 4-entry-point dashboard parity (QG-47 / QG-49); ratchet bump same commit (QG-43); local/CI parity (QG-35 — QG-38).
**Scale/Scope**: 500 PR-record cap per week, validated against M1 measurement (real-seed peak 464 PRs/week) and M2 measurement (~335-400 KB projected max payload under defensive enterprise titles, well under cap).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

All 56 constitutional gates evaluated against this feature's scope. No violations.

### Potentially relevant gates and their disposition

| Gate | Relevance | Disposition |
|---|---|---|
| QG-01 — QG-03 (CSV schema) | N/A | Feature does not touch CSV surface. |
| QG-04, QG-05 (deterministic + golden) | YES | FR-012 / FR-025 / SC-005 / SC-014 align exactly; new golden case extends `tests/integration/test_golden_outputs.py` pattern. |
| QG-06 — QG-08 (persistence) | N/A | No changes to SQLite persistence behavior. |
| QG-09 — QG-12 (extraction) | N/A | No changes to extraction. |
| QG-13 — QG-14 (identity) | YES (reuse only) | Uses existing `pull_request_id` + `repository_id`; no new stable-key work. |
| QG-15 — QG-16 (runtime) | N/A | No secret-handling or agent-runtime changes. |
| QG-17 — QG-22 (release gates) | YES | All standard checks (ruff, mypy, pytest, Jest, coverage, build) must pass; no relaxation. |
| QG-23 — QG-24 (documentation) | YES | FR-014 adds privacy-posture section to `docs/reference/dataset-contract.md`. Operations runbook unchanged. |
| QG-25 — QG-29 (scalability) | YES | New cap (`MAX_PRS_PER_WEEK = 500`) integrates with existing MAX_*_POINTS family. Dashboard render time unchanged — per-week PR array adds ≤~150 KB payload, processed client-side only on drill-down open (not on initial dashboard load). |
| QG-30 — QG-34 (demo parity) | YES | FR-023 strip gate enforces `docs/data/` aggregate-only posture; QG-32 (promoted mirror, no stale files) and QG-34 (startup-state parity) remain green because demo artifacts keep Phase 1 shape. |
| QG-35 — QG-38 (local/CI parity) | YES | FR-023 helper invoked identically from pre-commit, pre-push, `pnpm test:ci`, and CI; `--no-verify` forbidden. |
| QG-39 (cross-OS) | YES | Strip-gate helper uses `pathlib`; no shell assumptions. New aggregator code follows existing pandas/`itertools` patterns. |
| QG-40 (no `typing.Any`) | YES | `PrRecord` TypedDict is fully typed. New TypeScript interfaces use precise union / discriminant types. |
| QG-41 (zero suppressions) | YES | No new `# noqa` / `# type: ignore` / `// eslint-disable` / `// @ts-ignore`. Existing object-injection patterns (Map re-wrap, if/else chains) reused where needed. |
| QG-42 (enterprise test coverage) | YES | 9+ new tests across Python + TypeScript. Every new code path covered. |
| QG-43 — QG-46 (test discipline) | YES | `.test-floor-contract.json` bumped by exactly the number of new tests in the same commit that adds them. No `pytest.mark.skip`; no import-time gating. |
| QG-47 — QG-49 (entry-point alignment) | YES | FR-023 strip gate defined ONCE as an authoritative helper (`strip_pr_arrays_from_rollups`) invoked from the single production write boundary (`promote_data` at `build-demo-dataset.py:1044`) as its first step when destination equals `DOCS_DATA_DIR`. Satisfies QG-49's "each gate defined once and invoked by name" invariant. Standalone-bypass in `generate-demo-data.py` closed by `DEFAULT_OUTPUT_DIR` change + early-exit guard + invariant test forbidding direct writes to `docs/data/` outside `promote_data`. |
| QG-50 — QG-52 (change acknowledgement) | YES (N/A in practice) | No extension/task version bump needed (feature doesn't bump SUPPORTED_*_VERSION). No threshold adjustments. Coverage within 2% of baseline. |
| QG-53 — QG-55 (build architecture) | YES | No tsconfig changes. New TypeScript modules follow split tsconfig conventions (ES2022 for type check; esbuild owns `dist/ui/`). Prettier invoked only via `format:check`. |
| QG-56 (security scan) | YES | Gitleaks parity unchanged; strip-gate output is code + markdown only, no secrets. |

**Gate evaluation: PASS**. No violations; no complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/060-throughput-pr-drilldown/
├── spec.md                    # Hardened spec (4 passes + Codex catch)
├── plan.md                    # This file (Phase 0 + 1 workflow outputs)
├── code-surface-map.md        # Pass 3 FR-to-anchor matrix + Pass 4 resolutions
├── checklists/
│   └── requirements.md        # Quality-check log (Pass 1 → Pass 4 + Codex fix)
├── research.md                # Phase 0 output (this run)
├── data-model.md              # Phase 1 output (this run)
├── contracts/
│   ├── pr-record.md           # Phase 1 output — rollup JSON shape
│   ├── pr-list-section.md     # Phase 1 output — UI section contract
│   ├── filter-support.md      # Phase 1 output — predicate contract
│   └── demo-strip-gate.md     # Phase 1 output — FR-023 gate contract
├── quickstart.md              # Phase 1 output (this run)
├── post-merge-notes.md        # Transient coordination artifact
└── tasks.md                   # Phase 2 output (/speckit.tasks — NOT generated here)
```

### Source Code (repository root)

Feature is additive — no directory restructuring. Edits and new modules slot into the existing layout:

```text
src/ado_git_repo_insights/
├── types.py                           # ADD: `PrRecord` TypedDict alongside existing TypedDicts
└── transform/
    └── aggregators.py                  # EXTEND: `_generate_weekly_rollups` emits `prs` + `_prs_truncated` + `_prs_cap`

extension/ui/
├── dataset-loader.ts                   # EXTEND: `Rollup` interface gains optional `prs`, `_prs_truncated`, `_prs_cap`
├── schemas/
│   └── rollup.schema.ts                # EXTEND: add `PrRecord` interface + validator (permissive)
└── modules/
    ├── metrics.ts                      # EXTEND: `applyFiltersToRollups` filters `prs` in same invocation as `pr_count`
    ├── shared/
    │   ├── detail-panel.ts             # EXTEND: new `PrListSection` variant with `contentState` discriminant
    │   └── pr-url.ts                   # NEW: `resolvePrUrl(pr, repositoriesDimension, webContext)`
    └── drilldown/
        ├── filter-support.ts           # NEW: `classifyFilterState(filters, comparisonActive)` single authoritative predicate
        └── throughput-drilldown.ts     # EXTEND: `buildPanelContent` always emits `PrListSection`; content-state selection via classifier

scripts/
├── strip_pr_arrays.py                  # NEW: single authoritative strip-gate helper for FR-023
├── build-demo-dataset.py               # EXTEND: call strip_pr_arrays_from_rollups INSIDE promote_data as its first step when destination == DOCS_DATA_DIR
└── generate-demo-data.py               # EXTEND: bypass-closure ONLY (no gate). Change DEFAULT_OUTPUT_DIR to a scratch path + add early-exit guard rejecting --output-root == DOCS_DATA_DIR. Do NOT add a duplicate strip gate.

tests/
├── integration/
│   ├── test_golden_outputs.py           # EXTEND: golden case with `prs` array (byte-identical across runs)
│   └── test_pr_record_snapshot_cadence.py  # NEW: FR-022 — title edit → re-aggregate → new rollup
└── unit/
    ├── test_aggregators_pr_records.py     # NEW: shape, sort, truncate, flag behavior
    └── test_strip_pr_arrays.py            # NEW: FR-023 helper positive + negative cases

extension/tests/
├── modules/drilldown/
│   ├── throughput-drilldown.test.ts       # EXTEND: PR list rendering, unsupported-filter inline messages
│   ├── filter-support.test.ts              # NEW: classifier precedence + exhaustiveness
│   └── pr-list-count-parity.test.ts        # NEW: FR-008 / SC-002 (rendered count vs filter)
├── modules/shared/
│   ├── detail-panel.test.ts                 # EXTEND: PrListSection + stable container across 4 states
│   └── pr-url.test.ts                       # NEW: URL composition + fallback behavior
└── parity/
    └── repo-mapping-parity.test.ts          # NEW: FR-005a (dimension mapping availability + cross-entry-point parity)

docs/reference/
└── dataset-contract.md                   # EXTEND: new privacy-posture section (FR-014)

.test-floor-contract.json                # BUMP: exact +N for new tests (same commit)
```

**Structure Decision**: additive changes only. No directory reorganization; no new top-level directories. Every new module lives alongside existing siblings (e.g., `pr-url.ts` next to `render.ts` / `security.ts` in `shared/`, `filter-support.ts` next to `comparison-advisory.ts` in `drilldown/`). The naming and placement choices were validated in Pass 3 (`code-surface-map.md`) and are not re-opened here.

## Complexity Tracking

*This section filled only if Constitution Check has violations that must be justified.*

No violations. No entries.

---

## Phase 0: Research

See [`research.md`](./research.md). Summary:

The M1–M5 in-session investigation pass (recorded in the spec's Source References) resolved every candidate research unknown before Pass 1:

- **M1** — measured real-seed peak PRs/week (464) and demo peak (151) across 5 years; validated truncation cap of 500.
- **M2** — measured actual rollup JSON size (10 KB max on real seed; 335–400 KB projected at defensive enterprise scale + top-500 inline) confirming inline delivery is within the 500 KB per-file cap.
- **M3** — audited every artifact under `docs/data/` + ui_bundle + demo workflows; confirmed no PR-level data is public today and adding the `prs` field would widen exposure → required strip gate (FR-023) + privacy posture (FR-014).
- **M4** — traced `applyFiltersToRollups` filter path; confirmed PR-array field traverses via spread but won't be filtered without extension; required locked field scope to include `author_id` + `repository_id` for client-side predicate reuse.
- **M5** — inventoried schema parity sites (single canonical TS interface, single Python dataclass, permissive validator); confirmed drift risk is manageable with atomic bundle.

No `[NEEDS CLARIFICATION]` markers remain in spec or code-surface-map. Phase 0 declared COMPLETE at spec draft time.

## Phase 1: Design & Contracts

See Phase 1 deliverables:

- [`data-model.md`](./data-model.md) — formal data model for `PrRecord`, extended weekly rollup, classified filter state.
- [`contracts/pr-record.md`](./contracts/pr-record.md) — rollup JSON shape contract.
- [`contracts/pr-list-section.md`](./contracts/pr-list-section.md) — UI section contract (stable container + 4-state discriminant).
- [`contracts/filter-support.md`](./contracts/filter-support.md) — single authoritative predicate contract + precedence.
- [`contracts/demo-strip-gate.md`](./contracts/demo-strip-gate.md) — FR-023 strip-gate helper contract.
- [`quickstart.md`](./quickstart.md) — verify-the-feature walkthrough.

### Re-evaluation of Constitution Check (post-design)

No new violations introduced during Phase 1 design. All new artifacts align with existing conventions:
- Contracts live under `contracts/` (inherited from Phase 1 / #059 conventions)
- Data model documented in `data-model.md` (standard speckit artifact)
- Quickstart verifies end-user-visible behavior (SC-001 through SC-015 mapped to concrete steps)

Post-design gate evaluation: **PASS**.

## Test-floor Δ protocol (mechanized per SC-016)

Every commit that adds N tests MUST bump the `.test-floor-contract.json` floors by exactly N in the same commit. Drift is detected per-commit by `scripts/check_ratchet_bump.py` and CI's `ratchet-bump-guard` job (QG-43). To prevent drift at commit time:

### Per-commit protocol

1. **Author new tests** across Python (`tests/`) and/or Extension (`extension/tests/`).
2. **Run the relevant test suite** to produce `junit` output:
   - Python: `python scripts/run_pytest.py --junit-xml=.tmp/junit-python.xml`
   - Extension: `pnpm --dir extension run test -- --reporters=jest-junit`
3. **Calculate Δ mechanically** (not by manual count):
   - `python scripts/check_ratchet_bump.py --preview --junit-python .tmp/junit-python.xml --junit-extension extension/test-results.xml`
   - The preview mode reports `actual_collected_python`, `actual_collected_extension`, and the required floor bump for each.
4. **Update `.test-floor-contract.json`** by exactly the reported Δ — both keys in the same edit.
5. **Stage all three together**: new tests + `.test-floor-contract.json` + any related implementation code. All in ONE commit.
6. **Verify before push**: `python scripts/check_ratchet_bump.py --base-ref origin/main` returns 0.

### Anti-patterns (will fail CI)

- Commit A adds tests; commit B updates floor. Per-commit gate flags commit A as drift.
- Floor bumped by fewer than N. Drift on the specific commit.
- Floor bumped by more than N. Drift the other direction.
- Using `[ratchet-realignment]` bypass marker to skip the gate. Allowed only with explicit user approval documented in the commit body.

### Expected final Δ for this feature

- **Python new tests**: approximately +4 (aggregator PR records, strip helper, snapshot cadence, privacy-posture ordering gate). Final count determined by junit output at implementation time, not by this estimate.
- **Extension new tests**: approximately +6 (detail-panel PrListSection, throughput-drilldown extension, filter-support, pr-list-count-parity, pr-url, repo-mapping-parity). Final count determined by junit output.

These estimates exist for planning only; the Δ mechanization requires actual test counts at each commit. Commit authors MUST NOT hardcode the estimates into `.test-floor-contract.json` without verification against junit.

## Phase 2: Not generated by /speckit.plan

`tasks.md` is produced by `/speckit.tasks` after this plan. Per the user's 4-pass discipline (MEMORY: "Speckit cadence applies to tasks.md too"), `/speckit.tasks` will itself undergo a 4-pass hardening before being handed off to `/speckit.analyze` and then to implementation.
