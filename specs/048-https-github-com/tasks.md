# Tasks: QG-40 Eliminate typing.Any in src/

**Input**: Design documents from `/specs/048-https-github-com/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Included — FR-011 (scanner validation), FR-006 (forecast conformance), and FR-002 (per-file ceiling verification) are explicitly required by the specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. Each story batch ratchets the baseline independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create the shared types module and establish the validation infrastructure.

- [ ] T001 Create shared types module at `src/ado_git_repo_insights/types.py` with module docstring and `from __future__ import annotations` import. Add `JSONValue` recursive type alias: `JSONValue: TypeAlias = "str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]"`. Add `SqliteParam` type alias: `SqliteParam: TypeAlias = str | int | float | bytes | None`. Verify `mypy src/` passes with the new module.
- [ ] T002 [P] Add FR-012 guard: grep `src/` for any variable, class, or function named `Any` (excluding `typing.Any` imports). Confirm none exist. Add a check to the scanner validation test (T003) that verifies this invariant.
- [ ] T003 [P] Create scanner validation test at `tests/unit/test_any_type_scanner.py` (FR-011). Test cases: (1) file using TypedDict, object, unions, recursive TypeAlias reports 0; (2) file with `from typing import Any` reports 1; (3) file with `from typing import Any as X` reports 1 (aliased import); (4) file with local variable named `Any` reports 1 (documented false positive); (5) `Any` in comments/strings reports 0; (6) verify no identifier named `Any` exists in `src/` (FR-012). Run `pytest tests/unit/test_any_type_scanner.py -v` to confirm all pass.

**Checkpoint**: Shared types module exists, scanner behavior is validated, no `Any` identifiers in src/.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No additional foundational work beyond Phase 1. The types module and scanner validation are the only blocking prerequisites. User story implementation can begin immediately after Phase 1.

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Quick Wins (Priority: P1) — 12 tokens

**Goal**: Eliminate all `typing.Any` from `config.py` (2), `run_summary.py` (2), `database.py` (3), `logging_config.py` (5). Validates the ratchet workflow on the simplest files.

**Independent Test**: Each file passes `python scripts/check_no_any_types.py` at 0 for its entry. Full typecheck surface (`mypy src/ tests/ scripts/`) passes. All existing tests pass.

### Implementation for User Story 1

- [ ] T004 [P] [US1] Replace `Any` in `src/ado_git_repo_insights/config.py` (2 tokens). Change `config_data: dict[str, Any] = {}` to `config_data: dict[str, object] = {}`. Handle the `yaml.safe_load()` return with a cast to `dict[str, object]`. Verify all `.get()` calls still work with `object` values (they return `object`, narrowed by defaults). Remove `from typing import Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_config*.py -v`.
- [ ] T005 [P] [US1] Replace `Any` in `src/ado_git_repo_insights/utils/run_summary.py` (2 tokens). Define `RunSummaryDict` TypedDict in `src/ado_git_repo_insights/types.py` with all 11 keys from `to_dict()` (tool_version: str, git_sha: str | None, organization: str, projects: list[str], date_range: dict[str, str], counts: dict[str, int | dict[str, int]], timings: dict[str, float], warnings: list[str], final_status: str, per_project_status: dict[str, str], first_fatal_error: str | None). Change `to_dict()` return type to `RunSummaryDict`. Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_run_summary*.py -v`.
- [ ] T006 [P] [US1] Replace `Any` in `src/ado_git_repo_insights/persistence/database.py` (3 tokens). Import `SqliteParam` from `types.py`. Change `execute` parameter from `tuple[Any, ...]` to `tuple[SqliteParam, ...]`. Change `executemany` parameter from `list[tuple[Any, ...]]` to `Iterable[tuple[SqliteParam, ...]]`. Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_database*.py tests/integration/ -v`.
- [ ] T007 [P] [US1] Replace `Any` in `src/ado_git_repo_insights/utils/logging_config.py` (5 tokens). Import `JSONValue` from `types.py`. Change `_redact_dict` signature: `(self, data: dict[str, JSONValue]) -> dict[str, JSONValue]`. Change local `result: dict[str, JSONValue] = {}`. Change `log_entry` in `emit`: `dict[str, JSONValue]`. All three `_redact_dict` positions must change atomically. Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_logging*.py -v`.
- [ ] T008 [US1] Ratchet baseline after P1 quick wins. Run `python scripts/check_no_any_types.py --update-baseline`. Verify `.any-type-baseline.json` shows 0 for all four files and total is 88. Verify per-file ceilings: config.py=0, run_summary.py=0, database.py=0, logging_config.py=0. Commit updated baseline.

