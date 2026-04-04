# Research: Review Time Pipeline (052)

**Date**: 2026-04-04 | **Branch**: `052-review-time-pipeline`

## R1: Schema Migration Strategy

**Decision**: Build a lightweight `migrations.py` module with version-keyed migration functions, called from `DatabaseManager.connect()` after schema validation.

**Rationale**:
- `schema_version` table already exists (models.py:175-182) with version=1 seeded on first run
- `get_schema_version()` method exists (database.py:191-202) but is currently unused
- No migration framework exists — only atomic schema creation via `executescript(SCHEMA_SQL)`
- SQLite 3.41+ (bundled with Python 3.12) fully supports `ALTER TABLE ADD COLUMN` with implicit NULL default
- The migration is non-destructive: existing rows get NULL for new columns automatically

**Alternatives Considered**:
- Alembic: Too heavy for a single migration; adds a dependency and config overhead
- Manual SQL in connect(): Works but doesn't scale; a module with version-keyed functions is cleaner and ready for future migrations

**Migration v1 → v2**:
1. `ALTER TABLE reviewers ADD COLUMN reviewed_at TEXT` — vote timestamp
2. `ALTER TABLE pull_requests ADD COLUMN review_time_minutes REAL` — computed latency
3. `INSERT INTO schema_version (version, applied_at) VALUES (2, datetime('now'))` — bump version
4. SCHEMA_SQL updated to include new columns for fresh installs (version starts at 2)

**Idempotency**: Check `get_schema_version()` before applying. If already at v2, skip.

## R2: Vote Timestamp Extraction Integration Point

**Decision**: Extract vote timestamps during the comment extraction pass (Phase 2), NOT during PR extraction (Phase 1). After comment threads are stored, scan `pr_comments` for system vote events and update the `reviewers` table with `reviewed_at`. Then compute `review_time_minutes` on the `pull_requests` table.

**Rationale**:
- Vote timestamps live in PR thread system comments, not the PR API reviewer array
- The ADO `reviewers` field on the PR response contains only `{id, displayName, uniqueName, vote}` — no timestamp
- Thread data is fetched via `get_pr_threads()` (ado_client.py:459-525), which is called during comment extraction
- Comment extraction already persists threads to `pr_threads` and comments to `pr_comments` with `comment_type` and `author_id` fields
- A post-extraction pass can query `pr_comments WHERE comment_type = 'system'` and parse vote content via regex `^(.+) voted (-?\d+)$`

**Alternatives Considered**:
- Extract during PR pass: Impossible — PR API doesn't return vote timestamps
- Add a third extraction phase: Unnecessary complexity; piggyback on existing comment extraction
- Parse threads in-memory during comment extraction without persisting: Loses auditability and replay capability

**Integration Flow**:
1. Comments extracted as usual via `_extract_comments()` (cli.py:426-575)
2. New function `_populate_review_timestamps()` runs after comment extraction
3. Queries `pr_comments` for system vote events matching the regex pattern
4. Updates `reviewers.reviewed_at` for matching (pull_request_uid, user_id) pairs
5. Computes `review_time_minutes` on `pull_requests` from earliest positive `reviewed_at`

**Thread Extraction Coupling**: Review time requires `--include-comments` (or a new flag). Users who never enable comments get NULL review_time — this is acceptable graceful degradation per FR-008.

## R3: Aggregation Pattern for review_time

**Decision**: Add `review_time_minutes` to the same SQL query and pandas DataFrame used for cycle_time aggregation. Apply identical quantile/threshold patterns across all 6 slice methods.

**Rationale**:
- The SQL query (aggregators.py:586-600) selects from `pull_requests` with a LEFT JOIN to `repositories`. Adding `pr.review_time_minutes` to the SELECT is a single-line change.
- All 6 slice methods use the same pandas pattern: `groupby().agg()` with lambda quantile and `.notna().sum()` threshold checks.
- The `_ROLLUP_MIN_SAMPLE` (2) and `_CROSS_DIM_MIN_SAMPLE` (5) constants are shared — review_time reuses them.
- NULL review_time values are handled identically to NULL cycle_time: `.notna().sum()` counts only non-null values, and quantile computation excludes NaN by default.

**Changes Required per Slice Method**:
1. Add `review_time_valid_count=("review_time_minutes", "count")` to `.agg()`
2. Add `review_time_p50=("review_time_minutes", lambda s: s.quantile(0.5))` to `.agg()`
3. Add `review_time_p90=("review_time_minutes", lambda s: s.quantile(0.9))` to `.agg()`
4. Add threshold-gated output: `"review_time_p50": row["review_time_p50"] if review_time_valid_count >= threshold and not pd.isna(row["review_time_p50"]) else None`

**Affected Methods** (6 total):
- Base rollup: `_generate_weekly_rollups()` lines 670-683
- `_generate_author_slice()` lines 774-820
- `_generate_repo_slice()` lines 904-959
- `_generate_team_slice()` lines 961-1036
- `_generate_author_repo_slice()` lines 822-902 (cross-dim, threshold=5)
- `_generate_team_repo_slice()` lines 1109-1258 (cross-dim, threshold=5)

