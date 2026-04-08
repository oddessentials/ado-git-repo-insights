# Feature Specification: Review Time Pipeline (P50/P90 Metrics)

**Feature Branch**: `052-review-time-pipeline`
**Created**: 2026-04-04
**Status**: Draft (post-review revision)
**Issue**: #217
**Input**: User description: "Pipeline: extract review timestamps to enable review_time_p50/p90 metrics"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review Time Metrics Appear on Dashboard (Priority: P1)

An engineering manager opens the dashboard and sees Review Time P50 and P90 summary cards alongside the existing Cycle Time cards. The review time cards display how long PRs waited for their first approval, formatted as durations (e.g., "4.2h", "1.3d"), with sparklines showing weekly trends and deltas comparing to the prior period.

**Why this priority**: This is the core value proposition. Without review time data flowing through the pipeline, the already-built UI cards remain permanently hidden. This unblocks the primary user-facing feature.

**Independent Test**: Can be tested by running an extraction with thread data enabled, then loading the dashboard and observing that review time cards appear with plausible values, sparklines, and delta indicators.

**Acceptance Scenarios**:

1. **Given** a dataset with completed PRs that have thread data containing approval vote events, **When** the aggregation pipeline runs, **Then** weekly rollup JSON files include `review_time_p50` and `review_time_p90` fields with numeric values (in minutes).
2. **Given** a weekly rollup with review time data, **When** the dashboard loads, **Then** Review Time P50 and P90 summary cards become visible (auto-shown by existing UI gating logic).
3. **Given** a week where fewer than the minimum sample threshold of PRs have review timestamps, **When** that week's rollup is generated, **Then** `review_time_p50` and `review_time_p90` are `null` for that week, and the corresponding cards hide for that period.
4. **Given** review time data is present, **When** a user hovers over a review time card's info icon, **Then** the tooltip displays the metric explanation ("Median time from first review request to review completion").

---

### User Story 2 - Review Time Filters by Dimension (Priority: P1)

A team lead filters the dashboard by their team name and sees review time metrics scoped to their team's PRs. They can also filter by repository or author and see review time metrics adjust accordingly.

**Why this priority**: Filter propagation is essential for the metric to be actionable. Without dimension breakdowns, managers cannot identify which teams, repos, or authors have slow review cycles.

**Independent Test**: Can be tested by applying a repository or team filter and confirming that review time values change to reflect only the filtered subset, and that cards hide when the filtered slice has insufficient data.

**Acceptance Scenarios**:

1. **Given** rollups with `by_repository` breakdown entries containing review time fields, **When** a user filters by a specific repository, **Then** review time cards show values specific to that repository's PRs.
2. **Given** rollups with `by_author` breakdown entries, **When** a user filters by a specific author, **Then** review time cards reflect that author's PR review times.
3. **Given** rollups with `by_team` breakdown entries, **When** a user filters by team, **Then** review time cards show team-scoped values.
4. **Given** a filter combination that results in zero PRs with review time data for a given week, **When** that filter is applied, **Then** review time cards hide automatically.

---

### User Story 3 - Schema Migration for Existing Databases (Priority: P1)

A user who has been running the tool for months upgrades to the new version. Their existing database, which lacks the `reviewed_at` column on the reviewers table, is automatically migrated. The tool continues to function, and review time metrics begin populating as new extractions capture thread data.

**Why this priority**: Without graceful migration, existing users face database errors or data loss on upgrade. This is a prerequisite for deployment.

**Independent Test**: Can be tested by creating a database at schema version 1 (without `reviewed_at`), running the upgraded tool, and confirming the column is added, existing data is preserved, and new extractions populate the column.

**Acceptance Scenarios**:

1. **Given** an existing database at schema version 1 (no `reviewed_at` column), **When** the upgraded application initializes, **Then** the `reviewed_at` column is added to the reviewers table and the schema version advances.
2. **Given** a migrated database with existing reviewer records, **When** the migration completes, **Then** all existing reviewer records have `reviewed_at` set to `NULL` (not fabricated data), and no existing data is altered.
3. **Given** a fresh installation (no prior database), **When** the application initializes, **Then** the reviewers table is created with the `reviewed_at` column from the start.