**Checkpoint**: 4 files at zero (88 total). Ratchet workflow validated. Full typecheck and test suite pass.

---

## Phase 4: User Story 2 — API Client (Priority: P2) — 11 tokens

**Goal**: Eliminate all `typing.Any` from `ado_client.py`. Define TypedDicts for all ADO API entities. Validate/normalize JSON at the boundary per FR-005.

**Independent Test**: `python scripts/check_no_any_types.py` reports 0 for `ado_client.py`. Full typecheck passes. All extraction tests pass.

### Implementation for User Story 2

- [ ] T009 [US2] Define ADO API TypedDicts in `src/ado_git_repo_insights/types.py`. Add all 8 TypedDicts per data-model.md: `AdoRepository` (id, name), `AdoCreatedBy` (id, displayName, uniqueName), `AdoReviewer` (id, displayName, uniqueName, vote), `AdoPullRequest` (pullRequestId, title, status, description, creationDate, closedDate, repository, createdBy, reviewers), `AdoTeam` (id, name, description), `AdoIdentity` (id, displayName), `AdoTeamMember` (identity, isTeamAdmin), `AdoComment` (id, content, commentType, publishedDate, lastUpdatedDate, isDeleted, author), `AdoThread` (id, status, lastUpdatedDate, publishedDate, threadContext, isDeleted, comments). Use `NotRequired` for optional fields (description, closedDate, content, lastUpdatedDate on comments). Run `mypy src/` to verify TypedDicts are valid.
- [ ] T010 [US2] Replace `Any` annotations in `src/ado_git_repo_insights/extractor/ado_client.py` (11 tokens). Update return types: `fetch_prs_for_date_range` → `Iterator[AdoPullRequest]`, `_fetch_prs_for_date_paginated` → `list[AdoPullRequest]`, `_fetch_page` → `tuple[list[AdoPullRequest], str | None]`, `get_teams` → `list[AdoTeam]`, `get_team_members` → `list[AdoTeamMember]`, `get_pr_threads` → `list[AdoThread]`. Update all intermediate variables (`all_prs`, `all_teams`, `all_members`, `all_threads`). Add validation/normalization at the JSON parse boundary in each method — construct typed dicts from raw `response.json()["value"]` entries before returning. Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_ado_client*.py tests/unit/test_extraction*.py tests/integration/ -v`.
- [ ] T011 [US2] Ratchet baseline after P2. Run `python scripts/check_no_any_types.py --update-baseline`. Verify `ado_client.py` ceiling is 0 and total is 77. Commit updated baseline.

**Checkpoint**: API client typed. 5 files at zero (77 total). Downstream consumers can now accept typed entities.

---

## Phase 5: User Story 3 — ML/Forecasting Layer (Priority: P3) — 26 tokens

**Goal**: Eliminate all `typing.Any` from `forecaster.py` (6), `fallback_forecaster.py` (7), `insights.py` (13). Shared forecast type enforced at all usage sites per FR-006.

**Independent Test**: Scanner reports 0 for all three files. Full typecheck passes. All forecast and insight tests pass. Conformance test validates both forecasters produce compatible output.

### Tests for User Story 3

- [ ] T012 [P] [US3] Create forecast conformance test at `tests/unit/test_forecast_conformance.py` (FR-006). Test that both `forecaster.py` (Prophet) and `fallback_forecaster.py` (linear) produce output conforming to the shared `ForecastValue` type. Verify both implementations: (1) return dicts with exactly the required keys (period_start, predicted, lower_bound, upper_bound); (2) all values have correct types; (3) fallback adds constraints_applied as list[str]. Run `pytest tests/unit/test_forecast_conformance.py -v`.

### Implementation for User Story 3

- [ ] T013 [US3] Define forecast TypedDicts in `src/ado_git_repo_insights/types.py`. Add per data-model.md: `ForecastValue` (period_start: str, predicted: float, lower_bound: float, upper_bound: float), `ForecastValueWithConstraints(ForecastValue)` (constraints_applied: list[str]). Run `mypy src/`.
- [ ] T014 [P] [US3] Replace `Any` in `src/ado_git_repo_insights/ml/forecaster.py` (6 tokens). Import `ForecastValue` from types.py. Update `MetricForecast.values` field from `list[dict[str, Any]]` to `list[ForecastValue]`. Update ALL usage sites: `forecasts` variable in `forecast()` method, `_forecast_metric` return type, `values` local variable in `_forecast_metric`, `_write_predictions` parameter. Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_forecaster*.py tests/unit/test_predictions*.py -v`.
- [ ] T015 [P] [US3] Replace `Any` in `src/ado_git_repo_insights/ml/fallback_forecaster.py` (7 tokens). Import `ForecastValue` and `ForecastValueWithConstraints` from types.py. Update ALL usage sites: `forecasts` variable in `forecast()`, `_forecast_metric` return type, `values` variables in `_forecast_metric` and `_build_constant_forecast`, `_write_predictions` parameter. Use `ForecastValueWithConstraints` where `constraints_applied` is set. Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_fallback_forecaster*.py tests/unit/test_predictions*.py -v`.
- [ ] T016 [US3] Define insight TypedDicts in `src/ado_git_repo_insights/types.py`. Add per data-model.md: `AffectedEntity` (type: str, name: str), `InsightData` (metric, current_value, previous_value, change_percent, trend_direction, sparkline — all NotRequired), `InsightRecommendation` (action, priority, effort — all NotRequired), `InsightObject` (id, category, severity, title, description, affected_entities — required; data, recommendation — NotRequired), `PRStats` (total_prs, date_range_start, date_range_end, avg_cycle_time_minutes, p90_cycle_time_minutes, authors_count, repositories_count). Run `mypy src/`.
- [ ] T017 [US3] Replace `Any` in `src/ado_git_repo_insights/ml/insights.py` (13 tokens). Import insight types from types.py. Update: `sort_insights` parameter and return → `list[InsightObject]`, `sort_key` parameter → `InsightObject`, `_build_prompt` return → `tuple[str, dict[str, str | PRStats]]`, `_get_pr_stats` return → `PRStats`, `_get_cache_key` parameter → `dict[str, str | PRStats]`, `_check_cache` return → `dict[str, JSONValue] | None`, `_write_cache` parameter → `dict[str, JSONValue]`, `_call_openai` return → `dict[str, JSONValue] | None`, `_validate_and_fix_insights` parameter and return → appropriate typed structures. Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_insights*.py -v`.
- [ ] T018 [US3] Ratchet baseline after P3. Run `python scripts/check_no_any_types.py --update-baseline`. Verify per-file ceilings: forecaster.py=0, fallback_forecaster.py=0, insights.py=0. Total is 51. Commit updated baseline.

