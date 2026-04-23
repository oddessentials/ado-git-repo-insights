# Implementation Plan: Comment visualization — Drill-down extension (Capabilities 3 + 4)

**Branch**: `310-comments-visualization` | **Date**: 2026-04-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/310-comments-visualization/spec.md` (Pass 2 complete; Pass 3 complete per 2026-04-21 follow-up — A-01 CONFIRMED, A-02 PARTIAL (310 is the scoping round), A-03 CONFIRMED narrowly, A-04 PARTIAL (310 creates the pattern), A-05 administrative, **A-06 RESOLVED via R-08 — serialization-layer capability-off generation on `generate-demo-data.py`**; parity-gate silent-pass trap RESOLVED via §1 Canonical field declaration in the 310 sibling contract + 3-trigger-path list; **planning-ready — `/speckit.analyze` can proceed**). All five clarifications C1..C5 resolved. Ten invariants INV-01..10 locked. R-08 adds a contract-level test obligation (demo-variant byte-identity; see `data-model.md §5`) — this is NOT a new spec INV-XX entry; it lives at the contract/test layer.

## Summary

Extend the Feature 060 per-week PR drill-down to expose three new per-PR numeric fields — `thread_count`, `comment_count`, `active_thread_count` — gated on `capabilities.comments_metrics`. Producer side: join `pr_threads` and `pr_comments` for the top-500-per-week capped slice, applying the C1 inclusion rules. Consumer side: extend the shared `PrListRow` + renderer with capability-gated columns; wire `DatasetCapabilityState.commentsMetricsAvailable` through `installThroughputDrilldown`. Atomicity across schema surfaces (Python TypedDict + TS interface + required-fields set + 060 contract) enforced by a new single-command parity gate invoked identically from pre-commit, pre-push, and CI. Byte-identical DOM parity on the capability-off path (SC-03) enforced by a jsdom golden. SC-05 cross-feature reconciliation belongs to #322 and is not built or wired here.

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing invariants.
**Primary Dependencies**: existing only — `argparse`, `pathlib`, `json`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock` (Python tests), Jest 30.x + jsdom 28.x (extension tests). No new third-party runtime or dev dependencies.
**Storage**: SQLite via existing `DatabaseManager`. No schema changes; no migrations. Reads `pr_threads`, `pr_comments`, `pull_requests.comments_extracted_at` — all present since Feature 058. INV-06 (extractor frozen) preserved.
**Testing**: pytest (Python, coverage-safe launcher at `scripts/run_pytest.py`); Jest 30.x + jsdom (extension unit); existing `extension/tests/modules/drilldown/pr-list-count-parity.test.ts` pattern extended with a new capability-off baseline snapshot.
**Target Platform**: Cross-OS (Windows, macOS, Linux) per standing invariant; QG-39 cross-platform CI matrix enforced.
**Project Type**: Single project (Python backend + extension UI + shared specs). No new top-level directories.
**Performance Goals**: No net per-week cost increase beyond one bounded `pull_request_uid IN (...)` query per week (capped at 500 entries per the `_PR_DETAIL_CAP` constant). Aggregator runtime budget unchanged.
**Constraints**: Byte-identical DOM on the capability-off path (SC-03, INV-01). Atomic schema expansion across 4 surfaces (DIRECTIVE 1). Top-500 slice only; no join outside the capped set (user-locked constraint). Per-PR `comments_extracted_at` is the sole coverage signal (user-locked; no dataset-level fallback). Deterministic rollup JSON output (Principle III). Field atomicity INV-08 / INV-09 / INV-10 are runtime-asserted test contracts, not prose-only.
**Scale/Scope**: Scoped to three new numeric fields on one existing data path (`aggregators.py` per-week `prs` emit loop) plus one render surface (`extension/ui/modules/drilldown/throughput-drilldown.ts` via the shared `PrListRow`). No new aggregator routes, no new chart types, no new dashboard panels. Two user stories (P1, P2), both on the same contract extension; ship as an indivisible unit (INV-08 atomicity forbids partial release).

## Pass 3 Status (inherited from spec)

spec.md's Status line reads "Pass 2 complete — all clarifications resolved; planning-readiness requires Pass 3 code-validation". This plan honors that line; it is authored in the plan phase but does NOT claim Pass 3 fully complete, and it lists the unresolved verdicts as gates for `/speckit.analyze` and `/speckit.tasks`.