## R4: Synthetic Data Generation Strategy

**Decision**: Update both generators and regenerate the full demo dataset.

**Rationale**:
- `generate-demo-data.py` defines a LOCAL `WeeklyRollup` (line 300) and `SliceMetrics` that must be manually synced
- `generate-synthetic-dataset.py` imports canonical `WeeklyRollup` from `aggregators.py` (line 75) — auto-gets new fields but needs population logic
- Demo must be regenerated and promoted to `docs/data/` (260 weekly rollup files)

**Review Time Generation Approach**:
- Enterprise demo (`generate-demo-data.py`): Log-normal distribution, `review_time = cycle_time * rng.uniform(0.3, 0.7)` with per-percentile independent null injection (~10% null rate, independent coin flip per percentile)
- Quick synthetic (`generate-synthetic-dataset.py`): `review_time_p50 = cycle_time_p50 * rng.uniform(0.3, 0.7)`, same pattern

**Per-Percentile Null Independence** (FR-010):
- For each week, independently decide P50 null (10% chance) and P90 null (10% chance)
- This produces ~1% both-null, ~9% P50-only-null, ~9% P90-only-null, ~81% both-present
- Exercises the UI's per-card visibility gating

## R5: CSV Contract Preservation

**Decision**: `review_time_minutes` is DB-internal only. Neither `review_time_minutes` on `pull_requests` nor `reviewed_at` on `reviewers` appear in the CSV output.

**Rationale**:
- Constitution Principles I-IV mandate CSV schema stability
- Adding columns to CSV would require version bump, migration plan, PowerBI model update
- The value of review_time is in aggregated rollups (JSON), not raw per-PR CSV rows
- `CSV_SCHEMAS` in models.py remain unchanged

## R6: Test Strategy

**Decision**: Create 2 new Python test modules + 1 new Jest contract activation test + update 3 existing Python test files. Estimated 45-65 new tests.

**New Python Modules**:
- `tests/unit/test_review_time_extraction.py` — Vote timestamp parsing, reviewer matching, edge cases
- `tests/unit/test_schema_migration.py` — v1→v2 migration, idempotency, data preservation

**New Jest Test** (FR-020):
- `extension/tests/modules/review-time-contract.test.ts` — Loads regenerated demo rollup JSON with review_time fields, verifies card show/hide behavior via existing rendering functions, confirms forward-compat allowlist removal doesn't regress schema validation

**Updated Files**:
- `tests/unit/test_aggregators.py` — Add review_time to existing aggregation tests
- `tests/unit/test_schema_parity.py` — Remove from `TS_ONLY_FORWARD_COMPAT_FIELDS`
- `tests/demo/test_schema_guard.py` — Remove from `DEPRECATED_FIELDS`
- `tests/demo/test_synthetic_data.py` — Add to `required` field list

**Ratchet Impact**: Bump Python `--min-collected` from 1484 to ~1540-1550. Bump Jest `--min-collected` by ~5-10 for contract activation test.

## R7: Extraction Activation Contract

**Decision**: Thread extraction (`--include-comments`) is the activation prerequisite for review time data. When threads are not enabled, the CLI emits a visible warning at extraction completion. When threads ARE enabled, vote timestamp extraction runs automatically — no separate opt-in.

**Rationale**:
- Vote timestamps live in thread system comments, not the PR API response
- Adding a separate `--include-review-time` flag creates cognitive overhead and state-space explosion
- A warning when threads are off prevents users from running "successful" extractions that silently produce all-NULL review metrics
- The aggregation step always includes `review_time_minutes` in its query; FR-008 NULL handling covers the empty-data path naturally

**Alternatives Considered**:
- Hard-fail when threads off: Too disruptive — review time is additive, not required for other metrics
- Silent NULL: Creates user confusion — the whole point of FR-018
- Auto-enable threads: Changes existing behavior, potential API cost surprise

## R8: Demo Artifact Freshness Enforcement

**Decision**: Committed demo artifacts (`docs/data/`) are deterministically verified in CI via existing QG-05 (golden outputs) and QG-31/QG-32 (demo parity) gates. No new CI gate needed — the existing gates already enforce byte-level freshness.

**Rationale**:
- `tests/demo/test_demo_parity_pipeline.py` already validates that `docs/data/` is a "clean promoted mirror" (QG-32)
- `tests/integration/test_golden_outputs.py` validates hash stability for deterministic outputs (QG-05)
- Adding review_time fields to the generators changes their output, which changes the committed artifacts
- If artifacts are stale (not regenerated after code change), the parity test fails because `docs/data/` won't match canonical generation output
- The demo build is deterministic (seeded RNG, fixed `FIXED_GENERATED_AT` timestamp, Python 3.12 baseline)

**Verification**: After regenerating demo data, the parity pipeline test must pass. If it fails in CI, the developer forgot to regenerate and commit.