**Checkpoint**: ML layer typed. 8 files at zero (51 total). Both forecasters share typed output verified by conformance test.

---

## Phase 6: User Story 4 — Persistence Layer (Priority: P4) — 5 tokens

**Goal**: Eliminate all `typing.Any` from `repository.py`. Input types adopt ADO TypedDicts from P2. Return types use row TypedDicts.

**Independent Test**: Scanner reports 0 for `repository.py`. Full typecheck passes. All persistence tests pass.

### Implementation for User Story 4

- [ ] T019 [US4] Define persistence row TypedDicts in `src/ado_git_repo_insights/types.py` if needed for `get_teams_for_project` and `get_team_members` return types. These may reuse `AdoTeam` and `AdoTeamMember` or define db-specific row shapes (e.g., `TeamRow`, `TeamMemberRow`) depending on whether the repository returns raw API shapes or database-transformed shapes. Read `repository.py` lines 465 and 486 to determine which keys the return dicts actually contain.
- [ ] T020 [US4] Replace `Any` in `src/ado_git_repo_insights/persistence/repository.py` (5 tokens). Import ADO types and row types from types.py. Update: `upsert_pr` parameter `raw_json` → `AdoPullRequest | None`, `upsert_pr_with_related` parameter `pr_data` → `AdoPullRequest`, `get_teams_for_project` return → `list[TeamRow]` (or appropriate typed dict), `get_team_members` return → `list[TeamMemberRow]` (or appropriate typed dict). Remove `Any` import. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_repository*.py tests/integration/ -v`.
- [ ] T021 [US4] Ratchet baseline after P4. Run `python scripts/check_no_any_types.py --update-baseline`. Verify `repository.py` ceiling is 0 and total is 46. Commit updated baseline.

**Checkpoint**: Persistence layer typed. 9 files at zero (46 total). Aggregators can now consume typed entities from repository.

---

## Phase 7: User Story 5 — Aggregators: CSV Entity Exports (Priority: P5a)

**Goal**: Eliminate `Any` tokens in `aggregators.py` related to the `Dimensions` dataclass and `_build_dimensions` method. Define entity record TypedDicts and per-entity conversion functions per FR-014.

**Independent Test**: Full typecheck passes. CSV contract tests pass. Ratchet baseline for `aggregators.py` decreases.

### Implementation for User Story 5

- [ ] T022 [US5] Define dimension entity TypedDicts in `src/ado_git_repo_insights/types.py`. Add per data-model.md: `RepositoryRecord` (organization_name, project_name, repository_id, repository_name), `UserRecord` (display_name, user_id), `AuthorRecord` (author_id, author_name), `ReviewerRecord` (reviewer_id, reviewer_name), `ProjectRecord` (organization_name, project_name), `TeamRecord` (member_count, organization_name, project_name, team_id, team_name), `DateRangeRecord` (min, max). Run `mypy src/`.
- [ ] T023 [US5] Create per-entity conversion functions in `src/ado_git_repo_insights/types.py` per FR-014: `to_repository_record(row: dict[str, object]) -> RepositoryRecord`, `to_user_record(row: dict[str, object]) -> UserRecord`, `to_author_record(row: dict[str, object]) -> AuthorRecord`, `to_reviewer_record(row: dict[str, object]) -> ReviewerRecord`, `to_project_record(row: dict[str, object]) -> ProjectRecord`, `to_team_record(row: dict[str, object]) -> TeamRecord`. Each extracts and validates known keys from a pandas `to_dict` row. Run `mypy src/`.
- [ ] T024 [US5] Replace `Any` in `src/ado_git_repo_insights/transform/aggregators.py` for `Dimensions` dataclass and `_build_dimensions`. Update 6 dataclass fields from `list[dict[str, Any]]` to `list[RepositoryRecord]`, `list[UserRecord]`, etc. Update 6 local variables in `_build_dimensions` to call conversion functions: e.g., `repos_records = [to_repository_record({str(k): v for k, v in r.items()}) for r in repos_df.to_dict(orient="records")]`. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_aggregat*.py tests/unit/test_csv_contract*.py -v`.
- [ ] T025 [US5] Ratchet baseline (partial). Run `python scripts/check_no_any_types.py --update-baseline`. Verify `aggregators.py` ceiling decreased (not yet 0). Commit updated baseline.