| Assumption | Verdict | Narrow record |
|---|---|---|
| **A-01** (`capabilities.comments_metrics` flag exists) | **CONFIRMED** | Verified Pass 3 by user's initial prompt: end-to-end wired — `schema_versions.py:16`, `aggregators.py:220` and `:1497`, `docs/data/dataset-manifest.json:1337`, `extension/ui/schemas/manifest.schema.ts:99`, `extension/ui/types.ts:385` (`commentsMetricsAvailable`), `extension/ui/dataset-loader.ts:590-591` (with `?? features.comments` fallback), and consumed at `extension/ui/dashboard.ts:2334`. |
| **A-02** (Feature 060 `PrRecord` contract is the extension point) | **PARTIAL** | `PrRecord` locked to 5 fields at `src/ado_git_repo_insights/types.py:289-301` and `extension/ui/schemas/rollup.schema.ts:73-79`, with an explicit docstring clause requiring a fresh scoping round for expansion. **Feature 310 IS that scoping round.** |
| **A-03** (raw comment data is complete as of Feature 058) | **CONFIRMED (narrowed reading)** | **Pass 3 follow-up evidence**: Feature 058 merged at commit `0bd64240` (PR #292); backfill-comments command implemented end-to-end at commit `79d5a08c` (T009+T011-T015); Phase 4 closure marked at commit `9deb6a15`. Schema surfaces `pr_threads`, `pr_comments`, `pull_requests.comments_extracted_at` all present. **Narrowed reading**: "extraction + backfill **infrastructure** is available as of Feature 058" is supported by code + git-history evidence. The spec's literal "data is complete" wording is a pipeline-state claim NOT verifiable at code level — not restated here. Feature 310 does not depend on operational completeness: R-02's `null` partial sentinel handles any PR with `comments_extracted_at IS NULL`. Net: sufficient for 310's planning-readiness. |
| **A-04** (drill-down panel uses a consistent capability-gate pattern for optional columns) | **PARTIAL** | `DatasetCapabilityState.commentsMetricsAvailable` exists and is consumed by `dashboard.ts:2334` for the banner, but the drill-down panel has NO existing optional-column gating pattern. Feature 310 creates it (new pattern, anchored at the `PrListSectionWithRows.commentsMetricsAvailable` discriminator + capability-gated renderer). |
| **A-05** (follow-on feature covering Capabilities 1 + 2 will be created) | **PENDING — administrative** | Forward-looking / non-code-verifiable. Tracked via issue #322; resolve administratively (not by code validation). Kept explicitly OUT of the Pass 3 code-validation sweep. |
| **A-06** (demo datasets carry both `comments_metrics=true` AND `comments_metrics=false` payloads) | **RESOLVED via R-08** | User chose **path (a) + serialization-layer strategy** on 2026-04-21. `scripts/generate-demo-data.py` gains a `--comments-metrics {true,false}` flag that is **strictly serialization-layer** — zero branching in generation entrypoints, one code path (user constraint). `scripts/build-demo-dataset.py` orchestrates both variants: `artifacts/demo-enterprise/` (capability-on, unchanged) and `artifacts/demo-enterprise-comments-off/` (capability-off, new). Both variants are byte-identical except for the five gated keys (`manifest.capabilities.comments_metrics`, `manifest.features.comments`, `manifest.coverage.comments`, `prs[*].thread_count`, `prs[*].comment_count`, `prs[*].active_thread_count`) — enforced by `tests/integration/test_demo_variants_byte_identity.py` (three ordered subtests per R-08). SC-03 DOM parity test uses the real committed capability-off artifact, not simulated stripping. |

**Planning-readiness state** (after 2026-04-21 fix pass): **UNBLOCKED.** A-06 RESOLVED via R-08 path (a). Parity-gate silent-pass trap RESOLVED via §1 Canonical field declaration + 3-trigger-path correction. `/speckit.analyze` can proceed.

A-06 resolution summary (user decision 2026-04-21 after the BLOCKED verdict):

- **Chosen path**: (a) add `--comments-metrics` flag to `scripts/generate-demo-data.py`.
- **Implementation constraint**: serialization-layer only; zero branching in generation entrypoints; one code path (user-added constraint to prevent drift).
- **Byte-identity contract**: capability-on and capability-off artifacts differ only in five enumerated gated keys. Test `tests/integration/test_demo_variants_byte_identity.py` enforces via three ordered subtests (sorted-key-set equality excluding gated set → canonicalized byte equality → array-order parity including `prs[]`).
- **Artifact location**: `artifacts/demo-enterprise/` (capability-on, existing) and `artifacts/demo-enterprise-comments-off/` (capability-off, new).
- **Rejected alternatives**: (b) separate generator — violates contract consistency; (c) manual committed artifact — not reproducible; (d) weaken SC-03 — violates user's keep-blocked-rather-than-soften rule.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Pre-Phase-0 evaluation against the 26 Core Principles and the Quality Gates in `.specify/memory/constitution.md` v1.5.0:

| Principle / Gate | Applicability | Compliance Approach |
|---|---|---|
| I–IV (CSV schema contract) | N/A — this feature is additive JSON only; CSV contract untouched (INV-05). | No CSV surface modified; `powerbi/` CSV producers unaffected. |
| V (SQLite as source of truth) | Applies | All three new field values derive from SQLite reads; no alternative source. |
| VII (No publish on failure) | Applies | Extends existing aggregator; the current publish-on-success contract continues to apply. |
| VIII (Idempotent state updates) | Applies (read-only) | No writes; idempotence trivially preserved. |
| XII (No silent data loss) | Applies | Coverage-partial is explicit (`null` sentinel), not silent. Validator warns on malformed PR elements (existing permissive shape). |
| XXVI (Collection-stable tests) | Applies | New Python tests defined unconditionally at module scope; no `if version_condition` gating; platform-conditional files use the shared `PLATFORM_CONDITIONAL_IGNORE_GLOBS` pattern if any. |
| QG-04 (Deterministic output) | Applies | Aggregator additions preserve the existing stable sort + stable dict assembly; new fields emitted in fixed key order per PR element. Byte-stability test extended. |
| QG-05 (Golden output determinism) | Applies | Existing `test_golden_outputs.py` extended with fixture carrying `pr_threads` + `pr_comments` data, asserting byte-stable rollup JSON with the three new fields. |
| QG-23 (Runbook) | N/A | No operational runbook changes (no new flags, no new CLI modes). |
| QG-27 (Synthetic data includes comment generation) | Applies | Existing synthetic dataset already generates comments. A-06 RESOLVED via R-08: `scripts/generate-demo-data.py` gains a `--comments-metrics` flag at the serialization layer; `scripts/build-demo-dataset.py` produces both `artifacts/demo-enterprise/` (capability-on) and `artifacts/demo-enterprise-comments-off/` (capability-off). Byte-identity except for gated fields is locked by a dedicated integration test. Both variants from one generator, one code path — contract consistency preserved. |
| QG-35–38 (Local/CI parity) | Applies (new gate) | New parity gate (DIRECTIVE 2) MUST be wired into all four entry points Constitution QG-49 enumerates — pre-commit, pre-push preflight, `pnpm test:ci`, and CI — under one canonical command. |
| QG-39 (Cross-OS) | Applies | All new code + tests run on Windows, macOS, Linux. No OS-specific assumptions. |
| QG-40 (No typing.Any) | Applies | All new Python code uses precise types (`int`, `str`, `dict[str, object]`, TypedDicts, `Callable[..., object]`). |
| QG-41 (Zero suppressions) | Applies | No `# noqa`, `# type: ignore`, `// eslint-disable`, `// @ts-ignore` introduced. If an unavoidable suppression is discovered during implementation, it STOPS and escalates per the standing rule (artifact + guardrail + approval). |
| QG-42 (Enterprise test coverage) | Applies | Every new code path covered by pytest / Jest; property tests for INV-09; golden fixture for INV-10 partial sentinel; baseline-DOM golden for SC-03. |
| QG-43–46 (Test discipline) | Applies | Ratchet bumps in `.test-floor-contract.json` for both Python and Extension suites in the same commit that adds tests. Cross-OS collection parity preserved. |
| QG-47–49 (Entry-point alignment) | Applies (new gate) | Parity gate defined once (single script) and invoked by name from every entry point. Pre-commit triggers cover every file the gate reads (Python TypedDict site, TS interface site, required-fields set, 310 contract file, 060 contract file). Worktree-clean guard added for the gate's read scope. |
| QG-50–52 (Change acknowledgement) | Applies | Test-floor ratchet bumps carry no special marker (normal ratchet flow). No version bumps driven by this feature; extension semver is owned by release tooling. |
| QG-53–55 (Build architecture) | Applies (no changes) | No tsconfig or build-script modifications; `dist/ui/` ownership unchanged. |

**Verdict**: Initial Constitution Check **PASSES**. No Complexity Tracking entries needed. Re-check after Phase 1 design is below.

## Project Structure

### Documentation (this feature)

```text
specs/310-comments-visualization/
├── plan.md                                   # This file
├── research.md                               # Phase 0 output (below)
├── data-model.md                             # Phase 1 output (below)
├── quickstart.md                             # Phase 1 output (below)
├── contracts/
│   ├── pr-record-comments-fields.md          # 310-owned sibling extending 060's pr-record.md
│   └── schema-parity-gate.md                 # Parity-gate enforcement contract (DIRECTIVE 2)
├── checklists/
│   └── requirements.md                       # Pre-existing
├── spec.md                                   # Pre-existing (authoritative for C1..C5, INV-01..10)
└── tasks.md                                  # Generated by /speckit.tasks (NOT this command)
```

### Source Code (repository root)

Single-project layout. Files touched by this feature:

```text
src/ado_git_repo_insights/
├── types.py                                          # PrRecord TypedDict — expand by 3 fields
└── transform/
    └── aggregators.py                                # Per-week prs[] emit loop — add join + emit

extension/
├── package.json                                      # Add "test:schema-parity" script + chain into "test:ci" (QG-49 parity; mirrors test:partial-branches at :34)
└── ui/
    ├── schemas/
    │   └── rollup.schema.ts                          # PrRecord interface + PR_RECORD_REQUIRED_FIELDS — expand atomically
    ├── modules/
    │   ├── shared/
    │   │   └── detail-panel.ts                       # PrListRow + PrListSectionWithRows + renderPrListSection — gated columns
    │   └── drilldown/
    │       └── throughput-drilldown.ts               # Options accept commentsMetricsAvailable; pass into makePrListSection
    └── dashboard.ts                                  # Wire capabilityState.commentsMetricsAvailable into installThroughputDrilldown

scripts/
├── check_pr_record_schema_parity.py                  # NEW — single canonical command (DIRECTIVE 2 / parity gate)
├── generate-demo-data.py                             # Add --comments-metrics {true,false} flag, serialization-layer only (R-08; zero generation-layer branching)
└── build-demo-dataset.py                             # Orchestrate both demo variants (capability-on + capability-off) deterministically

artifacts/
├── demo-enterprise/                                  # Capability-on demo variant (unchanged)
└── demo-enterprise-comments-off/                     # NEW — capability-off demo variant (R-08); real pipeline-built artifact for SC-03

specs/060-throughput-pr-drilldown/contracts/
└── pr-record.md                                      # One-line pointer to 310 sibling contract (human continuity; NOT a parity-gate-checked surface — see schema-parity-gate.md)

tests/
├── unit/
│   ├── test_aggregators_pr_records_comments.py       # NEW — C1 inclusion rules, top-500 scope, partial sentinel
│   └── test_pr_record_schema_parity.py               # NEW — pytest wrapper around scripts/check_pr_record_schema_parity.py
├── integration/
│   ├── test_golden_outputs.py                        # EXTEND — fixture with comments data, byte-stable rollup JSON
│   └── test_demo_variants_byte_identity.py           # NEW — R-08 byte-identity contract between capability-on and capability-off artifacts (three ordered subtests)
└── demo/
    └── test_demo_parity_pipeline.py                  # VERIFY — existing capability coverage picks up the three new fields

extension/tests/
├── modules/
│   └── drilldown/
│       ├── pr-list-count-parity.test.ts              # EXTEND — render counts unaffected by new columns
│       ├── pr-list-comments-columns.test.ts          # NEW — capability-on render, sort, filter, property INV-09
│       ├── pr-list-capability-off-baseline.test.ts   # NEW — byte-identical DOM vs committed baseline (SC-03)
│       └── pr-list-comments-spread-guard.test.ts     # NEW — fail if non-throughput drill-downs consume new fields
├── schemas/
│   └── pr-record-comments-fields.test.ts             # NEW — validator parity for optional new fields
└── fixtures/
    └── throughput-drilldown-capability-off-baseline.html  # NEW — committed DOM baseline for SC-03 snapshot
```

**Structure Decision**: Single-project repo layout unchanged. All changes live within existing directories. No new top-level folders.

## Phase 0 — Outline & Research

Research lives in [`research.md`](./research.md). Decisions recorded:

- **R-01**: Coverage signal is per-PR `pull_requests.comments_extracted_at` exclusively (user-locked DIRECTIVE 4 + user's "no dataset-level fallback" guard). No hybrid encoding.
- **R-02**: Partial-coverage sentinel is `null` on each of the three numeric fields; three-field atomicity enforced by tests (INV-08 / INV-10).
- **R-03**: Atomic schema expansion across 4 surfaces (DIRECTIVE 1, revised per user Q1 answer). `KNOWN_ROOT_FIELDS` excluded; `KNOWN_PR_RECORD_FIELDS` NOT introduced in this pass (partial enforcement would create silent drift).
- **R-04**: Parity gate uses a single canonical command (DIRECTIVE 2), invoked identically from all four entry points Constitution QG-49 enumerates — pre-commit, pre-push preflight, `pnpm test:ci`, and CI. The `pnpm test:ci` invocation follows the `test:partial-branches` precedent at `extension/package.json:34` (a pnpm script wrapper that shells to Python), chained into the existing `test:ci` script definition.
- **R-05**: Aggregator join enforces top-500 slice first (user-locked). No join outside the capped set.
- **R-06**: Baseline-DOM parity golden on capability-off path only (user-locked). Capability-on DOM is not snapshotted (too volatile).
- **R-07**: SC-05 reconciliation is #322's obligation; no CI wiring or test code here.

**Output**: [research.md](./research.md) — all NEEDS CLARIFICATION resolved; no unresolved unknowns remain.

## Phase 1 — Design & Contracts

Prerequisites: `research.md` complete (Phase 0).

Design artifacts:

- **[data-model.md](./data-model.md)** — §1 extended PrRecord (8 fields when `capabilities.comments_metrics=true`, 5 fields when `false`). §2 inclusion rules by reference to spec.md's C1 subsection (NO re-declaration per DIRECTIVE 7). §3 per-PR partial state derivation from `comments_extracted_at`. §4 relationships (read-only). §5 invariants pinned to test anchors.
- **[contracts/pr-record-comments-fields.md](./contracts/pr-record-comments-fields.md)** — 310-owned sibling extending 060's `pr-record.md`. Producer + consumer + validator contracts for the three new fields. References spec.md's C1 subsection; does not re-declare.
- **[contracts/schema-parity-gate.md](./contracts/schema-parity-gate.md)** — Single-command enforcement contract for DIRECTIVE 2 (atomic expansion across 4 surfaces). Lists canonical command, entry-point invocations, trigger scope, worktree-clean guard.
- **[quickstart.md](./quickstart.md)** — Demo + manual verification walkthrough for SC-01, SC-02, SC-03, SC-04. SC-05 explicitly out of scope.

### Cross-surface enforcement (DIRECTIVE 2)

One canonical command:

```bash
python scripts/check_pr_record_schema_parity.py
```

Invocation sites (all identical, by name):

| Entry point | Mechanism | Evidence |
|---|---|---|
| pre-commit | new predicate + runner function in `scripts/run_repo_hook.py` following the existing `is_ui_trigger` / `is_test_trigger` pattern (there is **no `CommandSpec` abstraction in `run_repo_hook.py`** — that `@dataclass(frozen=True)` lives only in `scripts/run_pr_preflight.py:71`) | triggers cover every path the gate reads — **three paths only**: `src/ado_git_repo_insights/types.py`, `extension/ui/schemas/rollup.schema.ts`, `specs/310-comments-visualization/contracts/pr-record-comments-fields.md`. The 060 contract is **NOT** a trigger (the gate does not parse it; see `contracts/schema-parity-gate.md` for rationale — 060 contract gets a separate human-readable pointer update tracked as a tasks.md obligation). |
| pre-push preflight | `scripts/run_pr_preflight.py` CommandSpec (new) | identical command string |
| CI | `.github/workflows/ci.yml` step (new) | identical command string, runs on Ubuntu + Windows matrix (QG-45 cross-OS) |
| `pnpm test:ci` | `extension/package.json` — new pnpm script `"test:schema-parity": "python ../scripts/check_pr_record_schema_parity.py"` chained into the existing `test:ci` script definition | mirrors the `test:partial-branches` precedent at `extension/package.json:34` (which already shells from `pnpm test:ci` into the repo's partial-branches Python coverage-ratchet script — see row 36 of `LOCAL_CI_PARITY_INVARIANTS.md` for the authoritative parity contract); identical command string across all four entry points (QG-49 compliance) |

Worktree-clean guard (QG-48): `scripts/run_repo_hook.py` gains a `require_clean_pr_record_parity_scope()` call covering the four read paths listed above.

### Spread guard (user-added constraint, Q2)

Meta-test `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts`:

- Scans every file in `extension/ui/modules/drilldown/*.ts`.
- FAILS if any drilldown module outside `throughput-drilldown.ts` reads `PrListRow.threadCount`, `PrListRow.commentCount`, or `PrListRow.activeThreadCount`, or constructs `PrListSectionWithRows` with a truthy `commentsMetricsAvailable`.
- Locks the scope to the throughput surface and prevents accidental spread without capability gating (user constraint #2).

### Coverage signal lock (user-added constraint)

Single mechanism: per-PR `pull_requests.comments_extracted_at IS NULL` → the three fields emitted as `null`. `pull_requests.comments_extracted_at IS NOT NULL` → three fields emitted as non-negative integers.

No dataset-level `coverage.comments` read anywhere in this feature's code path. Dashboard's existing `commentsCoverageStatus` banner (dashboard.ts:2334) remains untouched; it is a separate surface unrelated to per-PR render decisions.

### Agent context update

Run `.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` at the end of Phase 1 to append the feature-310 stanza to `CLAUDE.md`'s "Recent Changes" section.

### Re-evaluate Constitution Check post-design

Post-Phase-1 re-evaluation:

| Gate | Status | Notes |
|---|---|---|
| QG-42 (enterprise test coverage) | ✅ | Every new surface covered: aggregator logic (pytest), schema parity (canonical command + pytest wrapper), DOM renderer (Jest + jsdom), capability-off baseline (byte-identical golden), spread guard (structural Jest test), INV-09 property (Jest fast-check style or explicit cases), INV-10 partial atomicity (pytest + Jest). |
| QG-43–44 (ratchet bumps) | ✅ | `.test-floor-contract.json` bumps for the Python + Extension deltas land in the same commit as the test additions. No hardcoded integers. |
| QG-46 (no pytest.mark.skip) | ✅ | All new tests unconditional at module scope. |
| QG-47 (trigger scope) | ✅ | Pre-commit triggers enumerate all four read paths of the parity gate. |
| QG-48 (worktree-clean guard) | ✅ | New `require_clean_pr_record_parity_scope()` covers the gate's read scope. |
| QG-49 (one command, many callers) | ✅ | `python scripts/check_pr_record_schema_parity.py` — identical invocation across pre-commit / pre-push / `pnpm test:ci` (via new `test:schema-parity` pnpm script chained into `test:ci`, mirroring the `test:partial-branches` precedent) / CI. All four entry points per Constitution QG-49. |
| QG-50–52 | ✅ | No bypass markers; normal ratchet flow; no version bumps. |

**Verdict**: Post-Design Constitution Check **PASSES**. No Complexity Tracking entries.

**Output**: research.md, data-model.md, contracts/*.md, quickstart.md, CLAUDE.md updated.

## Complexity Tracking

> No Constitution Check violations. Section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| *(none)* | — | — |

## Phase 2 — next

`/speckit.plan` stops here. Both previously-outstanding blockers resolved in the 2026-04-21 atomic fix pass:

- **A-06** RESOLVED via R-08 (path (a) — serialization-layer capability-off generation on `generate-demo-data.py`; `build-demo-dataset.py` orchestrates both variants; byte-identity except gated fields enforced by `tests/integration/test_demo_variants_byte_identity.py`).
- **Parity-gate silent-pass trap** RESOLVED via §1 Canonical field declaration added to the 310 sibling contract (making the gate's step-4 parse target real) + trigger list corrected to 3 paths matching the 3 files the gate reads.

Resolved earlier in the 2026-04-21 Pass 3 follow-up (no longer blocking):

- **A-03**: CONFIRMED narrowly — Feature 058 infrastructure available; operational "data complete" not restated. 310 does not depend on operational completeness.
- **A-05**: administrative; not code-validated. #322 owns the follow-on feature.

**Planning-ready**: `/speckit.tasks` runs next to generate `tasks.md` from the design artifacts (spec + plan + data-model + contracts + quickstart). `/speckit.analyze` then runs to cross-check `spec.md` + `plan.md` + `tasks.md` for drift before `/speckit.implement`. Ordering enforced by the analyze-skill prerequisite script (`-RequireTasks`).

Deferred cross-feature obligations (NOT this feature's CI):

- SC-05 reconciliation test — #322's `/speckit.plan`.
- Team-dimension surfaces — #321 (blocked on team-at-time-of-PR history modeling).

Deferred to `/speckit.tasks`:

- Implementation of the byte-identity integration test's three subtests.
- Implementation of the parity-gate script (`scripts/check_pr_record_schema_parity.py`).
- Execution of both against the real tree (plan pass documents the contract; tasks implement).
