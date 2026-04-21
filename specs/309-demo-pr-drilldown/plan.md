# Implementation Plan: Synthetic Demo Exercises PR-Level Detail

**Branch**: `309-demo-pr-drilldown` | **Date**: 2026-04-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/309-demo-pr-drilldown/spec.md`
**Closes**: #315 | **Related**: #318 (scope-boundary note captured in GitHub issue comment)

## Summary

Narrow FR-023 from destination-identity-based stripping to provenance-based stripping via a synthetic-authorization signal (sentinel file), while adding a synthetic PR-level detail generator driven by distribution fixtures derived one-time from a real tenant extract. The public demo will exercise every user-visible surface of feature 060 (PR rows, truncation indicator, filter-consistent counts, link composition, inline gated message) without regressing the tenant-privacy invariant for any real extraction/aggregation path.

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests). Matches existing baseline. TypeScript 6.0.3 is present (extension UI) but THIS FEATURE MAKES NO EXTENSION CODE CHANGES — the extension already renders whatever `prs` payload arrives; scope stops at backend + demo generator.
**Primary Dependencies**: existing only — `argparse`, `pathlib`, `json`, `random`, `sqlite3` via `DatabaseManager`, `requests` via `ADOClient` (one-time extract only), `pytest` + `unittest.mock.MagicMock`. No new third-party runtime or dev dependencies.
**Storage**:
- Local SQLite for one-time tenant extract at gitignored `.tmp/oddessentials-extract.sqlite` (developer machine only; never committed)
- Committed statistical-summary JSON under `scripts/demo-distributions/` (anonymized; no tenant identifiers)
- Existing demo artifact pipeline via `artifacts/demo-enterprise/data/` → `docs/data/` (unchanged layout; synthetic generator emits three new keys; strip gate unchanged when sentinel absent)
**Testing**: pytest (Python) for 100% of this feature's gates and contracts. Jest (TypeScript) unchanged — no extension code modifications. New test modules split across `tests/demo/`, `tests/unit/`, and a new fixture tree under `tests/demo/fixtures/strip_gate/` for the binary-gate matrix.
**Target Platform**: Cross-OS — Windows 11, macOS 14+, Linux (Ubuntu 22.04+). All filesystem operations via `pathlib`; no shell-invoked tools. UTF-8 explicit on every `open()`. Git-aware checks use `subprocess` with forward-slash paths (QG-39).
**Project Type**: Single project (existing layout at repo root; no new top-level directories).
**Performance Goals**:
- Demo-build pipeline overall runtime MUST NOT regress more than 5% vs current baseline (260-week generation currently ~30–90s on baseline Python 3.12.x; synthetic PR generation adds per-week dict construction only).
- Strip-gate check MUST complete in seconds at full 260-week scale (existing `strip_pr_arrays_from_rollups` performance contract inherited).
- One-time tenant extract runs outside CI (developer-local; acceptance criterion is "derivation completes without PAT exposure," not a latency bound).
**Constraints**:
- **Byte-determinism** (FR-014, FR-015): regeneration on baseline Python 3.12.x with committed seed produces byte-identical non-PR content vs the prior committed state. Serialization uses the aggregator's exact params: `json.dump(..., indent=2, ensure_ascii=False, sort_keys=False)` + trailing `\n`; new keys appended LAST to match aggregator insertion order at `aggregators.py:832-834`.
- **Aggregator lockup**: zero edits under `src/ado_git_repo_insights/transform/` or `src/ado_git_repo_insights/types.py`. Synthetic generator IMPORTS `PrRecord` from `types.py:289`.
- **Privacy invariant preserved**: every flow without the sentinel stripped (FR-009). Source-shape verified even WITH sentinel present (FR-010 fail-closed).
- **No `typing.Any`** (QG-40): full annotations on all new code.
- **Zero suppressions** (QG-41): no `# noqa` / `# type: ignore` / `// eslint-disable`.
- **Single authoritative gate** (QG-47/49): strip gate wired at exactly ONE site (inside `promote_data`); all entry points (pre-commit, pre-push, CI, preflight) invoke by name.
- **PAT secrecy** (Core Principle XIX): PAT passed via environment variable only; never argv, never committed, rotated post-use.
- **Cross-OS test parity** (QG-45/46): Python floor = cross-platform minimum; any platform-conditional tests use file-name-pattern exclusion (`test_*_windows.py`), never `pytest.mark.skip`.
**Scale/Scope**:
- 260 weekly rollups in the canonical enterprise demo (unchanged).
- Synthetic PRs per week: majority weeks ≤ existing `BASE_PR_COUNT * growth_factor * adjustment` range (mostly 80–200), one intentional spike at 2025-W26 with > 500 qualified PRs to exercise truncation. Estimated total synthetic PR record count: ~30,000–50,000 (well below any I/O pressure threshold).
- One-time tenant extract: ~5,139 PRs per the existing pipeline-15 seeded DB (memory pointer `reference_oddessentials_test_data.md`). Fresh extract is targeted at the same organization; exact count is whatever the tenant currently holds.
- 13 new test modules (7 unit + 4 integration + 1 entrypoint-parity + 1 byte-stability) — floor-bump ratchet per QG-43 must land in the same commit as each slice's test additions.