**Checkpoint**: Dimensions typed with conversion functions. CSV contract tests pass. Aggregators partially typed.

---

## Phase 8: User Story 6 — Aggregators: Weekly Rollups and Slices (Priority: P5b)

**Goal**: Eliminate `Any` tokens in slice generation methods and `_generate_weekly_rollups`.

**Independent Test**: Full typecheck passes. Dashboard data tests pass. Ratchet baseline for `aggregators.py` decreases further.

### Implementation for User Story 6

- [ ] T026 [US6] Define rollup metric TypedDicts in `src/ado_git_repo_insights/types.py`. Add per data-model.md: `BaseMetrics` (authors_count: int, cycle_time_p50: float | None, cycle_time_p90: float | None, pr_count: int, reviewers_count: int), `ReviewerMetrics` (approval_rate: float, authors_count: int, repositories_count: int, reviewed_prs: int, reviews_count: int), `WeeklyRollupIndexEntry` (end_date, path, size_bytes, start_date, week). Run `mypy src/`.
- [ ] T027 [US6] Replace `Any` in slice methods of `src/ado_git_repo_insights/transform/aggregators.py`. Update return types and local variables in: `_generate_author_slice` → return `dict[str, BaseMetrics]`, `_generate_author_repo_slice` → return type with nested dicts, `_generate_repo_slice` → return `dict[str, BaseMetrics]`, `_generate_team_slice` → return `dict[str, BaseMetrics]`, `_generate_reviewer_slice` → return `dict[str, ReviewerMetrics]`, `_generate_team_repo_slice` → return type with nested dicts. Update `_generate_weekly_rollups` return type and `index` variable. Update `AggregateIndex.weekly_rollups` field to `list[WeeklyRollupIndexEntry]`. Run `mypy src/ tests/ scripts/` and `pytest tests/unit/test_aggregat*.py -v`.
- [ ] T028 [US6] Ratchet baseline (partial). Run `python scripts/check_no_any_types.py --update-baseline`. Verify `aggregators.py` ceiling decreased further. Commit updated baseline.

