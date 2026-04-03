# Feature Specification: QG-40 Eliminate typing.Any in src/

**Feature Branch**: `048-https-github-com`
**Created**: 2026-04-02
**Status**: Draft
**Input**: User description: "QG-40: Eliminate typing.Any usages in src/ — ratchet down remaining 100 violations across 10 files"
**Issue**: [#235](https://github.com/oddessentials/ado-git-repo-insights/issues/235)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ratchet Quick-Win Files to Zero (Priority: P1)

A maintainer eliminates all `typing.Any` from the four simplest files — `config.py` (2), `run_summary.py` (2), `database.py` (3), and `logging_config.py` (5) — totalling 12 usages. Each file's count includes its import statement, so reaching zero also requires removing the `from typing import Any` import once all annotations in that file are replaced. After each file reaches zero, the ratchet baseline is updated to lock in the gain.

These four files represent three distinct replacement categories:

- **`config.py`** (2): One import, one annotation on a raw YAML config dict. The config structure has known keys validated immediately after load.
- **`run_summary.py`** (2): One import, one `to_dict()` return type. The return shape is fully defined by the `RunSummary` dataclass fields.
- **`database.py`** (3): One import, two sqlite3 parameter annotations (`tuple[Any, ...]` in `execute` and `list[tuple[Any, ...]]` in `executemany`). These represent SQL bind parameters. The replacement MUST use an explicit allowed parameter union (e.g., `str | int | float | bytes | None`) matching sqlite3's accepted types on Python 3.10+. `object` MUST NOT be used here — it would erase runtime type safety and allow values sqlite3 would reject.
- **`logging_config.py`** (5): One import, four annotations. Three are in the recursive `_redact_dict` method (parameter, return, local variable), one is a log-entry dict in `emit`. All three `_redact_dict` positions MUST use the same recursive type alias (e.g., `JSONValue = str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]`). This alias MUST be defined once in a shared module and imported — not redefined locally in each file that needs it (logging, aggregators, etc.). Local redefinitions are forbidden to prevent drift. Partial replacement — typing only the parameter but not the return or local variable — will fail strict mode because the recursive call's return type won't match.

**Why this priority**: Fewest usages per file, simplest replacement patterns. Completing them validates the ratchet workflow and demonstrates that the scanner correctly reports zero after replacements before tackling larger files.

**Independent Test**: Each file independently passes the type checker and ratchet scanner at zero. All existing tests for configuration loading, run summary serialization, database operations, and log redaction continue to pass.

**Acceptance Scenarios**:

1. **Given** `config.py` has 2 `Any` tokens (1 import + 1 annotation), **When** the annotation is replaced and the import removed, **Then** the ratchet scanner reports 0 for this file, the type checker passes across the full surface (`src/ tests/ scripts/`), and configuration loading tests pass.
2. **Given** `run_summary.py` has 2 `Any` tokens (1 import + 1 annotation), **When** the annotation is replaced and the import removed, **Then** the ratchet scanner reports 0 for this file and run summary tests pass.
3. **Given** `database.py` has 3 `Any` tokens (1 import + 2 annotations on sqlite3 param tuples), **When** the annotations are replaced and the import removed, **Then** the ratchet scanner reports 0 and all database operation tests pass.
4. **Given** `logging_config.py` has 5 `Any` tokens (1 import + 4 annotations including recursive `_redact_dict`), **When** the annotations are replaced with a recursive type alias and the import removed, **Then** the ratchet scanner reports 0 and log redaction tests pass.
5. **Given** all four files are fixed, **When** the baseline is regenerated via `--update-baseline`, **Then** the total ceiling drops from 100 to 88 and per-file ceilings for all four files are 0.

---

### User Story 2 - Type the API Client Layer (Priority: P2)

A maintainer eliminates all 11 `Any` tokens in `ado_client.py` (1 import + 10 annotations). This file is the boundary where Azure DevOps REST API JSON enters the system. Every method that calls the API and returns data uses `dict[str, Any]` or `list[dict[str, Any]]` — specifically `fetch_prs_for_date_range`, `_fetch_prs_for_date_paginated`, `_fetch_page`, `get_teams`, `get_team_members`, and `get_pr_threads`. Each API entity (pull request, team, team member, thread) has a documented response shape in the Azure DevOps API.

All API return types MUST be validated and normalized into typed structures before returning to callers. Raw HTTP response dicts MUST NOT be exposed directly — the client must parse the JSON into typed structures at the boundary, so downstream consumers never handle unvalidated data. This prevents unsound widening where a typed dict annotation trusts the API without verification.

**Why this priority**: The API client is the entry point for all external data. Validating and normalizing at the boundary means every downstream consumer (repository, aggregators) inherits verified type safety, not just annotated trust. Mock responses in existing tests already conform to these shapes.

**Independent Test**: The type checker passes across the full surface and all extraction tests (unit and integration) pass. The ratchet scanner reports 0 for this file.

**Acceptance Scenarios**:

1. **Given** `ado_client.py` has 11 `Any` tokens across 6 API methods, **When** precise types are defined for each ADO entity, API methods validate/normalize JSON into typed structures before returning, and the import is removed, **Then** the ratchet scanner reports 0 for this file and all extraction tests pass.
2. **Given** the baseline ceiling for `ado_client.py` is 11, **When** the baseline is regenerated, **Then** it drops to 0 and the total drops to 77.

---

### User Story 3 - Type the ML/Forecasting Layer (Priority: P3)

A maintainer eliminates all 26 `Any` tokens across three ML files: `forecaster.py` (6 = 1 import + 5 annotations), `fallback_forecaster.py` (7 = 1 import + 6 annotations), and `insights.py` (13 = 1 import + 12 annotations).

The two forecasters produce compatible output (same schema version). `forecaster.py` uses Prophet, `fallback_forecaster.py` uses linear regression, but both emit the same forecast structure: metric name, unit, horizon, and a list of prediction values with bounds and constraints. `forecaster.py` already has a `MetricForecast` dataclass with a `values: list[dict[str, Any]]` field — this is the natural home for a shared forecast value type. The shared type MUST be adopted at every usage site in both files: the `MetricForecast.values` dataclass field, all intermediate `values` and `forecasts` local variables, all `_forecast_metric` return types, and all `_write_predictions` parameters. Partial adoption — typing the dataclass field but leaving intermediates as `dict[str, Any]` — will either fail strict mode or silently widen at assignment boundaries.

`insights.py` interfaces with OpenAI and manages an insight cache. Its `_validate_and_fix_insights` method already enforces a strict schema (required fields: id, category, severity, title, description) — the type definitions should match this existing validation contract.

**Why this priority**: The forecast and insight structures are well-defined by their existing validation code. The two forecasters sharing a type at every usage site ensures output compatibility is enforced at compile time rather than only at runtime.

**Independent Test**: The type checker passes across the full surface. All forecast generation tests and insight validation tests pass. The ratchet scanner reports 0 for all three files.

**Acceptance Scenarios**:

1. **Given** `forecaster.py` and `fallback_forecaster.py` produce the same forecast schema, **When** a shared type is defined for forecast values and both files adopt it, **Then** both files report 0 `Any` tokens and all forecast tests pass.
2. **Given** `insights.py` has 13 `Any` tokens including OpenAI response handling and cache I/O, **When** precise types are defined matching the existing validation contract, **Then** the scanner reports 0 and insight tests pass.
3. **Given** all three ML files are fixed, **When** the baseline is regenerated, **Then** per-file ceilings are 0 and the total drops to 51.

---

### User Story 4 - Type the Persistence Layer (Priority: P4)

A maintainer eliminates all 5 `Any` tokens in `repository.py` (1 import + 4 annotations). Two annotations are on parameters receiving raw ADO API data (`upsert_pr` and `upsert_pr_with_related`), and two are on return types for database query results (`get_teams_for_project` and `get_team_members`). The parameter types depend on the types defined for the API client (User Story 2), and the return types represent known database row shapes.

**Why this priority**: This file bridges the API client (P2) and the aggregators (P5). Typing it after the API client means the input types are already defined. Typing it before aggregators means the aggregator input types flow naturally.

**Independent Test**: The type checker passes across the full surface and all repository/persistence tests pass. The ratchet scanner reports 0 for this file.

**Acceptance Scenarios**:

1. **Given** `repository.py` has 5 `Any` tokens (2 API-data parameters, 2 query-result returns, 1 import), **When** the API-data parameters adopt the types from P2 and query-result types are defined, **Then** the scanner reports 0 and persistence tests pass.
2. **Given** the baseline ceiling for `repository.py` is 5, **When** the baseline is regenerated, **Then** it drops to 0 and the total drops to 46.

---

### User Story 5 - Type the Aggregators: CSV Entity Exports (Priority: P5a)

A maintainer eliminates the `Any` tokens in `aggregators.py` that relate to the `Dimensions` dataclass and the `_build_dimensions` method. The `Dimensions` dataclass has 6 fields (`repositories`, `users`, `authors`, `reviewers`, `projects`, `teams`) each typed `list[dict[str, Any]]`. The `_build_dimensions` method has 6 matching local variables that convert pandas DataFrames to these lists via `to_dict(orient="records")`. These 12 annotations all represent entity records whose schemas are governed by the CSV contract (QG-01 through QG-05).

The pandas conversion is a critical narrowing point: `pandas.DataFrame.to_dict(orient="records")` returns `list[dict[str, Any]]`. Each entity MUST have a dedicated conversion function (e.g., `to_repository_record(row) -> RepositoryRecord`) that validates and narrows a single pandas row dict into its typed structure. The `_build_dimensions` comprehensions MUST call these functions — not perform inline narrowing, which is unenforceable at review time and brittle under refactoring. Propagating `dict[str, object]` through the dataclass fields would fail strict mode at every downstream access.

**Why this priority**: CSV entity exports are the highest-risk output contract — breaking changes block PowerBI imports. They have the most mature test coverage (CSV contract tests), making them the safest aggregator sub-batch.

**Independent Test**: The type checker passes and all CSV contract tests and entity export tests pass. The ratchet baseline for `aggregators.py` decreases.

**Acceptance Scenarios**:

1. **Given** the `Dimensions` dataclass and `_build_dimensions` method use `Any` for entity records, **When** precise types are defined for each entity (repository, user, author, reviewer, project, team) and pandas `to_dict` output is narrowed to typed structures at the comprehension boundary, **Then** the type checker passes under strict mode and CSV contract tests pass.

---

### User Story 6 - Type the Aggregators: Weekly Rollups and Slice Methods (Priority: P5b)

A maintainer eliminates the `Any` tokens in the slice generation methods (`_generate_author_slice`, `_generate_author_repo_slice`, `_generate_repo_slice`, `_generate_team_slice`, `_generate_reviewer_slice`, `_generate_team_repo_slice`) and the `_generate_weekly_rollups` method. These methods produce the dashboard JSON consumed by the TypeScript extension. Each slice method returns a `dict[str, Any]` and uses `dict[str, Any]` local variables for building per-dimension metric breakdowns. The `AggregateIndex.weekly_rollups` field also uses `list[dict[str, Any]]`.

**Why this priority**: Dashboard JSON is the second output contract. The slice methods all follow the same structural pattern (metrics dict keyed by dimension value), so a shared type can cover all of them.

**Independent Test**: The type checker passes and dashboard data tests pass. The ratchet baseline for `aggregators.py` decreases further.

**Acceptance Scenarios**:

1. **Given** 6 slice generation methods and the weekly rollups generator use `Any` for metric structures, **When** precise types are defined for rollup and slice shapes, **Then** the type checker passes and dashboard data tests pass.

---

### User Story 7 - Type the Aggregators: Manifest, Distributions, and Utilities (Priority: P5c)

A maintainer eliminates the remaining `Any` tokens in `aggregators.py` — the `DatasetManifest` dataclass fields (4: `defaults`, `limits`, `capabilities`, `coverage`), the `_generate_distributions` method and its index, the `_get_capabilities` and `_get_comments_coverage` methods, the `_get_operational_summary` method, the `_write_json` utility, and the two `generate()` method return types. This is the final sub-batch that brings `aggregators.py` and the overall total to zero.

**Why this priority**: These are the least coupled output shapes. The `_write_json` method is a generic JSON writer — its `data: dict[str, Any]` parameter MUST be replaced with a JSON-compatible recursive type alias (same one used for `_redact_dict` in P1), not `dict[str, object]`. Using `object` would force every caller to cast, reintroducing unsafe patterns or creating pressure to bring back `Any`. Completing this sub-batch brings the project to zero.

**Independent Test**: The type checker passes and all manifest, distribution, and generation tests pass. The ratchet scanner reports 0 for `aggregators.py` and 0 total.

**Acceptance Scenarios**:

1. **Given** `aggregators.py` has remaining `Any` tokens in manifest, distribution, capability, and utility methods, **When** precise types are defined and the import is removed, **Then** the scanner reports 0 for this file.
2. **Given** all 100 `Any` tokens across all 10 files are eliminated, **When** the ratchet scanner runs, **Then** the total is 0 and QG-40 is fully satisfied for `src/`.

---

### Edge Cases

- What happens when a replacement type is too narrow and rejects valid data from an external API with undocumented optional fields? Types at API boundaries must accommodate optional fields without using `Any`. The API client must validate/normalize before returning, so undocumented fields are either preserved via explicit optional fields or dropped at the boundary — not silently trusted.
- How does the scanner handle files that no longer import `Any`? The scanner counts `Any` NAME tokens — removing the import removes one count. A file with zero annotations but a leftover import still reports 1.
- What if `_redact_dict` is only partially typed (e.g., parameter replaced but return left as implicit)? Strict mode will reject the mismatch. All three positions (parameter, return, local variable) MUST use the same recursive type alias in a single atomic change.
- What happens when sqlite3 parameter types change across Python versions? The explicit union MUST cover the types accepted by sqlite3 on Python 3.10+ (the project minimum). Using `object` would silently accept values sqlite3 rejects at runtime.
- What if pandas `to_dict(orient="records")` return type doesn't match the replacement? Pandas returns `list[dict[str, Any]]`. Dedicated per-entity conversion functions narrow each row into its typed structure. Inline comprehension narrowing is not enforceable at review time.
- What if `_write_json` uses `dict[str, object]` instead of a JSON-compatible recursive type? Every caller would need an unsafe cast to pass its typed data, creating pressure to reintroduce `Any`. A shared JSON type alias avoids this.
- What if the two forecasters silently drift apart in output schema? A shared named type with a conformance test catches this at compile time and test time, not in production.
- What if the shared forecast type is adopted in the dataclass field but not in intermediate variables? Strict mode may not catch the mismatch if the intermediate is assigned to a wider type. The type MUST be used at every site: dataclass field, intermediates, return types, and parameters.
- What if a variable or function is named `Any` in `src/`? The token-based scanner would count it as a false positive, blocking the ratchet from reaching zero. FR-012 bans this identifier to close the vector.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every `typing.Any` token in `src/` MUST be replaced with a precise type — either a named data structure, an explicit union of concrete types, or `object` where the value is truly unconstrained. The count includes import statements; each file's `from typing import Any` MUST be removed once all annotations are replaced.
- **FR-002**: The ratchet baseline (`.any-type-baseline.json`) MUST be updated after each batch to reflect reduced per-file ceilings. No file ceiling may increase. Updates MUST use `--update-baseline` (full-tree mode only). After each batch, a test MUST verify per-file ceilings for every file touched in that batch are exactly 0 — not just that the total decreased. This prevents partial batches from silently leaving files above zero.
- **FR-003**: All existing tests (unit, integration, contract, demo) MUST continue to pass after each batch. Zero test regressions.
- **FR-004**: The strict type checker MUST pass across the entire repo typecheck surface (`src/`, `tests/`, `scripts/`) after each batch. This is the same scope run by both local preflight and CI.
- **FR-005**: Data at external system boundaries (REST API, OpenAI, sqlite3, YAML) MUST be validated and normalized into typed structures before being returned to callers. Raw response dicts MUST NOT be exposed with typed annotations that trust unverified data. Typed structures MUST accommodate optional and nullable fields without using `Any`.
- **FR-006**: The two forecaster implementations MUST share a single named type (e.g., `ForecastValue`) for forecast output, used in both `forecaster.py` and `fallback_forecaster.py`. A test MUST validate that both implementations produce values conforming to this type, preventing silent schema drift between the Prophet and linear-regression paths.
- **FR-007**: Data structure definitions for CSV/JSON export MUST be consistent with the existing CSV contract tests (QG-01 through QG-05) and dashboard rendering expectations.
- **FR-008**: The ratchet scanner total MUST reach 0 for `src/` upon completion of all batches.
- **FR-009**: No new inline suppression comments (`# type: ignore`) may be introduced. This is governed by QG-41 (zero-suppression policy).
- **FR-010**: All replacement types MUST work on Windows, macOS, and Linux. This is governed by QG-39.
- **FR-011**: The ratchet scanner MUST be validated with a dedicated test confirming it correctly reports zero for files using the replacement patterns (named data structures, `object`, explicit unions, recursive type aliases) and correctly reports non-zero for files still containing `Any`. The test MUST also cover scanner edge cases: `from typing import Any as X` (aliased import — MUST count, since the `Any` token is still present), and a local variable named `Any` (shadowing — the scanner's token-based approach will count this as a false positive, which the test must document).
- **FR-012**: No variable, class, or function in `src/` may be named `Any`. This eliminates the scanner's known false-positive vector (token-based detection cannot distinguish type references from identifier shadowing). The scanner validation test (FR-011) MUST include a check that no such identifiers exist.
- **FR-013**: The recursive JSON type alias (used by `_redact_dict`, `_write_json`, and any other recursive JSON handler) MUST be defined once in a shared module and imported by all consumers. Local redefinitions are forbidden to prevent type drift.
- **FR-014**: Pandas `to_dict(orient="records")` narrowing in `_build_dimensions` MUST use dedicated per-entity conversion functions (e.g., `to_repository_record(row) -> RepositoryRecord`), not inline comprehensions. Conversion functions are testable and enforceable at review time; inline narrowing is not.

### Key Entities

- **Ratchet Baseline**: Per-file count of `Any` NAME tokens that can only decrease. Committed to the repository. Enforced by the scanner in CI (`mypy` job) and local preflight (`run_pr_preflight.py`). Not currently wired into pre-commit hooks.
- **Data Structure Definition**: A named, precise type (e.g., `TypedDict`) describing the shape of a dictionary — used in place of `dict[str, Any]` at serialization boundaries.
- **Serialization Boundary**: Where data crosses between the application and an external system (ADO REST API, sqlite3, YAML files, OpenAI API, JSON output). The source of 90 of the 100 `Any` annotations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The ratchet scanner reports exactly 0 `Any` tokens across all files in `src/` (down from 100).
- **SC-002**: All 10 affected files individually report 0 in their per-file baseline ceilings.
- **SC-003**: The strict type checker passes across the entire repo typecheck surface (`src/`, `tests/`, `scripts/`) with zero new inline suppressions.
- **SC-004**: 100% of existing tests pass after each batch with no regressions.
- **SC-005**: QG-40 is fully satisfied for the `src/` scope.
- **SC-006**: The scanner validation test (FR-011) passes, confirming the zero count is genuine and not a scanner limitation.

## Assumptions

- The ratchet scanner (`scripts/check_no_any_types.py`) will be validated by FR-011 but not otherwise modified. Its token-based detection (matching `tok.string == "Any"` via Python's `tokenize` module) is the authoritative counting mechanism.
- `scripts/` (17 usages) and `tests/` (16 usages) are out of scope per issue #235.
- External API response schemas (Azure DevOps, OpenAI) are sufficiently documented to define precise types. The existing mock responses in tests serve as the ground truth for response shapes.
- The batching order follows the dependency chain: quick wins (P1) validate the workflow, API client (P2) defines entry types, ML layer (P3) is independent, persistence (P4) bridges API and aggregators, aggregators (P5a/b/c) consume upstream types.
- Each batch is independently committable with ratchet baseline locked in. Any batch can be the final one shipped without leaving the codebase inconsistent.
- mypy strict mode on `src/` (with `disallow_any_generics = true`) means `dict[str, object]` forces explicit narrowing at every access point. Named data structures avoid this friction and are preferred where the shape is known.
