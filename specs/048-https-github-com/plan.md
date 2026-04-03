# Implementation Plan: QG-40 Eliminate typing.Any in src/

**Branch**: `048-https-github-com` | **Date**: 2026-04-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/048-https-github-com/spec.md`

## Current State (as of 2026-04-02)

**Progress**: 54 of 100 `Any` tokens eliminated (54%). 9 of 10 files at zero.
**Baseline**: 46 remaining, all in `aggregators.py`.
**Tests**: 1362 passing (5 new: 12 scanner validation + 5 conformance). mypy clean on full surface.

| Batch | Files | Tokens | Status | Baseline After |
|-------|-------|:------:|--------|:--------------:|
| Setup (T001-T003) | types.py, scanner test | 0 | **Done** | 100 |
| P1 Quick Wins (T004-T008) | config, run_summary, database, logging_config | 12 | **Done** | 88 |
| P2 API Client (T009-T011) | ado_client | 11 | **Done** | 77 |
| P4 Persistence (T019-T021) | repository | 5 | **Done** (pulled into P2 batch) | 72 |
| P3 ML Layer (T012-T018) | forecaster, fallback_forecaster, insights | 26 | **Done** | 46 |
| P5a CSV Exports (T022-T025) | aggregators (Dimensions, _build_dimensions) | ~12 | **Next** | — |
| P5b Rollups (T026-T028) | aggregators (slice methods, weekly rollups) | ~20 | Pending | — |
| P5c Manifest (T029-T032) | aggregators (manifest, distributions, utilities) | ~14 | Pending | — |
| Polish (T033-T036) | Full preflight, quickstart validation | 0 | Pending | 0 |

### Key Decisions Made During Implementation

1. **config.py** used `dict[str, object]` with inline narrowing helpers (`_sub`, `_str`, `_float`, `_int`, `_bool`) rather than a TypedDict — YAML deserialization returns untyped data that's validated procedurally.
2. **run_summary.py** got a full `RunSummaryDict` TypedDict (with nested `RunCountsDict`, `RunTimingsDict`) instead of `JSONValue` — cleaner for downstream consumers that index specific keys.
3. **ForecastValue** uses `NotRequired[list[str]]` for `constraints_applied` instead of separate `ForecastValueWithConstraints` subclass — avoids list invariance issues when both forecasters share `MetricForecastDict`.
4. **MetricForecastDict** TypedDict mirrors the `MetricForecast` dataclass shape for JSON serialization; the legacy `ForecastValue` dataclass in forecaster.py was renamed to `_ForecastValueLegacy` (never instantiated, dead code).
5. **insights.py** uses `dict[str, JSONValue]` throughout — the insight shapes are validated at runtime in `_validate_and_fix_insights`, so compile-time TypedDicts would over-specify.
6. **repository.py** uses `cast(TeamRow, dict(row))` at the sqlite3 boundary — `dict(sqlite3.Row)` returns `dict[Any, Any]` from typeshed.
7. **P4 was pulled into P2** — `repository.py` parameter types depend on `AdoPullRequest` from `ado_client.py`; mypy forced the change.
8. **`NotRequired`** imported via version guard: `typing` on 3.11+, `typing_extensions` on 3.10.

### Files Modified (complete list)

**New files:**
- `src/ado_git_repo_insights/types.py` — shared types module (JSONValue, SqliteParam, RunSummaryDict, 8 ADO TypedDicts, 2 DB row TypedDicts, ForecastValue, MetricForecastDict)
- `tests/unit/test_any_type_scanner.py` — 12 tests (FR-011 scanner validation + FR-012 identifier check)
- `tests/unit/test_forecast_conformance.py` — 5 tests (FR-006 forecast type conformance)

**Modified src/ files (Any eliminated):**
- `src/.../config.py` — 2→0 tokens
- `src/.../utils/run_summary.py` — 2→0 tokens
- `src/.../persistence/database.py` — 3→0 tokens
- `src/.../utils/logging_config.py` — 5→0 tokens
- `src/.../extractor/ado_client.py` — 11→0 tokens
- `src/.../persistence/repository.py` — 5→0 tokens
- `src/.../ml/forecaster.py` — 6→0 tokens
- `src/.../ml/fallback_forecaster.py` — 7→0 tokens
- `src/.../ml/insights.py` — 13→0 tokens

**Modified test files (type narrowing for stricter signatures):**
- `tests/unit/test_insights_enhanced.py` — JSONValue annotations for sort_insights calls
- `tests/performance/test_chart_render.py` — JSONValue annotation for sort_insights call

**Modified baseline:**
- `.any-type-baseline.json` — 100→46 (1 file remaining)

### Remaining Work (aggregators.py — 46 tokens)

The remaining 46 tokens are in `src/ado_git_repo_insights/transform/aggregators.py`, split into three sub-batches by output contract:

- **P5a (T022-T025)**: Dimensions dataclass fields + `_build_dimensions` conversion functions (~12 tokens)
- **P5b (T026-T028)**: Slice methods + `_generate_weekly_rollups` + AggregateIndex (~20 tokens)
- **P5c (T029-T032)**: DatasetManifest fields + distributions + `_write_json` + `generate()` (~14 tokens)

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
| QG-17 | Lint + format pass | SATISFIED | ruff passes on all modified files |
| QG-18 | Type checking passes | SATISFIED | mypy strict clean on 161 files |
| QG-19 | Unit + integration tests pass | SATISFIED | 1362 tests passing |
| QG-35 | Every CI check has local equivalent | SATISFIED | Scanner in preflight + CI |
| QG-36 | No weaker local mode | SATISFIED | Identical full-tree scanner mode |
| QG-37 | New CI checks require local gate | N/A | No new CI checks |
| QG-38 | --no-verify forbidden | SATISFIED | Project policy |
| QG-39 | Cross-OS compatibility | SATISFIED | Type annotations only |
| QG-40 | No typing.Any | IN PROGRESS | 46/100 remaining (aggregators.py) |
| QG-41 | Zero inline suppressions | SATISFIED | No new type:ignore added |
| QG-42 | Enterprise test coverage | SATISFIED | 17 new tests (12 scanner + 5 conformance) |

## Project Structure

### Documentation (this feature)

```text
specs/048-https-github-com/
├── plan.md              # This file
├── spec.md              # Feature specification (3 review rounds)
├── research.md          # Phase 0 output (10 research decisions)
├── data-model.md        # Phase 1 output (~40 TypedDict definitions)
├── quickstart.md        # Phase 1 output (workflow guide)
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16 pass)
└── tasks.md             # Task list (22/36 complete)
```

### Source Code (repository root)

```text
src/ado_git_repo_insights/
├── types.py                    # NEW: Shared types module — DONE
├── config.py                   # P1 — DONE (0 Any)
├── utils/
│   ├── run_summary.py          # P1 — DONE (0 Any)
│   └── logging_config.py       # P1 — DONE (0 Any)
├── persistence/
│   ├── database.py             # P1 — DONE (0 Any)
│   └── repository.py           # P4 — DONE (0 Any)
├── extractor/
│   └── ado_client.py           # P2 — DONE (0 Any)
├── ml/
│   ├── forecaster.py           # P3 — DONE (0 Any)
│   ├── fallback_forecaster.py  # P3 — DONE (0 Any)
│   └── insights.py             # P3 — DONE (0 Any)
└── transform/
    └── aggregators.py          # P5a/b/c — 46 Any REMAINING

tests/
├── unit/
│   ├── test_any_type_scanner.py    # NEW — DONE (12 tests)
│   └── test_forecast_conformance.py # NEW — DONE (5 tests)
└── ...existing tests unchanged...

.any-type-baseline.json             # 46 total, 1 file
```

**Structure Decision**: Single new file (`types.py`) at package root. All TypedDicts centralized per FR-013. No new packages or directories. Test files added to existing `tests/unit/`.
