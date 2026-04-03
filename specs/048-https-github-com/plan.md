# Implementation Plan: QG-40 Eliminate typing.Any in src/

**Branch**: `048-https-github-com` | **Date**: 2026-04-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/048-https-github-com/spec.md`

## Summary

Replace all 100 `typing.Any` tokens across 10 files in `src/` with precise types (TypedDicts, explicit unions, recursive type aliases). Create a new shared types module (`src/ado_git_repo_insights/types.py`) housing all type definitions. Work is batched by dependency chain: quick wins (P1, 12 tokens), API client (P2, 11), ML layer (P3, 26), persistence (P4, 5), aggregators (P5a/b/c, 46). Each batch ratchets the baseline to zero for its files. Scanner validation test (FR-011) runs first to confirm the ratchet mechanism is trustworthy.

## Technical Context

**Language/Version**: Python 3.10+ (project minimum), developed on 3.14. mypy strict mode on `src/` with `disallow_any_generics = true`.
**Primary Dependencies**: stdlib only for type changes. mypy 1.20.x (type checking), ruff 0.15.x (linting), pytest 9.x (testing).
**Storage**: N/A (no storage changes)
**Testing**: pytest (Python), Jest (TypeScript — unaffected). Scanner: `scripts/check_no_any_types.py` (token-based, `tokenize` module).
**Target Platform**: Windows, macOS, Linux (QG-39).
**Project Type**: Python library + Azure DevOps extension.
**Performance Goals**: N/A (type annotations only, zero runtime impact).
**Constraints**: Zero new `# type: ignore` suppressions (QG-41). Zero test regressions (FR-003). Full typecheck surface must pass after each batch (FR-004).
**Scale/Scope**: 100 tokens across 10 files. ~40 new TypedDict definitions in one shared module.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| QG-17 | Lint + format pass | WILL SATISFY | ruff checks run in preflight; new types.py will conform |
| QG-18 | Type checking passes | WILL SATISFY | mypy strict on full surface after each batch (FR-004) |
| QG-19 | Unit + integration tests pass | WILL SATISFY | Zero regressions required (FR-003) |
| QG-35 | Every CI check has local equivalent | SATISFIED | Any-type scanner already in preflight (run_pr_preflight.py line 172) and CI (ci.yml line 629) |
| QG-36 | No weaker local mode | SATISFIED | Scanner runs identical full-tree mode locally and in CI |
| QG-37 | New CI checks require local gate | N/A | No new CI checks added |
| QG-38 | --no-verify forbidden | SATISFIED | Project policy, not affected by this feature |
| QG-39 | Cross-OS compatibility | WILL SATISFY | Type annotations only; no platform-specific behavior (FR-010) |
| QG-40 | No typing.Any | WILL SATISFY | This IS the feature — target: 0 tokens in src/ (FR-008) |
| QG-41 | Zero inline suppressions | WILL SATISFY | No new `# type: ignore` permitted (FR-009) |
| QG-42 | Enterprise test coverage | WILL SATISFY | Scanner validation test (FR-011), forecast conformance test (FR-006), per-file ceiling tests (FR-002) |

**No violations. All gates will be satisfied upon completion.**

### Post-Design Re-check

| Gate | Status | Notes |
|------|--------|-------|
| QG-17 | CONFIRMED | types.py follows existing code style; ruff will enforce |
| QG-18 | CONFIRMED | All TypedDicts designed from actual field types in codebase; mypy strict will validate |
| QG-19 | CONFIRMED | No behavioral changes; only type annotations modified |
| QG-40 | CONFIRMED | 100 tokens mapped to 40+ TypedDicts + 2 type aliases (JSONValue, SqliteParam) |
| QG-41 | CONFIRMED | No suppressions needed — all types derived from concrete analysis |
| QG-42 | CONFIRMED | FR-011 scanner test, FR-006 conformance test, FR-002 per-file ceiling checks defined |

## Project Structure

### Documentation (this feature)

```text
specs/048-https-github-com/
├── plan.md              # This file
├── research.md          # Phase 0 output (10 research decisions)
├── data-model.md        # Phase 1 output (~40 TypedDict definitions)
├── quickstart.md        # Phase 1 output (workflow guide)
└── tasks.md             # Phase 2 output (not yet created)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── types.py                    # NEW: Shared types module (JSONValue, SqliteParam, all TypedDicts)
├── config.py                   # P1: Replace 1 Any annotation (dict[str, object])
├── utils/
│   ├── run_summary.py          # P1: Replace 1 Any annotation (RunSummaryDict)
│   └── logging_config.py       # P1: Replace 4 Any annotations (JSONValue recursive alias)
├── persistence/
│   ├── database.py             # P1: Replace 2 Any annotations (SqliteParam)
│   └── repository.py           # P4: Replace 4 Any annotations (Ado* types, row TypedDicts)
├── extractor/
│   └── ado_client.py           # P2: Replace 10 Any annotations (Ado* TypedDicts)
├── ml/
│   ├── forecaster.py           # P3: Replace 5 Any annotations (ForecastValue, MetricForecast)
│   ├── fallback_forecaster.py  # P3: Replace 6 Any annotations (ForecastValueWithConstraints)
│   └── insights.py             # P3: Replace 12 Any annotations (InsightObject, PRStats, etc.)
└── transform/
    └── aggregators.py          # P5a/b/c: Replace 45 Any annotations (*Record, *Metrics, manifest)

tests/
├── unit/
│   └── test_any_type_scanner.py    # NEW: FR-011 scanner validation test
│   └── test_forecast_conformance.py # NEW: FR-006 forecast conformance test
└── ...existing tests unchanged...

.any-type-baseline.json             # Updated after each batch (ratchet down)
```

**Structure Decision**: Single new file (`types.py`) at package root. All TypedDicts centralized per FR-013. No new packages or directories. Test files added to existing `tests/unit/`.
