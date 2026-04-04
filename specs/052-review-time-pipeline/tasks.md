# Tasks: Review Time Pipeline (P50/P90 Metrics)

**Input**: Design documents from `/specs/052-review-time-pipeline/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: REQUIRED — QG-42 and SC-009 mandate enterprise-grade test coverage for all new code paths.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Shared type definitions and utility functions that multiple stories depend on.

- [ ] T001 [P] Add `review_time_p50: float | None = None` and `review_time_p90: float | None = None` fields to `WeeklyRollup` dataclass in `src/ado_git_repo_insights/transform/aggregators.py`
- [ ] T002 [P] Add `review_time_p50: float | None` and `review_time_p90: float | None` fields to `SliceMetrics` TypedDict in `src/ado_git_repo_insights/types.py`
- [ ] T003 [P] Add `calculate_review_time_minutes(creation_date, reviewed_at)` function to `src/ado_git_repo_insights/utils/datetime_utils.py` — parallel to `calculate_cycle_time_minutes()`, same 1.0-minute floor and 2-decimal rounding

---

## Phase 2: Foundational — Schema Migration (US3)

**Purpose**: Database schema changes that MUST be complete before extraction or aggregation can use review_time fields.

**Goal**: Existing databases auto-migrate to schema v2 with new columns; fresh installs get them from the start.

**Independent Test**: Create a v1 database, connect with upgraded code, verify columns added + version bumped + data preserved.

### Tests

- [ ] T004 [P] [US3] Create `tests/unit/test_schema_migration.py` with tests: v1→v2 migration adds `reviewed_at` to reviewers and `review_time_minutes` to pull_requests; existing data preserved with NULL defaults; schema_version advances to 2
- [ ] T005 [P] [US3] Add idempotency test in `tests/unit/test_schema_migration.py`: running migration on a v2 database produces no error and no duplicate columns
- [ ] T006 [P] [US3] Add fresh-install test in `tests/unit/test_schema_migration.py`: new database starts at v2 with both columns present in CREATE TABLE

### Implementation

- [ ] T007 [US3] Update `SCHEMA_SQL` in `src/ado_git_repo_insights/persistence/models.py` to include `reviewed_at TEXT` on reviewers table and `review_time_minutes REAL` on pull_requests table; update initial INSERT version from 1 to 2
- [ ] T008 [US3] Create `src/ado_git_repo_insights/persistence/migrations.py` with `MIGRATIONS` dict mapping version 2 to `migrate_v1_to_v2()` function that runs `ALTER TABLE reviewers ADD COLUMN reviewed_at TEXT` and `ALTER TABLE pull_requests ADD COLUMN review_time_minutes REAL` and inserts version 2 into schema_version
- [ ] T009 [US3] Add `_apply_migrations()` method to `DatabaseManager` in `src/ado_git_repo_insights/persistence/database.py` that calls `get_schema_version()`, iterates pending migrations, and logs each applied migration; hook it into `connect()` after `_validate_schema()` for existing databases
- [ ] T010 [US3] Bump `AGGREGATES_SCHEMA_VERSION` from 2 to 3 in `src/ado_git_repo_insights/transform/schema_versions.py` to reflect the new rollup fields

**Checkpoint**: Schema migration passes all 3 test scenarios (upgrade, idempotency, fresh install).

---

## Phase 3: User Story 4 — Review Timestamp Extraction (Priority: P1)

**Goal**: Parse vote timestamps from stored PR thread system comments and populate `reviewers.reviewed_at` + `pull_requests.review_time_minutes`.

**Independent Test**: Extract a PR with known approval thread events, verify `reviewed_at` populated and `review_time_minutes` computed correctly.

### Tests

- [ ] T011 [P] [US4] Create `tests/unit/test_review_time_extraction.py` with test: system comment `"PM P voted 10"` with `commentType: "system"` parses to vote_value=10, author_id matched, `publishedDate` extracted as vote timestamp
- [ ] T012 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: deleted system comment (`is_deleted=1`) is skipped when determining earliest positive vote
- [ ] T013 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: PR with rejection then approval uses the approval timestamp, not the rejection
- [ ] T014 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: PR with multiple reviewers who approved uses the earliest approval across all reviewers for `review_time_minutes`
- [ ] T015 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: PR with no positive votes in threads yields NULL `reviewed_at` and NULL `review_time_minutes`
- [ ] T016 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: PR with no thread data (no comments extracted) yields NULL `review_time_minutes` with no errors
- [ ] T017 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: `review_time_minutes` computed as `(reviewed_at - creation_date)` in minutes with 1.0-minute floor and 2-decimal precision
- [ ] T018 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: clock-skew edge case where `reviewed_at < creation_date` produces 1.0-minute floor
- [ ] T019 [P] [US4] Add test for `calculate_review_time_minutes()` in `tests/unit/test_review_time_extraction.py` — same contract as `calculate_cycle_time_minutes()` but with vote timestamp input

### Implementation

- [ ] T020 [US4] Extend `upsert_reviewer()` in `src/ado_git_repo_insights/persistence/repository.py` to accept optional `reviewed_at: str | None = None` parameter and include it in the INSERT OR REPLACE SQL
- [ ] T021 [US4] Add `_populate_review_timestamps()` function in `src/ado_git_repo_insights/cli.py` (or a new module) that: queries `pr_comments` WHERE `comment_type = 'system'` AND `is_deleted = 0`, parses content with regex `^(.+) voted (-?\d+)$`, filters for vote_value IN (10, 5), updates `reviewers.reviewed_at` with earliest positive vote per (pull_request_uid, author_id), and computes `review_time_minutes` on `pull_requests` from earliest positive `reviewed_at` across all reviewers
- [ ] T022 [US4] Call `_populate_review_timestamps()` after `_extract_comments()` in `cmd_extract()` in `src/ado_git_repo_insights/cli.py` when `--include-comments` is enabled

**Checkpoint**: Extraction populates `reviewed_at` and `review_time_minutes` correctly for all edge cases.

---

## Phase 4: User Story 4 continued — Activation Contract (FR-018)

**Goal**: Users who don't enable `--include-comments` get an explicit warning that review time metrics are unavailable.

### Tests

- [ ] T023 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: when `--include-comments` is absent, extraction emits a warning containing "review time" and "--include-comments"
- [ ] T024 [P] [US4] Add test in `tests/unit/test_review_time_extraction.py`: when `--include-comments` IS enabled, vote timestamp extraction runs with no additional flags needed

### Implementation

- [ ] T025 [US4] Add warning emission in `cmd_extract()` in `src/ado_git_repo_insights/cli.py` when `--include-comments` is absent: `logger.warning("Review time metrics unavailable: thread extraction not enabled. Use --include-comments to activate.")`

**Checkpoint**: Warning visible when threads disabled; silent auto-extraction when enabled.

---

## Phase 5: User Story 1 — Review Time Aggregation + Dashboard Visibility (Priority: P1) MVP

**Goal**: Aggregation pipeline produces `review_time_p50`/`review_time_p90` in weekly rollup JSON, causing existing UI cards to auto-appear.

**Independent Test**: Run aggregation on a database with review_time_minutes data, verify rollup JSON contains review_time fields, load dashboard and see cards.

### Tests

- [ ] T026 [P] [US1] Add test in `tests/unit/test_aggregators.py`: base rollup includes `review_time_p50` and `review_time_p90` when >= 2 PRs have non-null `review_time_minutes`; values are null when < 2 PRs have data
- [ ] T027 [P] [US1] Add test in `tests/unit/test_aggregators.py`: rollup JSON output contains `review_time_p50: null` (not absent) when review_time data is below threshold — verify `asdict()` serialization produces `null` not omission
- [ ] T028 [P] [US1] Add test in `tests/unit/test_aggregators.py`: mixed dataset where some PRs have `review_time_minutes` and some have NULL — only non-null values included in percentile computation

### Implementation

- [ ] T029 [US1] Add `pr.review_time_minutes` to the SQL SELECT query in `_generate_weekly_rollups()` in `src/ado_git_repo_insights/transform/aggregators.py` (alongside existing `pr.cycle_time_minutes`)
- [ ] T030 [US1] Add `review_time_p50`/`review_time_p90` computation to the base rollup construction in `_generate_weekly_rollups()` in `src/ado_git_repo_insights/transform/aggregators.py` — same `quantile(0.5/0.9)` + `_ROLLUP_MIN_SAMPLE` threshold pattern as cycle_time

**Checkpoint**: `pytest tests/unit/test_aggregators.py` passes with review_time in base rollups.

---

## Phase 6: User Story 2 — Dimension Slice Aggregation (Priority: P1)

**Goal**: All dimension breakdowns include review_time_p50/p90 so dashboard filters work.

**Independent Test**: Apply a repo/author/team filter, verify review_time values change to reflect filtered subset.

### Tests

- [ ] T031 [P] [US2] Add test in `tests/unit/test_aggregators.py`: `by_author` slice includes `review_time_p50`/`review_time_p90` with `_ROLLUP_MIN_SAMPLE` threshold (2)
- [ ] T032 [P] [US2] Add test in `tests/unit/test_aggregators.py`: `by_repository` slice includes review_time fields with threshold (2)
- [ ] T033 [P] [US2] Add test in `tests/unit/test_aggregators.py`: `by_team` slice includes review_time fields with threshold (2)
- [ ] T034 [P] [US2] Add test in `tests/unit/test_aggregators.py`: `by_author_and_repo` cross-dimensional slice uses `_CROSS_DIM_MIN_SAMPLE` threshold (5) for review_time
- [ ] T035 [P] [US2] Add test in `tests/unit/test_aggregators.py`: `by_team_and_repo` cross-dimensional slice uses `_CROSS_DIM_MIN_SAMPLE` threshold (5) for review_time
- [ ] T036 [P] [US2] Add test in `tests/unit/test_aggregators.py`: dimension slice where ALL PRs have NULL `review_time_minutes` produces null review_time_p50/p90 in the breakdown entry

### Implementation

- [ ] T037 [P] [US2] Add review_time aggregation to `_generate_author_slice()` in `src/ado_git_repo_insights/transform/aggregators.py` — add `review_time_valid_count`, `review_time_p50`, `review_time_p90` to `.agg()` and threshold-gated output
- [ ] T038 [P] [US2] Add review_time aggregation to `_generate_repo_slice()` in `src/ado_git_repo_insights/transform/aggregators.py`
- [ ] T039 [P] [US2] Add review_time aggregation to `_generate_team_slice()` in `src/ado_git_repo_insights/transform/aggregators.py`
- [ ] T040 [P] [US2] Add review_time aggregation to `_generate_author_repo_slice()` in `src/ado_git_repo_insights/transform/aggregators.py` — uses `_CROSS_DIM_MIN_SAMPLE` (5)
- [ ] T041 [P] [US2] Add review_time aggregation to `_generate_team_repo_slice()` in `src/ado_git_repo_insights/transform/aggregators.py` — uses `_CROSS_DIM_MIN_SAMPLE` (5)

**Checkpoint**: All 6 slice methods produce review_time fields. Aggregator tests green.

---

## Phase 7: User Story 5 — Synthetic Demo Data (Priority: P2)

**Goal**: Demo dataset includes review_time fields with per-percentile independent null patterns; dashboard demo shows review time cards.

**Independent Test**: Regenerate demo, verify review_time fields present in rollup JSONs with different P50/P90 null patterns across weeks.

### Tests

- [ ] T042 [P] [US5] Add test in `tests/demo/test_synthetic_data.py`: weekly rollup schema validation includes `review_time_p50` and `review_time_p90` in required fields
- [ ] T043 [P] [US5] Add test in `tests/demo/test_synthetic_data.py`: review_time values are typically 30-70% of cycle_time across sampled rollups
- [ ] T044 [P] [US5] Add test in `tests/demo/test_synthetic_data.py`: P50 and P90 have different null/non-null patterns across weeks (not identical null sets)
- [ ] T045 [P] [US5] Add test in `tests/demo/test_synthetic_data.py`: breakdown entries (`by_repository`, `by_author`, `by_team`) include review_time fields

### Implementation

- [ ] T046 [US5] Update local `WeeklyRollup` dataclass in `scripts/generate-demo-data.py` (line ~300) to include `review_time_p50: float | None = None` and `review_time_p90: float | None = None` fields — synchronized with canonical dataclass in `aggregators.py`
- [ ] T047 [US5] Update local `SliceMetrics` TypedDict in `scripts/generate-demo-data.py` to include `review_time_p50: float | None` and `review_time_p90: float | None` fields
- [ ] T048 [US5] Add review_time generation logic in `scripts/generate-demo-data.py`: compute as `cycle_time * rng.uniform(0.3, 0.7)` with per-percentile independent null injection (~10% chance each, independent coin flips) for base rollup and all breakdown slices
- [ ] T049 [US5] Add review_time population logic in `scripts/generate-synthetic-dataset.py`: `review_time_p50 = cycle_time_p50 * rng.uniform(0.3, 0.7)` with same independent null pattern
- [ ] T050 [US5] Regenerate canonical demo dataset by running `python scripts/build_demo.py` and commit all regenerated files under `docs/data/` (260 weekly rollup JSONs + updated manifest)

**Checkpoint**: `pytest tests/demo/ -v` passes with review_time fields present. Demo dashboard shows review time cards.

---

## Phase 8: Test Guards, Parity & Contract Activation (FR-015, FR-019, FR-020)

**Purpose**: Update test allowlists, add extension contract test, verify CI freshness enforcement.

### Python Test Guard Updates

- [ ] T051 [P] Remove `review_time_p50` and `review_time_p90` from `TS_ONLY_FORWARD_COMPAT_FIELDS` set in `tests/unit/test_schema_parity.py`
- [ ] T052 [P] Remove `review_time_p50` and `review_time_p90` from `DEPRECATED_FIELDS` set in `tests/demo/test_schema_guard.py`

### Extension Contract Activation Test (FR-020)

- [ ] T053 [US1] Create `extension/tests/modules/review-time-contract.test.ts` that: (a) loads a sample rollup JSON with review_time_p50/p90 data, passes it through `calculateMetrics()`, and asserts `reviewTimeP50WeekCount > 0`; (b) loads a rollup with null review_time and asserts `reviewTimeP50WeekCount === 0`; (c) validates the rollup against the schema normalizer after forward-compat allowlist removal to confirm no regression

### Ratchet & Preflight

- [ ] T054 Bump Python `--min-collected` ratchet in `pyproject.toml` to account for new tests (~1540-1550)
- [ ] T055 Bump Jest `--min-collected` ratchet (if applicable) in extension jest config to account for new contract activation test
- [ ] T056 Verify demo parity gates pass: `pytest tests/demo/test_demo_parity_pipeline.py -v` — confirms FR-019 freshness enforcement on committed `docs/data/` artifacts
- [ ] T057 Run full preflight: `python scripts/run_pr_preflight.py` — all gates green with zero new suppressions (SC-008)

**Checkpoint**: All quality gates pass. Feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — T001-T003 can start immediately, all parallel
- **Phase 2 (Schema Migration / US3)**: Depends on Phase 1 — T007 needs T001/T002 for consistent types
- **Phase 3 (Extraction / US4)**: Depends on Phase 2 — needs schema columns to exist
- **Phase 4 (Activation / US4 cont.)**: Depends on Phase 3 — warning is part of extraction flow
- **Phase 5 (Aggregation / US1)**: Depends on Phase 2 — needs `review_time_minutes` column in DB; Phase 3 provides data but aggregation can be tested with fixtures independently
- **Phase 6 (Dimension Slices / US2)**: Depends on Phase 5 — extends base rollup pattern to slices
- **Phase 7 (Demo / US5)**: Depends on Phase 1 (type definitions) + Phase 6 (aggregation complete for realistic output)
- **Phase 8 (Guards & Parity)**: Depends on Phase 7 (demo regenerated) — final validation pass

### User Story Dependencies

- **US3 (Migration)**: Foundation — BLOCKS US1, US2, US4
- **US4 (Extraction)**: Depends on US3; BLOCKS real data flow but not aggregation testing
- **US1 (Dashboard Visibility)**: Depends on US3 for schema; can be tested with fixture data independent of US4
- **US2 (Filters)**: Extends US1 aggregation pattern to dimension slices
- **US5 (Demo)**: Depends on US1 + US2 for aggregation types; can parallelize generation logic

### Parallel Opportunities

Within each phase, tasks marked [P] can run concurrently:
- **Phase 1**: T001, T002, T003 — all different files
- **Phase 2 tests**: T004, T005, T006 — same file but independent test functions
- **Phase 3 tests**: T011-T019 — all in same new test file, can be written together
- **Phase 5 tests**: T026-T028 — same file, independent assertions
- **Phase 6 implementation**: T037-T041 — different slice methods, same file but independent functions
- **Phase 7 tests**: T042-T045 — same file, independent assertions

---

## Parallel Example: Phase 6 (Dimension Slices)

```
# All 5 slice methods can be updated in parallel (different functions, same file):
T037: _generate_author_slice() review_time aggregation
T038: _generate_repo_slice() review_time aggregation
T039: _generate_team_slice() review_time aggregation
T040: _generate_author_repo_slice() review_time aggregation
T041: _generate_team_repo_slice() review_time aggregation
```

---

## Implementation Strategy

### MVP First (US3 + US4 + US1)

1. Complete Phase 1: Setup (type definitions)
2. Complete Phase 2: Schema Migration (US3) — database ready
3. Complete Phase 3-4: Extraction + Activation (US4) — data flowing
4. Complete Phase 5: Base Aggregation (US1) — dashboard cards visible
5. **STOP and VALIDATE**: Run extraction on real ADO data with `--include-comments`, generate aggregates, load dashboard, verify review time cards appear

### Incremental Delivery

1. Setup + Migration + Extraction → Data persisted (US3 + US4)
2. + Base Aggregation → Dashboard cards visible (US1 MVP)
3. + Dimension Slices → Filters work (US2)
4. + Demo Data + Guards → Full feature (US5 + parity)
5. Each increment is independently testable and deployable

---

## Notes

- All new Python code must pass `mypy --strict` with no `typing.Any` (QG-40)
- Zero new suppressions allowed (QG-41, SC-008)
- CSV contract unchanged — `review_time_minutes` is DB-internal only (FR-016)
- Commit regenerated `docs/data/` files as part of Phase 7 (T050) — CI verifies freshness
- Total tasks: 57
- Run `python scripts/run_pr_preflight.py` before pushing (never `--no-verify`)