---

### User Story 4 - Review Timestamp Extraction from ADO Threads (Priority: P1)

During extraction, the system parses PR thread data to identify approval vote events and records the timestamp of the earliest positive vote per PR. This timestamp is stored as `reviewed_at` on the reviewer record and used to compute `review_time_minutes` per PR.

**Why this priority**: This is the data source for the entire feature. Without extracting review timestamps from thread system comments, there is no review time data to aggregate or display.

**Prerequisite — ADO API Spike**: COMPLETED (2026-04-04). Validated against 10 PRs across 2 projects in the oddessentials org. All 5 requirements confirmed:
1. Vote events appear as `commentType: "system"` thread comments with content pattern `"{displayName} voted {voteValue}"`
2. `publishedDate` on vote comments is the vote timestamp (ISO 8601, UTC, millisecond precision)
3. Comment `author.id` matches exactly with the PR reviewer record's `id` field
4. `isDeleted` boolean reliably distinguishes deleted from active vote events
5. Vote value (integer) is embedded in content; regex `^(.+) voted (-?\d+)$` parsed 11/11 comments with zero failures

See [spike-ado-vote-timestamps.md](spike-ado-vote-timestamps.md) for full evidence.

**Independent Test**: Can be tested by extracting a PR with known approval thread events and confirming that `reviewed_at` is populated with the correct timestamp and `review_time_minutes` is computed accurately.

**Acceptance Scenarios**:

1. **Given** a completed PR with system thread comments indicating an approval vote (vote value 10 or 5), **When** extraction processes this PR's threads, **Then** the earliest positive vote's `publishedDate` is stored as `reviewed_at` on the corresponding reviewer record.
2. **Given** a PR where a reviewer voted "rejected" then later "approved", **When** extraction processes threads, **Then** the approval timestamp is used (not the rejection timestamp).
3. **Given** a PR with no positive votes in its thread data, **When** extraction processes this PR, **Then** `reviewed_at` remains `NULL` and `review_time_minutes` is `NULL` for that PR.
4. **Given** a PR where threads have not yet been fetched, **When** aggregation runs, **Then** that PR contributes `NULL` for review time (graceful degradation, no errors).
5. **Given** the `reviewed_at` timestamp and the PR's `creation_date`, **When** `review_time_minutes` is calculated, **Then** the value equals `(reviewed_at - creation_date)` in minutes, with a minimum floor of 1.0 minute, rounded to 2 decimal places.

---

### User Story 5 - Synthetic Demo Data Includes Review Time (Priority: P2)

The demo dataset and synthetic data generators produce review time values so that the dashboard demo showcases review time cards. P50 and P90 have intentionally different null patterns across weeks to demonstrate per-percentile independent visibility.

**Why this priority**: The demo is the primary way stakeholders evaluate the product. Hidden review time cards in the demo undermine confidence in the feature. However, the feature works without this for real data users.

**Independent Test**: Can be tested by regenerating the demo dataset and confirming that weekly rollup JSON files contain `review_time_p50` and `review_time_p90` fields with realistic values, and that some weeks have P50-only or P90-only data.

**Acceptance Scenarios**:

1. **Given** the demo data generator (`generate-demo-data.py`) runs, **When** weekly rollup files are produced, **Then** each rollup includes `review_time_p50` and `review_time_p90` fields.
2. **Given** the generated demo data, **When** examining null patterns across weeks, **Then** P50 and P90 have different null/non-null weeks (not identical patterns) to exercise per-percentile independent visibility.
3. **Given** the generated review time values, **When** compared to cycle time values in the same rollup, **Then** review time is typically 30-70% of cycle time (realistic proportion).
4. **Given** the demo data, **When** breakdown entries (`by_repository`, `by_author`, `by_team`) are examined, **Then** they also include `review_time_p50` and `review_time_p90` fields.
5. **Given** the full demo build pipeline runs (`build-demo-dataset.py`), **When** the promotion step copies to `docs/data/`, **Then** all 260 weekly rollup JSON files in `docs/data/aggregates/weekly_rollups/` contain `review_time_p50` and `review_time_p90` fields and the published demo dashboard shows review time cards.
6. **Given** the local `WeeklyRollup` and `SliceMetrics` definitions in `generate-demo-data.py`, **When** compared to the canonical definitions in `aggregators.py` and `types.py`, **Then** both include the same review time fields (no parity drift between production and demo data models).