## Constitution Check

*GATE: Evaluated before Phase 0 research; re-evaluated after Phase 1 design. Constitution v1.5.0.*

### Applicable Core Principles

| Principle | Applicability | How this feature preserves it |
|---|---|---|
| VII. No Publish on Failure | HIGH — directly relevant | Binary strip gate is fail-closed on BOTH branches. Sentinel-present path asserts synthetic shape; sentinel-absent path invokes existing strip-and-re-verify. `promote_data` atomicity test locks "residue → raise before mkdir/copytree → destination byte-identical." |
| XIX. PAT Secrecy | HIGH — one-time extract uses PAT | PAT passed via `ADO_PAT` env var only; never argv, never committed, never logged. `.tmp/` gitignored. Rotate post-use. |
| XX. Least Privilege Default | HIGH — one-time extract | PAT scope limited to `Code: Read` on the target org (matches existing `ado-insights` CLI minimum). |

### Applicable Quality Gates

| Gate | Relevance | Compliance mechanism in this plan |
|---|---|---|
| QG-30 (parity: CLI/ext one shared UI bundle) | Inherited — no UI changes | No extension edits; parity unchanged. |
| QG-31 (canonical enterprise demo builds under `artifacts/demo-enterprise/`) | Direct | Synthetic generator writes to existing artifact root; no layout change. |
| QG-32 (`docs/data/` clean promoted mirror) | Direct | Sentinel never published (FR-011); pre-push + CI absence guards. |
| QG-33 (enterprise demo capability matrix passes) | Direct | Capability matrix is regenerated from the new synthetic output; must report `all_passed=true` unchanged. |
| QG-34 (startup-state parity) | Direct | Startup parity report regenerated; must remain `parity_passed=true`. |
| QG-35–QG-38 (Local/CI parity) | Direct | New sentinel-absence gate + negative-provenance gate + entrypoint-parity test explicitly mirror CI in `run_repo_hook.py pre-push` (VR-28) and `run_pr_preflight.py` (VR-29). |
| QG-39 (cross-OS) | Direct | All filesystem operations via `pathlib`; UTF-8 explicit; no shell invocations; git subprocess uses forward-slash paths. |
| QG-40 (no `typing.Any`) | Direct | All new code fully annotated with precise types; `PrRecord` imported, not redefined. |
| QG-41 (zero inline suppressions) | Direct | No `# noqa` / `# type: ignore` / `// eslint-disable`. |
| QG-42 (enterprise test coverage) | Direct | 13 new test modules across 4 slices; each covers a distinct FR or SC with failing-first discipline. |
| QG-43 (ratchet-bump same commit) | Direct | Each slice commit bumps `.test-floor-contract.json` by exactly N added tests. |
| QG-44 (`.test-floor-contract.json` single source of truth) | Direct | Inter-file parity preserved; no hardcoded floors. |
| QG-45 (Python floor = cross-platform minimum) | Direct | `python-collection-parity` CI job validates Ubuntu ↔ Windows node_id set equality on new tests. |
| QG-46 (platform-conditional tests via filename pattern) | None expected | All new tests collection-stable across OSes; no platform-conditional additions planned. |
| QG-47 (pre-commit trigger scope matches gate scope) | Direct | Sentinel-absence gate triggers on any change under `docs/data/`; negative-provenance gate triggers on any change under `src/` or `scripts/`. |
| QG-48 (worktree-reading gates need clean-worktree guard) | Direct | Staged-vs-worktree dual check in `assert_inputs_clean()` IS the clean-worktree guard for the demo-build promotion step. |
| QG-49 (each gate defined once, invoked by name everywhere) | Direct | `assert_inputs_clean`, `strip_pr_arrays_from_rollups`, `assert_synthetic_shape`, sentinel-absence check — each defined ONCE and referenced by name from every entry point. |
| QG-50 (bypass markers in commit subject lines only) | Indirect | If a test-removal ratchet realignment needs a bypass marker in slice 2d, it goes in the subject line only. |
| QG-51 (manifest version changes need `[version-override-acknowledged]`) | Indirect | `DEMO_PROFILE_VERSION` is NOT an extension/task manifest version field; QG-51 does not apply per its literal wording. Memory `feedback_version_guard_scope.md` confirms: version guard covers extension behavioral changes (`SUPPORTED_*_VERSION`), not orchestrator-internal constants. |
| QG-52 (coverage ≤2% drop) | Direct — favorable | Feature adds tests; coverage should rise. `check_coverage_delta.py` validates. |
| QG-53–QG-55 (build architecture + Prettier) | None | No extension code changes. |
| QG-56 (gitleaks parity) | Direct | One-time extract script MUST NOT hard-code the PAT; committed distribution fixtures MUST NOT contain the PAT. Gitleaks catches any accidental commit. |

