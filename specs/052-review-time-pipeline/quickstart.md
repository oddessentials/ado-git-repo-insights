# Quickstart: Review Time Pipeline (052)

**Branch**: `052-review-time-pipeline` | **Date**: 2026-04-04

## Prerequisites

- Python 3.12+
- pnpm 9.x + Node.js 22+
- All dev dependencies: `pip install -e ".[dev]"` + `cd extension && pnpm install`

## Implementation Order

### Phase 1: Schema & Migration (Story 3)
1. Add `reviewed_at TEXT` to reviewers table in `SCHEMA_SQL` (models.py)
2. Add `review_time_minutes REAL` to pull_requests table in `SCHEMA_SQL`
3. Create `persistence/migrations.py` with `migrate_v1_to_v2()`
4. Hook migration into `DatabaseManager.connect()` after `_validate_schema()`
5. Bump initial schema version to 2 for fresh installs
6. Update `AGGREGATES_SCHEMA_VERSION` in `schema_versions.py`
7. **Tests**: `test_schema_migration.py` — v1→v2, idempotency, data preservation, fresh install

### Phase 2: Extraction + Activation Contract (Story 4, FR-018)
1. Add `calculate_review_time_minutes()` to `datetime_utils.py` (parallel to cycle_time)
2. Add `_populate_review_timestamps()` function — queries pr_comments for system vote events, updates reviewers.reviewed_at and pull_requests.review_time_minutes
3. Extend `upsert_reviewer()` to accept `reviewed_at` parameter
4. Call `_populate_review_timestamps()` after comment extraction in `cmd_extract()`
5. Add visible warning when `--include-comments` is absent: `"Review time metrics unavailable: thread extraction not enabled. Use --include-comments to activate."`
6. When `--include-comments` IS enabled, vote timestamp extraction runs automatically — no separate flag
7. **Tests**: `test_review_time_extraction.py` — vote parsing, edge cases, reviewer matching, warning emission

### Phase 3: Aggregation (Stories 1, 2)
1. Add `review_time_p50/p90` to `WeeklyRollup` dataclass
2. Add `review_time_p50/p90` to `SliceMetrics` TypedDict
3. Add `review_time_minutes` to the SQL query in `_generate_weekly_rollups()`
4. Add review_time quantile computation to base rollup (same pattern as cycle_time)
5. Add review_time to all 6 slice methods (author, repo, team, author_repo, team_repo, reviewer-passthrough)
6. **Tests**: Update `test_aggregators.py` with review_time fixtures and assertions

### Phase 4: Synthetic Data & Demo (Story 5)
1. Update local `WeeklyRollup` + `SliceMetrics` in `generate-demo-data.py` with review_time fields
2. Add review_time generation logic (30-70% of cycle_time, per-percentile null independence)
3. Update `generate-synthetic-dataset.py` population logic
4. Regenerate demo dataset: `python scripts/build_demo.py`
5. Commit regenerated `docs/data/` files

### Phase 5: Test Guards, Parity & Contract Activation (FR-015, FR-019, FR-020)
1. Remove `review_time_p50/p90` from `TS_ONLY_FORWARD_COMPAT_FIELDS` (test_schema_parity.py)
2. Remove from `DEPRECATED_FIELDS` (test_schema_guard.py)
3. Add to `required` field list (test_synthetic_data.py)
4. Add Jest contract activation test: `extension/tests/modules/review-time-contract.test.ts` — load regenerated demo rollup data, verify card show/hide, confirm schema validation after allowlist removal (FR-020)
5. Verify demo parity gates (QG-31, QG-32) pass with regenerated artifacts — confirms FR-019 freshness enforcement
6. Bump `--min-collected` ratchets (Python + Jest) in pyproject.toml / jest.config
7. Run full preflight: `python scripts/run_pr_preflight.py`

## Verification

```bash
# Python unit tests
pytest tests/unit/test_schema_migration.py -v
pytest tests/unit/test_review_time_extraction.py -v
pytest tests/unit/test_aggregators.py -v

# Demo validation
pytest tests/demo/ -v

# Extension contract activation test
cd extension && pnpm test -- --testPathPattern=review-time-contract

# Full preflight (pre-push equivalent)
python scripts/run_pr_preflight.py
```

## Key Files to Modify

| File | Change |
|------|--------|
| `src/.../persistence/models.py` | SCHEMA_SQL: add columns to reviewers + pull_requests |
| `src/.../persistence/migrations.py` | NEW: v1→v2 migration function |
| `src/.../persistence/database.py` | Hook `_apply_migrations()` into connect() |
| `src/.../persistence/repository.py` | Extend `upsert_reviewer()` with reviewed_at param |
| `src/.../utils/datetime_utils.py` | Add `calculate_review_time_minutes()` |
| `src/.../transform/aggregators.py` | WeeklyRollup fields + SQL + 6 slice methods |
| `src/.../types.py` | SliceMetrics: add review_time fields |
| `src/.../transform/schema_versions.py` | Bump AGGREGATES_SCHEMA_VERSION |
| `src/.../cli.py` | Call `_populate_review_timestamps()` after comment extraction; warn when --include-comments absent (FR-018) |
| `scripts/generate-demo-data.py` | Local dataclass + generation logic |
| `scripts/generate-synthetic-dataset.py` | Population logic for review_time |
| `tests/unit/test_schema_migration.py` | NEW: migration tests |
| `tests/unit/test_review_time_extraction.py` | NEW: extraction tests |
| `tests/unit/test_aggregators.py` | Add review_time assertions |
| `tests/unit/test_schema_parity.py` | Remove forward-compat entry |
| `tests/demo/test_schema_guard.py` | Remove deprecated entry |
| `tests/demo/test_synthetic_data.py` | Add required field |
| `extension/tests/modules/review-time-contract.test.ts` | NEW: FR-020 contract activation test (card visibility with real rollup data) |
| `docs/data/aggregates/weekly_rollups/*.json` | Regenerated (260 files) — CI-verified freshness via QG-31/QG-32 |
