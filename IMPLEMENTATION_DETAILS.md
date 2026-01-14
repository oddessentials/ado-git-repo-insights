# ado-git-repo-insights — Phase 3 Implementation Plan

## 0) Purpose and Non-Negotiables

Phase 3 delivers an Azure DevOps extension UI for **org-wide PR analytics** backed by a canonical SQLite dataset and fast, chunked aggregates. This plan is written to be executed without ambiguity.

### Non-Negotiables

* **Canonical store**: SQLite is the system of record and is always produced/persisted.
* **Completed-only**: Extract/analyze only merged PRs (`status=completed`). Do not broaden scope in Phase 3.
* **No new infrastructure**: No Blob storage, no cloud DB, no service backend.
* **Permissions**: Intended dashboard viewers **must** have **Build Read** on the analytics pipeline producing artifacts.
* **Scale**: Assume very large orgs; aggregates must be **chunked + lazy-loaded**.
* **Compute boundary**: All ML/AI computation happens in the pipeline; UI renders only.

---

## 1) Semantics: “Completed” vs “Closed” (Locked)

### Definitions

| Concept   | Type        | Meaning                | API Usage                                  |
| --------- | ----------- | ---------------------- | ------------------------------------------ |
| Completed | PR Status   | PR merged              | `searchCriteria.status=completed`          |
| Closed    | Time filter | filter by `closedDate` | `searchCriteria.queryTimeRangeType=closed` |

### Rules

* Query PRs with `status=completed` only.
* Use `queryTimeRangeType=closed` and `minTime/maxTime` for date scoping.
* Abandoned/active PRs are out of scope for Phase 3.

### Required Test

* Add a unit test that proves abandoned PRs are excluded even when `closedDate` exists.

---

## 2) Data & Retention Model (Canonical SQLite + Artifacts)

### What is persisted

Each pipeline run publishes a **run-scoped immutable dataset** (artifact):

```
ado-insights/<run-id>/
├── dataset-manifest.json
├── ado-insights.sqlite
└── aggregates/
    ├── dimensions.json
    ├── weekly_rollups/
    │   ├── 2026-W01.json
    │   ├── 2026-W02.json
    │   └── ...
    └── distributions/
        ├── 2025.json
        └── 2026.json
```

### Retention assumptions (explicit)

* SQLite accumulates history; the “latest run” artifact contains the full retained history.
* Operators must configure artifact retention to meet desired analytics window (e.g., ≥ 1 year).
* Phase 3 does **not** implement external archival.

### Required output invariants

* If the run produces artifacts, it must always publish:

  * `dataset-manifest.json`
  * `ado-insights.sqlite`
  * `aggregates/dimensions.json`
  * At least one chunk in `weekly_rollups/` for the run’s covered range

---

## 3) Dataset Discovery & UI Access (Run-based, reliable)

### Discovery strategy (no “latest pointer”)

The UI determines “current dataset” by locating the **most recent successful run** of the configured pipeline, then downloading its artifact files.

### Hard requirement: permissions

* UI users must have **Build Read** on the producing pipeline.
* If not, the UI must show a clear, actionable error:

  * “No access to analytics pipeline artifacts. Ask an admin for Build Read on pipeline X.”

### Configuration inputs (must be explicit)

The extension must be configured with:

* `organization`
* `project` that hosts the pipeline (may be a central analytics project)
* `pipelineId` (or pipeline name resolved to ID)
* optional default filter settings (e.g., `default_date_range_days=90`)

### Required UI behavior on disruptions

* If no successful runs exist: show “No dataset available yet” state.
* If artifact fetch fails: show “Dataset unavailable” state with retry button.
* If dataset schema incompatible: show “Dataset/UI version mismatch” with guidance to rerun pipeline or upgrade extension.

### Required Test

* Integration test that mocks the “latest successful run” API response and validates correct artifact URL construction and error states.

---

## 4) Chunked Aggregates & Lazy Loading (Scale-safe)

### Why chunking is mandatory

Weekly rollups and distributions can grow unbounded. Loading them fully in-browser is unacceptable for large orgs.

