# Implementation Plan: Dashboard weekly discussion-volume trend chart + SC-05 cross-feature reconciliation

**Branch**: `feat/333-comments-trend-chart` | **Date**: 2026-04-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/333-comments-trend-chart/spec.md` (8 rounds of contract hardening, locked under extracted-subset semantics)
**Issue**: #333 (split from #322 — Capability 1 of #182, foundation PR for the #322 dashboard block)

## Summary

Adds a weekly comments-trend chart to the dashboard's Metrics tab (single chart, stacked bars + overlaid line, no toggles). Backed by a new `rollup[W].comments` aggregate object that the existing aggregator emits when `capabilities.comments_metrics` is enabled. Closes feature 310's deferred SC-05 cross-feature reconciliation obligation via FR-2-04's two-assertion reconciliation test (cross-surface coherence on the extracted-subset intersection + end-to-end aggregator correctness via independent re-computation), backed by FR-2-05's failure-mode meta-test. Single PR; no decomposition.

**Foundation surface inherited by sibling Cap-2 PRs (#334, #335, #336)**: the rollup-schema extension (`comments` sub-object) and the SC-05 reconciliation pattern.

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline per `CLAUDE.md`.

**Primary Dependencies**: existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**

**Storage**: SQLite via existing `DatabaseManager`. **No schema changes; no migrations.** Reads `pr_threads`, `pr_comments`, `pull_requests.comments_extracted_at` — all present since Feature 058. INV-1-05 (extractor frozen, inherits 310 INV-06) preserved.

**Testing**: pytest (Python integration + unit), Jest 30.x (extension). `.test-floor-contract.json` bumped in the same commit as added tests per QG-43. `--max-skips=0` enforced (QG-46). Tests collection-stable per QG-44 / Principle XXVI.

**Target Platform**: Cross-OS (Windows + Linux + macOS) per QG-39. Extension targets Azure DevOps via VSS SDK; dashboard renders in Chromium / Edge browser surface.

**Project Type**: web-service + extension-app (backend Python aggregator + TypeScript extension UI).

**Performance Goals**: New chart MUST render within QG-28's existing 1000ms / 156-week budget. Comments aggregate query MUST add ≤ 100ms to per-rollup-emission latency on the demo dataset (validated by integration-test wall time).

**Constraints**:
- CSV contract frozen (INV-1-04 / 310 INV-05 / Constitution Principle I-IV). No producer-side CSV changes.
- Extractor frozen (INV-1-05 / 310 INV-06). Reads `pr_threads` / `pr_comments` only.
- 310's per-PR PrRecord shape (declared at `extension/ui/schemas/rollup.schema.ts:96–98`) must NOT be shadowed (round-6 sub-object decision).
- Schema-parity gate (Row 38 / QG-49) intentionally NOT extended for the rollup-level fields; SC-05 reconciliation test (FR-2-04) is the sole authority for weekly-comments-aggregate parity.
- `--no-verify` forbidden (QG-38).
- Zero inline suppressions (QG-41) — `# noqa` / `# type: ignore` / `// eslint-disable` are forbidden in new code; refactor patterns from `reference_s608_refactor_pattern.md` apply.
- No `typing.Any` (QG-40).

**Scale/Scope**: Demo dataset has ≥ 8 weeks of comment-bearing data (per A-03). Chart's display cap inherits throughput's `MAX_THROUGHPUT_POINTS = 104`. Aggregator emits one `comments` object per week for capability-on datasets; total payload increase per rollup file: ~80 bytes (4 numeric fields + 1 boolean + JSON overhead).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The following gates are touched by this feature:

| Gate | Applies | How this PR honors it |
|---|---|---|
| **QG-01..04 CSV Contract** | indirect | INV-1-04 / 310 INV-05 frozen — no CSV changes. PASSED by non-touch. |
| **QG-05 Golden output determinism** | yes | Demo data refresh produces deterministic rollup JSON; `tests/integration/test_golden_outputs.py` gates this. |
| **QG-19 Unit + integration tests** | yes | New tests in `tests/integration/` (reconciliation + meta) and `tests/unit/test_aggregators.py` (FR-2-06 cases i–iv). |
| **QG-20 Coverage threshold** | yes | New code paths must satisfy QG-52's ≤ 2% coverage delta. |
| **QG-28 Chart render < 1000ms (156 weeks)** | yes | New chart inherits throughput's bar+overlay pattern; cap at 104 weeks. Validated by `extension/tests/unit/chart-scalability.test.ts` extension. |
| **QG-29 Chart data caps enforced** | yes | New chart module declares its own `MAX_*_POINTS` constant (mirrors throughput). |
| **QG-30..34 Demo parity** | yes | Capability-on demo manifest carries the `comments` object; capability-off variant omits the entire object (FR-3-03). `tests/demo/test_demo_parity_pipeline.py` extended. |
| **QG-35..38 Local/CI parity** | yes | All new tests run in pre-push preflight + CI; no local-degraded paths; `--no-verify` forbidden. |
| **QG-39 Cross-OS** | yes | Pure Python + TypeScript; no shell-out to OS-specific tools. |
| **QG-40 No `typing.Any`** | yes | New aggregator code uses precise types (`dict[str, int \| bool]`, etc.). |
| **QG-41 Zero inline suppressions** | yes | Suppression baseline stays at zero; `audit-suppressions.py` gate enforced. |
| **QG-42 Enterprise test coverage** | yes | Five FR-2-06 test cases + reconciliation test + meta-test all required by spec. |
| **QG-43 Per-commit ratchet bump** | yes | Each commit that adds tests bumps `.test-floor-contract.json` by exactly N. |
| **QG-44 Single source of truth for floors** | yes | No hardcoded floors; all floors via `--min-collected-artifact`. |
| **QG-45 Cross-OS Python collection parity** | yes | New tests are collection-stable across OS lanes (no platform gates at module scope). |
| **QG-46 Platform-conditional file naming** | yes | No platform-conditional tests added (none of this code is OS-specific). |
| **QG-47 Pre-commit trigger scope** | yes | New triggers added to `scripts/run_repo_hook.py` for the new test files + new schema fields if needed. |
| **QG-49 Single command, many callers** | yes | The SC-05 reconciliation test is one canonical command invoked by name from pre-push preflight + CI. The import-level isolation check (FR-2-04 b) is the same pattern. |
| **QG-50..52 Change acknowledgement** | maybe | If `.test-floor-contract.json` requires a delta beyond N for the commit's added tests, `[ratchet-realignment]` marker needed. Likely not — net delta should equal N. |
| **QG-56 Security scan (gitleaks)** | yes | Runs on every commit; new code adds no secrets. |

**No Constitution gate violations identified.** No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/333-comments-trend-chart/
├── plan.md                                 # This file
├── spec.md                                 # Feature specification (8 rounds locked)
├── research.md                             # Phase 0 output (decisions + rationale)
├── data-model.md                           # Phase 1 output (entity definitions)
├── quickstart.md                           # Phase 1 output (verification steps)
├── contracts/
│   ├── weekly-comments-aggregate.md       # Field shape contract for rollup[W].comments
│   └── sc05-reconciliation-test.md        # FR-2-04 + FR-2-05 test contracts
├── checklists/
│   └── requirements.md                     # Spec quality checklist (with deviation notes)
└── tasks.md                                # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (Python aggregator)
src/ado_git_repo_insights/transform/
└── aggregators.py                          # Extend _generate_weekly_rollups() to emit
                                            # `comments` sub-object when _has_comments() is true.
                                            # New emission: dict gated by FR-2-06 + INV-1-08 atomicity.

# Extension (TypeScript UI)
extension/ui/
├── index.html                              # NOT MODIFIED by this feature (per FR-3-01 + SC-1-04 byte-identity).
                                            # No new <div>, no <template>, no comment-anchor marker. The
                                            # pre-feature index.html stays byte-identical so the served DOM
                                            # under capability-off has zero new nodes from this feature.
                                            # `<template>` was considered (round 10) and rejected (round 11):
                                            # the <template> element itself is in the DOM tree even though
                                            # its content doesn't render. T020 locks the pure-createElement
                                            # pattern.
