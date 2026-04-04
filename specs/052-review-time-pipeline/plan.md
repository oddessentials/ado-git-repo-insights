# Implementation Plan: Review Time Pipeline (P50/P90 Metrics)

**Branch**: `052-review-time-pipeline` | **Date**: 2026-04-04 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/052-review-time-pipeline/spec.md`

## Summary

Enable review_time_p50/p90 metrics on the dashboard by building the data pipeline from ADO API thread extraction through SQLite persistence, pandas aggregation, and JSON rollup output. The TypeScript UI is already complete (forward-compatible since PR #220); this feature populates the data. Spike confirmed ADO system thread comments reliably contain vote timestamps with reviewer identity mapping.

## Technical Context

**Language/Version**: Python 3.12+ (backend pipeline), TypeScript 6.x (extension UI — contract activation test)
**Primary Dependencies**: pandas (aggregation), requests (ADO API client), sqlite3 (persistence), pytest (testing), Jest (contract activation)
**Storage**: SQLite (source of truth per Constitution Principle V), JSON rollup files (aggregation output)
**Testing**: pytest (Python), Jest (TypeScript — contract activation test for review_time card visibility)
**Target Platform**: Windows, macOS, Linux (QG-39)
**Project Type**: CLI tool + Azure DevOps extension
**Performance Goals**: Aggregation within 30-second budget (SC-004), rollup files within 500KB (SC-005)
**Constraints**: Zero suppressions (QG-41), no typing.Any (QG-40), CSV contract unchanged (Constitution I-IV)
**Scale/Scope**: 260-week demo dataset, production datasets up to 520 weeks, 200+ reviewers

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Check

| Gate | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| QG-01–04 | CSV schema unchanged | PASS | FR-016: review_time_minutes is DB-internal only, CSV_SCHEMAS untouched |
| QG-05 | Golden fixture compatibility | PASS | Golden fixtures will be updated with review_time fields |
| QG-06–08 | Persistence safety | PASS | Schema migration is non-destructive (ALTER TABLE ADD COLUMN with NULL default) |
| QG-09–12 | Extraction safety | PASS | Vote extraction piggybacks on existing thread/comment pipeline |
| QG-13–14 | Identity/scoping | PASS | reviewer.user_id = thread comment author.id (validated in spike) |
| QG-17–20 | Release gates | PASS | All new code goes through ruff, mypy, pytest, coverage |
| QG-25–27 | Scalability | PASS | Synthetic data updated to include review_time (FR-010, FR-017) |
| QG-30–34 | Demo parity | PASS | FR-017 mandates full demo regeneration; FR-019 enforces deterministic CI verification |
| QG-35–38 | Local/CI parity | PASS | FR-019 ensures committed artifacts match generated output in CI |
| QG-39 | Cross-OS | PASS | FR-014 mandates; all changes are Python/SQL, no OS-specific paths |
| QG-40 | No typing.Any | PASS | All new types use `float | None`, `str | None`, precise TypedDicts |
| QG-41 | Zero suppressions | PASS | SC-008 mandates; no suppressions planned |
| QG-42 | Enterprise test coverage | PASS | SC-009 mandates; 2 new Python test modules + 1 new Jest contract activation test + existing test updates |

### Post-Design Check

| Gate | Status | Notes |
|------|--------|-------|
| QG-01–04 CSV | PASS | data-model.md confirms CSV contract unchanged |
| QG-05 Golden | PASS | FR-019 enforces deterministic verification of committed golden/demo artifacts |
| QG-30–34 Demo | PASS | FR-017 regen + FR-019 CI freshness enforcement + FR-020 extension contract test |
| QG-35–38 Parity | PASS | FR-019 closes local/CI drift on demo artifacts; no new CI-only gates |

**No violations. No complexity tracking needed.**

## Project Structure

### Documentation (this feature)

```text
specs/052-review-time-pipeline/
├── plan.md                          # This file
├── spec.md                          # Feature specification (post-review)
├── research.md                      # Phase 0 research decisions
├── data-model.md                    # Phase 1 entity model
├── quickstart.md                    # Implementation guide
├── spike-ado-vote-timestamps.md     # ADO API spike evidence
├── checklists/
│   └── requirements.md              # Spec quality checklist
└── contracts/
    └── rollup-json-contract.md      # Rollup JSON additions
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── persistence/
│   ├── models.py              # SCHEMA_SQL: add reviewed_at + review_time_minutes columns
│   ├── database.py            # Hook _apply_migrations() into connect()
│   ├── migrations.py          # NEW: version-keyed migration functions (v1→v2)
│   └── repository.py          # Extend upsert_reviewer() with reviewed_at param
├── extractor/
│   └── ado_client.py          # No changes (get_pr_threads() already exists)
├── transform/
│   ├── aggregators.py         # WeeklyRollup fields + SQL query + 6 slice methods
│   └── schema_versions.py     # Bump AGGREGATES_SCHEMA_VERSION
├── utils/
│   └── datetime_utils.py      # Add calculate_review_time_minutes()
├── types.py                   # SliceMetrics: add review_time_p50/p90
└── cli.py                     # Call _populate_review_timestamps() after comment extraction; warn when --include-comments absent (FR-018)

scripts/
├── generate-demo-data.py      # Update local WeeklyRollup + SliceMetrics + generation logic
└── generate-synthetic-dataset.py  # Add review_time population logic

tests/
├── unit/
│   ├── test_schema_migration.py       # NEW: migration v1→v2, idempotency, fresh install
│   ├── test_review_time_extraction.py # NEW: vote parsing, reviewer matching, edge cases
│   ├── test_aggregators.py            # Add review_time to existing tests
│   └── test_schema_parity.py          # Remove from TS_ONLY_FORWARD_COMPAT_FIELDS
└── demo/
    ├── test_schema_guard.py           # Remove from DEPRECATED_FIELDS
    └── test_synthetic_data.py         # Add to required field list

extension/tests/
└── modules/
    └── review-time-contract.test.ts   # NEW: FR-020 contract activation test (card show/hide with real rollup data)

docs/data/aggregates/weekly_rollups/   # 260 files regenerated with review_time fields (FR-019: CI-verified freshness)
```

**Structure Decision**: Single-project layout (Python backend + TypeScript extension). All changes are in existing directories. New files: `persistence/migrations.py` (Python), `review-time-contract.test.ts` (Jest).