**Checkpoint**: Slice methods and rollups typed. Dashboard data tests pass.

---

## Phase 9: User Story 7 — Aggregators: Manifest, Distributions, and Utilities (Priority: P5c)

**Goal**: Eliminate all remaining `Any` tokens in `aggregators.py`. Bring file and total to zero.

**Independent Test**: Scanner reports 0 for `aggregators.py` and 0 total. Full typecheck passes. All tests pass.

### Implementation for User Story 7

- [ ] T029 [US7] Define manifest and distribution TypedDicts in `src/ado_git_repo_insights/types.py`. Add per data-model.md: `CycleTimeBuckets`, `YearlyDistribution`, `DistributionIndexEntry`, `ManifestCapabilities`, `CommentsStatus`, `RowCounts`, `CoverageMeta`, and any remaining manifest sub-structures. Run `mypy src/`.
- [ ] T030 [US7] Replace `Any` in distribution and manifest methods of `src/ado_git_repo_insights/transform/aggregators.py`. Update `_generate_distributions` return type and `index` variable. Update `AggregateIndex.distributions` field to `list[DistributionIndexEntry]`. Update `DatasetManifest` dataclass fields: `defaults`, `limits`, `capabilities`, `coverage` with specific TypedDicts. Update `_get_capabilities` and `_get_comments_coverage` return types. Update `_get_operational_summary` parameter and return types. Run `mypy src/ tests/ scripts/`.
- [ ] T031 [US7] Replace `Any` in utility and generate methods of `src/ado_git_repo_insights/transform/aggregators.py`. Update `_write_json` parameter from `dict[str, Any]` to `dict[str, JSONValue]` (import from types.py). Update both `generate()` method return types from `dict[str, Any] | None` to specific manifest TypedDict or None. Remove `from typing import Any` import from aggregators.py. Run `mypy src/ tests/ scripts/` and `pytest tests/ -v --no-cov` (full test suite).
- [ ] T032 [US7] Ratchet baseline to zero. Run `python scripts/check_no_any_types.py --update-baseline`. Verify `.any-type-baseline.json` shows 0 for ALL 10 files and total is 0. Verify per-file ceilings: every file is exactly 0 (FR-002). Commit updated baseline.

**Checkpoint**: All 10 files at zero. Total is 0. QG-40 fully satisfied for src/.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup.