---

### ~~User Story 6 - Backfill Review Timestamps for Historical PRs~~ (DESCOPED)

**Deferred to follow-up issue.** Backfill requires rate limiting, resumability, progress tracking, and partial failure handling that expand scope beyond the core feature. Existing users will see review time metrics populate incrementally as new extractions with thread data run. A dedicated backfill feature will be specified separately.

---

### ~~User Story 7 - Review Time in Predictions/Forecasting~~ (DESCOPED)

**Deferred to follow-up issue.** The demo predictions script (`generate-demo-predictions.py`) currently derives review time forecasts as 40% of cycle time. This proxy continues to function. Updating predictions to use actual review time rollup data is a separate enhancement that depends on the runtime forecaster module, not just the demo script.

---

### Edge Cases

- What happens when a reviewer's system thread comment is deleted (`isDeleted: true`)? The system should skip deleted thread comments when determining the earliest positive vote.
- What happens when a PR's `creation_date` is after the `reviewed_at` timestamp (clock skew or data anomaly)? The system should apply the 1.0-minute minimum floor, same as cycle time.
- What happens when the same reviewer voted multiple times (e.g., rejected then approved)? The system should use the earliest positive vote timestamp for that reviewer.
- What happens when a PR has multiple reviewers who approved? The system should use the earliest approval across all reviewers for the per-PR `review_time_minutes`.
- What happens when thread data exists but contains no system comments (only text/code comments)? The PR should have `NULL` review time.
- What happens when the database has schema version 2 already (re-running migration)? The migration should be idempotent — no error, no duplicate column.
- What happens when aggregation encounters a mix of PRs with and without review time data in the same week? PRs with `NULL` review time are excluded from the percentile calculation; the metric is computed from the subset that has data, subject to minimum sample thresholds.
- What happens when all PRs in a dimension slice (e.g., a specific team) have `NULL` review time? That slice's `review_time_p50` and `review_time_p90` are `NULL`.
- What happens when cross-dimensional slices (author x repo) have very few PRs with review time? The stricter minimum sample threshold applies, producing `NULL` when insufficient.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST extract review vote timestamps from PR thread system comments by matching `commentType: "system"` entries that indicate approval actions (vote values 10 or 5).
- **FR-002**: System MUST store the extracted review timestamp as `reviewed_at` (ISO 8601 text) on the reviewer record in the database.
- **FR-003**: System MUST compute `review_time_minutes` per PR as the duration from `creation_date` to the earliest positive `reviewed_at` across all reviewers, with a minimum floor of 1.0 minute and 2 decimal place precision.
- **FR-004**: System MUST include `review_time_p50` and `review_time_p90` fields on the weekly rollup output, computed as the 50th and 90th percentile of `review_time_minutes` across completed PRs in each week.
- **FR-005**: System MUST apply the same minimum sample threshold for review time percentiles as exists for cycle time percentiles (currently 2 PRs for base rollups, 5 for cross-dimensional slices).
- **FR-006**: System MUST include `review_time_p50` and `review_time_p90` on all dimension breakdown entries: by_repository, by_author, by_team, by_author_and_repo, and by_team_and_repo.
- **FR-007**: System MUST migrate existing databases by adding the `reviewed_at` column to the reviewers table and `review_time_minutes` column to the pull_requests table, preserving all existing data, and advancing the schema version.
- **FR-008**: System MUST handle PRs without thread data gracefully — `review_time_minutes` is `NULL`, and those PRs are excluded from percentile calculations without causing errors.
- ~~**FR-009**: System MUST support backfilling `reviewed_at` from existing stored thread data for historical PRs.~~ (DESCOPED — deferred to follow-up)
- **FR-010**: System MUST generate synthetic review time data in demo datasets with per-percentile independent null patterns (some weeks with P50 only, some with P90 only, some with both).
- **FR-011**: System MUST skip deleted thread comments (`isDeleted: true`) when determining review vote timestamps.
- **FR-012**: System MUST produce review time values that are typically 30-70% of cycle time in synthetic data to reflect realistic proportions.
- ~~**FR-013**: System MUST update the predictions generator to use actual review time data from rollups when available, instead of the current fixed-fraction proxy.~~ (DESCOPED — deferred to follow-up)
- **FR-014**: System MUST maintain cross-platform compatibility (Windows, macOS, Linux) for all new functionality.
- **FR-015**: System MUST update all forward-compatibility and demo test guards to reflect that review time fields are now produced by the backend: remove from `TS_ONLY_FORWARD_COMPAT_FIELDS` in `test_schema_parity.py`, remove from `DEPRECATED_FIELDS` in `test_schema_guard.py`, and add `review_time_p50`/`review_time_p90` to the `required` field list in `test_synthetic_data.py`.
- **FR-016**: System MUST persist `review_time_minutes` on the pull request record in the database (parallel to `cycle_time_minutes`) for efficient aggregation queries. This field is DB-internal only and MUST NOT be added to the CSV output contract.
- **FR-018**: System MUST emit a visible warning at extraction completion when thread extraction is not enabled (i.e., `--include-comments` is absent), explicitly stating that review time metrics will be unavailable until thread extraction is activated. The warning MUST name the flag or configuration needed to enable it. When thread extraction IS enabled, review timestamp extraction MUST run automatically with no additional flags — it is not a separate opt-in. The aggregation step MUST always include `review_time_minutes` in its query regardless of whether data exists; NULL handling (FR-008) covers the empty-data path.
- **FR-017**: System MUST regenerate the canonical demo dataset (260 weeks, 2021-W01 through 2025-W52) with review time fields populated, and promote to `docs/data/` so the published GitHub Pages demo dashboard displays review time cards. The local `WeeklyRollup` dataclass in `generate-demo-data.py` MUST be updated to include `review_time_p50` and `review_time_p90` fields synchronized with the canonical dataclass in `aggregators.py`. The `SliceMetrics` local definition in the same generator MUST also be updated to include review time fields for dimension breakdowns.
- **FR-019**: The demo dataset and golden fixture artifacts checked into the repository MUST be deterministically verifiable in CI. If a code change to the aggregation or generation pipeline would produce different output than what is committed in `docs/data/`, CI MUST fail. This prevents stale demo outputs from diverging between local and CI. The existing demo parity gates (QG-31, QG-32) and golden output tests (QG-05) MUST enforce this for the newly added review_time fields.
- **FR-020**: The extension test suite MUST include at least one integration test that loads regenerated demo rollup data containing `review_time_p50`/`review_time_p90` fields and verifies: (a) review time summary cards become visible when data is present, (b) review time cards hide when data is absent/null, and (c) the forward-compatibility allowlist removal does not regress schema validation. This closes the contract activation gap between backend data production and frontend rendering.