### Aggregate formats (locked)

* Aggregates are **JSON** (UI serving layer).
* SQLite remains canonical store.

### Chunking scheme (locked)

* `weekly_rollups`: per ISO week file `YYYY-Www.json`
* `distributions`: per year file `YYYY.json`
* `dimensions.json`: single small file

### Manifest must include an aggregate index

`dataset-manifest.json` must include:

* `aggregate_index.weekly_rollups`: list of `{ week: "YYYY-Www", path, start_date, end_date, size_bytes }`
* `aggregate_index.distributions`: list of `{ year: "YYYY", path, start_date, end_date, size_bytes }`
* `defaults.default_date_range_days` (e.g., 90)
* `limits.max_date_range_days_soft` (e.g., 730) for UI warning (not hard block)

### Required UI loading flow (not clunky)

* Initial load fetches:

  1. `dataset-manifest.json`
  2. `aggregates/dimensions.json`
  3. only the rollup chunks needed for default date range
* On date range change:

  * fetch only additional chunks needed
  * cache in memory (and optionally sessionStorage)
  * re-render without page reload
* If user requests an extremely wide range:

  * show a warning (“Large range may load slowly”)
  * proceed; don’t block unless it truly fails

### Required Tests

* Unit tests for chunk selection logic (given range, pick correct chunk set).
* UI integration test that simulates range expansion and verifies incremental fetch (no refetch of already cached chunks).

---

## 5) Team Dimension (Locked semantics + extraction)

### Semantics (locked)

* Team metrics are computed using **current team membership**, not historical snapshots.

### Source of truth

* Teams are Azure DevOps **project teams** (e.g., `_settings/teams`).

### Extraction requirements

* On each run, fetch:

  * list of teams per project
  * membership per team
* Persist in SQLite:

  * `teams` table (project-scoped)
  * `team_members` mapping (team_id ↔ user_id)
* Aggregates must support pivot by team using this mapping.

### Caching requirements

* Team membership is fetched once per run per project (not per PR).
* If team API calls fail:

  * extraction continues for PRs
  * manifest marks `features.teams=false` (or `teams_partial=true`)
  * UI disables “Team” filter with a clear message

### Required Tests

* Unit tests for team extraction pagination/robustness.
* Integration test verifying “teams unavailable” gracefully degrades UI.

---

## 6) Comments / Threads Extraction (Feature-flagged)

### CLI behavior (locked)

* Implement as an optional flag on the existing extract command:

  * `--include-comments`
* No new subcommand in Phase 3.

### Incremental strategy (required)

* Only fetch threads for PRs in the backfill window / updated PR set.
* Store thread `lastUpdatedDate` and use it to avoid refetching unchanged threads.

### Rate limit protections (required)

* Strict per-run budgets:

  * `--comments-max-prs-per-run` (default set conservatively)
  * `--comments-max-threads-per-pr` (optional)
* Bounded retries with exponential backoff on 429/5xx.
* Run summary + manifest must reflect coverage:

  * `features.comments=true`
  * `coverage.comments: "full" | "partial" | "disabled"`
  * include counts: `threads_fetched`, `prs_with_threads`, `capped=true/false`

### Schema requirements

Add normalized tables, indexed by PR UID and update time:

* `pr_threads(pull_request_uid, thread_id, last_updated, ...)`
* `pr_comments(pull_request_uid, thread_id, comment_id, created_at, author_id, content, ...)`

### Required Tests

* Unit test for incremental comment sync (no refetch when unchanged).
* Integration test for 429 handling/backoff boundedness.
* Test that coverage flags are set correctly when caps trigger.

---

## 7) Metrics, Predictions, AI Insights (Compute boundary + datasets)

### UI tabs (locked)

1. Metrics
2. Predictions
3. AI Insights

### Compute boundary (locked)

* Pipeline produces all computed datasets; UI renders only.
* No Prophet/LLM calls in browser.

### Minimum viable outputs per tab

**Metrics tab (Phase 3 must ship)**

