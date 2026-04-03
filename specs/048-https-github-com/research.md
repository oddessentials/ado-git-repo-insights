# Research: QG-40 Eliminate typing.Any in src/

**Branch**: `048-https-github-com` | **Date**: 2026-04-02

## R-001: Shared Types Module Location

**Decision**: Create `src/ado_git_repo_insights/types.py` at the package root.

**Rationale**: No existing types module, TypedDict, or TypeAlias exists anywhere in `src/`. The `utils/` package (12 modules) is focused on functional utilities (paths, logging, discovery). Types are package-level contracts — not utilities. `from ado_git_repo_insights.types import JSONValue` is cleaner and more discoverable than `from ado_git_repo_insights.utils.types import ...`.

**Alternatives considered**:
- `utils/types.py` — rejected: utils is for functions, not type definitions
- `_types.py` — rejected: no need for private module; types are part of the public contract
- Scatter TypedDicts into each consuming module — rejected: FR-013 forbids local redefinitions of shared aliases

## R-002: JSONValue Recursive Type Alias

**Decision**: Define a single recursive type alias in `types.py`:
```python
type JSONValue = str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]
```
(Uses Python 3.12+ `type` statement for clean recursive definition. Fallback: `TypeAlias` with string forward reference if 3.10 compat needed.)

**Rationale**: Used by `_redact_dict` (logging_config.py), `_write_json` (aggregators.py), `emit` log entry (logging_config.py), and `to_dict` (run_summary.py). Single canonical definition per FR-013. The recursive union covers all JSON-serializable values without `Any`.

**Alternatives considered**:
- `dict[str, object]` — rejected: forces unsafe narrowing at every access point under `disallow_any_generics = true`
- Per-file type aliases — rejected by FR-013

**Python 3.10 compatibility note**: The `type` statement requires 3.12+. For 3.10 compat, use:
```python
from __future__ import annotations
JSONValue: TypeAlias = "str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]"
```
mypy supports recursive TypeAlias with string annotations.

## R-003: sqlite3 Parameter Type

**Decision**: Define `SqliteParam` type alias:
```python
SqliteParam: TypeAlias = str | int | float | bytes | None
```

**Rationale**: Python typeshed defines `_SqliteData = str | ReadableBuffer | int | float | None`. The project never passes `ReadableBuffer` (bytes) but including `bytes` matches sqlite3's actual contract. `object` is forbidden by spec (erases runtime type safety). The codebase exclusively passes `tuple[str, ...]`, `tuple[str, str]`, `tuple[str, str, str, str]` etc. — all narrower than this union.

**Alternatives considered**:
- `object` — rejected by spec FR (erases runtime safety)
- `str | int | float | None` (no bytes) — rejected: doesn't match sqlite3's full contract
- Import sqlite3's `_Parameters` directly — rejected: private type, not stable API

## R-004: config.py YAML Deserialization

**Decision**: Replace `config_data: dict[str, Any] = {}` with `config_data: dict[str, object] = {}`. The function immediately validates and extracts typed values via `.get()` with defaults, so `object` values are narrowed at each access point.

**Rationale**: `yaml.safe_load()` returns `Any`. The config_data variable is a temporary holding dict whose values are extracted into typed `Config` dataclass fields within the same function. Since every access uses `.get(key, default)` with typed defaults, `dict[str, object]` provides sufficient safety. A TypedDict would over-specify the raw YAML shape before validation.

**Alternatives considered**:
- `RawConfigDict` TypedDict — rejected: the YAML shape is validated by the function body, not the type system; a TypedDict would create a false sense of validation
- Keep `dict[str, Any]` — rejected: violates QG-40

**mypy interaction**: `yaml.safe_load()` returns `Any`. Assigning to `dict[str, object]` requires a cast or intermediate assignment. Since `defusedxml.ElementTree` is also `ignore_missing_imports = true`, we may need `cast(dict[str, object], yaml.safe_load(...))`. This is a type-safe narrowing cast, not a suppression.

## R-005: ADO API Response TypedDicts

**Decision**: Define TypedDicts for each API entity in `types.py`: `AdoPullRequest`, `AdoTeam`, `AdoTeamMember`, `AdoThread`, `AdoComment`, `AdoReviewer`, `AdoCreatedBy`, `AdoRepository`.

**Rationale**: All keys are documented by the Azure DevOps API and verified against test mocks and downstream access patterns:

- **PR**: pullRequestId(int), title(str), status(str), description(str|None), creationDate(str), closedDate(str|None), repository(AdoRepository), createdBy(AdoCreatedBy), reviewers(list[AdoReviewer])
- **Team**: id(str), name(str), description(str|None)
- **TeamMember**: identity({id: str, displayName: str}), isTeamAdmin(bool)
- **Thread**: id(int), status(str), lastUpdatedDate(str), publishedDate(str), threadContext(dict|None), isDeleted(bool), comments(list[AdoComment])
- **Comment**: id(int), content(str|None), commentType(str), publishedDate(str), lastUpdatedDate(str|None), isDeleted(bool), author(AdoCreatedBy)

