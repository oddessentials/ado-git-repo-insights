# Implementation Plan: Roadmap Closure Program

**Branch**: `034-roadmap-closure` | **Date**: 2026-03-21 | **Spec**: [spec.md](E:/projects/ado-git-repo-insights/specs/034-roadmap-closure/spec.md)
**Input**: Feature specification from `/specs/034-roadmap-closure/spec.md`

## Summary

This plan turns the roadmap-closure specification into an implementation-ready program that finishes the last roadmap features without breaking the existing CSV contract, destabilizing identity semantics, or introducing unbounded additive data growth. The work is organized into four slices: author filters, exact author x repository, comments completion, and reviewer follow-through with closure evidence.

## Technical Context

**Language/Version**: Python 3.10+ backend, TypeScript 5.9 frontend, PowerShell helper scripts
**Primary Dependencies**: pandas/numpy for aggregation, requests/PyYAML for CLI runtime, pytest/ruff/mypy for Python verification, pnpm/jest/eslint/playwright for extension verification, VSS web extension SDK for dashboard runtime
**Storage**: SQLite as source of truth; JSON aggregates and manifest files for dashboard consumption; core CSV exports plus auxiliary additive CSV outputs
**Testing**: `pytest`, `ruff`, `mypy`, Jest, TypeScript type tests, Playwright smoke tests, schema validators, synthetic dataset/integration coverage
**Target Platform**: Azure DevOps pipeline task plus Azure DevOps extension dashboard; local developer workflows on Windows/Linux/macOS; hosted and self-hosted agents
**Project Type**: Mixed Python CLI/data pipeline and TypeScript extension UI in a single repository
**Performance Goals**: Preserve existing scalability gates for 156+ weeks, 200+ reviewers, and comments-enabled datasets; keep additive slice generation bounded and deterministic
**Constraints**: No breaking changes to the six core PowerBI CSVs; SQLite remains authoritative; additive dimensions must be capability/version gated; reviewer combinations may not use proportional fallback; aggregation must remain deterministic and convergent
**Scale/Scope**: Four remaining roadmap slices touching aggregation, manifest/schema validation, dataset loading, dashboard filters/metrics, docs, and closure evidence

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / Gate Area | Status | Notes |
|-----------------------|--------|-------|
| I-II CSV schema contract / no breaking CSV changes | PASS | Plan explicitly separates core contract CSVs from auxiliary additive outputs |
| III Deterministic output | PASS | Plan requires deterministic aggregation, deterministic truncation, and repeatable evidence |
| V SQLite as source of truth | PASS | All new outputs remain SQLite-derived |
| VIII / XI Idempotency and backfill convergence | PASS | New author/comments outputs must recompute deterministically and converge under backfill |
| XV-XVI Scoping and stable identity | PASS | Canonical identity remains `user_id`; project/org scoping preserved |
| XXIII Automated CSV validation | PASS | Core CSV regression tests and auxiliary CSV contract tests are mandatory |
| XXIV-XXV End-to-end testability / backfill testing | PASS | Plan requires targeted integration coverage and convergence checks for new additive outputs |
| QG-01 through QG-05 Output contract gates | PASS | Protected by explicit core/auxiliary boundary and regression tests |
| QG-11 through QG-12 Extraction / convergence gates | PASS | Comments and author aggregates remain downstream of existing persisted state |
| QG-25 through QG-29 Scalability gates | PASS | Plan adds bounded cardinality requirements instead of unbounded slice expansion |

**Pre-Design Result**: PASS. No constitution violations identified. The plan strengthens existing governance rather than weakening it.

## Project Structure

### Documentation (this feature)

```text
specs/034-roadmap-closure/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── dataset-capabilities.md
│   └── roadmap-closure-evidence.md
└── tasks.md
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── cli.py
├── extractor/
├── persistence/
├── transform/
│   ├── aggregators.py
│   ├── csv_generator.py
│   └── schema_versions.py
└── ui_bundle/

extension/
├── ui/
│   ├── dashboard.ts
│   ├── dataset-loader.ts
│   ├── index.html
│   ├── modules/
│   │   ├── filters.ts
│   │   ├── metrics.ts
│   │   └── charts/
│   └── schemas/
│       ├── manifest.schema.ts
│       ├── rollup.schema.ts
│       └── dimensions.schema.ts
├── tests/
│   ├── schema/
│   ├── modules/
│   ├── dashboard/
│   ├── meta/
│   └── smoke/
└── package.json

tests/
├── unit/
├── integration/
└── demo/

docs/
├── reference/
├── development/
└── operations/

scripts/
└── generate-synthetic-dataset.py
```

**Structure Decision**: Use the existing mixed Python backend plus TypeScript extension layout. No new top-level projects are required. The feature is primarily additive across established aggregation, schema-validation, and dashboard modules.

## Phase 0: Research Summary

Phase 0 resolved all material clarification points required for design:

1. Comment CSVs are auxiliary outputs, not additions to the current PowerBI contract.
2. Canonical author identity is immutable ADO `user_id`; display names are labels.
3. Additive cross-dimensional slices must be bounded with deterministic truncation.
4. Reviewer combinations are limited to `exact`, `constrained`, or `disallowed-with-ux-signal`; proportional fallback is prohibited.
5. Capability/version detection must occur at the loader boundary.
6. Closure evidence requires a standard artifact format rather than subjective sign-off.

These findings are captured in `research.md` and operationalized by the data model and contracts in Phase 1.

## Locked Design Decisions

The following decisions are fixed for execution and must not be reopened during implementation without first amending this spec/plan set.

### DD-01: Author + Team Semantics

Author + team filter combinations are locked to `constrained` mode.