* From weekly rollups + distributions:

  * PR throughput
  * cycle time percentiles
  * review latency percentiles (as available)
  * merge delay percentiles (as available)

**Predictions tab**

* If ML not enabled yet, ship a placeholder that reads manifest feature flags and displays:

  * “Predictions not generated in this dataset” when `features.ml=false`

**AI Insights tab**

* Same pattern:

  * render precomputed insights if present
  * else show “AI insights not generated”

### Required Tests

* UI tests that feature flags correctly show/hide ML/AI content and never “dead-end” or error.

---

## 8) Schema Versioning & Compatibility (No migrations in Phase 3)

### Versioning requirements

`dataset-manifest.json` must include:

* `manifest_schema_version`
* `dataset_schema_version` (SQLite schema)
* `aggregates_schema_version`

### UI compatibility rule

* UI must validate versions before rendering:

  * if incompatible, fail fast with a clear message

### SQLite evolution rules (Phase 3)

* Backwards compatibility is maintained by:

  * additive tables/columns only
  * never renaming existing columns used by CSV contract
* No automatic migrations required beyond additive DDL.

### Required Tests

* A “version mismatch” test that verifies UI error messaging and safe failure.

---

## 9) Security Model (Explicit)

* Data access is governed by Azure DevOps permissions:

  * Build Read permission is required to view artifacts and thus dashboards.
* Phase 3 does not implement special redaction/encryption.
* Document this as an operational requirement.

---

# Execution Phases (Deliverable-driven)

## Phase 3.1 — Foundation: Dataset contract + discovery + chunking

**Deliverables**

* `dataset-manifest.json` generated and published per run
* Chunked aggregates published (`weekly_rollups/`, `distributions/`, `dimensions.json`)
* UI can locate latest successful run and load manifest + dimensions + required chunks
* Completed-only unit test + README semantics section

**Required Tests**

* unit: completed-only filter test
* unit: chunk selection logic
* integration: “latest run discovery” (mock ADO APIs)
* UI: loads default range using chunk fetches

---

## Phase 3.2 — Metrics UI (real dashboards)

**Deliverables**

* Hub UI with 3 tabs (Metrics/Predictions/AI)
* Shared filter bar with URL persistence
* Metrics tab renders charts/tables from chunked aggregates
* Caching + incremental chunk fetch on date-range changes
* Clear empty/error states

**Required Tests**

* UI integration: filter persistence + range expansion
* UI integration: cached chunks not refetched
* smoke: metrics render with only aggregates (no SQLite dependency in browser)

---

## Phase 3.3 — Teams (current-state membership)

**Deliverables**

* Team extraction and persistence in SQLite
* Team filter and team-based aggregation support (team dimension appears in dimensions + rollups)
* Graceful degradation if team APIs unavailable

**Required Tests**

* unit: team extraction pagination / error handling
* integration: teams unavailable → UI disables team filter

---

## Phase 3.4 — Comments/Threads (feature-flagged)

**Deliverables**

* `--include-comments` implementation
* normalized schema + indexes
* incremental sync logic + strict budgets
* manifest coverage flags and run summary metrics

**Required Tests**

* unit: incremental sync correctness
* integration: 429 retry/backoff boundedness
* integration: caps trigger “partial” coverage flag

---

## Phase 3.5 — Predictions + AI tabs (render-only)

**Deliverables**

* Pipeline-produced predictions/insights stored as tables/files
* UI renders when present, shows “not generated” when absent (no errors)
* Manifest feature flags fully drive tab behavior

**Required Tests**

* UI: feature flags hide/show correctly
* integration: sample dataset includes ML/AI payloads

---

# Definition of Done (Phase 3)

* Metrics UI works at org scale by lazy-loading chunked aggregates.
* Dataset discovery is reliable and produces actionable errors when permissions are missing.
* Completed-only semantics are documented and tested.
* Team filtering works using current team membership; no historical snapshot complexity.
* Comment extraction is optional, bounded, and reports coverage accurately.
* No new infrastructure introduced; all persistence is via pipeline artifacts.
* All required tests in each phase are implemented and passing.
