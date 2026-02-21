# Implementation Plan: Realistic Demo Data

**Branch**: `031-realistic-demo-data` | **Date**: 2026-02-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/031-realistic-demo-data/spec.md`

## Summary

Rewrite the demo data generator (`scripts/generate-demo-data.py`) to produce complete, realistic demo data including `by_team_and_repo` cross-dimensional breakdowns. Replace the unstable `lognormvariate` RNG with a locked Box-Muller implementation (Contract 2). Add power-law repo activity, team-repo affinity, year-over-year growth, holiday dips, and cycle time variation by repo category. Create a schema completeness guard test and a Python orchestrator for the three-generator pipeline.

## Technical Context

**Language/Version**: Python 3.12+ (generators, tests), TypeScript 5.x (schema, dashboard — read-only for this feature)
**Primary Dependencies**: Python stdlib only (random, json, math, pathlib) — zero external deps in generators
**Storage**: JSON files in `docs/data/` (260 weekly rollups + distributions + manifest)
**Testing**: pytest (Python tests in `tests/demo/`), vitest (TypeScript tests — existing, not modified)
**Target Platform**: Cross-platform (Windows, Linux, macOS) — binary-mode I/O enforced
**Project Type**: Generator scripts + tests (no `src/` changes, no UI changes)
**Performance Goals**: Full 260-week regeneration < 30s
**Constraints**: Byte-identical output across runs (Contract 2), docs/ < 50 MB (CI cap)
**Scale/Scope**: 23 repos, 4 teams, 50 users, 260 weeks, ~370 output JSON files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| III. Deterministic Output | PASS | Contract 2 (locked RNG) strengthens this |
| IV. PowerBI Frictionless Import | N/A | Demo data is JSON, not CSV |
| VII. No Publish on Failure | PASS | Generator exits non-zero on error |
| QG-04. Deterministic output | PASS | Regeneration determinism test exists (`tests/demo/test_regeneration.py`) |
| QG-25-29. Scalability | N/A | `generate-synthetic-dataset.py` is unchanged per spec assumptions |

No constitution violations. All relevant principles are preserved or strengthened.

## Project Structure

### Documentation (this feature)

```text
specs/031-realistic-demo-data/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: RNG, schema guard, distributions research
├── data-model.md        # Phase 1: Entity definitions, invariants
├── quickstart.md        # Phase 1: How to run and verify
├── checklists/
│   └── requirements.md  # Quality checklist
└── tasks.md             # Phase 2 output (from /speckit.tasks)
```

### Source Code (repository root)

```text
scripts/
├── generate-demo-data.py          # MODIFY: Major rewrite — add by_team_and_repo,
│                                  #   locked RNG, power-law weights, growth, holidays,
│                                  #   team affinity, cycle time categories
├── generate-demo-predictions.py   # MODIFY: Binary-mode I/O (FR-014)
├── generate-demo-insights.py      # MODIFY: Binary-mode I/O (FR-014)
└── regenerate-demo.py             # NEW: Orchestrator (FR-012)

tests/demo/
├── test_regeneration.py           # EXISTING: Determinism tests
├── test_schema_guard.py           # NEW: Schema completeness guard (FR-011)
├── test_realism_invariants.py     # NEW: Frozen demo invariants (FR-004–009)
├── test_cross_dim.py              # NEW: Cross-dimensional completeness (FR-001–003)
└── test_synthetic_data.py         # EXISTING: Synthetic dataset validation

docs/data/
├── dataset-manifest.json          # REGENERATED: schema_version=2, cross_dimensional=true
└── aggregates/weekly_rollups/     # REGENERATED: 260 files with by_team_and_repo
```

**Structure Decision**: No new directories needed. All generator changes are in `scripts/`, all new tests go in `tests/demo/` (existing directory for demo-specific tests). Generated output goes to `docs/data/` (existing).

## Key Implementation Details

### 1. Locked RNG (Contract 2)

Replace `RNG.lognormvariate(mu, sigma)` with `_log_normal(RNG, mu, sigma)` using Box-Muller transform. Only uses `rng.random()`, `math.sqrt`, `math.log`, `math.cos`, `math.pi` — all IEEE 754 deterministic. See research.md Decision 1.

### 2. Cross-Dimensional Generation (Contract 4, FR-001–002)

Port `_largest_remainder_allocate()` from `generate-synthetic-dataset.py`. For each week:
1. Distribute total PRs across repos using power-law weights
2. Distribute total PRs across teams using normalized random weights
3. For each team, distribute team PRs across repos using affinity-weighted allocation
4. Enforce: `sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count`
5. Omit repos with 0 PRs for that team (sparse), include all repos with >= 1 PR (complete)

### 3. Realistic Distributions (Contract 5)

- **Power-law repo weights**: Fixed per-repo constants, top 3 get >= 40% share
- **Year-over-year growth**: `growth_factor = 1.0 + 0.12 * (year - 2021)`
- **Holiday suppression**: Week 52 multiplied by 0.35
- **Team-repo affinity**: 65% of team PRs to primary repos, 35% to others
- **Cycle time categories**: mu_factor varies by repo type (0.5 for utility, 1.3 for data/ML)
- **Idle repo-weeks**: Low-weight repos naturally produce 0 PRs in many weeks

### 4. Schema Completeness Guard (Contract 1, FR-011)

Test reads `KNOWN_ROOT_FIELDS` and `KNOWN_BREAKDOWN_FIELDS` from `rollup.schema.ts` via regex. Compares against generated demo rollup. Fails if any non-deprecated field is missing. See research.md Decision 2.

### 5. Manifest Updates (FR-010, FR-018)

- Import `AGGREGATES_SCHEMA_VERSION` from `aggregators.py` (value: 2)
- Add `features.cross_dimensional: true`
- Keep existing prediction/insights flag workflow

### 6. File I/O Standardization (FR-014)

All three generators use `path.write_bytes(content.encode("utf-8"))`. Update predictions (line 101) and insights (line 122) generators.

### 7. Orchestrator (FR-012)

New `scripts/regenerate-demo.py` calls all three generators' `main()` in sequence. Cross-platform (Python, not shell). See research.md Decision 8.

## Files Modified

| File | Change | FRs |
|------|--------|-----|
| `scripts/generate-demo-data.py` | Major rewrite: locked RNG, power-law weights, growth, holidays, team affinity, cycle time categories, by_team_and_repo generation, manifest version 2 | FR-001–009, FR-013–018 |
| `scripts/generate-demo-predictions.py` | Binary-mode file I/O | FR-014 |
| `scripts/generate-demo-insights.py` | Binary-mode file I/O | FR-014 |
| `scripts/regenerate-demo.py` | New orchestrator | FR-012 |
| `tests/demo/test_schema_guard.py` | New schema completeness guard test | FR-011 |
| `tests/demo/test_realism_invariants.py` | New frozen demo invariant tests | FR-004–009, FR-015 |
| `tests/demo/test_cross_dim.py` | New cross-dimensional completeness tests | FR-001–003, FR-016 |
| `docs/data/**/*.json` | Regenerated (all 260+ files) | All |

## Complexity Tracking

No constitution violations to justify. All changes use existing patterns (Python scripts, pytest tests, JSON output). No new dependencies, no new directories, no architectural changes.