### Applicable Verification Requirements

| VR | Relevance | Pass criterion |
|---|---|---|
| VR-24 (canonical demo build) | Direct | `python scripts/build-demo-dataset.py` succeeds post-feature on baseline Python. |
| VR-25 (capability matrix passes) | Direct | `capability-matrix.json` reports `all_passed=true`. |
| VR-26 (startup-state parity) | Direct | `startup-parity.json` reports `parity_passed=true`. |
| VR-27 (`docs/data/` byte-identical to canonical + generated-only) | Direct | Regen + byte-equality test proves non-PR-field stability. |
| VR-28 (pre-push hook zero-exit) | Direct | `python scripts/run_repo_hook.py pre-push` succeeds with sentinel-absence guard added. |
| VR-29 (preflight zero-exit) | Direct | `python scripts/run_pr_preflight.py` succeeds; every CommandSpec including new gates passes. |
| VR-30 (ratchet-bump parity) | Direct | `check_ratchet_bump.py` reports floor == actual per commit after each slice. |

### Constitution Check: Initial verdict

**PASS.** No unjustifiable gate violations. Aggregator lockup (FR-006) directly preserves the stability contract of existing types and transformation layer. The binary gate's fail-closed design preserves VII (No Publish on Failure) and strengthens the feature-060 FR-023 posture (from destination-identity-based to provenance-based). No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/309-demo-pr-drilldown/
├── plan.md                         # This file (/speckit.plan output)
├── spec.md                         # Feature spec (/speckit.specify output)
├── research.md                     # Phase 0 output — decision log with rationale + alternatives
├── data-model.md                   # Phase 1 output — entity definitions + field schemas
├── quickstart.md                   # Phase 1 output — developer onboarding for this feature
├── contracts/                      # Phase 1 output — interface contracts
│   ├── demo-strip-gate-v2.md       #   Supersedes feature 060's demo-strip-gate.md; narrows FR-023
│   ├── synthetic-authorization-signal.md  #   Sentinel protocol (writer / reader / lifecycle)
│   ├── distribution-fixture-schema.md     #   Committed JSON schema under scripts/demo-distributions/
│   └── byte-determinism-regen.md   #   Regen byte-equality invariant + re-serialization contract
├── checklists/
│   └── requirements.md             # Spec quality checklist (already populated)
└── tasks.md                        # Phase 2 output (NOT created by /speckit.plan — awaits /speckit.tasks)
```

### Source Code (repository root — deltas only)

```text
src/ado_git_repo_insights/                          # AGGREGATOR LOCKUP — no edits this feature
└── (unchanged)