### Key Entities

- **Reviewer Record**: Extended with `reviewed_at` (ISO 8601 timestamp or NULL) — the datetime of the reviewer's positive vote, extracted from PR thread system comments.
- **Pull Request Record**: Extended with `review_time_minutes` (float or NULL) — the duration from PR creation to earliest approval, parallel to `cycle_time_minutes`.
- **Weekly Rollup**: Extended with `review_time_p50` and `review_time_p90` (float or NULL) — the 50th and 90th percentile of review times across PRs closed in that week.
- **Breakdown Entry**: Extended with `review_time_p50` and `review_time_p90` — same percentiles scoped to a specific dimension (repository, author, team, or cross-dimensional intersection).
- **Vote Event**: A system thread comment in a PR that records a reviewer's vote action, identified by `commentType: "system"` and the presence of vote-indicating content. Contains the voter's identity and the vote timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Review time P50 and P90 summary cards are visible on the dashboard when loading a dataset that contains review timestamp data (0% regression on existing card visibility).
- **SC-002**: Review time values across all dimension breakdowns (repository, author, team, cross-dimensional) are within expected statistical bounds — review time is strictly less than or equal to cycle time for every PR (review happens before or at closure).
- **SC-003**: Existing databases migrate without data loss — 100% of pre-existing reviewer records are preserved with their original vote values intact after schema migration.
- **SC-004**: The aggregation pipeline completes within the existing performance budget (30 seconds) with the additional review time computation.
- **SC-005**: Weekly rollup JSON files remain within the existing size budget (500KB per file) with the additional review time fields.
- **SC-006**: Demo dataset review time cards are visible when loading the demo, with sparklines showing non-trivial variation across weeks.
- **SC-007**: Per-percentile independence is exercised in the demo — P50 and P90 cards can independently show/hide based on data availability within the demo dataset.
- **SC-008**: All new functionality passes the full quality gate chain (pre-commit, pre-push preflight, CI) without requiring any new suppressions, type ignores, or lint disables.
- **SC-009**: Test coverage for new code meets the enterprise standard — no untested code paths for the extraction, computation, migration, aggregation, or synthetic data generation.
- ~~**SC-010**: Backfill operation correctly populates review timestamps for historical PRs that have stored thread data, with zero data corruption.~~ (DESCOPED — deferred with FR-009)