- Author-only and team-only behavior remain supported.
- When both author and team are selected, the dashboard must not compute synthetic combined metrics.
- The UI must surface the constrained behavior explicitly and resolve metrics using the dominant selected supported dimension rather than an estimated intersection.

### DD-02: Reviewer Combination Modes

Reviewer combinations are locked as follows:

- reviewer + repository: `constrained`
- reviewer + team: `disallowed-with-ux-signal`

No reviewer combination may use proportional fallback in this roadmap program.

### DD-03: Deterministic Truncation Order

When a bounded cross-dimensional structure exceeds its configured ceiling, retained entries must be selected in this exact order:

1. `pr_count` descending
2. canonical primary key ascending
3. secondary dimension key ascending

For `by_author_and_repo`, that means:

- `pr_count DESC`
- `author_id ASC`
- `repository_name ASC`

Truncation must emit an explicit truncation signal in the additive output and normalized capability state.

### DD-04: Loader Capability Precedence

Loader capability detection uses this precedence:

1. manifest capability flags when present
2. schema-version support when capability flags are absent
3. normalized safe defaults only when neither is present

The loader must not require both sources unless a later contract explicitly changes that rule.

### DD-05: Evidence Artifact Location

Roadmap closure evidence must be checked in at:

`specs/034-roadmap-closure/evidence/`

Required filename pattern:

`NNN-<roadmap-item>-evidence.md`

where `NNN` is a stable ordering prefix. These artifacts are produced and maintained by the implementation branch owner as part of roadmap closure.

### DD-06: Auxiliary Comments CSV Path

Auxiliary comments CSVs must be written under:

`csv-output/auxiliary/comments/`

Required filenames:

- `pr_threads.csv`
- `pr_comments.csv`

## Phase 1: Design Strategy

### Slice A: Author Filters

- Add `by_author` weekly rollup support in `aggregators.py`, keyed by canonical `user_id`.
- Extend dimensions/manifest/rollup schemas and dataset normalization so author capability is explicit.
- Add dashboard filter state, UI, and metrics behavior without mutating existing repository/team/reviewer flows.
- Keep display-name handling strictly label-based with fallback behavior for missing or renamed users.
- Enforce locked `constrained` author+team behavior from DD-01.

### Slice B: Exact Author x Repository

- Add bounded `by_author_and_repo` support with deterministic truncation policy.
- Expose capability or truncation state so the frontend can distinguish exact retained data from unavailable exact support.
- Preserve backward compatibility for legacy datasets through loader normalization and current fallback behavior.
- Apply DD-03 exactly: `pr_count DESC`, then `author_id ASC`, then `repository_name ASC`.

### Slice C: Comments Completion

- Complete SQLite-derived auxiliary comment CSV export in `csv_generator.py`.
- Extend aggregate generation with metrics-first comments summaries, repository breakdowns, weekly trend data, and persisted capped coverage state.
- Extend manifest/dataset schemas and dashboard rendering for disabled/full/partial comments states.
- Document comment CLI flags and explicitly mark comment CSVs as auxiliary outputs.
- Emit auxiliary comments CSVs only under `csv-output/auxiliary/comments/`.

### Slice D: Reviewer Follow-Through And Closure

- Record and implement one allowed mode per reviewer combination.
- Keep review latency deferred until persisted `reviewed_at` exists and is backfilled.
- Publish closure evidence and update `TODO/ROADMAP.md` plus subordinate TODOs to reflect actual shipped state and post-roadmap deferrals.
- Apply locked reviewer modes from DD-02 and store evidence files under DD-05.

## File Impacts For Future Implementation

### Backend

- `src/ado_git_repo_insights/transform/aggregators.py`
- `src/ado_git_repo_insights/transform/csv_generator.py`
- `src/ado_git_repo_insights/transform/schema_versions.py`
- `src/ado_git_repo_insights/cli.py`
- `scripts/generate-synthetic-dataset.py`
- `tests/unit/test_aggregators.py`
- `tests/unit/test_csv_contract.py`
- `tests/unit/test_csv_determinism.py`
- `tests/integration/test_backfill_convergence.py`

### Frontend

- `extension/ui/schemas/rollup.schema.ts`
- `extension/ui/schemas/manifest.schema.ts`
- `extension/ui/dataset-loader.ts`
- `extension/ui/modules/metrics.ts`
- `extension/ui/modules/filters.ts`
- `extension/ui/dashboard.ts`
- `extension/ui/index.html`
- `extension/tests/schema/*.test.ts`
- `extension/tests/modules/*.test.ts`
- `extension/tests/dashboard/*.test.ts`

### Documentation And Governance

- `TODO/ROADMAP.md`
- `TODO/AUTHOR_CONTRIBUTOR_FILTERS.md`
- `TODO/COMMENTS.md`
- `TODO/TEAM_REVIEWER_FILTERS.md`
- `docs/reference/dataset-contract.md`
- `docs/reference/cli-reference.md`
- `docs/user-guide/extension.md`

## Post-Design Constitution Check

| Check | Status | Design Response |
|-------|--------|-----------------|
| Core CSV contract preserved | PASS | Auxiliary outputs separated and guarded by dedicated contract rules |
| Deterministic output preserved | PASS | Deterministic truncation, capability flags, and recomputation guarantees required |
| Identity stability preserved | PASS | Canonical `user_id` keying and explicit fallback rules |
| Backfill convergence preserved | PASS | New outputs defined as pure SQLite-derived projections |
| Scalability preserved | PASS | Bounded cardinality and capability-aware loader behavior mandated |

**Post-Design Result**: PASS. No justified violations required.

## Complexity Tracking

No constitution violations or exceptional complexity justifications are required. The plan intentionally reuses existing aggregation, schema, and dashboard patterns instead of introducing new architectural layers.