- [ ] T033 Run full preflight: `python scripts/run_pr_preflight.py`. Verify all gates pass including Any-type scanner at 0, suppression audit at 0, mypy strict, all test counts, coverage deltas.
- [ ] T034 [P] Verify scanner validation test still passes with final codebase state: `pytest tests/unit/test_any_type_scanner.py -v`.
- [ ] T035 [P] Verify forecast conformance test passes: `pytest tests/unit/test_forecast_conformance.py -v`.
- [ ] T036 Run quickstart.md validation: execute all commands in `specs/048-https-github-com/quickstart.md` and confirm they work as documented.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: N/A — no additional blocking work
- **US1 (Phase 3)**: Depends on Phase 1 (types.py must exist for JSONValue, SqliteParam)
- **US2 (Phase 4)**: Depends on Phase 1 (types.py for ADO TypedDicts)
- **US3 (Phase 5)**: Depends on Phase 1 (types.py for forecast types)
- **US4 (Phase 6)**: Depends on US2 (repository.py parameters adopt ADO types from ado_client.py)
- **US5 (Phase 7)**: Depends on Phase 1 (types.py for entity records). Optionally benefits from US4 for type flow.
- **US6 (Phase 8)**: Depends on US5 (Dimensions fields must be typed first for slice method inputs)
- **US7 (Phase 9)**: Depends on US6 (remaining aggregator annotations)
- **Polish (Phase 10)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
    ├── US1 (P1: Quick Wins)           ─── independent, can start after Phase 1
    ├── US2 (P2: API Client)           ─── independent, can start after Phase 1
    │       └── US4 (P4: Persistence)  ─── depends on US2 (ADO types)
    ├── US3 (P3: ML Layer)             ─── independent, can start after Phase 1
    └── US5 (P5a: CSV Exports)         ─── independent, can start after Phase 1
            └── US6 (P5b: Rollups)     ─── depends on US5 (Dimensions typed)
                    └── US7 (P5c: Manifest) ─── depends on US6
```

### Within Each User Story

- Define TypedDicts in types.py first
- Replace annotations in target files
- Run mypy + tests
- Ratchet baseline
- Commit

### Parallel Opportunities

- **Phase 1**: T002 and T003 can run in parallel
- **US1**: T004, T005, T006, T007 can ALL run in parallel (4 independent files)
- **US2 and US3**: Can run in parallel (no dependency between API client and ML layer)
- **US3**: T014 and T015 can run in parallel (two forecaster files)
- **US5, US2, US3**: All can start after Phase 1 completes

---

## Parallel Example: User Story 1

```text
# Launch all 4 file replacements in parallel (different files, no dependencies):
T004: Replace Any in src/ado_git_repo_insights/config.py
T005: Replace Any in src/ado_git_repo_insights/utils/run_summary.py
T006: Replace Any in src/ado_git_repo_insights/persistence/database.py
T007: Replace Any in src/ado_git_repo_insights/utils/logging_config.py

# Then sequentially:
T008: Ratchet baseline (depends on T004-T007)
```

## Parallel Example: User Story 3

```text
# After T013 (types defined) and T016 (insight types defined):
T014: Replace Any in forecaster.py       } can run in parallel
T015: Replace Any in fallback_forecaster.py } can run in parallel

# Then:
T017: Replace Any in insights.py (depends on T016)
T018: Ratchet baseline (depends on T014, T015, T017)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 3: US1 Quick Wins (T004–T008)
3. **STOP and VALIDATE**: 4 files at zero, ratchet workflow proven, 88 total
4. This alone reduces violations by 12% and proves the approach works

### Incremental Delivery

1. Phase 1 → types.py + scanner test ready
2. US1 → 100 → 88 (quick wins prove workflow)
3. US2 → 88 → 77 (API boundary typed)
4. US3 → 77 → 51 (ML layer typed, forecast conformance validated)
5. US4 → 51 → 46 (persistence bridges API→aggregators)
6. US5 → 46 → decreasing (CSV exports typed with conversion functions)
7. US6 → further decrease (rollups and slices typed)
8. US7 → 0 (manifest, distributions, utilities — done)

### Parallel Execution Strategy

With two workers after Phase 1:

```
Worker A: US1 → US2 → US4 → US5 → US6 → US7
Worker B: US3 (can start immediately after Phase 1)
```

US3 (ML layer, 26 tokens) is fully independent and the second-largest batch. Running it in parallel with the US1→US2→US4 chain maximizes throughput.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each ratchet commit (T008, T011, T018, T021, T025, T028, T032) locks in progress
- Every batch must leave the codebase green: mypy passes, all tests pass, scanner ≤ baseline
- The `types.py` module grows incrementally — each batch adds only the types it needs
- Do NOT remove the `from typing import Any` import until ALL annotations in that file are replaced
- After removing the import, verify the scanner reports exactly 0 for that file before committing