├── dashboard.ts                            # Two helpers + capability gate. ensureCommentsTrendContainer()
                                            # checks for existing #comments-trend (REUSE if present, else
                                            # build fresh via createElement chain) — IDEMPOTENT across
                                            # re-renders (round-12 fix). removeCommentsTrendContainer()
                                            # finds [data-comments-trend-row="true"] and removes it (no-op
                                            # if absent). Render path: capability-on → ensure + render;
                                            # capability-off → remove (no-op if never inserted; cleanup if
                                            # transitioning on→off per FR-3-02). At any moment when capability
                                            # is off, Metrics tab DOM is byte-identical to pre-feature.
├── styles.css                              # Stacked-bar + overlay line + partial-coverage qualifier styles
├── schemas/
│   └── rollup.schema.ts                    # Extend Rollup interface with optional `comments` sub-object;
                                            # add KNOWN_ROOT_FIELDS entry for `comments`;
                                            # validator enforces INV-1-08 atomicity (all 4 fields when present).
                                            # PrRecord-level fields (lines 96-98) UNCHANGED.
└── modules/charts/
    ├── comments-trend.ts                   # NEW chart module (~200 lines, modeled on throughput.ts).
                                            # Reads `rollup[W].comments`; renders stacked bars + line + qualifier.
                                            # Wires drill-down via existing throughput-drilldown handoff pattern.
    └── index.ts                            # Barrel export updated to include comments-trend

# Tests
tests/
├── integration/
│   ├── test_comments_trend_reconciliation.py  # NEW — FR-2-04 (a) + (b) reconciliation test.
                                                # Independent re-computation in pure-stdlib SQL against
                                                # `pull_requests` directly. NO imports from
                                                # src/ado_git_repo_insights/transform/aggregators.py
                                                # (which houses BOTH the comments aggregator AND the
                                                # throughput aggregator — round-9 isolation extends to both).
                                                # FR-2-01 (a) explicitly asserts unextracted PRs in the
                                                # drill-down render with 310's per-PR partial sentinel
                                                # (null/undefined, NOT zero, NOT silently absent).
│   ├── test_comments_trend_reconciliation_isolation.py  # NEW — round-9 import-block test;
                                                # AST-based assertion that the reconciliation test's
                                                # transitive imports do NOT include either aggregator.
│   ├── test_comments_trend_meta_failure.py    # NEW — FR-2-05 failure-mode meta-test
│   └── test_demo_variants_byte_identity.py    # EXTEND — gate the new `comments` key under capability-off
                                                # for ALL FOUR omission failure modes (absent, null, {}, partial).
                                                # Exact file may be tests/demo/test_demo_parity_pipeline.py
                                                # instead — pinned at task time.
└── unit/
    └── test_aggregators.py                    # EXTEND — FR-2-06 cases (i)/(ii)/(iii)/(iv).
                                                # Case (ii) "mixed week" explicitly verifies numeric
                                                # totals == sum over EXTRACTED-SUBSET ONLY when both
                                                # extracted and unextracted PRs exist in the same week,
                                                # with coverage_partial=true.
extension/tests/
├── modules/charts/
│   └── comments-trend.test.ts                 # NEW — chart unit tests:
                                                # - FR-1-01..06 chart structure / behavior
                                                # - FR-2-06 case (v) mixed partial+non-partial UI rendering
                                                # - FR-2-06 case (vi) all-unextracted-week UI rendering
                                                #   (zero-height bars MUST be present in DOM with
                                                #   partial qualifier — no silent omission)
└── schema/
    └── rollup.test.ts                         # EXTEND — schema validates `comments` sub-object atomicity

# Test floor + demo artifacts
.test-floor-contract.json                      # BUMP by N in the same commit as added tests (QG-43)
docs/data/                                     # REGENERATE via manage_generated_artifacts.py sync --scope all --stage
└── (manifest + rollup JSONs carrying the new `comments` object)

# Hook triggers
scripts/run_repo_hook.py                       # EXTEND triggers if a new staged-file pattern is needed
                                                # for the SC-05 reconciliation test (likely none — existing
                                                # test/source triggers cover the new files).
```

**Structure Decision**: this feature follows the existing repo split — Python aggregator under `src/ado_git_repo_insights/transform/`, extension UI under `extension/ui/`, integration tests under `tests/integration/`, demo artifacts under `docs/data/`. No new top-level directories. The chart module follows the established `extension/ui/modules/charts/<name>.ts` pattern (modeled directly on `throughput.ts`).

## Complexity Tracking

> Empty — no Constitution Check violations identified.