## Assumptions

- **VALIDATED (2026-04-04 spike)**: The ADO API's PR threads endpoint reliably creates system thread comments for reviewer vote events. Vote comments follow the pattern `"{displayName} voted {voteValue}"` with `commentType: "system"`, accurate `publishedDate` timestamps (UTC, millisecond precision), and `author.id` that matches the PR reviewer record. Confirmed across 10 PRs, 11 vote comments, 2 projects, 4 repositories. See [spike evidence](spike-ado-vote-timestamps.md).
- The PR `creation_date` is a reasonable proxy for "review request time" since reviewers are typically assigned at PR creation in ADO workflows. If a more precise "reviewer added" event is needed, that is a future enhancement outside this scope.
- Thread extraction is a hard prerequisite for review time data. The activation contract is defined in FR-018.
- The existing TypeScript rendering, filtering, sparkline, and visibility infrastructure requires zero changes — the UI will auto-activate when the backend produces the expected data fields.
- Performance and file size budgets are achievable because review time adds a constant number of fields per rollup/breakdown entry (2 fields each), with percentile computation overhead proportional to the existing cycle time computation.
- The schema migration approach (ALTER TABLE ADD COLUMN) is supported by SQLite and is a non-destructive operation that preserves existing data.
- Synthetic data generation for review time follows the same statistical modeling approach as cycle time (log-normal distribution for the enterprise demo, uniform for the quick synthetic generator).
- The `reviewed_prs` count in reviewer activity metrics already accurately reflects distinct PRs per reviewer per week, as noted in the issue's implementation comments.
- `review_time_minutes` is a DB-internal column only. It MUST NOT appear in the CSV output contract (`CSV_SCHEMAS` in models.py). The CSV contract remains unchanged by this feature.
- Backfill of historical PR review timestamps and predictions generator updates are explicitly out of scope for this feature and will be tracked as separate follow-up issues.

## Descoped Items (Follow-Up)

The following were originally in scope but removed during review to maintain a focused delivery:

- **Backfill** (was FR-009, Story 6, SC-010): Populating `reviewed_at` for historical PRs that already have stored thread data. Requires rate limiting, resumability, progress tracking, and partial failure handling — justifies its own specification.
- **Predictions update** (was FR-013, Story 7): Switching demo predictions from the 40%-of-cycle-time proxy to actual review time rollup data. Depends on the runtime forecaster module being updated, which is a separate system from the demo generator script.

## Review Team Sign-Off

| Reviewer | Verdict | Key Findings |
|----------|---------|--------------|
| DevOps | Conditional | Migration infra needs design; demo validation gates need extending; parity doc update required |
| QA | Conditional | New test modules needed for extraction + migration; ~40-60 new tests; ratchet bump to ~1540 |
| Python | Approved | Architecture sound; schema version constant needs clarifying; JSON null serialization needs test |
| Data Scientist | Approved | Percentiles sound; 5 follow-up concerns (sample size, selection bias, metric definition, synthetic realism, null correlation) |
| UX | Approved | Tooltip copy should say "PR creation to first approval"; monitor 7-card layout on narrow viewports |
| Devil's Advocate | Conditional | ADO vote timestamp source unproven (spike required); vote-to-comment mapping undefined; CSV contract risk (resolved: DB-internal only) |