Per FR-005, API methods must validate/normalize JSON into these typed structures before returning.

**Alternatives considered**:
- Pydantic models — rejected: zero external deps in src/ per project policy
- dataclasses — rejected: TypedDicts interop directly with `dict` access patterns used throughout

## R-006: Shared Forecast Types

**Decision**: Define shared types in `types.py`:
```python
class ForecastValue(TypedDict):
    period_start: str
    predicted: float
    lower_bound: float
    upper_bound: float

class ForecastValueWithConstraints(ForecastValue):
    constraints_applied: list[str]
```

**Rationale**: Both forecasters produce identical base fields (period_start, predicted, lower_bound, upper_bound). The fallback forecaster adds `constraints_applied`. Using TypedDict inheritance means `ForecastValueWithConstraints` is a subtype of `ForecastValue` — both can be used where `ForecastValue` is expected. The `MetricForecast` dataclass field changes from `list[dict[str, Any]]` to `list[ForecastValue]`.

Per spec, the shared type MUST be used at all sites: MetricForecast.values, all intermediate `values` and `forecasts` variables, all `_forecast_metric` returns, all `_write_predictions` parameters.

**Alternatives considered**:
- Single `ForecastValue` with `NotRequired[constraints_applied]` — viable but inheritance is cleaner for the subtype relationship
- Protocol — rejected: no methods to define, just data shape

## R-007: Aggregator Entity Conversion Functions

**Decision**: Per FR-014, define dedicated conversion functions for each Dimensions entity:
- `to_repository_record(row: dict[str, object]) -> RepositoryRecord`
- `to_user_record(row: dict[str, object]) -> UserRecord`
- `to_author_record(row: dict[str, object]) -> AuthorRecord`
- `to_reviewer_record(row: dict[str, object]) -> ReviewerRecord`
- `to_project_record(row: dict[str, object]) -> ProjectRecord`
- `to_team_record(row: dict[str, object]) -> TeamRecord`

Each function validates/extracts known keys from a pandas `to_dict` row. These live in `types.py` alongside the TypedDicts they return.

**Rationale**: pandas `to_dict(orient="records")` returns `list[dict[str, Any]]`. Inline comprehension narrowing is unenforceable at review time. Dedicated functions are testable and self-documenting.

**Alternatives considered**:
- Inline comprehensions with `cast()` — rejected by FR-014
- pandas `.astype()` before `to_dict()` — rejected: doesn't address the dict type, just column dtypes

## R-008: Scanner Edge Cases (FR-011/FR-012)

**Decision**: The scanner validation test must cover:
1. Files using TypedDict, object, unions, recursive aliases → reports 0
2. `from typing import Any as X` → reports 1 (token `Any` still present)
3. Local variable named `Any` → reports 1 (false positive, documented)
4. `Any` in comments/strings → reports 0 (tokenizer skips these)
5. No identifier named `Any` exists in src/ (FR-012 check)

**Rationale**: The scanner is token-based (`tok.string == "Any"`). It cannot distinguish type references from identifier shadowing. FR-012 bans `Any` as an identifier to close this vector. The test documents the limitation rather than trying to fix the scanner.

## R-009: run_summary.py to_dict() Return Type

**Decision**: Define `RunSummaryDict` TypedDict in `types.py` with the exact structure matching the current `to_dict()` output. Use nested TypedDicts for `date_range`, `counts`, and `timings`.

**Rationale**: The return shape is fully defined by the RunSummary dataclass fields — 11 top-level keys with known types. A TypedDict is cleaner than a complex union and provides key-level type safety for consumers.

## R-010: Aggregator Rollup and Distribution Types

**Decision**: Define TypedDicts for each aggregation output in `types.py`:
- `WeeklyRollup`, `RepositoryMetrics`, `AuthorMetrics`, `ReviewerMetrics`, `TeamMetrics`
- `AuthorRepoMetrics`, `TeamRepoMetrics`
- `YearlyDistribution`, `CycleTimeBuckets`
- `WeeklyRollupIndexEntry`, `DistributionIndexEntry`
- `DatasetManifest` and its sub-structures

**Rationale**: All structures have known, fixed schemas verified from generated JSON files, downstream dashboard TypeScript types, and test assertions. The manifest structure has ~15 sub-structures, all documented by the research agents.

**Key design decisions for rollup types**:
- Slice dicts (by_repository, by_author, etc.) use `dict[str, MetricsType]` where the key is the dimension value
- Cross-dimensional slices (by_author_and_repo, by_team_and_repo) are nested `dict[str, dict[str, MetricsType]]`
- Truncation flag `_truncated` makes the cross-dim dict heterogeneous — use a wrapper TypedDict or separate the flag
- cycle_time percentiles are `float | None` (None when below sample threshold)