scripts/
├── build-demo-dataset.py                           # EDIT (slice 2b): promote_data() → binary gate + argparse `--allow-dirty-inputs`. EDIT (slice 2d): write sentinel after generator step; bump DEMO_PROFILE_VERSION
├── generate-demo-data.py                           # EDIT (slice 2c): add generate_pr_records() helper + isolated pr_record_rng + import PrRecord. EDIT (slice 2d): wire emission into rollup loop + 2025-W26 override
├── strip_pr_arrays.py                              # EDIT (slice 2b): add SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME constant (single source of truth; hyphenated build-demo-dataset.py cannot be imported)
├── extract_distribution_fixtures.py                # NEW: one-time tenant → scripts/demo-distributions/*.json helper
├── demo-distributions/                             # NEW: committed anonymized statistical summaries
│   ├── title-tokens.json                           #   Token-frequency distribution (no real titles)
│   ├── cycle-time-per-repo-size.json               #   Per-repo-size lognormal params (mu, sigma)
│   ├── author-concentration.json                   #   Author-per-week / author-per-repo concentration
│   ├── pr-count-per-week-per-repo.json             #   PR volume distribution per repo per week
│   └── truncation-exercise-week.json               #   Config for the 2025-W26 spike
└── run_repo_hook.py                                # EDIT: add sentinel-absence step to run_pre_push_hook()

tests/
├── demo/
│   ├── test_schema_guard.py                        # EDIT (slice 2d only): flip to test_synthetic_demo_has_prs
│   ├── test_demo_parity_pipeline.py                # EDIT (slice 2b): add atomicity tests for both branches
│   ├── test_synthetic_pr_contract.py               # NEW: cap / truncation / sort / boundary contract tests
│   └── test_regen_byte_stability.py                # NEW: byte-equality regen test (slice 2d)
├── unit/
│   ├── test_tenant_provenance_negative.py          # NEW: negative-provenance grep via git ls-files --cached
│   ├── test_strip_gate_entrypoint_parity.py        # NEW: entrypoint-command parity (local vs CI invocation of the `sentinel-absence` subcommand)
│   ├── test_promote_data_unlink_ordering.py        # NEW: sentinel.unlink ordering + PermissionError atomicity
│   ├── test_assert_inputs_clean.py                 # NEW: staged-vs-worktree dual check tests
│   ├── test_assert_synthetic_shape.py              # NEW: shape-verification fail-closed tests
│   └── test_sentinel_absence_in_docs_data.py       # NEW: pre-push + CI first-step guard tests
└── demo/fixtures/                                  # NEW: synthetic source fixtures for gate-behavior tests
    ├── sentinel-present-synthetic-shaped/          #   Valid synthetic source
    ├── sentinel-present-tenant-shaped/             #   Should raise (shape mismatch)
    ├── sentinel-absent-clean/                      #   Should strip successfully
    └── sentinel-absent-with-residue/               #   Should raise (strip residue)

specs/060-throughput-pr-drilldown/
└── contracts/
    └── demo-strip-gate.md                          # EDIT (slice 2b): supersede notice pointing at demo-strip-gate-v2.md

docs/
├── reference/
│   └── dataset-contract.md                         # EDIT (slice 2b): privacy-posture section extended to describe provenance-based narrowing; anchor preserved
└── data/
    └── aggregates/weekly_rollups/*.json            # REGEN (slice 2d ONLY): all 260 files regenerated atomically

.github/
└── workflows/
    └── demo.yml                                    # EDIT (slice 2b): add sentinel-absence first-step invoking `python scripts/run_repo_hook.py sentinel-absence` to the build-demo job (line 83-85). Also audit release.yml for any additional demo-build invocations.

.gitignore                                          # EDIT (slice 2a): add .tmp/ entry for tenant-extract DB

artifacts/demo-enterprise/data/dataset-manifest.json # REGEN: demo_profile.version "2.0.0" → "2.1.0" (slice 2d atomic)
scripts/build-demo-dataset.py                       # EDIT (slice 2d atomic): DEMO_PROFILE_VERSION constant bump
```

**Structure Decision**: Single-project layout (existing). This feature concentrates edits into `scripts/`, `tests/`, `docs/`, and one `.github/workflows/demo.yml` touch (the build-demo job around line 83-85). `src/` is locked — no edits under the transform or types modules. Artifact tree at `artifacts/demo-enterprise/data/` and public surface at `docs/data/` follow existing layout; only content of weekly rollups changes (three new keys), plus one new sentinel file consumed at the promotion boundary and never published.

## Phase 0: Outline & Research

**Method**: zero `NEEDS CLARIFICATION` markers entered this phase because all tactical questions were locked upstream in the `/speckit.specify` input. Phase 0 documents the decisions and their alternatives so future readers understand why the locked choices are load-bearing.

**Output artifact**: `research.md` (see below).

**Research topics covered**:
1. Provenance mechanism (sentinel file vs manifest field vs parallel pipeline)
2. Gate binary-branching form (explicit unreachable-third-path assertion)
3. Byte-equality vs structural-equivalence for regen verification
4. Distribution source (fresh tenant extract vs reuse of pipeline-15 artifact)
5. Truncation-exercise week selection (2025-W26; contrast neighbors W25/W27)
6. Scope containment (throughput-only vs chart-agnostic generalization)
7. Entrypoint-command parity (command-level vs helper-level)
8. Staged-vs-worktree guard form (dual git diff vs `git diff HEAD`)

## Phase 1: Design & Contracts

**Prerequisites**: Phase 0 complete (see `research.md`).

**Outputs**:
- `data-model.md` — entity schemas, field types, relationships, validation rules
- `contracts/demo-strip-gate-v2.md` — binary gate semantics + supersedure of feature-060 contract
- `contracts/synthetic-authorization-signal.md` — sentinel protocol (writer, reader, lifecycle, absence guarantees)
- `contracts/distribution-fixture-schema.md` — committed JSON schema under `scripts/demo-distributions/`
- `contracts/byte-determinism-regen.md` — regen invariant + canonical re-serialization contract
- `quickstart.md` — developer onboarding: how to re-run extraction, how to regenerate demo, how to verify gates
- Agent context update via `update-agent-context.ps1`

**Agent context update**: runs after artifacts generated; appends this feature's tech additions to `CLAUDE.md`.

## Post-Design Constitution Check

*Re-evaluated after Phase 1 artifacts are drafted. Same gate matrix as above; verdict restated.*

**Re-check verdict**: Plan preserves or strengthens every applicable gate and Verification Requirement. No Complexity Tracking entries introduced. Aggregator lockup is load-bearing for Principle V (SQLite as source of truth) and for feature-060's existing guarantees — unchanged.

## Complexity Tracking

> **Filled only when Constitution Check has unjustified violations.**

*Empty — no violations introduced.*
